/**
 * Lab Value Post-Processing Validator
 *
 * Runs AFTER mapLabValue() and BEFORE database insertion to catch
 * LLM extraction artifacts and apply clinical rules.
 *
 * Validators:
 *   1. Specimen-label-as-value detection (SUROWICA, SERUM, etc.)
 *   2. Qualitative-value specimen disambiguation (WBC "Absent" → urine vs blood)
 *   3. Numeric plausibility checks (~17 common analytes)
 *   4. Immunoblot panel flag inference (onconeural antibodies)
 */

import type { LabResult } from '../schemas/clinical-record.js';
import type { StructuredLabValue } from './schemas.js';

// ─── Specimen-label detection ────────────────────────────────────────────

/**
 * Specimen type labels that the LLM sometimes erroneously places in the
 * "value" field instead of the actual test result.
 */
const SPECIMEN_LABELS = new Set([
  'surowica', 'serum',
  'osocze', 'plasma',
  'krew', 'blood', 'krew pełna', 'whole blood',
  'mocz', 'urine',
  'pmr', 'csf', 'płyn mózgowo-rdzeniowy', 'cerebrospinal fluid',
  'kał', 'stool',
  'ślina', 'saliva',
]);

/**
 * Returns true if a value looks like a specimen label rather than an actual result.
 */
export function isSpecimenLabel(value: string | number): boolean {
  if (typeof value === 'number') return false;
  const normalized = value.trim().toLowerCase();
  return SPECIMEN_LABELS.has(normalized);
}

// ─── Qualitative-value specimen disambiguation ──────────────────────────

/**
 * Qualitative values that are exclusively urinalysis results when paired
 * with tests that normally return numeric blood values (e.g. WBC).
 */
const URINALYSIS_QUALITATIVE_VALUES = new Set([
  'absent', 'nieobecne', 'nieobecna', 'nieobecny',
  'present', 'obecne', 'obecna', 'obecny',
  'trace', 'ślad', 'ślady',
]);

/**
 * Blood test canonical names that should NOT have qualitative values.
 * If they do, it's likely a urinalysis result mislabeled as blood.
 */
const BLOOD_TESTS_WITH_NUMERIC_ONLY = new Set([
  'WBC', 'RBC', 'Hemoglobin', 'Hematocrit', 'Platelet Count',
  'Neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils',
  'Neutrophils %', 'Lymphocytes %', 'Monocytes %', 'Eosinophils %', 'Basophils %',
]);

/**
 * LOINC codes for blood-panel versions of tests that also exist in urinalysis.
 * Used to detect mislabeled urinalysis results.
 */
const BLOOD_LOINC_TO_URINE_REMAP: Record<string, { canonicalName: string; loincCode: string }> = {
  '6690-2': { canonicalName: 'WBC (urine dipstick)', loincCode: '5821-4' },  // WBC blood → WBC urine
  '789-8': { canonicalName: 'RBC (urine)', loincCode: '5808-1' },            // RBC blood → RBC urine
};

/**
 * Context markers that indicate a urinalysis section (Polish and English).
 */
const URINALYSIS_CONTEXT_MARKERS = [
  'badanie ogólne moczu',
  'urinalysis',
  'urine analysis',
  'analiza moczu',
  'mocz - badanie ogólne',
  'urine dipstick',
  'urine test',
];

export interface LabRemapResult {
  /** Whether the lab's LOINC should be remapped */
  remapped: boolean;
  /** New canonical test name (if remapped) */
  canonicalName?: string;
  /** New LOINC code (if remapped) */
  loincCode?: string;
  /** Explanation added to notes */
  note?: string;
}

/**
 * Check if a qualitative lab value paired with a blood LOINC actually belongs
 * to a urinalysis panel. Returns remap info if so.
 */
