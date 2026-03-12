import { describe, expect, it } from '@jest/globals';
import {
  asklepiosTypeEnum,
  documentTypeMapping,
  labFlagEnum,
  recordFrontmatterSchema,
  sourceDocTypeEnum,
  structuredLabValueSchema,
  structuredValuesBlockSchema,
} from './schemas.js';

describe('sourceDocTypeEnum', () => {
  it('accepts all valid source document types', () => {
    for (const type of [
      'lab_result',
      'consultation',
      'imaging_report',
      'procedure',
      'narrative',
      'external',
      'other',
    ]) {
      expect(sourceDocTypeEnum.parse(type)).toBe(type);
    }
  });

  it('rejects invalid document types', () => {
    expect(() => sourceDocTypeEnum.parse('pdf')).toThrow();
    expect(() => sourceDocTypeEnum.parse('')).toThrow();
  });
});

describe('asklepiosTypeEnum', () => {
  it('accepts all valid Asklepios types (FHIR R4-aligned)', () => {
    for (const type of [
      'diagnostic-report',
      'procedure-note',
      'clinical-note',
      'patient-document',
      'research-paper',
      'other',
    ]) {
      expect(asklepiosTypeEnum.parse(type)).toBe(type);
    }
  });

  it('rejects source format types', () => {
    expect(() => asklepiosTypeEnum.parse('lab_result')).toThrow();
  });
});

describe('documentTypeMapping (FHIR R4-aligned)', () => {
  it('maps lab_result to diagnostic-report (DiagnosticReport/LAB)', () => {
    expect(documentTypeMapping.lab_result).toBe('diagnostic-report');
  });

  it('maps imaging_report to diagnostic-report (DiagnosticReport/RAD)', () => {
    expect(documentTypeMapping.imaging_report).toBe('diagnostic-report');
  });

  it('maps procedure to procedure-note (FHIR Procedure)', () => {
    expect(documentTypeMapping.procedure).toBe('procedure-note');
  });

  it('maps consultation to clinical-note (DocumentReference)', () => {
    expect(documentTypeMapping.consultation).toBe('clinical-note');
  });

  it('maps external to clinical-note (DocumentReference)', () => {
    expect(documentTypeMapping.external).toBe('clinical-note');
  });

  it('maps narrative to patient-document (DocumentReference)', () => {
    expect(documentTypeMapping.narrative).toBe('patient-document');
  });

  it('maps other to other', () => {
    expect(documentTypeMapping.other).toBe('other');
  });
});

describe('recordFrontmatterSchema', () => {
  const validFrontmatter = {
    document_id: 'lab-20250901-001',
    document_type: 'lab_result',
    patient_id: 'tomasz-szychliński',
    asklepios_type: 'diagnostic-report',
    evidence_tier: 'T1-official',
    validation_status: 'confirmed',
    source_credibility: 98,
    date: '2025-09-01',
  };

  it('accepts valid frontmatter', () => {
    const result = recordFrontmatterSchema.safeParse(validFrontmatter);
    expect(result.success).toBe(true);
  });

  it('rejects missing document_id', () => {
    const { document_id: _, ...without } = validFrontmatter;
    const result = recordFrontmatterSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects missing patient_id', () => {
    const { patient_id: _, ...without } = validFrontmatter;
    const result = recordFrontmatterSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects invalid document_type', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      document_type: 'pdf',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid evidence_tier', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      evidence_tier: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects source_credibility > 100', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      source_credibility: 150,
    });
    expect(result.success).toBe(false);
  });

  it('rejects source_credibility < 0', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      source_credibility: -5,
    });
    expect(result.success).toBe(false);
  });

  it('handles null date (YAML null) as undefined', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      date: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.date).toBeUndefined();
    }
  });

  it('allows extra fields via passthrough', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      modality: 'MRI',
      body_region: 'cervical spine',
    });
    expect(result.success).toBe(true);
  });

  it('accepts all evidence tier values', () => {
    for (const tier of [
      'T1-official',
      'T1-specialist',
      'T2-patient-reported',
      'T3-ai-inferred',
      'meta-analysis',
      'RCT',
      'cohort',
      'case-series',
      'case-report',
      'expert-opinion',
    ]) {
      const result = recordFrontmatterSchema.safeParse({
        ...validFrontmatter,
        evidence_tier: tier,
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts optional metadata fields', () => {
    const result = recordFrontmatterSchema.safeParse({
      ...validFrontmatter,
      source_lab: 'Diagnostyka',
      facility: 'Wrocław',
      extraction_confidence: 0.98,
      tags: ['CBC', 'hematology'],
      loinc_codes: ['26464-8'],
    });
    expect(result.success).toBe(true);
  });
});

describe('labFlagEnum', () => {
  it('accepts all valid flags', () => {
    for (const flag of ['normal', 'low', 'high', 'critical']) {
      expect(labFlagEnum.parse(flag)).toBe(flag);
    }
  });

  it('rejects invalid flags', () => {
    expect(() => labFlagEnum.parse('borderline')).toThrow();
  });
});

describe('structuredLabValueSchema', () => {
  const validLabValue = {
    test_name: 'White blood cells (WBC)',
    test_name_pl: 'Leukocyty (WBC)',
    loinc: '26464-8',
    value: 2.59,
    unit: 'tys/µl',
    reference_range: '4.00 - 10.00',
    flag: 'low',
    date: '2025-09-01',
  };

  it('accepts valid lab value with numeric value', () => {
    const result = structuredLabValueSchema.safeParse(validLabValue);
    expect(result.success).toBe(true);
  });

  it('accepts string value (qualitative results)', () => {
    const result = structuredLabValueSchema.safeParse({
      ...validLabValue,
      value: 'Not detected',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing test_name', () => {
    const { test_name: _, ...without } = validLabValue;
    const result = structuredLabValueSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects missing date', () => {
    const { date: _, ...without } = validLabValue;
    const result = structuredLabValueSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects invalid flag', () => {
    const result = structuredLabValueSchema.safeParse({
      ...validLabValue,
      flag: 'abnormal',
    });
    expect(result.success).toBe(false);
  });

  it('accepts lab value without optional fields', () => {
    const result = structuredLabValueSchema.safeParse({
      test_name: 'WBC',
      value: 3.5,
      unit: 'tys/µl',
      flag: 'normal',
      date: '2025-01-01',
    });
    expect(result.success).toBe(true);
  });
});

describe('structuredValuesBlockSchema', () => {
  it('accepts valid lab_values array', () => {
    const result = structuredValuesBlockSchema.safeParse({
      lab_values: [
        {
          test_name: 'WBC',
          value: 3.5,
          unit: 'tys/µl',
          flag: 'low',
          date: '2025-01-01',
        },
        {
          test_name: 'RBC',
          value: 4.5,
          unit: 'mln/µl',
          flag: 'normal',
          date: '2025-01-01',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lab_values).toHaveLength(2);
    }
  });

  it('rejects missing lab_values key', () => {
    const result = structuredValuesBlockSchema.safeParse({
      values: [{ test_name: 'WBC', value: 1, unit: 'x', flag: 'normal', date: '2025-01-01' }],
    });
    expect(result.success).toBe(false);
  });
});
