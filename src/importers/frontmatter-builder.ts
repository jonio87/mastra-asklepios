/**
 * Frontmatter & SourceDocument Builder
 *
 * Builds both:
 * 1. A markdown string with YAML frontmatter that parseRecordFile() can consume
 * 2. A SourceDocument object for direct L0 storage
 *
 * Rather than round-tripping through YAML serialization, we construct the
 * canonical objects directly from triage + extraction results.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { EvidenceTier, ValidationStatus } from '../schemas/clinical-record.js';
import type { SourceDocument } from '../schemas/source-document.js';
import type { TriageResult } from './document-triage.js';
import type { AsklepiosType } from './schemas.js';
import { documentTypeMapping } from './schemas.js';
import type { ExtractionResult } from './vision-extractor.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface FileInfo {
  originalFilename: string;
  fileHash: string; // SHA-256 hex
  fileSizeBytes: number;
  pageCount?: number;
  mimeType?: string;
}

const PIPELINE_VERSION = '3.0.0';

// ─── Evidence tier derivation ───────────────────────────────────────────

const CATEGORY_EVIDENCE_TIER: Record<string, EvidenceTier> = {
  consultation: 'T1-specialist',
  procedure: 'T1-official',
  external: 'T1-official',
  imaging_report: 'T1-official',
  lab_result: 'T1-official',
  genetic: 'T1-official',
  narrative: 'T2-patient-reported',
  other: 'T1-official',
};

const CATEGORY_FHIR_RESOURCE: Record<string, SourceDocument['fhirResourceType']> = {
  lab_result: 'DiagnosticReport',
  imaging_report: 'DiagnosticReport',
  genetic: 'DiagnosticReport',
  procedure: 'Procedure',
  consultation: 'DocumentReference',
  external: 'DocumentReference',
  narrative: 'DocumentReference',
};

const CATEGORY_DIAGNOSTIC_SECTION: Record<string, SourceDocument['diagnosticServiceSection']> = {
  lab_result: 'LAB',
  imaging_report: 'RAD',
  genetic: 'GE',
  consultation: 'NRS',
};

// ─── Build SourceDocument for L0 storage ────────────────────────────────

export function buildSourceDocument(
  triage: TriageResult,
  extraction: ExtractionResult | undefined,
  fileInfo: FileInfo,
  patientId: string,
  extractedMarkdownPath: string,
): SourceDocument {
  const confidence = extraction?.confidence ?? 0.9;
  const validationStatus: ValidationStatus = confidence >= 0.9 ? 'confirmed' : 'unvalidated';
  const evidenceTier = CATEGORY_EVIDENCE_TIER[triage.category] ?? 'T1-official';

  const doc: SourceDocument = {
    id: `src-${fileInfo.fileHash.slice(0, 12)}`,
    patientId,
    originalFilename: fileInfo.originalFilename,
    originalFileHash: `sha256:${fileInfo.fileHash}`,
    originalFileSizeBytes: fileInfo.fileSizeBytes,
    extractionMethod: extraction ? 'claude_read' : 'manual',
    extractionConfidence: confidence,
    extractionDate: new Date().toISOString(),
    extractionTool: extraction?.model
      ? `${extraction.model}-${extraction.extractionMethod ?? 'vision'}`
      : 'direct-read',
    extractedMarkdownPath,
    category: triage.category,
    evidenceTier,
    validationStatus,
    sourceCredibility: Math.round(confidence * 100),
  };

  // Optional fields — set via mutation for exactOptionalPropertyTypes
  if (fileInfo.pageCount) doc.originalPageCount = fileInfo.pageCount;
  if (fileInfo.mimeType) doc.mimeType = fileInfo.mimeType;
  doc.pipelineVersion = PIPELINE_VERSION;
  doc.preProcessing = 'none';
  doc.postProcessing = 'none';
  if (triage.subcategory) doc.subcategory = triage.subcategory;
  if (triage.documentDate) doc.date = triage.documentDate;
  if (triage.facility) doc.facility = triage.facility;
  if (triage.physician) doc.physician = triage.physician;
  doc.language = triage.language;
  doc.tags = [triage.category];

  const fhirType = CATEGORY_FHIR_RESOURCE[triage.category];
  if (fhirType) doc.fhirResourceType = fhirType;

  const diagSection = CATEGORY_DIAGNOSTIC_SECTION[triage.category];
  if (diagSection) doc.diagnosticServiceSection = diagSection;

  return doc;
}

// ─── Build markdown file with YAML frontmatter ─────────────────────────

export function buildMarkdownFile(
  triage: TriageResult,
  extraction: ExtractionResult | undefined,
  fileInfo: FileInfo,
  patientId: string,
  body: string,
): string {
  const confidence = extraction?.confidence ?? 0.9;
  const evidenceTier = CATEGORY_EVIDENCE_TIER[triage.category] ?? 'T1-official';
  const validationStatus: ValidationStatus = confidence >= 0.9 ? 'confirmed' : 'unvalidated';
  const contentHash = computeContentHash(body);
  const asklepiosType: AsklepiosType =
    documentTypeMapping[triage.category as keyof typeof documentTypeMapping] ?? 'other';

  const fields: [string, unknown][] = [
    ['document_id', triage.suggestedDocumentId],
    ['document_type', triage.category],
    ['patient_id', patientId],
    ['asklepios_type', asklepiosType],
    ['evidence_tier', evidenceTier],
    ['validation_status', validationStatus],
    ['source_credibility', Math.round(confidence * 100)],
    ['date', triage.documentDate],
    ['category', triage.subcategory],
    ['source_file', fileInfo.originalFilename],
    ['language', triage.language],
    ['facility', triage.facility],
    ['physician', triage.physician],
    ['tags', [triage.category]],
    ['extraction_model', extraction?.model ?? 'direct-read'],
    ['extraction_confidence', Math.round(confidence * 100) / 100],
    ['extraction_date', new Date().toISOString()],
    [
      'extraction_tool',
      extraction?.model
        ? `${extraction.model}-${extraction.extractionMethod ?? 'vision'}`
        : 'direct-read',
    ],
    ['extraction_pipeline_version', PIPELINE_VERSION],
    ['source_file_hash', `sha256:${fileInfo.fileHash}`],
    ['source_file_size_bytes', fileInfo.fileSizeBytes],
    ['original_page_count', fileInfo.pageCount],
    ['content_hash', `sha256:${contentHash}`],
  ];

  return `${serializeYaml(fields)}\n${body}`;
}

// ─── YAML serialization ────────────────────────────────────────────────

function serializeYaml(fields: [string, unknown][]): string {
  const lines: string[] = ['---'];

  for (const [key, value] of fields) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`- ${item}`);
      }
    } else if (typeof value === 'boolean') {
      lines.push(`${key}: ${value ? 'true' : 'false'}`);
    } else if (typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string' && needsQuoting(value)) {
      lines.push(`${key}: '${value.replace(/'/g, "''")}'`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

function needsQuoting(value: string): boolean {
  if (value.includes(':') || value.includes("'")) return true;
  if (/^(true|false|yes|no|on|off)$/i.test(value)) return true;
  if (/^[{[#&*!|>%@`]/.test(value)) return true;
  return false;
}

// ─── Hash utilities ─────────────────────────────────────────────────────

export function computeContentHash(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export async function computeFileHash(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}
