#!/usr/bin/env npx tsx
/**
 * Genome Variant Research Script
 *
 * Queries the patient's actual genotypes for clinically important SNPs,
 * then annotates them using BioThings (MyVariant.info), BioMCP (genes, literature),
 * and stores findings in the clinical database.
 *
 * Usage:
 *   npx tsx scripts/research-genome-variants.ts [--dry-run] [--verbose]
 */
import type { Tool } from '@mastra/core/tools';
import { getClinicalStore } from '../src/storage/clinical-store.js';
import { getBiomedicalTools } from '../src/clients/biomedical-mcp.js';

const PATIENT_ID = 'patient-tomasz-szychlinski';
const NOW = new Date().toISOString();

// ─── Clinically Important rsIDs grouped by relevance ────────────────────────

interface SnpTarget {
  rsid: string;
  gene: string;
  significance: string;
  category: 'pain-sensitivity' | 'methylation' | 'pharmacogenomic' | 'autoimmune' | 'connective-tissue';
}

const TARGETS: SnpTarget[] = [
  // Tier 1: Pain sensitivity & CVJ mechanism
  { rsid: 'rs4680', gene: 'COMT', significance: 'Val158Met — pain sensitivity, catecholamine clearance at CVJ', category: 'pain-sensitivity' },
  { rsid: 'rs4633', gene: 'COMT', significance: 'COMT haplotype SNP — modifies enzyme activity', category: 'pain-sensitivity' },
  { rsid: 'rs4818', gene: 'COMT', significance: 'COMT haplotype SNP — pain sensitivity phenotype', category: 'pain-sensitivity' },

  // Tier 1: Methylation / homocysteine pathway
  { rsid: 'rs1801133', gene: 'MTHFR', significance: 'C677T — homocysteine metabolism, neuropathy risk', category: 'methylation' },
  { rsid: 'rs1801131', gene: 'MTHFR', significance: 'A1298C — compound heterozygosity with C677T', category: 'methylation' },
  { rsid: 'rs234706', gene: 'CBS', significance: 'Cystathionine beta-synthase — homocysteine clearance', category: 'methylation' },
  { rsid: 'rs567754', gene: 'BHMT', significance: 'Betaine-homocysteine methyltransferase — alternate Hcy clearance', category: 'methylation' },
  { rsid: 'rs1801198', gene: 'TCN2', significance: 'B12 transport — affects methylation cycle', category: 'methylation' },
  { rsid: 'rs602662', gene: 'FUT2', significance: 'B12 absorption — secretor status', category: 'methylation' },

  // Tier 1: VDR — autoimmune/immune
  { rsid: 'rs2228570', gene: 'VDR', significance: 'FokI — SLE risk (OR=1.79 for TT), vitamin D signaling', category: 'autoimmune' },
  { rsid: 'rs7975232', gene: 'VDR', significance: 'ApaI — SLE/Sjögren susceptibility', category: 'autoimmune' },
  { rsid: 'rs1544410', gene: 'VDR', significance: 'BsmI — autoimmune predisposition, neuropathy risk', category: 'autoimmune' },
  { rsid: 'rs731236', gene: 'VDR', significance: 'TaqI — immune dysregulation, vitamin D receptor', category: 'autoimmune' },

  // Tier 2: Pharmacogenomic — drug metabolism
  { rsid: 'rs3892097', gene: 'CYP2D6', significance: '*4 allele — duloxetine metabolism (poor metabolizer)', category: 'pharmacogenomic' },
  { rsid: 'rs1065852', gene: 'CYP2D6', significance: '*10 allele — reduced function', category: 'pharmacogenomic' },
  { rsid: 'rs5030655', gene: 'CYP2D6', significance: '*6 allele — null function', category: 'pharmacogenomic' },
  { rsid: 'rs4244285', gene: 'CYP2C19', significance: '*2 allele — affects multiple medication metabolism', category: 'pharmacogenomic' },
  { rsid: 'rs4986893', gene: 'CYP2C19', significance: '*3 allele — loss of function', category: 'pharmacogenomic' },
  { rsid: 'rs12248560', gene: 'CYP2C19', significance: '*17 allele — ultrarapid metabolizer', category: 'pharmacogenomic' },
  { rsid: 'rs1057910', gene: 'CYP2C9', significance: '*3 allele — NSAID metabolism (ibuprofen, naproxen)', category: 'pharmacogenomic' },
  { rsid: 'rs776746', gene: 'CYP3A5', significance: '*3 allele — naltrexone/LDN metabolism', category: 'pharmacogenomic' },

  // Tier 2: ACE — from dental panel
  { rsid: 'rs4646994', gene: 'ACE', significance: 'ACE I/D — cardiovascular risk, identified in dental SNP panel', category: 'autoimmune' },

  // Tier 3: Connective tissue (CVJ anomaly etiology)
  { rsid: 'rs12722', gene: 'COL5A1', significance: 'Collagen V — Ehlers-Danlos spectrum, CVJ instability', category: 'connective-tissue' },
  { rsid: 'rs1800255', gene: 'COL3A1', significance: 'Collagen III — vascular EDS risk', category: 'connective-tissue' },

  // Factor V Leiden / thrombosis
  { rsid: 'rs6025', gene: 'F5', significance: 'Factor V Leiden — thrombosis risk', category: 'autoimmune' },
];

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

