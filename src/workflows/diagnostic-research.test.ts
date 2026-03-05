import { diagnosticResearchWorkflow } from './diagnostic-research.js';

describe('diagnosticResearchWorkflow', () => {
  it('has correct workflow id', () => {
    expect(diagnosticResearchWorkflow.id).toBe('diagnostic-research');
  });

  it('has a description', () => {
    expect(diagnosticResearchWorkflow.description).toBeDefined();
  });

  it('is committed', () => {
    expect(diagnosticResearchWorkflow.committed).toBe(true);
  });

  it('validates valid input with minimal fields', () => {
    const result = diagnosticResearchWorkflow.inputSchema.safeParse({
      patientId: 'patient-anon-001',
      symptoms: ['joint hypermobility', 'chronic pain', 'easy bruising'],
    });
    expect(result.success).toBe(true);
  });

  it('validates input with all optional fields', () => {
    const result = diagnosticResearchWorkflow.inputSchema.safeParse({
      patientId: 'patient-anon-001',
      symptoms: ['joint hypermobility', 'skin hyperextensibility'],
      hpoTerms: [
        { id: 'HP:0001382', name: 'Joint hypermobility' },
        { id: 'HP:0000974', name: 'Hyperextensible skin' },
      ],
      existingDiagnoses: ['suspected Ehlers-Danlos Syndrome'],
      researchFocus: 'connective tissue disorders',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing patientId', () => {
    const result = diagnosticResearchWorkflow.inputSchema.safeParse({
      symptoms: ['pain'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing symptoms', () => {
    const result = diagnosticResearchWorkflow.inputSchema.safeParse({
      patientId: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('validates output schema structure', () => {
    const result = diagnosticResearchWorkflow.outputSchema.safeParse({
      patientId: 'patient-anon-001',
      researchFindings: [
        {
          source: 'PubMed',
          title: 'A study on EDS',
          summary: 'Study findings',
          relevance: 0.8,
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345/',
          evidenceLevel: 'case-report',
        },
      ],
      hypotheses: [
        {
          diagnosis: 'Ehlers-Danlos Syndrome, hypermobility type',
          confidence: 75,
          evidenceSummary: 'Strong phenotypic match',
          supportingFindings: ['[PubMed] A study on EDS'],
          explainedSymptoms: ['joint hypermobility', 'skin hyperextensibility'],
          unexplainedSymptoms: ['chronic fatigue'],
          recommendedNextSteps: ['Genetic testing', 'Beighton score assessment'],
        },
      ],
      knowledgeGaps: ['Limited RCT evidence'],
      suggestedFollowUp: ['Whole exome sequencing'],
      timestamp: '2026-03-05T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates confidence range 0-100', () => {
    const valid = diagnosticResearchWorkflow.outputSchema.safeParse({
      patientId: 'test',
      researchFindings: [],
      hypotheses: [
        {
          diagnosis: 'Test',
          confidence: 50,
          evidenceSummary: 'Test',
          supportingFindings: [],
          explainedSymptoms: [],
          unexplainedSymptoms: [],
          recommendedNextSteps: [],
        },
      ],
      knowledgeGaps: [],
      suggestedFollowUp: [],
      timestamp: '2026-03-05T00:00:00.000Z',
    });
    expect(valid.success).toBe(true);

    const invalid = diagnosticResearchWorkflow.outputSchema.safeParse({
      patientId: 'test',
      researchFindings: [],
      hypotheses: [
        {
          diagnosis: 'Test',
          confidence: 150,
          evidenceSummary: 'Test',
          supportingFindings: [],
          explainedSymptoms: [],
          unexplainedSymptoms: [],
          recommendedNextSteps: [],
        },
      ],
      knowledgeGaps: [],
      suggestedFollowUp: [],
      timestamp: '2026-03-05T00:00:00.000Z',
    });
    expect(invalid.success).toBe(false);
  });
});
