import { describe, expect, it } from '@jest/globals';
import { canonicalizeTestName, normalizeLabValue, normalizeUnit } from './normalizer.js';

describe('normalizeUnit', () => {
  describe('Polish units → international', () => {
    it('converts tys/µl to K/µL', () => {
      expect(normalizeUnit('tys/µl')).toBe('K/µL');
    });

    it('converts mln/µl to M/µL', () => {
      expect(normalizeUnit('mln/µl')).toBe('M/µL');
    });

    it('converts sek to s', () => {
      expect(normalizeUnit('sek')).toBe('s');
    });

    it('converts Indeks to Index', () => {
      expect(normalizeUnit('Indeks')).toBe('Index');
    });
  });

  describe('asterisk stripping', () => {
    it('strips trailing asterisk from units', () => {
      expect(normalizeUnit('tys/µl*')).toBe('K/µL');
      expect(normalizeUnit('%*')).toBe('%');
      expect(normalizeUnit('fl*')).toBe('fl');
      expect(normalizeUnit('g/dl*')).toBe('g/dl');
      expect(normalizeUnit('ng/dl*')).toBe('ng/dl');
    });

    it('strips multiple trailing asterisks', () => {
      expect(normalizeUnit('U/l**')).toBe('U/l');
    });
  });

  describe('GFR unit normalization', () => {
    it('normalizes comma decimal separator', () => {
      expect(normalizeUnit('ml/min/1,73m²')).toBe('ml/min/1.73m²');
    });

    it('normalizes plain m2 to m²', () => {
      expect(normalizeUnit('ml/min/1,73m2')).toBe('ml/min/1.73m²');
    });

    it('normalizes dot decimal separator', () => {
      expect(normalizeUnit('ml/min/1.73m2')).toBe('ml/min/1.73m²');
    });

    it('normalizes with asterisk', () => {
      expect(normalizeUnit('ml/min/1,73m2*')).toBe('ml/min/1.73m²');
    });
  });

  describe('extraction error detection', () => {
    it('returns empty string for numeric values in unit field', () => {
      expect(normalizeUnit('48,31')).toBe('');
      expect(normalizeUnit('2,64')).toBe('');
      expect(normalizeUnit('4.32')).toBe('');
      expect(normalizeUnit('10,39')).toBe('');
    });
  });

  describe('Polish words in unit field', () => {
    it('clears **Negatywny**', () => {
      expect(normalizeUnit('**Negatywny**')).toBe('');
    });

    it('clears **niereaktywny**', () => {
      expect(normalizeUnit('**niereaktywny**')).toBe('');
    });
  });

  describe('passthrough for valid international units', () => {
    it('preserves standard units unchanged', () => {
      expect(normalizeUnit('%')).toBe('%');
      expect(normalizeUnit('mg/dl')).toBe('mg/dl');
      expect(normalizeUnit('U/ml')).toBe('U/ml');
      expect(normalizeUnit('ng/ml')).toBe('ng/ml');
      expect(normalizeUnit('g/dl')).toBe('g/dl');
      expect(normalizeUnit('mmol/l')).toBe('mmol/l');
      expect(normalizeUnit('pg')).toBe('pg');
      expect(normalizeUnit('fl')).toBe('fl');
      expect(normalizeUnit('mm/h')).toBe('mm/h');
      expect(normalizeUnit('µg/dl')).toBe('µg/dl');
      expect(normalizeUnit('IU/ml')).toBe('IU/ml');
    });

    it('preserves empty string', () => {
      expect(normalizeUnit('')).toBe('');
    });
  });
});

