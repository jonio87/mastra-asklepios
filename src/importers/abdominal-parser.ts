/**
 * Parse abdominal report markdown files from medical-records extraction into
 * AbdominalReport objects suitable for import to clinical_abdominal_reports table.
 *
 * Maps YAML frontmatter → AbdominalReport schema:
 *   category/source_file → procedureType (gastroscopy, colonoscopy, pH-metry, SIBO, ultrasound, etc.)
 *   date → date
 *   facility → facility
 *   physician → physician (from frontmatter or body text)
 *   source_file → source
 *   body → findings (full text, no truncation)
 *   Assessment section → conclusions
 */

import type { AbdominalReport } from '../schemas/clinical-record.js';
import type { RecordFrontmatter } from './schemas.js';

// ─── Procedure type extraction ──────────────────────────────────────────

const PROCEDURE_TYPE_MAP: Array<[RegExp, string]> = [
  [/[Gg]astr?oskop|[Gg]astroscop/i, 'gastroscopy'],
  [/[Kk]olonoskop|[Cc]olonoscop/i, 'colonoscopy'],
  [/pH[- ]?metr/i, 'pH-metry'],
  [/SIBO|sibo/i, 'SIBO'],
  [/[Hh]elicobact|[Hh]elicobakt/i, 'helicobacter_test'],
  [/USG|[Uu]ltrasound|ultrasonogra/i, 'ultrasound'],
  [/transrekt|transrectal/i, 'transrectal_ultrasound'],
  [/[Kk]oagulolog|[Cc]oagul/i, 'coagulation_panel'],
  [/[Hh]istoria zdrowia|[Hh]ealth history/i, 'health_history'],
  [/[Kk]onsultacja gastro|[Gg]astroenterol.*consult/i, 'gastroenterology_consultation'],
  [/[Kk]arta infor.*rozpoznanie|diagnosis.*card/i, 'diagnosis_card'],
  [/[Kk]arta infor/i, 'information_card'],
  [/[Ll]eki|[Mm]edication/i, 'medication_list'],
];

function extractProcedureType(sourceFile: string, category: string): string {
  // Try source_file first (most specific)
  for (const [pattern, procedureType] of PROCEDURE_TYPE_MAP) {
    if (pattern.test(sourceFile)) return procedureType;
  }
  // Fall back to category
  for (const [pattern, procedureType] of PROCEDURE_TYPE_MAP) {
    if (pattern.test(category)) return procedureType;
  }
  return 'other';
}

// ─── Conclusions extraction ─────────────────────────────────────────────

const CONCLUSION_HEADERS = [
  /^#{1,3}\s*(?:Conclusions?|Wnioski|Rozpoznanie|Assessment|Impression|Podsumowanie)/im,
  /^(?:CONCLUSIONS?|IMPRESSION|WNIOSKI|ROZPOZNANIE)\s*[:/]?\s*$/m,
  /^(?:Rozpoznanie|Wnioski|Wynik)\s*:/m,
];

const CONCLUSION_END = /^(?:#{1,3}\s|\*\*[A-Z]|\n---\n|Badanie\s*:|Zalecenia\s*:|RECOMMENDATIONS)/m;

function extractConclusions(body: string): string | undefined {
  for (const pattern of CONCLUSION_HEADERS) {
    const match = pattern.exec(body);
    if (!match) continue;
    const afterHeader = body.slice(match.index + match[0].length).trim();
    const endMatch = CONCLUSION_END.exec(afterHeader);
    const section = endMatch ? afterHeader.slice(0, endMatch.index).trim() : afterHeader.trim();
    if (section.length > 5) return section.slice(0, 4000);
  }
  return undefined;
}

// ─── Physician extraction from body ─────────────────────────────────────

function extractPhysicianFromBody(body: string): string | undefined {
  const patterns = [
    /(?:Lekarz|Physician|Wykonał|Performed by)[:\s]+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ]\.?\s*)?[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)/,
    /(?:dr|Dr\.?)\s+(?:n\.\s*med\.\s*|med\.\s*)?([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:[- ][A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(body);
    if (match?.[1]) {
      const name = match[1].trim().replace(/[.,;:]+$/, '');
      if (name.length > 3 && name.length < 80) return name;
    }
  }
  return undefined;
}

// ─── Main parser ────────────────────────────────────────────────────────

export function buildAbdominalId(documentId: string): string {
  return `import-abd-${documentId}`;
}

export function mapAbdominalReport(frontmatter: RecordFrontmatter, body: string): AbdominalReport {
  const fm = frontmatter as RecordFrontmatter & Record<string, unknown>;

  const sourceFile = typeof fm.source_file === 'string' ? fm.source_file : '';
  const category = typeof fm.category === 'string' ? fm.category : '';

  const report: AbdominalReport = {
    id: buildAbdominalId(fm.document_id),
    patientId: fm.patient_id,
    procedureType: extractProcedureType(sourceFile, category),
    date: fm.date ?? 'unknown',
  };

  // Apply optional fields via mutation (exactOptionalPropertyTypes)
  const facility = fm.facility ?? fm.institution;
  if (typeof facility === 'string') report.facility = facility;

  let physician = typeof fm['physician'] === 'string' ? fm['physician'] : undefined;
  if (!physician) physician = extractPhysicianFromBody(body);
  if (physician) report.physician = physician;

  if (typeof fm.source_file === 'string') report.source = fm.source_file;

  // Findings: full body text, no truncation
  if (body.trim()) report.findings = body.trim();

  // Conclusions: extract from structured sections
  const conclusions = extractConclusions(body);
  if (conclusions) report.conclusions = conclusions;

  if (fm.evidence_tier) report.evidenceTier = fm.evidence_tier;
  if (fm.validation_status) report.validationStatus = fm.validation_status;
  if (fm.source_credibility !== undefined) report.sourceCredibility = fm.source_credibility;

  return report;
}
