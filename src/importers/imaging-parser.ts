/**
 * Parse imaging report markdown files from medical-records extraction into
 * ImagingReport objects suitable for import to clinical_imaging_reports table.
 *
 * Maps YAML frontmatter → ImagingReport schema:
 *   modality → modality (normalized: "MRI (MR)" → "MRI", "CT (TK)" → "CT")
 *   body_region → bodyRegion (normalized: "cervical spine (kręgosłup szyjny)" → "cervical_spine")
 *   date → date
 *   facility → facility
 *   physician → physician
 *   source_file → source
 *   body sections → technique, findings, impression, comparison
 */

import type { ImagingReport } from '../schemas/clinical-record.js';
import type { RecordFrontmatter } from './schemas.js';

// ─── Modality normalization ─────────────────────────────────────────────

const MODALITY_MAP: Array<[RegExp, string]> = [
  [/\bMRI\b|\bMR\b/i, 'MRI'],
  [/\bCT\b|\bTK\b/i, 'CT'],
  [/\bRTG\b|\bX[- ]?ray\b/i, 'X-ray'],
  [/\bscynty|scintig/i, 'scintigraphy'],
  [/\bUSG\b|\bultrasound\b|ultrasonogra/i, 'ultrasound'],
];

function normalizeModality(raw: string): string {
  for (const [pattern, modality] of MODALITY_MAP) {
    if (pattern.test(raw)) return modality;
  }
  return raw;
}

// ─── Body region normalization ──────────────────────────────────────────

function normalizeBodyRegion(raw: string): string {
  const lower = raw.toLowerCase();
  if (/cervical|szyjn|c-spine/i.test(lower)) return 'cervical_spine';
  if (/thoracic|piersiow|t-spine/i.test(lower)) return 'thoracic_spine';
  if (/lumbar|lędźwiow|l-spine/i.test(lower)) return 'lumbar_spine';
  if (/full.?spine|cały.*kręgosłup|entire.*spine/i.test(lower)) return 'full_spine';
  if (/head|głow|mózg|brain/i.test(lower)) return 'head';
  if (/shoulder|bark/i.test(lower)) return 'shoulder';
  if (/abdomen|brzusz|jamy/i.test(lower)) return 'abdomen';
  if (/chest|płuc|klatk/i.test(lower)) return 'chest';
  if (/sinus|zatok/i.test(lower)) return 'paranasal_sinuses';
  if (/craniovert|CVJ|szczytowo/i.test(lower)) return 'craniovertebral_junction';
  if (/dental|stomat/i.test(lower)) return 'dental';
  if (/skull|czaszk/i.test(lower)) return 'skull';
  return raw.replace(/\s+/g, '_').toLowerCase();
}

// ─── Body region inference from source_file ─────────────────────────────

function inferBodyRegionFromSourceFile(sf: string): string | undefined {
  if (/szyjn|cervical|odcinek szyjn|c-spine/i.test(sf)) return 'cervical_spine';
  if (/głow|head|mózg|brain|angio.*mri.*głow/i.test(sf)) return 'head';
  if (/bark|shoulder/i.test(sf)) return 'shoulder';
  if (/piersiow|thoracic/i.test(sf)) return 'thoracic_spine';
  if (/lędźwiow|lumbar/i.test(sf)) return 'lumbar_spine';
  if (/cały.*kręgosłup|full.*spine/i.test(sf)) return 'full_spine';
  if (/brzusz|abdomen/i.test(sf)) return 'abdomen';
  if (/płuc|chest/i.test(sf)) return 'chest';
  if (/zatok|sinus/i.test(sf)) return 'paranasal_sinuses';
  if (/czaszk|skull/i.test(sf)) return 'skull';
  return undefined;
}

// ─── Section extraction ─────────────────────────────────────────────────

