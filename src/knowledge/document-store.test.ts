/**
 * DocumentStore tests — mock @mastra/rag and @mastra/core to avoid
 * the ESM/CJS incompatibility with execa in Jest.
 */

// Mock @mastra/rag before imports
jest.mock('@mastra/rag', () => ({
  // biome-ignore lint/style/useNamingConvention: external API class name
  MDocument: {
    fromMarkdown: jest.fn((_text: string, _metadata: Record<string, unknown>) => {
      const chunks: Array<{ text: string; metadata: Record<string, unknown> }> = [];
      return {
        chunkMarkdown: jest.fn(async () => {
          chunks.push(
            { text: 'chunk 1 text', metadata: {} },
            { text: 'chunk 2 text', metadata: {} },
          );
        }),
        chunkRecursive: jest.fn(async () => {
          chunks.push(
            { text: 'chunk 1 text', metadata: {} },
            { text: 'chunk 2 text', metadata: {} },
          );
        }),
        getDocs: jest.fn(() =>
          chunks.map((c) => ({
            getContent: () => c.text,
            metadata: c.metadata,
          })),
        ),
      };
    }),
  },
}));

// Mock logger to prevent console output
jest.mock('../utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import type { DocumentMetadata } from './document-store.js';
import { DocumentStore } from './document-store.js';

interface StoredEntry {
  indexName: string;
  vectors: number[][];
  metadata: Record<string, unknown>[];
  ids: string[];
}

function createMockVector() {
  const stored: StoredEntry[] = [];

  return {
    listIndexes: jest.fn(async () => ['asklepios-documents']),
    createIndex: jest.fn(async () => undefined),
    upsert: jest.fn(async (params: StoredEntry) => {
      stored.push(params);
      return [];
    }),
    query: jest.fn(async (params: { topK: number }) => {
      const all = stored.flatMap((s) =>
        s.ids.map((id, i) => ({
          id,
          score: 0.95 - i * 0.05,
          metadata: s.metadata[i] ?? {},
        })),
      );
      return all.slice(0, params.topK);
    }),
    deleteIndex: jest.fn(async () => undefined),
    describeIndex: jest.fn(async () => ({ dimension: 1536, metric: 'cosine' as const, count: 0 })),
    stored,
  };
}

function createMockEmbedder() {
  return async (texts: string[]): Promise<number[][]> => {
    return texts.map(() => new Array(1536).fill(0).map(() => Math.random()));
  };
}

describe('DocumentStore', () => {
  it('ingests a document and returns chunk count', async () => {
    const vector = createMockVector();
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      createMockEmbedder(),
    );

    const metadata: DocumentMetadata = {
      patientId: 'patient-001',
      documentType: 'clinical-note',
      date: '2025-09-01',
      source: 'Diagnostyka',
      title: 'Neurology consultation',
    };

    const result = await store.ingestDocument(
      '# Test clinical note\n\nSome content here.',
      metadata,
    );
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.ids.length).toBe(result.chunkCount);
  });

  it('throws when embedder is null', async () => {
    const vector = createMockVector();
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      null,
    );

    await expect(
      store.ingestDocument('test', { patientId: 'p1', documentType: 'other' }),
    ).rejects.toThrow('Embedder required');
  });

  it('returns empty results when embedder is null for queries', async () => {
    const vector = createMockVector();
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      null,
    );

    const results = await store.queryDocuments('test query', { patientId: 'p1' });
    expect(results).toEqual([]);
  });

  it('queries documents and returns results', async () => {
    const vector = createMockVector();
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      createMockEmbedder(),
    );

    await store.ingestDocument('Test content for patient.', {
      patientId: 'patient-001',
      documentType: 'clinical-note',
    });

    const results = await store.queryDocuments('clinical note', {
      patientId: 'patient-001',
      topK: 3,
    });

    expect(results.length).toBeGreaterThan(0);
  });

  it('creates index when not present', async () => {
    const vector = createMockVector();
    vector.listIndexes = jest.fn(async () => []);
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      createMockEmbedder(),
    );

    await store.ingestDocument('Test content', { patientId: 'p1', documentType: 'other' });
    expect(vector.createIndex).toHaveBeenCalledWith({
      indexName: 'asklepios-documents',
      dimension: 1536,
      metric: 'cosine',
    });
  });

  it('calls upsert with correct number of embeddings', async () => {
    const vector = createMockVector();
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      createMockEmbedder(),
    );

    await store.ingestDocument('Test', { patientId: 'p1', documentType: 'lab-report' });

    expect(vector.upsert).toHaveBeenCalled();
    const upsertCall = (vector.upsert as jest.Mock).mock.calls[0][0] as StoredEntry;
    expect(upsertCall.vectors.length).toBe(upsertCall.ids.length);
    expect(upsertCall.metadata.length).toBe(upsertCall.ids.length);
  });

  it('filters queries by document type', async () => {
    const vector = createMockVector();
    const store = new DocumentStore(
      vector as unknown as ConstructorParameters<typeof DocumentStore>[0],
      createMockEmbedder(),
    );

    await store.ingestDocument('Test', { patientId: 'p1', documentType: 'imaging-report' });

    await store.queryDocuments('imaging findings', {
      patientId: 'p1',
      documentType: 'imaging-report',
      topK: 5,
    });

    const queryCall = (vector.query as jest.Mock).mock.calls[0][0];
    expect(queryCall.filter).toEqual({
      // biome-ignore lint/style/useNamingConvention: MongoDB $eq operator
      patientId: { $eq: 'p1' },
      // biome-ignore lint/style/useNamingConvention: MongoDB $eq operator
      documentType: { $eq: 'imaging-report' },
    });
  });
});
