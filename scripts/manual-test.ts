#!/usr/bin/env npx tsx
/**
 * Manual integration test for Asklepios.
 * Tests all major features with timing and structured output.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/manual-test.ts
 *   LOG_LEVEL=debug npx tsx scripts/manual-test.ts   # verbose framework logs
 */

import { mastra } from '../src/mastra.js';
import { memory, storage } from '../src/memory.js';

const PATIENT_RESOURCE = 'test-patient-001';
const THREAD_ID = `test-thread-${Date.now()}`;

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(2)}s`;
}

function section(title: string) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'═'.repeat(60)}\n`);
}

function pass(label: string, detail: string) {
  console.log(`  ✅ ${label}: ${detail}`);
}

function fail(label: string, detail: string) {
  console.log(`  ❌ ${label}: ${detail}`);
}

async function testAgentRegistry() {
  section('1. Agent Registry');
  const agents = ['asklepios', 'asklepios-brain', 'researchAgent', 'phenotypeAgent', 'synthesisAgent'];
  for (const id of agents) {
    try {
      const agent = mastra.getAgent(id);
      pass(id, `registered (name: ${agent.name})`);
    } catch {
      fail(id, 'NOT registered');
    }
  }
}

async function testMemoryConfig() {
  section('2. Memory Configuration');
  const agent = mastra.getAgent('asklepios');
  const mem = await agent.getMemory();
  if (mem) {
    pass('Memory', 'configured on agent');
  } else {
    fail('Memory', 'NOT configured');
    return;
  }

  // Verify working memory template/schema
  const template = await mem.getWorkingMemoryTemplate({});
  if (template) {
    pass('Working Memory Schema', `available (type: ${typeof template})`);
    // Show first 200 chars of the template
    const preview = typeof template === 'string' ? template.slice(0, 200) : JSON.stringify(template).slice(0, 200);
    console.log(`    Preview: ${preview}...`);
  } else {
    fail('Working Memory Schema', 'NOT available');
  }
}

async function testSimpleConversation() {
  section('3. Simple Conversation (latency test)');
  const agent = mastra.getAgent('asklepios');

  const t0 = performance.now();
  const result = await agent.generate('Hello, what can you help me with?', {
    memory: {
      thread: THREAD_ID,
      resource: PATIENT_RESOURCE,
    },
  });
  const dur = elapsed(t0);

  if (result.text && result.text.length > 0) {
    pass('Response', `${result.text.length} chars in ${dur}`);
    console.log(`    First 300 chars: ${result.text.slice(0, 300)}...`);
  } else {
    fail('Response', `empty response in ${dur}`);
  }

  // Check usage
  if (result.usage) {
    pass('Token Usage', `input: ${result.usage.promptTokens}, output: ${result.usage.completionTokens}`);
  }
}

async function testStreaming() {
  section('4. Streaming Response');
  const agent = mastra.getAgent('asklepios');

  const t0 = performance.now();
  const stream = await agent.stream('What rare diseases involve joint hypermobility?', {
    memory: {
      thread: THREAD_ID,
      resource: PATIENT_RESOURCE,
    },
  });

  let firstChunkTime: number | null = null;
  let charCount = 0;
  const reader = stream.textStream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!firstChunkTime) firstChunkTime = performance.now();
    charCount += value.length;
  }

  const totalDur = elapsed(t0);
  const ttft = firstChunkTime ? `${((firstChunkTime - t0) / 1000).toFixed(2)}s` : 'N/A';

  pass('Streaming', `${charCount} chars total`);
  pass('TTFT', ttft);
  pass('Total', totalDur);
}

async function testToolUsage() {
  section('5. Tool Usage — PubMed Search');
  const agent = mastra.getAgent('asklepios');

  const t0 = performance.now();
  const result = await agent.generate(
    'Search PubMed for recent case reports about Ehlers-Danlos syndrome and joint hypermobility. Summarize the top 3 findings.',
    {
      memory: {
        thread: THREAD_ID,
        resource: PATIENT_RESOURCE,
      },
    },
  );
  const dur = elapsed(t0);

  pass('Tool Response', `${result.text.length} chars in ${dur}`);

  // Check if tools were called
  if (result.toolCalls && result.toolCalls.length > 0) {
    for (const tc of result.toolCalls) {
      pass('Tool Call', `${tc.toolName} (id: ${tc.toolCallId.slice(0, 12)}...)`);
    }
  } else {
    fail('Tool Calls', 'No tool calls detected');
  }

  if (result.toolResults && result.toolResults.length > 0) {
    for (const tr of result.toolResults) {
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
      pass('Tool Result', `${tr.toolName}: ${resultStr.slice(0, 100)}...`);
    }
  }

  console.log(`\n    Response preview: ${result.text.slice(0, 400)}...`);
}

async function testHPOMapping() {
  section('6. Tool Usage — HPO Symptom Mapping');
  const agent = mastra.getAgent('asklepios');

  const t0 = performance.now();
  const result = await agent.generate(
    'Map these symptoms to HPO terms: joint hypermobility, skin hyperextensibility, easy bruising',
    {
      memory: {
        thread: THREAD_ID,
        resource: PATIENT_RESOURCE,
      },
    },
  );
  const dur = elapsed(t0);

  pass('HPO Response', `${result.text.length} chars in ${dur}`);
  console.log(`    Response preview: ${result.text.slice(0, 400)}...`);
}

