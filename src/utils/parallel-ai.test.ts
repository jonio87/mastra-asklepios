import { runDeepResearch } from './parallel-ai.js';

describe('parallel-ai client', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when PARALLEL_API_KEY is not set', async () => {
    const env = { ...originalEnv };
    delete env['PARALLEL_API_KEY'];
    process.env = env;

    const result = await runDeepResearch('test query');
    expect(result).toBeNull();
  });

  it('exports runDeepResearch function', () => {
    expect(typeof runDeepResearch).toBe('function');
  });

  it('accepts processor option', async () => {
    const env = { ...originalEnv };
    delete env['PARALLEL_API_KEY'];
    process.env = env;

    // Without API key, returns null regardless of processor
    const result = await runDeepResearch('test', { processor: 'base' });
    expect(result).toBeNull();
  });

  it('accepts timeout option', async () => {
    const env = { ...originalEnv };
    delete env['PARALLEL_API_KEY'];
    process.env = env;

    const result = await runDeepResearch('test', { timeoutMs: 1000 });
    expect(result).toBeNull();
  });
});
