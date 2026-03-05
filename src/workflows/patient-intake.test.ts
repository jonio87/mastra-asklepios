import { patientIntakeWorkflow } from './patient-intake.js';

describe('patientIntakeWorkflow', () => {
  it('has correct workflow id', () => {
    expect(patientIntakeWorkflow.id).toBe('patient-intake');
  });

  it('has a description', () => {
    expect(patientIntakeWorkflow.description).toBeDefined();
  });

  it('is committed', () => {
    expect(patientIntakeWorkflow.committed).toBe(true);
  });

  it('validates valid input', () => {
    const result = patientIntakeWorkflow.inputSchema.safeParse({
      documentText: 'Patient presents with joint hypermobility and chronic pain.',
      patientId: 'patient-anon-001',
    });
    expect(result.success).toBe(true);
  });

  it('validates input with optional documentType', () => {
    const result = patientIntakeWorkflow.inputSchema.safeParse({
      documentText: 'Lab report text',
      documentType: 'lab-report',
      patientId: 'patient-anon-002',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = patientIntakeWorkflow.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects missing patientId', () => {
    const result = patientIntakeWorkflow.inputSchema.safeParse({
      documentText: 'some text',
    });
    expect(result.success).toBe(false);
  });

  it('validates output schema structure', () => {
    const result = patientIntakeWorkflow.outputSchema.safeParse({
      patientId: 'patient-anon-001',
      parsedDocument: { documentType: 'medical-record' },
      phenotypes: [
        {
          originalText: 'joint pain',
          hpoTerms: [{ id: 'HP:0002829', name: 'Arthralgia' }],
          confidence: 0.85,
        },
      ],
      symptoms: ['joint pain'],
      diagnoses: ['suspected EDS'],
      status: 'complete',
    });
    expect(result.success).toBe(true);
  });

  it('validates needs-review status', () => {
    const result = patientIntakeWorkflow.outputSchema.safeParse({
      patientId: 'patient-anon-001',
      parsedDocument: {},
      phenotypes: [],
      symptoms: [],
      diagnoses: [],
      status: 'needs-review',
    });
    expect(result.success).toBe(true);
  });

  it('validates human-reviewed status', () => {
    const result = patientIntakeWorkflow.outputSchema.safeParse({
      patientId: 'patient-anon-001',
      parsedDocument: {},
      phenotypes: [],
      symptoms: [],
      diagnoses: [],
      status: 'human-reviewed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = patientIntakeWorkflow.outputSchema.safeParse({
      patientId: 'patient-anon-001',
      parsedDocument: {},
      phenotypes: [],
      symptoms: [],
      diagnoses: [],
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  describe('HITL review step', () => {
    it('registers review-phenotypes step', () => {
      const steps = patientIntakeWorkflow.steps;
      expect(steps).toHaveProperty('review-phenotypes');
    });

    it('includes review step between map-phenotypes and prepare-output', () => {
      const stepIds = Object.keys(patientIntakeWorkflow.steps);
      const mapIndex = stepIds.indexOf('map-phenotypes');
      const reviewIndex = stepIds.indexOf('review-phenotypes');
      const prepareIndex = stepIds.indexOf('prepare-output');

      expect(mapIndex).toBeGreaterThanOrEqual(0);
      expect(reviewIndex).toBeGreaterThanOrEqual(0);
      expect(prepareIndex).toBeGreaterThanOrEqual(0);
      expect(reviewIndex).toBeGreaterThan(mapIndex);
      expect(prepareIndex).toBeGreaterThan(reviewIndex);
    });

    it('has all 4 workflow steps registered', () => {
      const stepIds = Object.keys(patientIntakeWorkflow.steps);
      expect(stepIds).toContain('parse-document');
      expect(stepIds).toContain('map-phenotypes');
      expect(stepIds).toContain('review-phenotypes');
      expect(stepIds).toContain('prepare-output');
    });
  });
});
