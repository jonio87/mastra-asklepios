import { jest } from '@jest/globals';

// Mock the store and logger BEFORE importing the tool (ESM-compatible)
const mockQueryBrainPatterns = jest.fn<() => Promise<unknown[]>>();
const mockGetBrainCaseCount = jest.fn<() => Promise<number>>();

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  getClinicalStore: () => ({
    queryBrainPatterns: mockQueryBrainPatterns,
    getBrainCaseCount: mockGetBrainCaseCount,
  }),
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Test data ───────────────────────────────────────────────────────────

const mockPatterns = [
  {
    id: 'bp-1',
    pattern: 'arachnodactyly + lens subluxation → Marfan not EDS',
    category: 'diagnostic-shortcut' as const,
    phenotypeCluster: ['arachnodactyly', 'lens subluxation'],
    supportingCases: 5,
    confidence: 0.8,
    sourceCaseLabels: ['case-001', 'case-002'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  },
  {
    id: 'bp-2',
    pattern: 'Joint hypermobility often confused with EDS when actually benign JHS',
    category: 'common-misdiagnosis' as const,
    phenotypeCluster: ['joint hypermobility'],
    supportingCases: 12,
    confidence: 0.9,
    sourceCaseLabels: ['case-003', 'case-004', 'case-005'],
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-10T00:00:00Z',
  },
  {
    id: 'bp-3',
    pattern: 'Skin biopsy collagen flower pattern distinguishes cEDS from hEDS',
    category: 'key-differentiator' as const,
    phenotypeCluster: ['skin hyperextensibility', 'easy bruising'],
    supportingCases: 3,
    confidence: 0.7,
    sourceCaseLabels: ['case-006'],
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
];

// ─── Tests ───────────────────────────────────────────────────────────────

describe('brainRecallTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(0));
  });

  async function executeTool(input: {
    symptoms: string[];
    hpoTerms?: string[];
    currentHypotheses?: string[];
  }) {
    const { brainRecallTool } = await import('./brain-recall.js');
    const execute = brainRecallTool.execute;
    if (!execute) throw new Error('Tool execute is undefined');
    return execute(input, { mastra: undefined } as never);
  }

  it('has correct tool configuration', async () => {
    const { brainRecallTool } = await import('./brain-recall.js');
    expect(brainRecallTool.id).toBe('brain-recall');
    expect(brainRecallTool.description).toContain('Brain');
    expect(brainRecallTool.description).toContain('cross-patient');
  });

  it('returns empty patterns when brain has no cases', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(0));

    const result = await executeTool({
      symptoms: ['joint hypermobility', 'skin hyperextensibility'],
    });

    expect(result.patterns).toHaveLength(0);
    expect(result.totalCasesInBrain).toBe(0);
    expect(result.querySymptoms).toEqual(['joint hypermobility', 'skin hyperextensibility']);
    expect(result.recommendation).toContain('no cases yet');
  });

  it('returns empty patterns when brain has cases but none match', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(25));

    const result = await executeTool({
      symptoms: ['fatigue', 'muscle weakness'],
    });

    expect(result.patterns).toHaveLength(0);
    expect(result.totalCasesInBrain).toBe(25);
    expect(result.recommendation).toContain('No matching patterns found');
    expect(result.recommendation).toContain('fatigue');
    expect(result.recommendation).toContain('25 cases');
  });

  it('returns matching patterns sorted by relevance', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve(mockPatterns));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(50));

    const result = await executeTool({
      symptoms: ['arachnodactyly', 'joint hypermobility'],
    });

    expect(result.patterns).toHaveLength(3);
    // Verify mapping: confidence → relevance
    expect(result.patterns[0]).toEqual({
      pattern: 'arachnodactyly + lens subluxation → Marfan not EDS',
      relevance: 0.8,
      category: 'diagnostic-shortcut',
      supportingCases: 5,
    });
    expect(result.patterns[1]).toEqual({
      pattern: 'Joint hypermobility often confused with EDS when actually benign JHS',
      relevance: 0.9,
      category: 'common-misdiagnosis',
      supportingCases: 12,
    });
  });

  it('builds recommendation with shortcut count', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([mockPatterns[0]]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(30));

    const result = await executeTool({
      symptoms: ['arachnodactyly'],
    });

    expect(result.recommendation).toContain('Found 1 matching patterns from 30 cases.');
    expect(result.recommendation).toContain('1 diagnostic shortcut(s) available.');
    expect(result.recommendation).toContain('Top pattern:');
  });

  it('builds recommendation with misdiagnosis warning count', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([mockPatterns[1]]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(40));

    const result = await executeTool({
      symptoms: ['joint hypermobility'],
    });

    expect(result.recommendation).toContain('1 common misdiagnosis warning(s).');
    expect(result.recommendation).not.toContain('diagnostic shortcut(s)');
  });

  it('passes symptoms and hpoTerms to queryBrainPatterns', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(0));

    await executeTool({
      symptoms: ['tremor', 'rigidity'],
      hpoTerms: ['HP:0001337', 'HP:0002063'],
    });

    expect(mockQueryBrainPatterns).toHaveBeenCalledWith({
      symptoms: ['tremor', 'rigidity'],
      hpoTerms: ['HP:0001337', 'HP:0002063'],
    });
  });

  it('returns total case count from getBrainCaseCount', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(142));

    const result = await executeTool({ symptoms: ['headache'] });

    expect(mockGetBrainCaseCount).toHaveBeenCalledTimes(1);
    expect(result.totalCasesInBrain).toBe(142);
  });

  it('handles empty symptoms array', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve([]));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(10));

    const result = await executeTool({ symptoms: [] });

    expect(result.querySymptoms).toEqual([]);
    expect(result.patterns).toHaveLength(0);
    // With 10 cases but no matches, recommendation mentions no matching patterns
    expect(result.recommendation).toContain('No matching patterns found');
  });

  it('includes top pattern text in recommendation when patterns exist', async () => {
    mockQueryBrainPatterns.mockImplementation(() => Promise.resolve(mockPatterns));
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(100));

    const result = await executeTool({
      symptoms: ['arachnodactyly', 'lens subluxation'],
    });

    expect(result.recommendation).toContain(
      'Top pattern: arachnodactyly + lens subluxation → Marfan not EDS',
    );
  });

  it('builds recommendation with both shortcuts and misdiagnosis warnings', async () => {
    mockQueryBrainPatterns.mockImplementation(() =>
      Promise.resolve([mockPatterns[0], mockPatterns[1]]),
    );
    mockGetBrainCaseCount.mockImplementation(() => Promise.resolve(60));

    const result = await executeTool({
      symptoms: ['arachnodactyly', 'joint hypermobility'],
    });

    expect(result.recommendation).toContain('Found 2 matching patterns from 60 cases.');
    expect(result.recommendation).toContain('1 diagnostic shortcut(s) available.');
    expect(result.recommendation).toContain('1 common misdiagnosis warning(s).');
  });
});
