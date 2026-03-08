import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

const DdxEntrySchema = z.object({
  diagnosis: z.string().describe('Diagnosis name'),
  icdCode: z.string().optional().describe('ICD-10 code if known'),
  likelihood: z
    .enum(['high', 'medium', 'low', 'dont-miss'])
    .describe('Likelihood category or "dont-miss" safety flag'),
  reasoning: z.string().describe('Brief reasoning for inclusion'),
  supportingFeatures: z.array(z.string()).describe('Patient features supporting this diagnosis'),
  contradictingFeatures: z
    .array(z.string())
    .optional()
    .describe('Patient features arguing against this diagnosis'),
  suggestedTests: z
    .array(z.string())
    .optional()
    .describe('Tests that would help confirm or exclude this diagnosis'),
});

export type DdxEntry = z.infer<typeof DdxEntrySchema>;

const ISABEL_API_BASE = 'https://api.isabelhealthcare.com/v2';

interface IsabelDiagnosis {
  diagnosis_name?: string;
  icd10_code?: string;
  red_flag?: boolean;
  specialty?: string;
}

interface IsabelResponse {
  diagnoses?: IsabelDiagnosis[];
  error?: string;
}

/** Attempt Isabel DDx API call if API key is configured. */
async function queryIsabelApi(
  clinicalFeatures: string[],
  demographics: { age: number; sex: string; region?: string },
): Promise<DdxEntry[] | undefined> {
  const apiKey = process.env['ISABELDX_API_KEY'];
  if (!apiKey) return undefined;

  logger.info('Querying Isabel DDx API', { featureCount: clinicalFeatures.length });

  try {
    const response = await fetch(`${ISABEL_API_BASE}/diagnoses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // biome-ignore lint/style/useNamingConvention: HTTP header
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        querytext: clinicalFeatures.join(', '),
        age: demographics.age,
        sex: demographics.sex === 'male' ? 'M' : 'F',
        region: demographics.region ?? 'europe',
        specialty: 'all',
        flag: 'red',
      }),
    });

    if (!response.ok) {
      logger.warn('Isabel API returned error', { status: response.status });
      return undefined;
    }

    const data = (await response.json()) as IsabelResponse;
    if (data.error || !data.diagnoses) {
      logger.warn('Isabel API error in response', { error: data.error });
      return undefined;
    }

    return data.diagnoses.map((d) => ({
      diagnosis: d.diagnosis_name ?? 'Unknown',
      ...(d.icd10_code ? { icdCode: d.icd10_code } : {}),
      likelihood: d.red_flag ? 'dont-miss' : 'medium',
      reasoning: `Isabel DDx engine (specialty: ${d.specialty ?? 'general'})`,
      supportingFeatures: clinicalFeatures.slice(0, 5),
    }));
  } catch (error) {
    logger.error('Isabel API call failed', { error: String(error) });
    return undefined;
  }
}

// --- Pattern-matching category functions for DDx generation ---

type HasFeatureFn = (keyword: string) => boolean;

function checkPainPatterns(clinicalFeatures: string[], hasFeature: HasFeatureFn): DdxEntry[] {
  const results: DdxEntry[] = [];
  if (!hasFeature('chronic pain') && !hasFeature('craniofacial pain') && !hasFeature('headache')) {
    return results;
  }

  if (hasFeature('cervical') || hasFeature('c1') || hasFeature('cvj') || hasFeature('atlas')) {
    results.push({
      diagnosis: 'Craniovertebral junction anomaly with trigeminocervical convergence',
      icdCode: 'Q76.4',
      likelihood: 'high',
      reasoning:
        'Structural CVJ anomaly with chronic craniofacial pain suggests trigeminocervical convergence mechanism',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /cervical|c1|cvj|atlas|occipital|cranio/i.test(f),
      ),
      suggestedTests: ['Dynamic (flexion/extension) CVJ MRI', 'SSEP/MEP baseline'],
    });
  }

  results.push({
    diagnosis: 'Central sensitization / Nociplastic pain',
    icdCode: 'G89.4',
    likelihood: 'medium',
    reasoning: 'Chronic pain >3 months with treatment resistance and multisensory sensitivity',
    supportingFeatures: clinicalFeatures.filter((f) =>
      /pain|sensitiz|allodynia|photophob|phonophob|fatigue/i.test(f),
    ),
    suggestedTests: ['Quantitative sensory testing (QST)', 'Central Sensitization Inventory (CSI)'],
  });

  return results;
}

function checkAutoimmunePatterns(clinicalFeatures: string[], hasFeature: HasFeatureFn): DdxEntry[] {
  const results: DdxEntry[] = [];

  if (hasFeature('anca') || hasFeature('pr3') || hasFeature('mpo')) {
    results.push({
      diagnosis: 'ANCA-associated vasculitis (GPA)',
      icdCode: 'M31.3',
      likelihood: hasFeature('organ damage') ? 'high' : 'medium',
      reasoning: 'PR3-ANCA or MPO-ANCA positivity requires vasculitis evaluation',
      supportingFeatures: clinicalFeatures.filter((f) => /anca|pr3|mpo|vasculit|granulom/i.test(f)),
      contradictingFeatures: clinicalFeatures.filter((f) =>
        /intermittent|transient|drug.induced/i.test(f),
      ),
      suggestedTests: ['ANCA IIF + ELISA (per EULAR 2022)', 'Urinalysis', 'CT sinus/chest'],
    });
  }

  if (
    hasFeature('ro-60') ||
    hasFeature('ssa') ||
    hasFeature('dry eyes') ||
    hasFeature('dry mouth')
  ) {
    results.push({
      diagnosis: 'Sjögren syndrome (primary)',
      icdCode: 'M35.0',
      likelihood: 'medium',
      reasoning: 'Anti-Ro/SSA positivity or sicca symptoms warrant Sjögren evaluation',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /ro.60|ssa|dry|sjögren|sjogren|parotid/i.test(f),
      ),
      suggestedTests: ['Salivary gland ultrasound', 'Schirmer test', 'Minor salivary gland biopsy'],
    });
  }

  if (hasFeature('aphthae') || hasFeature('aphthous') || hasFeature('oral ulcer')) {
    results.push({
      diagnosis: 'Behçet disease',
      icdCode: 'M35.2',
      likelihood: 'low',
      reasoning:
        'Recurrent oral aphthae are a cardinal feature of Behçet — requires ≥4 ICBD points',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /aphth|ulcer|uveitis|genital|pathergy/i.test(f),
      ),
      suggestedTests: ['HLA-B51', 'Pathergy test', 'ICBD scoring'],
    });
  }

  return results;
}

function checkLeukopenia(clinicalFeatures: string[], hasFeature: HasFeatureFn): DdxEntry[] {
  if (!hasFeature('leukopenia') && !hasFeature('neutropenia') && !hasFeature('pancytopenia')) {
    return [];
  }

  return [
    {
      diagnosis: 'Drug-induced leukopenia',
      likelihood: 'medium',
      reasoning: 'Leukopenia in context of polypharmacy — medication audit required',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /leukopen|neutrop|wbc|pancytop|bupropion|medication/i.test(f),
      ),
      suggestedTests: [
        'Medication audit (bupropion, anticonvulsants)',
        'Flow cytometry',
        'STAT3 mutation screen',
      ],
    },
    {
      diagnosis: 'T-cell large granular lymphocyte leukemia (T-LGL)',
      likelihood: 'dont-miss',
      reasoning:
        'Chronic unexplained neutropenia requires exclusion of T-LGL — indolent but treatable',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /leukopen|neutrop|splenomeg|autoimmun/i.test(f),
      ),
      suggestedTests: [
        'Flow cytometry with T-LGL markers',
        'STAT3 mutation',
        'Peripheral blood smear',
      ],
    },
  ];
}

function checkNeuropathy(clinicalFeatures: string[], hasFeature: HasFeatureFn): DdxEntry[] {
  if (!hasFeature('neuropathy') && !hasFeature('paresthesia') && !hasFeature('weakness')) {
    return [];
  }

  const results: DdxEntry[] = [];

  if (hasFeature('motor normal') || hasFeature('motor nerves normal')) {
    results.push({
      diagnosis: 'Cervical myelopathy',
      icdCode: 'G99.2',
      likelihood: 'high',
      reasoning:
        'Progressive weakness with normal motor nerve conduction points to central (upper motor neuron) cause',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /weakness|motor normal|upper limb|hand|myelopath/i.test(f),
      ),
      suggestedTests: ['Dynamic CVJ MRI', 'SSEP/MEP', 'Structured neurological exam for UMN signs'],
    });
  }

  results.push({
    diagnosis: 'Sensory axonal polyneuropathy',
    icdCode: 'G62.9',
    likelihood: 'medium',
    reasoning:
      'Sensory nerve involvement pattern — evaluate for metabolic, autoimmune, or toxic causes',
    supportingFeatures: clinicalFeatures.filter((f) => /sensory|axonal|sural|neuropath/i.test(f)),
    suggestedTests: ['B12, folate, TSH', 'HbA1c', 'SPEP/UPEP', 'Anti-MAG, anti-ganglioside'],
  });

  return results;
}

function checkBruxism(clinicalFeatures: string[], hasFeature: HasFeatureFn): DdxEntry[] {
  if (!hasFeature('bruxism') && !hasFeature('tmj') && !hasFeature('jaw') && !hasFeature('airway')) {
    return [];
  }

  return [
    {
      diagnosis: 'Airway-related bruxism with compensatory cervical lordosis',
      likelihood: 'medium',
      reasoning:
        'Airway narrowing may drive compensatory cervical posture and bruxism — biomechanical feedback loop',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /bruxism|airway|lordosis|tongue|mandib|maxill/i.test(f),
      ),
      suggestedTests: ['CBCT airway analysis', 'Sleep study', 'Myofunctional therapy evaluation'],
    },
  ];
}

function checkEndocrine(
  clinicalFeatures: string[],
  hasFeature: HasFeatureFn,
  demographics: { age: number; sex: string },
): DdxEntry[] {
  if (demographics.age >= 40 || demographics.sex !== 'male' || !hasFeature('testosterone')) {
    return [];
  }

  return [
    {
      diagnosis: 'Endocrine evaluation — elevated testosterone workup',
      likelihood: 'low',
      reasoning:
        'Persistently elevated testosterone in young male — evaluate for exogenous sources, adrenal pathology, or CAH',
      supportingFeatures: clinicalFeatures.filter((f) =>
        /testosterone|dhea|lh|fsh|adrenal/i.test(f),
      ),
      suggestedTests: ['SHBG', 'LH/FSH', 'DHEA-S', '17-OH progesterone'],
    },
  ];
}

/** Generate internal DDx based on clinical features using pattern matching. */
function generateInternalDdx(
  clinicalFeatures: string[],
  labResults: string[],
  demographics: { age: number; sex: string },
): DdxEntry[] {
  const allFeatures = [...clinicalFeatures, ...labResults].map((f) => f.toLowerCase());

  const hasFeature: HasFeatureFn = (keyword: string): boolean =>
    allFeatures.some((f) => f.includes(keyword.toLowerCase()));

  return [
    ...checkPainPatterns(clinicalFeatures, hasFeature),
    ...checkAutoimmunePatterns(clinicalFeatures, hasFeature),
    ...checkLeukopenia(clinicalFeatures, hasFeature),
    ...checkNeuropathy(clinicalFeatures, hasFeature),
    ...checkBruxism(clinicalFeatures, hasFeature),
    ...checkEndocrine(clinicalFeatures, hasFeature, demographics),
  ];
}

export const ddxGeneratorTool = createTool({
  id: 'ddx-generator',
  description:
    'Generate a differential diagnosis from clinical features. Uses internal pattern-matching rules and, when an Isabel API key is configured, queries the Isabel DDx engine for independent validation. Input follows the Isabel API format (demographics + clinical features array) for compatibility.',
  inputSchema: z.object({
    clinicalFeatures: z
      .array(z.string())
      .min(1)
      .describe('Clinical features (symptoms, signs, findings) — unlimited list'),
    labResults: z
      .array(z.string())
      .optional()
      .describe('Laboratory results (e.g., "WBC 2.59 low", "PR3-ANCA positive")'),
    age: z.number().min(0).max(120).describe('Patient age in years'),
    sex: z.enum(['male', 'female']).describe('Patient biological sex'),
    region: z
      .string()
      .optional()
      .describe('Geographic region for prevalence weighting (default: "europe")'),
  }),
  outputSchema: z.object({
    differentialDiagnosis: z.array(DdxEntrySchema).describe('Ranked differential diagnosis list'),
    source: z
      .enum(['internal', 'isabel', 'combined'])
      .describe('Source of the differential (internal rules, Isabel API, or combined)'),
    featureCount: z.number().describe('Number of clinical features analyzed'),
    disclaimer: z.string().describe('Medical disclaimer'),
  }),
  execute: async (inputData) => {
    const { clinicalFeatures, labResults = [], age, sex, region } = inputData;

    logger.info('Generating differential diagnosis', {
      featureCount: clinicalFeatures.length,
      labCount: labResults.length,
      age,
      sex,
    });

    // Try Isabel API first
    const isabelResults = await queryIsabelApi(clinicalFeatures, {
      age,
      sex,
      ...(region !== undefined ? { region } : {}),
    });

    // Always generate internal DDx
    const internalResults = generateInternalDdx(clinicalFeatures, labResults, { age, sex });

    let differentialDiagnosis: DdxEntry[];
    let source: 'internal' | 'isabel' | 'combined';

    if (isabelResults && isabelResults.length > 0) {
      // Merge: put dont-miss from both, then Isabel results, then internal
      const dontMiss = [
        ...isabelResults.filter((d) => d.likelihood === 'dont-miss'),
        ...internalResults.filter((d) => d.likelihood === 'dont-miss'),
      ];
      const isabelOther = isabelResults.filter((d) => d.likelihood !== 'dont-miss');
      const internalOther = internalResults.filter((d) => d.likelihood !== 'dont-miss');

      // Deduplicate by diagnosis name (case-insensitive)
      const seen = new Set<string>();
      differentialDiagnosis = [...dontMiss, ...isabelOther, ...internalOther].filter((d) => {
        const key = d.diagnosis.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      source = 'combined';
    } else {
      differentialDiagnosis = internalResults;
      source = 'internal';
    }

    // Sort: dont-miss first, then high, medium, low
    const likelihoodOrder: Record<string, number> = {
      'dont-miss': 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    differentialDiagnosis.sort(
      (a, b) => (likelihoodOrder[a.likelihood] ?? 99) - (likelihoodOrder[b.likelihood] ?? 99),
    );

    logger.info('DDx generation complete', {
      source,
      diagnosisCount: differentialDiagnosis.length,
    });

    return {
      differentialDiagnosis,
      source,
      featureCount: clinicalFeatures.length + labResults.length,
      disclaimer:
        'This differential diagnosis is generated by AI pattern-matching and should not replace clinical judgment. Always verify with appropriate diagnostic testing and specialist consultation.',
    };
  },
});
