import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockAddResearchFinding = jest
  .fn<() => Promise<{ id: string; duplicate: boolean }>>()
  .mockResolvedValue({
    id: 'f-1',
    duplicate: false,
  });

const mockStore = {
  queryLabs: jest
    .fn<
      () => Promise<
        Array<{ testName: string; value: string | number; unit: string; flag?: string }>
      >
    >()
    .mockResolvedValue([]),
  queryTreatments: jest
    .fn<() => Promise<Array<{ medication: string; drugClass?: string }>>>()
    .mockResolvedValue([]),
  queryConsultations: jest
    .fn<() => Promise<Array<{ specialty: string; conclusions?: string }>>>()
    .mockResolvedValue([]),
  addResearchFinding: mockAddResearchFinding,
};

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  getClinicalStore: () => mockStore,
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockGetBiomedicalTools = jest
  .fn<() => Promise<Record<string, unknown>>>()
  .mockResolvedValue({});

jest.unstable_mockModule('../clients/biomedical-mcp.js', () => ({
  getBiomedicalTools: mockGetBiomedicalTools,
}));

// biome-ignore lint/suspicious/noExplicitAny: dynamically imported
let trialEligibilityTool: any;

beforeAll(async () => {
  const mod = await import('./trial-eligibility.js');
  trialEligibilityTool = mod.trialEligibilityTool;
});

// ─── Helpers ────────────────────────────────────────────────────────────

