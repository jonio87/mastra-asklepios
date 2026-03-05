#!/usr/bin/env npx tsx
/**
 * Latency comparison: quick (Haiku) vs research (Sonnet) vs deep (Opus)
 *
 * Usage:
 *   npx tsx scripts/test-latency.ts
 */
import { randomUUID } from 'node:crypto';
import { RequestContext } from '@mastra/core/request-context';
import { mastra } from '../src/mastra.js';

function elapsed(start: [number, number]): number {
  const [s, ns] = process.hrtime(start);
  return Math.round(s * 1000 + ns / 1_000_000);
}

interface LatencyResult {
  mode: string;
  model: string;
  firstTokenMs: number;
  totalMs: number;
  responseChars: number;
}

async function measureLatency(
  mode: string,
  message: string,
): Promise<LatencyResult> {
  const agent = mastra.getAgent('asklepios');
  const threadId = randomUUID();

  // Create a RequestContext with the mode set
  const rc = new RequestContext();
  rc.set('mode', mode);

  const start = process.hrtime();
  let firstTokenMs = 0;
  let charCount = 0;

  const result = await agent.stream(message, {
    memory: { thread: threadId, resource: `latency-test-${mode}` },
    requestContext: rc,
  });

  const reader = result.textStream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstTokenMs === 0) firstTokenMs = elapsed(start);
    charCount += value.length;
  }
  reader.releaseLock();

  const totalMs = elapsed(start);

  // Resolve model from mode
  const { getModelIdForMode } = await import('../src/utils/model-router.js');
  const modelId = getModelIdForMode(mode === 'quick' ? 'quick' : mode === 'deep' ? 'deep' : 'research');

  return { mode, model: modelId, firstTokenMs, totalMs, responseChars: charCount };
}

console.log('═══════════════════════════════════════════════════════');
console.log('LATENCY COMPARISON — Model Routing Modes');
console.log('═══════════════════════════════════════════════════════');

const simpleMessage = 'List 3 symptoms of Ehlers-Danlos syndrome in one sentence.';

const results: LatencyResult[] = [];

// Test quick mode (Haiku)
console.log('\n🏃 Testing QUICK mode (Haiku)...');
const quickResult = await measureLatency('quick', simpleMessage);
results.push(quickResult);
console.log(`  First token: ${quickResult.firstTokenMs}ms | Total: ${quickResult.totalMs}ms | Chars: ${quickResult.responseChars}`);

// Test research mode (Sonnet)
console.log('\n🔬 Testing RESEARCH mode (Sonnet)...');
const researchResult = await measureLatency('research', simpleMessage);
results.push(researchResult);
console.log(`  First token: ${researchResult.firstTokenMs}ms | Total: ${researchResult.totalMs}ms | Chars: ${researchResult.responseChars}`);

// Print comparison table
console.log('\n═══════════════════════════════════════════════════════');
console.log('RESULTS');
console.log('═══════════════════════════════════════════════════════');
console.log('');
console.log('Mode       | Model         | TTFT     | Total    | Chars');
console.log('-----------|---------------|----------|----------|------');
for (const r of results) {
  const modeStr = r.mode.padEnd(10);
  const modelStr = r.model.slice(-15).padEnd(13);
  const ttft = `${r.firstTokenMs}ms`.padEnd(8);
  const total = `${r.totalMs}ms`.padEnd(8);
  console.log(`${modeStr} | ${modelStr} | ${ttft} | ${total} | ${r.responseChars}`);
}

const speedup = researchResult.firstTokenMs / quickResult.firstTokenMs;
console.log(`\nHaiku TTFT speedup: ${speedup.toFixed(1)}x faster than Sonnet`);
console.log(`Haiku total speedup: ${(researchResult.totalMs / quickResult.totalMs).toFixed(1)}x faster`);
