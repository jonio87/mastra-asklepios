/**
 * Import medical-records markdown files into Asklepios.
 *
 * Phase 0:   Validate all files (fail-early — no DB writes until everything passes)
 * Phase 0.5: Layer 0 — Source Documents (extraction metadata, provenance tracking)
 * Phase 1:   Semantic Index (cross-cutting) — Document Knowledge Base (embeddings)
 * Phase 2:   Layer 1 — Structured Clinical Records (labs, consultations, imaging, procedures, narratives)
 *
 * Usage:
 *   npx tsx scripts/import-records.ts <records-dir> [options]
 *
 * Options:
 *   --dry-run            Validate only, don't write to DB
 *   --layer3-only        Skip Layer 1 structured records (semantic index only)
 *   --layer2-only        Skip semantic index (Layer 1 structured records only)
 *   --verbose            Print each file as it's processed
 *   --continue-on-error  Don't abort on validation errors (import valid files only)
 */

import type { LabResult } from '../src/schemas/clinical-record.js';
import type { DocumentType } from '../src/knowledge/document-store.js';
import type { ParsedRecord } from '../src/importers/parser.js';
import type { RecordFrontmatter, StructuredLabValue } from '../src/importers/schemas.js';
import type { SourceDocument } from '../src/schemas/source-document.js';
import { discoverRecordFiles, parseRecordFile, stripFrontmatter } from '../src/importers/parser.js';
import { normalizeLabValue, getLoincCode, getValueSnomedCode } from '../src/importers/normalizer.js';
import { mapConsultation } from '../src/importers/consultation-parser.js';
import { extractClinicalFindings } from '../src/importers/findings-extractor.js';
import { mapImagingReport } from '../src/importers/imaging-parser.js';
import { mapProcedureReport } from '../src/importers/procedure-parser.js';
import { getSnomedSpecialtyCode, normalizeSpecialty } from '../src/importers/specialty-normalizer.js';
import { documentTypeMapping } from '../src/importers/schemas.js';
import { getClinicalStore } from '../src/storage/clinical-store.js';
import { getProvenanceStore } from '../src/storage/provenance-store.js';
import { getDocumentStore } from '../src/knowledge/document-store.js';
import { vectorStore } from '../src/memory.js';
import { createEmbedder } from '../src/utils/embedder.js';
import { readFile } from 'node:fs/promises';

// ─── CLI argument parsing ─────────────────────────────────────────────────

interface ImportOptions {
  recordsDir: string;
  dryRun: boolean;
  layer3Only: boolean;
  layer2Only: boolean;
  verbose: boolean;
  continueOnError: boolean;
  forceReimport: boolean;
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const recordsDir = args.find((a) => !a.startsWith('--'));

  if (!recordsDir) {
    console.error('Usage: npx tsx scripts/import-records.ts <records-dir> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run            Validate only, don\'t write to DB');
    console.error('  --layer3-only        Skip Layer 1 structured records (semantic index only)');
    console.error('  --layer2-only        Skip semantic index (Layer 1 structured records only)');
    console.error('  --verbose            Print each file as it\'s processed');
    console.error('  --continue-on-error  Import valid files even if some fail validation');
    console.error('  --force-reimport     Delete old L1 records, reimport from extracted markdown');
    process.exit(1);
  }

  return {
    recordsDir,
    dryRun: args.includes('--dry-run'),
    layer3Only: args.includes('--layer3-only'),
    layer2Only: args.includes('--layer2-only'),
    verbose: args.includes('--verbose'),
    continueOnError: args.includes('--continue-on-error'),
    forceReimport: args.includes('--force-reimport'),
  };
}

// ─── Phase 0: Validation ─────────────────────────────────────────────────

interface ValidationResult {
  valid: ParsedRecord[];
  errors: Array<{ filePath: string; error: string }>;
  totalLabValues: number;
}

async function validateAll(
  files: string[],
  verbose: boolean,
): Promise<ValidationResult> {
  const valid: ParsedRecord[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];
  let totalLabValues = 0;

  for (const filePath of files) {
    try {
      const record = await parseRecordFile(filePath);
      valid.push(record);
      if (record.structuredValues) {
        totalLabValues += record.structuredValues.length;
      }
      if (verbose) {
        const labCount = record.structuredValues?.length ?? 0;
        console.log(
          `  OK  ${record.frontmatter.document_id} (${record.frontmatter.document_type}${labCount > 0 ? `, ${labCount} lab values` : ''})`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ filePath, error: message });
      if (verbose) {
        console.log(`  FAIL ${filePath}: ${message}`);
      }
    }
  }

  return { valid, errors, totalLabValues };
}

// ─── Phase 0.5: Layer 0 — Source Documents ───────────────────────────────

interface Layer0Result {
  imported: number;
  skipped: number;
}

/**
 * Map a parsed record's frontmatter into a SourceDocument for Layer 0 storage.
 * Frontmatter uses .passthrough() so provenance fields (source_file_hash,
 * source_file_size_bytes, etc.) from add_provenance.py are available.
 */
