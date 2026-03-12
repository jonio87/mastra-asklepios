#!/usr/bin/env npx tsx
/**
 * Deep Genome Research — Hypothesis-Driven Variant Analysis
 *
 * Maps the patient's 23andMe genotypes to the clinical hypotheses
 * from the diagnostic-therapeutic plan. Each SNP is annotated with
 * BioThings (ClinVar, gnomAD, CADD) and linked to specific clinical questions.
 *
 * Usage:
 *   npx tsx scripts/deep-genome-research.ts [--dry-run] [--verbose]
 */
import type { Tool } from '@mastra/core/tools';
import { getClinicalStore } from '../src/storage/clinical-store.js';
import { getBiomedicalTools } from '../src/clients/biomedical-mcp.js';

const PATIENT_ID = 'patient-tomasz-szychlinski';
const NOW = new Date().toISOString();

// ─── Hypothesis-Driven SNP Targets ─────────────────────────────────────────
//
// Each SNP is linked to specific clinical questions from the diagnostic plan:
//
// H1: CVJ-Driven Multi-Node Pain Network (STRONG, 45-65%)
// H2: Cervical Myelopathy (MODERATE, 30-45%)
// H3: Central Sensitization / Nociplastic Pain (STRONG, 50-65%)
// H4: Autoimmune (Sjögren/GPA/Behçet) (WEAK, 5-15%)
// H5: Developmental/Connective Tissue Phenotype (MODERATE, 20-30%)
// H6: Airway-Bruxism-Cervical Feedback Loop (MODERATE, 10-20%)
//
// Open Questions:
// Q1: Is the CVJ anomaly still actively compressing the cord?
// Q2: Why does LDN work and is the dose optimal?
// Q3: Are lab abnormalities drug-related or autoimmune?
// Q4: Did homocysteine cause lasting nerve damage?
// Q5: What explains 42+ treatment failures?
// Q6: Is there an underlying connective tissue disorder?

interface DeepSnpTarget {
  rsid: string;
  gene: string;
  significance: string;
  hypotheses: string[];   // Which hypotheses this SNP informs
  clinicalQuestion: string; // The specific clinical question it helps answer
  category: string;
}

