import { beforeEach, describe, expect, it } from '@jest/globals';

import type {
  Consultation,
  ImagingReport,
  LabResult,
  ProcedureReport,
} from '../schemas/clinical-record.js';
import {
  getTerminologyService,
  resetTerminologyService,
  SYSTEM_ICD10,
  SYSTEM_LOINC,
  SYSTEM_RXNORM,
  SYSTEM_SNOMED,
} from '../terminology/terminology-service.js';
import {
  validateConsultationRecord,
  validateImagingRecord,
  validateLabRecord,
  validateMedicationRecord,
  validateProcedureRecord,
} from './validation-layer.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────

function makeLab(overrides: Partial<LabResult> = {}): LabResult {
  return {
    id: 'lab-1',
    patientId: 'P1',
    testName: 'WBC',
    value: 6.5,
    unit: 'x10^3/µL',
    date: '2024-01-15',
    loincCode: '6690-2',
    ...overrides,
  };
}

function makeConsultation(overrides: Partial<Consultation> = {}): Consultation {
  return {
    id: 'cons-1',
    patientId: 'P1',
    provider: 'Dr. Smith',
    specialty: 'Neurology',
    date: '2024-01-15',
    conclusionsStatus: 'documented',
    ...overrides,
  };
}

function makeImaging(overrides: Partial<ImagingReport> = {}): ImagingReport {
  return {
    id: 'img-1',
    patientId: 'P1',
    modality: 'MRI',
    bodyRegion: 'head',
    date: '2024-01-15',
    ...overrides,
  };
}

function makeProcedure(overrides: Partial<ProcedureReport> = {}): ProcedureReport {
  return {
    id: 'proc-1',
    patientId: 'P1',
    procedureType: 'gastroscopy',
    date: '2024-01-15',
    ...overrides,
  };
}

// ─── Setup: Register mock validators ──────────────────────────────────────

beforeEach(() => {
  resetTerminologyService();
  const svc = getTerminologyService();

  // LOINC validator: valid = matches ^\d{1,5}-\d{1}$ pattern
  svc.registerValidator(SYSTEM_LOINC, (code: string) => {
    const valid = /^\d{1,5}-\d$/.test(code);
    return {
      valid,
      display: valid ? `LOINC display for ${code}` : undefined,
    };
  });

  // SNOMED validator: valid = all digits, 6-18 chars
  svc.registerValidator(SYSTEM_SNOMED, (code: string) => {
    const valid = /^\d{6,18}$/.test(code);
    return { valid };
  });

  // ICD-10 validator: valid = letter followed by digits with optional dot
  svc.registerValidator(SYSTEM_ICD10, (code: string) => {
    const valid = /^[A-Z]\d{2}(\.\d{1,4})?$/.test(code);
    return { valid };
  });

  // RxNorm validator: valid = all digits
  svc.registerValidator(SYSTEM_RXNORM, (code: string) => {
    const valid = /^\d+$/.test(code);
    return { valid };
  });
});

// ─── Lab Validation ───────────────────────────────────────────────────────

