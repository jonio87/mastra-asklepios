import { describe, expect, it, beforeEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mock terminology-loader (import.meta.url breaks in Jest CJS mode)
const dataDir = join(process.cwd(), 'data', 'terminology');
const loadJson = (f: string) =>
  JSON.parse(readFileSync(join(dataDir, f), 'utf-8')) as Record<string, string>;

jest.mock('../importers/terminology-loader.js', () => ({
  getTestNameCanonical: () => loadJson('test-name-canonical.json'),
  getLoincCodeMap: () => loadJson('loinc-code-map.json'),
  getSnomedQualitativeMap: () => loadJson('snomed-qualitative-map.json'),
  getSnomedFindingsMap: () => loadJson('snomed-findings.json'),
  getIcd10CodeMap: () => loadJson('icd10-code-map.json'),
  getRxnormCodeMap: () => loadJson('rxnorm-code-map.json'),
  getBrandToGeneric: () => loadJson('brand-to-generic.json'),
  preloadTerminologyMaps: () => {},
}));

// Mock loinc-lookup and embedding search (used by normalizer.ts)
jest.mock('../importers/loinc-lookup.js', () => ({
  searchLoincSync: () => undefined,
  initLoincLookup: async () => {},
}));

jest.mock('../importers/loinc-embedding-search.js', () => ({
  searchLoincByEmbedding: async () => undefined,
  isEmbeddingSearchReady: () => false,
  initLoincEmbeddingSearch: async () => {},
}));

jest.mock('../importers/loinc-axis-search.js', () => ({
  searchByAxes: () => undefined,
  isAxisSearchReady: () => false,
  initAxisSearch: async () => {},
}));

// Mock crosswalk-service file reader (import.meta.url issue)
const crosswalkDir = join(process.cwd(), 'data', 'terminology', 'crosswalks');
jest.mock('./crosswalk-service.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const entries = JSON.parse(
    fs.readFileSync(path.join(crosswalkDir, 'snomed-icd10.json'), 'utf-8'),
  ) as Array<{
    snomedCode: string;
    icd10Code: string;
    conditionName: string;
    relationship: string;
  }>;

  const snomedToIcd10 = new Map<
    string,
    Array<{ snomedCode: string; icd10Code: string; conditionName: string; relationship: string }>
  >();
  const icd10ToSnomed = new Map<
    string,
    Array<{ snomedCode: string; icd10Code: string; conditionName: string; relationship: string }>
  >();

  for (const entry of entries) {
    const sl = snomedToIcd10.get(entry.snomedCode) ?? [];
    sl.push(entry);
    snomedToIcd10.set(entry.snomedCode, sl);
    const il = icd10ToSnomed.get(entry.icd10Code) ?? [];
    il.push(entry);
    icd10ToSnomed.set(entry.icd10Code, il);
  }

  return {
    translateCode: (
      sourceSystem: string,
      sourceCode: string,
      targetSystem: string,
    ) => {
      const SNOMED = 'http://snomed.info/sct';
      const ICD10 = 'http://hl7.org/fhir/sid/icd-10';
      if (sourceSystem === SNOMED && targetSystem === ICD10) {
        return (snomedToIcd10.get(sourceCode) ?? []).map(
          (e: { snomedCode: string; icd10Code: string; conditionName: string; relationship: string }) => ({
            sourceSystem: SNOMED,
            sourceCode: e.snomedCode,
            sourceDisplay: e.conditionName,
            targetSystem: ICD10,
            targetCode: e.icd10Code,
            targetDisplay: e.conditionName,
            relationship: e.relationship,
          }),
        );
      }
      if (sourceSystem === ICD10 && targetSystem === SNOMED) {
        return (icd10ToSnomed.get(sourceCode) ?? []).map(
          (e: { snomedCode: string; icd10Code: string; conditionName: string; relationship: string }) => ({
            sourceSystem: ICD10,
            sourceCode: e.icd10Code,
            sourceDisplay: e.conditionName,
            targetSystem: SNOMED,
            targetCode: e.snomedCode,
            targetDisplay: e.conditionName,
            relationship: e.relationship,
          }),
        );
      }
      return [];
    },
    getAllCrosswalks: () => entries,
    resetCrosswalkCache: () => {},
  };
});

import { initTerminologyProviders, resetTerminologyInit } from './init.js';
import {
  getTerminologyService,
  resetTerminologyService,
  SYSTEM_ICD10,
  SYSTEM_LOINC,
  SYSTEM_RXNORM,
  SYSTEM_SNOMED,
} from './terminology-service.js';

beforeEach(() => {
  resetTerminologyService();
  resetTerminologyInit();
  initTerminologyProviders();
});

