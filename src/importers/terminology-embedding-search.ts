/**
 * Generic Terminology Embedding Search — shared infrastructure for
 * SNOMED, ICD-10, RxNorm embedding searches.
 *
 * Follows the same pattern as loinc-embedding-search.ts but extracted
 * into a reusable class to avoid code duplication.
 *
 * Each terminology system provides pre-computed embeddings in a gzipped
 * JSON file. At query time, the search term is embedded via OpenAI and
 * compared against the pre-computed matrix using cosine similarity.
 */

import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createEmbedder } from '../utils/embedder.js';
import { logger } from '../utils/logger.js';

export interface TerminologyEntry {
  code: string;
  display: string;
  system: string;
  embedding: number[];
}

export interface EmbeddingMatch {
  code: string;
  display: string;
  system: string;
  similarity: number;
}

// ── Cosine similarity (shared) ────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Streaming JSON parser ─────────────────────────────────────────────

/** Mutable parser state for streaming JSON boundary detection. */
interface JsonParserState {
  depth: number;
  objStart: number;
  inString: boolean;
  escaped: boolean;
}

/** Process a single byte in the streaming JSON parser. Returns an object start/end range or null. */
function processJsonByte(
  byte: number,
  pos: number,
  state: JsonParserState,
): { start: number; end: number } | null {
  if (state.escaped) {
    state.escaped = false;
    return null;
  }
  if (byte === 0x5c /* \\ */ && state.inString) {
    state.escaped = true;
    return null;
  }
  if (byte === 0x22 /* " */) {
    state.inString = !state.inString;
    return null;
  }
  if (state.inString) return null;

  if (byte === 0x7b /* { */) {
    if (state.depth === 0) state.objStart = pos;
    state.depth++;
  } else if (byte === 0x7d /* } */) {
    state.depth--;
    if (state.depth === 0 && state.objStart >= 0) {
      const range = { start: state.objStart, end: pos + 1 };
      state.objStart = -1;
      return range;
    }
  }
  return null;
}

/**
 * Parse a JSON array of objects by splitting at top-level object
 * boundaries. Avoids V8 string length limit for large datasets.
 */
function parseStreamingJsonArray<T>(decompressed: Buffer): T[] {
  const results: T[] = [];
  const state: JsonParserState = { depth: 0, objStart: -1, inString: false, escaped: false };

  for (let i = 0; i < decompressed.length; i++) {
    const byte = decompressed[i] ?? 0;
    const range = processJsonByte(byte, i, state);
    if (range) {
      const slice = decompressed.subarray(range.start, range.end).toString('utf-8');
      results.push(JSON.parse(slice) as T);
    }
  }

  return results;
}

// ── Class ─────────────────────────────────────────────────────────────

export class TerminologyEmbeddingSearch {
  private entries: TerminologyEntry[] | null = null;
  private embeddingMatrix: Float32Array[] | null = null;
  private embedFn: ((texts: string[]) => Promise<number[][]>) | null = null;
  private initialized = false;

  constructor(
    private readonly name: string,
    private readonly embeddingsPath: string,
    private readonly threshold: number,
  ) {}

  /**
   * Load pre-computed embeddings into memory and prepare the embedder.
   * No-op after first call. Gracefully skips if embeddings file missing
   * or OPENAI_API_KEY is not set.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    if (!existsSync(this.embeddingsPath)) {
      logger.warn(
        `[${this.name}-embedding-search] Embeddings file not found: ${this.embeddingsPath}`,
      );
      return;
    }

    this.embedFn = createEmbedder();
    if (!this.embedFn) {
      logger.warn(`[${this.name}-embedding-search] No OPENAI_API_KEY — embedding search disabled`);
      return;
    }

    const compressed = readFileSync(this.embeddingsPath);
    const decompressed = gunzipSync(compressed);

    this.entries = parseStreamingJsonArray<TerminologyEntry>(decompressed);
    this.embeddingMatrix = this.entries.map((e) => new Float32Array(e.embedding));

    logger.info(`[${this.name}-embedding-search] Loaded ${this.entries.length} embeddings`);
  }

  /**
   * Search for the closest terminology code using semantic embedding similarity.
   * Returns the best match if above the configured threshold, otherwise undefined.
   */
  async search(term: string): Promise<EmbeddingMatch | undefined> {
    if (!(this.entries && this.embeddingMatrix && this.embedFn)) return undefined;

    const [queryVec] = await this.embedFn([term]);
    if (!queryVec) return undefined;

    const queryFloat = new Float32Array(queryVec);

    let bestIdx = -1;
    let bestSim = -1;

    for (let i = 0; i < this.embeddingMatrix.length; i++) {
      const row = this.embeddingMatrix[i];
      if (!row) continue;
      const sim = cosineSimilarity(queryFloat, row);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx < 0 || bestSim < this.threshold) return undefined;

    const match = this.entries[bestIdx];
    if (!match) return undefined;
    return {
      code: match.code,
      display: match.display,
      system: match.system,
      similarity: bestSim,
    };
  }

  /**
   * Synchronous check: are embeddings loaded and ready for search?
   */
  isReady(): boolean {
    return this.entries !== null && this.embeddingMatrix !== null && this.embedFn !== null;
  }
}
