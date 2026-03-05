import type { TokenUsage } from '../utils/usage-tracker.js';

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens?: TokenUsage | undefined;
  agentId?: string | undefined;
}
