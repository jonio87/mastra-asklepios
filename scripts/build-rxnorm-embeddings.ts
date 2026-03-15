#!/usr/bin/env npx tsx
/**
 * Build RxNorm Embedding Index
 *
 * Pre-computes embeddings for RxNorm medication names using OpenAI
 * text-embedding-3-small (1536 dimensions). Output is a gzipped JSON file
 * used at runtime by rxnorm-embedding-search.ts for semantic fallback matching.
 *
 * Embeds both generic names (from rxnorm-code-map.json) and brand names
 * (from brand-to-generic.json) to maximize recall.
 *
 * Usage:  npx tsx scripts/build-rxnorm-embeddings.ts
 * Source: data/terminology/rxnorm-code-map.json + data/terminology/brand-to-generic.json
 * Output: data/terminology/rxnorm-embeddings.json.gz
 *
 * Requires: OPENAI_API_KEY environment variable
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DATA_DIR = join(import.meta.dirname!, '..', 'data', 'terminology');
const RXNORM_SOURCE = join(DATA_DIR, 'rxnorm-code-map.json');
const BRAND_SOURCE = join(DATA_DIR, 'brand-to-generic.json');
const OUTPUT = join(DATA_DIR, 'rxnorm-embeddings.json.gz');
const BATCH_SIZE = 100;
const MODEL = 'text-embedding-3-small';
const SYSTEM_URI = 'http://www.nlm.nih.gov/research/umls/rxnorm';

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

  console.log('Loading rxnorm-code-map.json...');
  const rxnormRaw = readFileSync(RXNORM_SOURCE, 'utf-8');
  const rxnormMap = JSON.parse(rxnormRaw) as Record<string, string>;

  console.log('Loading brand-to-generic.json...');
  const brandRaw = readFileSync(BRAND_SOURCE, 'utf-8');
  const brandMap = JSON.parse(brandRaw) as Record<string, string>;

  // Build entries: generic names first, then brand names with resolved RxNorm codes
  const entries: Array<{ code: string; display: string }> = [];
  const seen = new Set<string>();

  // Generic names → RxNorm CUIs
  for (const [genericName, code] of Object.entries(rxnormMap)) {
    const key = `${code}:${genericName.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push({ code, display: genericName });
    }
  }

  // Brand names → resolve to generic → RxNorm CUI
  for (const [brandName, genericName] of Object.entries(brandMap)) {
    const code = rxnormMap[genericName];
    if (code) {
      const key = `${code}:${brandName.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ code, display: brandName });
      }
    }
  }

  console.log(`  ${entries.length} entries (generic + brand names)`);

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
