import { beforeAll, describe, expect, it, jest } from '@jest/globals';

const mockStore = {
  queryLabs: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
};

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  getClinicalStore: () => mockStore,
}));

// biome-ignore lint/suspicious/noExplicitAny: dynamically imported in beforeAll
let testPrioritizerTool: any;

beforeAll(async () => {
  const mod = await import('./test-prioritizer.js');
  testPrioritizerTool = mod.testPrioritizerTool;
});

const TEST_PATIENT = 'patient-tp-test';

function makeTest(overrides: Record<string, unknown> = {}) {
  return {
    test: 'CBC Panel',
    targetHypothesis: 'Autoimmune cytopenia',
    expectedImpact: 'Confirms leukopenia trend',
    urgency: 'IMMEDIATE' as const,
    estimatedCostUsd: 50,
    invasiveness: 1,
    informationGain: 0.8,
    availability: 'routine' as const,
    turnaroundDays: 1,
    ...overrides,
  };
}

describe('testPrioritizerTool', () => {
  beforeAll(() => {
    mockStore.queryLabs.mockResolvedValue([]);
  });

  it('ranks high-information-gain tests first', async () => {
    const tests = [
      makeTest({ test: 'Low-info test', informationGain: 0.1, urgency: 'PARALLEL' }),
      makeTest({ test: 'High-info test', informationGain: 0.95, urgency: 'PARALLEL' }),
      makeTest({ test: 'Mid-info test', informationGain: 0.5, urgency: 'PARALLEL' }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    const ranked = result.prioritizedTests;
    expect(ranked.length).toBe(3);
    // High-info test should have a higher composite score than low-info test
    const highInfo = ranked.find((t: { test: string }) => t.test === 'High-info test');
    const lowInfo = ranked.find((t: { test: string }) => t.test === 'Low-info test');
    expect(highInfo.compositeScore).toBeGreaterThan(lowInfo.compositeScore);
  });

  it('filters out alreadyDone tests', async () => {
    const tests = [
      makeTest({ test: 'Done test', alreadyDone: true }),
      makeTest({ test: 'Pending test', alreadyDone: false }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    const names = result.prioritizedTests.map((t: { test: string }) => t.test);
    expect(names).not.toContain('Done test');
    expect(names).toContain('Pending test');
  });

  it('respects budget constraint', async () => {
    const tests = [
      makeTest({ test: 'Cheap test', estimatedCostUsd: 30, urgency: 'IMMEDIATE' }),
      makeTest({ test: 'Expensive test', estimatedCostUsd: 200, urgency: 'SHORT_TERM' }),
      makeTest({ test: 'Medium test', estimatedCostUsd: 80, urgency: 'PARALLEL' }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests, budget: 100 },
      {} as never,
    );

    // Total cost of all tests is 310, budget is 100
    // The tool trims lowest-priority tests to fit budget
    const totalIncluded = result.prioritizedTests.reduce(
      (sum: number, t: { estimatedCostUsd?: number }) => sum + (t.estimatedCostUsd ?? 0),
      0,
    );
    expect(totalIncluded).toBeLessThanOrEqual(100);
    expect(result.withinBudget).toBe(false);
  });

  it('identifies parallelizable test groups', async () => {
    const tests = [
      makeTest({ test: 'Blood draw A', urgency: 'IMMEDIATE' }),
      makeTest({ test: 'Blood draw B', urgency: 'IMMEDIATE' }),
      makeTest({ test: 'Short-term test A', urgency: 'SHORT_TERM' }),
      makeTest({ test: 'Short-term test B', urgency: 'SHORT_TERM' }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    // Should have at least one parallelizable group
    expect(result.parallelizable.length).toBeGreaterThanOrEqual(1);
    // Each group should have more than 1 test
    for (const group of result.parallelizable) {
      expect(group.length).toBeGreaterThan(1);
    }
  });

  it('handles empty test list gracefully', async () => {
    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests: [] },
      {} as never,
    );

    expect(result.prioritizedTests).toEqual([]);
    expect(result.totalEstimatedCost).toBe(0);
    expect(result.criticalPath).toEqual([]);
    expect(result.parallelizable).toEqual([]);
    expect(result.withinBudget).toBe(true);
  });

  it('applies urgency bias to scoring', async () => {
    const tests = [
      makeTest({
        test: 'Urgent test',
        urgency: 'IMMEDIATE',
        informationGain: 0.5,
        estimatedCostUsd: 200,
      }),
      makeTest({
        test: 'Cheap test',
        urgency: 'PARALLEL',
        informationGain: 0.5,
        estimatedCostUsd: 10,
      }),
    ];

    // Speed-optimize: urgencyBias = 1
    const speedResult = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests, urgencyBias: 1.0 },
      {} as never,
    );

    // Cost-optimize: urgencyBias = 0
    const costResult = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests, urgencyBias: 0.0 },
      {} as never,
    );

    const urgentSpeedScore = speedResult.prioritizedTests.find(
      (t: { test: string }) => t.test === 'Urgent test',
    ).compositeScore;
    const urgentCostScore = costResult.prioritizedTests.find(
      (t: { test: string }) => t.test === 'Urgent test',
    ).compositeScore;

    // With speed bias, urgent test should score higher than with cost bias
    expect(urgentSpeedScore).toBeGreaterThan(urgentCostScore);
  });

  it('includes rationale for each ranked test', async () => {
    const tests = [
      makeTest({
        test: 'Test with rationale',
        informationGain: 0.7,
        estimatedCostUsd: 100,
        invasiveness: 2,
      }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    const test = result.prioritizedTests[0];
    expect(test.rationale).toBeDefined();
    expect(typeof test.rationale).toBe('string');
    expect(test.rationale.length).toBeGreaterThan(0);
    // Rationale should mention info gain
    expect(test.rationale).toContain('Info gain');
  });

  it('calculates total estimated cost', async () => {
    const tests = [
      makeTest({ test: 'Test A', estimatedCostUsd: 100 }),
      makeTest({ test: 'Test B', estimatedCostUsd: 250 }),
      makeTest({ test: 'Test C', estimatedCostUsd: 75 }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    expect(result.totalEstimatedCost).toBe(425);
  });

  it('identifies critical path (sequential dependencies)', async () => {
    const tests = [
      makeTest({ test: 'Whole Exome Sequencing (WES)', urgency: 'SHORT_TERM' }),
      makeTest({ test: 'CBC Panel', urgency: 'IMMEDIATE' }),
      makeTest({ test: 'Gene panel sequencing', urgency: 'SHORT_TERM' }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    // Genetic tests should trigger critical path with genetic counseling
    expect(result.criticalPath).toContain('Genetic counseling');
    expect(result.criticalPath.length).toBeGreaterThan(1);
  });

  it('assigns composite score to each test', async () => {
    const tests = [
      makeTest({
        test: 'Scored test',
        informationGain: 0.6,
        invasiveness: 1,
        estimatedCostUsd: 50,
      }),
    ];

    const result = await testPrioritizerTool.execute(
      { patientId: TEST_PATIENT, tests },
      {} as never,
    );

    const test = result.prioritizedTests[0];
    expect(test.compositeScore).toBeDefined();
    expect(typeof test.compositeScore).toBe('number');
    expect(test.compositeScore).toBeGreaterThanOrEqual(0);
    expect(test.compositeScore).toBeLessThanOrEqual(100);
    expect(test.rank).toBe(1);
  });
});
