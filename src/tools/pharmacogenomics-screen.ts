import type { Tool } from '@mastra/core/tools';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

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

const interactionSchema = z.object({
  medication: z.string(),
  gene: z.string(),
  variant: z.string().optional(),
  interactionType: z.enum(['metabolism', 'target', 'transporter', 'adverse-effect', 'efficacy']),
  clinicalSignificance: z.enum(['major', 'moderate', 'minor', 'informational']),
  description: z.string(),
  recommendation: z.string(),
  source: z.string(),
  score: z.number().optional(),
});

export const pharmacogenomicsScreenTool = createTool({
  id: 'pharmacogenomics-screen',
  description:
    'Cross-reference patient medications with known genetic variants to produce a drug-gene interaction matrix. Queries DGIdb and PharmGKB via BioMCP. Auto-loads medications from Layer 2 treatment_trials and gene variants from research findings if not provided.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    medications: z
      .array(
        z.object({
          name: z.string(),
          drugClass: z.string().optional(),
        }),
      )
      .optional()
      .describe('Override medications (default: pulled from Layer 2)'),
    geneVariants: z
      .array(
        z.object({
          gene: z.string(),
          variant: z.string().optional(),
        }),
      )
      .optional()
      .describe('Override gene variants (default: pulled from research findings)'),
  }),
  outputSchema: z.object({
    interactions: z.array(interactionSchema),
    medicationsWithoutInteractions: z.array(z.string()),
    genesWithoutInteractions: z.array(z.string()),
    summary: z.string(),
  }),
  execute: async (input) => {
    const { patientId } = input;
    logger.info('Running pharmacogenomics screen', { patientId });

    const store = getClinicalStore();
    const medications = await loadPatientMedications(patientId, input.medications, store);
    const geneVariants = await loadPatientGeneVariants(patientId, input.geneVariants, store);

    if (medications.length === 0 || geneVariants.length === 0) {
      return {
        interactions: [],
        medicationsWithoutInteractions: medications.map((m) => m.name),
        genesWithoutInteractions: geneVariants.map((g) => g.gene),
        summary: `No ${medications.length === 0 ? 'medications' : 'gene variants'} found for patient. Cannot screen for drug-gene interactions.`,
      };
    }

    const bioTools = await getBiomedicalTools();
    const interactions = await queryInteractions(medications, geneVariants, bioTools);

    const medsWithInteractions = new Set(interactions.map((i) => i.medication));
    const genesWithInteractions = new Set(interactions.map((i) => i.gene));

    const medicationsWithoutInteractions = medications
      .filter((m) => !medsWithInteractions.has(m.name))
      .map((m) => m.name);
    const genesWithoutInteractions = geneVariants
      .filter((g) => !genesWithInteractions.has(g.gene))
      .map((g) => g.gene);

    const summary = buildSummary(interactions, medications.length, geneVariants.length);

    await persistInteractions(interactions, patientId, store);

    return { interactions, medicationsWithoutInteractions, genesWithoutInteractions, summary };
  },
});

// ─── Extracted helpers ───────────────────────────────────────────────────

type Medication = { name: string; drugClass?: string | undefined };
type GeneVariant = { gene: string; variant?: string | undefined };
type Interaction = z.infer<typeof interactionSchema>;

interface StoreHandle {
  queryTreatments(params: {
    patientId: string;
  }): Promise<Array<{ medication: string; drugClass?: string | undefined }>>;
  queryFindings(params: {
    patientId: string;
    externalIdType: string;
  }): Promise<
    Array<{ externalId?: string | undefined; title: string; rawData?: string | undefined }>
  >;
  addResearchFinding(finding: Record<string, unknown>): Promise<unknown>;
}

async function loadPatientMedications(
  patientId: string,
  provided: Medication[] | undefined,
  store: StoreHandle,
): Promise<Medication[]> {
  if (provided && provided.length > 0) return provided;

  const treatments = await store.queryTreatments({ patientId });
  return treatments.map((t) => ({
    name: t.medication,
    ...(t.drugClass ? { drugClass: t.drugClass } : {}),
  }));
}

