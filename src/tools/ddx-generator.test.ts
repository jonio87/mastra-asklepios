import { ddxGeneratorTool } from './ddx-generator.js';

describe('ddxGeneratorTool', () => {
  it('has correct tool configuration', () => {
    expect(ddxGeneratorTool.id).toBe('ddx-generator');
    expect(ddxGeneratorTool.description).toBeDefined();
    expect(ddxGeneratorTool.inputSchema).toBeDefined();
    expect(ddxGeneratorTool.outputSchema).toBeDefined();
    expect(ddxGeneratorTool.execute).toBeDefined();
  });

  it('validates basic input', () => {
    const result = ddxGeneratorTool.inputSchema.safeParse({
      clinicalFeatures: ['chronic craniofacial pain', 'leukopenia'],
      age: 34,
      sex: 'male',
    });
    expect(result.success).toBe(true);
  });

  it('validates full input with lab results and region', () => {
    const result = ddxGeneratorTool.inputSchema.safeParse({
      clinicalFeatures: [
        'chronic right-sided craniofacial pain',
        'C1 bilateral assimilation',
        'platybasia',
        'bruxism',
        'photophobia',
      ],
      labResults: ['WBC 2.59 low', 'PR3-ANCA positive', 'Ro-60 positive'],
      age: 34,
      sex: 'male',
      region: 'europe',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty clinical features', () => {
    const result = ddxGeneratorTool.inputSchema.safeParse({
      clinicalFeatures: [],
      age: 34,
      sex: 'male',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = ddxGeneratorTool.inputSchema.safeParse({
      clinicalFeatures: ['pain'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sex', () => {
    const result = ddxGeneratorTool.inputSchema.safeParse({
      clinicalFeatures: ['pain'],
      age: 34,
      sex: 'other',
    });
    expect(result.success).toBe(false);
  });

  it('validates output schema', () => {
    const result = ddxGeneratorTool.outputSchema.safeParse({
      differentialDiagnosis: [
        {
          diagnosis: 'ANCA-associated vasculitis',
          icdCode: 'M31.3',
          likelihood: 'medium',
          reasoning: 'PR3-ANCA positivity',
          supportingFeatures: ['PR3-ANCA positive', 'leukopenia'],
          contradictingFeatures: ['intermittent positivity'],
          suggestedTests: ['ANCA IIF + ELISA'],
        },
        {
          diagnosis: 'T-LGL leukemia',
          likelihood: 'dont-miss',
          reasoning: 'Chronic unexplained neutropenia',
          supportingFeatures: ['leukopenia'],
          suggestedTests: ['Flow cytometry'],
        },
      ],
      source: 'internal',
      featureCount: 5,
      disclaimer: 'This is an AI-generated differential...',
    });
    expect(result.success).toBe(true);
  });
});
