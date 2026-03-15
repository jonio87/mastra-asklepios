/**
 * Unified Document Ingestion Pipeline — L0 + L1
 *
 * Accepts raw files (PDFs, images, markdown), classifies them via LLM triage,
 * extracts content via Claude Vision, stores originals, creates L0 source
 * documents, and runs L1 structured record import.
 *
 * Pipeline:
 *   Raw File → LLM Triage → Vision Extraction → L0 Source Document → L1 Structured Records
 */

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { LabResult, PatientReport } from '../schemas/clinical-record.js';
import type { SourceDocument } from '../schemas/source-document.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { getProvenanceStore } from '../storage/provenance-store.js';
import { translateCode } from '../terminology/crosswalk-service.js';
import { initTerminologyProviders } from '../terminology/init.js';
import { SYSTEM_ICD10, SYSTEM_SNOMED } from '../terminology/terminology-service.js';
import { logger } from '../utils/logger.js';
import { mapConsultation } from './consultation-parser.js';
import { applyOverrides, type TriageResult, triageDocument } from './document-triage.js';
import { extractClinicalFindings } from './findings-extractor.js';
import {
  buildMarkdownFile,
  buildSourceDocument,
  computeFileHash,
  type FileInfo,
} from './frontmatter-builder.js';
import { mapImagingReport } from './imaging-parser.js';
import { validateLabResult } from './lab-value-validator.js';
import { initAxisSearch } from './loinc-axis-search.js';
import { initLoincEmbeddingSearch } from './loinc-embedding-search.js';
import { initLoincLookup } from './loinc-lookup.js';
import { validateLoincUnit } from './loinc-unit-validator.js';
import {
  extractAdherenceMentions,
  extractMedicationChanges,
  extractMedications,
  mentionToMedication,
} from './medication-extractor.js';
import { getLoincCodeAsync, getValueSnomedCode, normalizeLabValue } from './normalizer.js';
import { parseRecordFile } from './parser.js';
import { mapProcedureReport } from './procedure-parser.js';
import { getRxnormCode } from './rxnorm-normalizer.js';
import type { RecordFrontmatter, StructuredLabValue } from './schemas.js';
import { getSnomedSpecialtyCode, normalizeSpecialty } from './specialty-normalizer.js';
import {
  validateConsultationRecord,
  validateImagingRecord,
  validateLabRecord,
  validateProcedureRecord,
} from './validation-layer.js';
import {
  type ExtractionResult,
  extractDocument,
  PasswordProtectedPdfError,
} from './vision-extractor.js';

// ─── Types ──────────────────────────────────────────────────────────────

export interface IngestOptions {
  filePath: string;
  patientId: string;
  // User overrides (take priority over LLM triage)
  category?: TriageResult['category'];
  subcategory?: string;
  facility?: string;
  physician?: string;
  date?: string;
  language?: 'pl' | 'en' | 'de' | 'fr';
  // Behavior
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
}

export interface IngestResult {
  documentId: string;
  category: string;
  subcategory: string;
  triage: TriageResult;
  originalPath: string;
  extractedPath?: string;
  sourceDocumentId: string;
  l1Results: L1ImportSummary;
  warnings: string[];
  elapsed: number;
}

interface L1ImportSummary {
  labValues: number;
  consultations: number;
  imagingReports: number;
  procedures: number;
  narratives: number;
  medications: number;
  medicationChanges: number;
  adherenceObservations: number;
}

export interface IngestBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: IngestResult[];
  errors: Array<{ filePath: string; error: string }>;
  elapsed: number;
}

// ─── MIME type detection ────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function detectMimeType(filePath: string): string {
  return EXT_TO_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function needsExtraction(mimeType: string): boolean {
  return (
    mimeType === 'application/pdf' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType.startsWith('image/')
  );
}

// ─── Data directories ───────────────────────────────────────────────────

const DATA_ROOT = join(process.cwd(), 'data');
const ORIGINALS_DIR = join(DATA_ROOT, 'originals');
const EXTRACTED_DIR = join(DATA_ROOT, 'extracted');

// ─── Single document ingestion ──────────────────────────────────────────

