/**
 * Ingest 23andMe Genome Data into Genetic Variants Table
 *
 * Parses a 23andMe raw genotype file (~638K SNPs) and persists
 * to the genetic_variants table with deduplication by (patient_id, rsid).
 *
 * Usage:
 *   npx tsx scripts/ingest-genome.ts <genome-file-path> [options]
 *
 * Options:
 *   --patient-id <id>    Patient ID (default: patient-tomasz-szychlinski)
 *   --dry-run            Parse and validate without inserting
 *   --verbose            Print progress every 10K variants
 *   --copy-to <dir>      Copy source file to archive directory
 *   --batch-size <n>     Batch size for inserts (default: 1000)
 */

import { copyFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ClinicalStore } from '../src/storage/clinical-store.js';
import {
  parseGenomeFile,
  parseGenomeMetadata,
} from '../src/importers/genome-parser.js';
import type { GeneticVariant } from '../src/schemas/genetic-variant.js';

// ─── CLI Argument Parsing ────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));

  if (!filePath) {
    console.error('Usage: npx tsx scripts/ingest-genome.ts <genome-file-path> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --patient-id <id>    Patient ID (default: patient-tomasz-szychlinski)');
    console.error('  --dry-run            Parse and validate without inserting');
    console.error('  --verbose            Print progress every 10K variants');
    console.error('  --copy-to <dir>      Copy source file to archive directory');
    console.error('  --batch-size <n>     Batch size for inserts (default: 1000)');
    process.exit(1);
  }

  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  return {
    filePath,
    patientId: getArg('--patient-id') ?? 'patient-tomasz-szychlinski',
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    copyTo: getArg('--copy-to'),
    batchSize: parseInt(getArg('--batch-size') ?? '1000', 10),
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  if (!existsSync(opts.filePath)) {
    console.error(`File not found: ${opts.filePath}`);
    process.exit(1);
  }

  console.log('=== 23andMe Genome Import ===\n');
  console.log(`  File:       ${opts.filePath}`);
  console.log(`  Patient:    ${opts.patientId}`);
  console.log(`  Batch size: ${opts.batchSize}`);
  console.log(`  Dry run:    ${opts.dryRun}`);
  console.log('');

  // 1. Parse metadata
  const metadata = await parseGenomeMetadata(opts.filePath);
  console.log('File Metadata:');
  console.log(`  Source:      ${metadata.source}`);
  console.log(`  Version:     ${metadata.sourceVersion ?? 'unknown'}`);
  console.log(`  Build:       ${metadata.referenceGenome}`);
  console.log(`  Generated:   ${metadata.generationDate ?? 'unknown'}`);
  console.log('');

  // 2. Stream-parse and batch-insert
  const store = opts.dryRun ? undefined : new ClinicalStore();
  if (store) await store.ensureInitialized();

  let totalParsed = 0;
  let totalInserted = 0;
  let totalDuplicates = 0;
  let totalNoCalls = 0;
  let batch: GeneticVariant[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;
    if (store) {
      const result = await store.addGeneticVariantsBatch(batch);
      totalInserted += result.inserted;
      totalDuplicates += result.duplicates;
    }
    batch = [];
  };

  for await (const variant of parseGenomeFile(opts.filePath, opts.patientId)) {
    totalParsed++;

    if (variant.genotype === '--') {
      totalNoCalls++;
    }

    batch.push(variant);

    if (batch.length >= opts.batchSize) {
      await flushBatch();
    }

    if (opts.verbose && totalParsed % 10000 === 0) {
      console.log(`  Progress: ${totalParsed.toLocaleString()} variants parsed...`);
    }
  }

  // Flush remaining
  await flushBatch();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('=== Import Summary ===\n');
  console.log(`  Total parsed:     ${totalParsed.toLocaleString()}`);
  if (!opts.dryRun) {
    console.log(`  Inserted:         ${totalInserted.toLocaleString()}`);
    console.log(`  Duplicates:       ${totalDuplicates.toLocaleString()}`);
  }
  console.log(`  No-call (--):     ${totalNoCalls.toLocaleString()}`);
  console.log(`  Time:             ${elapsed}s`);

  // 3. Verify count
  if (store) {
    const count = await store.countGeneticVariants(opts.patientId);
    console.log(`  DB total:         ${count.toLocaleString()}`);
  }

  // 4. Copy source file to archive
  if (opts.copyTo) {
    const destDir = opts.copyTo;
    const destName = `23andme_${metadata.sourceVersion ?? 'raw'}_full_${metadata.generationDate?.replace(/-/g, '') ?? 'unknown'}.txt`;
    const destPath = join(destDir, destName);

    if (existsSync(destPath)) {
      console.log(`\n  Archive:          ${destPath} (already exists, skipping)`);
    } else {
      copyFileSync(opts.filePath, destPath);
      console.log(`\n  Archived to:      ${destPath}`);
    }
  }

  if (store) await store.close();

  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
