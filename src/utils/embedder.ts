import { logger } from './logger.js';

/**
 * Creates an embedding function using OpenAI's text-embedding-3-small model.
 * Returns null if OPENAI_API_KEY is not set (graceful fallback).
 */
export function createEmbedder(): ((texts: string[]) => Promise<number[][]>) | null {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    logger.debug('No OPENAI_API_KEY — embedder disabled');
    return null;
  }

  return async (texts: string[]): Promise<number[][]> => {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        // biome-ignore lint/style/useNamingConvention: HTTP header name
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };

    return data.data.map((d) => d.embedding);
  };
}
