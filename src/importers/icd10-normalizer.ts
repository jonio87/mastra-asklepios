/**
 * ICD-10 Code Normalizer
 *
 * Maps clinical condition names to ICD-10-CM/ICD-10 diagnosis codes.
 * Supports both ICD-10-CM (US) and ICD-10-PL (Polish) code extensions.
 *
 * System URI: http://hl7.org/fhir/sid/icd-10
 *
 * Data source: data/terminology/icd10-code-map.json (177 entries)
 * Codes verified against ICD-10-CM 2026 tabular list.
 */

import { getIcd10CodeMap } from './terminology-loader.js';

/** System URI for ICD-10 codes in FHIR resources */
export const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10';

/**
 * Look up ICD-10 code for a clinical condition name.
 *
 * Matching strategy:
 * 1. Exact (case-sensitive)
 * 2. Case-insensitive exact
 * 3. Substring (input contains a map key, longest match wins)
 *
 * @param conditionName — Clinical condition name in English
 * @returns ICD-10 code string or undefined
 */
export function getIcd10Code(conditionName: string): string | undefined {
  const map = getIcd10CodeMap();
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

  // 3. Substring matching (longest match wins)
  let bestMatch: { key: string; code: string } | undefined;
  for (const [key, code] of Object.entries(map)) {
    if (key.length >= 8 && lower.includes(key.toLowerCase())) {
      if (!bestMatch || key.length > bestMatch.key.length) {
        bestMatch = { key, code };
      }
    }
  }
  if (bestMatch) return bestMatch.code;

  return undefined;
}
