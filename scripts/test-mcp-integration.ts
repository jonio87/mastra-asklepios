#!/usr/bin/env npx tsx
/**
 * Integration test: exercises the MCP server end-to-end via Client SDK.
 *
 * Usage:  npx tsx scripts/test-mcp-integration.ts
 *
 * Connects to the Asklepios MCP server over stdio, then tests:
 *  1. Tool listing (expect 17 tools)
 *  2. Resource listing (expect 7 resources)
 *  3. Prompt listing (expect 4 prompts)
 *  4. Static resources (system://health, system://agents, system://workflows)
 *  5. Individual tool calls (search_pubmed, lookup_orphanet, map_symptoms, etc.)
 *  6. Agent invocation tools (invoke_phenotype_agent, etc.)
 *  7. State inspection tools
 *  8. Workflow execution + HITL suspend/resume
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ── Helpers ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(label: string) {
  passed++;
  process.stderr.write(`  ✅ ${label}\n`);
}

function fail(label: string, reason: string) {
  failed++;
  failures.push(`${label}: ${reason}`);
  process.stderr.write(`  ❌ ${label} — ${reason}\n`);
}

function assert(condition: boolean, label: string, reason = 'assertion failed') {
  if (condition) ok(label);
  else fail(label, reason);
}

function section(name: string) {
  process.stderr.write(`\n── ${name} ${'─'.repeat(60 - name.length)}\n`);
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  process.stderr.write('🏥 Asklepios MCP Integration Test\n');
  process.stderr.write('='.repeat(60) + '\n');

  // Connect to MCP server via stdio
  section('Connection');
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp/stdio.js'],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client({ name: 'asklepios-test', version: '1.0.0' });
  await client.connect(transport);
  ok('Connected to MCP server');

  // ── 1. Tool listing ───────────────────────────────────────────
  section('Tool Listing');
  const tools = await client.listTools();
  assert(tools.tools.length >= 17, `Found ${tools.tools.length} tools (expect ≥17)`);

  const toolNames = tools.tools.map((t) => t.name);
  const expectedTools = [
    'ask_asklepios', 'search_pubmed', 'lookup_orphanet', 'map_symptoms', 'recall_brain',
    'invoke_phenotype_agent', 'invoke_research_agent', 'invoke_synthesis_agent', 'invoke_brain_agent',
    'run_patient_intake', 'run_diagnostic_research', 'resume_workflow',
    'get_working_memory', 'list_threads', 'get_thread_messages', 'parse_document', 'deep_research',
  ];
  for (const name of expectedTools) {
    assert(toolNames.includes(name), `Tool: ${name}`, `missing from tool list`);
  }

  // ── 2. Resource listing ───────────────────────────────────────
  section('Resource Listing');
  const resources = await client.listResources();
  const resourceUris = resources.resources.map((r) => r.uri);
  process.stderr.write(`  Found ${resources.resources.length} static resources\n`);

  const templates = await client.listResourceTemplates();
  process.stderr.write(`  Found ${templates.resourceTemplates.length} resource templates\n`);

  const totalResources = resources.resources.length + templates.resourceTemplates.length;
  assert(totalResources >= 7, `Total resources: ${totalResources} (expect ≥7)`);

  // ── 3. Prompt listing ─────────────────────────────────────────
  section('Prompt Listing');
  const prompts = await client.listPrompts();
  assert(prompts.prompts.length >= 4, `Found ${prompts.prompts.length} prompts (expect ≥4)`);

  const promptNames = prompts.prompts.map((p) => p.name);
  for (const name of ['diagnose_patient', 'review_case', 'compare_patients', 'test_scenario']) {
    assert(promptNames.includes(name), `Prompt: ${name}`, `missing from prompt list`);
  }

  // ── 4. Static resources ───────────────────────────────────────
  section('Static Resources');

  try {
    const health = await client.readResource({ uri: 'system://health' });
    const healthContent = health.contents[0];
    if (healthContent && 'text' in healthContent) {
      const healthData = JSON.parse(healthContent.text as string);
      assert(typeof healthData.agents?.count === 'number', 'system://health has agents.count');
      assert(typeof healthData.workflows?.count === 'number', 'system://health has workflows.count');
      process.stderr.write(`    agents: ${healthData.agents?.count}, workflows: ${healthData.workflows?.count}, status: ${healthData.status}\n`);
    }
  } catch (e) {
    fail('system://health', String(e));
  }

  try {
    const agents = await client.readResource({ uri: 'system://agents' });
    const agentsContent = agents.contents[0];
    if (agentsContent && 'text' in agentsContent) {
      const agentsData = JSON.parse(agentsContent.text as string);
      assert(Array.isArray(agentsData.agents), 'system://agents returns agent array');
      assert(agentsData.agents.length >= 5, `system://agents has ${agentsData.agents.length} agents (expect ≥5)`);
    }
  } catch (e) {
    fail('system://agents', String(e));
  }

  try {
    const workflows = await client.readResource({ uri: 'system://workflows' });
    const wfContent = workflows.contents[0];
    if (wfContent && 'text' in wfContent) {
      const wfData = JSON.parse(wfContent.text as string);
      assert(Array.isArray(wfData.workflows), 'system://workflows returns workflow array');
      process.stderr.write(`    workflows: ${JSON.stringify(wfData.workflows.map((w: { id: string }) => w.id))}\n`);
    }
  } catch (e) {
    fail('system://workflows', String(e));
  }

  try {
    const memStats = await client.readResource({ uri: 'system://memory/stats' });
    const memContent = memStats.contents[0];
    if (memContent && 'text' in memContent) {
      const memData = JSON.parse(memContent.text as string);
      assert(typeof memData.totalThreads === 'number', 'system://memory/stats has totalThreads');
      process.stderr.write(`    totalThreads: ${memData.totalThreads}\n`);
    }
  } catch (e) {
    fail('system://memory/stats', String(e));
  }

  // ── 5. Core tool calls ────────────────────────────────────────
  section('Core Tools');

  // map_symptoms — fast local tool
  try {
    const mapResult = await client.callTool({
      name: 'map_symptoms',
      arguments: { symptoms: ['joint hypermobility', 'skin hyperextensibility', 'easy bruising'] },
    });
    const mapContent = mapResult.content as Array<{ type: string; text?: string }>;
    const mapText = mapContent.find(c => c.type === 'text')?.text ?? '';
    const mapData = JSON.parse(mapText);
    assert(Array.isArray(mapData.mappings), 'map_symptoms returns mappings array');
    assert(mapData.mappings.length === 3, `map_symptoms mapped ${mapData.mappings.length} symptoms (expect 3)`);
    process.stderr.write(`    First mapping: ${mapData.mappings[0]?.symptom} → ${mapData.mappings[0]?.hpoTerms?.[0]?.name ?? 'none'}\n`);
    ok('map_symptoms executes successfully');
  } catch (e) {
    fail('map_symptoms', String(e));
  }

  // search_pubmed — external API
  try {
    const pubmedResult = await client.callTool({
      name: 'search_pubmed',
      arguments: { query: 'Ehlers-Danlos syndrome hypermobility type', maxResults: 3 },
    });
    const pubmedContent = pubmedResult.content as Array<{ type: string; text?: string }>;
    const pubmedText = pubmedContent.find(c => c.type === 'text')?.text ?? '';
    const pubmedData = JSON.parse(pubmedText);
    assert(Array.isArray(pubmedData.articles), 'search_pubmed returns articles array');
    assert(pubmedData.articles.length > 0, `search_pubmed returned ${pubmedData.articles.length} articles`);
    process.stderr.write(`    Top article: ${pubmedData.articles[0]?.title?.substring(0, 60)}...\n`);
    ok('search_pubmed executes successfully');
  } catch (e) {
    fail('search_pubmed', String(e));
  }

  // lookup_orphanet — external API
  try {
    const orphaResult = await client.callTool({
      name: 'lookup_orphanet',
      arguments: { query: 'Ehlers-Danlos' },
    });
    const orphaContent = orphaResult.content as Array<{ type: string; text?: string }>;
    const orphaText = orphaContent.find(c => c.type === 'text')?.text ?? '';
    const orphaData = JSON.parse(orphaText);
    assert(Array.isArray(orphaData.diseases), 'lookup_orphanet returns diseases array');
    process.stderr.write(`    Found ${orphaData.diseases.length} diseases\n`);
    ok('lookup_orphanet executes successfully');
  } catch (e) {
    fail('lookup_orphanet', String(e));
  }

  // parse_document — raw tool access
  try {
    const parseResult = await client.callTool({
      name: 'parse_document',
      arguments: {
        text: 'Patient: John Doe, 34M. Chief Complaint: Joint pain, fatigue. Diagnosed with suspected Ehlers-Danlos Syndrome. Medications: ibuprofen 400mg daily. Lab: CRP elevated.',
      },
    });
    const parseContent = parseResult.content as Array<{ type: string; text?: string }>;
    const parseText = parseContent.find(c => c.type === 'text')?.text ?? '';
    const parseData = JSON.parse(parseText);
    assert(parseData.documentType !== undefined, 'parse_document returns documentType');
    assert(Array.isArray(parseData.symptoms), `parse_document extracted ${parseData.symptoms?.length} symptoms`);
    process.stderr.write(`    docType: ${parseData.documentType}, symptoms: ${parseData.symptoms?.join(', ')}\n`);
    ok('parse_document executes successfully');
  } catch (e) {
    fail('parse_document', String(e));
  }

  // recall_brain — cross-patient intelligence
  try {
    const recallResult = await client.callTool({
      name: 'recall_brain',
      arguments: { symptoms: ['joint hypermobility', 'chronic fatigue'] },
    });
    const recallContent = recallResult.content as Array<{ type: string; text?: string }>;
    const recallText = recallContent.find(c => c.type === 'text')?.text ?? '';
    const recallData = JSON.parse(recallText);
    assert(Array.isArray(recallData.patterns), 'recall_brain returns patterns array');
    assert(typeof recallData.recommendation === 'string', 'recall_brain returns recommendation');
    process.stderr.write(`    totalCases: ${recallData.totalCasesInBrain}, patterns: ${recallData.patterns.length}\n`);
    ok('recall_brain executes successfully');
  } catch (e) {
    fail('recall_brain', String(e));
  }

  // ── 6. Agent invocation tools ─────────────────────────────────
  section('Agent Invocation');

  // invoke_phenotype_agent
  try {
    process.stderr.write('  ⏳ invoke_phenotype_agent (LLM call, ~10-20s)...\n');
    const phenoResult = await client.callTool({
      name: 'invoke_phenotype_agent',
      arguments: {
        message: 'Extract phenotypes from: Patient has joint hypermobility, easy bruising, and chronic fatigue. Map to HPO terms.',
        patientId: 'test-integration-01',
      },
    });
    const phenoContent = phenoResult.content as Array<{ type: string; text?: string }>;
    const phenoText = phenoContent.find(c => c.type === 'text')?.text ?? '';
    assert(phenoText.length > 50, `invoke_phenotype_agent returned ${phenoText.length} chars`);
    process.stderr.write(`    Response preview: ${phenoText.substring(0, 100)}...\n`);
    ok('invoke_phenotype_agent executes successfully');
  } catch (e) {
    fail('invoke_phenotype_agent', String(e));
  }

  // invoke_brain_agent
  try {
    process.stderr.write('  ⏳ invoke_brain_agent (LLM call, ~10-20s)...\n');
    const brainResult = await client.callTool({
      name: 'invoke_brain_agent',
      arguments: {
        message: 'What patterns have you observed for patients presenting with joint hypermobility and chronic fatigue?',
      },
    });
    const brainContent = brainResult.content as Array<{ type: string; text?: string }>;
    const brainText = brainContent.find(c => c.type === 'text')?.text ?? '';
    assert(brainText.length > 50, `invoke_brain_agent returned ${brainText.length} chars`);
    process.stderr.write(`    Response preview: ${brainText.substring(0, 100)}...\n`);
    ok('invoke_brain_agent executes successfully');
  } catch (e) {
    fail('invoke_brain_agent', String(e));
  }

  // ── 7. State inspection tools ─────────────────────────────────
  section('State Inspection');

  try {
    const threadsResult = await client.callTool({
      name: 'list_threads',
      arguments: { resourceId: 'patient:test-integration-01', limit: 5 },
    });
    const threadsContent = threadsResult.content as Array<{ type: string; text?: string }>;
    const threadsText = threadsContent.find(c => c.type === 'text')?.text ?? '';
    const threadsData = JSON.parse(threadsText);
    assert(Array.isArray(threadsData.threads), 'list_threads returns threads array');
    process.stderr.write(`    Threads for test-integration-01: ${threadsData.threads.length}\n`);
    ok('list_threads executes successfully');

    // If threads exist, fetch messages from the first one
    if (threadsData.threads.length > 0) {
      const threadId = threadsData.threads[0].id;
      const msgsResult = await client.callTool({
        name: 'get_thread_messages',
        arguments: { threadId, limit: 5 },
      });
      const msgsContent = msgsResult.content as Array<{ type: string; text?: string }>;
      const msgsText = msgsContent.find(c => c.type === 'text')?.text ?? '';
      const msgsData = JSON.parse(msgsText);
      assert(Array.isArray(msgsData.messages), 'get_thread_messages returns messages array');
      process.stderr.write(`    Messages in thread: ${msgsData.messages.length}\n`);
      ok('get_thread_messages executes successfully');
    }
  } catch (e) {
    fail('list_threads / get_thread_messages', String(e));
  }

  // get_working_memory
  try {
    const wmResult = await client.callTool({
      name: 'get_working_memory',
      arguments: { resourceId: 'patient:test-integration-01' },
    });
    const wmContent = wmResult.content as Array<{ type: string; text?: string }>;
    const wmText = wmContent.find(c => c.type === 'text')?.text ?? '';
    process.stderr.write(`    Working memory response: ${wmText.substring(0, 100)}\n`);
    ok('get_working_memory executes successfully');
  } catch (e) {
    fail('get_working_memory', String(e));
  }

  // ── 8. Prompts ────────────────────────────────────────────────
  section('Prompts');

  try {
    const diagPrompt = await client.getPrompt({
      name: 'diagnose_patient',
      arguments: { patientId: 'test-patient-01', symptoms: 'joint hypermobility, easy bruising' },
    });
    assert(diagPrompt.messages.length > 0, `diagnose_patient prompt has ${diagPrompt.messages.length} messages`);
    ok('diagnose_patient prompt returns messages');
  } catch (e) {
    fail('diagnose_patient prompt', String(e));
  }

  try {
    const testPrompt = await client.getPrompt({
      name: 'test_scenario',
      arguments: { scenario: 'Verify EDS symptom extraction returns correct HPO mappings' },
    });
    assert(testPrompt.messages.length > 0, `test_scenario prompt has ${testPrompt.messages.length} messages`);
    ok('test_scenario prompt returns messages');
  } catch (e) {
    fail('test_scenario prompt', String(e));
  }

  // ── 9. ask_asklepios — full orchestrator chat ─────────────────
  section('Orchestrator (ask_asklepios)');

  try {
    process.stderr.write('  ⏳ ask_asklepios with diagnostic query (LLM + tools, ~20-30s)...\n');
    const askResult = await client.callTool({
      name: 'ask_asklepios',
      arguments: {
        message: 'I have a patient with joint hypermobility, skin hyperextensibility, and easy bruising. Can you help identify potential diagnoses?',
        patientId: 'test-integration-02',
      },
    });
    const askContent = askResult.content as Array<{ type: string; text?: string }>;
    const askText = askContent.find(c => c.type === 'text')?.text ?? '';
    assert(askText.length > 100, `ask_asklepios returned ${askText.length} chars`);
    process.stderr.write(`    Response preview: ${askText.substring(0, 150)}...\n`);
    ok('ask_asklepios executes with diagnostic query');
  } catch (e) {
    fail('ask_asklepios', String(e));
  }

  // ── Summary ───────────────────────────────────────────────────
  section('RESULTS');
  process.stderr.write(`\n  ✅ Passed: ${passed}\n  ❌ Failed: ${failed}\n\n`);

  if (failures.length > 0) {
    process.stderr.write('  Failures:\n');
    for (const f of failures) {
      process.stderr.write(`    - ${f}\n`);
    }
  }

  process.stderr.write('\n');

  // Cleanup
  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n💥 Fatal error: ${err}\n`);
  process.exit(2);
});
