/**
 * RxNorm Embedding Search — semantic fallback for medication codes.
 *
 * Uses pre-computed embeddings from data/terminology/rxnorm-embeddings.json.gz
 * to find the closest RxNorm CUI for a medication name via cosine similarity.
 *
 * Threshold: 0.93 (higher than SNOMED/ICD-10 — medication names are
 * more specific and less synonym-prone).
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
    'rxnorm-embeddings.json.gz',
  );
} catch {
  EMBEDDINGS_PATH = join(process.cwd(), 'data', 'terminology', 'rxnorm-embeddings.json.gz');
}

const instance = new TerminologyEmbeddingSearch('rxnorm', EMBEDDINGS_PATH, 0.93);

export async function initRxnormEmbeddingSearch(): Promise<void> {
  await instance.init();
}

export async function searchRxnormByEmbedding(term: string): Promise<EmbeddingMatch | undefined> {
  return instance.search(term);
}

export function isRxnormEmbeddingSearchReady(): boolean {
  return instance.isReady();
}