describe('TerminologyService', () => {
  describe('lookup', () => {
    it('looks up LOINC code for WBC', () => {
      const svc = getTerminologyService();
      const result = svc.lookup(SYSTEM_LOINC, 'WBC');
      expect(result).toBeDefined();
      expect(result!.system).toBe(SYSTEM_LOINC);
      expect(result!.code).toBe('6690-2');
    });

    it('looks up SNOMED code for Tension-type headache', () => {
      const svc = getTerminologyService();
      const result = svc.lookup(SYSTEM_SNOMED, 'Tension-type headache');
      expect(result).toBeDefined();
      expect(result!.system).toBe(SYSTEM_SNOMED);
      expect(result!.code).toBe('398057008');
    });

    it('looks up RxNorm code for pregabalin', () => {
      const svc = getTerminologyService();
      const result = svc.lookup(SYSTEM_RXNORM, 'pregabalin');
      expect(result).toBeDefined();
      expect(result!.system).toBe(SYSTEM_RXNORM);
      expect(result!.code).toBe('187832');
    });

    it('looks up ICD-10 code for Tension-type headache', () => {
      const svc = getTerminologyService();
      const result = svc.lookup(SYSTEM_ICD10, 'Tension-type headache');
      expect(result).toBeDefined();
      expect(result!.system).toBe(SYSTEM_ICD10);
      expect(result!.code).toMatch(/^G44/);
    });

    it('returns undefined for unknown term', () => {
      const svc = getTerminologyService();
      expect(svc.lookup(SYSTEM_LOINC, 'xyzzy-nonexistent-test')).toBeUndefined();
    });

    it('returns undefined for unregistered system', () => {
      const svc = getTerminologyService();
      expect(svc.lookup('http://example.com/unknown', 'test')).toBeUndefined();
    });
  });

  describe('translate (crosswalk)', () => {
    it('translates SNOMED to ICD-10 for tension-type headache', () => {
      const svc = getTerminologyService();
      const results = svc.translate(SYSTEM_SNOMED, '398057008', SYSTEM_ICD10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.targetSystem).toBe(SYSTEM_ICD10);
      expect(results[0]!.targetCode).toMatch(/^G44/);
      expect(results[0]!.relationship).toBe('equivalent');
    });

    it('translates ICD-10 to SNOMED (reverse direction)', () => {
      const svc = getTerminologyService();
      const fwd = svc.translate(SYSTEM_SNOMED, '398057008', SYSTEM_ICD10);
      expect(fwd.length).toBeGreaterThan(0);
      const icd10Code = fwd[0]!.targetCode;

      const rev = svc.translate(SYSTEM_ICD10, icd10Code, SYSTEM_SNOMED);
      expect(rev.length).toBeGreaterThan(0);
      expect(rev[0]!.targetCode).toBe('398057008');
    });

    it('returns empty array for unknown source code', () => {
      const svc = getTerminologyService();
      const results = svc.translate(SYSTEM_SNOMED, '999999999', SYSTEM_ICD10);
      expect(results).toEqual([]);
    });

    it('returns empty array for unregistered crosswalk', () => {
      const svc = getTerminologyService();
      const results = svc.translate(SYSTEM_LOINC, '6690-2', SYSTEM_RXNORM);
      expect(results).toEqual([]);
    });
  });

  describe('validate', () => {
    it('validates LOINC code with valid format', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_LOINC, '6690-2');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid LOINC format', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_LOINC, 'NOT-A-CODE');
      expect(result.valid).toBe(false);
      expect(result.warnings).toBeDefined();
    });

    it('validates known SNOMED code', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_SNOMED, '398057008');
      expect(result.valid).toBe(true);
      expect(result.active).toBe(true);
    });

    it('rejects unknown SNOMED code', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_SNOMED, '999999999');
      expect(result.valid).toBe(false);
    });

    it('validates known ICD-10 code', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_ICD10, 'G44.209');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid ICD-10 format', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_ICD10, '123');
      expect(result.valid).toBe(false);
    });

    it('validates known RxNorm code', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_RXNORM, '187832');
      expect(result.valid).toBe(true);
    });

    it('rejects unknown RxNorm code', () => {
      const svc = getTerminologyService();
      const result = svc.validate(SYSTEM_RXNORM, '999999');
      expect(result.valid).toBe(false);
    });

    it('returns invalid for unregistered system', () => {
      const svc = getTerminologyService();
      const result = svc.validate('http://example.com/unknown', '123');
      expect(result.valid).toBe(false);
      expect(result.warnings).toBeDefined();
    });
  });

  describe('registeredSystems', () => {
    it('lists all 4 code systems', () => {
      const svc = getTerminologyService();
      const systems = svc.registeredSystems();
      expect(systems).toContain(SYSTEM_LOINC);
      expect(systems).toContain(SYSTEM_SNOMED);
      expect(systems).toContain(SYSTEM_ICD10);
      expect(systems).toContain(SYSTEM_RXNORM);
    });
  });

  describe('registeredCrosswalks', () => {
    it('lists SNOMED↔ICD-10 crosswalks', () => {
      const svc = getTerminologyService();
      const crosswalks = svc.registeredCrosswalks();
      expect(crosswalks).toContain(`${SYSTEM_SNOMED}|${SYSTEM_ICD10}`);
      expect(crosswalks).toContain(`${SYSTEM_ICD10}|${SYSTEM_SNOMED}`);
    });
  });
});
