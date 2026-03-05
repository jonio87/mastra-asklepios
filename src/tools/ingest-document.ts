import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { DocumentType } from '../knowledge/document-store.js';
import { getDocumentStore } from '../knowledge/document-store.js';
import { vectorStore } from '../memory.js';
import { createEmbedder } from '../utils/embedder.js';
import { logger } from '../utils/logger.js';

/**
 * Document ingestion tool — chunks, embeds, and stores documents in the
 * Layer 3 knowledge base. Single entry point for all document types.
 */
export const ingestDocumentTool = createTool({
  id: 'ingest-document',
  description: `Ingest a medical document into the patient's knowledge base for future semantic search.
Use this when the user provides or references a medical document (clinical note, lab report,
imaging report, consultation letter, research paper). The document is chunked by type,
embedded, and stored for retrieval via the knowledge-query tool.

Document types and their chunking strategies:
- clinical-note: markdown chunking (preserves headers/sections)
- lab-report: recursive chunking (by panel)
- imaging-report: recursive chunking (by finding)
- research-paper: recursive chunking (by section, larger chunks)
- consultation-letter: markdown chunking (by specialist section)
- other: recursive chunking (general purpose)`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    text: z.string().describe('Full text of the document'),
    documentType: z
      .enum([
        'clinical-note',
        'lab-report',
        'imaging-report',
        'research-paper',
        'consultation-letter',
        'other',
      ])
      .describe('Type of medical document'),
    date: z.string().optional().describe('Document date (ISO 8601)'),
    source: z.string().optional().describe('Source institution or provider'),
    title: z.string().optional().describe('Document title or description'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    chunkCount: z.number(),
    message: z.string(),
  }),
  execute: async (input) => {
    const embedder = createEmbedder();
    if (!embedder) {
      return {
        success: false,
        chunkCount: 0,
        message: 'Document ingestion requires OPENAI_API_KEY for embeddings.',
      };
    }

    const store = getDocumentStore(vectorStore, embedder);

    logger.info('Ingesting document', {
      type: input.documentType,
      patientId: input.patientId,
      textLength: input.text.length,
    });

    const metadata: {
      patientId: string;
      documentType: DocumentType;
      date?: string;
      source?: string;
      title?: string;
    } = {
      patientId: input.patientId,
      documentType: input.documentType,
    };
    if (input.date) metadata.date = input.date;
    if (input.source) metadata.source = input.source;
    if (input.title) metadata.title = input.title;

    const result = await store.ingestDocument(input.text, metadata);

    return {
      success: true,
      chunkCount: result.chunkCount,
      message: `Ingested ${result.chunkCount} chunks from ${input.documentType} document.`,
    };
  },
});
