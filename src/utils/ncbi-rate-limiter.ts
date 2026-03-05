import { logger } from './logger.js';

/** NCBI eUtils base URL shared across PubMed, ClinVar, and other NCBI tools. */
export const NCBI_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1000;

/** Minimum interval between requests: 334ms without key (3 req/s), 100ms with key (10 req/s). */
function getMinInterval(): number {
  return process.env['NCBI_API_KEY'] ? 100 : 334;
}

let lastRequestTime = 0;

/** Append NCBI API key to URL if available. */
function appendApiKey(url: string): string {
  const key = process.env['NCBI_API_KEY'];
  if (!key) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}api_key=${encodeURIComponent(key)}`;
}

/** Wait until the minimum interval between requests has elapsed. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  const minInterval = getMinInterval();
  if (elapsed < minInterval) {
    await new Promise((resolve) => setTimeout(resolve, minInterval - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Rate-limited fetch for all NCBI eUtils endpoints (PubMed, ClinVar, etc.).
 *
 * - Throttles requests to stay within NCBI rate limits (3/s without key, 10/s with key).
 * - Retries on 429 and 5xx with exponential backoff (1s → 2s → 4s → 8s).
 * - Automatically appends NCBI_API_KEY if set.
 */
export async function ncbiFetch(url: string): Promise<Response> {
  const fullUrl = appendApiKey(url);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttle();

    const response = await fetch(fullUrl);

    if (response.ok) return response;

    const isRetryable = response.status === 429 || response.status >= 500;
    if (!isRetryable || attempt === MAX_RETRIES) {
      logger.warn('NCBI request failed', {
        url: url.slice(0, 120),
        status: response.status,
        attempt: attempt + 1,
      });
      return response;
    }

    const backoff = INITIAL_BACKOFF_MS * 2 ** attempt;
    logger.info('NCBI rate limit — retrying', {
      status: response.status,
      attempt: attempt + 1,
      backoffMs: backoff,
    });
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }

  // Unreachable, but TypeScript needs it
  return fetch(fullUrl);
}

/** Reset internal state — for testing only. */
// biome-ignore lint/style/useNamingConvention: underscore prefix signals test-only internal
export function _resetForTesting(): void {
  lastRequestTime = 0;
}
