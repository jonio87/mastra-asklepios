/**
 * Ingest Adversarial Agent Findings into Database
 *
 * Parses v2 adversarial agent reports (advocate, skeptic, unbiased)
 * and persists key findings, cited PMIDs, and agent positions
 * to research_findings and research_hypotheses tables.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ClinicalStore } from '../src/storage/clinical-store.js';
import type { ResearchFinding } from '../src/schemas/research-record.js';
import type { ResearchHypothesis } from '../src/schemas/research-record.js';

const PATIENT_ID = 'patient-tomasz-szychlinski';
const NOW = new Date().toISOString();

// ─── Helpers ──────────────────────────────────────────────────────────────

function readResearchFile(filename: string): string {
  return readFileSync(`research/${filename}`, 'utf-8');
}

function extractPMIDs(text: string): string[] {
  const pmidPattern = /PMID[:\s]*(\d{7,8})/gi;
  const pmids = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pmidPattern.exec(text)) !== null) {
    if (match[1]) pmids.add(match[1]);
  }
  return Array.from(pmids);
}

function extractPMCIDs(text: string): string[] {
  const pmcPattern = /PMC(\d{5,8})/gi;
  const pmcIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pmcPattern.exec(text)) !== null) {
    if (match[1]) pmcIds.add(`PMC${match[1]}`);
  }
  return Array.from(pmcIds);
}

function extractNCTIDs(text: string): string[] {
  const nctPattern = /NCT\d{8}/g;
  const nctIds = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = nctPattern.exec(text)) !== null) {
    nctIds.add(match[0]);
  }
  return Array.from(nctIds);
}

// ─── Finding Builders ────────────────────────────────────────────────────

function buildPmidFinding(pmid: string, agent: string): ResearchFinding {
  return {
    id: randomUUID(),
    patientId: PATIENT_ID,
    source: 'Parallel.ai',
    sourceTool: `adversarial-${agent}`,
    externalId: pmid,
    externalIdType: 'pmid',
    title: `PMID ${pmid} — cited by ${agent} agent`,
    summary: `Literature reference cited in adversarial ${agent} analysis of Tomasz case`,
    relevance: 0.7,
    evidenceLevel: 'unknown',
    date: NOW,
    evidenceTier: 'T3-ai-inferred',
    validationStatus: 'unvalidated',
    sourceCredibility: 60,
  };
}

function buildPmcFinding(pmcId: string, agent: string): ResearchFinding {
  return {
    id: randomUUID(),
    patientId: PATIENT_ID,
    source: 'Parallel.ai',
    sourceTool: `adversarial-${agent}`,
    externalId: pmcId,
    externalIdType: 'pmid',
    title: `${pmcId} — cited by ${agent} agent`,
    summary: `Literature reference cited in adversarial ${agent} analysis of Tomasz case`,
    relevance: 0.7,
    evidenceLevel: 'unknown',
    date: NOW,
    evidenceTier: 'T3-ai-inferred',
    validationStatus: 'unvalidated',
    sourceCredibility: 60,
  };
}

function buildNctFinding(nctId: string, agent: string): ResearchFinding {
  return {
    id: randomUUID(),
    patientId: PATIENT_ID,
    source: 'Parallel.ai',
    sourceTool: `adversarial-${agent}`,
    externalId: nctId,
    externalIdType: 'nct',
    title: `${nctId} — cited by ${agent} agent`,
    summary: `Clinical trial referenced in adversarial ${agent} analysis of Tomasz case`,
    relevance: 0.8,
    evidenceLevel: 'unknown',
    date: NOW,
    evidenceTier: 'T3-ai-inferred',
    validationStatus: 'unvalidated',
    sourceCredibility: 60,
  };
}

// ─── Agent-Specific Findings ─────────────────────────────────────────────

function buildAgentFindings(agent: string, summary: string): ResearchFinding {
  return {
    id: randomUUID(),
    patientId: PATIENT_ID,
    source: 'Parallel.ai',
    sourceTool: `adversarial-${agent}`,
    title: `Adversarial ${agent} analysis — Tomasz case`,
    summary,
    relevance: 0.9,
    evidenceLevel: 'expert-opinion',
    date: NOW,
    evidenceTier: 'T3-ai-inferred',
    validationStatus: 'unvalidated',
    sourceCredibility: 70,
  };
}

// ─── Hypothesis Updates ─────────────────────────────────────────────────

interface HypothesisData {
  name: string;
  icdCode?: string;
  probabilityLow: number;
  probabilityHigh: number;
  certaintyLevel: 'ESTABLISHED' | 'STRONG' | 'MODERATE' | 'WEAK' | 'SPECULATIVE';
  advocateCase: string;
  skepticCase: string;
  arbiterVerdict: string;
}

const HYPOTHESES: HypothesisData[] = [
  {
    name: 'CVJ-Driven Multi-Node Pain Network (H1)',
    icdCode: 'Q76.1',
    probabilityLow: 45,
    probabilityHigh: 65,
    certaintyLevel: 'STRONG',
    advocateCase:
      'CVJ anomaly confirmed on 6 imaging studies. GON block 100% response. Pain migration C2→V1/V2 = TCC convergence. COMT expression 56.2 TPM at C-1 spinal cord. 5 CVJ-facial pain case reports with surgical cure.',
    skepticCase:
      'CVJ anomalies present in 0.64% of population, typically asymptomatic. SPECT/CT cold = no active bone pathology. Pain migration could be central sensitization reorganization, not structural proof. 40% SPG response falls within sham response range (Cady 2015).',
    arbiterVerdict:
      'CVJ as initiator is probable given clinical trajectory. Dynamic MRI is the single highest-yield test — positive result raises H1 to 70-80%, negative shifts focus to H3 central management. Both agents agree on dynamic MRI priority.',
  },
  {
    name: 'Central Sensitization / Nociplastic Pain (H3)',
    probabilityLow: 50,
    probabilityHigh: 65,
    certaintyLevel: 'STRONG',
    advocateCase:
      '5/5 sensitization markers. 42+ treatment failures. LDN response (glial modulation). 4/4 CGRP mAbs failed (excludes migraine). TRPM3 restoration mechanism (PMID 40458265).',
    skepticCase:
      'Central sensitization is a mechanism, not a diagnosis — almost all chronic pain patients have it. Doesn\'t explain progressive leukopenia or autoimmune markers. "Nociplastic" risks becoming a waste-basket label.',
    arbiterVerdict:
      'H3 is almost certainly present as a co-mechanism with H1. Not competing — synergistic. LDN optimization to 4.5mg is consensus treatment regardless of other hypotheses.',
  },
  {
    name: 'Cervical Myelopathy (H2)',
    icdCode: 'M47.0',
    probabilityLow: 30,
    probabilityHigh: 45,
    certaintyLevel: 'MODERATE',
    advocateCase:
      'EMG: normal motor + progressive weakness = central weakness. MRI 2019: mild cord compression. Disc disease progressive 2012→2019. Th6/7 disc adds second compression point.',
    skepticCase:
      'No UMN signs documented (Babinski, Hoffman, hyperreflexia). Static MRI shows only mild compression. Weakness could be deconditioning/central fatigue from chronic pain.',
    arbiterVerdict:
      'Dynamic MRI will clarify. If motion-dependent compression shown, myelopathy rises to 50-60%. Structured neuro exam documenting UMN signs is critical parallel step.',
  },
  {
    name: 'Developmental/Connective Tissue Phenotype (H5)',
    probabilityLow: 20,
    probabilityHigh: 30,
    certaintyLevel: 'MODERATE',
    advocateCase:
      'Multiple developmental variants (C1 assimilation, platybasia, duplicated renal arteries, 6 lumbar vertebrae, scoliosis). BioMCP gene enrichment: 5 SNPs cluster on homocysteine metabolism (p=3.29e-6). Homocysteine was elevated (10.1→13.9 µmol/l), now controlled with folate (11.0 µmol/l).',
    skepticCase:
      'Variants are common in general population. Gene enrichment is post-hoc analysis of known SNPs. No clinical diagnosis of connective tissue disorder.',
    arbiterVerdict:
      'Homocysteine was confirmed elevated (10.1→13.9 µmol/l) before folate supplementation — validates CBS/MTHFR pathway dysfunction. Now controlled at 11.0 µmol/l. Prior elevation may have contributed to sensory neuropathy.',
  },
  {
    name: 'Airway-Bruxism-Cervical Feedback Loop (H6)',
    probabilityLow: 10,
    probabilityHigh: 20,
    certaintyLevel: 'MODERATE',
    advocateCase:
      'CBCT: narrowed airway 113.6mm². AHI 3.2 bruxism. Extreme cervical muscle tension documented by specialist (2026). Tongue-tie documented. Biomechanical stress → CVJ loading.',
    skepticCase:
      'Airway is borderline narrowed. AHI 3.2 is mild. Bruxism is extremely common in chronic pain patients — effect not cause.',
    arbiterVerdict:
      'Low-risk interventions (MAD, myofunctional therapy, frenulotomy evaluation) warranted regardless. Not primary driver but clinically significant contributor.',
  },
  {
    name: 'Autoimmune (Sjögren/GPA/Behçet) (H4)',
    probabilityLow: 5,
    probabilityHigh: 15,
    certaintyLevel: 'WEAK',
    advocateCase:
      'PR3-ANCA seroconversion (98% specificity for GPA). Anti-Ro-60 positive (329.41 U/ml). Progressive leukopenia. Recurrent oral aphthae since 2012.',
    skepticCase:
      'PR3-ANCA intermittent (atypical for GPA). Anti-Ro-60 discordant between platforms. Mayo panel normal (Dec 2024). SFN excluded by biopsy. No organ damage. Leukopenia more consistent with drug-induced/toxic etiology. Aphthae alone score only 2/4 ICBD points for Behçet.',
    arbiterVerdict:
      'Downgraded after normal Mayo panel. PR3-ANCA IIF + ELISA and Anti-Ro-60 third method needed to resolve. Do NOT start immunosuppression without confirmed organ involvement.',
  },
];

// ─── Main Ingestion ──────────────────────────────────────────────────────

async function main() {
  const store = new ClinicalStore();

  console.log('=== Ingesting Adversarial Agent Findings ===\n');

  // 1. Read adversarial files
  const files: Array<{ name: string; agent: string }> = [
    { name: 'parallel-ai-advocate-v2.md', agent: 'advocate' },
    { name: 'parallel-ai-skeptic-v2.md', agent: 'skeptic' },
    { name: 'parallel-ai-unbiased-v2.md', agent: 'unbiased' },
  ];

  let totalFindings = 0;
  let totalDuplicates = 0;

  for (const file of files) {
    console.log(`\nProcessing ${file.name}...`);
    const content = readResearchFile(file.name);

    // Extract citations
    const pmids = extractPMIDs(content);
    const pmcIds = extractPMCIDs(content);
    const nctIds = extractNCTIDs(content);

    console.log(`  Found: ${pmids.length} PMIDs, ${pmcIds.length} PMC IDs, ${nctIds.length} NCT IDs`);

    // Persist PMID findings
    for (const pmid of pmids) {
      const result = await store.addResearchFinding(buildPmidFinding(pmid, file.agent));
      if (result.duplicate) totalDuplicates++;
      else totalFindings++;
    }

    // Persist PMC findings
    for (const pmcId of pmcIds) {
      const result = await store.addResearchFinding(buildPmcFinding(pmcId, file.agent));
      if (result.duplicate) totalDuplicates++;
      else totalFindings++;
    }

    // Persist NCT findings
    for (const nctId of nctIds) {
      const result = await store.addResearchFinding(buildNctFinding(nctId, file.agent));
      if (result.duplicate) totalDuplicates++;
      else totalFindings++;
    }

    // Persist agent summary finding
    const agentSummary = buildAgentFindings(
      file.agent,
      `${file.agent.toUpperCase()} analysis of Tomasz Szychliński case — ` +
        `${pmids.length} PMIDs cited, ${pmcIds.length} PMC articles, ${nctIds.length} clinical trials referenced. ` +
        `Content length: ${content.length} characters.`,
    );
    const sumResult = await store.addResearchFinding(agentSummary);
    if (!sumResult.duplicate) totalFindings++;
    else totalDuplicates++;
  }

  console.log(`\n--- Citation Findings ---`);
  console.log(`  Inserted: ${totalFindings}`);
  console.log(`  Duplicates skipped: ${totalDuplicates}`);

  // 2. Upsert hypotheses with adversarial data
  console.log('\n=== Updating Hypotheses with Adversarial Positions ===\n');

  let hypothesesUpdated = 0;
  let hypothesesDuplicate = 0;

  for (const h of HYPOTHESES) {
    const hypothesis: ResearchHypothesis = {
      id: randomUUID(),
      patientId: PATIENT_ID,
      name: h.name,
      probabilityLow: h.probabilityLow,
      probabilityHigh: h.probabilityHigh,
      certaintyLevel: h.certaintyLevel,
      advocateCase: h.advocateCase,
      skepticCase: h.skepticCase,
      arbiterVerdict: h.arbiterVerdict,
      stage: 7,
      version: 3,
      date: NOW,
      validationStatus: 'unvalidated',
      sourceCredibility: 75,
    };
    if (h.icdCode) {
      hypothesis.icdCode = h.icdCode;
    }

    const result = await store.addHypothesis(hypothesis);
    if (result.duplicate) {
      hypothesesDuplicate++;
      console.log(`  [skip] ${h.name} — v3 already exists`);
    } else {
      hypothesesUpdated++;
      console.log(`  [add]  ${h.name} — v3 added (${h.probabilityLow}-${h.probabilityHigh}% ${h.certaintyLevel})`);
    }
  }

  console.log(`\n--- Hypothesis Updates ---`);
  console.log(`  Updated: ${hypothesesUpdated}`);
  console.log(`  Already current: ${hypothesesDuplicate}`);

  console.log('\n=== Adversarial Ingestion Complete ===');
}

main().catch(console.error);