function log(msg: string) {
  console.log(msg);
}

function verbose(msg: string) {
  if (VERBOSE) console.log(`  [verbose] ${msg}`);
}

// ─── MCP tool helpers ───────────────────────────────────────────────────────

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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    verbose(`MCP tool error: ${msg}`);
    return '';
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log('═══════════════════════════════════════════════════════════════');
  log('  Genome Variant Research — Tomasz Szychliński');
  log('═══════════════════════════════════════════════════════════════');
  log(`  Patient: ${PATIENT_ID}`);
  log(`  Targets: ${TARGETS.length} clinically important SNPs`);
  log(`  Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE (will store findings)'}`);
  log('');

  const store = getClinicalStore();
  const startTime = Date.now();

  // ─── Step 1: Query patient genotypes ──────────────────────────────
  log('──── Step 1: Querying patient genotypes ────');

  const rsids = TARGETS.map((t) => t.rsid);
  const variants = await store.queryGeneticVariants({
    patientId: PATIENT_ID,
    rsids,
    limit: rsids.length,
  });

  const genotypeMap = new Map<string, string>();
  for (const v of variants) {
    genotypeMap.set(v.rsid, v.genotype);
  }

  log(`  Found ${variants.length}/${TARGETS.length} target SNPs in patient genome:`);
  log('');

  const categorized: Record<string, Array<{ target: SnpTarget; genotype: string | undefined }>> = {};
  for (const target of TARGETS) {
    const genotype = genotypeMap.get(target.rsid);
    const cat = target.category;
    if (!categorized[cat]) categorized[cat] = [];
    categorized[cat].push({ target, genotype });
  }

  for (const [category, entries] of Object.entries(categorized)) {
    log(`  ── ${category.toUpperCase()} ──`);
    for (const { target, genotype } of entries) {
      const status = genotype ? `${genotype}` : 'NOT IN GENOME';
      const icon = genotype ? (genotype === '--' ? '⚠' : '✓') : '✗';
      log(`  ${icon} ${target.rsid} (${target.gene}): ${status} — ${target.significance}`);
    }
    log('');
  }

  // ─── Step 2: Connect to MCP biomedical tools ────────────────────
  log('──── Step 2: Connecting to biomedical MCP servers ────');

  const tools = await getBiomedicalTools();
  const toolCount = Object.keys(tools).length;
  log(`  Connected: ${toolCount} tools available`);

  if (VERBOSE) {
    const toolNames = Object.keys(tools).sort();
    for (const name of toolNames) {
      verbose(`Tool: ${name}`);
    }
  }

  // Identify available tools (actual names from MCP server discovery)
  const getVariantTool = findMcpTool(tools, 'biothings_biothings_get_variant');
  const queryVariantsTool = findMcpTool(tools, 'biothings_biothings_query_variants');
  const getGeneTool = findMcpTool(tools, 'biothings_biothings_get_gene');
  const queryGenesTool = findMcpTool(tools, 'biothings_biothings_query_genes');
  const europePmcTool = findMcpTool(tools, 'biocontext_bc_get_europepmc_articles');
  const scholarTool = findMcpTool(tools, 'biocontext_bc_search_google_scholar_publications');
  // Available for future use:
  // const openTargetsTool = findMcpTool(tools, 'opentargets_search_entities');
  // const ggetInfoTool = findMcpTool(tools, 'gget_gget_info');
  const biomcpShell = findMcpTool(tools, 'biomcp_shell');

  log(`  BioThings get_variant: ${getVariantTool ? '✓' : '✗'}`);
  log(`  BioThings query_variants: ${queryVariantsTool ? '✓' : '✗'}`);
  log(`  BioThings get_gene: ${getGeneTool ? '✓' : '✗'}`);
  log(`  BioThings query_genes: ${queryGenesTool ? '✓' : '✗'}`);
  log(`  Europe PMC articles: ${europePmcTool ? '✓' : '✗'}`);
  log(`  Google Scholar: ${scholarTool ? '✓' : '✗'}`);
  // log(`  Open Targets: ${openTargetsTool ? '✓' : '✗'}`);
  // log(`  gget info: ${ggetInfoTool ? '✓' : '✗'}`);
  log(`  BioMCP shell: ${biomcpShell ? '✓' : '✗'}`);
  log('');

  // ─── Step 3: Research each variant ──────────────────────────────
  log('──── Step 3: Researching variants via MCP tools ────');

  interface VariantResearch {
    target: SnpTarget;
    genotype: string | undefined;
    myvariantData: string;
    geneData: string;
    literatureData: string;
    dgidbData: string;
    clinicalSignificance: string;
    summary: string;
  }

  const researchResults: VariantResearch[] = [];

  // Process variants that exist in the patient's genome
  const presentVariants = TARGETS.filter((t) => {
    const g = genotypeMap.get(t.rsid);
    return g && g !== '--';
  });

  log(`  Researching ${presentVariants.length} variants present in genome...`);
  log('');

  for (const target of presentVariants) {
    const genotype = genotypeMap.get(target.rsid);
    log(`  ── ${target.rsid} (${target.gene}) — Genotype: ${genotype} ──`);

    // 3a: BioThings — get variant annotation (ClinVar, gnomAD, dbSNP)
    let myvariantData = '';
    if (getVariantTool) {
      verbose(`Querying BioThings get_variant for ${target.rsid}...`);
      myvariantData = await executeMcpTool(getVariantTool, { variant_id: target.rsid });
      if (!myvariantData && queryVariantsTool) {
        verbose(`Falling back to query_variants for ${target.rsid}...`);
        myvariantData = await executeMcpTool(queryVariantsTool, { query: target.rsid });
      }
      if (myvariantData) {
        const preview = myvariantData.substring(0, 300).replace(/\n/g, ' ');
        log(`    Variant annotation: ${preview}${myvariantData.length > 300 ? '...' : ''}`);
      } else {
        log('    Variant annotation: no data');
      }
    }

    // 3b: BioThings — get gene info
    let geneData = '';
    if (getGeneTool) {
      verbose(`Querying BioThings get_gene for ${target.gene}...`);
      geneData = await executeMcpTool(getGeneTool, { gene_id: target.gene });
      if (!geneData && queryGenesTool) {
        verbose(`Falling back to query_genes for ${target.gene}...`);
        geneData = await executeMcpTool(queryGenesTool, { query: target.gene });
      }
      if (geneData) {
        const preview = geneData.substring(0, 300).replace(/\n/g, ' ');
        log(`    Gene info: ${preview}${geneData.length > 300 ? '...' : ''}`);
      } else {
        log('    Gene info: no data');
      }
    }

    // 3c: Literature search — Europe PMC or Google Scholar
    let literatureData = '';
    if (europePmcTool) {
      const litQuery = buildLiteratureQuery(target);
      verbose(`Europe PMC search: "${litQuery}"`);
      literatureData = await executeMcpTool(europePmcTool, { query: litQuery });
      if (literatureData) {
        const preview = literatureData.substring(0, 300).replace(/\n/g, ' ');
        log(`    Literature: ${preview}${literatureData.length > 300 ? '...' : ''}`);
      } else {
        log('    Literature: no data');
      }
    } else if (scholarTool) {
      const litQuery = buildLiteratureQuery(target);
      verbose(`Google Scholar search: "${litQuery}"`);
      literatureData = await executeMcpTool(scholarTool, { query: litQuery });
      if (literatureData) {
        const preview = literatureData.substring(0, 300).replace(/\n/g, ' ');
        log(`    Literature: ${preview}${literatureData.length > 300 ? '...' : ''}`);
      } else {
        log('    Literature: no data');
      }
    }

    // 3d: BioMCP shell — for DGIdb drug-gene interactions (pharmacogenomic variants)
    let dgidbData = '';
    if (biomcpShell && target.category === 'pharmacogenomic') {
      verbose(`Querying BioMCP shell for drug interactions: ${target.gene}...`);
      dgidbData = await executeMcpTool(biomcpShell, {
        command: `biomcp gene drugs ${target.gene}`,
      });
      if (dgidbData) {
        const preview = dgidbData.substring(0, 300).replace(/\n/g, ' ');
        log(`    Drug-gene: ${preview}${dgidbData.length > 300 ? '...' : ''}`);
      } else {
        log('    Drug-gene: no data');
      }
    }

    // Extract clinical significance from myvariant data
    const clinicalSignificance = extractClinicalSignificance(myvariantData);
    const summary = buildVariantSummary(target, genotype ?? '--', myvariantData, geneData, clinicalSignificance);

    researchResults.push({
      target,
      genotype,
      myvariantData,
      geneData,
      literatureData,
      dgidbData,
      clinicalSignificance,
      summary,
    });

    log(`    ➤ Significance: ${clinicalSignificance || 'unknown'}`);
    log('');
  }

  // ─── Step 4: Compile findings report ─────────────────────────────
  log('──── Step 4: Compiling findings report ────');
  log('');

  // Group results by category and clinical significance
  const significant = researchResults.filter(
    (r) => r.clinicalSignificance && r.clinicalSignificance !== 'benign' && r.clinicalSignificance !== 'unknown',
  );
  const pharmacogenomic = researchResults.filter((r) => r.target.category === 'pharmacogenomic');
  const methylation = researchResults.filter((r) => r.target.category === 'methylation');
  const painRelated = researchResults.filter((r) => r.target.category === 'pain-sensitivity');
  const autoimmune = researchResults.filter((r) => r.target.category === 'autoimmune');

  log('  ═══ RESEARCH SUMMARY ═══');
  log(`  Total variants researched: ${researchResults.length}`);
  log(`  Clinically significant: ${significant.length}`);
  log(`  Pharmacogenomic: ${pharmacogenomic.length}`);
  log(`  Methylation pathway: ${methylation.length}`);
  log(`  Pain sensitivity: ${painRelated.length}`);
  log(`  Autoimmune/VDR: ${autoimmune.length}`);
  log('');

  for (const result of researchResults) {
    log(`  ${result.target.rsid} (${result.target.gene}) — ${result.genotype}`);
    log(`    Significance: ${result.clinicalSignificance || 'unknown'}`);
    log(`    Summary: ${result.summary}`);
    log('');
  }

  // ─── Step 5: Store findings ──────────────────────────────────────
  if (!DRY_RUN) {
    log('──── Step 5: Storing research findings ────');

    let inserted = 0;
    let duplicates = 0;

    for (const result of researchResults) {
      const finding = {
        id: `finding-genome-${result.target.rsid}-${Date.now()}`,
        patientId: PATIENT_ID,
        source: 'Genome Analysis',
        sourceTool: 'research-genome-variants',
        externalId: result.target.rsid,
        externalIdType: 'variant' as const,
        title: `${result.target.gene} ${result.target.rsid} — Genotype: ${result.genotype}`,
        summary: result.summary,
        url: `https://www.ncbi.nlm.nih.gov/snp/${result.target.rsid}`,
        relevance: result.clinicalSignificance !== 'unknown' && result.clinicalSignificance !== 'benign' ? 0.85 : 0.6,
        evidenceLevel: 'cohort' as const,
        date: NOW,
        rawData: JSON.stringify({
          rsid: result.target.rsid,
          gene: result.target.gene,
          genotype: result.genotype,
          category: result.target.category,
          clinicalSignificance: result.clinicalSignificance,
          myvariantDataLength: result.myvariantData.length,
          geneDataLength: result.geneData.length,
          literatureDataLength: result.literatureData.length,
          dgidbDataLength: result.dgidbData.length,
        }),
        evidenceTier: 'T1-official' as const,
        validationStatus: 'unvalidated' as const,
        sourceCredibility: 85,
      };

      const storeResult = await store.addResearchFinding(finding);
      if (storeResult.duplicate) {
        duplicates++;
        verbose(`Duplicate: ${result.target.rsid}`);
      } else {
        inserted++;
        verbose(`Stored: ${result.target.rsid} → ${storeResult.id}`);
      }
    }

    log(`  Inserted: ${inserted}, Duplicates: ${duplicates}`);
    log('');
  } else {
    log('──── Step 5: SKIPPED (dry run) ────');
    log('');
  }

  // ─── Summary ──────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('═══════════════════════════════════════════════════════════════');
  log(`  Complete in ${elapsed}s`);
  log(`  Variants researched: ${researchResults.length}/${presentVariants.length}`);
  log(`  MCP queries made: ~${researchResults.length * 4}`);
  if (!DRY_RUN) {
    log('  Findings stored to clinical database');
  }
  log('═══════════════════════════════════════════════════════════════');

  // Disconnect MCP
  const { disconnectBiomedicalMcp } = await import('../src/clients/biomedical-mcp.js');
  await disconnectBiomedicalMcp();

  process.exit(0);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildLiteratureQuery(target: SnpTarget): string {
  switch (target.category) {
    case 'pain-sensitivity':
      return `${target.gene} ${target.rsid} pain sensitivity neuropathy`;
    case 'methylation':
      return `${target.gene} ${target.rsid} homocysteine methylation neuropathy`;
    case 'pharmacogenomic':
      return `${target.gene} ${target.rsid} pharmacogenomics drug metabolism`;
    case 'autoimmune':
      return `${target.gene} ${target.rsid} autoimmune susceptibility`;
    case 'connective-tissue':
      return `${target.gene} ${target.rsid} Ehlers-Danlos collagen`;
    default:
      return `${target.gene} ${target.rsid}`;
  }
}

