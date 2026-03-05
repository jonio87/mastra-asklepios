import { hpoMapperTool } from './hpo-mapper.js';

describe('hpoMapperTool', () => {
  it('has correct tool configuration', () => {
    expect(hpoMapperTool.id).toBe('hpo-mapper');
    expect(hpoMapperTool.description).toBeDefined();
    expect(hpoMapperTool.inputSchema).toBeDefined();
    expect(hpoMapperTool.outputSchema).toBeDefined();
    expect(hpoMapperTool.execute).toBeDefined();
  });

  it('validates valid input with symptoms array', () => {
    const result = hpoMapperTool.inputSchema.safeParse({
      symptoms: ['joint pain', 'fatigue', 'easy bruising'],
    });
    expect(result.success).toBe(true);
  });

  it('validates empty symptoms array', () => {
    const result = hpoMapperTool.inputSchema.safeParse({
      symptoms: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing symptoms field', () => {
    const result = hpoMapperTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string symptoms', () => {
    const result = hpoMapperTool.inputSchema.safeParse({
      symptoms: [123, true],
    });
    expect(result.success).toBe(false);
  });

  it('validates output schema with valid mapping data', () => {
    const result = hpoMapperTool.outputSchema.safeParse({
      mappings: [
        {
          originalText: 'joint pain',
          matchedTerms: [
            {
              id: 'HP:0002829',
              name: 'Arthralgia',
              synonyms: ['Joint pain'],
            },
          ],
          confidence: 0.85,
        },
      ],
      unmappedSymptoms: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates output with unmapped symptoms', () => {
    const result = hpoMapperTool.outputSchema.safeParse({
      mappings: [],
      unmappedSymptoms: ['vague discomfort'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects confidence outside 0-1 range', () => {
    const result = hpoMapperTool.outputSchema.safeParse({
      mappings: [
        {
          originalText: 'test',
          matchedTerms: [],
          confidence: 1.5,
        },
      ],
      unmappedSymptoms: [],
    });
    expect(result.success).toBe(false);
  });
});