function makeTrialText(opts: {
  nctId: string;
  title: string;
  phase?: string;
  status?: string;
  conditions?: string;
  inclusion?: string[];
  exclusion?: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Title: ${opts.title}`);
  if (opts.phase) lines.push(`Phase ${opts.phase}`);
  lines.push(`Status: ${opts.status ?? 'Recruiting'}`);
  if (opts.conditions) lines.push(`Conditions: ${opts.conditions}`);
  lines.push('');
  if (opts.inclusion && opts.inclusion.length > 0) {
    lines.push('Inclusion Criteria:');
    for (const c of opts.inclusion) lines.push(`- ${c}`);
  }
  if (opts.exclusion && opts.exclusion.length > 0) {
    lines.push('Exclusion Criteria:');
    for (const c of opts.exclusion) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

function makeMockTrialTool(trialTexts: Map<string, string>) {
  return {
    execute: jest
      .fn<(input: Record<string, unknown>, ctx: unknown) => Promise<string>>()
      .mockImplementation(async (input: Record<string, unknown>) => {
        const nctId = (input['nct_id'] as string) ?? (input['query'] as string);
        return trialTexts.get(nctId) ?? '';
      }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('trialEligibilityTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.queryLabs.mockResolvedValue([]);
    mockStore.queryTreatments.mockResolvedValue([]);
    mockStore.queryConsultations.mockResolvedValue([]);
    mockAddResearchFinding.mockResolvedValue({ id: 'f-1', duplicate: false });
    mockGetBiomedicalTools.mockResolvedValue({});
  });

  it('matches age/sex criteria from patient data', async () => {
    // Patient has a diagnosis that matches an inclusion criterion
    mockStore.queryConsultations.mockResolvedValue([
      { specialty: 'Oncology', conclusions: 'non-small cell lung cancer' },
    ]);

    const trialText = makeTrialText({
      nctId: 'NCT12345678',
      title: 'Lung Cancer Trial',
      phase: '3',
      inclusion: ['Diagnosis of non-small cell lung cancer', 'Age >= 18 years'],
      exclusion: [],
    });

    const trialTexts = new Map([['NCT12345678', trialText]]);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT12345678'],
    });

    expect(result.evaluatedTrials.length).toBe(1);
    const trial = result.evaluatedTrials[0];
    // Diagnosis criterion should be met
    const diagnosisMet = trial.patientMatch.metCriteria.find((c: Record<string, unknown>) =>
      (c['criterion'] as string).toLowerCase().includes('non-small cell'),
    );
    expect(diagnosisMet).toBeDefined();
    // Age criterion should be unknown (no age data in store)
    expect(trial.patientMatch.unknownCriteria.length).toBeGreaterThanOrEqual(1);
  });

  it('detects lab-based exclusion criteria', async () => {
    // Patient is taking a medication that appears in exclusion criteria
    mockStore.queryTreatments.mockResolvedValue([{ medication: 'warfarin' }]);

    const trialText = makeTrialText({
      nctId: 'NCT12345678',
      title: 'Anticoagulant Trial',
      inclusion: ['Confirmed diagnosis of atrial fibrillation'],
      exclusion: ['Current use of warfarin or other vitamin K antagonists'],
    });

    const trialTexts = new Map([['NCT12345678', trialText]]);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT12345678'],
    });

    const trial = result.evaluatedTrials[0];
    const exclusionFail = trial.patientMatch.failedCriteria.find((c: Record<string, unknown>) =>
      (c['criterion'] as string).includes('EXCLUSION'),
    );
    expect(exclusionFail).toBeDefined();
    expect((exclusionFail as Record<string, unknown>)['reason']).toContain('warfarin');
  });

  it('marks unknown criteria for missing data', async () => {
    // No patient data at all — all criteria should be unknown
    const trialText = makeTrialText({
      nctId: 'NCT12345678',
      title: 'Generic Trial',
      inclusion: [
        'ECOG performance status 0-1',
        'Adequate hepatic function with bilirubin within normal limits',
      ],
      exclusion: [],
    });

    const trialTexts = new Map([['NCT12345678', trialText]]);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT12345678'],
    });

    const trial = result.evaluatedTrials[0];
    expect(trial.patientMatch.unknownCriteria.length).toBeGreaterThanOrEqual(1);
  });

  it('computes correct match scores', async () => {
    // Patient has diagnosis matching 1 of 2 inclusion criteria
    mockStore.queryConsultations.mockResolvedValue([
      { specialty: 'Rheumatology', conclusions: 'rheumatoid arthritis' },
    ]);

    const trialText = makeTrialText({
      nctId: 'NCT12345678',
      title: 'RA Trial',
      inclusion: ['Diagnosis of rheumatoid arthritis', 'Failed at least 2 DMARDs previously'],
      exclusion: [],
    });

    const trialTexts = new Map([['NCT12345678', trialText]]);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT12345678'],
    });

    const trial = result.evaluatedTrials[0];
    // matchScore = metCriteria.length / totalCriteria
    // 1 met, 1 unknown → score = 1/2 = 0.5
    expect(trial.patientMatch.matchScore).toBe(0.5);
  });

  it('handles empty trial list gracefully', async () => {
    // No trial tool available and no NCT IDs
    mockGetBiomedicalTools.mockResolvedValue({});

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: [],
    });

    expect(result.evaluatedTrials).toEqual([]);
    expect(result.bestMatches).toEqual([]);
  });

  it('classifies eligibility as likely/unlikely/insufficient-data', async () => {
    // Trial 1: patient meets all criteria → likely
    // Trial 2: patient fails exclusion → unlikely
    // Trial 3: all criteria unknown → insufficient-data
    mockStore.queryConsultations.mockResolvedValue([
      { specialty: 'Oncology', conclusions: 'breast cancer' },
    ]);
    mockStore.queryTreatments.mockResolvedValue([{ medication: 'methotrexate' }]);

    const trial1 = makeTrialText({
      nctId: 'NCT00000001',
      title: 'Breast Cancer Trial',
      inclusion: ['Diagnosis of breast cancer'],
      exclusion: [],
    });

    const trial2 = makeTrialText({
      nctId: 'NCT00000002',
      title: 'Immunotherapy Trial',
      inclusion: ['Diagnosis of breast cancer'],
      exclusion: ['Current use of methotrexate'],
    });

    const trial3 = makeTrialText({
      nctId: 'NCT00000003',
      title: 'Genomic Trial',
      inclusion: [
        'BRCA1/2 mutation confirmed by genetic testing',
        'Prior platinum-based chemotherapy completed',
      ],
      exclusion: [],
    });

    const trialTexts = new Map([
      ['NCT00000001', trial1],
      ['NCT00000002', trial2],
      ['NCT00000003', trial3],
    ]);

    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT00000001', 'NCT00000002', 'NCT00000003'],
    });

    const eligibilities = result.evaluatedTrials.map((t: Record<string, unknown>) => {
      const pm = t['patientMatch'] as Record<string, unknown>;
      return { nctId: t['nctId'], eligible: pm['eligible'] };
    });

    const trial1Result = eligibilities.find(
      (e: Record<string, unknown>) => e['nctId'] === 'NCT00000001',
    );
    const trial2Result = eligibilities.find(
      (e: Record<string, unknown>) => e['nctId'] === 'NCT00000002',
    );
    const trial3Result = eligibilities.find(
      (e: Record<string, unknown>) => e['nctId'] === 'NCT00000003',
    );

    expect(trial1Result?.['eligible']).toBe('likely');
    expect(trial2Result?.['eligible']).toBe('unlikely');
    expect(trial3Result?.['eligible']).toBe('insufficient-data');
  });

  it('identifies best matches by score', async () => {
    mockStore.queryConsultations.mockResolvedValue([
      { specialty: 'Oncology', conclusions: 'lung cancer' },
    ]);

    const goodTrial = makeTrialText({
      nctId: 'NCT00000001',
      title: 'Good Match Trial',
      inclusion: ['Diagnosis of lung cancer'],
      exclusion: [],
    });

    const poorTrial = makeTrialText({
      nctId: 'NCT00000002',
      title: 'Poor Match Trial',
      inclusion: [
        'Diagnosis of pancreatic cancer',
        'KRAS mutation confirmed',
        'Prior gemcitabine therapy',
      ],
      exclusion: [],
    });

    const trialTexts = new Map([
      ['NCT00000001', goodTrial],
      ['NCT00000002', poorTrial],
    ]);

    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    const result = await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT00000001', 'NCT00000002'],
    });

    // Best matches should include the good trial (likely eligible)
    expect(result.bestMatches).toContain('NCT00000001');
    // Trials are sorted by match score (descending)
    expect(result.evaluatedTrials[0].nctId).toBe('NCT00000001');
  });

  it('auto-persists trial findings', async () => {
    mockStore.queryConsultations.mockResolvedValue([
      { specialty: 'Oncology', conclusions: 'melanoma' },
    ]);

    const trialText = makeTrialText({
      nctId: 'NCT99999999',
      title: 'Melanoma Immunotherapy Trial',
      inclusion: ['Diagnosis of melanoma'],
      exclusion: [],
    });

    const trialTexts = new Map([['NCT99999999', trialText]]);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_clinical_trial_searcher: makeMockTrialTool(trialTexts),
    });

    await trialEligibilityTool.execute({
      patientId: 'p-1',
      nctIds: ['NCT99999999'],
    });

    expect(mockAddResearchFinding).toHaveBeenCalled();
    const call = (mockAddResearchFinding.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call['patientId']).toBe('p-1');
    expect(call['sourceTool']).toBe('trial-eligibility');
    expect(call['externalId']).toBe('NCT99999999');
    expect(call['externalIdType']).toBe('nct');
    expect(call['source']).toBe('ClinicalTrials.gov');
  });
});
