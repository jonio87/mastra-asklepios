import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock terminology-loader (import.meta.url breaks in Jest CJS mode)
const dataDir = join(process.cwd(), 'data', 'terminology');
const loadJson = (f: string) =>
  JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as Record<string, string>;

jest.mock('./terminology-loader.js', () => ({
  getTestNameCanonical: () => loadJson('test-name-canonical.json'),
  getLoincCodeMap: () => loadJson('loinc-code-map.json'),
  getSnomedQualitativeMap: () => loadJson('snomed-qualitative-map.json'),
  getSnomedFindingsMap: () => loadJson('snomed-findings.json'),
  getIcd10CodeMap: () => loadJson('icd10-code-map.json'),
  getRxnormCodeMap: () => loadJson('rxnorm-code-map.json'),
  getBrandToGeneric: () => loadJson('brand-to-generic.json'),
  preloadTerminologyMaps: () => {},
}));

import { getIcd10Code } from './icd10-normalizer.js';

describe('getIcd10Code', () => {
  it('maps Tension-type headache to G44.209', () => {
    expect(getIcd10Code('Tension-type headache')).toBe('G44.209');
  });

  it('maps Cervical spondylosis', () => {
    const code = getIcd10Code('Cervical spondylosis');
    expect(code).toBeDefined();
    expect(code).toMatch(/^M47/);
  });

  it('maps Fibromyalgia to M79.7', () => {
    expect(getIcd10Code('Fibromyalgia')).toBe('M79.7');
  });

  it('maps GERD', () => {
    const code = getIcd10Code('GERD');
    expect(code).toBeDefined();
    expect(code).toMatch(/^K21/);
  });

  it('maps Depression', () => {
    const code = getIcd10Code('Depression');
    expect(code).toBeDefined();
    expect(code).toMatch(/^F3/);
  });

  it('is case-insensitive', () => {
    const upper = getIcd10Code('TENSION-TYPE HEADACHE');
    const lower = getIcd10Code('tension-type headache');
    expect(upper).toBeDefined();
    expect(upper).toBe(lower);
  });

  it('returns undefined for unknown condition', () => {
    expect(getIcd10Code('xyzzy nonexistent condition')).toBeUndefined();
  });

  it('returns undefined for short input', () => {
    expect(getIcd10Code('ab')).toBeUndefined();
  });

  it('handles leading/trailing whitespace', () => {
    expect(getIcd10Code('  Fibromyalgia  ')).toBe('M79.7');
  });

  it('maps Trigeminal neuralgia', () => {
    const code = getIcd10Code('Trigeminal neuralgia');
    expect(code).toBeDefined();
    expect(code).toMatch(/^G50/);
  });
});
