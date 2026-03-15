/**
 * Jest auto-mock for terminology-loader.
 *
 * terminology-loader.ts uses import.meta.url for path resolution which
 * causes SyntaxError in Jest CJS mode. This mock loads the same JSON
 * files using process.cwd() instead.
 *
 * Jest automatically picks up __mocks__/terminology-loader.ts for any
 * module that imports from './terminology-loader.js' when jest.mock()
 * is called without a factory.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data', 'terminology');

function loadJson(filename: string): Record<string, string> {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), 'utf-8')) as Record<string, string>;
}

export function getTestNameCanonical(): Record<string, string> {
  return loadJson('test-name-canonical.json');
}

export function getLoincCodeMap(): Record<string, string> {
  return loadJson('loinc-code-map.json');
}

export function getSnomedQualitativeMap(): Record<string, string> {
  return loadJson('snomed-qualitative-map.json');
}

export function getSnomedFindingsMap(): Record<string, string> {
  return loadJson('snomed-findings.json');
}

export function getIcd10CodeMap(): Record<string, string> {
  return loadJson('icd10-code-map.json');
}

export function getRxnormCodeMap(): Record<string, string> {
  return loadJson('rxnorm-code-map.json');
}

export function getBrandToGeneric(): Record<string, string> {
  return loadJson('brand-to-generic.json');
}

export function preloadTerminologyMaps(): void {
  // no-op in tests
}
