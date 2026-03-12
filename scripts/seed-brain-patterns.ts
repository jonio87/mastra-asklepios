/**
 * Seed Brain Patterns from Tomasz Szychliński Case
 *
 * Extracts diagnostic patterns from the first resolved case
 * and persists them to the brain_patterns table. These patterns
 * represent cross-patient diagnostic wisdom — NOT individual data.
 */

import { ClinicalStore } from '../src/storage/clinical-store.js';
import type { BrainPatternInput } from '../src/schemas/brain-pattern.js';

const CASE_LABEL = 'case-001-craniofacial-cvj';

// ─── Pattern Data ────────────────────────────────────────────────────────

const PATTERNS: BrainPatternInput[] = [
  // ─── Diagnostic Shortcuts ──────────────────────────────────────────
  {
    pattern:
      'GON block 100% response + subsequent pain migration to V1/V2 territory = trigeminocervical complex (TCC) convergence pattern. C2 input confirmed as generator; pain redistribution proves central TCC reorganization, not peripheral spread.',
    category: 'diagnostic-shortcut',
    phenotypeCluster: [
      'chronic craniofacial pain',
      'occipital pain',
      'facial pain',
      'GON block response',
      'pain migration',
      'trigeminal neuralgia',
    ],
    supportingCases: 1,
    confidence: 0.85,
    relatedDiagnoses: ['Q76.1', 'G44.841', 'G50.0'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'Normal motor EMG + progressive upper limb weakness + CVJ anomaly = weakness is central/myelopathic, NOT peripheral neuropathy. Dynamic MRI (flexion/extension) is highest-yield test — static MRI misses motion-dependent compression.',
    category: 'diagnostic-shortcut',
    phenotypeCluster: [
      'progressive weakness',
      'normal EMG motor',
      'CVJ anomaly',
      'upper limb weakness',
      'myelopathy',
    ],
    supportingCases: 1,
    confidence: 0.80,
    relatedDiagnoses: ['M47.0', 'Q76.1'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      '4/4 CGRP monoclonal antibodies (erenumab, fremanezumab, galcanezumab, eptinezumab) with zero efficacy = EXCLUDES migraine as primary mechanism. Redirects workup toward cervicogenic, neuropathic, or nociplastic pain.',
    category: 'diagnostic-shortcut',
    phenotypeCluster: [
      'chronic headache',
      'CGRP failure',
      'treatment-resistant headache',
      'facial pain',
    ],
    supportingCases: 1,
    confidence: 0.90,
    relatedDiagnoses: ['G43.909', 'G44.1'],
    sourceCaseLabels: [CASE_LABEL],
  },

  // ─── Common Misdiagnoses ───────────────────────────────────────────
  {
    pattern:
      'CVJ anomaly (C1 assimilation, basilar impression) dismissed as incidental finding (0.64% prevalence). However: when combined with ipsilateral facial pain + myelopathic signs + response to C2 nerve block, the anomaly is symptomatic. Literature shows surgical correction can resolve trigeminal pain (5 case reports with cure).',
    category: 'common-misdiagnosis',
    phenotypeCluster: [
      'CVJ anomaly',
      'basilar impression',
      'C1 assimilation',
      'incidental finding',
      'facial pain',
    ],
    supportingCases: 1,
    confidence: 0.75,
    relatedDiagnoses: ['Q76.1', 'Q01.9'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'Pain migration after nerve block misinterpreted as treatment failure. Actually confirms TCC convergence: blocking one input (C2/GON) unmasks other inputs (V1/V2) already sensitized at central level. This is DIAGNOSTIC INFORMATION, not failure.',
    category: 'common-misdiagnosis',
    phenotypeCluster: [
      'nerve block',
      'pain migration',
      'treatment failure',
      'central sensitization',
      'GON block',
    ],
    supportingCases: 1,
    confidence: 0.85,
    relatedDiagnoses: ['G89.4'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'Intermittent PR3-ANCA positivity misinterpreted as GPA (granulomatosis with polyangiitis). Intermittent low-titer positivity WITHOUT organ damage is atypical for primary GPA. Consider: drug-induced ANCA (bupropion, levamisole), lab artifact, or immune dysregulation marker. Confirm with IIF + quantitative ELISA before immunosuppression.',
    category: 'common-misdiagnosis',
    phenotypeCluster: [
      'PR3-ANCA positive',
      'intermittent ANCA',
      'leukopenia',
      'no organ damage',
      'autoimmune markers',
    ],
    supportingCases: 1,
    confidence: 0.70,
    relatedDiagnoses: ['M31.3', 'D72.8'],
    sourceCaseLabels: [CASE_LABEL],
  },

  // ─── Key Differentiators ───────────────────────────────────────────
  {
    pattern:
      'Single differentiator for central vs peripheral weakness: EMG motor studies normal + clinical weakness present = central/myelopathic origin. If EMG motor abnormal = peripheral cause. No overlap — binary differentiator.',
    category: 'key-differentiator',
    phenotypeCluster: [
      'muscle weakness',
      'EMG normal',
      'central weakness',
      'peripheral neuropathy',
    ],
    supportingCases: 1,
    confidence: 0.95,
    relatedDiagnoses: ['G62.9', 'M47.0'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'LDN (low-dose naltrexone) response as differentiator: positive response suggests glial-mediated central sensitization (via TLR4 + TRPM3 mechanisms). Negative response to LDN + positive response to IV ketamine suggests NMDA-mediated sensitization. Both mechanisms can coexist.',
    category: 'key-differentiator',
    phenotypeCluster: [
      'LDN response',
      'central sensitization',
      'chronic pain',
      'glial modulation',
      'treatment response',
    ],
    supportingCases: 1,
    confidence: 0.70,
    relatedDiagnoses: ['G89.4'],
    sourceCaseLabels: [CASE_LABEL],
  },

  // ─── Temporal Patterns ─────────────────────────────────────────────
  {
    pattern:
      '16-year progression: focal occipital pain (C2 territory) → pain migration to face (V1/V2) after GON block → diffuse craniofacial pain with central sensitization features (photophobia, phonophobia, fatigue, cognitive impairment, bruxism). Timeline: focal→migrated→diffuse over 5-8 years suggests TCC-mediated central sensitization.',
    category: 'temporal-pattern',
    phenotypeCluster: [
      'chronic pain progression',
      'pain spread',
      'central sensitization',
      'occipital to facial',
      'sensitization timeline',
    ],
    supportingCases: 1,
    confidence: 0.80,
    relatedDiagnoses: ['G89.4', 'G44.841'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'Post-surgical pain onset: rhinoseptoplasty (2012) → immediate onset recurrent oral aphthae (~1cm, annual, 3-week healing) + persistent unilateral head pain. Surgical manipulation of nasal/pharyngeal structures may trigger SPG sensitization. Consider iatrogenic trigger in young patients with new-onset craniofacial pain after ENT procedures.',
    category: 'temporal-pattern',
    phenotypeCluster: [
      'post-surgical pain',
      'rhinoseptoplasty',
      'oral aphthae',
      'craniofacial pain onset',
      'SPG sensitization',
    ],
    supportingCases: 1,
    confidence: 0.60,
    relatedDiagnoses: ['T81.1', 'K12.0'],
    sourceCaseLabels: [CASE_LABEL],
  },

  // ─── Phenotype-Genotype Correlations ───────────────────────────────
  {
    pattern:
      'COMT + MTHFR + CBS + VDR + ACE variant cluster → gene enrichment analysis shows clustering on homocysteine metabolism pathway (p=3.29e-6), NOT on pain pathways directly. COMT expression at cervical C-1 spinal cord = 56.2 TPM — direct molecular link between genetic variant and CVJ anomaly site. Homocysteine was confirmed elevated (10.1→13.9 µmol/l), now controlled with folate (11.0 µmol/l). Prior elevation validates unified genetic-neuropathy mechanism.',
    category: 'phenotype-genotype',
    phenotypeCluster: [
      'COMT variant',
      'MTHFR variant',
      'CBS variant',
      'VDR variant',
      'ACE variant',
      'homocysteine',
      'neuropathy',
      'CVJ anomaly',
    ],
    supportingCases: 1,
    confidence: 0.75,
    relatedDiagnoses: ['E72.1', 'G62.9', 'Q76.1'],
    relatedGenes: ['COMT', 'MTHFR', 'CBS', 'VDR', 'ACE'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'ACE high expression in testis (112.3 TPM) explains persistently elevated testosterone (825-925 ng/dl) in male patient with ACE genetic variant. Not pathological — genetic variant → tissue-specific overexpression → hormonal phenotype. Avoid unnecessary endocrine workup.',
    category: 'phenotype-genotype',
    phenotypeCluster: [
      'elevated testosterone',
      'ACE variant',
      'endocrine abnormality',
      'genetic variant',
    ],
    supportingCases: 1,
    confidence: 0.65,
    relatedDiagnoses: ['E29.0'],
    relatedGenes: ['ACE'],
    sourceCaseLabels: [CASE_LABEL],
  },

  // ─── Research Tips ─────────────────────────────────────────────────
  {
    pattern:
      'For multi-gene variant analysis: use BioMCP gene enrichment (g:Profiler) to find pathway clustering BEFORE individual gene lookup. Pathway-level insight (e.g., homocysteine metabolism) is more actionable than per-gene analysis. Follow with GTEx tissue expression for molecular-anatomical links.',
    category: 'research-tip',
    phenotypeCluster: [
      'genetic variants',
      'SNP analysis',
      'pathway analysis',
      'multi-gene',
      'enrichment analysis',
    ],
    supportingCases: 1,
    confidence: 0.80,
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'In patients with MTHFR/CBS variants and neuropathy, check homocysteine level early (~$5-10). In this case, homocysteine was elevated (10.1→13.9 µmol/l) before treatment. Folate supplementation normalized it to 11.0 µmol/l. Consider adding methylcobalamin + P5P to complete the methylation cycle. Prior elevation may explain sensory axonal neuropathy even after normalization.',
    category: 'research-tip',
    phenotypeCluster: [
      'homocysteine',
      'MTHFR',
      'CBS',
      'neuropathy',
      'cost-effective testing',
      'diagnostic gap',
    ],
    supportingCases: 1,
    confidence: 0.90,
    relatedGenes: ['MTHFR', 'CBS'],
    sourceCaseLabels: [CASE_LABEL],
  },
  {
    pattern:
      'COMT-drug interaction analysis via DGIdb reveals bupropion interaction (score 0.219). Duloxetine + COMT high-activity variant at cervical cord = paradoxically excessive NE sustains central sensitization instead of reducing pain. Check DGIdb for pharmacogenomic interactions before prescribing in patients with known COMT variants.',
    category: 'research-tip',
    phenotypeCluster: [
      'COMT variant',
      'drug interaction',
      'pharmacogenomics',
      'duloxetine failure',
      'bupropion',
    ],
    supportingCases: 1,
    confidence: 0.70,
    relatedGenes: ['COMT'],
    sourceCaseLabels: [CASE_LABEL],
  },
];

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const store = new ClinicalStore();

  console.log('=== Seeding Brain Patterns ===\n');
  console.log(`Total patterns to seed: ${PATTERNS.length}\n`);

  let inserted = 0;
  let merged = 0;

  for (const pattern of PATTERNS) {
    const result = await store.addBrainPattern(pattern);
    if (result.merged) {
      merged++;
      console.log(`  [merge] ${pattern.category}: ${pattern.pattern.slice(0, 60)}...`);
    } else {
      inserted++;
      console.log(`  [add]   ${pattern.category}: ${pattern.pattern.slice(0, 60)}...`);
    }
  }

  // Print summary
  const totalPatterns = await store.getBrainPatternCount();
  const totalCases = await store.getBrainCaseCount();

  console.log(`\n--- Brain Pattern Summary ---`);
  console.log(`  New patterns inserted: ${inserted}`);
  console.log(`  Merged with existing: ${merged}`);
  console.log(`  Total patterns in brain: ${totalPatterns}`);
  console.log(`  Total supporting cases: ${totalCases}`);

  // Print by category
  const categories = [
    'diagnostic-shortcut',
    'common-misdiagnosis',
    'key-differentiator',
    'temporal-pattern',
    'phenotype-genotype',
    'research-tip',
  ] as const;

  console.log('\n  By category:');
  for (const cat of categories) {
    const patterns = await store.queryBrainPatterns({ category: cat });
    console.log(`    ${cat}: ${patterns.length} patterns`);
  }

  console.log('\n=== Brain Pattern Seeding Complete ===');
}

main().catch(console.error);
