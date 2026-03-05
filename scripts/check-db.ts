#!/usr/bin/env npx tsx
import { memory, storage } from '../src/memory.js';

async function main() {
  const memStore = await storage.getStore('memory');
  const result = await memStore.listThreads({
    perPage: 20,
    orderBy: { field: 'updatedAt', direction: 'DESC' },
  });

  console.log('=== PERSISTED THREADS ===');
  for (const t of result.threads) {
    console.log(
      `  ${t.id.slice(0, 8)}... | Resource: ${t.resourceId ?? '(none)'} | Title: ${t.title ?? '(none)'} | Updated: ${t.updatedAt}`,
    );

    // Count messages
    const msgs = await memStore.listMessages({ threadId: t.id, perPage: 5 });
    console.log(`    └── Messages: ${msgs.total} (showing last ${msgs.messages.length})`);
    for (const m of msgs.messages) {
      const content =
        typeof m.content === 'string'
          ? m.content.slice(0, 80)
          : JSON.stringify(m.content).slice(0, 80);
      console.log(`        ${m.role}: ${content}...`);
    }
  }

  console.log(`\n  Total threads: ${result.total}`);

  // Check working memory
  const wmThread = result.threads.find((t) => t.resourceId?.startsWith('test-memory'));
  if (wmThread) {
    const wm = await memory.getWorkingMemory({
      threadId: wmThread.id,
      resourceId: wmThread.resourceId ?? '',
    });
    console.log(`\n=== WORKING MEMORY (${wmThread.resourceId}) ===`);
    if (wm) {
      try {
        console.log(JSON.stringify(JSON.parse(wm), null, 2).slice(0, 800));
      } catch {
        console.log(wm.slice(0, 800));
      }
    } else {
      console.log('  (no working memory)');
    }
  }
}

main().catch(console.error);
