/**
 * Core hook encapsulating all agent interaction logic for the TUI.
 * Manages messages, streaming state, session, and slash commands.
 */

import { useCallback, useRef, useState } from 'react';
import type { StreamEvent } from '../cli-core.js';
import { handleResume, streamAgent } from '../cli-core.js';
import type { Session } from '../cli-utils.js';
import { createSession, handleCommand } from '../cli-utils.js';
import type { SessionUsage } from '../utils/usage-tracker.js';
import { createSessionUsage, formatSessionUsage, recordUsage } from '../utils/usage-tracker.js';
import type { Message } from './types.js';

export interface UseAsklepiosOptions {
  initialPatientId?: string | undefined;
}

export interface UseAsklepiosReturn {
  messages: Message[];
  isStreaming: boolean;
  session: Session;
  sessionUsage: SessionUsage;
  streamingText: string;
  streamingAgentId: string;
  sendMessage: (text: string) => void;
  handleSlashCommand: (input: string) => string | undefined;
}

let nextMsgId = 0;

function nextId(): number {
  return ++nextMsgId;
}

function sysMsg(content: string): Message {
  return { id: nextId(), role: 'system', content };
}

function buildAssistantMsg(content: string, agent: string, tokens?: Message['tokens']): Message {
  const msg: Message = { id: nextId(), role: 'assistant', content };
  if (agent) msg.agentId = agent;
  if (tokens) msg.tokens = tokens;
  return msg;
}

export function useAsklepios(options: UseAsklepiosOptions = {}): UseAsklepiosReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [session, setSession] = useState<Session>(() =>
    createSession(options.initialPatientId ? `patient-${options.initialPatientId}` : undefined),
  );
  const [usage] = useState<SessionUsage>(() => createSessionUsage());
  const [streamingText, setStreamingText] = useState('');
  const [streamingAgentId, setStreamingAgentId] = useState('');
  // Force re-render when usage updates since SessionUsage is mutated in place
  const [, setUsageTick] = useState(0);

  const streamingRef = useRef(false);

  const handleStreamEvent = useCallback(
    (
      event: StreamEvent,
      acc: { text: string; agentId: string },
    ): { text: string; agentId: string } => {
      if (event.type === 'text') {
        const text = acc.text + event.content;
        setStreamingText(text);
        return { ...acc, text };
      }
      if (event.type === 'agent-label') {
        setStreamingAgentId(event.agentId);
        return { ...acc, agentId: event.agentId };
      }
      if (event.type === 'usage') {
        recordUsage(usage, event.data);
        setUsageTick((n) => n + 1);
        setMessages((prev) => [...prev, buildAssistantMsg(acc.text, acc.agentId, event.data)]);
        return { ...acc, text: '' };
      }
      if (event.type === 'done' && acc.text) {
        setMessages((prev) => [...prev, buildAssistantMsg(acc.text, acc.agentId)]);
      }
      if (event.type === 'error') {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'system', content: `Error: ${event.message}` },
        ]);
      }
      return acc;
    },
    [usage],
  );

  const processStream = useCallback(
    async (stream: AsyncGenerator<StreamEvent>) => {
      let acc = { text: '', agentId: '' };
      for await (const event of stream) {
        acc = handleStreamEvent(event, acc);
      }
    },
    [handleStreamEvent],
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (streamingRef.current) return;
      streamingRef.current = true;
      setIsStreaming(true);
      setStreamingText('');
      setStreamingAgentId('');

      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }]);

      const stream = streamAgent(text, session);

      processStream(stream)
        .catch((error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          setMessages((prev) => [...prev, sysMsg(`Error: ${msg}`)]);
        })
        .finally(() => {
          streamingRef.current = false;
          setIsStreaming(false);
          setStreamingText('');
          setStreamingAgentId('');
        });
    },
    [session, processStream],
  );

  const handleSlashCommand = useCallback(
    (input: string): string | undefined => {
      if (input === '/usage') {
        const output = formatSessionUsage(usage);
        setMessages((prev) => [...prev, sysMsg(output)]);
        return undefined;
      }

      if (input.startsWith('/resume')) {
        handleResume(input)
          .then((result) => {
            setMessages((prev) => [...prev, sysMsg(result.output)]);
          })
          .catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error);
            setMessages((prev) => [...prev, sysMsg(`Resume error: ${msg}`)]);
          });
        return undefined;
      }

      const result = handleCommand(input, session);
      if (result.quit) return 'quit';

      setSession(result.session);
      if (result.output) {
        setMessages((prev) => [...prev, sysMsg(result.output)]);
      }
      return undefined;
    },
    [session, usage],
  );

  return {
    messages,
    isStreaming,
    session,
    sessionUsage: usage,
    streamingText,
    streamingAgentId,
    sendMessage,
    handleSlashCommand,
  };
}
