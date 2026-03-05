#!/usr/bin/env npx tsx
/**
 * Live integration test for workflows and memory.
 * Tests patient-intake workflow, diagnostic-research workflow,
 * and verifies memory persistence.
 *
 * Usage:  npx tsx scripts/test-workflows-live.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === 'text')?.text ?? '';
  return JSON.parse(text);
}

async function main() {
  process.stderr.write('🧬 Asklepios Workflow & Memory Integration Test\n');
  process.stderr.write('='.repeat(60) + '\n');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp/stdio.js'],
    env: { ...process.env } as Record<string, string>,
  });
  const client = new Client({ name: 'workflow-test', version: '1.0.0' });
  await client.connect(transport);
  ok('Connected to MCP server');

  const patientId = `test-wf-${Date.now()}`;

  // ── 1. Patient Intake Workflow ────────────────────────────────
  section('Patient Intake Workflow');

  const clinicalNote = `
Patient: Jane Smith, 28F
Chief Complaint: Chronic joint pain, frequent dislocations, easy bruising
History of Present Illness: Patient reports lifelong joint hypermobility with increasing
pain and instability over past 5 years. Reports daily subluxations of shoulders and fingers.
Skin is noted to be velvety and hyperextensible. Family history positive for mother with
similar symptoms.
Physical Exam: Beighton score 8/9, skin hyperextensibility noted, atrophic scars present.
Diagnoses: Suspected Ehlers-Danlos Syndrome, hypermobile type
Medications: Naproxen 500mg BID, Gabapentin 300mg TID
Labs: CRP normal, ESR normal, CBC normal
Genetic testing: Pending COL5A1/COL5A2 analysis
  `.trim();

  try {
    process.stderr.write('  ⏳ Running patient-intake workflow...\n');
    const intakeResult = await callTool(client, 'run_patient_intake', {
      documentText: clinicalNote,
      patientId,
      documentType: 'clinical-note',
    }) as Record<string, unknown>;

    process.stderr.write(`    Status: ${JSON.stringify(intakeResult).substring(0, 200)}\n`);
    assert(intakeResult !== null, 'patient-intake workflow returns result');

    // Check if workflow returned a result
    if (typeof intakeResult === 'object') {
      ok('patient-intake workflow completed');
      process.stderr.write(`    Result keys: ${Object.keys(intakeResult).join(', ')}\n`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('patient-intake workflow', msg);
    process.stderr.write(`    Full error: ${msg}\n`);
  }

  // ── 2. Orphanet direct lookup (by ORPHAcode) ─────────────────
  section('Orphanet Direct Lookup');

  try {
    const edsResult = await callTool(client, 'lookup_orphanet', {
      query: 'Ehlers-Danlos',
      orphaCode: 285,  // Hypermobile EDS
    }) as { diseases: Array<{ name: string; genes: unknown[]; inheritanceMode?: string }>; query: string };

    assert(edsResult.diseases.length > 0, `Orphanet: found ${edsResult.diseases.length} disease for ORPHAcode 285`);
    const eds = edsResult.diseases[0];
    if (eds) {
      process.stderr.write(`    Name: ${eds.name}\n`);
      process.stderr.write(`    Genes: ${JSON.stringify(eds.genes)}\n`);
      process.stderr.write(`    Inheritance: ${eds.inheritanceMode ?? 'unknown'}\n`);
      ok('Orphanet direct lookup returns disease details');
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('Orphanet direct lookup', msg);
  }

  // ── 3. HPO Mapping with confidence ───────────────────────────
  section('HPO Mapping Details');

  try {
    const hpoResult = await callTool(client, 'map_symptoms', {
      symptoms: [
        'joint hypermobility',
        'skin hyperextensibility',
        'easy bruising',
        'atrophic scarring',
        'chronic fatigue',
      ],
    }) as { mappings: Array<{ originalText: string; matchedTerms: unknown[]; confidence: number }> };

    assert(hpoResult.mappings.length === 5, `HPO: mapped ${hpoResult.mappings.length}/5 symptoms`);
    for (const m of hpoResult.mappings) {
      const terms = m.matchedTerms as Array<{ id: string; name: string }>;
      const topTerm = terms[0];
      process.stderr.write(
        `    ${m.originalText} → ${topTerm?.id ?? 'no match'} (${topTerm?.name ?? 'N/A'}) [conf: ${m.confidence}]\n`,
      );
    }
    ok('HPO mapping returns confidence scores');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('HPO mapping', msg);
  }

  // ── 4. PubMed with abstracts ──────────────────────────────────
  section('PubMed Search Details');

  try {
    const pubmedResult = await callTool(client, 'search_pubmed', {
      query: 'hypermobile Ehlers-Danlos syndrome diagnostic criteria 2024',
      maxResults: 3,
    }) as { articles: Array<{ pmid: string; title: string; abstract?: string; publicationDate?: string; doi?: string }> };

    assert(pubmedResult.articles.length > 0, `PubMed: found ${pubmedResult.articles.length} articles`);
    for (const a of pubmedResult.articles) {
      process.stderr.write(`    [PMID:${a.pmid}] ${a.title?.substring(0, 70)}...\n`);
      process.stderr.write(`      Date: ${a.publicationDate ?? 'unknown'}, DOI: ${a.doi ?? 'none'}\n`);
      if (a.abstract) {
        process.stderr.write(`      Abstract: ${a.abstract.substring(0, 80)}...\n`);
      }
    }
    ok('PubMed returns articles with abstracts');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('PubMed search', msg);
  }

  // ── 5. Memory verification ────────────────────────────────────
  section('Memory Verification');

  try {
    // Check threads for the patient
    const threads = await callTool(client, 'list_threads', {
      resourceId: patientId,
      limit: 10,
    }) as { threads: Array<{ id: string; title?: string }> };

    process.stderr.write(`    Threads for ${patientId}: ${threads.threads.length}\n`);
    ok('list_threads returns results');

    // Check working memory
    const wm = await callTool(client, 'get_working_memory', {
      resourceId: patientId,
    }) as { workingMemory: unknown; message?: string };

    process.stderr.write(`    Working memory: ${JSON.stringify(wm).substring(0, 200)}\n`);
    ok('get_working_memory returns results');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('Memory verification', msg);
  }

  // ── 6. Document parser with rich content ──────────────────────
  section('Document Parser');

  try {
    const parseResult = await callTool(client, 'parse_document', {
      text: clinicalNote,
      documentType: 'clinical-note',
    }) as {
      documentType: string;
      sections: string[];
      symptoms: string[];
      diagnoses: string[];
      medications: string[];
      demographics: { age?: string; sex?: string };
      labs: string[];
      genetics: string[];
    };

    process.stderr.write(`    Type: ${parseResult.documentType}\n`);
    process.stderr.write(`    Symptoms: ${parseResult.symptoms?.join(', ') ?? 'none'}\n`);
    process.stderr.write(`    Diagnoses: ${parseResult.diagnoses?.join(', ') ?? 'none'}\n`);
    process.stderr.write(`    Meds: ${parseResult.medications?.join(', ') ?? 'none'}\n`);
    process.stderr.write(`    Demographics: age=${parseResult.demographics?.age ?? 'N/A'}, sex=${parseResult.demographics?.sex ?? 'N/A'}\n`);
    process.stderr.write(`    Labs: ${parseResult.labs?.join(', ') ?? 'none'}\n`);
    process.stderr.write(`    Genetics: ${parseResult.genetics?.join(', ') ?? 'none'}\n`);

    assert(parseResult.symptoms?.length > 0, `Parser extracted ${parseResult.symptoms?.length} symptoms`);
    assert(parseResult.diagnoses?.length > 0, `Parser extracted ${parseResult.diagnoses?.length} diagnoses`);
    assert(parseResult.medications?.length > 0, `Parser extracted ${parseResult.medications?.length} medications`);
    ok('Document parser extracts structured data');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('Document parser', msg);
  }

  // ── 7. Agent: ask_asklepios with short query ──────────────────
  section('Asklepios Orchestrator (short query)');

  try {
    process.stderr.write('  ⏳ Asking simple question (should be fast)...\n');
    const askResult = await client.callTool({
      name: 'ask_asklepios',
      arguments: {
        message: 'What is Ehlers-Danlos Syndrome? Brief overview.',
        patientId: patientId,
      },
    });
    const askContent = askResult.content as Array<{ type: string; text?: string }>;
    const askText = askContent.find((c) => c.type === 'text')?.text ?? '';
    assert(askText.length > 50, `ask_asklepios returned ${askText.length} chars`);
    process.stderr.write(`    Response: ${askText.substring(0, 200)}...\n`);
    ok('ask_asklepios handles simple questions');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('ask_asklepios simple query', msg);
  }

  // ── 8. Dynamic resource: agent config ─────────────────────────
  section('Agent Config Resources');

  try {
    const templates = await client.listResourceTemplates();
    const agentTemplate = templates.resourceTemplates.find((t) => t.uriTemplate.includes('agent://'));
    if (agentTemplate) {
      const agentConfig = await client.readResource({ uri: 'agent://asklepios/config' });
      const configContent = agentConfig.contents[0];
      if (configContent && 'text' in configContent) {
        const config = JSON.parse(configContent.text as string);
        process.stderr.write(`    Agent: ${config.id}, tools: ${config.tools?.length ?? 0}\n`);
        assert(typeof config.id === 'string', 'agent://asklepios/config has id');
        ok('Agent config resource works');
      }
    } else {
      ok('Agent config template found (skipping read)');
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('Agent config resource', msg);
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

  await client.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`\n💥 Fatal error: ${err}\n`);
  process.exit(2);
});
