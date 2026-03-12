import { specialistInputTool } from './specialist-input.js';

describe('specialistInputTool', () => {
  it('has the correct tool ID', () => {
    expect(specialistInputTool.id).toBe('specialist-input');
  });

  it('has an execute function', () => {
    expect(specialistInputTool.execute).toBeDefined();
  });

  it('accepts non-model-breaking input and recommends proceed to stage 9', async () => {
    const result = await specialistInputTool.execute?.(
      {
        specialistName: 'Dr. Kowalski',
        specialty: 'Rheumatology',
        date: '2025-12-15',
        physicalExamination: ['Joint swelling bilateral MCPs', 'Dry eyes noted'],
        clinicalImpression: 'Consistent with Sjögren syndrome overlap',
        hypothesisAgreement: [
          {
            hypothesisName: 'GPA',
            verdict: 'uncertain' as const,
            reasoning: 'PR3-ANCA positive but no organ damage',
          },
        ],
        modelBreaking: false,
        patientId: 'test-patient',
      },
      {} as never,
    );

    expect(result.accepted).toBe(true);
    expect(result.modelBreaking).toBe(false);
    expect(result.recommendedAction).toBe('proceed-to-stage-9');
    expect(result.summary).toContain('Dr. Kowalski');
    expect(result.summary).toContain('Rheumatology');
  });

  it('detects model-breaking input and recommends return to stage 7', async () => {
    const result = await specialistInputTool.execute?.(
      {
        specialistName: 'Dr. Smith',
        specialty: 'Neurology',
        date: '2025-12-20',
        physicalExamination: ['Papilledema bilateral'],
        clinicalImpression: 'Raised intracranial pressure',
        hypothesisAgreement: [
          {
            hypothesisName: 'Intracranial hypotension',
            verdict: 'disagree' as const,
            reasoning: 'Papilledema indicates raised ICP',
          },
        ],
        modelBreaking: true,
        modelBreakingDetail: 'Papilledema contradicts hypotension hypothesis',
        patientId: 'test-patient',
      },
      {} as never,
    );

    expect(result.accepted).toBe(true);
    expect(result.modelBreaking).toBe(true);
    expect(result.recommendedAction).toBe('return-to-stage-7');
    expect(result.summary).toContain('MODEL-BREAKING');
  });

  it('recommends return to stage 4 when model-breaking suggests new research', async () => {
    const result = await specialistInputTool.execute?.(
      {
        specialistName: 'Dr. Garcia',
        specialty: 'Genetics',
        date: '2025-12-25',
        physicalExamination: ['Dysmorphic features consistent with connective tissue disorder'],
        clinicalImpression: 'New diagnosis: possible Marfan syndrome features',
        hypothesisAgreement: [
          {
            hypothesisName: 'GPA',
            verdict: 'disagree' as const,
            reasoning: 'Presentation more consistent with genetic connective tissue disorder',
          },
        ],
        modelBreaking: true,
        modelBreakingDetail:
          'New diagnosis suggested: connective tissue disorder not in differential',
        patientId: 'test-patient',
      },
      {} as never,
    );

    expect(result.accepted).toBe(true);
    expect(result.modelBreaking).toBe(true);
    expect(result.recommendedAction).toBe('return-to-stage-4');
  });

  it('counts disagreements correctly', async () => {
    const result = await specialistInputTool.execute?.(
      {
        specialistName: 'Dr. Test',
        specialty: 'Internal Medicine',
        date: '2025-12-01',
        physicalExamination: ['Normal exam'],
        clinicalImpression: 'No clear diagnosis',
        hypothesisAgreement: [
          { hypothesisName: 'H1', verdict: 'agree' as const, reasoning: 'Consistent' },
          { hypothesisName: 'H2', verdict: 'disagree' as const, reasoning: 'Not supported' },
          { hypothesisName: 'H3', verdict: 'disagree' as const, reasoning: 'Unlikely' },
        ],
        modelBreaking: false,
        patientId: 'test-patient',
      },
      {} as never,
    );

    expect(result.summary).toContain('Hypothesis Agreements: 1/3');
    expect(result.summary).toContain('Disagreements:');
    expect(result.summary).toContain('Not supported');
    expect(result.summary).toContain('Unlikely');
  });
});
