import { describe, expect, it } from '@jest/globals';
import { buildAbdominalId, mapAbdominalReport } from './abdominal-parser.js';
import type { RecordFrontmatter } from './schemas.js';

function makeFrontmatter(
  overrides?: Partial<RecordFrontmatter> & Record<string, unknown>,
): RecordFrontmatter {
  return {
    document_id: 'abd-20210501-abdominal-001',
    document_type: 'abdominal',
    patient_id: 'tomasz-szychliński',
    asklepios_type: 'other',
    evidence_tier: 'T1-official',
    validation_status: 'confirmed',
    source_credibility: 85,
    date: '2021-05-01',
    source_file: 'Badania jama brzuszna/2021.05 Gastoskopia ENG.pdf',
    category: 'abdominal',
    ...overrides,
  } as RecordFrontmatter;
}

describe('buildAbdominalId', () => {
  it('generates deterministic import ID', () => {
    expect(buildAbdominalId('abd-20210501-abdominal-001')).toBe(
      'import-abd-abd-20210501-abdominal-001',
    );
  });
});

describe('mapAbdominalReport', () => {
  it('maps frontmatter to abdominal report', () => {
    const body = 'Gastroscopy findings: normal esophagus.';
    const result = mapAbdominalReport(makeFrontmatter(), body);

    expect(result.id).toBe('import-abd-abd-20210501-abdominal-001');
    expect(result.patientId).toBe('tomasz-szychliński');
    expect(result.procedureType).toBe('gastroscopy');
    expect(result.date).toBe('2021-05-01');
    expect(result.source).toBe('Badania jama brzuszna/2021.05 Gastoskopia ENG.pdf');
    expect(result.findings).toContain('normal esophagus');
  });

  it('extracts colonoscopy from source_file', () => {
    const fm = makeFrontmatter({
      source_file: 'Badania jama brzuszna/2021.05 Gastroskopia Kolonoskopia.pdf',
    });
    const result = mapAbdominalReport(fm, 'body');
    expect(result.procedureType).toBe('gastroscopy');
  });

  it('extracts pH-metry from source_file', () => {
    const fm = makeFrontmatter({
      source_file: 'Badania jama brzuszna/2021.05 Karta infor. pH-metria.pdf',
    });
    const result = mapAbdominalReport(fm, 'body');
    expect(result.procedureType).toBe('pH-metry');
  });

  it('extracts SIBO from source_file', () => {
    const fm = makeFrontmatter({
      source_file: '2025_07_05_TSZ SIBO.pdf',
      category: 'sibo',
    });
    const result = mapAbdominalReport(fm, 'body');
    expect(result.procedureType).toBe('SIBO');
  });

  it('extracts helicobacter_test from source_file', () => {
    const fm = makeFrontmatter({
      source_file: '2025_07_06 Helicobakter.pdf',
    });
    const result = mapAbdominalReport(fm, 'body');
    expect(result.procedureType).toBe('helicobacter_test');
  });

  it('extracts ultrasound from USG source_file', () => {
    const fm = makeFrontmatter({
      source_file: 'Badania jama brzuszna/2021.05 USG  jamy brzusznej.pdf',
    });
    const result = mapAbdominalReport(fm, 'body');
    expect(result.procedureType).toBe('ultrasound');
  });

  it('extracts conclusions from body with Wnioski: header', () => {
    const body = `Badanie gastroenterologiczne.

Wnioski:
Refluks żołądkowo-przełykowy. Zaleca się IPP.

Zalecenia:
Dieta lekkostrawna.`;

    const result = mapAbdominalReport(makeFrontmatter(), body);
    expect(result.conclusions).toContain('Refluks');
  });

  it('extracts physician from body text', () => {
    const fm = makeFrontmatter();
    const body =
      'Badanie wykonał dr n. med. Aleksandra Woźniak-Stolarska w Klinice Gastroenterologii.';
    const result = mapAbdominalReport(fm, body);
    expect(result.physician).toContain('Woźniak-Stolarska');
  });

  it('stores full body as findings without truncation', () => {
    const body = 'X'.repeat(8000);
    const result = mapAbdominalReport(makeFrontmatter(), body);
    expect(result.findings?.length).toBe(8000);
  });
});
