import { patientProfileSchema } from './patient-profile.js';

describe('patientProfileSchema', () => {
  it('accepts a minimal empty profile', () => {
    const result = patientProfileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a full patient profile', () => {
    const result = patientProfileSchema.safeParse({
      patientId: 'patient-001',
      demographics: {
        ageRange: '30-35',
        sex: 'female',
        ethnicity: 'European',
      },
      symptoms: [
        {
          name: 'Joint hypermobility',
          severity: 8,
          onset: '2020-06',
          frequency: 'daily',
          bodyLocation: 'multiple joints',
          progression: 'worsening',
        },
      ],
      medications: [
        {
          name: 'Ibuprofen',
          dosage: '400mg',
          startDate: '2024-01',
          sideEffects: ['stomach upset'],
        },
      ],
      hpoTerms: ['HP:0001382', 'HP:0000974'],
      diagnoses: {
        confirmed: [],
        suspected: ['Ehlers-Danlos syndrome'],
        ruledOut: ['Marfan syndrome'],
      },
      hypotheses: [
        {
          diagnosis: 'hEDS',
          confidence: 85,
          evidence: 'Beighton score 7/9, skin hyperextensibility',
        },
      ],
      pendingTests: ['COL5A1 genetic test', 'Echocardiogram'],
      visits: [
        {
          date: '2026-03-01',
          provider: 'Dr. Smith',
          specialty: 'Genetics',
          summary: 'Initial consultation for joint hypermobility',
          actionItems: ['Order genetic panel'],
        },
      ],
      lastUpdated: '2026-03-05T12:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates symptom severity range (1-10)', () => {
    const tooLow = patientProfileSchema.safeParse({
      symptoms: [{ name: 'headache', severity: 0 }],
    });
    expect(tooLow.success).toBe(false);

    const tooHigh = patientProfileSchema.safeParse({
      symptoms: [{ name: 'headache', severity: 11 }],
    });
    expect(tooHigh.success).toBe(false);

    const valid = patientProfileSchema.safeParse({
      symptoms: [{ name: 'headache', severity: 7 }],
    });
    expect(valid.success).toBe(true);
  });

  it('validates hypothesis confidence range (0-100)', () => {
    const tooLow = patientProfileSchema.safeParse({
      hypotheses: [{ diagnosis: 'EDS', confidence: -1, evidence: 'none' }],
    });
    expect(tooLow.success).toBe(false);

    const tooHigh = patientProfileSchema.safeParse({
      hypotheses: [{ diagnosis: 'EDS', confidence: 101, evidence: 'none' }],
    });
    expect(tooHigh.success).toBe(false);
  });

  it('requires symptom name when present in array', () => {
    const result = patientProfileSchema.safeParse({
      symptoms: [{ severity: 5 }],
    });
    expect(result.success).toBe(false);
  });

  it('requires hypothesis fields when present in array', () => {
    const missingEvidence = patientProfileSchema.safeParse({
      hypotheses: [{ diagnosis: 'EDS', confidence: 80 }],
    });
    expect(missingEvidence.success).toBe(false);
  });

  it('accepts partial demographics', () => {
    const result = patientProfileSchema.safeParse({
      demographics: { sex: 'male' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts symptoms with only name', () => {
    const result = patientProfileSchema.safeParse({
      symptoms: [{ name: 'fatigue' }],
    });
    expect(result.success).toBe(true);
  });
});