describe('canonicalizeTestName', () => {
  describe('CBC test name variants', () => {
    it('maps all WBC variants to WBC', () => {
      expect(canonicalizeTestName('WBC')).toBe('WBC');
      expect(canonicalizeTestName('WBC (White Blood Cells)')).toBe('WBC');
      expect(canonicalizeTestName('White blood cells')).toBe('WBC');
      expect(canonicalizeTestName('Leukocyty')).toBe('WBC');
    });

    it('maps all RBC variants to RBC', () => {
      expect(canonicalizeTestName('RBC')).toBe('RBC');
      expect(canonicalizeTestName('RBC (Red Blood Cells)')).toBe('RBC');
      expect(canonicalizeTestName('Red blood cells')).toBe('RBC');
      expect(canonicalizeTestName('Erytrocyty')).toBe('RBC');
    });

    it('maps platelet variants to Platelets', () => {
      expect(canonicalizeTestName('Platelets')).toBe('Platelets');
      expect(canonicalizeTestName('PLT (Platelets)')).toBe('Platelets');
      expect(canonicalizeTestName('PLT')).toBe('Platelets');
      expect(canonicalizeTestName('Płytki krwi')).toBe('Platelets');
    });
  });

  describe('WBC differential variants', () => {
    it('normalizes neutrophil variants', () => {
      expect(canonicalizeTestName('Neutrophils (absolute)')).toBe('Neutrophils (abs)');
      expect(canonicalizeTestName('Neutrophils (abs.)')).toBe('Neutrophils (abs)');
      expect(canonicalizeTestName('Neutrophils abs.')).toBe('Neutrophils (abs)');
      expect(canonicalizeTestName('Neutrophils absolute')).toBe('Neutrophils (abs)');
      expect(canonicalizeTestName('Neutrofile')).toBe('Neutrophils (abs)');
    });

    it('normalizes lymphocyte variants', () => {
      expect(canonicalizeTestName('Lymphocytes (abs.)')).toBe('Lymphocytes (abs)');
      expect(canonicalizeTestName('Limfocyty')).toBe('Lymphocytes (abs)');
      expect(canonicalizeTestName('Lymphocytes %')).toBe('Lymphocytes %');
      expect(canonicalizeTestName('Limfocyty %')).toBe('Lymphocytes %');
    });
  });

  describe('Polish test names → English', () => {
    it('maps Polish metabolic panel names', () => {
      expect(canonicalizeTestName('Glukoza')).toBe('Glucose');
      expect(canonicalizeTestName('Kreatynina')).toBe('Creatinine');
      expect(canonicalizeTestName('Mocznik')).toBe('Urea');
      expect(canonicalizeTestName('Kwas moczowy')).toBe('Uric acid');
      expect(canonicalizeTestName('Sód')).toBe('Sodium');
      expect(canonicalizeTestName('Potas')).toBe('Potassium');
      expect(canonicalizeTestName('Magnez')).toBe('Magnesium');
    });

    it('maps Polish lipid panel names', () => {
      expect(canonicalizeTestName('Cholesterol całkowity')).toBe('Total cholesterol');
      expect(canonicalizeTestName('Cholesterol HDL')).toBe('HDL cholesterol');
      expect(canonicalizeTestName('Cholesterol LDL')).toBe('LDL cholesterol');
      expect(canonicalizeTestName('Triglicerydy')).toBe('Triglycerides');
    });

    it('maps Polish vitamin names', () => {
      expect(canonicalizeTestName('Witamina D3 25(OH)')).toBe('Vitamin D 25-OH');
      expect(canonicalizeTestName('Witamina B12')).toBe('Vitamin B12');
      expect(canonicalizeTestName('Ferrytyna')).toBe('Ferritin');
    });

    it('maps Polish thyroid names', () => {
      expect(canonicalizeTestName('Anty-TPO')).toBe('Anti-TPO');
    });

    it('maps Polish autoimmune panel names', () => {
      expect(canonicalizeTestName('anty-Hu')).toBe('Anti-Hu');
      expect(canonicalizeTestName('anty-mielina')).toBe('Anti-myelin');
      expect(canonicalizeTestName('anty-GAD')).toBe('Anti-GAD');
    });

    it('maps Polish liver function names', () => {
      expect(canonicalizeTestName('Bilirubina całkowita')).toBe('Total bilirubin');
      expect(canonicalizeTestName('Fosfataza zasadowa')).toBe('Alkaline phosphatase');
      expect(canonicalizeTestName('GGTP')).toBe('GGT');
    });

    it('maps Polish electrophoresis names', () => {
      expect(canonicalizeTestName('Alfa-2-globuliny')).toBe('Alpha-2 globulins');
      expect(canonicalizeTestName('Gamma-globuliny')).toBe('Gamma globulins');
    });
  });

  describe('abbreviation expansions', () => {
    it('normalizes vitamin D variants', () => {
      expect(canonicalizeTestName('25-OH Vitamin D3')).toBe('Vitamin D 25-OH');
      expect(canonicalizeTestName('Vitamin D 25(OH)')).toBe('Vitamin D 25-OH');
      expect(canonicalizeTestName('Vitamin D3 25-OH')).toBe('Vitamin D 25-OH');
      expect(canonicalizeTestName('Vitamin D3 25-OH (25-Hydroxyvitamin D)')).toBe(
        'Vitamin D 25-OH',
      );
    });

    it('normalizes COVID-19 test variants', () => {
      expect(canonicalizeTestName('SARS-CoV-2 (COVID-19) RT-PCR')).toBe('SARS-CoV-2 RT-PCR');
      expect(canonicalizeTestName('SARS-CoV-2 RNA (gen RdRp / gen N)')).toBe('SARS-CoV-2 RT-PCR');
    });

    it('normalizes infection test variants', () => {
      expect(canonicalizeTestName('Chlamydia trachomatis')).toBe('Chlamydia trachomatis DNA');
      expect(canonicalizeTestName('Chlamydia trachomatis DNA')).toBe('Chlamydia trachomatis DNA');
    });
  });

  describe('case insensitivity', () => {
    it('handles mixed case input', () => {
      expect(canonicalizeTestName('wbc')).toBe('WBC');
      expect(canonicalizeTestName('HEMOGLOBIN')).toBe('Hemoglobin');
      expect(canonicalizeTestName('total cholesterol')).toBe('Total cholesterol');
    });
  });

  describe('passthrough for unknown names', () => {
    it('returns original name when no mapping exists', () => {
      expect(canonicalizeTestName('Some Unknown Test')).toBe('Some Unknown Test');
    });

    it('trims whitespace', () => {
      expect(canonicalizeTestName('  WBC  ')).toBe('WBC');
    });
  });
});

describe('normalizeLabValue', () => {
  it('normalizes both test name and unit together', () => {
    const result = normalizeLabValue('Leukocyty', 'tys/µl*');
    expect(result.testName).toBe('WBC');
    expect(result.unit).toBe('K/µL');
  });

  it('handles already-normalized values', () => {
    const result = normalizeLabValue('Hemoglobin', 'g/dl');
    expect(result.testName).toBe('Hemoglobin');
    expect(result.unit).toBe('g/dl');
  });

  it('handles extraction error in unit field', () => {
    const result = normalizeLabValue('Alfa-2-globuliny', '4,32');
    expect(result.testName).toBe('Alpha-2 globulins');
    expect(result.unit).toBe('');
  });
});
