/**
 * SNOMED CT Clinical Findings Normalizer
 *
 * Maps clinical findings, diagnoses, and conditions extracted from
 * consultation notes to SNOMED CT concept codes.
 *
 * SNOMED CT is the required coding system for FHIR Condition.code
 * per USCDI v6/v7 and US Core Implementation Guide.
 *
 * Pattern: condition name → SNOMED CT concept ID
 * System URI: http://snomed.info/sct
 *
 * Data source: data/terminology/snomed-findings.json (265 entries)
 * Verified against SNOMED CT International Edition (2025-01).
 * Codes are concept IDs from the Clinical Finding hierarchy (404684003).
 */

import { getSnomedFindingsMap } from './terminology-loader.js';

/** System URI for SNOMED CT codes in FHIR resources */
export const SNOMED_SYSTEM = 'http://snomed.info/sct';

/**
 * Look up SNOMED CT clinical finding code for a condition name.
 *
 * Performs case-insensitive lookup with common normalization:
 * - Strips leading/trailing whitespace
 * - Lowercases for comparison
 * - Handles parenthetical qualifiers
 *
 * 4-step matching strategy:
 * 1. Exact (case-sensitive)
 * 2. Case-insensitive exact
 * 3. Substring (input contains a map key, longest match wins)
 * 4. Reverse substring (map key contains the input)
 */
export function getSnomedFindingCode(conditionName: string): string | undefined {
  const map = getSnomedFindingsMap();
  const normalized = conditionName.trim();
  if (normalized.length < 3) return undefined;

  // 1. Direct lookup (case-sensitive)
  const direct = map[normalized];
  if (direct) return direct;

  // 2. Case-insensitive exact lookup
  const lower = normalized.toLowerCase();
  for (const [key, code] of Object.entries(map)) {
    if (key.toLowerCase() === lower) {
      return code;
    }
  }

  // 3. Substring matching: check if any map key appears as a substring
  // of the input (handles "Komplexes chronisches Schmerzsyndrom mit u.a." matching
  // "Komplexes chronisches Schmerzsyndrom"). Use longest match to avoid false positives.
  let bestMatch: { key: string; code: string } | undefined;
  for (const [key, code] of Object.entries(map)) {
    if (key.length >= 10 && lower.includes(key.toLowerCase())) {
      if (!bestMatch || key.length > bestMatch.key.length) {
        bestMatch = { key, code };
      }
    }
  }
  if (bestMatch) return bestMatch.code;

  // 4. Reverse: check if input is a substring of a map key (handles abbreviated inputs)
  for (const [key, code] of Object.entries(map)) {
    if (lower.length >= 10 && key.toLowerCase().includes(lower)) {
      return code;
    }
  }

  return undefined;
}
