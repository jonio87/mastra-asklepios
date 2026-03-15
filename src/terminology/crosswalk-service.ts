/**
 * Crosswalk Service — explicit cross-system code mappings.
 *
 * Provides validated translations between code systems using
 * FHIR ConceptMap-style entries. Currently supports:
 * - SNOMED CT ↔ ICD-10 (bidirectional)
 *
 * Data source: data/terminology/crosswalks/snomed-icd10.json
 *
 * Design: Crosswalk entries are loaded from JSON, indexed by source code
 * for O(1) lookup, and exposed via translate().
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SYSTEM_ICD10,
  SYSTEM_SNOMED,
  type CrosswalkResult,
} from './terminology-service.js';

// ─── Data directory ───────────────────────────────────────────────────────

let CROSSWALK_DIR: string;
try {
  const thisFile = fileURLToPath(import.meta.url);
  CROSSWALK_DIR = join(dirname(thisFile), '..', '..', 'data', 'terminology', 'crosswalks');
} catch {
  CROSSWALK_DIR = join(process.cwd(), 'data', 'terminology', 'crosswalks');
}

// ─── Crosswalk Entry (JSON file format) ───────────────────────────────────

interface CrosswalkEntry {
  snomedCode: string;
  icd10Code: string;
  conditionName: string;
  relationship: 'equivalent' | 'broader' | 'narrower' | 'related';
}

// ─── Indexes ──────────────────────────────────────────────────────────────

let snomedToIcd10: Map<string, CrosswalkEntry[]> | null = null;
let icd10ToSnomed: Map<string, CrosswalkEntry[]> | null = null;

function ensureLoaded(): void {
  if (snomedToIcd10 && icd10ToSnomed) return;

  const path = join(CROSSWALK_DIR, 'snomed-icd10.json');
  const raw = readFileSync(path, 'utf-8');
  const entries = JSON.parse(raw) as CrosswalkEntry[];

  snomedToIcd10 = new Map();
  icd10ToSnomed = new Map();

  for (const entry of entries) {
    // Index by SNOMED code
    const snomedList = snomedToIcd10.get(entry.snomedCode) ?? [];
    snomedList.push(entry);
    snomedToIcd10.set(entry.snomedCode, snomedList);

    // Index by ICD-10 code
    const icd10List = icd10ToSnomed.get(entry.icd10Code) ?? [];
    icd10List.push(entry);
    icd10ToSnomed.set(entry.icd10Code, icd10List);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Translate a code from one system to another via crosswalk.
 *
 * Supports:
 * - SNOMED → ICD-10
 * - ICD-10 → SNOMED
 */
export function translateCode(
  sourceSystem: string,
  sourceCode: string,
  targetSystem: string,
): CrosswalkResult[] {
  ensureLoaded();

  if (sourceSystem === SYSTEM_SNOMED && targetSystem === SYSTEM_ICD10) {
    const entries = snomedToIcd10!.get(sourceCode) ?? [];
    return entries.map((e) => ({
      sourceSystem: SYSTEM_SNOMED,
      sourceCode: e.snomedCode,
      sourceDisplay: e.conditionName,
      targetSystem: SYSTEM_ICD10,
      targetCode: e.icd10Code,
      targetDisplay: e.conditionName,
      relationship: e.relationship,
    }));
  }

  if (sourceSystem === SYSTEM_ICD10 && targetSystem === SYSTEM_SNOMED) {
    const entries = icd10ToSnomed!.get(sourceCode) ?? [];
    return entries.map((e) => ({
      sourceSystem: SYSTEM_ICD10,
      sourceCode: e.icd10Code,
      sourceDisplay: e.conditionName,
      targetSystem: SYSTEM_SNOMED,
      targetCode: e.snomedCode,
      targetDisplay: e.conditionName,
      relationship: e.relationship,
    }));
  }

  return [];
}

/**
 * Get all crosswalk entries (for debugging/export).
 */
export function getAllCrosswalks(): CrosswalkEntry[] {
  ensureLoaded();
  const all: CrosswalkEntry[] = [];
  for (const entries of snomedToIcd10!.values()) {
    all.push(...entries);
  }
  return all;
}

/** Reset caches (for testing). */
export function resetCrosswalkCache(): void {
  snomedToIcd10 = null;
  icd10ToSnomed = null;
}