const DEEP_TARGETS: DeepSnpTarget[] = [
  // ═══ PAIN SENSITIVITY & CENTRAL SENSITIZATION (H1, H3) ═══

  // DRD2 — dopamine receptor, reward circuitry, pain modulation
  { rsid: 'rs1800497', gene: 'DRD2/ANKK1', significance: 'Taq1A — dopamine receptor density, reward/pain modulation. T allele = fewer D2 receptors → altered pain processing, reduced opioid reward response',
    hypotheses: ['H3', 'H1'], clinicalQuestion: 'Q2: Does DRD2 genotype explain LDN response mechanism? LDN modulates opioid-dopamine crosstalk; fewer D2 receptors could alter naltrexone pharmacodynamics', category: 'pain-neuromodulation' },

  // OPRM1 — mu-opioid receptor, THE direct target of naltrexone/LDN
  { rsid: 'rs1799971', gene: 'OPRM1', significance: 'A118G — mu-opioid receptor binding affinity. G allele = altered beta-endorphin binding → changed LDN/naltrexone response',
    hypotheses: ['H3'], clinicalQuestion: 'Q2: OPRM1 is THE receptor LDN blocks to trigger endorphin rebound. Genotype determines optimal LDN dosing and mechanism of action', category: 'pain-neuromodulation' },

  // HTR2A — serotonin 2A receptor, central sensitization, SNRI response
  { rsid: 'rs6311', gene: 'HTR2A', significance: '-1438A/G — serotonin 2A receptor promoter. Affects receptor density, migraine susceptibility, SNRI/SSRI response',
    hypotheses: ['H3', 'H1'], clinicalQuestion: 'Q5: HTR2A genotype may explain duloxetine (SNRI) failure and why serotonergic treatments failed', category: 'pain-neuromodulation' },

  { rsid: 'rs6313', gene: 'HTR2A', significance: 'T102C — serotonin 2A receptor coding variant. Associated with chronic pain conditions, treatment-resistant depression, headache',
    hypotheses: ['H3'], clinicalQuestion: 'Q5: Second HTR2A variant — combined with rs6311, defines serotonergic pain modulation capacity', category: 'pain-neuromodulation' },

  // BDNF — brain-derived neurotrophic factor, neuroplasticity, central sensitization
  { rsid: 'rs6265', gene: 'BDNF', significance: 'Val66Met — BDNF secretion. Met allele = impaired activity-dependent BDNF release → reduced neuroplasticity, altered pain memory',
    hypotheses: ['H3', 'H1'], clinicalQuestion: 'Q1: BDNF drives neuroplastic changes in central sensitization. Val66Met determines capacity for pain circuit remodeling after GON block', category: 'pain-neuromodulation' },

  // MC1R — melanocortin 1 receptor, pain sensitivity
  { rsid: 'rs1805007', gene: 'MC1R', significance: 'R151C — redhead-associated variant. Altered pain threshold, anesthetic requirements, kappa-opioid sensitivity',
    hypotheses: ['H3'], clinicalQuestion: 'Q5: MC1R variants increase pain sensitivity and alter opioid pharmacology — may explain heightened pain response and treatment resistance', category: 'pain-neuromodulation' },

  // ═══ NEUROINFLAMMATION & GLIAL ACTIVATION (H3 — LDN mechanism) ═══

  // TNF-alpha — master neuroinflammatory cytokine, glial activation
  { rsid: 'rs1800629', gene: 'TNF', significance: '-308G/A — TNF-alpha promoter. A allele = higher TNF-alpha production → more neuroinflammation, glial activation',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q2: LDN suppresses glial activation via TLR4. High TNF-alpha genotype → more glial activation → potentially stronger LDN response', category: 'neuroinflammation' },

  { rsid: 'rs361525', gene: 'TNF', significance: '-238G/A — TNF-alpha promoter variant. Modulates TNF production alongside -308',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q2: Second TNF promoter variant — combined haplotype determines baseline neuroinflammatory state', category: 'neuroinflammation' },

  // IL-6 — proinflammatory, central sensitization driver
  { rsid: 'rs1800795', gene: 'IL6', significance: '-174G/C — IL-6 promoter. C allele = altered IL-6 production → affects central sensitization, pain chronification',
    hypotheses: ['H3'], clinicalQuestion: 'Q1: IL-6 drives wind-up phenomenon in central sensitization. Genotype affects ketamine response prediction', category: 'neuroinflammation' },

  // IL-1β — neuroinflammatory cascade
  { rsid: 'rs1143634', gene: 'IL1B', significance: '+3954C/T — IL-1β production. T allele = higher IL-1β → enhanced neuroinflammatory cascade',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q3: IL-1β connects neuroinflammation (H3) with autoimmune concern (H4). High producer genotype → dual mechanism', category: 'neuroinflammation' },

  // IL-10 — anti-inflammatory, counterbalances neuroinflammation
  { rsid: 'rs1800896', gene: 'IL10', significance: '-1082A/G — IL-10 promoter. G allele = higher IL-10 → more anti-inflammatory capacity',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q3: Low IL-10 production genotype → impaired anti-inflammatory response → contributes to both central sensitization AND autoimmune tendency', category: 'neuroinflammation' },

  { rsid: 'rs1800871', gene: 'IL10', significance: '-819C/T — IL-10 promoter. Part of the IL-10 haplotype determining anti-inflammatory capacity',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q3: Second IL-10 promoter variant. Combined with rs1800896 defines IL-10 haplotype', category: 'neuroinflammation' },

  { rsid: 'rs1800872', gene: 'IL10', significance: '-592C/A — IL-10 promoter. Third promoter variant completing the IL-10 haplotype',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q3: Third IL-10 promoter SNP. Complete haplotype (rs1800896/rs1800871/rs1800872) determines anti-inflammatory capacity', category: 'neuroinflammation' },

  // ═══ AUTOIMMUNE SUSCEPTIBILITY (H4) ═══

  // HLA region — autoimmune disease susceptibility
  { rsid: 'rs3135388', gene: 'HLA-DRB1', significance: 'Tag SNP for HLA-DRB1*15:01 — multiple sclerosis, autoimmune susceptibility. A allele = carrier',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: HLA-DRB1*15:01 is associated with MS, Sjögren syndrome, and other autoimmune conditions. Does this explain intermittent autoimmune markers?', category: 'autoimmune' },

  { rsid: 'rs2187668', gene: 'HLA-DQ2', significance: 'Tag SNP for HLA-DQ2.5 — celiac, T1D, autoimmune susceptibility',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: HLA-DQ2 carrier status — relevant to autoimmune predisposition and celiac screening', category: 'autoimmune' },

  { rsid: 'rs7454108', gene: 'HLA-DQ8', significance: 'Tag SNP for HLA-DQ8 — celiac, T1D, autoimmune susceptibility',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: HLA-DQ8 carrier status — combined with DQ2 determines autoimmune HLA profile', category: 'autoimmune' },

  // STAT4 — autoimmune susceptibility (SLE, Sjögren, RA)
  { rsid: 'rs7574865', gene: 'STAT4', significance: 'T allele = increased SLE risk (OR~1.5), Sjögren syndrome, RA susceptibility',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: STAT4 is a major SLE/Sjögren susceptibility locus. T allele strongly associated with Anti-Ro-60 positive Sjögren syndrome — relevant to the Anti-Ro-60 platform discrepancy', category: 'autoimmune' },

  // IRF5 — interferon regulatory factor 5, SLE/Sjögren
  { rsid: 'rs10488631', gene: 'IRF5', significance: 'T allele = increased SLE/Sjögren risk. IRF5 drives type I interferon response',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: IRF5 risk allele → enhanced interferon signaling → SLE/Sjögren susceptibility. Important for interpreting Anti-Ro-60 results', category: 'autoimmune' },

  // CTLA4 — immune checkpoint, T-cell regulation
  { rsid: 'rs3087243', gene: 'CTLA4', significance: '+49A/G — CTLA4 (immune checkpoint). G allele = reduced T-cell inhibition → autoimmune predisposition',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: CTLA4 is a master immune checkpoint. Reduced function → impaired T-cell self-tolerance → autoimmune tendency + potentially explains progressive leukopenia', category: 'autoimmune' },

  // FCGR3A — Fc receptor, immune complex clearance
  { rsid: 'rs3093662', gene: 'FCGR3A', significance: 'V158F — Fc receptor variant. Affects immune complex clearance, ANCA-associated vasculitis risk',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: FCGR3A genotype affects ANCA-associated vasculitis risk and immune complex clearance — directly relevant to PR3-ANCA intermittent positivity', category: 'autoimmune' },

  // TRAF1 — TNF receptor-associated factor, RA/autoimmune
  { rsid: 'rs3761847', gene: 'TRAF1/C5', significance: 'TRAF1-C5 region — autoimmune arthritis susceptibility',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: TRAF1 variant — autoimmune susceptibility locus relevant to systemic inflammatory phenotype', category: 'autoimmune' },

  // ═══ IMMUNE REGULATION / LEUKOPENIA (H4 — specific to WBC decline) ═══

  // IL-2 — T-cell growth factor, lymphocyte homeostasis
  { rsid: 'rs2069762', gene: 'IL2', significance: '-330T/G — IL-2 promoter. Affects T-cell proliferation and lymphocyte homeostasis',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: IL-2 is the master T-cell growth factor. Low producer genotype → impaired lymphocyte proliferation → could explain progressive leukopenia (WBC 3.5→2.59)', category: 'immune-regulation' },

  { rsid: 'rs2069763', gene: 'IL2', significance: '+166G/T — IL-2 coding region. Modulates IL-2 production alongside promoter variant',
    hypotheses: ['H4'], clinicalQuestion: 'Q3: Second IL-2 variant. Combined with rs2069762 determines IL-2 output — directly relevant to progressive leukopenia mechanism', category: 'immune-regulation' },

  // SLC6A4 — serotonin transporter, immune modulation
  { rsid: 'rs25532', gene: 'SLC6A4', significance: '5-HTTLPR proxy — serotonin transporter. Affects serotonin reuptake, immune regulation, pain processing',
    hypotheses: ['H3', 'H4'], clinicalQuestion: 'Q5: SLC6A4 genotype affects both SSRI/SNRI response (treatment failures) and serotonin-mediated immune regulation', category: 'immune-regulation' },
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

// ─── Clinical significance extraction ────────────────────────────────────────

function extractClinicalSignificance(myvariantData: string): string {
  if (!myvariantData) return 'unknown';
  try {
    const data = JSON.parse(myvariantData);
    // Direct ClinVar significance
    if (data.clinvar?.clinical_significance) return data.clinvar.clinical_significance;
    // Nested format
    if (data.clinvar?.rcv_accession) {
      const rcv = Array.isArray(data.clinvar.rcv_accession)
        ? data.clinvar.rcv_accession[0]
        : data.clinvar.rcv_accession;
      if (rcv?.clinical_significance) return rcv.clinical_significance;
    }
    // CADD score as fallback indicator
    if (data.cadd?.phred) {
      const score = Number(data.cadd.phred);
      if (score >= 20) return `CADD=${score.toFixed(1)} (likely deleterious)`;
      if (score >= 15) return `CADD=${score.toFixed(1)} (possibly deleterious)`;
    }
  } catch {
    // Try regex fallback
    const match = myvariantData.match(/"clinical_significance"\s*:\s*"([^"]+)"/);
    if (match?.[1]) return match[1];
  }
  return 'unknown';
}

function extractCaddScore(myvariantData: string): number | undefined {
  if (!myvariantData) return undefined;
  try {
    const data = JSON.parse(myvariantData);
    if (data.cadd?.phred) return Number(data.cadd.phred);
  } catch {
    const match = myvariantData.match(/"phred"\s*:\s*(\d+\.?\d*)/);
    if (match?.[1]) return Number(match[1]);
  }
  return undefined;
}

function extractGnomadFreq(myvariantData: string): string | undefined {
  if (!myvariantData) return undefined;
  try {
    const data = JSON.parse(myvariantData);
    const af = data.gnomad_genome?.af?.af ?? data.gnomad_exome?.af?.af;
    if (af !== undefined) return `${(Number(af) * 100).toFixed(2)}%`;
  } catch { /* ignore */ }
  return undefined;
}

// ─── Literature query builder ────────────────────────────────────────────────

function buildLiteratureQuery(target: DeepSnpTarget): string {
  const gene = target.gene.split('/')[0]; // Handle DRD2/ANKK1 → DRD2
  // Build hypothesis-relevant query
  if (target.category === 'pain-neuromodulation') {
    return `${gene} ${target.rsid} chronic pain central sensitization`;
  }
  if (target.category === 'neuroinflammation') {
    return `${gene} ${target.rsid} neuroinflammation glial activation pain`;
  }
  if (target.category === 'autoimmune') {
    return `${gene} ${target.rsid} autoimmune susceptibility vasculitis`;
  }
  if (target.category === 'immune-regulation') {
    return `${gene} ${target.rsid} leukopenia lymphocyte`;
  }
  return `${gene} ${target.rsid} clinical significance`;
}

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildVariantSummary(
  target: DeepSnpTarget,
  genotype: string,
  clinicalSig: string,
  caddScore: number | undefined,
  gnomadFreq: string | undefined,
): string {
  const parts = [
    `${target.gene} ${target.rsid}: genotype ${genotype}.`,
    target.significance.split('.')[0] + '.',
  ];
  if (clinicalSig && clinicalSig !== 'unknown') {
    parts.push(`Clinical significance: ${clinicalSig}.`);
  }
  if (caddScore !== undefined) {
    parts.push(`CADD phred: ${caddScore.toFixed(1)}.`);
  }
  if (gnomadFreq) {
    parts.push(`Population frequency: ${gnomadFreq}.`);
  }
  parts.push(`Hypothesis relevance: ${target.hypotheses.join(', ')}. ${target.clinicalQuestion}`);
  return parts.join(' ');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  log('╔══════════════════════════════════════════════════════════════════╗');
  log('║  Deep Genome Research — Hypothesis-Driven Variant Analysis      ║');
  log('║  Patient: Tomasz Szychliński                                    ║');
  log('╚══════════════════════════════════════════════════════════════════╝');
  log(`  Targets: ${DEEP_TARGETS.length} hypothesis-linked SNPs`);
  log(`  Mode: ${DRY_RUN ? 'DRY RUN (no database writes)' : 'LIVE (will store findings)'}`);
  log('');

  const store = getClinicalStore();
  const startTime = Date.now();

  // ─── Step 1: Query patient genotypes ──────────────────────────────
  log('━━━━ Step 1: Querying patient genotypes from 23andMe data ━━━━');

  const rsids = DEEP_TARGETS.map((t) => t.rsid);
  const variants = await store.queryGeneticVariants({
    patientId: PATIENT_ID,
    rsids,
    limit: rsids.length,
  });

  const genotypeMap = new Map<string, { genotype: string; chromosome: string; position: number }>();
  for (const v of variants) {
    genotypeMap.set(v.rsid, { genotype: v.genotype, chromosome: v.chromosome, position: v.position });
  }

  // Organize by hypothesis
  const hypothesisMap = new Map<string, DeepSnpTarget[]>();
  for (const t of DEEP_TARGETS) {
    for (const h of t.hypotheses) {
      const list = hypothesisMap.get(h) ?? [];
      list.push(t);
      hypothesisMap.set(h, list);
    }
  }

  log(`  Found ${variants.length}/${DEEP_TARGETS.length} target SNPs in patient genome`);
  log('');

  // Report by hypothesis
  const hypothesisNames: Record<string, string> = {
    'H1': 'CVJ-Driven Multi-Node Pain Network',
    'H2': 'Cervical Myelopathy',
    'H3': 'Central Sensitization / Nociplastic Pain',
    'H4': 'Autoimmune (Sjögren/GPA/Behçet)',
    'H5': 'Developmental/Connective Tissue Phenotype',
    'H6': 'Airway-Bruxism-Cervical Feedback Loop',
  };

  for (const [hyp, targets] of hypothesisMap) {
    const name = hypothesisNames[hyp] ?? hyp;
    log(`  ── ${hyp}: ${name} ──`);
    for (const t of targets) {
      const v = genotypeMap.get(t.rsid);
      const status = v ? (v.genotype === '--' ? '⚠ no-call' : `✓ ${v.genotype}`) : '✗ not in genome';
      log(`    ${t.rsid} (${t.gene}): ${status}`);
    }
    log('');
  }

  // ─── Step 2: Connect to MCP tools ─────────────────────────────────
  log('━━━━ Step 2: Connecting to biomedical MCP servers ━━━━');

  const tools = await getBiomedicalTools();
  const toolCount = Object.keys(tools).length;
  log(`  Connected: ${toolCount} tools available`);

  const getVariantTool = findMcpTool(tools, 'biothings_biothings_get_variant');
  const queryVariantsTool = findMcpTool(tools, 'biothings_biothings_query_variants');
  const getGeneTool = findMcpTool(tools, 'biothings_biothings_get_gene');
  const europePmcTool = findMcpTool(tools, 'biocontext_bc_get_europepmc_articles');
  const biomcpShell = findMcpTool(tools, 'biomcp_shell');
  const openTargetsTool = findMcpTool(tools, 'opentargets_search_entities');

  log(`  BioThings variant:  ${getVariantTool ? '✓' : '✗'}`);
  log(`  BioThings gene:     ${getGeneTool ? '✓' : '✗'}`);
  log(`  Europe PMC:         ${europePmcTool ? '✓' : '✗'}`);
  log(`  BioMCP shell:       ${biomcpShell ? '✓' : '✗'}`);
  log(`  Open Targets:       ${openTargetsTool ? '✓' : '✗'}`);
  log('');

  // ─── Step 3: Research each variant ─────────────────────────────────
  log('━━━━ Step 3: Deep variant annotation via MCP tools ━━━━');

  interface DeepResearchResult {
    target: DeepSnpTarget;
    genotype: string;
    chromosome: string;
    position: number;
    myvariantData: string;
    geneData: string;
    literatureData: string;
    clinicalSignificance: string;
    caddScore: number | undefined;
    gnomadFreq: string | undefined;
    summary: string;
  }

  const results: DeepResearchResult[] = [];

  const presentTargets = DEEP_TARGETS.filter((t) => {
    const v = genotypeMap.get(t.rsid);
    return v && v.genotype !== '--';
  });

  log(`  Researching ${presentTargets.length} variants with callable genotypes...`);
  log('');

  let queryCount = 0;

  for (const target of presentTargets) {
    const v = genotypeMap.get(target.rsid);
    if (!v) continue;
    const { genotype, chromosome, position } = v;
    log(`  ── ${target.rsid} (${target.gene}) — ${genotype} — chr${chromosome}:${position} ──`);

    // 3a: BioThings variant annotation
    let myvariantData = '';
    if (getVariantTool) {
      verbose(`BioThings get_variant: ${target.rsid}`);
      myvariantData = await executeMcpTool(getVariantTool, { variant_id: target.rsid });
      queryCount++;
      if (!myvariantData && queryVariantsTool) {
        myvariantData = await executeMcpTool(queryVariantsTool, { query: target.rsid, fields: 'clinvar,cadd,gnomad_genome,dbsnp' });
        queryCount++;
      }
      if (myvariantData) {
        verbose(`Variant annotation: ${myvariantData.substring(0, 200)}...`);
      }
    }

    // 3b: Gene context
    let geneData = '';
    if (getGeneTool) {
      const geneName = target.gene.split('/')[0]; // Handle DRD2/ANKK1
      verbose(`BioThings get_gene: ${geneName}`);
      geneData = await executeMcpTool(getGeneTool, { gene_id: geneName });
      queryCount++;
    }

    // 3c: Literature — hypothesis-targeted queries
    let literatureData = '';
    if (europePmcTool) {
      const litQuery = buildLiteratureQuery(target);
      verbose(`Europe PMC: "${litQuery}"`);
      literatureData = await executeMcpTool(europePmcTool, { query: litQuery });
      queryCount++;
    }

    // Extract annotations
    const clinicalSignificance = extractClinicalSignificance(myvariantData);
    const caddScore = extractCaddScore(myvariantData);
    const gnomadFreq = extractGnomadFreq(myvariantData);
    const summary = buildVariantSummary(target, genotype, clinicalSignificance, caddScore, gnomadFreq);

    results.push({
      target,
      genotype,
      chromosome,
      position,
      myvariantData,
      geneData,
      literatureData,
      clinicalSignificance,
      caddScore,
      gnomadFreq,
      summary,
    });

    log(`    Significance: ${clinicalSignificance}`);
    if (caddScore !== undefined) log(`    CADD phred: ${caddScore.toFixed(1)}`);
    if (gnomadFreq) log(`    gnomAD freq: ${gnomadFreq}`);
    log(`    Hypotheses: ${target.hypotheses.join(', ')}`);
    log('');
  }

  // ─── Step 4: Hypothesis-driven synthesis ────────────────────────────
  log('━━━━ Step 4: Hypothesis-Driven Synthesis ━━━━');
  log('');

  // Group results by hypothesis
  for (const [hyp, hypName] of Object.entries(hypothesisNames)) {
    const hypResults = results.filter((r) => r.target.hypotheses.includes(hyp));
    if (hypResults.length === 0) continue;

    log(`  ═══ ${hyp}: ${hypName} ═══`);
    const actionable = hypResults.filter(
      (r) => r.clinicalSignificance !== 'unknown' && r.clinicalSignificance !== 'benign',
    );
    log(`  Variants informing this hypothesis: ${hypResults.length} (${actionable.length} with clinical significance)`);

    for (const r of hypResults) {
      const sigIcon = r.clinicalSignificance !== 'unknown' && r.clinicalSignificance !== 'benign' ? '⚡' : '○';
      log(`  ${sigIcon} ${r.target.rsid} (${r.target.gene}): ${r.genotype} — ${r.clinicalSignificance}`);
      log(`    → ${r.target.clinicalQuestion}`);
    }
    log('');
  }

  // ─── Step 5: Clinical questions answered ─────────────────────────────
  log('━━━━ Step 5: Clinical Questions Addressed ━━━━');
  log('');

  const questionResults = new Map<string, DeepResearchResult[]>();
  for (const r of results) {
    const qMatch = r.target.clinicalQuestion.match(/^(Q\d+):/);
    if (qMatch?.[1]) {
      const list = questionResults.get(qMatch[1]) ?? [];
      list.push(r);
      questionResults.set(qMatch[1], list);
    }
  }

  const questionDescriptions: Record<string, string> = {
    'Q1': 'Is the CVJ anomaly still actively compressing?',
    'Q2': 'Why does LDN work and is the dose optimal?',
    'Q3': 'Are lab abnormalities drug-related or autoimmune?',
    'Q4': 'Did homocysteine cause lasting nerve damage?',
    'Q5': 'What explains 42+ treatment failures?',
    'Q6': 'Is there an underlying connective tissue disorder?',
  };

  for (const [q, desc] of Object.entries(questionDescriptions)) {
    const qResults = questionResults.get(q) ?? [];
    if (qResults.length === 0) continue;
    log(`  ${q}: ${desc}`);
    log(`  Genome evidence: ${qResults.length} variants`);
    for (const r of qResults) {
      log(`    ${r.target.rsid} (${r.target.gene}): ${r.genotype} — ${r.clinicalSignificance}`);
    }
    log('');
  }

  // ─── Step 6: Store findings ──────────────────────────────────────
  log('━━━━ Step 6: Storing research findings ━━━━');

  if (DRY_RUN) {
    log(`  DRY RUN — would store ${results.length} findings`);
  } else {
    let inserted = 0;
    let duplicates = 0;

    for (const result of results) {
      const finding = {
        id: `finding-deep-genome-${result.target.rsid}-${Date.now()}`,
        patientId: PATIENT_ID,
        source: 'Deep Genome Research',
        sourceTool: 'deep-genome-research',
        externalId: result.target.rsid,
        externalIdType: 'variant' as const,
        title: `${result.target.gene} ${result.target.rsid} — Genotype: ${result.genotype} [${result.target.hypotheses.join(',')}]`,
        summary: result.summary,
        url: `https://www.ncbi.nlm.nih.gov/snp/${result.target.rsid}`,
        relevance: result.clinicalSignificance !== 'unknown' && result.clinicalSignificance !== 'benign' ? 0.9 : 0.7,
        evidenceLevel: 'cohort' as const,
        date: NOW,
        rawData: JSON.stringify({
          rsid: result.target.rsid,
          gene: result.target.gene,
          genotype: result.genotype,
          chromosome: result.chromosome,
          position: result.position,
          category: result.target.category,
          hypotheses: result.target.hypotheses,
          clinicalQuestion: result.target.clinicalQuestion,
          clinicalSignificance: result.clinicalSignificance,
          caddScore: result.caddScore,
          gnomadFreq: result.gnomadFreq,
          myvariantDataLength: result.myvariantData.length,
          geneDataLength: result.geneData.length,
          literatureDataLength: result.literatureData.length,
        }),
        evidenceTier: 'T1-official' as const,
        validationStatus: 'unvalidated' as const,
        sourceCredibility: 90,
      };

      const storeResult = await store.addResearchFinding(finding);
      if (storeResult.duplicate) {
        duplicates++;
      } else {
        inserted++;
      }
    }

    log(`  Inserted: ${inserted} new findings`);
    log(`  Duplicates: ${duplicates} (already in database)`);
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log('');
  log('╔══════════════════════════════════════════════════════════════════╗');
  log('║  DEEP GENOME RESEARCH COMPLETE                                  ║');
  log('╠══════════════════════════════════════════════════════════════════╣');
  log(`║  Variants researched:    ${results.length.toString().padStart(4)}                                  ║`);
  log(`║  MCP queries executed:   ${queryCount.toString().padStart(4)}                                  ║`);
  log(`║  Time elapsed:        ${elapsed.padStart(7)}s                                ║`);
  log('╚══════════════════════════════════════════════════════════════════╝');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
