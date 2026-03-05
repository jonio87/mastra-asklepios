import { anonymizeObservations, brainFeedTool } from './brain-feed.js';

describe('anonymizeObservations', () => {
  it('removes specific dates in YYYY-MM-DD format', () => {
    const text = 'Patient visited on 2026-03-05 for follow-up';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('2026-03-05');
    expect(result).toContain('[date-removed]');
  });

  it('removes dates in MM/DD/YYYY format', () => {
    const text = 'Lab results from 03/05/2026 show elevated CK';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('03/05/2026');
    expect(result).toContain('[date-removed]');
  });

  it('removes written-out dates', () => {
    const text = 'Onset reported as January 15, 2024';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('January 15, 2024');
    expect(result).toContain('[date-removed]');
  });

  it('removes doctor names', () => {
    const text = 'Referred by Dr. Smith to Dr. Johnson for genetic consultation';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('Smith');
    expect(result).not.toContain('Johnson');
  });

  it('removes patient names', () => {
    const text = 'Patient Jane Doe reports worsening symptoms';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('Jane');
    expect(result).not.toContain('Doe');
  });

  it('removes medical record numbers', () => {
    const text = 'MRN: 12345-ABC for this encounter';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('12345-ABC');
    expect(result).toContain('[id-removed]');
  });

  it('removes email addresses', () => {
    const text = 'Contact at patient@example.com for follow-up';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('patient@example.com');
    expect(result).toContain('[email-removed]');
  });

  it('removes phone numbers', () => {
    const text = 'Call (555) 123-4567 to schedule';
    const result = anonymizeObservations(text);
    expect(result).not.toContain('555');
    expect(result).toContain('[phone-removed]');
  });

  it('preserves medical terms and findings', () => {
    const text = 'Joint hypermobility (Beighton 7/9) with skin hyperextensibility. PMID:12345678';
    const result = anonymizeObservations(text);
    expect(result).toContain('Joint hypermobility');
    expect(result).toContain('Beighton 7/9');
    expect(result).toContain('PMID:12345678');
  });

  it('preserves ORPHAcodes and OMIM numbers', () => {
    const text = 'Matches ORPHA:166 (EDS) and OMIM:130000';
    const result = anonymizeObservations(text);
    expect(result).toContain('ORPHA:166');
    expect(result).toContain('OMIM:130000');
  });

  it('handles empty text', () => {
    expect(anonymizeObservations('')).toBe('');
  });
});

describe('brainFeedTool', () => {
  it('has correct tool configuration', () => {
    expect(brainFeedTool.id).toBe('brain-feed');
    expect(brainFeedTool.description).toContain('Brain');
  });

  it('executes and returns anonymized output', async () => {
    const execute = brainFeedTool.execute;
    expect(execute).toBeDefined();
    const result = await execute?.(
      {
        observations:
          'Dr. Smith noted joint hypermobility on 2026-03-05. Patient Jane Doe has Beighton 7/9.',
        caseLabel: 'Case-hypermobility-001',
        keyFindings: ['Beighton 7/9', 'Skin hyperextensibility'],
        hypotheses: [
          { diagnosis: 'hEDS', confidence: 85, keyEvidence: 'Beighton score + skin findings' },
        ],
      },
      { mastra: undefined } as never,
    );

    expect(result.caseLabel).toBe('Case-hypermobility-001');
    expect(result.anonymizedText).not.toContain('Smith');
    expect(result.anonymizedText).not.toContain('Jane Doe');
    expect(result.anonymizedText).not.toContain('2026-03-05');
    expect(result.anonymizedText).toContain('Beighton 7/9');
    expect(result.anonymizedText).toContain('hEDS');
    expect(result.wordCount).toBeGreaterThan(0);
    expect(result.redactionCount).toBeGreaterThan(0);
  });
});
