import { describe, expect, it } from '@jest/globals';
import { buildImagingId, mapImagingReport } from './imaging-parser.js';
import type { RecordFrontmatter } from './schemas.js';

function makeFrontmatter(
  overrides?: Partial<RecordFrontmatter> & Record<string, unknown>,
): RecordFrontmatter {
  return {
    document_id: 'img-20120720-mri-001',
    document_type: 'imaging_report',
    patient_id: 'tomasz-szychliński',
    asklepios_type: 'imaging-report',
    evidence_tier: 'T1-official',
    validation_status: 'confirmed',
    source_credibility: 95,
    date: '2012-07-20',
    source_file: '2012.07 MR odcinka szyjnego.pdf',
    facility: 'NZOZ Skanmex Diagnostyka',
    modality: 'MRI',
    body_region: 'cervical spine (kręgosłup szyjny)',
    physician: 'Lek. Paweł Szewczyk',
    ...overrides,
  } as RecordFrontmatter;
}

describe('buildImagingId', () => {
  it('generates deterministic import ID', () => {
    expect(buildImagingId('img-20120720-mri-001')).toBe('import-img-img-20120720-mri-001');
  });
});

describe('mapImagingReport', () => {
  it('maps frontmatter fields to imaging report schema', () => {
    const fm = makeFrontmatter();
    const body =
      '# MRI Cervical Spine\n\n## Technique\nSagittal T1, T2.\n\n## Findings\nC1 assimilation noted.\n\n## Impression\nCVJ anomaly.';
    const result = mapImagingReport(fm, body);

    expect(result.id).toBe('import-img-img-20120720-mri-001');
    expect(result.patientId).toBe('tomasz-szychliński');
    expect(result.modality).toBe('MRI');
    expect(result.bodyRegion).toBe('cervical_spine');
    expect(result.date).toBe('2012-07-20');
    expect(result.facility).toBe('NZOZ Skanmex Diagnostyka');
    expect(result.physician).toBe('Lek. Paweł Szewczyk');
    expect(result.source).toBe('2012.07 MR odcinka szyjnego.pdf');
    expect(result.evidenceTier).toBe('T1-official');
    expect(result.sourceCredibility).toBe(95);
  });

  it('normalizes modality: CT (TK) → CT', () => {
    const fm = makeFrontmatter({ modality: 'CT (TK)' });
    const result = mapImagingReport(fm, 'body');
    expect(result.modality).toBe('CT');
  });

  it('normalizes modality: RTG → X-ray', () => {
    const fm = makeFrontmatter({ modality: 'RTG (X-ray)' });
    const result = mapImagingReport(fm, 'body');
    expect(result.modality).toBe('X-ray');
  });

  it('normalizes body region: head (głowa) → head', () => {
    const fm = makeFrontmatter({ body_region: 'head (głowa)' });
    const result = mapImagingReport(fm, 'body');
    expect(result.bodyRegion).toBe('head');
  });

  it('normalizes body region: thoracic_spine', () => {
    const fm = makeFrontmatter({ body_region: 'thoracic spine (kręgosłup piersiowy)' });
    const result = mapImagingReport(fm, 'body');
    expect(result.bodyRegion).toBe('thoracic_spine');
  });

  it('extracts technique section from body', () => {
    const body =
      '# MRI\n\n## Technique\nSagittal T1, T2 weighted. 3T scanner.\n\n## Findings\nNormal.';
    const result = mapImagingReport(makeFrontmatter(), body);
    expect(result.technique).toContain('Sagittal T1');
    expect(result.technique).toContain('3T scanner');
  });

  it('extracts findings section from body', () => {
    const body =
      '# MRI\n\n## Findings\nC1 assimilation into occipital bone. Disc protrusion at C4/C5.\n\n## Impression\nSummary.';
    const result = mapImagingReport(makeFrontmatter(), body);
    expect(result.findings).toContain('C1 assimilation');
    expect(result.findings).toContain('C4/C5');
  });

  it('extracts impression section', () => {
    const body =
      '# MRI\n\n## Findings\nNormal.\n\n## Impression\nNo acute abnormality. Chronic CVJ changes.';
    const result = mapImagingReport(makeFrontmatter(), body);
    expect(result.impression).toContain('Chronic CVJ changes');
  });

  it('extracts comparison section', () => {
    const body =
      '# MRI\n\n## Findings\nNormal.\n\n## Comparison\nCompared with prior study from 2012-07-20.';
    const result = mapImagingReport(makeFrontmatter(), body);
    expect(result.comparison).toContain('prior study');
  });

  it('falls back to full body when no ## Findings section', () => {
    const body = 'Plain text imaging report without section headers. C1 assimilation noted.';
    const result = mapImagingReport(makeFrontmatter(), body);
    expect(result.findings).toContain('C1 assimilation');
  });
});
