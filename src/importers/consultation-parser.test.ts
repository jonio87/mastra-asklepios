import { describe, expect, it } from '@jest/globals';
import { buildConsultationId, mapConsultation } from './consultation-parser.js';
import type { RecordFrontmatter } from './schemas.js';

function makeFrontmatter(
  overrides?: Partial<RecordFrontmatter> & Record<string, unknown>,
): RecordFrontmatter {
  return {
    document_id: 'con-mayo-cardio-001',
    document_type: 'consultation',
    patient_id: 'tomasz-szychliński',
    asklepios_type: 'consultation-letter',
    evidence_tier: 'T1-specialist',
    validation_status: 'confirmed',
    source_credibility: 98,
    date: '2024-12-16',
    source_file: 'Mayo Clinic Visit Dec 2024.pdf',
    facility: 'Mayo Clinic, Rochester',
    institution: 'Mayo Clinic',
    ...overrides,
  } as RecordFrontmatter;
}

describe('buildConsultationId', () => {
  it('generates deterministic import ID', () => {
    expect(buildConsultationId('con-mayo-cardio-001')).toBe('import-con-con-mayo-cardio-001');
  });
});

describe('mapConsultation', () => {
  it('maps frontmatter fields to consultation schema', () => {
    const fm = makeFrontmatter({ physician: 'F.Brozovich', specialty: 'Cardiovascular Medicine' });
    const body = '# Consultation\n\nSome findings here.';
    const result = mapConsultation(fm, body);

    expect(result.id).toBe('import-con-con-mayo-cardio-001');
    expect(result.patientId).toBe('tomasz-szychliński');
    expect(result.provider).toBe('F.Brozovich');
    expect(result.specialty).toBe('cardiology');
    expect(result.institution).toBe('Mayo Clinic, Rochester');
    expect(result.date).toBe('2024-12-16');
    expect(result.source).toBe('Mayo Clinic Visit Dec 2024.pdf');
    expect(result.findings).toContain('Some findings here');
    expect(result.evidenceTier).toBe('T1-specialist');
    expect(result.sourceCredibility).toBe(98);
  });

  it('falls back to category when specialty is missing', () => {
    const fm = makeFrontmatter({ category: 'neurology' });
    const result = mapConsultation(fm, 'body text');
    expect(result.specialty).toBe('neurology');
  });

  it('defaults to Unknown when no provider fields exist', () => {
    const fm = makeFrontmatter();
    const result = mapConsultation(fm, 'body text');
    expect(result.provider).toBe('Unknown');
  });

  it('extracts assessment section as conclusions', () => {
    const body = `# Consultation

## Findings
Patient presents with chronic pain.

## Assessment
Suspect central sensitization with CVJ anomaly as primary driver.
Further imaging recommended.

## Plan
Order dynamic MRI.`;

    const result = mapConsultation(makeFrontmatter(), body);
    expect(result.conclusions).toContain('central sensitization');
    expect(result.conclusionsStatus).toBe('documented');
  });

  it('sets conclusionsStatus to unknown when no assessment found', () => {
    const body = '# Visit Notes\n\nRoutine checkup, no concerns.';
    const result = mapConsultation(makeFrontmatter(), body);
    expect(result.conclusions).toBeUndefined();
    expect(result.conclusionsStatus).toBe('unknown');
  });

  it('does NOT truncate findings — stores full body text', () => {
    const body = 'A'.repeat(8000);
    const result = mapConsultation(makeFrontmatter(), body);
    expect(result.findings?.length).toBe(8000);
  });

  // ─── Polish specialty extraction from source_file ───────────────────────

  it('extracts otolaryngology from source_file', () => {
    const fm = makeFrontmatter({
      specialty: undefined,
      category: 'other',
      source_file: 'Konsultacje lekarskie/2012.04 i 09 Badanie laryngologiczne.pdf',
    });
    const result = mapConsultation(fm, 'body');
    expect(result.specialty).toBe('otolaryngology');
  });

  it('extracts neurophysiology from EMG/ENG/MEP source_file', () => {
    const fm = makeFrontmatter({
      specialty: undefined,
      category: 'other',
      source_file: 'Konsultacje lekarskie/2018.05 Badania EMG, ENG,MEP.pdf',
    });
    const result = mapConsultation(fm, 'body');
    expect(result.specialty).toBe('neurophysiology');
  });

  it('extracts immunology from source_file', () => {
    const fm = makeFrontmatter({
      specialty: undefined,
      category: 'other',
      source_file: 'Konsultacje lekarskie/2021.05 Konsultacja immunologiczna.pdf',
    });
    const result = mapConsultation(fm, 'body');
    expect(result.specialty).toBe('immunology');
  });

  it('extracts pain_management from Duomed source_file', () => {
    const fm = makeFrontmatter({
      specialty: undefined,
      category: 'other',
      source_file: 'Konsultacje lekarskie/2024_11_06 Duomed.pdf',
    });
    const result = mapConsultation(fm, 'body');
    expect(result.specialty).toBe('pain_medicine');
  });

  it('extracts sleep_medicine from Polisomnografia', () => {
    const fm = makeFrontmatter({
      specialty: undefined,
      category: 'other',
      source_file: 'Konsultacje lekarskie/2019.10 Polisomnografia.pdf',
    });
    const result = mapConsultation(fm, 'body');
    expect(result.specialty).toBe('sleep_medicine');
  });

  it('keeps frontmatter specialty when available (does not override)', () => {
    const fm = makeFrontmatter({
      specialty: 'Neurology',
      source_file: 'Konsultacje lekarskie/2019.10 Polisomnografia.pdf',
    });
    const result = mapConsultation(fm, 'body');
    expect(result.specialty).toBe('neurology');
  });

  // ─── Provider extraction from body text ─────────────────────────────────

  it('extracts physician from body text when frontmatter is missing', () => {
    const fm = makeFrontmatter({ physician: undefined });
    const body = 'PESEL: 91111807912 Lekarz: otolaryngolog Marcin Frączek\nAdres: ul. Główna 5';
    const result = mapConsultation(fm, body);
    expect(result.provider).toContain('Marcin');
  });

  it('extracts Prof. physician from body text', () => {
    const fm = makeFrontmatter({ physician: undefined });
    const body = 'Opinia wydana przez Prof. Marek J. Sąsiadek w zakresie diagnostyki.';
    const result = mapConsultation(fm, body);
    expect(result.provider).toContain('Marek');
  });

  it('extracts dr n. med. physician from body text', () => {
    const fm = makeFrontmatter({ physician: undefined });
    const body = 'Badanie przeprowadził dr n. med. Mariusz Smigiel z kliniki ortopedycznej.';
    const result = mapConsultation(fm, body);
    expect(result.provider).toContain('Mariusz');
  });

  it('extracts Swiss German Facharzt from body text', () => {
    const fm = makeFrontmatter({ physician: undefined });
    const body = 'Dr. med. Martin Toniolo Facharzt: Neurologie, Universitätsspital Basel';
    const result = mapConsultation(fm, body);
    expect(result.provider).toContain('Martin Toniolo');
  });

  // ─── Polish plain-text assessment headers ───────────────────────────────

  it('extracts conclusions from plain-text Rozpoznanie wstępne:', () => {
    const body = `Wywiad:
Pacjent zgłasza ból głowy od 16 lat.

Rozpoznanie wstępne:
ból funkcjonalny, fibromialgia, zaburzenia osi anatomiczno-czynnościowej

Badanie:
Wynik RTG prawidłowy.`;

    const result = mapConsultation(makeFrontmatter(), body);
    expect(result.conclusions).toContain('fibromialgia');
    expect(result.conclusionsStatus).toBe('documented');
  });

  it('extracts conclusions from plain-text Wnioski:', () => {
    const body = `Historia choroby:
Pacjent ma chroniczny ból.

Wnioski:
Zaleca się dalszą diagnostykę w kierunku neuropatii obwodowej.
Kontrola za 3 miesiące.

Badanie:
Wyniki prawidłowe.`;

    const result = mapConsultation(makeFrontmatter(), body);
    expect(result.conclusions).toContain('neuropatii');
    expect(result.conclusionsStatus).toBe('documented');
  });

  it('extracts conclusions from Mayo IMPRESSION: header', () => {
    const body = `SUBJECTIVE

Patient reports continued right-sided facial pain. Current medications include LDN 2.5mg.

IMPRESSION:
Chronic right-sided craniofacial pain syndrome, likely trigeminal origin.
CVJ anomaly with C1 assimilation.

FOLLOW UP:
Return in 3 months.`;

    const result = mapConsultation(makeFrontmatter(), body);
    expect(result.conclusions).toContain('trigeminal');
    expect(result.conclusionsStatus).toBe('documented');
  });
});