async function loadPatientGeneVariants(
  patientId: string,
  provided: GeneVariant[] | undefined,
  store: StoreHandle,
): Promise<GeneVariant[]> {
  if (provided && provided.length > 0) return provided;

  const findings = await store.queryFindings({ patientId, externalIdType: 'gene' });
  return findings.map((f) => ({
    gene: f.externalId ?? f.title,
    ...(f.rawData ? { variant: f.rawData } : {}),
  }));
}

async function queryInteractions(
  medications: Medication[],
  geneVariants: GeneVariant[],
  tools: Record<string, Tool>,
): Promise<Interaction[]> {
  const dgidbTool = findMcpTool(
    tools,
    'biomcp_drug_gene_interactions',
    'dgidb_search',
    'biomcp_dgidb_search',
  );
  const pharmTool = findMcpTool(
    tools,
    'pharmacology_search_interactions',
    'pharmacology_interactions',
  );

  const interactions: Interaction[] = [];

  for (const med of medications) {
    for (const gv of geneVariants) {
      const dgidbResult = await queryDgidb(dgidbTool, med, gv);
      if (dgidbResult) interactions.push(dgidbResult);

      const pharmResult = await queryPharm(pharmTool, med, gv, interactions);
      if (pharmResult) interactions.push(pharmResult);
    }
  }

  return interactions;
}

async function queryDgidb(
  tool: Tool | undefined,
  med: Medication,
  gv: GeneVariant,
): Promise<Interaction | undefined> {
  if (!tool) return undefined;
  try {
    const result = await executeMcpTool(tool, {
      query: `${med.name} ${gv.gene}`,
      drug: med.name,
      gene: gv.gene,
    });
    return parseInteractionResults(result, med.name, gv.gene, gv.variant, 'dgidb');
  } catch {
    logger.debug(`DGIdb query failed for ${med.name} × ${gv.gene}`);
    return undefined;
  }
}

async function queryPharm(
  tool: Tool | undefined,
  med: Medication,
  gv: GeneVariant,
  existing: Interaction[],
): Promise<Interaction | undefined> {
  if (!tool) return undefined;
  const alreadyHasPharmGkb = existing.some(
    (i) => i.medication === med.name && i.gene === gv.gene && i.source === 'PharmGKB',
  );
  if (alreadyHasPharmGkb) return undefined;

  try {
    const result = await executeMcpTool(tool, {
      query: `${med.name} ${gv.gene}`,
      drug: med.name,
    });
    return parseInteractionResults(result, med.name, gv.gene, gv.variant, 'pharm');
  } catch {
    logger.debug(`Pharmacology query failed for ${med.name} × ${gv.gene}`);
    return undefined;
  }
}

function parseInteractionResults(
  result: string,
  medication: string,
  gene: string,
  variant: string | undefined,
  source: 'dgidb' | 'pharm',
): Interaction | undefined {
  if (result.length <= 20) return undefined;
  return source === 'dgidb'
    ? parseDgidbInteraction(result, medication, gene, variant)
    : parsePharmInteraction(result, medication, gene, variant);
}

function buildSummary(interactions: Interaction[], medCount: number, geneCount: number): string {
  if (interactions.length === 0) {
    return `No drug-gene interactions found for ${medCount} medications × ${geneCount} gene variants.`;
  }

  const majorCount = interactions.filter((i) => i.clinicalSignificance === 'major').length;
  const moderateCount = interactions.filter((i) => i.clinicalSignificance === 'moderate').length;
  const majorWarning =
    majorCount > 0
      ? ` ⚠️ Major interactions require clinical review: ${interactions
          .filter((i) => i.clinicalSignificance === 'major')
          .map((i) => `${i.medication}×${i.gene}`)
          .join(', ')}.`
      : '';

  return `Found ${interactions.length} drug-gene interactions (${majorCount} major, ${moderateCount} moderate).${majorWarning}`;
}