export async function ingestDocument(opts: IngestOptions): Promise<IngestResult> {
  const startTime = Date.now();
  const warnings: string[] = [];

  // 0. Ensure reference data + terminology service loaded (no-op after first call)
  initTerminologyProviders();
  await Promise.all([initLoincLookup(), initLoincEmbeddingSearch(), initAxisSearch()]);

  // 1. File prep
  const mimeType = detectMimeType(opts.filePath);
  const fileStat = await stat(opts.filePath);
  const fileHash = await computeFileHash(opts.filePath);
  const fileName = basename(opts.filePath);

  const fileInfo: FileInfo = {
    originalFilename: fileName,
    fileHash,
    fileSizeBytes: fileStat.size,
    mimeType,
  };

  if (opts.verbose) {
    logger.info(`Ingesting ${fileName} (${mimeType}, ${fileStat.size} bytes)`);
  }

  // 2. Duplicate check (by file hash)
  const store = getClinicalStore();
  const existingDocs = await store.querySourceDocuments({ patientId: opts.patientId });
  const duplicates = existingDocs.filter((d) => d.originalFileHash === `sha256:${fileHash}`);
  if (duplicates.length > 0 && !opts.force) {
    const dup = duplicates[0]!;
    logger.info(`Duplicate detected: ${fileName} → ${dup.id}`);
    return {
      documentId: dup.id.replace(/^src-/, ''),
      category: dup.category,
      subcategory: dup.subcategory ?? '',
      triage: {
        category: dup.category,
        subcategory: dup.subcategory ?? '',
        language: (dup.language as 'pl' | 'en' | 'de' | 'fr') ?? 'pl',
        confidence: dup.extractionConfidence,
        intent: 'Previously imported document',
        suggestedDocumentId: dup.id.replace(/^src-/, ''),
        warnings: ['Duplicate — already imported'],
        asklepiosType: 'other',
      },
      originalPath: opts.filePath,
      sourceDocumentId: dup.id,
      l1Results: emptyL1Summary(),
      warnings: ['Duplicate — already imported, skipped'],
      elapsed: Date.now() - startTime,
    };
  }
  if (duplicates.length > 0 && opts.force) {
    let totalDeleted = 0;
    for (const dup of duplicates) {
      const deleted = await store.deleteRecordsBySourceDocId(dup.id);
      totalDeleted += deleted;
      logger.info(`Force re-import: deleted ${deleted} records for old source doc ${dup.id}`);

      // Delete old extracted markdown file to prevent orphaned duplicates
      if (dup.extractedMarkdownPath) {
        try {
          await unlink(dup.extractedMarkdownPath);
          logger.info(`Force re-import: deleted old markdown ${dup.extractedMarkdownPath}`);
        } catch {
          // File may already be gone — that's fine
        }
      }
    }
    logger.info(
      `Force re-import: ${fileName} — deleted ${totalDeleted} total old records across ${duplicates.length} duplicate(s)`,
    );
  }

  // 2b. Password-protected PDF check (early exit — avoids wasting LLM triage calls)
  if (mimeType === 'application/pdf') {
    try {
      const { execSync } = await import('node:child_process');
      execSync(`qpdf --check "${opts.filePath}"`, { stdio: 'pipe', timeout: 5000 });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? ((err as Error & { stderr?: Buffer }).stderr?.toString() ?? err.message)
          : '';
      if (msg.includes('invalid password')) {
        logger.warn(`Password-protected PDF detected: ${fileName} — skipping`);
        throw new PasswordProtectedPdfError(opts.filePath);
      }
      // qpdf not installed or other error — continue with normal pipeline
    }
  }

  // 3. LLM Triage
  let triage = await triageDocument(opts.filePath, mimeType);

  // 4. Apply user overrides
  const overrides: Partial<TriageResult> = {};
  if (opts.category) overrides.category = opts.category;
  if (opts.subcategory) overrides.subcategory = opts.subcategory;
  if (opts.facility) overrides.facility = opts.facility;
  if (opts.physician) overrides.physician = opts.physician;
  if (opts.date) overrides.documentDate = opts.date;
  if (opts.language) overrides.language = opts.language;
  if (Object.keys(overrides).length > 0) {
    triage = applyOverrides(triage, overrides);
  }

  // 5. Log triage
  if (opts.verbose) {
    logger.info(
      `Triage: ${triage.category}/${triage.subcategory} (confidence: ${triage.confidence.toFixed(2)}) — ${triage.intent}`,
    );
    for (const w of triage.warnings) {
      logger.warn(`  ⚠ ${w}`);
    }
  }
  warnings.push(...triage.warnings);

  if (opts.dryRun) {
    return {
      documentId: triage.suggestedDocumentId,
      category: triage.category,
      subcategory: triage.subcategory,
      triage,
      originalPath: opts.filePath,
      sourceDocumentId: `src-${triage.suggestedDocumentId}`,
      l1Results: emptyL1Summary(),
      warnings,
      elapsed: Date.now() - startTime,
    };
  }

  // 6. Store original file
  const categoryDir = join(ORIGINALS_DIR, triage.category);
  await mkdir(categoryDir, { recursive: true });
  const originalDest = join(categoryDir, fileName);
  await copyFile(opts.filePath, originalDest);

  // 7. Extract content (or read markdown directly)
  let extractedText: string;
  let extraction: ExtractionResult | undefined;

  if (needsExtraction(mimeType)) {
    extraction = await extractDocument(
      opts.filePath,
      triage.category,
      mimeType,
      triage.subcategory,
    );
    extractedText = extraction.text;
    if (opts.verbose) {
      logger.info(
        `Extraction: ${extractedText.length} chars (confidence: ${extraction.confidence.toFixed(2)}, tokens: ${extraction.inputTokens}/${extraction.outputTokens})`,
      );
    }
  } else {
    // Pre-extracted markdown or text — read directly
    const rawContent = await readFile(opts.filePath, 'utf-8');
    // If it already has frontmatter, strip it — we'll build our own
    extractedText = rawContent.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  }

  // 8. Build and write extracted markdown
  const extractedDir = join(EXTRACTED_DIR, triage.category);
  await mkdir(extractedDir, { recursive: true });
  const extractedPath = join(extractedDir, `${triage.suggestedDocumentId}.md`);

  const markdownContent = buildMarkdownFile(
    triage,
    extraction,
    fileInfo,
    opts.patientId,
    extractedText,
  );
  await writeFile(extractedPath, markdownContent, 'utf-8');

  // 9. L0 — Source Document
  const sourceDoc = buildSourceDocument(
    triage,
    extraction,
    fileInfo,
    opts.patientId,
    extractedPath,
  );
  // Compute content hash (SHA-256 of extracted markdown)
  sourceDoc.contentHash = `sha256:${createHash('sha256').update(markdownContent).digest('hex')}`;
  await store.addSourceDocument(sourceDoc);

  // 10. L0 — Provenance
  await recordIngestProvenance(sourceDoc, opts.patientId);

  // 11. L1 — Structured Records
  const l1Results = await importL1(extractedPath, triage, sourceDoc, opts);

  // 12. L1 — Medications (from consultations, procedures, externals)
  const medResults = await importMedications(extractedText, triage, sourceDoc, opts.patientId);
  l1Results.medications = medResults.medications;
  l1Results.medicationChanges = medResults.changes;
  l1Results.adherenceObservations = medResults.adherence;

  const elapsed = Date.now() - startTime;

  if (opts.verbose) {
    logger.info(`Done: ${triage.suggestedDocumentId} in ${(elapsed / 1000).toFixed(1)}s`);
  }

  return {
    documentId: triage.suggestedDocumentId,
    category: triage.category,
    subcategory: triage.subcategory,
    triage,
    originalPath: originalDest,
    extractedPath,
    sourceDocumentId: sourceDoc.id,
    l1Results,
    warnings,
    elapsed,
  };
}

