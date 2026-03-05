import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

const HpoTermSchema = z.object({
  id: z.string().describe('HPO term ID (e.g., HP:0001250)'),
  name: z.string().describe('Standardized term name'),
  definition: z.string().optional().describe('Definition of the phenotype'),
  synonyms: z.array(z.string()).describe('Alternative names for this phenotype'),
  category: z.string().optional().describe('High-level phenotype category'),
});

export type HpoTerm = z.infer<typeof HpoTermSchema>;

const HpoMappingSchema = z.object({
  originalText: z.string().describe('Original symptom text from patient description'),
  matchedTerms: z.array(HpoTermSchema).describe('Matched HPO terms'),
  confidence: z.number().min(0).max(1).describe('Confidence of mapping (0-1)'),
});

export type HpoMapping = z.infer<typeof HpoMappingSchema>;

const HPO_API_BASE = 'https://ontology.jax.org/api/hp';

const HpoSearchResultSchema = z.object({
  terms: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        definition: z.string().optional().nullable(),
        synonyms: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export const hpoMapperTool = createTool({
  id: 'hpo-mapper',
  description:
    'Map free-text symptom descriptions to Human Phenotype Ontology (HPO) terms. This standardizes patient symptoms for rare disease diagnosis. Input individual symptoms or comma-separated lists.',
  inputSchema: z.object({
    symptoms: z
      .array(z.string())
      .describe(
        'List of symptom descriptions in plain language (e.g., ["joint pain", "easy bruising", "tall stature"])',
      ),
  }),
  outputSchema: z.object({
    mappings: z.array(HpoMappingSchema).describe('HPO mappings for each input symptom'),
    unmappedSymptoms: z
      .array(z.string())
      .describe('Symptoms that could not be mapped to HPO terms'),
  }),
  execute: async (inputData) => {
    const { symptoms } = inputData;

    logger.info('Mapping symptoms to HPO terms', { symptomCount: symptoms.length });

    const mappings: HpoMapping[] = [];
    const unmappedSymptoms: string[] = [];

    for (const symptom of symptoms) {
      const trimmed = symptom.trim();
      if (!trimmed) continue;

      const terms = await searchHpoTerms(trimmed);

      if (terms.length > 0) {
        mappings.push({
          originalText: trimmed,
          matchedTerms: terms,
          confidence: terms.length > 0 ? calculateConfidence(trimmed, terms[0]?.name ?? '') : 0,
        });
      } else {
        unmappedSymptoms.push(trimmed);
      }
    }

    logger.info('HPO mapping complete', {
      mapped: mappings.length,
      unmapped: unmappedSymptoms.length,
    });

    return { mappings, unmappedSymptoms };
  },
});

async function searchHpoTerms(query: string): Promise<HpoTerm[]> {
  const url = `${HPO_API_BASE}/search?q=${encodeURIComponent(query)}&max=5`;

  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    logger.warn('HPO search failed', { query, status: response.status });
    return [];
  }

  const parsed = HpoSearchResultSchema.safeParse(await response.json());
  if (!(parsed.success && parsed.data.terms)) {
    return [];
  }

  return parsed.data.terms.map((t) => ({
    id: t.id,
    name: t.name,
    definition: t.definition ?? undefined,
    synonyms: t.synonyms ?? [],
  }));
}

function calculateConfidence(original: string, matched: string): number {
  const normalizedOriginal = original.toLowerCase().trim();
  const normalizedMatched = matched.toLowerCase().trim();

  if (normalizedOriginal === normalizedMatched) return 1.0;
  if (
    normalizedMatched.includes(normalizedOriginal) ||
    normalizedOriginal.includes(normalizedMatched)
  )
    return 0.85;
  return 0.6;
}