function extractSection(body: string, headers: RegExp): string | undefined {
  const match = headers.exec(body);
  if (!match) return undefined;

  const afterHeader = body.slice(match.index + match[0].length).trim();
  // End at next markdown header or major section divider
  const endMatch = /^#{1,3}\s/m.exec(afterHeader);
  const section = endMatch ? afterHeader.slice(0, endMatch.index).trim() : afterHeader.trim();
  return section.length > 5 ? section : undefined;
}

function extractTechnique(body: string): string | undefined {
  return extractSection(body, /^#{1,3}\s*(?:Technique|Technika|Protocol|Protokół)/im);
}

function extractFindings(body: string): string | undefined {
  return extractSection(body, /^#{1,3}\s*(?:Findings|Opis|Wyniki|Opis badania)/im);
}

function extractImpression(body: string): string | undefined {
  // Try multiple patterns: markdown headers and plain-text headers
  const markdownMatch = extractSection(
    body,
    /^#{1,3}\s*(?:Impression|Wnioski|Podsumowanie|Conclusion)/im,
  );
  if (markdownMatch) return markdownMatch;

  // Plain-text IMPRESSION: pattern (Mayo format)
  const plainMatch = /^(?:IMPRESSION|Impression)\s*[:/]\s*$/m.exec(body);
  if (plainMatch) {
    const afterHeader = body.slice(plainMatch.index + plainMatch[0].length).trim();
    const endMatch = /^(?:#{1,3}\s|[A-Z]{3,}\s*[:/])/m.exec(afterHeader);
    const section = endMatch ? afterHeader.slice(0, endMatch.index).trim() : afterHeader.trim();
    if (section.length > 5) return section;
  }

  return undefined;
}

function extractComparison(body: string): string | undefined {
  return extractSection(body, /^#{1,3}\s*(?:Comparison|Porównanie|Prior Studies)/im);
}

// ─── Main parser ────────────────────────────────────────────────────────

export function buildImagingId(documentId: string): string {
  return `import-img-${documentId}`;
}

/** Resolve body_region from frontmatter field or source_file fallback. */
function resolveBodyRegion(fm: RecordFrontmatter & Record<string, unknown>): string {
  const raw = typeof fm['body_region'] === 'string' ? fm['body_region'] : '';
  if (raw && raw !== 'unknown') return normalizeBodyRegion(raw);
  const sf = typeof fm.source_file === 'string' ? fm.source_file : '';
  return normalizeBodyRegion(inferBodyRegionFromSourceFile(sf) ?? 'unknown');
}

/** Apply optional frontmatter and body-section fields to the report. */
function applyImagingOptionals(
  report: ImagingReport,
  fm: RecordFrontmatter & Record<string, unknown>,
  body: string,
): void {
  const facility = fm.facility ?? fm.institution;
  if (typeof facility === 'string') report.facility = facility;
  if (typeof fm['physician'] === 'string') report.physician = fm['physician'];
  if (typeof fm.source_file === 'string') report.source = fm.source_file;

  const technique = extractTechnique(body);
  if (technique) report.technique = technique;
  const findings = extractFindings(body) ?? body.trim();
  if (findings) report.findings = findings;
  const impression = extractImpression(body);
  if (impression) report.impression = impression;
  const comparison = extractComparison(body);
  if (comparison) report.comparison = comparison;

  if (fm.evidence_tier) report.evidenceTier = fm.evidence_tier;
  if (fm.validation_status) report.validationStatus = fm.validation_status;
  if (fm.source_credibility !== undefined) report.sourceCredibility = fm.source_credibility;
}

export function mapImagingReport(frontmatter: RecordFrontmatter, body: string): ImagingReport {
  const fm = frontmatter as RecordFrontmatter & Record<string, unknown>;
  const rawModality = typeof fm['modality'] === 'string' ? fm['modality'] : 'unknown';

  const report: ImagingReport = {
    id: buildImagingId(fm.document_id),
    patientId: fm.patient_id,
    modality: normalizeModality(rawModality),
    bodyRegion: resolveBodyRegion(fm),
    date: fm.date ?? 'unknown',
  };

  applyImagingOptionals(report, fm, body);

  return report;
}
