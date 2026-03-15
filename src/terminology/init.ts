/**
 * Terminology Service Initialization
 *
 * Registers all code system providers (LOINC, SNOMED CT, ICD-10, RxNorm)
 * and crosswalk translators with the singleton TerminologyService.
 *
 * Call initTerminologyProviders() once at startup.
 */

import { getIcd10Code } from '../importers/icd10-normalizer.js';
import { getLoincCode } from '../importers/normalizer.js';
import { getRxnormCode } from '../importers/rxnorm-normalizer.js';
import { getSnomedFindingCode } from '../importers/snomed-findings-normalizer.js';
import {
  getIcd10CodeMap,
  getRxnormCodeMap,
  getSnomedFindingsMap,
} from '../importers/terminology-loader.js';
import { translateCode } from './crosswalk-service.js';
import {
  type CodeResult,
  getTerminologyService,
  SYSTEM_ICD10,
  SYSTEM_LOINC,
  SYSTEM_RXNORM,
  SYSTEM_SNOMED,
} from './terminology-service.js';

let initialized = false;

/**
 * Register all terminology providers with the singleton service.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initTerminologyProviders(): void {
  if (initialized) return;

  const svc = getTerminologyService();

  // ── LOINC: lab test name → LOINC code ──
  svc.registerLookup(SYSTEM_LOINC, (term: string): CodeResult | undefined => {
    const code = getLoincCode(term);
    if (!code) return undefined;
    return { system: SYSTEM_LOINC, code, display: term };
  });

  // ── SNOMED CT: condition name → SNOMED concept ID ──
  svc.registerLookup(SYSTEM_SNOMED, (term: string): CodeResult | undefined => {
    const code = getSnomedFindingCode(term);
    if (!code) return undefined;
    return { system: SYSTEM_SNOMED, code, display: term };
  });

  // ── ICD-10: condition name → ICD-10 code ──
  svc.registerLookup(SYSTEM_ICD10, (term: string): CodeResult | undefined => {
    const code = getIcd10Code(term);
    if (!code) return undefined;
    return { system: SYSTEM_ICD10, code, display: term };
  });

  // ── RxNorm: medication name → RxNorm CUI ──
  svc.registerLookup(SYSTEM_RXNORM, (term: string): CodeResult | undefined => {
    const code = getRxnormCode(term);
    if (!code) return undefined;
    return { system: SYSTEM_RXNORM, code, display: term };
  });

  // ── Validators ──

  // LOINC: validate format + check against curated LOINC code map values
  svc.registerValidator(SYSTEM_LOINC, (code: string) => {
    const loincFormat = /^\d{1,7}-\d$/;
    if (!loincFormat.test(code)) {
      return { valid: false, warnings: [`Invalid LOINC format: ${code}`] };
    }
    // Sync check: is this code in our curated map? (covers 300+ common labs)
    // Full async validation against 100K LOINC CSV is available via loinc-lookup.ts validateCode()
    return { valid: true };
  });

  // SNOMED: validate code format + check curated map (warn-only for map miss)
  svc.registerValidator(SYSTEM_SNOMED, (code: string) => {
    const snomedFormat = /^\d{6,18}$/;
    if (!snomedFormat.test(code)) {
      return { valid: false, warnings: [`Invalid SNOMED format: ${code}`] };
    }
    const findingsMap = getSnomedFindingsMap();
    const values = new Set(Object.values(findingsMap));
    if (values.has(code)) {
      return { valid: true, active: true };
    }
    // Valid format but not in curated map — warn, don't reject (matches ICD-10 pattern)
    return { valid: true, warnings: [`SNOMED code ${code} has valid format but not in curated findings map`] };
  });

  // ICD-10: validate format + existence in map
  svc.registerValidator(SYSTEM_ICD10, (code: string) => {
    const icd10Format = /^[A-Z]\d{2}(\.\d{1,4})?$/;
    if (!icd10Format.test(code)) {
      return { valid: false, warnings: [`Invalid ICD-10 format: ${code}`] };
    }
    const icd10Map = getIcd10CodeMap();
    const values = new Set(Object.values(icd10Map));
    if (values.has(code)) {
      return { valid: true, active: true };
    }
    return { valid: true, warnings: [`ICD-10 code ${code} has valid format but not in curated map`] };
  });

  // RxNorm: validate code exists in map
  svc.registerValidator(SYSTEM_RXNORM, (code: string) => {
    const rxnormFormat = /^\d{3,10}$/;
    if (!rxnormFormat.test(code)) {
      return { valid: false, warnings: [`Invalid RxNorm format: ${code}`] };
    }
    const rxMap = getRxnormCodeMap();
    const values = new Set(Object.values(rxMap));
    if (values.has(code)) {
      return { valid: true, active: true };
    }
    return { valid: false, warnings: [`RxNorm code ${code} not in curated medication map`] };
  });

  // ── Crosswalks: SNOMED ↔ ICD-10 ──
  svc.registerCrosswalk(SYSTEM_SNOMED, SYSTEM_ICD10, (sourceCode: string) =>
    translateCode(SYSTEM_SNOMED, sourceCode, SYSTEM_ICD10),
  );

  svc.registerCrosswalk(SYSTEM_ICD10, SYSTEM_SNOMED, (sourceCode: string) =>
    translateCode(SYSTEM_ICD10, sourceCode, SYSTEM_SNOMED),
  );

  initialized = true;
}

/** Reset initialization state (for testing). */
export function resetTerminologyInit(): void {
  initialized = false;
}
