import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { _resetForTesting, NCBI_BASE_URL, ncbiFetch } from './ncbi-rate-limiter.js';

describe('NCBI Rate Limiter', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetForTesting();
    delete process.env['NCBI_API_KEY'];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it('exports NCBI_BASE_URL constant', () => {
    expect(NCBI_BASE_URL).toBe('https://eutils.ncbi.nlm.nih.gov/entrez/eutils');
  });

  it('passes through successful responses', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(mockResponse);

    const result = await ncbiFetch('https://example.com/test');
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('appends api_key when NCBI_API_KEY is set', async () => {
    process.env['NCBI_API_KEY'] = 'test-key-123';
    const mockResponse = new Response('', { status: 200 });
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(mockResponse);

    await ncbiFetch('https://example.com/test?db=pubmed');

    const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('api_key=test-key-123');
    expect(calledUrl).toContain('&api_key=');
  });

  it('appends api_key with ? separator when URL has no query string', async () => {
    process.env['NCBI_API_KEY'] = 'my-key';
    const mockResponse = new Response('', { status: 200 });
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(mockResponse);

    await ncbiFetch('https://example.com/test');

    const calledUrl = (globalThis.fetch as jest.Mock).mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://example.com/test?api_key=my-key');
  });

  it('retries on 429 with exponential backoff', async () => {
    const rateLimited = new Response('', { status: 429 });
    const success = new Response(JSON.stringify({ ok: true }), { status: 200 });

    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(success);

    const result = await ncbiFetch('https://example.com/test');
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('retries on 500 server errors', async () => {
    const serverError = new Response('', { status: 500 });
    const success = new Response('ok', { status: 200 });

    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(serverError)
      .mockResolvedValueOnce(success);

    const result = await ncbiFetch('https://example.com/test');
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  }, 10_000);

  it('returns error response after exhausting retries', async () => {
    const rateLimited = new Response('', { status: 429 });
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(rateLimited);

    const result = await ncbiFetch('https://example.com/test');
    expect(result.status).toBe(429);
    // MAX_RETRIES = 4, so 1 initial + 4 retries = 5 total
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  }, 30_000);

  it('does not retry on 400 client errors', async () => {
    const badRequest = new Response('', { status: 400 });
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(badRequest);

    const result = await ncbiFetch('https://example.com/test');
    expect(result.status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
