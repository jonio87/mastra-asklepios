import { getModelIdForMode, resolveMode } from './model-router.js';

describe('resolveMode', () => {
  it('defaults to research when no requestContext', () => {
    expect(resolveMode()).toBe('research');
    expect(resolveMode(undefined)).toBe('research');
  });

  it('returns research when mode is not set in context', () => {
    const ctx = { get: () => undefined };
    expect(resolveMode(ctx)).toBe('research');
  });

  it('returns quick mode', () => {
    const ctx = { get: (key: string) => (key === 'mode' ? 'quick' : undefined) };
    expect(resolveMode(ctx)).toBe('quick');
  });

  it('returns voice mode', () => {
    const ctx = { get: (key: string) => (key === 'mode' ? 'voice' : undefined) };
    expect(resolveMode(ctx)).toBe('voice');
  });

  it('returns research mode', () => {
    const ctx = { get: (key: string) => (key === 'mode' ? 'research' : undefined) };
    expect(resolveMode(ctx)).toBe('research');
  });

  it('returns deep mode', () => {
    const ctx = { get: (key: string) => (key === 'mode' ? 'deep' : undefined) };
    expect(resolveMode(ctx)).toBe('deep');
  });

  it('falls back to research for unknown mode strings', () => {
    const ctx = { get: () => 'turbo' };
    expect(resolveMode(ctx)).toBe('research');
  });

  it('falls back to research for non-string mode values', () => {
    const ctx = { get: () => 42 };
    expect(resolveMode(ctx)).toBe('research');
  });
});

describe('getModelIdForMode', () => {
  it('maps quick to haiku', () => {
    expect(getModelIdForMode('quick')).toContain('haiku');
  });

  it('maps voice to haiku', () => {
    expect(getModelIdForMode('voice')).toContain('haiku');
  });

  it('maps research to sonnet', () => {
    expect(getModelIdForMode('research')).toContain('sonnet');
  });

  it('maps deep to opus', () => {
    expect(getModelIdForMode('deep')).toContain('opus');
  });

  it('quick and voice use the same model', () => {
    expect(getModelIdForMode('quick')).toBe(getModelIdForMode('voice'));
  });

  it('all modes return valid model IDs', () => {
    const modes = ['quick', 'voice', 'research', 'deep'] as const;
    for (const mode of modes) {
      const id = getModelIdForMode(mode);
      expect(id).toMatch(/^claude-/);
    }
  });
});
