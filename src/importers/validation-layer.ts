/**
 * Unified Clinical Validation Engine — Pipeline v3.0.0
 *
 * Runs AFTER L1 records are created but BEFORE database insertion.
 * Validates terminology codes, checks physiological plausibility,
 * and assigns extraction confidence scores.
 *
 * WARN-ONLY — never blocks import.
 *
 * Reuses:
 *   - lab-value-validator.ts for plausibility/specimen/immunoblot checks
 *   - terminology-service.ts for LOINC/SNOMED/ICD-10/RxNorm format validation + crosswalks
 */

import type {
  Consultation,
  ImagingReport,
  LabResult,
  ProcedureReport,
} from '../schemas/clinical-record.js';
import type { ValidationResult as TermValidationResult } from '../terminology/terminology-service.js';
import {
  getTerminologyService,
  SYSTEM_ICD10,
  SYSTEM_LOINC,
  SYSTEM_RXNORM,
  SYSTEM_SNOMED,
} from '../terminology/terminology-service.js';
import { logger } from '../utils/logger.js';
import { checkPlausibility, validateLabResult } from './lab-value-validator.js';

// ─── Types ────────────────────────────────────────────────────────────────

export type CodeSource = 'static-map' | 'embedding' | 'crosswalk' | 'llm';

export interface ValidationResult {
  /** Adjusted confidence after validation (0-1) */
  confidence: number;
  /** Derived from confidence thresholds */
  fhirStatus: 'final' | 'preliminary';
  /** Non-fatal issues */
  warnings: string[];
  /** Hard failures (code format invalid, etc.) */
  errors: string[];
  /** True if confidence < 0.70 */
  escalate: boolean;
}

// ─── Confidence Adjustments ──────────────────────────────────────────────

/** Penalty applied per code source method (used by pipeline callers). */
export const CODE_SOURCE_PENALTIES: Record<CodeSource, number> = {
  'static-map': 0,
  embedding: -0.05,
  crosswalk: 0,
  llm: -0.1,
};

const FAILED_CODE_FORMAT_PENALTY = 0.15;

// ─── Threshold Helpers ───────────────────────────────────────────────────

function deriveResult(
  confidence: number,
  warnings: string[],
  errors: string[],
  overrideValidationStatus?: string,
): ValidationResult {
  const clamped = Math.max(0, Math.min(1, confidence));

  let fhirStatus: 'final' | 'preliminary';
  let escalate: boolean;

  if (clamped >= 0.9) {
    fhirStatus = 'final';
    escalate = false;
  } else if (clamped >= 0.7) {
    fhirStatus = 'preliminary';
    escalate = false;
    warnings.push(`Confidence ${clamped.toFixed(2)} below 0.90 threshold — marked preliminary`);
  } else {
    fhirStatus = 'preliminary';
    escalate = true;
    warnings.push(`Confidence ${clamped.toFixed(2)} below 0.70 — escalated for review`);
  }

  // Override: confirmed validation_status forces final
  if (overrideValidationStatus === 'confirmed') {
    fhirStatus = 'final';
  }

  return { confidence: clamped, fhirStatus, warnings, errors, escalate };
}

// ─── Code Validation Helpers ─────────────────────────────────────────────

function validateCode(
  system: string,
  code: string | undefined,
  label: string,
  warnings: string[],
  errors: string[],
): { valid: boolean } {
  if (!code) return { valid: true }; // missing codes are not errors

  const svc = getTerminologyService();
  const result: TermValidationResult = svc.validate(system, code);

  if (!result.valid) {
    errors.push(`Invalid ${label} code format: "${code}"`);
    return { valid: false };
  }

  if (result.warnings) {
    for (const w of result.warnings) {
      warnings.push(`${label} ${code}: ${w}`);
    }
  }

  return { valid: true };
}

// ─── Date Sanity ─────────────────────────────────────────────────────────