function mapToSourceDocument(record: ParsedRecord): SourceDocument {
  const fm = record.frontmatter as RecordFrontmatter & Record<string, unknown>;
  const doc: SourceDocument = {
    id: `src-${fm.document_id}`,
    patientId: fm.patient_id,
    originalFilename: typeof fm['source_file'] === 'string' ? fm['source_file'] : fm.document_id,
    originalFileHash: typeof fm['source_file_hash'] === 'string' ? fm['source_file_hash'] : 'unknown',
    originalFileSizeBytes: typeof fm['source_file_size_bytes'] === 'number' ? fm['source_file_size_bytes'] : 0,
    extractionMethod: mapExtractionMethod(fm.extraction_model),
    extractionConfidence: fm.extraction_confidence ?? 0.9,
    extractionDate: typeof fm['extraction_date'] === 'string' ? fm['extraction_date'] : new Date().toISOString(),
    extractionTool: typeof fm['extraction_tool'] === 'string' ? fm['extraction_tool'] : (fm.extraction_model ?? 'unknown'),
    extractedMarkdownPath: record.filePath,
    category: fm.document_type,
    evidenceTier: fm.evidence_tier,
    validationStatus: fm.validation_status,
    sourceCredibility: fm.source_credibility,
  };

  // Optional fields — set via mutation for exactOptionalPropertyTypes
  if (typeof fm['original_page_count'] === 'number') doc.originalPageCount = fm['original_page_count'];
  if (typeof fm['extraction_wave'] === 'number') doc.extractionWave = fm['extraction_wave'];
  if (typeof fm['pre_processing'] === 'string') doc.preProcessing = fm['pre_processing'];
  if (typeof fm['post_processing'] === 'string') doc.postProcessing = fm['post_processing'];
  if (typeof fm['extraction_pipeline_version'] === 'string') doc.pipelineVersion = fm['extraction_pipeline_version'];
  if (typeof fm['category'] === 'string') doc.subcategory = fm['category'];
  if (fm.date) doc.date = fm.date;
  if (fm.facility) doc.facility = fm.facility;
  if (typeof fm['physician'] === 'string') doc.physician = fm['physician'];
  if (fm.language) doc.language = fm.language;
  if (fm.tags) doc.tags = fm.tags;

  // FHIR R4 + LOINC Document Ontology fields
  if (typeof fm['fhir_resource_type'] === 'string')
    doc.fhirResourceType = fm['fhir_resource_type'] as SourceDocument['fhirResourceType'];
  if (typeof fm['loinc_doc_code'] === 'string') doc.loincDocCode = fm['loinc_doc_code'];
  if (typeof fm['diagnostic_service_section'] === 'string')
    doc.diagnosticServiceSection = fm['diagnostic_service_section'] as SourceDocument['diagnosticServiceSection'];

  return doc;
}

/** Map extraction_model from frontmatter to our ExtractionMethod enum */
function mapExtractionMethod(model: string | undefined): SourceDocument['extractionMethod'] {
  if (!model) return 'other';
  const lower = model.toLowerCase();
  if (lower.includes('claude')) return 'claude_read';
  if (lower.includes('tesseract')) return 'tesseract_ocr';
  if (lower.includes('pymupdf')) return 'pymupdf';
  if (lower.includes('docx') || lower.includes('python-docx')) return 'python_docx';
  return 'other';
}

async function importLayer0(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<Layer0Result> {
  const store = getClinicalStore();
  const result: Layer0Result = { imported: 0, skipped: 0 };

  for (const record of records) {
    try {
      const doc = mapToSourceDocument(record);
      await store.addSourceDocument(doc);
      result.imported++;

      if (verbose) {
        console.log(`  L0  ${record.frontmatter.document_id} → source_documents (${doc.category})`);
      }
    } catch (err) {
      // Silently skip duplicates (same id already exists)
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE') || message.includes('duplicate')) {
        result.skipped++;
        if (verbose) {
          console.log(`  SKIP ${record.frontmatter.document_id} (already in source_documents)`);
        }
      } else {
        throw err;
      }
    }
  }

  return result;
}

/**
 * Record provenance for a completed import phase.
 * Creates a PROV activity linking source documents to their derived entities.
 */
