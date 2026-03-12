/**
 * Parse consultation markdown files from medical-records extraction into
 * Consultation objects suitable for import to clinical_consultations table.
 *
 * Maps YAML frontmatter → Consultation schema:
 *   physician → provider
 *   specialty → specialty (from frontmatter, pass-through field)
 *   facility/institution → institution
 *   date → date
 *   source_file → source
 *   body text → findings (full text, no truncation)
 *   Assessment/Plan section → conclusions (if found)
 */

import type { Consultation } from '../schemas/clinical-record.js';
import type { RecordFrontmatter } from './schemas.js';
import { normalizeSpecialty } from './specialty-normalizer.js';

// ─── Assessment section extraction ──────────────────────────────────────

/** Patterns that commonly start a conclusions/assessment section */
const ASSESSMENT_HEADERS = [
  // Markdown headers (English)
  /^#{1,3}\s*(?:Assessment|ASSESSMENT|Assessment\s*(?:&|and|\/)\s*Plan|ASSESSMENT\s*\/?\s*PLAN)/m,
  // Plain-text section headers (Mayo Clinic format)
  /^(?:ASSESSMENT|IMPRESSION|CONCLUSIONS?|DIAGNOS(?:IS|ES)|SUMMARY)\s*[:/]?\s*$/m,
  /^(?:ASSESSMENT\s*\/?\s*PLAN)\s*[:/]?\s*$/m,
  /^IMPRESSION\s*:\s*$/m,
  // Markdown headers (Polish)
  /^#{1,3}\s*(?:Impression|Wnioski|Rozpoznanie|Diagnoza|Ocena|Zalecenia|Rekomendacje)/m,
  // Plain-text Polish headers
  /^(?:Wnioski|Rozpoznanie|Rozpoznanie wstępne|Diagnoza|Ocena|Zalecenia|Rekomendacje)\s*[:/]\s*/m,
];

/** Patterns that end an assessment section (next section starts) */
const SECTION_END =
  /^(?:#{1,3}\s|\*\*[A-Z]|\n---\n|PLAN\s*:|RECOMMENDATIONS?\s*:|FOLLOW[\s-]?UP|REFERRALS?\s*:|ORDERS?\s*:|VITALS?\s*:|INSTRUCTIONS?\s*:|SUBJECTIVE|OBJECTIVE|Badanie\s*:)/m;

function extractAssessment(body: string): string | undefined {
  for (const pattern of ASSESSMENT_HEADERS) {
    const match = pattern.exec(body);
    if (!match) continue;

    const afterHeader = body.slice(match.index + match[0].length).trim();
    const endMatch = SECTION_END.exec(afterHeader);
    const section = endMatch ? afterHeader.slice(0, endMatch.index).trim() : afterHeader.trim();

    if (section.length > 10) {
      return section.slice(0, 4000);
    }
  }
  return undefined;
}

// ─── Specialty extraction from source_file ──────────────────────────────

/** Map Polish keywords in source_file field to specialty names */
const SOURCE_FILE_SPECIALTY_MAP: Array<[RegExp, string]> = [
  [/laryngolog/i, 'otolaryngology'],
  [/EMG|ENG|MEP/i, 'neurophysiology'],
  [/immunolog/i, 'immunology'],
  [/endokryno/i, 'endocrinology'],
  [/ortodont/i, 'orthodontics'],
  [/stomat/i, 'dentistry'],
  [/[Pp]olisom|[Bb]ruksizm/i, 'sleep_medicine'],
  [/psychiatr/i, 'psychiatry'],
  [/okulist/i, 'ophthalmology'],
  [/dermatolog/i, 'general_medicine'],
  [/leczenia b[oó]lu|Duomed|[Rr]wa kulszowa/i, 'pain_medicine'],
  [/Epikryza/i, 'general_medicine'],
  [/USG/i, 'radiology'],
  [/Biopsj/i, 'pathology'],
  [/Ortoped/i, 'orthopedics'],
  [/neuro(?:chirurg|surg)/i, 'neurosurgery'],
  [/neurolog/i, 'neurology'],
  [/kardiolog|cardiol/i, 'cardiology'],
  [/gastro/i, 'gastroenterology'],
  [/reumatol|rheumatol/i, 'rheumatology'],
  [/Scyntygraf|Scintigr/i, 'nuclear_medicine'],
  [/Szwajcari/i, 'general_medicine'],
  [/RTG|X-ray|X ray/i, 'radiology'],
  [/EEG|Biofeedback/i, 'neurophysiology'],
  [/[Bb]adania?\s*(?:MR|MRI|rezonans)/i, 'radiology'],
  [/Konsultacja\s+prof\./i, 'neurology'],
  [/Historia|Opis dolegliwo|Dzieci[ńn]stwo/i, 'general_medicine'],
  [/[Ww]yniki\s*bada[ńn]\s*krew/i, 'general_medicine'],
  [/[Pp]obyty?\s*w\s*szpital/i, 'general_medicine'],
  [/[Ll]ambli/i, 'general_medicine'],
  [/USG\s*nerek|USG\s*jamy/i, 'radiology'],
  [/biorenozans/i, 'general_medicine'],
];

function extractSpecialtyFromSourceFile(sourceFile: string): string | undefined {
  for (const [pattern, specialty] of SOURCE_FILE_SPECIALTY_MAP) {
    if (pattern.test(sourceFile)) return specialty;
  }
  return undefined;
}

// ─── Specialty extraction from body text (fallback) ─────────────────────

/** Body-text keyword patterns when source_file extraction yields nothing */
const BODY_SPECIALTY_PATTERNS: Array<[RegExp, string]> = [
  [/\bneurolog/i, 'neurology'],
  [/\bimmunolog/i, 'immunology'],
  [/\blaryngolog/i, 'otolaryngology'],
  [/\bokulist/i, 'ophthalmology'],
  [/\bortodont/i, 'orthodontics'],
  [/\breumatol|rheumatol/i, 'rheumatology'],
  [/\bkardiolog|cardiol/i, 'cardiology'],
  [/\bgastroenter/i, 'gastroenterology'],
  [/\bpsychiatr/i, 'psychiatry'],
  [/\bendokryno/i, 'endocrinology'],
  [/\bbol\s+glowy|headache|migraine|migrena/i, 'neurology'],
  [/\bEMG\b|\bENG\b|\bMEP\b/i, 'neurophysiology'],
];

function extractSpecialtyFromBody(body: string): string | undefined {
  // Only scan first 500 chars to focus on headers/chief complaint
  const snippet = body.slice(0, 500);
  for (const [pattern, specialty] of BODY_SPECIALTY_PATTERNS) {
    if (pattern.test(snippet)) return specialty;
  }
  return undefined;
}

// ─── Provider extraction from body text ─────────────────────────────────

/** Patterns that match physician names in medical documents (Polish, English, German) */
const PROVIDER_PATTERNS: RegExp[] = [
  // Polish structured patterns
  /Lekarz(?:\s+prowadzący)?:\s*(?:otolaryngolog\s+)?(.+)/i,
  /Konsultujący:\s*(.+)/i,
  /Podpis:\s*(.+)/i,
  // Polish academic titles
  /(?:prof\.\s+(?:dr\s+hab\.\s+)?(?:n\.\s*med\.\s*)?)([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ]\.?\s*)?[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)/i,
  /(?:dr\s+(?:n\.\s*med\.\s*)?|Dr\.?\s+(?:med\.\s*)?|Dr\.?\s+hab\.\s+(?:n\.\s*med\.\s*)?)([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż!]+)+)/,
  /[Ll]ek\.\s+(?:med\.\s+)?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)/,
  // Mayo / English patterns
  /(?:Attending|Seen by|Provider):\s*(.+)/i,
  // German / Swiss patterns
  /Facharzt[^:]*:\s*(.+)/i,
  /(?:Dr\.\s*med\.\s*)([A-Za-zÄÖÜäöü][a-zäöü]+(?:\s+[A-Za-zÄÖÜäöü][a-zäöü]+)+)/,
];