function checkDateSanity(date: string | undefined, label: string, warnings: string[]): void {
  if (!date) return;

  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    warnings.push(`${label}: unparseable date "${date}"`);
    return;
  }

  const now = new Date();
  if (parsed > now) {
    warnings.push(`${label}: date "${date}" is in the future`);
  }

  if (parsed.getFullYear() < 1900) {
    warnings.push(`${label}: date "${date}" is before 1900`);
  }
}

// ─── Imaging Modality-LOINC Cross-Check ──────────────────────────────────

/**
 * Known LOINC code prefixes / patterns associated with specific modalities.
 * Used for cross-checking: e.g. an MRI LOINC on an X-ray record is suspicious.
 * Uses tuples to avoid naming convention issues with medical abbreviations.
 */
const MODALITY_LOINC_KEYWORDS: Array<[string, string[]]> = [
  ['X-ray', ['xr', 'x-ray', 'radiograph']],
  ['MRI', ['mr ', 'mri', 'magnetic resonance']],
  ['CT', ['ct ', 'ct scan', 'computed tomography']],
  ['ultrasound', ['us ', 'ultrasound', 'sonograph']],
];

function checkModalityLoincConsistency(
  modality: string,
  loincCode: string | undefined,
  warnings: string[],
): void {
  if (!loincCode) return;

  const svc = getTerminologyService();
  const result = svc.validate(SYSTEM_LOINC, loincCode);
  if (!(result.valid && result.display)) return;

  const displayLower = result.display.toLowerCase();
  const modalityLower = modality.toLowerCase();

  // Check each known modality for conflict
  for (const [mod, keywords] of MODALITY_LOINC_KEYWORDS) {
    const modLower = mod.toLowerCase();
    if (modLower === modalityLower) continue; // same modality, no conflict

    const loincMatchesOtherModality = keywords.some((kw) => displayLower.includes(kw));
    if (loincMatchesOtherModality) {
      warnings.push(
        `Modality "${modality}" but LOINC ${loincCode} display "${result.display}" suggests ${mod}`,
      );
      break;
    }
  }
}

// ─── Lab Validation ──────────────────────────────────────────────────────

export function validateLabRecord(lab: LabResult, sourceDocConfidence: number): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let confidence = sourceDocConfidence;

  // Reuse existing lab-value-validator for plausibility/specimen/immunoblot
  const labValidation = validateLabResult(lab, []);
  if (labValidation.rejected) {
    warnings.push(`Lab rejected: ${labValidation.rejectReason ?? 'unknown reason'}`);
    confidence -= 0.2;
  }
  for (const note of labValidation.additionalNotes) {
    warnings.push(note);
  }

  // Plausibility check reduces confidence
  const plausibility = checkPlausibility(lab.testName, lab.value);
  if (!plausibility.plausible) {
    confidence -= 0.1;
  }

  // LOINC code format validation
  const loincResult = validateCode(SYSTEM_LOINC, lab.loincCode, 'LOINC', warnings, errors);
  if (!loincResult.valid) {
    confidence -= FAILED_CODE_FORMAT_PENALTY;
  }

  // SNOMED value code format validation
  validateCode(SYSTEM_SNOMED, lab.valueSnomedCode, 'SNOMED value', warnings, errors);

  // Code source penalty (infer from extractionConfidence if not explicit)
  // Labs with extraction confidence are typically embedding or LLM sourced
  // We use the base sourceDocConfidence which already incorporates code source

  if (warnings.length > 0 || errors.length > 0) {
    logger.debug(
      `Lab validation for "${lab.testName}": ${warnings.length} warnings, ${errors.length} errors`,
    );
  }

  return deriveResult(confidence, warnings, errors, lab.validationStatus);
}

// ─── Consultation Validation ─────────────────────────────────────────────