export function checkUrinalysisRemap(
  lab: LabResult,
  siblingValues: StructuredLabValue[],
): LabRemapResult {
  const noRemap: LabRemapResult = { remapped: false };

  // Only applies to qualitative values on normally-numeric blood tests
  if (typeof lab.value === 'number') return noRemap;
  const valueNorm = String(lab.value).trim().toLowerCase();
  if (!URINALYSIS_QUALITATIVE_VALUES.has(valueNorm)) return noRemap;

  if (!BLOOD_TESTS_WITH_NUMERIC_ONLY.has(lab.testName)) return noRemap;

  // Check if we have a blood LOINC that can be remapped
  if (!lab.loincCode) return noRemap;
  const remap = BLOOD_LOINC_TO_URINE_REMAP[lab.loincCode];
  if (!remap) return noRemap;

  // Additional confidence: check if sibling values suggest urinalysis context
  const hasUrinalysisContext = siblingValues.some((sv) => {
    const name = (sv.test_name_pl ?? sv.test_name).toLowerCase();
    return URINALYSIS_CONTEXT_MARKERS.some((marker) => name.includes(marker))
      || name.includes('mocz')
      || name.includes('urine')
      || name.includes('leukocyte esterase')
      || name.includes('esteraza leukocytarna')
      || name.includes('nitrites')
      || name.includes('azotyny')
      || name.includes('urobilinogen')
      || name.includes('urobilinogen');
  });

  // Even without context, a qualitative value on a blood test is highly suspicious
  // But with context, we're certain
  return {
    remapped: true,
    canonicalName: remap.canonicalName,
    loincCode: remap.loincCode,
    note: hasUrinalysisContext
      ? `Remapped from blood ${lab.testName} to ${remap.canonicalName}: qualitative value in urinalysis context`
      : `Remapped from blood ${lab.testName} to ${remap.canonicalName}: qualitative value "${lab.value}" incompatible with blood test`,
  };
}

// ─── Numeric plausibility checks ────────────────────────────────────────

/**
 * Physiologically plausible ranges for common lab tests.
 * Values outside these ranges are flagged as potential extraction errors.
 * Ranges are deliberately wide to avoid false positives — these catch
 * only impossible values (e.g. WBC = 50000 or Hemoglobin = 250).
 */
const LAB_PLAUSIBILITY_RANGES: Record<string, { min: number; max: number }> = {
  WBC: { min: 0.1, max: 500 },
  RBC: { min: 0.5, max: 15 },
  Hemoglobin: { min: 1, max: 25 },
  Hematocrit: { min: 5, max: 80 },
  'Platelet Count': { min: 5, max: 2000 },
  Glucose: { min: 10, max: 1000 },
  Creatinine: { min: 0.01, max: 30 },
  'Total cholesterol': { min: 30, max: 600 },
  TSH: { min: 0.001, max: 500 },
  CRP: { min: 0, max: 500 },
  Sodium: { min: 80, max: 200 },
  Potassium: { min: 0.5, max: 15 },
  ALT: { min: 0, max: 10000 },
  AST: { min: 0, max: 10000 },
  'Total bilirubin': { min: 0, max: 50 },
  Ferritin: { min: 0, max: 100000 },
  'Vitamin D 25-OH': { min: 0, max: 300 },
};

export interface PlausibilityResult {
  plausible: boolean;
  warning?: string;
}

/**
 * Check if a numeric lab value falls within physiologically plausible ranges.
 */
export function checkPlausibility(testName: string, value: string | number): PlausibilityResult {
  const range = LAB_PLAUSIBILITY_RANGES[testName];
  if (!range) return { plausible: true };

  const numValue = typeof value === 'number' ? value : parseFloat(String(value).replace(/[<>]/g, ''));
  if (isNaN(numValue)) return { plausible: true }; // qualitative, skip

  if (numValue < range.min || numValue > range.max) {
    return {
      plausible: false,
      warning: `Implausible ${testName}: ${value} (expected ${range.min}–${range.max})`,
    };
  }

  return { plausible: true };
}

// ─── Immunoblot flag inference ──────────────────────────────────────────

/**
 * Onconeural antibody panel — keyword-based matching for immunoblot assays
 * where numeric values represent intensity classes, not concentrations.
 * Values > cutoff = positive.
 * Uses keyword matching (case-insensitive) because LLM extraction produces
 * variable test names ("Anti-Hu", "Anti-Hu antibodies immunoblot", etc.)
 */
const IMMUNOBLOT_KEYWORDS = [
  'anti-hu', 'anti-ri', 'anti-yo',
  'anti-amphiphysin', 'amphiphysin',
  'anti-cv2', 'cv2.1', 'crmp5',
  'anti-sox1', 'sox1',
  'anti-ma2', 'anti-pnm2', 'ma2/ta', 'pnm2/ta',
  'anti-recoverin', 'recoverin',
  'anti-titin', 'titin',
  'anti-myelin', 'myelin',
];

function isImmunoblotTest(testName: string): boolean {
  const lower = testName.toLowerCase();
  // Must also NOT be IIF (which are qualitative, not intensity-based)
  if (lower.includes('iif') || lower.includes('immunofluorescence')) return false;
  return IMMUNOBLOT_KEYWORDS.some(kw => lower.includes(kw));
}

