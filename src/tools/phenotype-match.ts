import type { Tool } from '@mastra/core/tools';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

/**
 * Find a biomedical MCP tool by name candidates (exact match first, then suffix).
 */
function findMcpTool(tools: Record<string, Tool>, ...candidates: string[]): Tool | undefined {
  for (const candidate of candidates) {
    const exact = tools[candidate];
    if (exact) return exact;
  }
  const toolNames = Object.keys(tools);
  for (const candidate of candidates) {
    const suffix = toolNames.find((n) => n.endsWith(candidate));
    if (suffix) return tools[suffix];
  }
  return undefined;
}

async function executeMcpTool(tool: Tool, input: Record<string, unknown>): Promise<string> {
  if (!tool.execute) return '';
  try {
    const result = await tool.execute(input, {});
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (typeof r['content'] === 'string') return r['content'];
      if (Array.isArray(r['content'])) {
        return (r['content'] as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
      }
      return JSON.stringify(result);
    }
    return String(result);
  } catch {
    return '';
  }
}

const hpoTermInput = z.object({
  id: z.string().describe('HPO term ID (e.g., HP:0001250)'),
  name: z.string().describe('Term name'),
});

const candidateSchema = z.object({
  diseaseName: z.string(),
  diseaseId: z.string(),
  diseaseIdType: z.string(),
  inheritancePattern: z.string().optional(),
  phenotypeOverlap: z.number().min(0).max(1),
  matchedTerms: z.array(z.string()),
  unmatchedPatientTerms: z.array(z.string()),
  unmatchedDiseaseTerms: z.array(z.string()),
  knownGenes: z.array(z.string()).optional(),
  geneOverlap: z.boolean().optional(),
});

export const phenotypeMatchTool = createTool({
  id: 'phenotype-match',
  description:
    'Systematically match patient HPO terms against Mendelian disease databases (OMIM, Orphanet, Monarch) to identify disease candidates ranked by phenotype overlap (Jaccard similarity). Cross-references known patient gene variants.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    hpoTerms: z.array(hpoTermInput).describe('Patient HPO terms from hpo-mapper output'),
    includeGenes: z
      .array(z.string())
      .optional()
      .describe('Known patient gene variants to cross-reference'),
    maxCandidates: z.number().optional().describe('Max disease candidates to return (default: 20)'),
  }),
  outputSchema: z.object({
    candidates: z.array(candidateSchema),
    queryCount: z.number(),
    source: z.string(),
  }),
  execute: async (input) => {
    const { patientId, hpoTerms, includeGenes, maxCandidates = 20 } = input;
    logger.info('Running phenotype-genotype correlation', { patientId, hpoCount: hpoTerms.length });

    const tools = await getBiomedicalTools();
    const patientTermIds = new Set(hpoTerms.map((t) => t.id));
    const diseaseMap = new DiseaseMap();

    let queryCount = 0;

    // Query disease associations for each HPO term
    const diseaseTool = findMcpTool(
      tools,
      'biomcp_disease_searcher',
      'disease_searcher',
      'biocontext_hpo_diseases',
    );
    if (diseaseTool) {
      queryCount += await queryDiseasesForHpoTerms(diseaseTool, hpoTerms, diseaseMap);
    }

    // Fallback: if no disease tool, try gene-based approach
    if (diseaseMap.size === 0 && includeGenes && includeGenes.length > 0) {
      queryCount += await queryDiseasesForGenes(tools, includeGenes, diseaseMap);
    }

    // Compute Jaccard similarity for each candidate
    const candidates = rankCandidatesByOverlap(
      diseaseMap,
      hpoTerms,
      patientTermIds,
      includeGenes,
      maxCandidates,
    );

    // Auto-persist top candidates as research findings
    await persistTopCandidates(candidates, patientId, hpoTerms.length);

    return {
      candidates,
      queryCount,
      source: diseaseTool ? 'BioMCP/Monarch' : 'Gene-based fallback',
    };
  },
});

// ─── Extracted helpers to reduce cognitive complexity ─────────────────────

interface DiseaseEntry {
  diseaseName: string;
  diseaseId: string;
  diseaseIdType: string;
  matchedTermIds: Set<string>;
  diseaseTermIds: Set<string>;
  inheritancePattern?: string;
  knownGenes: string[];
}

class DiseaseMap {
  private map = new Map<string, DiseaseEntry>();
  get size() {
    return this.map.size;
  }
  get(id: string) {
    return this.map.get(id);
  }
  has(id: string) {
    return this.map.has(id);
  }
  set(id: string, entry: DiseaseEntry) {
    this.map.set(id, entry);
  }
  values() {
    return this.map.values();
  }
}

