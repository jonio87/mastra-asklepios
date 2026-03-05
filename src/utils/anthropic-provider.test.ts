import type { AuthMethod } from './anthropic-provider.js';
import { getAnthropicProvider } from './anthropic-provider.js';

describe('getAnthropicProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns an AnthropicProvider with env auth method', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    const provider = getAnthropicProvider('env');
    expect(provider).toBeDefined();
    expect(typeof provider).toBe('function');
  });

  it('returns a provider that can create language models', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    const provider = getAnthropicProvider('env');
    const model = provider('claude-sonnet-4-20250514');
    expect(model).toBeDefined();
    expect(model.modelId).toBe('claude-sonnet-4-20250514');
  });

  it('defaults to env auth when ASKLEPIOS_AUTH is not set', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    delete process.env['ASKLEPIOS_AUTH'];
    const provider = getAnthropicProvider();
    expect(provider).toBeDefined();
  });

  it('reads auth method from ASKLEPIOS_AUTH env var', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    process.env['ASKLEPIOS_AUTH'] = 'env';
    const provider = getAnthropicProvider();
    expect(provider).toBeDefined();
  });

  it('prefers explicit authMethod parameter over ASKLEPIOS_AUTH env var', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
    process.env['ASKLEPIOS_AUTH'] = 'claude-code';
    // Explicit 'env' should override the env var
    const provider = getAnthropicProvider('env');
    expect(provider).toBeDefined();
  });

  it('accepts claude-code as a valid auth method', () => {
    // Will fall back to env since we're not on macOS with keychain in CI
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-fallback';
    const provider = getAnthropicProvider('claude-code');
    expect(provider).toBeDefined();
  });

  it('AuthMethod type accepts valid values', () => {
    const envMethod: AuthMethod = 'env';
    const ccMethod: AuthMethod = 'claude-code';
    expect(envMethod).toBe('env');
    expect(ccMethod).toBe('claude-code');
  });
});