describe('validation-layer', () => {
  describe('validateLabRecord', () => {
    it('passes a valid lab with high confidence', () => {
      const result = validateLabRecord(makeLab(), 0.95);
      expect(result.fhirStatus).toBe('final');
      expect(result.errors).toHaveLength(0);
      expect(result.escalate).toBe(false);
    });

    it('catches invalid LOINC code format', () => {
      const lab = makeLab({ loincCode: 'INVALID' });
      const result = validateLabRecord(lab, 0.95);
      expect(result.errors.some((e) => e.includes('Invalid LOINC code format'))).toBe(true);
      // Confidence reduced by 0.15 → 0.80 → preliminary
      expect(result.confidence).toBeLessThan(0.9);
      expect(result.fhirStatus).toBe('preliminary');
    });

    it('warns on implausible values from plausibility check', () => {
      const lab = makeLab({ testName: 'WBC', value: 50000 });
      const result = validateLabRecord(lab, 0.95);
      expect(result.warnings.some((w) => w.includes('Implausible WBC'))).toBe(true);
    });

    it('validates SNOMED value code format', () => {
      const lab = makeLab({ valueSnomedCode: 'BAD-SNOMED' });
      const result = validateLabRecord(lab, 0.95);
      expect(result.errors.some((e) => e.includes('SNOMED value'))).toBe(true);
    });

    it('accepts valid SNOMED value code', () => {
      const lab = makeLab({ valueSnomedCode: '260385009' });
      const result = validateLabRecord(lab, 0.95);
      expect(result.errors.filter((e) => e.includes('SNOMED'))).toHaveLength(0);
    });
  });

  // ─── Consultation Validation ──────────────────────────────────────────

  describe('validateConsultationRecord', () => {
    it('passes a valid consultation with high confidence', () => {
      const cons = makeConsultation({
        snomedFindingCode: '398057008',
        icd10Code: 'G44.2',
      });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.fhirStatus).toBe('final');
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid SNOMED finding code', () => {
      const cons = makeConsultation({ snomedFindingCode: 'BAD' });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.errors.some((e) => e.includes('SNOMED finding'))).toBe(true);
    });

    it('catches invalid ICD-10 code format', () => {
      const cons = makeConsultation({ icd10Code: '1234' });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.errors.some((e) => e.includes('ICD-10'))).toBe(true);
    });

    it('warns on future date', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      const cons = makeConsultation({ date: futureDate.toISOString().slice(0, 10) });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.warnings.some((w) => w.includes('future'))).toBe(true);
    });

    it('warns on date before 1900', () => {
      const cons = makeConsultation({ date: '1850-01-01' });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.warnings.some((w) => w.includes('before 1900'))).toBe(true);
    });

    it('checks SNOMED-ICD-10 crosswalk consistency via terminology service', () => {
      // Register a crosswalk on the terminology service
      const svc = getTerminologyService();
      svc.registerCrosswalk(SYSTEM_SNOMED, SYSTEM_ICD10, (sourceCode: string) => {
        if (sourceCode === '398057008') {
          return [
            {
              sourceSystem: SYSTEM_SNOMED,
              sourceCode: '398057008',
              targetSystem: SYSTEM_ICD10,
              targetCode: 'G44.2',
              relationship: 'equivalent' as const,
            },
          ];
        }
        return [];
      });

      // Mismatched: SNOMED crosswalk says G44.2 but record has G50.0
      const cons = makeConsultation({
        snomedFindingCode: '398057008',
        icd10Code: 'G50.0',
      });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.warnings.some((w) => w.includes('crosswalk mismatch'))).toBe(true);
    });

    it('skips crosswalk check when no crosswalk entries exist', () => {
      // No crosswalk registered, so translate returns []
      const cons = makeConsultation({
        snomedFindingCode: '999999999',
        icd10Code: 'G50.0',
      });
      const result = validateConsultationRecord(cons, 0.95);
      expect(result.warnings.filter((w) => w.includes('crosswalk'))).toHaveLength(0);
    });
  });

  // ─── Imaging Validation ───────────────────────────────────────────────

  describe('validateImagingRecord', () => {
    it('passes valid imaging report', () => {
      const img = makeImaging({ loincStudyCode: '36801-9', bodySiteSnomedCode: '69536005' });
      const result = validateImagingRecord(img, 0.95);
      expect(result.fhirStatus).toBe('final');
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid LOINC study code', () => {
      const img = makeImaging({ loincStudyCode: 'INVALID' });
      const result = validateImagingRecord(img, 0.95);
      expect(result.errors.some((e) => e.includes('LOINC study'))).toBe(true);
    });

    it('catches invalid SNOMED body site code', () => {
      const img = makeImaging({ bodySiteSnomedCode: 'BAD' });
      const result = validateImagingRecord(img, 0.95);
      expect(result.errors.some((e) => e.includes('SNOMED body site'))).toBe(true);
    });

    it('warns when modality and LOINC display mismatch', () => {
      // Register a validator that returns MRI-related display for a LOINC code
      const svc = getTerminologyService();
      svc.registerValidator(SYSTEM_LOINC, (code: string) => {
        if (code === '36801-9') {
          return { valid: true, display: 'MRI Brain without contrast' };
        }
        return { valid: /^\d{1,5}-\d$/.test(code) };
      });

      // X-ray modality but LOINC says MRI
      const img = makeImaging({
        modality: 'X-ray',
        loincStudyCode: '36801-9',
      });
      const result = validateImagingRecord(img, 0.95);
      expect(result.warnings.some((w) => w.includes('suggests MRI'))).toBe(true);
    });
  });

  // ─── Procedure Validation ─────────────────────────────────────────────

  describe('validateProcedureRecord', () => {
    it('passes valid procedure report', () => {
      const proc = makeProcedure({ loincProcedureCode: '28010-7' });
      const result = validateProcedureRecord(proc, 0.95);
      expect(result.fhirStatus).toBe('final');
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid LOINC procedure code', () => {
      const proc = makeProcedure({ loincProcedureCode: 'BAD-CODE' });
      const result = validateProcedureRecord(proc, 0.95);
      expect(result.errors.some((e) => e.includes('LOINC procedure'))).toBe(true);
    });
  });

  // ─── Medication Validation ────────────────────────────────────────────

  describe('validateMedicationRecord', () => {
    it('passes valid medication with RxNorm code', () => {
      const result = validateMedicationRecord(
        { rxnormCode: '723', medicationName: 'Amoxicillin' },
        0.95,
      );
      expect(result.fhirStatus).toBe('final');
      expect(result.errors).toHaveLength(0);
    });

    it('catches invalid RxNorm code', () => {
      const result = validateMedicationRecord(
        { rxnormCode: 'NOT-A-CODE', medicationName: 'Mystery Drug' },
        0.95,
      );
      expect(result.errors.some((e) => e.includes('RxNorm'))).toBe(true);
    });

    it('passes medication without RxNorm code', () => {
      const result = validateMedicationRecord({ medicationName: 'Aspirin' }, 0.95);
      expect(result.errors).toHaveLength(0);
    });
  });

  // ─── Confidence Thresholds ────────────────────────────────────────────

  describe('confidence thresholds', () => {
    it('>=0.90 → final, no escalation', () => {
      const result = validateLabRecord(makeLab(), 0.95);
      expect(result.fhirStatus).toBe('final');
      expect(result.escalate).toBe(false);
    });

    it('0.70-0.89 → preliminary, no escalation', () => {
      const result = validateLabRecord(makeLab(), 0.85);
      expect(result.fhirStatus).toBe('preliminary');
      expect(result.escalate).toBe(false);
    });

    it('<0.70 → preliminary + escalate', () => {
      const result = validateLabRecord(makeLab(), 0.6);
      expect(result.fhirStatus).toBe('preliminary');
      expect(result.escalate).toBe(true);
    });

    it('confidence clamped to [0,1]', () => {
      const result = validateLabRecord(makeLab(), 1.5);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  // ─── Override: confirmed validation_status ────────────────────────────

  describe('validation_status override', () => {
    it('confirmed validation_status forces fhirStatus to final', () => {
      // Low confidence that would normally be preliminary
      const lab = makeLab({ validationStatus: 'confirmed' });
      const result = validateLabRecord(lab, 0.75);
      expect(result.fhirStatus).toBe('final');
    });

    it('confirmed override even at very low confidence', () => {
      const lab = makeLab({ validationStatus: 'confirmed' });
      const result = validateLabRecord(lab, 0.5);
      expect(result.fhirStatus).toBe('final');
      // escalate is still true because confidence < 0.70
      expect(result.escalate).toBe(true);
    });

    it('unconfirmed validation_status does not override', () => {
      const lab = makeLab({ validationStatus: 'unvalidated' });
      const result = validateLabRecord(lab, 0.75);
      expect(result.fhirStatus).toBe('preliminary');
    });
  });
});