async function recordImportProvenance(
  records: ParsedRecord[],
  phase: string,
  description: string,
): Promise<void> {
  const provStore = getProvenanceStore();
  const now = new Date().toISOString();

  // Record the import activity
  const activityId = `import-${phase}-${now}`;
  await provStore.recordActivity({
    id: activityId,
    type: 'import',
    startedAt: now,
    endedAt: now,
    metadata: JSON.stringify({ phase, description, recordCount: records.length }),
    createdAt: now,
  });

  // Record the pipeline agent (idempotent via INSERT OR REPLACE)
  await provStore.recordAgent({
    id: 'pipeline:import-records',
    type: 'pipeline',
    name: 'import-records.ts',
    createdAt: now,
  });

  // Link activity to agent
  await provStore.recordRelation({
    id: `rel-${activityId}-agent`,
    type: 'wasAttributedTo',
    subjectId: activityId,
    objectId: 'pipeline:import-records',
    createdAt: now,
  });

  // Record source document entities and emit change signals for new data
  for (const record of records) {
    const entityId = `src-${record.frontmatter.document_id}`;

    // Record the source document as a provenance entity (Layer 0)
    await provStore.recordEntity({
      id: entityId,
      type: 'source-doc',
      layer: 0,
      patientId: record.frontmatter.patient_id,
      metadata: JSON.stringify({
        documentType: record.frontmatter.document_type,
        date: record.frontmatter.date,
      }),
      createdAt: now,
    });

    // Link entity to the import activity
    await provStore.recordRelation({
      id: `rel-${entityId}-${activityId}`,
      type: 'wasGeneratedBy',
      subjectId: entityId,
      objectId: activityId,
      createdAt: now,
    });

    // Emit change signal: new source document affects all higher layers (1-5)
    await provStore.emitChangeSignal({
      id: `signal-${phase}-${record.frontmatter.document_id}-${Date.now()}`,
      sourceEntityId: entityId,
      affectedLayers: [1, 2, 3, 4, 5],
      affectedEntityIds: [entityId],
      changeType: 'new',
      summary: `New ${record.frontmatter.document_type} imported: ${record.frontmatter.document_id}`,
      priority: 'medium',
      status: 'pending',
      patientId: record.frontmatter.patient_id,
      createdAt: now,
    });
  }
}

// ─── Phase 1: Semantic Index — Document Knowledge Base ───────────────────

interface Layer3Result {
  ingested: number;
  skipped: number;
  errors: number;
  totalChunks: number;
}

