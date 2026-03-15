#!/usr/bin/env npx tsx
/**
 * Build ICD-10 Embedding Index
 *
 * Pre-computes embeddings for ICD-10 diagnosis codes using OpenAI
 * text-embedding-3-small (1536 dimensions). Output is a gzipped JSON file
 * used at runtime by icd10-embedding-search.ts for semantic fallback matching.
 *
 * Usage:  npx tsx scripts/build-icd10-embeddings.ts
 * Source: data/terminology/icd10-code-map.json (display name → ICD-10 code)
 * Output: data/terminology/icd10-embeddings.json.gz
 *
 * Requires: OPENAI_API_KEY environment variable
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const SOURCE = join(import.meta.dirname!, '..', 'data', 'terminology', 'icd10-code-map.json');
const OUTPUT = join(import.meta.dirname!, '..', 'data', 'terminology', 'icd10-embeddings.json.gz');
const BATCH_SIZE = 100;
const MODEL = 'text-embedding-3-small';
const SYSTEM_URI = 'http://hl7.org/fhir/sid/icd-10';

interface TerminologyEmbeddingEntry {
  code: string;
  display: string;
  system: string;
  embedding: number[];
}

// ── Embedding via OpenAI ────────────────────────────────────────────────

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    console.error('OPENAI_API_KEY environment variable required');
    process.exit(1);
  }

  console.log('Loading icd10-code-map.json...');
  const raw = readFileSync(SOURCE, 'utf-8');
  const codeMap = JSON.parse(raw) as Record<string, string>;

  const entries = Object.entries(codeMap).map(([display, code]) => ({
    code,
    display,
  }));
  console.log(`  ${entries.length} entries loaded`);

  console.log(`Embedding ${entries.length} entries in batches of ${BATCH_SIZE}...`);

  const result: TerminologyEmbeddingEntry[] = [];
  let processed = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const texts = batch.map((e) => e.display);
    const embeddings = await embedBatch(texts, apiKey);

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j]!;
      result.push({
        code: entry.code,
        display: entry.display,
        system: SYSTEM_URI,
        embedding: embeddings[j]!,
      });
    }

    processed += batch.length;
    if (processed % 500 === 0 || processed === entries.length) {
      console.log(`  ${processed}/${entries.length} embedded`);
    }

    if (i + BATCH_SIZE < entries.length) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  console.log(`Writing ${OUTPUT}...`);
  const chunks: Buffer[] = [];
  chunks.push(Buffer.from('['));
  for (let i = 0; i < result.length; i++) {
    if (i > 0) chunks.push(Buffer.from(','));
    chunks.push(Buffer.from(JSON.stringify(result[i])));
  }
  chunks.push(Buffer.from(']'));
  const json = Buffer.concat(chunks);
  const compressed = gzipSync(json);
  writeFileSync(OUTPUT, compressed);

  const sizeMB = (compressed.length / 1024 / 1024).toFixed(1);
  console.log(`Done: ${result.length} entries, ${sizeMB}MB compressed`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
