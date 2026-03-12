import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { LabResult } from '../schemas/clinical-record.js';
import { ClinicalStore } from './clinical-store.js';

const store = new ClinicalStore('file::memory:?cache=shared');

beforeAll(async () => {
  await store.ensureInitialized();
});

afterAll(async () => {
  await store.close();
});

function makeLab(overrides: Partial<LabResult> & { id: string; testName: string }): LabResult {
  return {
    patientId: 'test-patient',
    value: 5.0,
    unit: 'mg/dl',
    date: '2025-01-15',
    source: 'Test Lab',
    ...overrides,
  };
}

describe('addLabResultsBatch', () => {
  it('returns zero for empty array', async () => {
    const result = await store.addLabResultsBatch([]);
    expect(result.inserted).toBe(0);
  });

  it('inserts a single lab result', async () => {
    const lab = makeLab({ id: 'batch-single-1', testName: 'WBC' });
    const result = await store.addLabResultsBatch([lab]);
    expect(result.inserted).toBe(1);

    const labs = await store.queryLabs({ patientId: 'test-patient', testName: 'WBC' });
    expect(labs.length).toBeGreaterThanOrEqual(1);
    const found = labs.find((l) => l.id === 'batch-single-1');
    expect(found).toBeDefined();
    expect(found?.testName).toBe('WBC');
  });

  it('inserts multiple lab results in a batch', async () => {
    const labs = Array.from({ length: 50 }, (_, i) =>
      makeLab({
        id: `batch-multi-${i}`,
        testName: `Test-${i}`,
        value: i * 1.5,
      }),
    );

    const result = await store.addLabResultsBatch(labs);
    expect(result.inserted).toBe(50);

    const queried = await store.queryLabs({ patientId: 'test-patient' });
    const batchIds = queried.filter((l) => l.id.startsWith('batch-multi-'));
    expect(batchIds.length).toBe(50);
  });

  it('handles batches larger than 100 (chunking)', async () => {
    const labs = Array.from({ length: 150 }, (_, i) =>
      makeLab({
        id: `batch-large-${i}`,
        testName: `LargeTest-${i}`,
        value: i,
      }),
    );

    const result = await store.addLabResultsBatch(labs);
    expect(result.inserted).toBe(150);

    const queried = await store.queryLabs({ patientId: 'test-patient' });
    const largeIds = queried.filter((l) => l.id.startsWith('batch-large-'));
    expect(largeIds.length).toBe(150);
  });

  it('is idempotent with deterministic IDs', async () => {
    const labs = [
      makeLab({ id: 'batch-idem-1', testName: 'Glucose', value: 90 }),
      makeLab({ id: 'batch-idem-2', testName: 'Cholesterol', value: 200 }),
    ];

    // Insert twice
    await store.addLabResultsBatch(labs);
    await store.addLabResultsBatch(labs);

    const queried = await store.queryLabs({ patientId: 'test-patient' });
    const idemIds = queried.filter((l) => l.id.startsWith('batch-idem-'));
    // Should have exactly 2, not 4
    expect(idemIds.length).toBe(2);
  });

  it('preserves evidence provenance fields', async () => {
    const lab = makeLab({
      id: 'batch-prov-1',
      testName: 'WBC-prov',
      evidenceTier: 'T1-official',
      validationStatus: 'confirmed',
      sourceCredibility: 98,
    });

    await store.addLabResultsBatch([lab]);

    const queried = await store.queryLabs({ patientId: 'test-patient', testName: 'WBC-prov' });
    const found = queried.find((l) => l.id === 'batch-prov-1');
    expect(found).toBeDefined();
    expect(found?.evidenceTier).toBe('T1-official');
    expect(found?.validationStatus).toBe('confirmed');
    expect(found?.sourceCredibility).toBe(98);
  });
});