async function importLayer3(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<Layer3Result> {
  const embedder = createEmbedder();
  if (!embedder) {
    console.error('Semantic Index import requires OPENAI_API_KEY for embeddings.');
    console.error('Set OPENAI_API_KEY in .env or environment, or use --layer2-only.');
    process.exit(1);
  }

  const docStore = getDocumentStore(vectorStore, embedder);
  const result: Layer3Result = { ingested: 0, skipped: 0, errors: 0, totalChunks: 0 };

  // Process in batches to avoid OpenAI rate limits
  const batchSize = 10;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    for (const record of batch) {
      const fm = record.frontmatter;
      const docType: DocumentType = documentTypeMapping[fm.document_type];

      // Read raw file and strip frontmatter for clean body text
      const rawContent = await readFile(record.filePath, 'utf-8');
      const bodyText = stripFrontmatter(rawContent);

      if (bodyText.trim().length === 0) {
        if (verbose) console.log(`  SKIP ${fm.document_id} (empty body)`);
        result.skipped++;
        continue;
      }

      // Build metadata with optional fields via conditional mutation
      const metadata: {
        patientId: string;
        documentType: DocumentType;
        date?: string;
        source?: string;
        title?: string;
      } = {
        patientId: fm.patient_id,
        documentType: docType,
      };
      if (fm.date) metadata.date = fm.date;
      const source = fm.source_lab ?? fm.facility ?? fm.institution;
      if (source) metadata.source = source;
      metadata.title = fm.document_id;

      try {
        const ingestion = await docStore.ingestDocument(bodyText, metadata);
        result.ingested++;
        result.totalChunks += ingestion.chunkCount;
        if (verbose) {
          console.log(
            `  SI  ${fm.document_id} → ${ingestion.chunkCount} chunks`,
          );
        }
      } catch (err) {
        result.errors++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ERR  SI ${fm.document_id}: ${message}`);
      }
    }

    // Rate limit pause between batches (OpenAI embeddings)
    if (i + batchSize < records.length) {
      await sleep(1000);
    }
  }

  return result;
}

// ─── Phase 2: Layer 1 — Structured Lab Results ──────────────────────────

interface Layer2Result {
  labsInserted: number;
  filesProcessed: number;
}

function buildLabId(documentId: string, index: number): string {
  return `import-lab-${documentId}-${index}`;
}

function mapLabValue(
  value: StructuredLabValue,
  fm: RecordFrontmatter,
  index: number,
): LabResult {
  const id = buildLabId(fm.document_id, index);

  // Strip markdown bold markers from values (e.g., "**3.5**" → "3.5")
  const stripMarkdownBold = (v: string | number): string | number => {
    if (typeof v === 'string') return v.replace(/\*\*/g, '');
    return v;
  };

  // Build notes from Polish name and LOINC code
  const noteParts: string[] = [];
  if (value.test_name_pl) noteParts.push(`PL: ${value.test_name_pl}`);
  if (value.loinc) noteParts.push(`LOINC: ${value.loinc}`);
  const notes = noteParts.length > 0 ? noteParts.join('; ') : undefined;

  const source = fm.source_lab ?? fm.facility ?? fm.institution;

  // Normalize test name and unit to international English standard
  const normalized = normalizeLabValue(value.test_name, value.unit);

  const lab: LabResult = {
    id,
    patientId: fm.patient_id,
    testName: normalized.testName,
    value: stripMarkdownBold(value.value),
    unit: normalized.unit,
    date: value.date,
  };

  // Set optional fields via mutation (exactOptionalPropertyTypes)
  if (value.reference_range) lab.referenceRange = value.reference_range;
  if (value.flag) lab.flag = value.flag;
  if (source) lab.source = source;
  if (notes) lab.notes = notes;
  if (fm.evidence_tier) lab.evidenceTier = fm.evidence_tier;
  if (fm.validation_status) lab.validationStatus = fm.validation_status;
  if (fm.source_credibility !== undefined) lab.sourceCredibility = fm.source_credibility;

  // FHIR R4 metadata — Observation resource
  lab.fhirResourceType = 'Observation';
  lab.fhirStatus = 'final';
  lab.documentCategory = 'diagnostic-report';
  if (typeof fm.document_id === 'string') lab.sourceDocumentId = `src-${fm.document_id}`;
  // LOINC code: prefer verified canonical map, fall back to source data
  // (source YAML codes were assigned during extraction and may contain errors)
  const loincCode = getLoincCode(normalized.testName) ?? (value.loinc || undefined);
  if (loincCode) lab.loincCode = loincCode;

  // SNOMED CT qualitative value coding (LOINC = question, SNOMED = answer)
  const valueSnomedCode = getValueSnomedCode(String(value.value));
  if (valueSnomedCode) lab.valueSnomedCode = valueSnomedCode;

  return lab;
}

async function importLayer2(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<Layer2Result> {
  const store = getClinicalStore();
  const result: Layer2Result = { labsInserted: 0, filesProcessed: 0 };

  // Collect all lab values from records with structured values
  const allLabs: LabResult[] = [];

  for (const record of records) {
    if (!record.structuredValues || record.structuredValues.length === 0) {
      continue;
    }

    const labs = record.structuredValues.map((sv, idx) =>
      mapLabValue(sv, record.frontmatter, idx),
    );
    allLabs.push(...labs);
    result.filesProcessed++;

    if (verbose) {
      console.log(
        `  L1  ${record.frontmatter.document_id} → ${labs.length} lab values`,
      );
    }
  }

  if (allLabs.length > 0) {
    const batchResult = await store.addLabResultsBatch(allLabs);
    result.labsInserted = batchResult.inserted;
  }

  // Backfill SNOMED qualitative codes for any existing rows missing them
  const existingLabs = await store.queryLabs({ patientId: allLabs[0]?.patientId ?? '' });
  let backfilled = 0;
  for (const lab of existingLabs) {
    if (lab.valueSnomedCode) continue;
    const code = getValueSnomedCode(String(lab.value));
    if (code) {
      await store.updateLabSnomedCode(lab.id, code);
      backfilled++;
    }
  }
  if (backfilled > 0 && verbose) {
    console.log(`  Backfilled ${backfilled} SNOMED qualitative codes`);
  }

  return result;
}

// ─── Phase 2b: Layer 1 — Structured Consultations ───────────────────────

interface ConsultationImportResult {
  imported: number;
  skipped: number;
}

async function importConsultations(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<ConsultationImportResult> {
  const store = getClinicalStore();
  const result: ConsultationImportResult = { imported: 0, skipped: 0 };

  const consultationRecords = records.filter(
    (r) => r.frontmatter.document_type === 'consultation',
  );

  // Track LLM extraction stats
  let llmAttempts = 0;
  let llmSuccesses = 0;

  for (const record of consultationRecords) {
    const rawContent = await readFile(record.filePath, 'utf-8');
    const bodyText = stripFrontmatter(rawContent);

    if (bodyText.trim().length === 0) {
      if (verbose) console.log(`  SKIP ${record.frontmatter.document_id} (empty body)`);
      result.skipped++;
      continue;
    }

    const consultation = mapConsultation(record.frontmatter, bodyText);

    // LLM fallback: if no SNOMED finding code assigned by static extraction,
    // try LLM-based extraction from the full consultation text
    if (!consultation.snomedFindingCode && bodyText.trim().length > 50) {
      llmAttempts++;
      try {
        const llmResult = await extractClinicalFindings(
          bodyText,
          consultation.specialty,
          consultation.conclusions,
        );
        if (llmResult && llmResult.confidence >= 0.5) {
          consultation.snomedFindingCode = llmResult.snomedCode;
          llmSuccesses++;
          if (verbose) {
            console.log(
              `    🧠 LLM: "${llmResult.findingName}" → ${llmResult.snomedCode} (conf: ${llmResult.confidence.toFixed(2)})`,
            );
          }
        }
      } catch {
        // LLM failure is non-fatal — continue without SNOMED finding code
      }
    }

    await store.addConsultation(consultation);
    result.imported++;

    if (verbose) {
      const snomedTag = consultation.snomedFindingCode
        ? ` [SNOMED:${consultation.snomedFindingCode}]`
        : '';
      console.log(
        `  L1C ${record.frontmatter.document_id} → ${consultation.specialty} (${consultation.provider})${snomedTag}`,
      );
    }
  }

  if (llmAttempts > 0) {
    console.log(
      `  📊 LLM findings extraction: ${llmSuccesses}/${llmAttempts} successful (${((llmSuccesses / llmAttempts) * 100).toFixed(1)}%)`,
    );
  }

  return result;
}

// ─── Phase 2c: Layer 1 — Structured Imaging Reports ─────────────────────

interface ImagingImportResult {
  imported: number;
  skipped: number;
}

async function importImagingReports(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<ImagingImportResult> {
  const store = getClinicalStore();
  const result: ImagingImportResult = { imported: 0, skipped: 0 };

  const imagingRecords = records.filter(
    (r) => r.frontmatter.document_type === 'imaging_report',
  );

  for (const record of imagingRecords) {
    const rawContent = await readFile(record.filePath, 'utf-8');
    const bodyText = stripFrontmatter(rawContent);

    if (bodyText.trim().length === 0) {
      if (verbose) console.log(`  SKIP ${record.frontmatter.document_id} (empty body)`);
      result.skipped++;
      continue;
    }

    // Skip non-medical documents (e.g., DICOM viewer docs)
    const fm = record.frontmatter as RecordFrontmatter & Record<string, unknown>;
    if (fm['category'] === 'software-documentation' || fm.document_type === 'other') {
      if (verbose) console.log(`  SKIP ${record.frontmatter.document_id} (non-medical)`);
      result.skipped++;
      continue;
    }

    const report = mapImagingReport(record.frontmatter, bodyText);
    await store.addImagingReport(report);
    result.imported++;

    if (verbose) {
      console.log(
        `  L1I ${record.frontmatter.document_id} → ${report.modality} ${report.bodyRegion}`,
      );
    }
  }

  return result;
}

// ─── Phase 2d: Layer 1 — Structured Procedure Reports (FHIR Procedure) ─

interface ProcedureImportResult {
  imported: number;
  skipped: number;
}

async function importProcedureReports(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<ProcedureImportResult> {
  const store = getClinicalStore();
  const result: ProcedureImportResult = { imported: 0, skipped: 0 };

  const procedureRecords = records.filter(
    (r) => r.frontmatter.document_type === 'procedure',
  );

  for (const record of procedureRecords) {
    const rawContent = await readFile(record.filePath, 'utf-8');
    const bodyText = stripFrontmatter(rawContent);

    if (bodyText.trim().length === 0) {
      if (verbose) console.log(`  SKIP ${record.frontmatter.document_id} (empty body)`);
      result.skipped++;
      continue;
    }

    const report = mapProcedureReport(record.frontmatter, bodyText);

    // Skip non-clinical entries (photos, attachments)
    const NON_CLINICAL = new Set(['other']);
    if (NON_CLINICAL.has(report.procedureType) && /Zdjęcia|attachments|photos/i.test(report.source ?? '')) {
      if (verbose) console.log(`  SKIP ${record.frontmatter.document_id} (non-clinical: ${report.source})`);
      result.skipped++;
      continue;
    }

    await store.addAbdominalReport(report);
    result.imported++;

    if (verbose) {
      console.log(
        `  L1P ${record.frontmatter.document_id} → ${report.procedureType}`,
      );
    }
  }

  return result;
}

// ─── Phase 2e: Layer 1 — Narrative + External as Patient Reports ────────

interface NarrativeImportResult {
  imported: number;
  skipped: number;
}

async function importNarrativesAndExternals(
  records: ParsedRecord[],
  verbose: boolean,
): Promise<NarrativeImportResult> {
  const store = getClinicalStore();
  const result: NarrativeImportResult = { imported: 0, skipped: 0 };

  // Narratives → patient_reports with type 'self-observation'
  const narrativeRecords = records.filter(
    (r) => r.frontmatter.document_type === 'narrative',
  );

  for (const record of narrativeRecords) {
    const rawContent = await readFile(record.filePath, 'utf-8');
    const bodyText = stripFrontmatter(rawContent);

    if (bodyText.trim().length === 0) {
      result.skipped++;
      continue;
    }

    await store.addPatientReport({
      id: `import-nar-${record.frontmatter.document_id}`,
      patientId: record.frontmatter.patient_id,
      date: record.frontmatter.date ?? 'unknown',
      type: 'self-observation',
      content: bodyText.trim(),
      source: record.frontmatter.source_file,
      evidenceTier: record.frontmatter.evidence_tier,
      validationStatus: record.frontmatter.validation_status,
      sourceCredibility: record.frontmatter.source_credibility,
      sourceDocumentId: `src-${record.frontmatter.document_id}`,
    });
    result.imported++;

    if (verbose) {
      console.log(`  L1N ${record.frontmatter.document_id} → patient_report (self-observation)`);
    }
  }

  // External (Duke University) → consultations with institution
  const externalRecords = records.filter(
    (r) => r.frontmatter.document_type === 'external',
  );

  for (const record of externalRecords) {
    const rawContent = await readFile(record.filePath, 'utf-8');
    const bodyText = stripFrontmatter(rawContent);

    if (bodyText.trim().length === 0) {
      result.skipped++;
      continue;
    }

    const fm = record.frontmatter as RecordFrontmatter & Record<string, unknown>;
    const rawSpecialty = typeof fm['specialty'] === 'string' ? fm['specialty'] : 'general_medicine';
    const canonSpecialty = normalizeSpecialty(rawSpecialty);
    const consultation = {
      id: `import-ext-${record.frontmatter.document_id}`,
      patientId: record.frontmatter.patient_id,
      provider: typeof fm['physician'] === 'string' ? fm['physician'] : 'Unknown',
      specialty: canonSpecialty,
      date: record.frontmatter.date ?? 'unknown',
      conclusionsStatus: 'unknown' as const,
      findings: bodyText.trim(),
      institution: fm.facility ?? fm.institution,
      source: record.frontmatter.source_file,
      snomedSpecialtyCode: getSnomedSpecialtyCode(canonSpecialty),
      evidenceTier: record.frontmatter.evidence_tier,
      validationStatus: record.frontmatter.validation_status,
      sourceCredibility: record.frontmatter.source_credibility,
      sourceDocumentId: `src-${record.frontmatter.document_id}`,
    };

    await store.addConsultation(consultation);
    result.imported++;

    if (verbose) {
      console.log(`  L1E ${record.frontmatter.document_id} → consultation (external)`);
    }
  }

  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log(`\nImporting medical records from: ${opts.recordsDir}`);
  if (opts.dryRun) console.log('  Mode: DRY RUN (validation only)');
  if (opts.layer3Only) console.log('  Mode: Semantic Index only (skip L1)');
  if (opts.layer2Only) console.log('  Mode: Layer 1 only (skip Semantic Index)');
  if (opts.forceReimport) console.log('  Mode: FORCE REIMPORT (delete old L1 records first)');
  console.log('');

  // ── Discover files ──────────────────────────────────────────────────────
  console.log('Phase 0: Discovering files...');
  const files = await discoverRecordFiles(opts.recordsDir);
  console.log(`  Found ${files.length} markdown files\n`);

  if (files.length === 0) {
    console.log('No files found. Check the records directory path.');
    process.exit(1);
  }

  // ── Validate all files ──────────────────────────────────────────────────
  console.log('Phase 0: Validating all files...');
  const validation = await validateAll(files, opts.verbose);

  console.log(`\n  Validation summary:`);
  console.log(`    Valid:      ${validation.valid.length}`);
  console.log(`    Failed:     ${validation.errors.length}`);
  console.log(`    Lab values: ${validation.totalLabValues}`);

  if (validation.errors.length > 0) {
    console.log('\n  Validation errors:');
    for (const e of validation.errors) {
      console.error(`    ${e.filePath}:`);
      console.error(`      ${e.error}\n`);
    }

    if (!opts.continueOnError) {
      console.error('\nAborting — fix validation errors or use --continue-on-error');
      process.exit(1);
    }
    console.log('\n  --continue-on-error: proceeding with valid files only\n');
  }

  if (validation.valid.length === 0) {
    console.log('\nNo valid files to import.');
    process.exit(1);
  }

  // ── Version detection: flag old pipeline versions for re-processing ────
  const versionCounts: Record<string, number> = {};
  for (const record of validation.valid) {
    const fm = record.frontmatter as RecordFrontmatter & Record<string, unknown>;
    const version = typeof fm['extraction_pipeline_version'] === 'string'
      ? fm['extraction_pipeline_version']
      : 'unknown';
    versionCounts[version] = (versionCounts[version] ?? 0) + 1;
  }
  if (Object.keys(versionCounts).length > 0) {
    console.log('\n  Pipeline version distribution:');
    for (const [version, count] of Object.entries(versionCounts).sort()) {
      const flag = version !== '3.0.0' && version !== 'unknown' ? ' ← outdated, will re-process' : '';
      console.log(`    v${version}: ${count} documents${flag}`);
    }
  }

  if (opts.dryRun) {
    console.log('\nDry run complete — no data was written.');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Time: ${elapsed}s\n`);
    process.exit(0);
  }

  // ── Force reimport: delete existing L1 records ─────────────────────────
  if (opts.forceReimport) {
    console.log('\nPhase 0.1: Force reimport — deleting old L1 records...');
    const reimportStore = getClinicalStore();
    let totalDeleted = 0;
    for (const record of validation.valid) {
      const docId = `src-${record.frontmatter.document_id}`;
      try {
        const deleted = await reimportStore.deleteRecordsBySourceDocId(docId);
        totalDeleted += deleted;
        if (opts.verbose && deleted > 0) {
          console.log(`  Deleted ${deleted} records for ${docId}`);
        }
      } catch {
        // Source doc may not exist yet — that's fine
      }
    }
    console.log(`  Deleted ${totalDeleted} old L1 records across ${validation.valid.length} documents`);
  }

  // ── Phase 0.5: Layer 0 — Source Documents ─────────────────────────────
  console.log('\nPhase 0.5: Layer 0 — Source Documents...');
  const layer0Result = await importLayer0(validation.valid, opts.verbose);
  console.log(`  Source documents: ${layer0Result.imported} imported, ${layer0Result.skipped} skipped`);

  // Record provenance for the import
  await recordImportProvenance(
    validation.valid,
    'layer0',
    `Imported ${layer0Result.imported} source documents from ${opts.recordsDir}`,
  );

  // ── Phase 1: Semantic Index (cross-cutting) ────────────────────────────
  let layer3Result: Layer3Result | undefined;
  if (!opts.layer2Only) {
    console.log('\nPhase 1: Semantic Index — Document Knowledge Base...');
    layer3Result = await importLayer3(validation.valid, opts.verbose);
  }

  // ── Phase 2: Layer 1 — Structured Clinical Records ────────────────────
  let layer2Result: Layer2Result | undefined;
  if (!opts.layer3Only) {
    console.log('\nPhase 2a: Layer 1 — Structured Lab Results...');
    layer2Result = await importLayer2(validation.valid, opts.verbose);
  }

  // ── Phase 2b: Layer 1 — Consultations ─────────────────────────────────
  let consultResult: ConsultationImportResult | undefined;
  if (!opts.layer3Only) {
    console.log('\nPhase 2b: Layer 1 — Structured Consultations...');
    consultResult = await importConsultations(validation.valid, opts.verbose);
  }

  // ── Phase 2c: Layer 1 — Imaging Reports ───────────────────────────────
  let imagingResult: ImagingImportResult | undefined;
  if (!opts.layer3Only) {
    console.log('\nPhase 2c: Layer 1 — Structured Imaging Reports...');
    imagingResult = await importImagingReports(validation.valid, opts.verbose);
  }

  // ── Phase 2d: Layer 1 — Procedure Reports (FHIR Procedure) ────────────
  let procedureResult: ProcedureImportResult | undefined;
  if (!opts.layer3Only) {
    console.log('\nPhase 2d: Layer 1 — Structured Procedure Reports...');
    procedureResult = await importProcedureReports(validation.valid, opts.verbose);
  }

  // ── Phase 2e: Layer 1 — Narratives + External ─────────────────────────
  let narrativeResult: NarrativeImportResult | undefined;
  if (!opts.layer3Only) {
    console.log('\nPhase 2e: Layer 1 — Narratives + External Documents...');
    narrativeResult = await importNarrativesAndExternals(validation.valid, opts.verbose);
  }

  // ── Phase 2f: Layer 1 — Medications (extracted from consultations) ──────
  let medsImported = 0;
  let changesImported = 0;
  let adherenceImported = 0;
  if (!opts.dryRun && !opts.layer3Only) {
    console.log('\nPhase 2f: Layer 1 — Medications...');
    const { extractMedications, mentionToMedication, extractMedicationChanges, extractAdherenceMentions } = await import('../src/importers/medication-extractor.js');
    const { getRxnormCode } = await import('../src/importers/rxnorm-normalizer.js');
    const medStore = getClinicalStore();
    const patientId = 'patient-tomasz-szychlinski';

    // Scan consultation + external + procedure documents for medication mentions
    const medSourceTypes = new Set(['consultation', 'external', 'procedure']);
    const allMedFiles = validation.valid.filter(
      (f) => medSourceTypes.has(f.frontmatter.document_type),
    );

    const globalMeds = new Map<string, { med: ReturnType<typeof mentionToMedication>; date: string; confidence: number }>();
    const changesSeen = new Set<string>();

    for (const file of allMedFiles) {
      const fm = file.frontmatter;
      const docId = `src-${fm.document_id}`;
      const docDate = fm.date ?? 'unknown';

      // Extract medication mentions
      const mentions = extractMedications(file.body, docDate);

      for (const mention of mentions) {
        const med = mentionToMedication(mention, patientId, docId, docDate);

        // Normalize key: strip brand parentheticals, lowercase
        const dedupKey = mention.genericName.replace(/\s*\([^)]+\)\s*/g, '').trim().toLowerCase();

        // Keep the highest-confidence version of each medication
        const existing = globalMeds.get(dedupKey);
        if (!existing || mention.confidence > existing.confidence ||
            (mention.confidence === existing.confidence && docDate > existing.date)) {
          // Use the clean generic name for the medication
          med.medicationName = dedupKey;
          globalMeds.set(dedupKey, { med, date: docDate, confidence: mention.confidence });
        }
      }

      // Extract medication change events
      const changes = extractMedicationChanges(file.body);
      for (const change of changes) {
        const changeKey = `${change.medicationName}:${change.changeType}:${change.newValue ?? ''}:${docDate}`;
        if (changesSeen.has(changeKey)) continue;
        changesSeen.add(changeKey);

        await medStore.addMedicationChange({
          id: `mc-${change.medicationName.replace(/\s+/g, '-')}-${change.changeType}-${docId}`,
          patientId,
          medicationName: change.medicationName,
          rxnormCode: change.rxnormCode,
          changeType: change.changeType,
          changeDate: docDate !== 'unknown' ? docDate : undefined,
          previousValue: change.previousValue,
          newValue: change.newValue,
          reason: change.reason,
          sourceDocumentId: docId,
          evidenceTier: 'T1-official',
          validationStatus: 'unvalidated',
          sourceCredibility: 75,
        });
        changesImported++;
      }

      // Extract adherence mentions
      const adherenceMentions = extractAdherenceMentions(file.body);
      for (const adh of adherenceMentions) {
        await medStore.addAdherenceObservation({
          id: `adh-${docId}-${adherenceImported}`,
          patientId,
          medicationName: adh.medicationName ?? 'general',
          rxnormCode: adh.medicationName ? getRxnormCode(adh.medicationName) : undefined,
          observationDate: docDate !== 'unknown' ? docDate : undefined,
          adherenceCode: adh.adherenceCode,
          reporter: adh.reporter,
          notes: adh.notes,
          sourceDocumentId: docId,
          evidenceTier: 'T1-official',
          validationStatus: 'unvalidated',
          sourceCredibility: 70,
        });
        adherenceImported++;
      }
    }

    // Import deduplicated medications
    for (const [, { med }] of globalMeds) {
      // Use stable ID (no source doc suffix) for deduplication
      med.id = `med-${med.medicationName.replace(/\s+/g, '-').toLowerCase()}`;
      await medStore.addMedication(med);
      medsImported++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Import Complete');
  console.log('═══════════════════════════════════════════════════');

  console.log(`  Layer 0 (Source Docs):    ${layer0Result.imported} imported, ${layer0Result.skipped} skipped`);

  if (layer3Result) {
    console.log(`  Semantic Index (Docs):   ${layer3Result.ingested} ingested, ${layer3Result.skipped} skipped, ${layer3Result.errors} errors`);
    console.log(`                           ${layer3Result.totalChunks} total chunks embedded`);
  }

  if (layer2Result) {
    console.log(`  Layer 1 (Lab Results):    ${layer2Result.labsInserted} values from ${layer2Result.filesProcessed} files`);
  }

  if (consultResult) {
    console.log(`  Layer 1 (Consultations):  ${consultResult.imported} imported, ${consultResult.skipped} skipped`);
  }

  if (imagingResult) {
    console.log(`  Layer 1 (Imaging):        ${imagingResult.imported} imported, ${imagingResult.skipped} skipped`);
  }

  if (procedureResult) {
    console.log(`  Layer 1 (Procedures):     ${procedureResult.imported} imported, ${procedureResult.skipped} skipped`);
  }

  if (narrativeResult) {
    console.log(`  Layer 1 (Narrative/Ext):  ${narrativeResult.imported} imported, ${narrativeResult.skipped} skipped`);
  }

  if (medsImported > 0) {
    console.log(`  Layer 1 (Medications):    ${medsImported} medications with RxNorm codes`);
    if (changesImported > 0) {
      console.log(`  Layer 1 (Med Changes):    ${changesImported} medication change events`);
    }
    if (adherenceImported > 0) {
      console.log(`  Layer 1 (Adherence):      ${adherenceImported} adherence observations`);
    }
  }

  console.log(`  Time: ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Coverage Report (v3.0.0) ──────────────────────────────────────────
  if (!opts.layer3Only) {
    const coverageStore = getClinicalStore();
    const patientId = 'patient-tomasz-szychlinski';
    try {
      const labs = await coverageStore.queryLabs({ patientId });
      const consults = await coverageStore.queryConsultations({ patientId });
      const imaging = await coverageStore.getImagingReports(patientId);

      const labsWithLoinc = labs.filter((l) => l.loincCode).length;
      const labsWithSnomed = labs.filter((l) => l.valueSnomedCode).length;
      const consultsWithSpecSnomed = consults.filter((c) => c.snomedSpecialtyCode).length;
      const consultsWithFinding = consults.filter((c) => c.snomedFindingCode).length;
      const consultsWithIcd10 = consults.filter((c) => (c as Record<string, unknown>)['icd10Code']).length;
      const imagingWithLoinc = imaging.filter((i) => i.loincStudyCode).length;
      const imagingWithBodySite = imaging.filter((i) => i.bodySiteSnomedCode).length;

      const pct = (n: number, d: number): string =>
        d > 0 ? `${n}/${d} (${((n / d) * 100).toFixed(1)}%)` : '0/0';

      console.log('═══════════════════════════════════════════════════');
      console.log('  Terminology Coverage Report');
      console.log('═══════════════════════════════════════════════════');
      console.log(`  LOINC (labs):          ${pct(labsWithLoinc, labs.length)}`);
      console.log(`  SNOMED value (labs):   ${pct(labsWithSnomed, labs.length)}`);
      console.log(`  SNOMED specialty:      ${pct(consultsWithSpecSnomed, consults.length)}`);
      console.log(`  SNOMED finding:        ${pct(consultsWithFinding, consults.length)}`);
      console.log(`  ICD-10 (consult):      ${pct(consultsWithIcd10, consults.length)}`);
      console.log(`  Imaging LOINC:         ${pct(imagingWithLoinc, imaging.length)}`);
      console.log(`  Body site SNOMED:      ${pct(imagingWithBodySite, imaging.length)}`);
      console.log('═══════════════════════════════════════════════════\n');
    } catch {
      console.log('  (Coverage report skipped — query error)\n');
    }
  }

  const hasErrors = (layer3Result?.errors ?? 0) > 0 || (validation.errors.length > 0 && !opts.continueOnError);
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