// ─── Batch ingestion ────────────────────────────────────────────────────

export async function ingestBatch(files: IngestOptions[]): Promise<IngestBatchResult> {
  const startTime = Date.now();
  const results: IngestResult[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];
  let skipped = 0;

  for (let i = 0; i < files.length; i++) {
    const opts = files[i]!;
    logger.info(`[${i + 1}/${files.length}] ${basename(opts.filePath)}`);

    try {
      const result = await ingestDocument(opts);
      results.push(result);
      if (result.warnings.some((w) => w.startsWith('Duplicate'))) {
        skipped++;
      }
    } catch (err) {
      if (err instanceof PasswordProtectedPdfError) {
        skipped++;
        const msg =
          'Password-protected PDF — skipping (provide decryption password or pre-decrypt with qpdf)';
        logger.warn(`Skipped: ${opts.filePath} — ${msg}`);
        errors.push({ filePath: opts.filePath, error: msg });
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`Failed: ${opts.filePath} — ${message}`);
        errors.push({ filePath: opts.filePath, error: message });
      }
    }
  }

  const passwordSkipped = errors.filter((e) => e.error.startsWith('Password-protected PDF')).length;
  return {
    total: files.length,
    succeeded: results.length - skipped,
    failed: errors.length - passwordSkipped,
    skipped: skipped,
    results,
    errors,
    elapsed: Date.now() - startTime,
  };
}

// ─── L0 Provenance ─────────────────────────────────────────────────────

async function recordIngestProvenance(doc: SourceDocument, patientId: string): Promise<void> {
  const provStore = getProvenanceStore();
  const now = new Date().toISOString();
  const activityId = `ingest-${doc.id}-${Date.now()}`;

  await provStore.recordActivity({
    id: activityId,
    type: 'import',
    startedAt: now,
    endedAt: now,
    metadata: JSON.stringify({
      phase: 'ingest-pipeline',
      documentId: doc.id,
      category: doc.category,
    }),
    createdAt: now,
  });

  await provStore.recordAgent({
    id: 'pipeline:ingest-pipeline',
    type: 'pipeline',
    name: 'ingest-pipeline.ts',
    createdAt: now,
  });

  await provStore.recordRelation({
    id: `rel-${activityId}-agent`,
    type: 'wasAttributedTo',
    subjectId: activityId,
    objectId: 'pipeline:ingest-pipeline',
    createdAt: now,
  });

  await provStore.recordEntity({
    id: doc.id,
    type: 'source-doc',
    layer: 0,
    patientId,
    metadata: JSON.stringify({
      documentType: doc.category,
      date: doc.date,
      facility: doc.facility,
    }),
    createdAt: now,
  });

  await provStore.recordRelation({
    id: `rel-${doc.id}-${activityId}`,
    type: 'wasGeneratedBy',
    subjectId: doc.id,
    objectId: activityId,
    createdAt: now,
  });

  await provStore.emitChangeSignal({
    id: `signal-ingest-${doc.id}-${Date.now()}`,
    sourceEntityId: doc.id,
    affectedLayers: [1, 2, 3, 4, 5],
    affectedEntityIds: [doc.id],
    changeType: 'new',
    summary: `New ${doc.category} imported: ${doc.id}`,
    priority: 'medium',
    status: 'pending',
    patientId,
    createdAt: now,
  });
}

