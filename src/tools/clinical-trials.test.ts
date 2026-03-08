import { clinicalTrialsTool } from './clinical-trials.js';

describe('clinicalTrialsTool', () => {
  it('has correct tool configuration', () => {
    expect(clinicalTrialsTool.id).toBe('clinical-trials-search');
    expect(clinicalTrialsTool.description).toBeDefined();
    expect(clinicalTrialsTool.inputSchema).toBeDefined();
    expect(clinicalTrialsTool.outputSchema).toBeDefined();
    expect(clinicalTrialsTool.execute).toBeDefined();
  });

  it('validates search by condition', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({
      condition: 'chronic pain',
    });
    expect(result.success).toBe(true);
  });

  it('validates search by intervention', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({
      intervention: 'naltrexone',
    });
    expect(result.success).toBe(true);
  });

  it('validates NCT ID lookup', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({
      nctId: 'NCT12345678',
    });
    expect(result.success).toBe(true);
  });

  it('validates combined filters', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({
      condition: 'headache',
      intervention: 'ketamine',
      phase: 'PHASE2',
      status: 'RECRUITING',
      locationCountry: 'Poland',
      maxResults: 20,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid phase', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({
      condition: 'test',
      phase: 'PHASE5',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({
      condition: 'test',
      status: 'INVALID',
    });
    expect(result.success).toBe(false);
  });

  it('validates output schema', () => {
    const result = clinicalTrialsTool.outputSchema.safeParse({
      trials: [
        {
          nctId: 'NCT12345678',
          title: 'A Study of Low-Dose Naltrexone for Chronic Pain',
          briefTitle: 'LDN for Chronic Pain',
          status: 'Recruiting',
          phase: 'Phase 2',
          studyType: 'Interventional',
          conditions: ['Chronic Pain'],
          interventions: ['Drug: Naltrexone'],
          enrollment: 100,
          startDate: '2025-01',
          sponsor: 'University Hospital',
          summary: 'This study evaluates...',
          url: 'https://clinicaltrials.gov/study/NCT12345678',
        },
      ],
      totalCount: 1,
      query: 'naltrexone chronic pain',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty input', () => {
    const result = clinicalTrialsTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
