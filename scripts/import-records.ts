/**
 * Import medical-records markdown files into Asklepios.
 *
 * Phase 0: Validate all files (fail-early — no DB writes until everything passes)
 * Phase 1: Layer 3 — Document Knowledge Base (semantic search via embeddings)
 * Phase 2: Layer 2 — Structured Lab Results (queryable clinical data)
 *
 * Usage:
 *   npx tsx scripts/import-records.ts <records-dir> [options]
 *
 * Options:
 *   --dry-run            Validate only, don't write to DB
 *   --layer3-only        Skip Layer 2 structured records
 *   --layer2-only        Skip Layer 3 document ingestion
 *   --verbose            Print each file as it's processed
 *   --continue-on-error  Don't abort on validation errors (import valid files only)
 */

import type { LabResult } from '../src/schemas/clinical-record.js';
import type { DocumentType } from '../src/knowledge/document-store.js';
import type { ParsedRecord } from '../src/importers/parser.js';
import type { RecordFrontmatter, StructuredLabValue } from '../src/importers/schemas.js';
import { discoverRecordFiles, parseRecordFile, stripFrontmatter } from '../src/importers/parser.js';
import { normalizeLabValue } from '../src/importers/normalizer.js';
import { documentTypeMapping } from '../src/importers/schemas.js';
import { getClinicalStore } from '../src/storage/clinical-store.js';
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
}

function parseArgs(): ImportOptions {
  const args = process.argv.slice(2);
  const recordsDir = args.find((a) => !a.startsWith('--'));

  if (!recordsDir) {
    console.error('Usage: npx tsx scripts/import-records.ts <records-dir> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --dry-run            Validate only, don\'t write to DB');
    console.error('  --layer3-only        Skip Layer 2 structured records');
    console.error('  --layer2-only        Skip Layer 3 document ingestion');
    console.error('  --verbose            Print each file as it\'s processed');
    console.error('  --continue-on-error  Import valid files even if some fail validation');
    process.exit(1);
  }

  return {
    recordsDir,
    dryRun: args.includes('--dry-run'),
    layer3Only: args.includes('--layer3-only'),
    layer2Only: args.includes('--layer2-only'),
    verbose: args.includes('--verbose'),
    continueOnError: args.includes('--continue-on-error'),
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

// ─── Phase 1: Layer 3 — Document Knowledge Base ──────────────────────────

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
    console.error('Layer 3 import requires OPENAI_API_KEY for embeddings.');
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
            `  L3  ${fm.document_id} → ${ingestion.chunkCount} chunks`,
          );
        }
      } catch (err) {
        result.errors++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ERR  L3 ${fm.document_id}: ${message}`);
      }
    }

    // Rate limit pause between batches (OpenAI embeddings)
    if (i + batchSize < records.length) {
      await sleep(1000);
    }
  }

  return result;
}

// ─── Phase 2: Layer 2 — Structured Lab Results ───────────────────────────

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
        `  L2  ${record.frontmatter.document_id} → ${labs.length} lab values`,
      );
    }
  }

  if (allLabs.length > 0) {
    const batchResult = await store.addLabResultsBatch(allLabs);
    result.labsInserted = batchResult.inserted;
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
  if (opts.layer3Only) console.log('  Mode: Layer 3 only');
  if (opts.layer2Only) console.log('  Mode: Layer 2 only');
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

  if (opts.dryRun) {
    console.log('\nDry run complete — no data was written.');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Time: ${elapsed}s\n`);
    process.exit(0);
  }

  // ── Phase 1: Layer 3 ───────────────────────────────────────────────────
  let layer3Result: Layer3Result | undefined;
  if (!opts.layer2Only) {
    console.log('\nPhase 1: Layer 3 — Document Knowledge Base...');
    layer3Result = await importLayer3(validation.valid, opts.verbose);
  }

  // ── Phase 2: Layer 2 ───────────────────────────────────────────────────
  let layer2Result: Layer2Result | undefined;
  if (!opts.layer3Only) {
    console.log('\nPhase 2: Layer 2 — Structured Lab Results...');
    layer2Result = await importLayer2(validation.valid, opts.verbose);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Import Complete');
  console.log('═══════════════════════════════════════════════════');

  if (layer3Result) {
    console.log(`  Layer 3 (Documents):   ${layer3Result.ingested} ingested, ${layer3Result.skipped} skipped, ${layer3Result.errors} errors`);
    console.log(`                         ${layer3Result.totalChunks} total chunks embedded`);
  }

  if (layer2Result) {
    console.log(`  Layer 2 (Lab Results): ${layer2Result.labsInserted} values inserted from ${layer2Result.filesProcessed} files`);
  }

  console.log(`  Time: ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════\n');

  const hasErrors = (layer3Result?.errors ?? 0) > 0 || (validation.errors.length > 0 && !opts.continueOnError);
  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
