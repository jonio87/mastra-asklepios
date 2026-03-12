import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDocumentStore } from '../knowledge/document-store.js';
import { vectorStore } from '../memory.js';
import { createEmbedder } from '../utils/embedder.js';
import { logger } from '../utils/logger.js';

/**
 * Knowledge query tool — semantic search across the document knowledge base (Layer 3).
 *
 * Use this to find specific information in previously ingested documents:
 * "What did Prof. Zakrzewska say?", "Find the 2022 MRI findings",
 * "Any notes about Anti-Ro-60 testing methodology?"
 */
export const knowledgeQueryTool = createTool({
  id: 'knowledge-query',
  description: `Search the patient's document knowledge base using natural language.
Returns relevant document chunks ranked by semantic similarity. Use this when you need
to find specific information from previously ingested medical documents, clinical notes,
research papers, or consultation letters.

Good queries: "Anti-Ro-60 testing methodology", "cervical MRI findings 2022",
"Prof. Zakrzewska conclusions", "CGRP treatment response"`,
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    query: z.string().describe('Natural language search query'),
    documentType: z
      .enum([
        'diagnostic-report',
        'procedure-note',
        'clinical-note',
        'patient-document',
        'research-paper',
        'other',
      ])
      .optional()
      .describe('Filter by FHIR R4-aligned document type'),
    topK: z.number().optional().describe('Number of results to return (default: 5)'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        text: z.string(),
        documentType: z.string(),
        date: z.string().optional(),
        source: z.string().optional(),
        title: z.string().optional(),
        score: z.number().optional(),
      }),
    ),
    count: z.number(),
    message: z.string(),
  }),
  execute: async (input) => {
    const embedder = createEmbedder();
    if (!embedder) {
      return {
        results: [],
        count: 0,
        message: 'Knowledge search requires OPENAI_API_KEY for embeddings.',
      };
    }

    const store = getDocumentStore(vectorStore, embedder);

    logger.debug(`Knowledge query: "${input.query}" for patient ${input.patientId}`);

    const queryParams: {
      patientId: string;
      documentType?:
        | 'diagnostic-report'
        | 'procedure-note'
        | 'clinical-note'
        | 'patient-document'
        | 'research-paper'
        | 'other';
      topK?: number;
    } = {
      patientId: input.patientId,
    };
    if (input.documentType) queryParams.documentType = input.documentType;
    if (input.topK) queryParams.topK = input.topK;

    const chunks = await store.queryDocuments(input.query, queryParams);

    const results = chunks.map((c) => {
      const r: {
        text: string;
        documentType: string;
        date?: string;
        source?: string;
        title?: string;
        score?: number;
      } = {
        text: c.text,
        documentType: c.metadata.documentType,
      };
      if (c.metadata.date) r.date = c.metadata.date;
      if (c.metadata.source) r.source = c.metadata.source;
      if (c.metadata.title) r.title = c.metadata.title;
      if (c.score !== undefined) r.score = c.score;
      return r;
    });

    return {
      results,
      count: results.length,
      message:
        results.length > 0
          ? `Found ${results.length} relevant document chunks.`
          : 'No matching documents found. The document may not have been ingested yet.',
    };
  },
});
