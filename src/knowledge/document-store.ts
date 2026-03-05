import type { MastraVector } from '@mastra/core/vector';
import { MDocument } from '@mastra/rag';
import { logger } from '../utils/logger.js';

/**
 * DocumentStore — Layer 3 document knowledge base.
 *
 * Handles document ingestion (chunk → embed → store) and semantic search.
 * Uses MDocument from @mastra/rag for chunking strategies and LibSQLVector
 * for storage/retrieval. Metadata filtering enables per-patient isolation.
 *
 * Chunking strategies per document type:
 * - clinical-note: markdown chunking (preserves headers/sections)
 * - lab-report: recursive chunking (structured by panel)
 * - imaging-report: recursive chunking (by study/finding)
 * - research-paper: recursive chunking (by section)
 * - consultation-letter: markdown chunking (by specialist)
 */

export type DocumentType =
  | 'clinical-note'
  | 'lab-report'
  | 'imaging-report'
  | 'research-paper'
  | 'consultation-letter'
  | 'other';

export interface DocumentMetadata {
  patientId: string;
  documentType: DocumentType;
  date?: string;
  source?: string;
  title?: string;
}

export interface DocumentChunk {
  text: string;
  metadata: DocumentMetadata & { chunkIndex: number };
  score?: number;
}

const INDEX_NAME = 'asklepios-documents';
const EMBEDDING_DIMENSION = 1536; // text-embedding-3-small

export class DocumentStore {
  private vector: MastraVector;
  private embedder: ((texts: string[]) => Promise<number[][]>) | null;
  private initialized = false;

  constructor(vector: MastraVector, embedder: ((texts: string[]) => Promise<number[][]>) | null) {
    this.vector = vector;
    this.embedder = embedder;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const indexes = await this.vector.listIndexes();
    if (!indexes.includes(INDEX_NAME)) {
      await this.vector.createIndex({
        indexName: INDEX_NAME,
        dimension: EMBEDDING_DIMENSION,
        metric: 'cosine',
      });
      logger.info('Created document vector index', { indexName: INDEX_NAME });
    }
    this.initialized = true;
  }

  async ingestDocument(
    text: string,
    metadata: DocumentMetadata,
  ): Promise<{ chunkCount: number; ids: string[] }> {
    if (!this.embedder) {
      throw new Error('Embedder required for document ingestion. Set OPENAI_API_KEY.');
    }

    await this.ensureInitialized();

    const doc = MDocument.fromMarkdown(text, {
      patientId: metadata.patientId,
      documentType: metadata.documentType,
      date: metadata.date ?? '',
      source: metadata.source ?? '',
      title: metadata.title ?? '',
    });

    // Choose chunking strategy based on document type
    const chunks = await chunkByType(doc, metadata.documentType);
    if (chunks.length === 0) {
      return { chunkCount: 0, ids: [] };
    }

    const texts = chunks.map((c) => c.text);
    const embeddings = await this.embedder(texts);

    const ids = chunks.map((_, i) => `doc-${metadata.patientId}-${Date.now()}-${i}`);

    const metadataArray = chunks.map((c, i) => ({
      ...metadata,
      chunkIndex: i,
      chunkText: c.text.slice(0, 200), // Preview for debugging
      ...(c.metadata || {}),
    }));

    await this.vector.upsert({
      indexName: INDEX_NAME,
      vectors: embeddings,
      metadata: metadataArray,
      ids,
    });

    logger.info('Ingested document', {
      type: metadata.documentType,
      chunks: chunks.length,
      patientId: metadata.patientId,
    });

    return { chunkCount: chunks.length, ids };
  }

  async queryDocuments(
    queryText: string,
    params: {
      patientId: string;
      documentType?: DocumentType;
      topK?: number;
    },
  ): Promise<DocumentChunk[]> {
    if (!this.embedder) {
      return [];
    }

    await this.ensureInitialized();

    const embeddings = await this.embedder([queryText]);
    const queryVector = embeddings[0];
    if (!queryVector) return [];

    // LibSQLVector uses MongoDB-like filters with $eq operator
    // biome-ignore lint/style/useNamingConvention: MongoDB filter syntax requires $eq operator
    const filter: Record<string, unknown> = { patientId: { $eq: params.patientId } };
    if (params.documentType) {
      // biome-ignore lint/style/useNamingConvention: MongoDB filter syntax requires $eq operator
      filter['documentType'] = { $eq: params.documentType };
    }

    const results = await this.vector.query({
      indexName: INDEX_NAME,
      queryVector,
      topK: params.topK ?? 5,
      filter: filter as Parameters<typeof this.vector.query>[0]['filter'],
      includeVector: false,
    });

    return results.map((r) => {
      const meta: DocumentMetadata & { chunkIndex: number } = {
        patientId: String(r.metadata?.['patientId'] ?? ''),
        documentType: String(r.metadata?.['documentType'] ?? 'other') as DocumentType,
        chunkIndex: Number(r.metadata?.['chunkIndex'] ?? 0),
      };
      const dateVal = r.metadata?.['date'];
      if (dateVal) meta.date = String(dateVal);
      const sourceVal = r.metadata?.['source'];
      if (sourceVal) meta.source = String(sourceVal);
      const titleVal = r.metadata?.['title'];
      if (titleVal) meta.title = String(titleVal);

      const chunk: DocumentChunk = {
        text: String(r.metadata?.['chunkText'] ?? ''),
        metadata: meta,
      };
      if (r.score !== undefined) chunk.score = r.score;
      return chunk;
    });
  }
}

// ─── Chunking Strategies ──────────────────────────────────────────────────

async function chunkByType(
  doc: MDocument,
  documentType: DocumentType,
): Promise<Array<{ text: string; metadata?: Record<string, unknown> }>> {
  switch (documentType) {
    case 'clinical-note':
    case 'consultation-letter':
      await doc.chunkMarkdown({ maxSize: 1000, overlap: 100 });
      break;
    case 'lab-report':
    case 'imaging-report':
      await doc.chunkRecursive({ maxSize: 500, overlap: 50 });
      break;
    case 'research-paper':
      await doc.chunkRecursive({ maxSize: 1500, overlap: 200 });
      break;
    default:
      await doc.chunkRecursive({ maxSize: 1000, overlap: 100 });
      break;
  }

  const chunks = doc.getDocs();
  return chunks.map((c) => ({
    text: c.getContent(),
    metadata: c.metadata as Record<string, unknown>,
  }));
}

// ─── Singleton ──────────────────────────────────────────────────────────

let Instance: DocumentStore | undefined;

export function getDocumentStore(
  vector: MastraVector,
  embedder: ((texts: string[]) => Promise<number[][]>) | null,
): DocumentStore {
  if (!Instance) {
    Instance = new DocumentStore(vector, embedder);
  }
  return Instance;
}