async function persistInteractions(
  interactions: Interaction[],
  patientId: string,
  store: StoreHandle,
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0] ?? '';
    const significant = interactions.filter(
      (i) => i.clinicalSignificance === 'major' || i.clinicalSignificance === 'moderate',
    );
    for (const interaction of significant) {
      await store.addResearchFinding({
        id: `find-pgx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        patientId,
        source: interaction.source,
        sourceTool: 'pharmacogenomics-screen',
        externalId: interaction.gene,
        externalIdType: 'gene',
        title: `${interaction.medication} × ${interaction.gene} interaction`,
        summary: `${interaction.clinicalSignificance}: ${interaction.description}. Recommendation: ${interaction.recommendation}`,
        relevance: interaction.clinicalSignificance === 'major' ? 0.9 : 0.7,
        evidenceLevel: 'review',
        date: today,
      });
    }
  } catch (err) {
    logger.warn('Failed to persist pharmacogenomics results', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────

function parseDgidbInteraction(
  text: string,
  medication: string,
  gene: string,
  variant?: string,
): z.infer<typeof interactionSchema> | undefined {
  if (text.toLowerCase().includes('no interaction') || text.toLowerCase().includes('not found')) {
    return undefined;
  }

  // Extract interaction type
  const typePatterns: Array<
    [RegExp, 'metabolism' | 'target' | 'transporter' | 'adverse-effect' | 'efficacy']
  > = [
    [/metabol/i, 'metabolism'],
    [/target|inhibit|agonist|antagonist|modulator/i, 'target'],
    [/transport/i, 'transporter'],
    [/adverse|toxicity|side.effect/i, 'adverse-effect'],
    [/efficacy|response|sensitivity|resistance/i, 'efficacy'],
  ];

  let interactionType: 'metabolism' | 'target' | 'transporter' | 'adverse-effect' | 'efficacy' =
    'target';
  for (const [pattern, type] of typePatterns) {
    if (pattern.test(text)) {
      interactionType = type;
      break;
    }
  }

  // Extract score
  const scoreMatch = text.match(/score[:\s]*([\d.]+)/i);
  const score = scoreMatch?.[1] ? parseFloat(scoreMatch[1]) : undefined;

  // Classify significance
  const significance = classifySignificance(text, score);

  // Extract description (first meaningful sentence)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const description = sentences[0]?.trim().slice(0, 300) ?? `${medication} interacts with ${gene}`;

  // Generate recommendation
  const recommendation = generateRecommendation(interactionType, significance, medication, gene);

  return {
    medication,
    gene,
    ...(variant ? { variant } : {}),
    interactionType,
    clinicalSignificance: significance,
    description,
    recommendation,
    source: 'DGIdb',
    ...(score !== undefined ? { score } : {}),
  };
}

function parsePharmInteraction(
  text: string,
  medication: string,
  gene: string,
  variant?: string,
): z.infer<typeof interactionSchema> | undefined {
  if (
    text.toLowerCase().includes('no interaction') ||
    text.toLowerCase().includes('not found') ||
    text.length < 30
  ) {
    return undefined;
  }

  const significance = classifySignificance(text, undefined);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
  const description = sentences[0]?.trim().slice(0, 300) ?? `${medication} interacts with ${gene}`;

  return {
    medication,
    gene,
    ...(variant ? { variant } : {}),
    interactionType: 'metabolism',
    clinicalSignificance: significance,
    description,
    recommendation: generateRecommendation('metabolism', significance, medication, gene),
    source: 'PharmGKB',
  };
}

function classifySignificance(
  text: string,
  score: number | undefined,
): 'major' | 'moderate' | 'minor' | 'informational' {
  const lc = text.toLowerCase();
  if (
    lc.includes('contraindicated') ||
    lc.includes('avoid') ||
    lc.includes('black box') ||
    (score !== undefined && score > 0.8)
  )
    return 'major';
  if (
    lc.includes('monitor') ||
    lc.includes('dose adjustment') ||
    lc.includes('caution') ||
    (score !== undefined && score > 0.4)
  )
    return 'moderate';
  if (lc.includes('minor') || lc.includes('informational') || (score !== undefined && score > 0.1))
    return 'minor';
  return 'informational';
}

function generateRecommendation(
  type: string,
  significance: string,
  medication: string,
  gene: string,
): string {
  if (significance === 'major') {
    return `Review ${medication} prescribing given ${gene} interaction. Consider alternative medication or dose modification. Consult clinical pharmacogenomics guidelines.`;
  }
  if (significance === 'moderate') {
    return `Monitor patient on ${medication} for ${type}-related effects due to ${gene} variant. Consider ${gene} genotyping if not already performed.`;
  }
  return `${gene} variant may affect ${medication} ${type}. Clinical impact likely minimal but document in patient record.`;
}
