/**
 * SNOMED CT Embedding Search — semantic fallback for clinical finding codes.
 *
 * Uses pre-computed embeddings from data/terminology/snomed-embeddings.json.gz
 * to find the closest SNOMED CT concept for a finding name via cosine similarity.
 *
 * Threshold: 0.90 (slightly lower than LOINC's 0.92 — clinical findings
 * have more synonymy and varied phrasing).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmbeddingMatch } from './terminology-embedding-search.js';
import { TerminologyEmbeddingSearch } from './terminology-embedding-search.js';

let EMBEDDINGS_PATH: string;
try {
  const thisFile = fileURLToPath(import.meta.url);
  EMBEDDINGS_PATH = join(
    dirname(thisFile),
    '..',
    '..',
    'data',
    'terminology',
    'snomed-embeddings.json.gz',
  );
} catch {
  EMBEDDINGS_PATH = join(process.cwd(), 'data', 'terminology', 'snomed-embeddings.json.gz');
}

const instance = new TerminologyEmbeddingSearch('snomed', EMBEDDINGS_PATH, 0.9);

export async function initSnomedEmbeddingSearch(): Promise<void> {
  await instance.init();
}

export async function searchSnomedByEmbedding(term: string): Promise<EmbeddingMatch | undefined> {
  return instance.search(term);
}

export function isSnomedEmbeddingSearchReady(): boolean {
  return instance.isReady();
}
