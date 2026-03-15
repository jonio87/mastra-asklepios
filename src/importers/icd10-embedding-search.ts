/**
 * ICD-10 Embedding Search — semantic fallback for diagnosis codes.
 *
 * Uses pre-computed embeddings from data/terminology/icd10-embeddings.json.gz
 * to find the closest ICD-10 code for a condition name via cosine similarity.
 *
 * Threshold: 0.90
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
    'icd10-embeddings.json.gz',
  );
} catch {
  EMBEDDINGS_PATH = join(process.cwd(), 'data', 'terminology', 'icd10-embeddings.json.gz');
}

const instance = new TerminologyEmbeddingSearch('icd10', EMBEDDINGS_PATH, 0.9);

export async function initIcd10EmbeddingSearch(): Promise<void> {
  await instance.init();
}

export async function searchIcd10ByEmbedding(term: string): Promise<EmbeddingMatch | undefined> {
  return instance.search(term);
}

export function isIcd10EmbeddingSearchReady(): boolean {
  return instance.isReady();
}
