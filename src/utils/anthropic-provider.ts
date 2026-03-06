import { execSync } from 'node:child_process';
import type { AnthropicProvider } from '@ai-sdk/anthropic';
import { createAnthropic } from '@ai-sdk/anthropic';

/** Strip leading ASCII control characters (0x00–0x1F) from hex-decoded keychain blobs. */
function stripLeadingControlChars(s: string): string {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) < 0x20) i++;
  return s.slice(i);
}

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
    const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
      encoding: 'utf-8',
      timeout: 5_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Keychain entry may be raw JSON or hex-encoded — try both
    const text = raw.startsWith('{')
      ? raw
      : stripLeadingControlChars(Buffer.from(raw, 'hex').toString('utf-8'));

    // Try full JSON parse first; fall back to regex for truncated blobs
    let token: string | undefined;
    let expiresAt: number | undefined;
    try {
      const jsonStr = text.startsWith('{') ? text : `{${text}}`;
      const creds: ClaudeCodeCredentials = JSON.parse(jsonStr);
      token = creds.claudeAiOauth?.accessToken;
      expiresAt = creds.claudeAiOauth?.expiresAt;
    } catch {
      // Hex blob may be truncated — extract token via regex
      const tokenMatch = text.match(/"accessToken":"([^"]+)"/);
      const expiryMatch = text.match(/"expiresAt":(\d+)/);
      token = tokenMatch?.[1];
      expiresAt = expiryMatch?.[1] ? Number(expiryMatch[1]) : undefined;
    }

    if (!token) {
      logger.debug('No OAuth access token in Claude Code credentials');
      return undefined;
    }

    if (expiresAt && expiresAt < Date.now()) {
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
 * Creates a configured Anthropic provider.
 *
 * @param authMethod - How to authenticate:
 *   - `'env'` — use `ANTHROPIC_API_KEY` env var (default, works inside Claude Code sessions)
 *   - `'claude-code'` — read OAuth token from macOS Keychain (works outside Claude Code sessions)
 *
 * Set via `ASKLEPIOS_AUTH` env var or pass directly.
 */
export function getAnthropicProvider(_authMethod?: AuthMethod): AnthropicProvider {
  // Always try Claude Code OAuth token first (works with Max subscription)
  // OAuth tokens work as x-api-key (NOT Authorization: Bearer — Bearer returns
  // "OAuth authentication is currently not supported" from Anthropic API).
  // Max subscription routes to different model catalog — only new model IDs work
  // (claude-sonnet-4-*, claude-opus-4-*, claude-haiku-4-5-*), NOT old IDs (claude-3-5-*).
  const token = readClaudeCodeToken();
  if (token) {
    return createAnthropic({ apiKey: token });
  }

  // No token available — create provider without explicit key
  // (will fail at call time, but logs above already warned)
  logger.warn('No Claude Code OAuth token available — LLM calls will fail');
  return createAnthropic({});
}

/**
 * The default shared Anthropic provider instance.
 * Auth method controlled by `ASKLEPIOS_AUTH` env var (`'env'` | `'claude-code'`).
 */
export const anthropic: AnthropicProvider = getAnthropicProvider();