function extractClinicalSignificance(myvariantData: string): string {
  if (!myvariantData) return 'unknown';
  const lower = myvariantData.toLowerCase();

  // Check for ClinVar-style significance terms
  if (lower.includes('pathogenic') && !lower.includes('likely_benign') && !lower.includes('benign')) {
    if (lower.includes('likely_pathogenic') || lower.includes('likely pathogenic')) return 'likely-pathogenic';
    return 'pathogenic';
  }
  if (lower.includes('likely_pathogenic') || lower.includes('likely pathogenic')) return 'likely-pathogenic';
  if (lower.includes('drug_response') || lower.includes('drug response')) return 'drug-response';
  if (lower.includes('risk_factor') || lower.includes('risk factor')) return 'risk-factor';
  if (lower.includes('association') || lower.includes('affects')) return 'association';
  if (lower.includes('likely_benign') || lower.includes('likely benign')) return 'likely-benign';
  if (lower.includes('benign') && !lower.includes('likely')) return 'benign';
  if (lower.includes('uncertain_significance') || lower.includes('uncertain significance')) return 'uncertain';

  return 'unknown';
}

function buildVariantSummary(
  target: SnpTarget,
  genotype: string,
  myvariantData: string,
  geneData: string,
  clinicalSignificance: string,
): string {
  const parts: string[] = [];
  parts.push(`${target.gene} ${target.rsid}: genotype ${genotype}.`);
  parts.push(target.significance + '.');

  if (clinicalSignificance !== 'unknown') {
    parts.push(`Clinical significance: ${clinicalSignificance}.`);
  }

  // Extract allele frequency if available
  const afMatch = myvariantData.match(/allele.{0,20}frequency[^:]*:\s*([\d.]+)/i);
  if (afMatch?.[1]) {
    parts.push(`Global allele frequency: ${afMatch[1]}.`);
  }

  // Extract gene summary if available
  const summaryMatch = geneData.match(/summary['"]*:\s*['"]([^'"]{20,200})/i);
  if (summaryMatch?.[1]) {
    parts.push(`Gene function: ${summaryMatch[1]}.`);
  }

  return parts.join(' ');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
