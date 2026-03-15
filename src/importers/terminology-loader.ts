/**
 * Terminology data loader — reads externalized JSON terminology maps from data/terminology/.
 *
 * Maps are loaded once on first access and cached in memory.
 * Validates code formats on load (LOINC: /^\d{1,7}-\d$/, SNOMED: /^\d{6,18}$/).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve data directory — works in both ESM runtime and CJS (Jest/ts-jest).
// import.meta.url approach first; fall back to process.cwd() for Jest.
let DATA_DIR: string;
try {
  const thisFile = fileURLToPath(import.meta.url);
  DATA_DIR = join(dirname(thisFile), '..', '..', 'data', 'terminology');
} catch {
  DATA_DIR = join(process.cwd(), 'data', 'terminology');
}

// ── Format validators ──

const LOINC_FORMAT = /^\d{1,7}-\d$/;
const SNOMED_FORMAT = /^\d{6,18}$/;
const RXNORM_FORMAT = /^\d{3,10}$/;

const ICD10_FORMAT = /^[A-Z]\d{2}(\.\d{1,4})?$/;

// ── Singleton caches ──

let testNameCanonical: Record<string, string> | null = null;
let loincCodeMap: Record<string, string> | null = null;
let snomedQualitativeMap: Record<string, string> | null = null;
let snomedFindingsMap: Record<string, string> | null = null;
let icd10CodeMap: Record<string, string> | null = null;
let rxnormCodeMap: Record<string, string> | null = null;
let brandToGeneric: Record<string, string> | null = null;

// ── Generic loader ──

function loadJsonMap(filename: string): Record<string, string> {
  const path = join(DATA_DIR, filename);
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as Record<string, string>;
}

function validateCodes(
  map: Record<string, string>,
  name: string,
  pattern: RegExp,
  checkValues: boolean,
): void {
  const errors: string[] = [];
  const entries = checkValues ? Object.entries(map) : [];

  for (const [key, value] of entries) {
    if (!pattern.test(value)) {
      errors.push(`${key}: '${value}' does not match ${pattern}`);
    }
  }

  if (errors.length > 0) {
    console.warn(
      `[terminology-loader] ${name}: ${errors.length} format errors:\n  ${errors.slice(0, 5).join('\n  ')}`,
    );
  }
}

// ── Public loaders ──

export function getTestNameCanonical(): Record<string, string> {
  if (!testNameCanonical) {
    testNameCanonical = loadJsonMap('test-name-canonical.json');
  }
  return testNameCanonical;
}

export function getLoincCodeMap(): Record<string, string> {
  if (!loincCodeMap) {
    loincCodeMap = loadJsonMap('loinc-code-map.json');
    validateCodes(loincCodeMap, 'LOINC_CODE_MAP', LOINC_FORMAT, true);
  }
  return loincCodeMap;
}

export function getSnomedQualitativeMap(): Record<string, string> {
  if (!snomedQualitativeMap) {
    snomedQualitativeMap = loadJsonMap('snomed-qualitative-map.json');
    validateCodes(snomedQualitativeMap, 'SNOMED_QUALITATIVE_MAP', SNOMED_FORMAT, true);
  }
  return snomedQualitativeMap;
}

export function getRxnormCodeMap(): Record<string, string> {
  if (!rxnormCodeMap) {
    rxnormCodeMap = loadJsonMap('rxnorm-code-map.json');
    validateCodes(rxnormCodeMap, 'RXNORM_CODE_MAP', RXNORM_FORMAT, true);
  }
  return rxnormCodeMap;
}

export function getSnomedFindingsMap(): Record<string, string> {
  if (!snomedFindingsMap) {
    snomedFindingsMap = loadJsonMap('snomed-findings.json');
    validateCodes(snomedFindingsMap, 'SNOMED_FINDINGS_MAP', SNOMED_FORMAT, true);
  }
  return snomedFindingsMap;
}

export function getIcd10CodeMap(): Record<string, string> {
  if (!icd10CodeMap) {
    icd10CodeMap = loadJsonMap('icd10-code-map.json');
    validateCodes(icd10CodeMap, 'ICD10_CODE_MAP', ICD10_FORMAT, true);
  }
  return icd10CodeMap;
}

export function getBrandToGeneric(): Record<string, string> {
  if (!brandToGeneric) {
    brandToGeneric = loadJsonMap('brand-to-generic.json');
  }
  return brandToGeneric;
}

/**
 * Pre-load all terminology maps. Call at startup to surface any file/format
 * errors early instead of at first use.
 */
export function preloadTerminologyMaps(): void {
  getTestNameCanonical();
  getLoincCodeMap();
  getSnomedQualitativeMap();
  getSnomedFindingsMap();
  getIcd10CodeMap();
  getRxnormCodeMap();
  getBrandToGeneric();
}
