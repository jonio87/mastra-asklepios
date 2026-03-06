import { adversarialSynthesisTool } from './adversarial-synthesis.js';

describe('adversarial-synthesis tool', () => {
  it('has correct tool id and description', () => {
    expect(adversarialSynthesisTool.id).toBe('adversarial-synthesis');
    expect(adversarialSynthesisTool.description).toContain('adversarial');
    expect(adversarialSynthesisTool.description).toContain('advocate');
    expect(adversarialSynthesisTool.description).toContain('skeptic');
    expect(adversarialSynthesisTool.description).toContain('unbiased');
  });

  it('has correct input schema with required fields', () => {
    const schema = adversarialSynthesisTool.inputSchema;
    expect(schema).toBeDefined();

    // Valid input should parse
    const valid = schema?.safeParse({
      hypothesis: 'Sjögren syndrome causing trigeminal neuropathy',
      patientContext: 'Anti-Ro-60 discrepancy, leukopenia, chronic facial pain',
      mode: 'internal',
    });
    expect(valid?.success).toBe(true);

    // Missing required fields should fail
    const missingHypothesis = schema?.safeParse({
      patientContext: 'context',
      mode: 'internal',
    });
    expect(missingHypothesis?.success).toBe(false);

    const missingMode = schema?.safeParse({
      hypothesis: 'test',
      patientContext: 'context',
    });
    expect(missingMode?.success).toBe(false);
  });

  it('validates mode enum values', () => {
    const schema = adversarialSynthesisTool.inputSchema;

    const internal = schema?.safeParse({
      hypothesis: 'test',
      patientContext: 'context',
      mode: 'internal',
    });
    expect(internal?.success).toBe(true);

    const external = schema?.safeParse({
      hypothesis: 'test',
      patientContext: 'context',
      mode: 'external',
    });
    expect(external?.success).toBe(true);

    const invalid = schema?.safeParse({
      hypothesis: 'test',
      patientContext: 'context',
      mode: 'hybrid',
    });
    expect(invalid?.success).toBe(false);
  });

  it('accepts optional processor field', () => {
    const schema = adversarialSynthesisTool.inputSchema;

    const withProcessor = schema?.safeParse({
      hypothesis: 'test',
      patientContext: 'context',
      mode: 'external',
      processor: 'ultra2x',
    });
    expect(withProcessor?.success).toBe(true);

    const withoutProcessor = schema?.safeParse({
      hypothesis: 'test',
      patientContext: 'context',
      mode: 'external',
    });
    expect(withoutProcessor?.success).toBe(true);
  });

  it('has correct output schema fields', () => {
    const schema = adversarialSynthesisTool.outputSchema;
    expect(schema).toBeDefined();

    // Validate a complete output structure
    const valid = schema?.safeParse({
      mode: 'internal',
      advocate: {
        report: 'Advocate report',
        sources: [],
        durationMs: 0,
      },
      skeptic: {
        report: 'Skeptic report',
        sources: [],
        durationMs: 0,
      },
      unbiased: {
        report: 'Unbiased report',
        sources: [],
        durationMs: 0,
      },
      synthesis: {
        convergence: ['Point 1'],
        divergence: ['Point 2'],
        informativeTests: ['Test 1'],
        summary: 'Summary text',
      },
    });
    expect(valid?.success).toBe(true);
  });
});