/** ELISA-based antibody tests with different cutoff thresholds */
const ELISA_KEYWORDS = ['anti-mpo', 'anti-pr3', 'pr3-anca', 'mpo-anca', 'proteinase 3'];

function isElisaTest(testName: string): boolean {
  const lower = testName.toLowerCase();
  // Only if it's ELISA-style (not IIF)
  if (lower.includes('iif') || lower.includes('immunofluorescence')) return false;
  return ELISA_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Immunoblot cutoff thresholds for positive/negative interpretation.
 * Source: Euroimmun onconeural antibody panel standard cutoffs.
 */
const IMMUNOBLOT_CUTOFFS: Record<string, { positive: number; weakPositive?: number }> = {
  default: { positive: 7, weakPositive: 5 },
};

/** ELISA cutoff thresholds (different from immunoblot) */
const ELISA_CUTOFFS: Record<string, { positive: number }> = {
  default: { positive: 5 },
};

export interface FlagInferenceResult {
  inferred: boolean;
  flag?: 'normal' | 'high';
  note?: string;
}

/**
 * For immunoblot/ELISA panel results with numeric values and no flag,
 * infer the flag from cutoff thresholds.
 */
export function inferImmunoblotFlag(
  testName: string,
  value: string | number,
  existingFlag: string | undefined,
): FlagInferenceResult {
  const noInference: FlagInferenceResult = { inferred: false };

  // Only infer if flag is missing
  if (existingFlag) return noInference;

  const numValue = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(numValue)) return noInference; // qualitative values handled by SNOMED

  let cutoffs: { positive: number; weakPositive?: number } | undefined;

  if (isImmunoblotTest(testName)) {
    cutoffs = IMMUNOBLOT_CUTOFFS[testName] ?? IMMUNOBLOT_CUTOFFS['default'];
  } else if (isElisaTest(testName)) {
    const elisaCutoff = ELISA_CUTOFFS[testName] ?? ELISA_CUTOFFS['default']!;
    if (elisaCutoff) {
      cutoffs = { positive: elisaCutoff.positive };
    }
  }

  if (!cutoffs) return noInference;

  const flag = numValue >= cutoffs.positive ? 'high' : 'normal';
  const interpretation = numValue >= cutoffs.positive
    ? 'positive'
    : cutoffs.weakPositive && numValue >= cutoffs.weakPositive
      ? 'weak positive / borderline'
      : 'negative';

  return {
    inferred: true,
    flag,
    note: `Flag inferred from immunoblot cutoff (value ${numValue} vs threshold ${cutoffs.positive}): ${interpretation}`,
  };
}

// ─── Combined validation entry point ────────────────────────────────────

export interface LabValidationResult {
  /** Whether the lab should be rejected (not inserted) */
  rejected: boolean;
  /** Reason for rejection */
  rejectReason?: string;
  /** Corrections to apply to the lab result */
  corrections: Partial<LabResult>;
  /** Additional notes to append */
  additionalNotes: string[];
}

/**
 * Run all validation checks on a lab result.
 * Returns corrections to apply and/or rejection decision.
 */
export function validateLabResult(
  lab: LabResult,
  siblingValues: StructuredLabValue[],
): LabValidationResult {
  const corrections: Partial<LabResult> = {};
  const additionalNotes: string[] = [];

  // 1. Specimen-label-as-value detection
  if (isSpecimenLabel(lab.value)) {
    return {
      rejected: true,
      rejectReason: `Value "${String(lab.value)}" is a specimen label, not a test result`,
      corrections: {},
      additionalNotes: [],
    };
  }

  // 2. Urinalysis remap
  const remap = checkUrinalysisRemap(lab, siblingValues);
  if (remap.remapped) {
    if (remap.canonicalName) corrections.testName = remap.canonicalName;
    if (remap.loincCode) corrections.loincCode = remap.loincCode;
    if (remap.note) additionalNotes.push(remap.note);
  }

  // 3. Plausibility check
  const plausibility = checkPlausibility(lab.testName, lab.value);
  if (!plausibility.plausible && plausibility.warning) {
    additionalNotes.push(plausibility.warning);
    corrections.validationStatus = 'critical-unvalidated';
  }

  // 4. Immunoblot flag inference
  const flagResult = inferImmunoblotFlag(lab.testName, lab.value, lab.flag);
  if (flagResult.inferred && flagResult.flag) {
    corrections.flag = flagResult.flag;
    if (flagResult.note) additionalNotes.push(flagResult.note);
  }

  return { rejected: false, corrections, additionalNotes };
}
