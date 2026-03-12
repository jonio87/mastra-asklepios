import { randomUUID } from 'node:crypto';
import type { GeneticVariant } from '../schemas/genetic-variant.js';
import { ClinicalStore } from './clinical-store.js';

const TEST_PATIENT = 'patient-genetics-test';
const IMPORT_DATE = '2026-03-12T00:00:00.000Z';

function makeVariant(overrides: Partial<GeneticVariant> = {}): GeneticVariant {
  return {
    id: randomUUID(),
    patientId: TEST_PATIENT,
    rsid: `rs${Math.floor(Math.random() * 999999999)}`,
    chromosome: '1',
    position: Math.floor(Math.random() * 250000000),
    genotype: 'AA',
    source: '23andMe',
    referenceGenome: 'GRCh37',
    importDate: IMPORT_DATE,
    ...overrides,
  };
}

describe('ClinicalStore — Genetic Variants', () => {
  let store: ClinicalStore;

  beforeAll(async () => {
    store = new ClinicalStore('file::memory:?cache=shared');
    await store.ensureInitialized();
  });

  afterAll(async () => {
    await store.close();
  });

  // ─── addGeneticVariant ──────────────────────────────────────────────

  describe('addGeneticVariant', () => {
    it('stores and retrieves a single genetic variant', async () => {
      const variant = makeVariant({
        rsid: 'rs548049170',
        chromosome: '1',
        position: 69869,
        genotype: 'TT',
      });

      const result = await store.addGeneticVariant(variant);
      expect(result.duplicate).toBe(false);

      const found = await store.getVariantByRsid(TEST_PATIENT, 'rs548049170');
      expect(found).toBeDefined();
      expect(found?.rsid).toBe('rs548049170');
      expect(found?.chromosome).toBe('1');
      expect(found?.position).toBe(69869);
      expect(found?.genotype).toBe('TT');
      expect(found?.source).toBe('23andMe');
      expect(found?.referenceGenome).toBe('GRCh37');
    });

    it('deduplicates by (patientId, rsid)', async () => {
      const rsid = `rs_dedup_${Date.now()}`;
      const v1 = makeVariant({ rsid, genotype: 'AA' });
      const v2 = makeVariant({ rsid, genotype: 'CC' });

      const r1 = await store.addGeneticVariant(v1);
      const r2 = await store.addGeneticVariant(v2);

      expect(r1.duplicate).toBe(false);
      expect(r2.duplicate).toBe(true);

      // Original value preserved
      const found = await store.getVariantByRsid(TEST_PATIENT, rsid);
      expect(found?.genotype).toBe('AA');
    });

    it('stores optional sourceVersion and rawLine', async () => {
      const variant = makeVariant({
        rsid: `rs_optional_${Date.now()}`,
        sourceVersion: 'v5',
        rawLine: 'rs123\t1\t100\tAA',
      });

      await store.addGeneticVariant(variant);
      const found = await store.getVariantByRsid(TEST_PATIENT, variant.rsid);

      expect(found?.sourceVersion).toBe('v5');
      expect(found?.rawLine).toBe('rs123\t1\t100\tAA');
    });

    it('allows same rsid for different patients', async () => {
      const rsid = `rs_multi_patient_${Date.now()}`;
      const v1 = makeVariant({ rsid, patientId: 'patient-a' });
      const v2 = makeVariant({ rsid, patientId: 'patient-b' });

      const r1 = await store.addGeneticVariant(v1);
      const r2 = await store.addGeneticVariant(v2);

      expect(r1.duplicate).toBe(false);
      expect(r2.duplicate).toBe(false);
    });
  });

  // ─── addGeneticVariantsBatch ────────────────────────────────────────

  describe('addGeneticVariantsBatch', () => {
    it('inserts a batch of variants', async () => {
      const variants = Array.from({ length: 10 }, (_, i) =>
        makeVariant({
          rsid: `rs_batch_${Date.now()}_${i}`,
          chromosome: '2',
          position: 1000 + i,
        }),
      );

      const result = await store.addGeneticVariantsBatch(variants);

      expect(result.inserted).toBe(10);
      expect(result.duplicates).toBe(0);
    });

    it('reports duplicates in batch', async () => {
      const rsid = `rs_batch_dup_${Date.now()}`;

      // Insert first
      await store.addGeneticVariant(makeVariant({ rsid }));

      // Batch with the same rsid + new ones
      const variants = [
        makeVariant({ rsid }), // duplicate
        makeVariant({ rsid: `${rsid}_new1` }), // new
        makeVariant({ rsid: `${rsid}_new2` }), // new
      ];

      const result = await store.addGeneticVariantsBatch(variants);
      expect(result.inserted).toBe(2);
      expect(result.duplicates).toBe(1);
    });

    it('returns zero counts for empty batch', async () => {
      const result = await store.addGeneticVariantsBatch([]);
      expect(result.inserted).toBe(0);
      expect(result.duplicates).toBe(0);
    });
  });

  // ─── queryGeneticVariants ───────────────────────────────────────────

  describe('queryGeneticVariants', () => {
    const QUERY_PATIENT = 'patient-query-test';

    beforeAll(async () => {
      // Seed test data
      const variants = [
        makeVariant({
          patientId: QUERY_PATIENT,
          rsid: 'rs_q_1',
          chromosome: '1',
          position: 100,
          genotype: 'AA',
        }),
        makeVariant({
          patientId: QUERY_PATIENT,
          rsid: 'rs_q_2',
          chromosome: '1',
          position: 200,
          genotype: 'AG',
        }),
        makeVariant({
          patientId: QUERY_PATIENT,
          rsid: 'rs_q_3',
          chromosome: '2',
          position: 300,
          genotype: '--',
        }),
        makeVariant({
          patientId: QUERY_PATIENT,
          rsid: 'rs_q_4',
          chromosome: '2',
          position: 400,
          genotype: 'TT',
        }),
        makeVariant({
          patientId: QUERY_PATIENT,
          rsid: 'rs_q_5',
          chromosome: 'X',
          position: 500,
          genotype: 'A',
        }),
      ];
      await store.addGeneticVariantsBatch(variants);
    });

    it('returns all variants for a patient', async () => {
      const results = await store.queryGeneticVariants({ patientId: QUERY_PATIENT });
      expect(results.length).toBe(5);
    });

    it('filters by chromosome', async () => {
      const results = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        chromosome: '1',
      });
      expect(results.length).toBe(2);
      expect(results.every((v) => v.chromosome === '1')).toBe(true);
    });

    it('filters by single rsid', async () => {
      const results = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        rsid: 'rs_q_3',
      });
      expect(results.length).toBe(1);
      expect(results[0]?.rsid).toBe('rs_q_3');
    });

    it('filters by multiple rsids', async () => {
      const results = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        rsids: ['rs_q_1', 'rs_q_4'],
      });
      expect(results.length).toBe(2);
      const rsids = results.map((v) => v.rsid);
      expect(rsids).toContain('rs_q_1');
      expect(rsids).toContain('rs_q_4');
    });

    it('filters by position range', async () => {
      const results = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        positionFrom: 200,
        positionTo: 400,
      });
      expect(results.length).toBe(3);
      expect(results.every((v) => v.position >= 200 && v.position <= 400)).toBe(true);
    });

    it('filters by genotype', async () => {
      const results = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        genotype: 'AG',
      });
      expect(results.length).toBe(1);
      expect(results[0]?.rsid).toBe('rs_q_2');
    });

    it('excludes no-calls when requested', async () => {
      const results = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        excludeNoCalls: true,
      });
      expect(results.length).toBe(4);
      expect(results.every((v) => v.genotype !== '--')).toBe(true);
    });

    it('respects limit and offset', async () => {
      const page1 = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        limit: 2,
        offset: 0,
      });
      const page2 = await store.queryGeneticVariants({
        patientId: QUERY_PATIENT,
        limit: 2,
        offset: 2,
      });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);

      // No overlap
      const page1Ids = new Set(page1.map((v) => v.rsid));
      const page2Ids = new Set(page2.map((v) => v.rsid));
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    it('orders results by chromosome then position', async () => {
      const results = await store.queryGeneticVariants({ patientId: QUERY_PATIENT });

      // Check ordering: chr1 < chr2 < chrX (alphabetical in SQLite)
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        if (!(prev && curr)) continue;
        if (prev.chromosome === curr.chromosome) {
          expect(curr.position).toBeGreaterThanOrEqual(prev.position);
        }
      }
    });
  });

  // ─── countGeneticVariants ───────────────────────────────────────────

  describe('countGeneticVariants', () => {
    it('returns correct count for a patient', async () => {
      const countPatient = 'patient-count-test';
      const variants = Array.from({ length: 5 }, (_, i) =>
        makeVariant({
          patientId: countPatient,
          rsid: `rs_count_${Date.now()}_${i}`,
        }),
      );
      await store.addGeneticVariantsBatch(variants);

      const count = await store.countGeneticVariants(countPatient);
      expect(count).toBe(5);
    });

    it('returns 0 for unknown patient', async () => {
      const count = await store.countGeneticVariants('patient-nonexistent');
      expect(count).toBe(0);
    });
  });

  // ─── getVariantByRsid ──────────────────────────────────────────────

  describe('getVariantByRsid', () => {
    it('returns undefined for non-existent rsid', async () => {
      const result = await store.getVariantByRsid(TEST_PATIENT, 'rs_does_not_exist');
      expect(result).toBeUndefined();
    });

    it('returns the correct variant', async () => {
      const rsid = `rs_lookup_${Date.now()}`;
      await store.addGeneticVariant(
        makeVariant({
          rsid,
          chromosome: 'MT',
          position: 72,
          genotype: 'T',
        }),
      );

      const found = await store.getVariantByRsid(TEST_PATIENT, rsid);
      expect(found).toBeDefined();
      expect(found?.chromosome).toBe('MT');
      expect(found?.position).toBe(72);
      expect(found?.genotype).toBe('T');
    });
  });
});
