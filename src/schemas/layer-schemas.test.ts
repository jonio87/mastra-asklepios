import { diagnosisSchema } from './diagnosis.js';
import { imagingFindingSchema } from './imaging-finding.js';
import { progressionSchema } from './progression.js';
import { reportDataIntegrationSchema, reportVersionSchema } from './report-version.js';
import { sourceDocumentSchema } from './source-document.js';

// ─── Source Document Schema ──────────────────────────────────────────────

describe('sourceDocumentSchema', () => {
  it('accepts a complete Skanmex imaging document', () => {
    const result = sourceDocumentSchema.safeParse({
      id: 'img-skanmex-cervical-001',
      patientId: 'patient-tomasz-szychlinski',
      originalFilename: '2022-04-26_cervical_spine_mri.pdf',
      originalFileHash: 'abc123def456789012345678901234567890',
      originalFileSizeBytes: 599458,
      originalPageCount: 1,
      mimeType: 'application/pdf',
      extractionMethod: 'tesseract_ocr',
      extractionConfidence: 0.85,
      extractionDate: '2026-03-06T12:00:00Z',
      extractionTool: 'tesseract-5.x+pol+eng',
      extractionWave: 5,
      extractedMarkdownPath: 'records/imaging/img-skanmex-cervical-001.md',
      preProcessing: 'grayscale,300dpi',
      postProcessing: 'yaml-frontmatter-generation',
      pipelineVersion: '1.0.0',
      category: 'imaging_report',
      subcategory: 'mri',
      date: '2022-04-26',
      facility: 'NZOZ Skanmex Diagnostyka',
      physician: 'Lek. Krzysztof Kowalewski',
      language: 'pl',
      tags: ['mri', 'cervical_spine', 'scoliosis'],
      evidenceTier: 'T1-official',
      validationStatus: 'confirmed',
      sourceCredibility: 90,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Claude vision-extracted lab report', () => {
    const result = sourceDocumentSchema.safeParse({
      id: 'lab-diagnostyka-wbc-2025',
      patientId: 'patient-tomasz-szychlinski',
      originalFilename: '2025-08-27_blood_panel.pdf',
      originalFileHash: 'deadbeef1234567890',
      originalFileSizeBytes: 124000,
      extractionMethod: 'claude_read',
      extractionConfidence: 0.96,
      extractionDate: '2026-03-05T10:00:00Z',
      extractionTool: 'claude-sonnet-4',
      extractionWave: 1,
      extractedMarkdownPath: 'records/labs/lab-diagnostyka-wbc-2025.md',
      pipelineVersion: '1.0.0',
      category: 'lab_result',
      date: '2025-08-27',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid extraction method', () => {
    const result = sourceDocumentSchema.safeParse({
      id: 'doc-bad',
      patientId: 'p1',
      originalFilename: 'test.pdf',
      originalFileHash: 'hash',
      originalFileSizeBytes: 100,
      extractionMethod: 'openai_vision',
      extractionConfidence: 0.9,
      extractionDate: '2026-01-01',
      extractionTool: 'test',
      extractedMarkdownPath: 'test.md',
      category: 'lab_result',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0-1 range', () => {
    const result = sourceDocumentSchema.safeParse({
      id: 'doc-bad',
      patientId: 'p1',
      originalFilename: 'test.pdf',
      originalFileHash: 'hash',
      originalFileSizeBytes: 100,
      extractionMethod: 'claude_read',
      extractionConfidence: 1.5,
      extractionDate: '2026-01-01',
      extractionTool: 'test',
      extractedMarkdownPath: 'test.md',
      category: 'lab_result',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Imaging Finding Schema ──────────────────────────────────────────────

describe('imagingFindingSchema', () => {
  it('accepts a C7/T1 disc extrusion finding', () => {
    const result = imagingFindingSchema.safeParse({
      id: 'finding-c7t1-extrusion',
      patientId: 'patient-tomasz-szychlinski',
      imagingReportId: 'img-skanmex-spine-2022-12',
      anatomicalLocation: 'C7/T1',
      findingType: 'extrusion',
      laterality: 'left-lateral',
      severity: 'moderate',
      description:
        'Moderately sized medially left-lateralized disc herniation (extrusion) compressing dural sac and impressing on left C8 nerve root',
      nerveInvolvement: 'left C8 nerve root compression',
      comparisonToPrior: 'new finding (not documented in prior imaging)',
      date: '2022-12-15',
      radiologist: 'Dr. Paweł Szewczyk',
      evidenceTier: 'T1-official',
      validationStatus: 'confirmed',
      sourceCredibility: 95,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a bilateral AICA loop finding', () => {
    const result = imagingFindingSchema.safeParse({
      id: 'finding-aica-loops',
      patientId: 'patient-tomasz-szychlinski',
      imagingReportId: 'img-skanmex-head-2022-12',
      anatomicalLocation: 'internal_auditory_canals',
      findingType: 'vascular-loop',
      laterality: 'bilateral',
      description:
        'Bilateral loops of elongated tortuous AICA extending toward internal auditory canals, winding around and encircling cranial nerves VII and VIII',
      nerveInvolvement: 'CN VII/VIII bilateral neurovascular compression',
      comparisonToPrior: 'persistent (also documented 2019)',
      date: '2022-12-15',
      radiologist: 'Dr. Paweł Szewczyk',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a maxillary cyst with measurement', () => {
    const result = imagingFindingSchema.safeParse({
      id: 'finding-cyst-dec2022',
      patientId: 'patient-tomasz-szychlinski',
      imagingReportId: 'img-skanmex-head-2022-12',
      anatomicalLocation: 'left_maxillary_sinus',
      findingType: 'cyst',
      laterality: 'left',
      measurement: 3.7,
      measurementUnit: 'cm',
      description: 'Retention cyst left maxillary sinus 3.7 cm',
      comparisonToPrior: 'Increased from 2.5 cm (April 2022) — 48% growth in 8 months',
      date: '2022-12-15',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid finding type', () => {
    const result = imagingFindingSchema.safeParse({
      id: 'finding-bad',
      patientId: 'p1',
      imagingReportId: 'img-1',
      anatomicalLocation: 'C7/T1',
      findingType: 'fracture',
      description: 'test',
      date: '2022-01-01',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Diagnosis Schema ────────────────────────────────────────────────────

describe('diagnosisSchema', () => {
  it('accepts a CVJ anomaly diagnosis', () => {
    const result = diagnosisSchema.safeParse({
      id: 'dx-cvj-anomaly',
      patientId: 'patient-tomasz-szychlinski',
      icd10Code: 'Q76.1',
      conditionName: 'Craniovertebral junction anomaly',
      conditionNamePl: 'Anomalia połączenia czaszkowo-kręgosłupowego',
      onsetDate: '2010-01-01',
      firstDocumentedDate: '2012-07-20',
      currentStatus: 'stable',
      bodyRegion: 'craniovertebral-junction',
      confidence: 0.95,
      supportingEvidenceIds: ['img-cervical-2012', 'img-skanmex-spine-2022-12'],
      notes: 'C1 bilateral assimilation L>R, platybasia 146°, basilar impression',
      evidenceTier: 'T1-official',
      validationStatus: 'confirmed',
      sourceCredibility: 95,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a suspected diagnosis', () => {
    const result = diagnosisSchema.safeParse({
      id: 'dx-sjogren-suspected',
      patientId: 'patient-tomasz-szychlinski',
      icd10Code: 'M35.0',
      conditionName: 'Sjögren syndrome (suspected)',
      currentStatus: 'suspected',
      bodyRegion: 'immunologic',
      confidence: 0.15,
      notes: 'Anti-Ro-60 platform discrepancy, third-method confirmation required',
    });
    expect(result.success).toBe(true);
  });

  it('validates status enum', () => {
    const result = diagnosisSchema.safeParse({
      id: 'dx-bad',
      patientId: 'p1',
      conditionName: 'Test',
      currentStatus: 'uncertain',
    });
    expect(result.success).toBe(false);
  });

  it('validates body region enum', () => {
    const result = diagnosisSchema.safeParse({
      id: 'dx-bad',
      patientId: 'p1',
      conditionName: 'Test',
      currentStatus: 'active',
      bodyRegion: 'neck',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Progression Schema ──────────────────────────────────────────────────

describe('progressionSchema', () => {
  it('accepts a disc progression chain entry', () => {
    const result = progressionSchema.safeParse({
      id: 'prog-c67-2019',
      patientId: 'patient-tomasz-szychlinski',
      findingChainId: 'chain-c67-disc',
      findingName: 'C6/C7 disc',
      findingDomain: 'imaging',
      anatomicalLocation: 'C6/C7',
      date: '2019-08-07',
      value: 'moderate right foraminal herniation with probable C7 root compression',
      description: 'Progressed from protrusion (2014) to moderate herniation (2019)',
      direction: 'worsening',
      comparisonNote: 'Protrusion in 2014 → moderate herniation with C7 compression',
      sourceRecordId: 'img-cervical-2019',
      sourceRecordType: 'imaging-report',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a lab value progression entry', () => {
    const result = progressionSchema.safeParse({
      id: 'prog-wbc-aug2025',
      patientId: 'patient-tomasz-szychlinski',
      findingChainId: 'chain-wbc',
      findingName: 'WBC count',
      findingDomain: 'lab',
      date: '2025-08-27',
      value: '2.59 K/µL',
      numericValue: 2.59,
      unit: 'K/µL',
      direction: 'worsening',
      comparisonNote: 'Nadir — lowest recorded value, pancytopenic pattern',
      sourceRecordId: 'lab-wbc-aug2025',
      sourceRecordType: 'lab-result',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a cyst size progression', () => {
    const result = progressionSchema.safeParse({
      id: 'prog-cyst-dec2022',
      patientId: 'patient-tomasz-szychlinski',
      findingChainId: 'chain-maxillary-cyst',
      findingName: 'Left maxillary sinus retention cyst',
      findingDomain: 'imaging',
      anatomicalLocation: 'left_maxillary_sinus',
      date: '2022-12-15',
      value: '3.7 cm',
      numericValue: 3.7,
      unit: 'cm',
      direction: 'worsening',
      comparisonNote: 'Increased from 2.5 cm (April 2022) — 48% growth in 8 months',
    });
    expect(result.success).toBe(true);
  });

  it('validates finding domain enum', () => {
    const result = progressionSchema.safeParse({
      id: 'prog-bad',
      patientId: 'p1',
      findingChainId: 'chain-1',
      findingName: 'test',
      findingDomain: 'genetics',
      date: '2022-01-01',
      value: 'test',
      direction: 'stable',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Report Version Schema ───────────────────────────────────────────────

describe('reportVersionSchema', () => {
  it('accepts a v5.3 English report version', () => {
    const result = reportVersionSchema.safeParse({
      id: 'report-en-v5.3',
      patientId: 'patient-tomasz-szychlinski',
      reportName: 'diagnostic-therapeutic-plan',
      language: 'en',
      version: '5.3',
      filePath: 'research/diagnostic-therapeutic-plan-english.md',
      contentHash: 'sha256-of-english-doc',
      lineCount: 800,
      subsectionCount: 42,
      changesSummary:
        'Integrated 2022 Skanmex MRI reports: C7/T1 extrusion, AICA loops, maxillary cyst progression',
      changeSource: '2022 Skanmex report integration',
      createdAt: '2026-03-12T03:30:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid language', () => {
    const result = reportVersionSchema.safeParse({
      id: 'report-bad',
      patientId: 'p1',
      reportName: 'test',
      language: 'fr',
      version: '1.0',
      filePath: 'test.md',
      contentHash: 'hash',
      createdAt: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Report Data Integration Schema ──────────────────────────────────────

describe('reportDataIntegrationSchema', () => {
  it('accepts an integrated imaging report', () => {
    const result = reportDataIntegrationSchema.safeParse({
      id: 'int-001',
      patientId: 'patient-tomasz-szychlinski',
      reportVersionId: 'report-en-v5.3',
      dataId: 'img-skanmex-spine-2022-12',
      dataType: 'imaging-report',
      integrationStatus: 'integrated',
      sectionAffected: '2.1 Confirmed Diagnoses',
      integratedAt: '2026-03-12T03:27:00Z',
      createdAt: '2026-03-12T03:27:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a pending data integration', () => {
    const result = reportDataIntegrationSchema.safeParse({
      id: 'int-002',
      patientId: 'patient-tomasz-szychlinski',
      reportVersionId: 'report-en-v5.3',
      dataId: 'lab-new-wbc-2026-04',
      dataType: 'lab-result',
      integrationStatus: 'pending',
      sectionAffected: '10.1 WBC Trajectory',
      createdAt: '2026-04-01T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an excluded data integration with reason', () => {
    const result = reportDataIntegrationSchema.safeParse({
      id: 'int-003',
      patientId: 'patient-tomasz-szychlinski',
      reportVersionId: 'report-en-v5.3',
      dataId: 'finding-duplicate-001',
      dataType: 'research-finding',
      integrationStatus: 'excluded',
      exclusionReason: 'Duplicate of existing finding already in report',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates data type enum', () => {
    const result = reportDataIntegrationSchema.safeParse({
      id: 'int-bad',
      patientId: 'p1',
      reportVersionId: 'rv1',
      dataId: 'd1',
      dataType: 'pdf',
      integrationStatus: 'integrated',
      createdAt: '2026-01-01',
    });
    expect(result.success).toBe(false);
  });
});