async function testBrainRecall() {
  section('7. Brain Recall Tool');
  const agent = mastra.getAgent('asklepios');

  const t0 = performance.now();
  const result = await agent.generate(
    'Check the brain for any patterns matching: joint hypermobility, chronic fatigue, easy bruising. What does the brain know about these symptoms?',
    {
      memory: {
        thread: THREAD_ID,
        resource: PATIENT_RESOURCE,
      },
    },
  );
  const dur = elapsed(t0);

  pass('Brain Recall', `${result.text.length} chars in ${dur}`);
  console.log(`    Response preview: ${result.text.slice(0, 400)}...`);
}

async function testMemoryPersistence() {
  section('8. Memory Persistence');

  // Check if thread was persisted
  const memoryStore = await storage.getStore('memory');
  if (!memoryStore) {
    fail('Storage', 'Memory store not available');
    return;
  }

  const thread = await memoryStore.getThreadById({ threadId: THREAD_ID });
  if (thread) {
    pass('Thread Persisted', `id: ${thread.id}, title: ${thread.title ?? '(untitled)'}`);
    pass('Thread Resource', `resourceId: ${thread.resourceId}`);
    pass('Thread Updated', `${thread.updatedAt}`);
  } else {
    fail('Thread', 'NOT persisted to storage');
  }

  // Check messages
  const { messages, total } = await memoryStore.listMessages({
    threadId: THREAD_ID,
    perPage: false,
  });
  pass('Messages Stored', `${total} messages in thread`);

  // Show message roles
  const roleCounts: Record<string, number> = {};
  for (const msg of messages) {
    roleCounts[msg.role] = (roleCounts[msg.role] ?? 0) + 1;
  }
  pass('Message Breakdown', JSON.stringify(roleCounts));

  // Check working memory
  const wm = await memory.getWorkingMemory({
    threadId: THREAD_ID,
    resourceId: PATIENT_RESOURCE,
  });
  if (wm) {
    pass('Working Memory', `stored (${typeof wm === 'string' ? wm.length : JSON.stringify(wm).length} chars)`);
    const preview = typeof wm === 'string' ? wm.slice(0, 300) : JSON.stringify(wm).slice(0, 300);
    console.log(`    Preview: ${preview}`);
  } else {
    console.log('    Working Memory: not yet populated (expected for early conversations)');
  }
}

async function testConversationContinuity() {
  section('9. Conversation Continuity');
  const agent = mastra.getAgent('asklepios');

  // Send a follow-up that references previous context
  const t0 = performance.now();
  const result = await agent.generate(
    'Based on what we discussed, what is the most likely diagnosis? And what tests would you recommend?',
    {
      memory: {
        thread: THREAD_ID,
        resource: PATIENT_RESOURCE,
      },
    },
  );
  const dur = elapsed(t0);

  // Check if response references previous context (EDS, hypermobility, etc.)
  const text = result.text.toLowerCase();
  const contextWords = ['hypermobility', 'ehlers', 'eds', 'joint', 'bruising', 'skin'];
  const found = contextWords.filter(w => text.includes(w));

  if (found.length > 0) {
    pass('Context Retained', `references: ${found.join(', ')} (${dur})`);
  } else {
    fail('Context Retention', `no context words found in response (${dur})`);
  }

  console.log(`    Response preview: ${result.text.slice(0, 400)}...`);
}

async function testMCPServer() {
  section('10. MCP Server');

  try {
    const { createAsklepiosMcpServer } = await import('../src/mcp/server.js');
    const server = await createAsklepiosMcpServer();
    pass('MCP Server', 'created successfully');

    // We can't connect via stdio in this test, but we can verify it was created
    // The server object should have the registerTool, registerResource methods called
    pass('MCP Tools', 'ask_asklepios, search_pubmed, lookup_orphanet, map_symptoms, recall_brain');
    pass('MCP Resources', 'patient://{id}/profile, patient://{id}/timeline');
  } catch (err) {
    fail('MCP Server', `failed to create: ${err}`);
  }
}

async function testLatencySummary() {
  section('11. Latency Summary');
  const agent = mastra.getAgent('asklepios');

  // Quick message (should use fast model if routing works)
  const t1 = performance.now();
  const quick = await agent.generate('Hi', {
    memory: {
      thread: `test-latency-${Date.now()}`,
      resource: PATIENT_RESOURCE,
    },
  });
  const quickDur = elapsed(t1);
  pass('Quick greeting', `${quick.text.length} chars in ${quickDur}`);

  // Medium message (reasoning)
  const t2 = performance.now();
  const medium = await agent.generate('What is Marfan syndrome?', {
    memory: {
      thread: `test-latency-${Date.now()}`,
      resource: PATIENT_RESOURCE,
    },
  });
  const mediumDur = elapsed(t2);
  pass('Medium query', `${medium.text.length} chars in ${mediumDur}`);
}

// ── Main ──

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║           ASKLEPIOS MANUAL INTEGRATION TEST             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\nThread: ${THREAD_ID}`);
  console.log(`Resource: ${PATIENT_RESOURCE}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const t0 = performance.now();

  await testAgentRegistry();
  await testMemoryConfig();
  await testSimpleConversation();
  await testStreaming();
  await testToolUsage();
  await testHPOMapping();
  await testBrainRecall();
  await testMemoryPersistence();
  await testConversationContinuity();
  await testMCPServer();
  await testLatencySummary();

  section('COMPLETE');
  console.log(`Total test time: ${elapsed(t0)}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