function parseDiseaseLineId(
  line: string,
): { id: string; idType: string; name: string } | undefined {
  const omimMatch = line.match(/(?:OMIM|MIM)\s*#?\s*(\d{6})/i);
  const orphaMatch = line.match(/ORPHA(?:NET)?\s*:?\s*(\d+)/i);
  if (!(omimMatch?.[1] || orphaMatch?.[1])) return undefined;

  const diseaseNameMatch = line.match(/^\s*[-*#%+]\s*(.+?)(?:\s*\(|$)/);
  const nameFromLine = diseaseNameMatch?.[1]?.trim();
  return {
    id: omimMatch?.[1] ? `OMIM:${omimMatch[1]}` : `ORPHA:${orphaMatch?.[1]}`,
    idType: omimMatch?.[1] ? 'omim' : 'orpha',
    name: nameFromLine ?? line.slice(0, 100).trim(),
  };
}

function addDiseaseHit(
  diseaseMap: DiseaseMap,
  id: string,
  idType: string,
  name: string,
  termId: string,
): void {
  const existing = diseaseMap.get(id);
  if (existing) {
    existing.matchedTermIds.add(termId);
  } else {
    diseaseMap.set(id, {
      diseaseName: name,
      diseaseId: id,
      diseaseIdType: idType,
      matchedTermIds: new Set([termId]),
      diseaseTermIds: new Set(),
      knownGenes: [],
    });
  }
}

async function queryDiseasesForHpoTerms(
  diseaseTool: Tool,
  hpoTerms: Array<{ id: string; name: string }>,
  diseaseMap: DiseaseMap,
): Promise<number> {
  let queryCount = 0;
  for (const term of hpoTerms) {
    try {
      const result = await executeMcpTool(diseaseTool, { query: term.name, phenotype: term.id });
      queryCount++;
      for (const line of result.split('\n')) {
        const parsed = parseDiseaseLineId(line);
        if (parsed) addDiseaseHit(diseaseMap, parsed.id, parsed.idType, parsed.name, term.id);
      }
    } catch {
      logger.debug(`Failed to query diseases for HPO term ${term.id}`);
    }
  }
  return queryCount;
}

async function queryDiseasesForGenes(
  tools: Record<string, Tool>,
  genes: string[],
  diseaseMap: DiseaseMap,
): Promise<number> {
  let queryCount = 0;
  const geneTool = findMcpTool(tools, 'biomcp_gene_searcher', 'gene_searcher');
  if (!geneTool) return 0;

  for (const gene of genes) {
    try {
      const result = await executeMcpTool(geneTool, { query: gene });
      queryCount++;
      for (const match of result.matchAll(/(?:OMIM|MIM)\s*#?\s*(\d{6})/gi)) {
        if (match[1] && !diseaseMap.has(`OMIM:${match[1]}`)) {
          diseaseMap.set(`OMIM:${match[1]}`, {
            diseaseName: `Gene-associated (${gene})`,
            diseaseId: `OMIM:${match[1]}`,
            diseaseIdType: 'omim',
            matchedTermIds: new Set(),
            diseaseTermIds: new Set(),
            knownGenes: [gene],
          });
        }
      }
    } catch {
      logger.debug(`Failed to query gene ${gene}`);
    }
  }
  return queryCount;
}

function rankCandidatesByOverlap(
  diseaseMap: DiseaseMap,
  hpoTerms: Array<{ id: string; name: string }>,
  patientTermIds: Set<string>,
  includeGenes: string[] | undefined,
  maxCandidates: number,
) {
  return [...diseaseMap.values()]
    .map((d) => computeCandidate(d, hpoTerms, patientTermIds, includeGenes))
    .sort((a, b) => b.phenotypeOverlap - a.phenotypeOverlap)
    .slice(0, maxCandidates);
}

function computeCandidate(
  d: DiseaseEntry,
  hpoTerms: Array<{ id: string; name: string }>,
  patientTermIds: Set<string>,
  includeGenes: string[] | undefined,
) {
  const matchedTerms = [...d.matchedTermIds];
  const unmatchedPatientTerms = hpoTerms
    .filter((t) => !d.matchedTermIds.has(t.id))
    .map((t) => t.name);
  const unmatchedDiseaseTerms = [...d.diseaseTermIds].filter((id) => !patientTermIds.has(id));

  const intersection = matchedTerms.length;
  const union = patientTermIds.size + d.diseaseTermIds.size - intersection;
  const phenotypeOverlap =
    union > 0 ? intersection / union : intersection > 0 ? intersection / patientTermIds.size : 0;

  const geneOverlap = includeGenes ? d.knownGenes.some((g) => includeGenes.includes(g)) : undefined;

  return {
    diseaseName: d.diseaseName,
    diseaseId: d.diseaseId,
    diseaseIdType: d.diseaseIdType,
    inheritancePattern: d.inheritancePattern,
    phenotypeOverlap: Math.round(phenotypeOverlap * 1000) / 1000,
    matchedTerms: matchedTerms.map((id) => hpoTerms.find((t) => t.id === id)?.name ?? id),
    unmatchedPatientTerms,
    unmatchedDiseaseTerms,
    knownGenes: d.knownGenes.length > 0 ? d.knownGenes : undefined,
    geneOverlap,
  };
}

async function persistTopCandidates(
  candidates: Array<{
    diseaseId: string;
    diseaseIdType: string;
    diseaseName: string;
    phenotypeOverlap: number;
    matchedTerms: string[];
  }>,
  patientId: string,
  totalHpoTerms: number,
): Promise<void> {
  try {
    const store = getClinicalStore();
    const today = new Date().toISOString().split('T')[0] ?? '';
    for (const candidate of candidates.slice(0, 5)) {
      await store.addResearchFinding({
        id: `find-pheno-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        patientId,
        source: 'PhenotypeMatch',
        sourceTool: 'phenotype-match',
        externalId: candidate.diseaseId.replace(/^(OMIM:|ORPHA:)/, ''),
        externalIdType: candidate.diseaseIdType as 'omim' | 'orpha',
        title: candidate.diseaseName,
        summary: `Phenotype overlap ${(candidate.phenotypeOverlap * 100).toFixed(1)}% — matched ${candidate.matchedTerms.length}/${totalHpoTerms} HPO terms`,
        relevance: candidate.phenotypeOverlap,
        evidenceLevel: 'unknown',
        date: today,
      });
    }
  } catch (err) {
    logger.warn('Failed to auto-persist phenotype match results', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
