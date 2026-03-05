import { execSync } from 'node:child_process';
import type { AnthropicProvider } from '@ai-sdk/anthropic';
import { createAnthropic } from '@ai-sdk/anthropic';

import { logger } from './logger.js';

interface ClaudeCodeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  };
}

/**
 * Reads the Claude Code OAuth access token from the macOS Keychain.
 *
 * Claude Code stores credentials in the macOS Keychain under
 * "Claude Code-credentials" as a hex-encoded JSON blob containing
 * `claudeAiOauth.accessToken` (format: `sk-ant-oat01-...`).
 *
 * Returns the access token string, or undefined if not available.
 */
function readClaudeCodeToken(): string | undefined {
  if (process.platform !== 'darwin') {
    logger.debug('Claude Code keychain auth only supported on macOS');
    return undefined;
  }

  try {
    const hex = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const decoded = Buffer.from(hex, 'hex').toString('utf-8');
    const jsonStart = decoded.indexOf('{');
    if (jsonStart === -1) {
      logger.debug('No JSON found in Claude Code keychain entry');
      return undefined;
    }

    const creds: ClaudeCodeCredentials = JSON.parse(decoded.slice(jsonStart));
    const token = creds.claudeAiOauth?.accessToken;

    if (!token) {
      logger.debug('No OAuth access token in Claude Code credentials');
      return undefined;
    }

    const now = Date.now();
    const expiresAt = creds.claudeAiOauth?.expiresAt;
    if (expiresAt && expiresAt < now) {
      logger.warn('Claude Code OAuth token has expired — run `claude` to refresh');
      return undefined;
    }

    logger.info('Using Claude Code credentials from macOS Keychain');
    return token;
  } catch {
    logger.debug('Could not read Claude Code credentials from Keychain');
    return undefined;
  }
}

export type AuthMethod = 'env' | 'claude-code';

/**
 * Resolves the Anthropic API key by auth method.
 *
 * - `'env'` (default): uses the `ANTHROPIC_API_KEY` environment variable.
 *   When running inside a Claude Code session, this env var is already set.
 * - `'claude-code'`: reads the OAuth access token directly from the macOS Keychain
 *   (useful when launching outside a Claude Code session but still using your
 *   Claude Code subscription).
 *
 * Falls back to `'env'` if `'claude-code'` fails to read credentials.
 */
function resolveApiKey(method: AuthMethod): string | undefined {
  if (method === 'claude-code') {
    const token = readClaudeCodeToken();
    if (token) return token;
    logger.warn('Claude Code auth failed, falling back to ANTHROPIC_API_KEY env var');
  }
  return process.env['ANTHROPIC_API_KEY'];
}

/**
 * Creates a configured Anthropic provider.
 *
 * @param authMethod - How to authenticate:
 *   - `'env'` — use `ANTHROPIC_API_KEY` env var (default, works inside Claude Code sessions)
 *   - `'claude-code'` — read OAuth token from macOS Keychain (works outside Claude Code sessions)
 *
 * Set via `ASKLEPIOS_AUTH` env var or pass directly.
 */
export function getAnthropicProvider(authMethod?: AuthMethod): AnthropicProvider {
  const method: AuthMethod =
    authMethod ?? (process.env['ASKLEPIOS_AUTH'] as AuthMethod | undefined) ?? 'env';

  const apiKey = resolveApiKey(method);

  return createAnthropic({
    ...(apiKey ? { apiKey } : {}),
  });
}

/**
 * The default shared Anthropic provider instance.
 * Auth method controlled by `ASKLEPIOS_AUTH` env var (`'env'` | `'claude-code'`).
 */
export const anthropic: AnthropicProvider = getAnthropicProvider();