function extractProviderFromBody(body: string): string | undefined {
  for (const pattern of PROVIDER_PATTERNS) {
    const match = pattern.exec(body);
    if (match?.[1]) {
      const name = match[1].trim().replace(/[.,;:]+$/, '');
      if (name.length > 3 && name.length < 80) return name;
    }
  }
  return undefined;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Extract a string field from frontmatter by trying multiple keys, with fallback. */
function fmString(fm: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    if (typeof fm[key] === 'string') return fm[key] as string;
  }
  return fallback;
}

/** Set optional fields on a consultation via mutation (exactOptionalPropertyTypes). */
function applyOptionalFields(
  c: Consultation,
  fm: RecordFrontmatter,
  fields: {
    institution: string | undefined;
    findings: string | undefined;
    conclusions: string | undefined;
    source: string | undefined;
  },
): void {
  if (fields.institution) c.institution = fields.institution;
  if (fields.findings) c.findings = fields.findings;
  if (fields.conclusions) c.conclusions = fields.conclusions;
  if (fields.source) c.source = fields.source;
  if (fm.evidence_tier) c.evidenceTier = fm.evidence_tier;
  if (fm.validation_status) c.validationStatus = fm.validation_status;
  if (fm.source_credibility !== undefined) c.sourceCredibility = fm.source_credibility;
}

// ─── Main parser ────────────────────────────────────────────────────────

export function buildConsultationId(documentId: string): string {
  return `import-con-${documentId}`;
}

export function mapConsultation(frontmatter: RecordFrontmatter, body: string): Consultation {
  const fm = frontmatter as RecordFrontmatter & Record<string, unknown>;
  const conclusions = extractAssessment(body);

  // Provider: frontmatter physician → body text extraction → Unknown
  let provider = fmString(fm, ['physician', 'provider'], '');
  if (!provider || provider === 'Unknown') {
    provider = extractProviderFromBody(body) ?? 'Unknown';
  }

  // Specialty: frontmatter specialty → source_file → body keywords → category → Unknown
  // Then normalize to canonical form
  let rawSpecialty = fmString(fm, ['specialty'], '');
  if (!rawSpecialty || rawSpecialty === 'other' || rawSpecialty === 'Unknown') {
    const fromSourceFile =
      typeof fm.source_file === 'string'
        ? extractSpecialtyFromSourceFile(fm.source_file)
        : undefined;
    rawSpecialty =
      fromSourceFile ?? extractSpecialtyFromBody(body) ?? fmString(fm, ['category'], 'Unknown');
  }
  const specialty = normalizeSpecialty(rawSpecialty);

  const consultation: Consultation = {
    id: buildConsultationId(fm.document_id),
    patientId: fm.patient_id,
    provider,
    specialty,
    date: fm.date ?? 'unknown',
    conclusionsStatus: conclusions ? 'documented' : 'unknown',
  };

  applyOptionalFields(consultation, frontmatter, {
    institution: fm.facility ?? fm.institution,
    findings: body.trim() || undefined,
    conclusions,
    source: fm.source_file,
  });

  return consultation;
}