export function validateConsultationRecord(
  consultation: Consultation,
  sourceDocConfidence: number,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let confidence = sourceDocConfidence;

  // SNOMED finding code format validation
  validateCode(SYSTEM_SNOMED, consultation.snomedFindingCode, 'SNOMED finding', warnings, errors);

  // ICD-10 code format validation
  const icd10Result = validateCode(
    SYSTEM_ICD10,
    consultation.icd10Code,
    'ICD-10',
    warnings,
    errors,
  );
  if (!icd10Result.valid) {
    confidence -= FAILED_CODE_FORMAT_PENALTY;
  }

  // ICD-10 crosswalk consistency check
  if (consultation.snomedFindingCode && consultation.icd10Code) {
    const svc = getTerminologyService();
    const crosswalks = svc.translate(SYSTEM_SNOMED, consultation.snomedFindingCode, SYSTEM_ICD10);
    if (crosswalks.length > 0) {
      const matchesCrosswalk = crosswalks.some((cw) => cw.targetCode === consultation.icd10Code);
      if (!matchesCrosswalk) {
        const expectedCodes = crosswalks.map((cw) => cw.targetCode).join(', ');
        warnings.push(
          `SNOMED→ICD-10 crosswalk mismatch: SNOMED ${consultation.snomedFindingCode} maps to [${expectedCodes}], not "${consultation.icd10Code}"`,
        );
      }
    }
    // If no crosswalk entries exist, we cannot validate — skip silently
  }

  // Date sanity
  checkDateSanity(consultation.date, 'Consultation date', warnings);

  if (warnings.length > 0 || errors.length > 0) {
    logger.debug(
      `Consultation validation for "${consultation.provider}": ${warnings.length} warnings, ${errors.length} errors`,
    );
  }

  return deriveResult(confidence, warnings, errors, consultation.validationStatus);
}

// ─── Imaging Validation ──────────────────────────────────────────────────

export function validateImagingRecord(
  report: ImagingReport,
  sourceDocConfidence: number,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let confidence = sourceDocConfidence;

  // LOINC study code format validation
  const loincResult = validateCode(
    SYSTEM_LOINC,
    report.loincStudyCode,
    'LOINC study',
    warnings,
    errors,
  );
  if (!loincResult.valid) {
    confidence -= FAILED_CODE_FORMAT_PENALTY;
  }

  // Body site SNOMED code format validation
  validateCode(SYSTEM_SNOMED, report.bodySiteSnomedCode, 'SNOMED body site', warnings, errors);

  // Cross-check: modality vs LOINC code
  checkModalityLoincConsistency(report.modality, report.loincStudyCode, warnings);

  if (warnings.length > 0 || errors.length > 0) {
    logger.debug(
      `Imaging validation for "${report.modality} ${report.bodyRegion}": ${warnings.length} warnings, ${errors.length} errors`,
    );
  }

  return deriveResult(confidence, warnings, errors, report.validationStatus);
}

// ─── Procedure Validation ────────────────────────────────────────────────

export function validateProcedureRecord(
  report: ProcedureReport,
  sourceDocConfidence: number,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let confidence = sourceDocConfidence;

  // LOINC procedure code format validation
  const loincResult = validateCode(
    SYSTEM_LOINC,
    report.loincProcedureCode,
    'LOINC procedure',
    warnings,
    errors,
  );
  if (!loincResult.valid) {
    confidence -= FAILED_CODE_FORMAT_PENALTY;
  }

  if (warnings.length > 0 || errors.length > 0) {
    logger.debug(
      `Procedure validation for "${report.procedureType}": ${warnings.length} warnings, ${errors.length} errors`,
    );
  }

  return deriveResult(confidence, warnings, errors, report.validationStatus);
}

// ─── Medication Validation ───────────────────────────────────────────────

export function validateMedicationRecord(
  med: { rxnormCode?: string; medicationName: string },
  sourceDocConfidence: number,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let confidence = sourceDocConfidence;

  // RxNorm code format validation if present
  const rxResult = validateCode(SYSTEM_RXNORM, med.rxnormCode, 'RxNorm', warnings, errors);
  if (!rxResult.valid) {
    confidence -= FAILED_CODE_FORMAT_PENALTY;
  }

  if (warnings.length > 0 || errors.length > 0) {
    logger.debug(
      `Medication validation for "${med.medicationName}": ${warnings.length} warnings, ${errors.length} errors`,
    );
  }

  return deriveResult(confidence, warnings, errors);
}
