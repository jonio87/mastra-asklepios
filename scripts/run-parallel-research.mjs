#!/usr/bin/env node
/**
 * Run 3 adversarial Parallel.ai deep research agents (advocate/skeptic/unbiased)
 * using the research brief v2 as input.
 *
 * Usage: node scripts/run-parallel-research.mjs
 *
 * Reads PARALLEL_AI_API_KEY from .env file.
 * Saves outputs to research/parallel-ai-{role}-v2.md
 *
 * API reference:
 *   POST /v1/tasks/runs           — create task (returns run_id)
 *   GET  /v1/tasks/runs/{run_id}  — poll status
 *   GET  /v1/tasks/runs/{run_id}/result — blocking result retrieval
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env
config({ path: resolve(ROOT, '.env') });

const API_KEY = process.env.PARALLEL_AI_API_KEY;
if (!API_KEY) {
  console.error('ERROR: PARALLEL_AI_API_KEY not found in .env');
  process.exit(1);
}

const API_BASE = 'https://api.parallel.ai/v1/tasks/runs';
const POLL_INTERVAL_MS = 15_000; // 15 seconds between polls
const TIMEOUT_MS = 45 * 60_000; // 45 minutes max (Parallel docs: deep research can take up to 45 min)

// Read the research brief
const briefPath = resolve(ROOT, 'research/research-brief-v2-input.md');
const fullBrief = readFileSync(briefPath, 'utf-8');

// Extract clinical data (everything before "## ADVERSARIAL AGENT PROMPTS")
const promptsSectionIdx = fullBrief.indexOf('## ADVERSARIAL AGENT PROMPTS');
const clinicalData = promptsSectionIdx > 0
  ? fullBrief.substring(0, promptsSectionIdx).trim()
  : fullBrief;

// Extract role-specific prompt section
function extractPrompt(role) {
  const titles = {
    advocate: '### Advocate Agent Prompt',
    skeptic: '### Skeptic Agent Prompt',
    unbiased: '### Unbiased Agent Prompt',
  };
  const startMarker = titles[role];
  const startIdx = fullBrief.indexOf(startMarker);
  if (startIdx < 0) {
    console.error(`Could not find "${startMarker}" in research brief`);
    process.exit(1);
  }

  const afterTitle = startIdx + startMarker.length;
  const nextSection = fullBrief.indexOf('\n### ', afterTitle);
  return fullBrief.substring(afterTitle, nextSection > 0 ? nextSection : fullBrief.length).trim();
}

// Build input for each role, staying under 15,000 chars
function buildInput(role) {
  const rolePrompt = extractPrompt(role);
  const header = `# ADVERSARIAL DEEP RESEARCH — ${role.toUpperCase()} PERSPECTIVE\n\n${rolePrompt}\n\n---\n\n# COMPLETE CLINICAL DATA (254 Medical Records, 2009–2025)\n\n`;

  const maxClinical = 14800 - header.length;
  const trimmedClinical = clinicalData.length > maxClinical
    ? clinicalData.substring(0, maxClinical) + '\n\n[... clinical data trimmed for API input limit ...]'
    : clinicalData;

  const input = header + trimmedClinical;
  console.log(`[${role}] Input assembled: ${input.length} chars (limit: 15000)`);
  return input;
}

// Create a task run via POST /v1/tasks/runs
async function createTask(input, role) {
  console.log(`[${role}] Creating task run...`);

  const body = {
    input,
    processor: 'ultra',
    task_spec: {
      output_schema: {
        type: 'text',
        description: `Comprehensive adversarial medical research report from the ${role} perspective. Include literature citations, probability estimates, and specific clinical recommendations. Format as detailed markdown.`
      }
    }
  };

  const resp = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'unknown');
    console.error(`[${role}] Task creation FAILED (HTTP ${resp.status}): ${errText}`);
    return null;
  }

  const data = await resp.json();
  const runId = data.run_id;
  if (!runId) {
    console.error(`[${role}] No run_id in response:`, JSON.stringify(data).substring(0, 500));
    return null;
  }

  console.log(`[${role}] Task created: run_id=${runId}`);
  return runId;
}

// Poll task status via GET /v1/tasks/runs/{run_id}
async function pollTask(runId, role) {
  const startTime = Date.now();
  const deadline = startTime + TIMEOUT_MS;
  let lastStatus = '';

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    try {
      const resp = await fetch(`${API_BASE}/${runId}`, {
        method: 'GET',
        headers: { 'x-api-key': API_KEY },
      });

      if (!resp.ok) {
        console.warn(`[${role}] Poll failed (HTTP ${resp.status}), retrying... [${elapsed}s]`);
        continue;
      }

      const data = await resp.json();
      const status = data.status || 'unknown';

      if (status !== lastStatus) {
        console.log(`[${role}] Status: ${status} [${elapsed}s elapsed]`);
        lastStatus = status;
      }

      if (status === 'completed') {
        // Fetch full result from /result endpoint
        return await fetchResult(runId, role);
      }

      if (status === 'failed' || status === 'error') {
        console.error(`[${role}] Task FAILED:`, data.errors || data.error || 'unknown error');
        return null;
      }
    } catch (err) {
      console.warn(`[${role}] Poll error: ${err.message}, retrying... [${elapsed}s]`);
    }
  }

  console.error(`[${role}] Task TIMED OUT after ${TIMEOUT_MS / 60_000} minutes`);
  return null;
}

// Fetch completed result via GET /v1/tasks/runs/{run_id}/result
async function fetchResult(runId, role) {
  console.log(`[${role}] Fetching result...`);

  const resp = await fetch(`${API_BASE}/${runId}/result`, {
    method: 'GET',
    headers: { 'x-api-key': API_KEY },
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'unknown');
    console.error(`[${role}] Result fetch FAILED (HTTP ${resp.status}): ${errText}`);
    return null;
  }

  const data = await resp.json();
  return data;
}

// Save result to markdown file
function saveResult(role, data) {
  // For text output_schema, result is typically a string in data.output
  // For auto schema, it's in data.output.content
  let reportText = '';

  if (typeof data.output === 'string') {
    reportText = data.output;
  } else if (data.output && typeof data.output.content === 'string') {
    reportText = data.output.content;
  } else if (data.output && typeof data.output === 'object') {
    // Auto schema mode — try to extract text from nested structure
    reportText = JSON.stringify(data.output, null, 2);
  } else if (typeof data.result === 'string') {
    reportText = data.result;
  } else {
    reportText = JSON.stringify(data, null, 2);
  }

  // Extract basis/citations if available
  const basis = data.output?.basis || data.basis || [];
  const citations = [];
  if (Array.isArray(basis)) {
    for (const b of basis) {
      if (b.citations && Array.isArray(b.citations)) {
        for (const c of b.citations) {
          if (c.url && !citations.some(x => x.url === c.url)) {
            citations.push({
              url: c.url,
              title: c.title || '',
              excerpt: (c.excerpts || []).join(' ').substring(0, 200),
            });
          }
        }
      }
    }
  }

  // Build output markdown
  let md = `# Parallel.ai Deep Research — ${role.charAt(0).toUpperCase() + role.slice(1)} Agent (v2)\n\n`;
  md += `**Generated:** ${new Date().toISOString().split('T')[0]}\n`;
  md += `**Processor:** ultra\n`;
  md += `**Based on:** 254 medical records (2009–2025)\n`;
  md += `**Role:** ${role}\n\n`;
  md += `---\n\n`;
  md += reportText;

  if (citations.length > 0) {
    md += '\n\n---\n\n## Sources\n\n';
    for (const c of citations) {
      md += `- [${c.title || c.url}](${c.url})${c.excerpt ? ` — ${c.excerpt}` : ''}\n`;
    }
  }

  const outPath = resolve(ROOT, `research/parallel-ai-${role}-v2.md`);
  writeFileSync(outPath, md, 'utf-8');
  console.log(`[${role}] ✅ Saved to research/parallel-ai-${role}-v2.md (${md.length} chars)`);
  return true;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Parallel.ai Adversarial Research Runner (v2)   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`API Key: ${API_KEY.substring(0, 8)}...${API_KEY.substring(API_KEY.length - 4)}`);
  console.log(`Clinical data: ${clinicalData.length} chars`);
  console.log(`Timeout: ${TIMEOUT_MS / 60_000} minutes per task`);
  console.log();

  const roles = ['advocate', 'skeptic', 'unbiased'];

  // Create all 3 tasks in parallel
  console.log('=== Phase 1: Creating tasks ===\n');
  const tasks = await Promise.all(
    roles.map(async (role) => {
      const input = buildInput(role);
      const runId = await createTask(input, role);
      return { role, runId };
    })
  );

  const failed = tasks.filter(t => !t.runId);
  if (failed.length === tasks.length) {
    console.error('\n❌ ALL tasks failed to create. Check API key and network.');
    process.exit(1);
  }
  if (failed.length > 0) {
    console.warn(`\n⚠️  Failed to create: ${failed.map(t => t.role).join(', ')}`);
  }

  const active = tasks.filter(t => t.runId);
  console.log(`\n=== Phase 2: Polling ${active.length} tasks ===\n`);

  // Poll all tasks in parallel
  const results = await Promise.all(
    active.map(async ({ role, runId }) => {
      const result = await pollTask(runId, role);
      if (result) {
        const saved = saveResult(role, result);
        return { role, success: saved };
      }
      return { role, success: false };
    })
  );

  // Summary
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║                    RESULTS                       ║');
  console.log('╠══════════════════════════════════════════════════╣');
  for (const r of results) {
    console.log(`║  ${r.role.padEnd(12)} ${r.success ? '✅ SUCCESS' : '❌ FAILED'}${' '.repeat(25)}║`);
  }
  console.log('╚══════════════════════════════════════════════════╝');

  if (!results.every(r => r.success)) {
    console.error('\n⚠️  Some tasks failed. Check output above for details.');
    process.exit(1);
  }

  console.log('\n✅ All 3 adversarial reports generated successfully!');
  console.log('Output files:');
  for (const role of roles) {
    console.log(`  → research/parallel-ai-${role}-v2.md`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
