import { documentParserTool } from './document-parser.js';

describe('documentParserTool', () => {
  it('has correct tool configuration', () => {
    expect(documentParserTool.id).toBe('document-parser');
    expect(documentParserTool.description).toBeDefined();
    expect(documentParserTool.inputSchema).toBeDefined();
    expect(documentParserTool.outputSchema).toBeDefined();
    expect(documentParserTool.execute).toBeDefined();
  });

  it('validates valid input', () => {
    const result = documentParserTool.inputSchema.safeParse({
      text: 'Patient presents with joint pain',
    });
    expect(result.success).toBe(true);
  });

  it('validates input with optional documentType', () => {
    const result = documentParserTool.inputSchema.safeParse({
      text: 'Lab results',
      documentType: 'lab-report',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid documentType', () => {
    const result = documentParserTool.inputSchema.safeParse({
      text: 'test',
      documentType: 'invalid-type',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing text field', () => {
    const result = documentParserTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('documentParserTool.execute', () => {
  const execute = documentParserTool.execute;
  if (!execute) throw new Error('documentParserTool.execute is undefined');

  it('parses a simple clinical note', async () => {
    const text =
      'Patient presents with joint pain and fatigue. Diagnosis: suspected Ehlers-Danlos Syndrome. Medications: ibuprofen 400mg.';
    const result = await execute({ text }, {} as never);

    expect(result.documentType).toBeDefined();
    expect(result.rawText).toBe(text);
    expect(result.symptoms.length).toBeGreaterThan(0);
    expect(result.diagnoses.length).toBeGreaterThan(0);
    expect(result.medications.length).toBeGreaterThan(0);
  });

  it('detects genetic report document type', async () => {
    const text = 'Whole exome sequencing results: variant c.1234A>G identified in FBN1 gene.';
    const result = await execute({ text }, {} as never);

    expect(result.documentType).toBe('genetic-report');
  });

  it('detects lab report document type', async () => {
    const text = 'Laboratory Report: CBC and metabolic panel results.';
    const result = await execute({ text }, {} as never);

    expect(result.documentType).toBe('lab-report');
  });

  it('uses provided documentType when specified', async () => {
    const text = 'Some document text';
    const result = await execute({ text, documentType: 'referral' }, {} as never);

    expect(result.documentType).toBe('referral');
  });

  it('extracts lab values from text', async () => {
    const text = 'Hemoglobin: 12.5 g/dL (N)\nWBC: 15.2 K/uL (H)';
    const result = await execute({ text }, {} as never);

    expect(result.labValues.length).toBeGreaterThan(0);
    const hemoglobin = result.labValues.find((l) => l.name.includes('Hemoglobin'));
    expect(hemoglobin).toBeDefined();
    expect(hemoglobin?.value).toBe('12.5');
    expect(hemoglobin?.flag).toBe('normal');
  });

  it('extracts patient demographics', async () => {
    const text = '45 year old female presenting with chronic fatigue.';
    const result = await execute({ text }, {} as never);

    expect(result.patientAge).toBe('45 years');
    expect(result.patientSex).toBe('female');
  });

  it('handles empty document gracefully', async () => {
    const result = await execute({ text: '' }, {} as never);

    expect(result.symptoms).toEqual([]);
    expect(result.diagnoses).toEqual([]);
    expect(result.medications).toEqual([]);
    expect(result.labValues).toEqual([]);
  });

  it('extracts sections from structured documents', async () => {
    const text = `CHIEF COMPLAINT:\nJoint pain and fatigue\n\nHISTORY OF PRESENT ILLNESS:\nPatient reports 3 years of progressive joint pain\n\nMEDICATIONS:\nIbuprofen 400mg TID`;
    const result = await execute({ text }, {} as never);

    expect(result.sections.length).toBeGreaterThan(0);
  });
});