// ─── L1 Import ──────────────────────────────────────────────────────────

async function importL1(
  extractedPath: string,
  triage: TriageResult,
  sourceDoc: SourceDocument,
  opts: IngestOptions,
): Promise<L1ImportSummary> {
  const summary = emptyL1Summary();

  // Parse the extracted markdown file (validates frontmatter + extracts structured values)
  let parsed;
  try {
    parsed = await parseRecordFile(extractedPath);
  } catch (err) {
    // L1 parsing failure is non-fatal — L0 source document is already created
    logger.warn(
      `L1 parsing failed for ${extractedPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return summary;
  }

  const store = getClinicalStore();
  const fm = parsed.frontmatter;
  const body = parsed.body;

  // Inject the deterministic (hash-based) source doc ID so all L1 handlers
  // produce stable IDs and correct sourceDocumentId references
  const sourceDocId = sourceDoc.id;
  const hashSlug = sourceDocId.replace(/^src-/, ''); // e.g. "a1b2c3d4e5f6"

  try {
    switch (triage.category) {
      case 'lab_result':
        summary.labValues = await importLabResults(parsed, store, hashSlug, sourceDocId);
        break;

      case 'consultation':
        summary.consultations = await importConsultation(
          fm,
          body,
          store,
          opts.verbose,
          hashSlug,
          sourceDocId,
        );
        break;

      case 'imaging_report':
        summary.imagingReports = await importImagingReport(
          fm,
          body,
          store,
          opts.verbose,
          hashSlug,
          sourceDocId,
        );
        break;

      case 'procedure':
        summary.procedures = await importProcedure(
          fm,
          body,
          store,
          opts.verbose,
          hashSlug,
          sourceDocId,
        );
        break;

      case 'narrative':
        summary.narratives = await importNarrative(fm, body, store, hashSlug, sourceDocId);
        // Composite documents may contain embedded lab values in YAML blocks
        if (parsed.structuredValues?.length) {
          const labCount = await importLabResults(parsed, store, hashSlug, sourceDocId);
          summary.labValues += labCount;
          if (labCount > 0) {
            logger.info(
              `Composite narrative: extracted ${labCount} lab values alongside narrative`,
            );
          }
        }
        break;

      case 'external':
        summary.consultations = await importExternal(fm, body, store, hashSlug, sourceDocId);
        break;

      default:
        if (opts.verbose) {
          logger.info(`No L1 handler for category: ${triage.category}`);
        }
    }
  } catch (err) {
    // L1 failure is non-fatal
    logger.warn(
      `L1 import failed for ${triage.category}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // L1 Provenance: record wasDerivedFrom L0 source doc (US-003)
  const totalL1Records =
    summary.labValues +
    summary.consultations +
    summary.imagingReports +
    summary.procedures +
    summary.narratives;

  if (totalL1Records > 0) {
    try {
      await recordL1Provenance(sourceDoc, triage, summary, opts.patientId);
    } catch {
      // Provenance recording is non-fatal
    }
  }

  return summary;
}

// ─── L1 Provenance (wasDerivedFrom L0) ─────────────────────────────────

import type { ProvEntity } from '../schemas/provenance.js';

const L1_CATEGORY_ENTITY_TYPE: Record<string, ProvEntity['type']> = {
  lab_result: 'lab-result',
  consultation: 'consultation',
  imaging_report: 'imaging-report',
  procedure: 'procedure-report',
  narrative: 'source-doc',
  external: 'consultation',
};

/** Record L1 entities and their derivation from L0 source document. */
async function recordL1Provenance(
  sourceDoc: SourceDocument,
  triage: TriageResult,
  summary: L1ImportSummary,
  patientId: string,
): Promise<void> {
  const provStore = getProvenanceStore();
  const now = new Date().toISOString();
  const activityId = `l1-import-${sourceDoc.id}-${Date.now()}`;

  const totalRecords =
    summary.labValues +
    summary.consultations +
    summary.imagingReports +
    summary.procedures +
    summary.narratives;

  // Record the L1 import activity with terminology version metadata (US-004)
  await provStore.recordActivity({
    id: activityId,
    type: 'import',
    startedAt: now,
    endedAt: now,
    metadata: JSON.stringify({
      phase: 'l1-import',
      sourceDocumentId: sourceDoc.id,
      category: triage.category,
      recordsCreated: totalRecords,
      terminologyVersions: {
        loinc: '2.82',
        snomed: '2025-01',
        icd10: '2026-03',
        rxnorm: '2026-03',
        pipeline: '3.0.0',
      },
    }),
    createdAt: now,
  });

  // Record L1 entity for the category
  const entityType = L1_CATEGORY_ENTITY_TYPE[triage.category] ?? ('source-doc' as const);
  const entityId = `l1-${entityType}-${sourceDoc.id}`;

  await provStore.recordEntity({
    id: entityId,
    type: entityType,
    layer: 1,
    patientId,
    metadata: JSON.stringify({
      sourceDocumentId: sourceDoc.id,
      category: triage.category,
      recordCount: totalRecords,
    }),
    createdAt: now,
  });

  // wasDerivedFrom: L1 entity → L0 source doc
  await provStore.recordRelation({
    id: `rel-${entityId}-derived-${sourceDoc.id}`,
    type: 'wasDerivedFrom',
    subjectId: entityId,
    objectId: sourceDoc.id,
    createdAt: now,
  });

  // wasGeneratedBy: L1 entity → import activity
  await provStore.recordRelation({
    id: `rel-${entityId}-gen-${activityId}`,
    type: 'wasGeneratedBy',
    subjectId: entityId,
    objectId: activityId,
    createdAt: now,
  });
}

// ─── Dynamic fhirStatus (US-004) ───────────────────────────────────────

/**
 * Derive FHIR status from extraction confidence and validation overrides.
 *
 * Thresholds:
 *   >= 0.90 → 'final'
 *   >= 0.70 → 'preliminary' (with warning)
 *   <  0.70 → 'preliminary' (with escalation flag)
 *
 * Override: frontmatter validation_status 'confirmed' forces 'final'.
 */
function deriveFhirStatus(
  confidence: number,
  validationStatus?: string,
): { fhirStatus: 'final' | 'preliminary'; escalate: boolean } {
  // Override: confirmed → always final
  if (validationStatus === 'confirmed') {
    return { fhirStatus: 'final', escalate: false };
  }

  if (confidence >= 0.9) {
    return { fhirStatus: 'final', escalate: false };
  }
  if (confidence >= 0.7) {
    return { fhirStatus: 'preliminary', escalate: false };
  }
  return { fhirStatus: 'preliminary', escalate: true };
}

// ─── L1 handlers (reuse existing parsers) ───────────────────────────────

async function importLabResults(
  parsed: Awaited<ReturnType<typeof parseRecordFile>>,
  store: ReturnType<typeof getClinicalStore>,
  hashSlug?: string,
  sourceDocId?: string,
): Promise<number> {
  if (!parsed.structuredValues?.length) return 0;

  const rawLabs: LabResult[] = await Promise.all(
    parsed.structuredValues.map((sv, idx) =>
      mapLabValue(sv, parsed.frontmatter, idx, hashSlug, sourceDocId),
    ),
  );

  // Post-processing validation: catch LLM extraction artifacts
  const validatedLabs: LabResult[] = [];
  for (const lab of rawLabs) {
    const result = validateLabResult(lab, parsed.structuredValues);
    if (result.rejected) {
      logger.warn(
        `Lab rejected: ${result.rejectReason} (test: ${lab.testName}, value: ${String(lab.value)})`,
      );
      continue;
    }
    // Apply corrections
    if (result.corrections.testName) lab.testName = result.corrections.testName;
    if (result.corrections.loincCode) lab.loincCode = result.corrections.loincCode;
    if (result.corrections.flag) lab.flag = result.corrections.flag;
    if (result.corrections.validationStatus)
      lab.validationStatus = result.corrections.validationStatus;
    // Append notes
    if (result.additionalNotes.length > 0) {
      const extra = result.additionalNotes.join('; ');
      lab.notes = lab.notes ? `${lab.notes}; ${extra}` : extra;
    }
    // Terminology validation + confidence scoring (US-002)
    const sourceConfidence = parsed.frontmatter.extraction_confidence ?? 0.9;
    const validation = validateLabRecord(lab, sourceConfidence);
    lab.extractionConfidence = validation.confidence;
    lab.fhirStatus = validation.fhirStatus;
    for (const w of validation.warnings) {
      logger.warn(`Lab validation: ${w}`);
    }

    validatedLabs.push(lab);
  }

  if (validatedLabs.length > 0) {
    const storeResult = await store.addLabResultsBatch(validatedLabs);
    return storeResult.inserted;
  }
  return 0;
}

async function mapLabValue(
  value: StructuredLabValue,
  fm: RecordFrontmatter,
  index: number,
  hashSlug?: string,
  sourceDocId?: string,
): Promise<LabResult> {
  const id = `lab-${hashSlug ?? fm.document_id}-${index}`;

  const stripBold = (v: string | number): string | number =>
    typeof v === 'string' ? v.replace(/\*\*/g, '') : v;

  const noteParts: string[] = [];
  if (value.test_name_pl) noteParts.push(`PL: ${value.test_name_pl}`);
  if (value.loinc) noteParts.push(`LOINC: ${value.loinc}`);
  const notes = noteParts.length > 0 ? noteParts.join('; ') : undefined;

  const source =
    fm.source_lab ?? fm.facility ?? fm.institution ?? fm.source_file ?? 'patient-compiled';
  const normalized = normalizeLabValue(value.test_name, value.unit ?? '');

  const lab: LabResult = {
    id,
    patientId: fm.patient_id,
    testName: normalized.testName,
    value: stripBold(value.value),
    unit: normalized.unit,
    date: value.date,
  };

  if (value.reference_range) lab.referenceRange = value.reference_range;
  if (value.flag) lab.flag = value.flag;
  if (source) lab.source = source;
  if (notes) lab.notes = notes;
  if (fm.evidence_tier) lab.evidenceTier = fm.evidence_tier;
  if (fm.validation_status) lab.validationStatus = fm.validation_status;
  if (fm.source_credibility !== undefined) lab.sourceCredibility = fm.source_credibility;

  lab.fhirResourceType = 'Observation';
  lab.fhirStatus = 'final'; // default; overridden by validation layer
  lab.documentCategory = 'diagnostic-report';
  lab.sourceDocumentId = sourceDocId ?? `src-${fm.document_id}`;

  const loincCode = (await getLoincCodeAsync(normalized.testName)) ?? (value.loinc || undefined);
  if (loincCode) {
    // Validate LOINC code format before assigning
    if (!/^\d{1,7}-\d$/.test(loincCode)) {
      logger.warn(`Invalid LOINC format for "${normalized.testName}": ${loincCode}`);
    } else {
      lab.loincCode = loincCode;
    }

    // Cross-validate unit against LOINC expected units
    const unitCheck = validateLoincUnit(loincCode, normalized.unit, normalized.testName);
    if (!unitCheck.valid && unitCheck.warning) {
      lab.notes = lab.notes ? `${lab.notes}; ${unitCheck.warning}` : unitCheck.warning;
    }
  }

  const valueSnomedCode = getValueSnomedCode(String(value.value));
  if (valueSnomedCode) {
    // Validate SNOMED code format before assigning
    if (!/^\d{6,18}$/.test(valueSnomedCode)) {
      logger.warn(`Invalid SNOMED value code for "${String(value.value)}": ${valueSnomedCode}`);
    } else {
      lab.valueSnomedCode = valueSnomedCode;
    }
  }

  return lab;
}

async function importConsultation(
  fm: RecordFrontmatter,
  body: string,
  store: ReturnType<typeof getClinicalStore>,
  verbose?: boolean,
  hashSlug?: string,
  sourceDocId?: string,
): Promise<number> {
  if (body.trim().length === 0) return 0;

  const consultation = mapConsultation(fm, body, hashSlug, sourceDocId);

  // Dynamic fhirStatus + extraction confidence (US-004)
  const consultConfidence = fm.extraction_confidence ?? 0.9;
  consultation.extractionConfidence = consultConfidence;
  const consultStatus = deriveFhirStatus(consultConfidence, fm.validation_status);
  consultation.fhirStatus = consultStatus.fhirStatus;

  // LLM fallback for SNOMED finding extraction
  if (!consultation.snomedFindingCode && body.trim().length > 50) {
    try {
      const finding = await extractClinicalFindings(
        body,
        consultation.specialty,
        consultation.conclusions,
      );
      if (finding && finding.confidence >= 0.5) {
        consultation.snomedFindingCode = finding.snomedCode;
        if (verbose) {
          logger.info(`  LLM finding: "${finding.findingName}" → ${finding.snomedCode}`);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  // ICD-10 crosswalk: SNOMED finding → ICD-10 via crosswalk service
  if (consultation.snomedFindingCode) {
    try {
      const crosswalkResults = translateCode(
        SYSTEM_SNOMED,
        consultation.snomedFindingCode,
        SYSTEM_ICD10,
      );
      const bestMatch =
        crosswalkResults.find((r) => r.relationship === 'equivalent') ?? crosswalkResults[0];
      if (bestMatch) {
        consultation.icd10Code = bestMatch.targetCode;
        if (verbose) {
          logger.info(
            `  ICD-10 crosswalk: SNOMED ${consultation.snomedFindingCode} → ICD-10 ${bestMatch.targetCode}`,
          );
        }
      }
    } catch {
      // Crosswalk failure is non-fatal
    }
  }

  // Terminology validation + confidence scoring (US-002)
  const consultValidation = validateConsultationRecord(consultation, consultConfidence);
  consultation.extractionConfidence = consultValidation.confidence;
  consultation.fhirStatus = consultValidation.fhirStatus;
  for (const w of consultValidation.warnings) {
    logger.warn(`Consultation validation: ${w}`);
  }

  await store.addConsultation(consultation);
  return 1;
}

async function importImagingReport(
  fm: RecordFrontmatter,
  body: string,
  store: ReturnType<typeof getClinicalStore>,
  _verbose?: boolean,
  _hashSlug?: string,
  sourceDocId?: string,
): Promise<number> {
  if (body.trim().length === 0) return 0;

  const fmExt = fm as RecordFrontmatter & Record<string, unknown>;
  if (fmExt['category'] === 'software-documentation' || fm.document_type === 'other') {
    return 0;
  }

  const report = mapImagingReport(fm, body);
  // Override with hash-based deterministic sourceDocumentId (not LLM-generated fm.document_id)
  if (sourceDocId) report.sourceDocumentId = sourceDocId;

  // Terminology validation + confidence scoring (US-002)
  const imgConfidence = fm.extraction_confidence ?? 0.9;
  const imgValidation = validateImagingRecord(report, imgConfidence);
  report.extractionConfidence = imgValidation.confidence;
  report.fhirStatus = imgValidation.fhirStatus;
  for (const w of imgValidation.warnings) {
    logger.warn(`Imaging validation: ${w}`);
  }

  await store.addImagingReport(report);
  return 1;
}

async function importProcedure(
  fm: RecordFrontmatter,
  body: string,
  store: ReturnType<typeof getClinicalStore>,
  _verbose?: boolean,
  _hashSlug?: string,
  sourceDocId?: string,
): Promise<number> {
  if (body.trim().length === 0) return 0;

  const report = mapProcedureReport(fm, body);

  // Skip non-clinical entries (photos, attachments)
  if (report.procedureType === 'other' && /Zdjęcia|attachments|photos/i.test(report.source ?? '')) {
    return 0;
  }

  // Override with hash-based deterministic sourceDocumentId (not LLM-generated fm.document_id)
  if (sourceDocId) report.sourceDocumentId = sourceDocId;

  // Terminology validation + confidence scoring (US-002)
  const procConfidence = fm.extraction_confidence ?? 0.9;
  const procValidation = validateProcedureRecord(report, procConfidence);
  report.extractionConfidence = procValidation.confidence;
  report.fhirStatus = procValidation.fhirStatus;
  for (const w of procValidation.warnings) {
    logger.warn(`Procedure validation: ${w}`);
  }

  await store.addAbdominalReport(report);
  return 1;
}

/** Map triage subcategory → PatientReport type. Exact match first, then keyword fallback. */
const NARRATIVE_TYPE_EXACT: Record<string, PatientReport['type']> = {
  patient_history: 'medical-history',
  patient_medical_history: 'medical-history',
  medical_history: 'medical-history',
  history: 'medical-history',
  composite: 'medical-history',
  symptom_diary: 'symptom-update',
  chronic_pain_diary: 'symptom-update',
  pain_diary: 'symptom-update',
  symptom_update: 'symptom-update',
  treatment_log: 'treatment-response',
  treatment_response: 'treatment-response',
  complaint: 'concern',
  complaints: 'concern',
};

const NARRATIVE_TYPE_KEYWORDS: Array<[RegExp, PatientReport['type']]> = [
  [/history|historia/i, 'medical-history'],
  [/diary|symptom|pain|ból|dolegliw/i, 'symptom-update'],
  [/treatment|response|leczeni/i, 'treatment-response'],
  [/complaint|concern|skarg/i, 'concern'],
  [/function|functional|sprawno/i, 'functional-status'],
];

function resolveNarrativeType(subcategory: string | undefined): PatientReport['type'] {
  if (!subcategory) return 'self-observation';
  const exact = NARRATIVE_TYPE_EXACT[subcategory];
  if (exact) return exact;
  for (const [pattern, type] of NARRATIVE_TYPE_KEYWORDS) {
    if (pattern.test(subcategory)) return type;
  }
  return 'self-observation';
}

async function importNarrative(
  fm: RecordFrontmatter,
  body: string,
  store: ReturnType<typeof getClinicalStore>,
  hashSlug?: string,
  sourceDocId?: string,
): Promise<number> {
  if (body.trim().length === 0) return 0;

  const reportType = resolveNarrativeType(fm.category);

  await store.addPatientReport({
    id: `import-nar-${hashSlug ?? fm.document_id}`,
    patientId: fm.patient_id,
    date: fm.date ?? '',
    type: reportType,
    content: body.trim(),
    source: fm.source_file,
    evidenceTier: fm.evidence_tier,
    validationStatus: fm.validation_status,
    sourceCredibility: fm.source_credibility,
    sourceDocumentId: sourceDocId ?? `src-${fm.document_id}`,
  });
  return 1;
}

async function importExternal(
  fm: RecordFrontmatter,
  body: string,
  store: ReturnType<typeof getClinicalStore>,
  hashSlug?: string,
  sourceDocId?: string,
): Promise<number> {
  if (body.trim().length === 0) return 0;

  const fmExt = fm as RecordFrontmatter & Record<string, unknown>;
  const rawSpecialty =
    typeof fmExt['specialty'] === 'string' ? fmExt['specialty'] : 'general_medicine';
  const canonSpecialty = normalizeSpecialty(rawSpecialty);

  await store.addConsultation({
    id: `import-ext-${hashSlug ?? fm.document_id}`,
    patientId: fm.patient_id,
    provider: typeof fmExt['physician'] === 'string' ? fmExt['physician'] : 'Unknown',
    specialty: canonSpecialty,
    date: fm.date ?? '',
    conclusionsStatus: 'unknown' as const,
    findings: body.trim(),
    institution: (fmExt['facility'] ?? fmExt['institution']) as string | undefined,
    source: fm.source_file,
    snomedSpecialtyCode: getSnomedSpecialtyCode(canonSpecialty),
    evidenceTier: fm.evidence_tier,
    validationStatus: fm.validation_status,
    sourceCredibility: fm.source_credibility,
    sourceDocumentId: sourceDocId ?? `src-${fm.document_id}`,
  });
  return 1;
}

// ─── L1 Medications ─────────────────────────────────────────────────────

interface MedicationImportResult {
  medications: number;
  changes: number;
  adherence: number;
}

async function importMedications(
  body: string,
  triage: TriageResult,
  sourceDoc: SourceDocument,
  patientId: string,
): Promise<MedicationImportResult> {
  const result: MedicationImportResult = { medications: 0, changes: 0, adherence: 0 };

  // Extract meds from all document types that may contain medication mentions
  // Lab results and imaging reports can contain medication context in narrative sections
  const medCategories = new Set([
    'consultation',
    'external',
    'procedure',
    'narrative',
    'lab_result',
    'imaging_report',
  ]);
  if (!medCategories.has(triage.category)) return result;

  const store = getClinicalStore();
  const docDate = triage.documentDate ?? '';

  // Extract medication mentions
  const mentions = extractMedications(body, docDate);
  for (const mention of mentions) {
    const med = mentionToMedication(mention, patientId, sourceDoc.id, docDate);
    med.id = `med-${med.medicationName.replace(/\s+/g, '-').toLowerCase()}`;
    try {
      await store.addMedication(med);
      result.medications++;
    } catch {
      // Duplicate — expected for common medications
    }
  }

  // Extract medication changes
  const changes = extractMedicationChanges(body);
  for (const change of changes) {
    try {
      const changeObj: Parameters<typeof store.addMedicationChange>[0] = {
        id: `mc-${change.medicationName.replace(/\s+/g, '-')}-${change.changeType}-${sourceDoc.id}`,
        patientId,
        medicationName: change.medicationName,
        changeType: change.changeType,
        sourceDocumentId: sourceDoc.id,
        evidenceTier: 'T1-official',
        validationStatus: 'unvalidated',
        sourceCredibility: 75,
      };
      if (change.rxnormCode) changeObj.rxnormCode = change.rxnormCode;
      if (docDate) changeObj.changeDate = docDate;
      if (change.previousValue) changeObj.previousValue = change.previousValue;
      if (change.newValue) changeObj.newValue = change.newValue;
      if (change.reason) changeObj.reason = change.reason;
      await store.addMedicationChange(changeObj);
      result.changes++;
    } catch {
      // Duplicate
    }
  }

  // Extract adherence mentions
  const adherenceMentions = extractAdherenceMentions(body);
  for (const adh of adherenceMentions) {
    try {
      const adhObj: Parameters<typeof store.addAdherenceObservation>[0] = {
        id: `adh-${sourceDoc.id}-${result.adherence}`,
        patientId,
        medicationName: adh.medicationName ?? 'general',
        adherenceCode: adh.adherenceCode,
        sourceDocumentId: sourceDoc.id,
        evidenceTier: 'T1-official',
        validationStatus: 'unvalidated',
        sourceCredibility: 70,
      };
      const adhRxnorm = adh.medicationName ? getRxnormCode(adh.medicationName) : undefined;
      if (adhRxnorm) adhObj.rxnormCode = adhRxnorm;
      if (docDate) adhObj.observationDate = docDate;
      if (adh.reporter) adhObj.reporter = adh.reporter;
      if (adh.notes) adhObj.notes = adh.notes;
      await store.addAdherenceObservation(adhObj);
      result.adherence++;
    } catch {
      // Duplicate
    }
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function emptyL1Summary(): L1ImportSummary {
  return {
    labValues: 0,
    consultations: 0,
    imagingReports: 0,
    procedures: 0,
    narratives: 0,
    medications: 0,
    medicationChanges: 0,
    adherenceObservations: 0,
  };
}
