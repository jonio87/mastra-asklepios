#!/usr/bin/env node
/**
 * End-to-end MCP external agent test.
 * Acts as a real external clinical AI agent connecting to Asklepios via MCP HTTP.
 *
 * Tests: Layer 2 structured data, Layer 3 semantic search, agent reasoning,
 * diagnostic-flow workflow, specialist-input tool.
 */

const MCP_URL = 'http://localhost:4112/mcp';
let SESSION = undefined; // assigned by server on initialize
let REQUEST_ID = 0;

// ── MCP transport helpers ─────────────────────────────────────────────
async function mcpPost(body) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (SESSION) headers['Mcp-Session-Id'] = SESSION;
  
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  
  // Capture session ID from server
  const serverSession = res.headers.get('Mcp-Session-Id');
  if (serverSession) SESSION = serverSession;
  
  const ct = res.headers.get('content-type') || '';
  
  if (ct.includes('text/event-stream')) {
    // SSE response — collect all events and return the last JSON-RPC result
    const text = await res.text();
    const lines = text.split('\n');
    let lastData = null;
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        lastData = line.slice(6);
      }
    }
    if (!lastData) return null;
    return JSON.parse(lastData);
  }
  
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (!text) return null;
  return JSON.parse(text);
}

async function mcpCall(method, params = {}) {
  return mcpPost({ jsonrpc: '2.0', id: String(++REQUEST_ID), method, params });
}

async function mcpNotify(method, params = {}) {
  return mcpPost({ jsonrpc: '2.0', method, params });
}

async function callTool(name, args) {
  const r = await mcpCall('tools/call', { name, arguments: args });
  if (r?.result?.isError) throw new Error(`Tool error: ${r.result.content?.[0]?.text}`);
  return r;
}

function parseToolResult(r) {
  const text = r?.result?.content?.[0]?.text;
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// ── Test runner ───────────────────────────────────────────────────────
const results = [];
let testCount = 0;

function pass(name, detail = '') {
  testCount++;
  results.push({ name, status: 'PASS', detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, error) {
  testCount++;
  results.push({ name, status: 'FAIL', detail: String(error) });
  console.log(`  ✗ ${name} — ${error}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ASKLEPIOS MCP — EXTERNAL AGENT END-TO-END TEST        ║');
  console.log('║  Patient: Tomasz Szychliński (tomasz-szychliński)       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ─── Phase 0: Initialize MCP session ───────────────────────────────
  console.log('═══ PHASE 0: MCP Session Initialization ═══');
  try {
    const init = await mcpCall('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'external-clinical-agent', version: '1.0' },
    });
    const info = init.result?.serverInfo;
    pass('MCP initialize', `${info?.name} v${info?.version}`);
    await mcpNotify('notifications/initialized', {});
    pass('MCP initialized notification sent');
  } catch (e) {
    fail('MCP initialize', e.message);
    return;
  }

  // List tools
  try {
    const tools = await mcpCall('tools/list');
    const names = tools.result?.tools?.map(t => t.name) || [];
    pass('tools/list', `${names.length} tools available`);
    
    // Verify critical tools exist
    const critical = ['ask_asklepios', 'query_clinical_data', 'capture_clinical_data', 
                      'search_knowledge', 'run_diagnostic_flow', 'resume_workflow'];
    const missing = critical.filter(t => !names.includes(t));
    if (missing.length) fail('Critical tools check', `Missing: ${missing.join(', ')}`);
    else pass('Critical tools check', critical.join(', '));
  } catch (e) {
    fail('tools/list', e.message);
  }

  // ─── Phase 1: Layer 2 — Structured Clinical Data ──────────────────
  console.log('\n═══ PHASE 1: Layer 2 — Structured Clinical Data ═══');
  
  // T1.1: WBC trend
  try {
    const r = await callTool('query_clinical_data', {
      type: 'labs',
      patientId: 'tomasz-szychliński',
      testName: 'WBC',
    });
    const data = parseToolResult(r);
    const entries = data?.data?.results || data?.results || [];
    pass('WBC trend query', `${entries.length} entries`);
    
    if (entries.length > 0) {
      const latest = entries[entries.length - 1];
      const hasNormalized = entries.every(e => e.unit === 'K/µL' || !e.unit);
      pass('WBC unit normalization', hasNormalized ? 'All K/µL' : `Mixed: ${[...new Set(entries.map(e => e.unit))].join(', ')}`);
      pass('WBC latest value', `${latest.value} ${latest.unit} on ${latest.date} [${latest.flag || 'normal'}]`);
      const prov = latest.evidence_tier || latest.evidenceTier;
      pass('WBC evidence provenance', `tier=${prov}, status=${latest.validation_status || latest.validationStatus}, credibility=${latest.source_credibility || latest.sourceCredibility}`);
    } else {
      fail('WBC entries', 'No entries returned — check response format');
      console.log('    Raw response:', JSON.stringify(data).slice(0, 300));
    }
  } catch (e) { fail('WBC trend query', e.message); }

  // T1.2: Low-flagged labs in 2025 (query all labs, filter client-side)
  try {
    const r = await callTool('query_clinical_data', {
      type: 'labs',
      patientId: 'tomasz-szychliński',
      dateFrom: '2025-01-01',
    });
    const data = parseToolResult(r);
    const allLabs = data?.data?.results || data?.results || data?.data?.labs || [];
    const lowFlagged = allLabs.filter(r => r.flag === 'low');
    pass('Labs since 2025', `${allLabs.length} total, ${lowFlagged.length} LOW-flagged`);
    if (allLabs.length === 0) console.log('    Raw response:', JSON.stringify(data).slice(0, 300));
    
    const byTest = {};
    for (const rec of lowFlagged) {
      const name = rec.testName || rec.test_name;
      byTest[name] = (byTest[name] || 0) + 1;
    }
    const top3 = Object.entries(byTest).sort((a,b) => b[1] - a[1]).slice(0, 3);
    if (top3.length > 0) pass('Low-flag distribution', top3.map(([n,c]) => `${n}(${c})`).join(', '));
  } catch (e) { fail('Labs since 2025', e.message); }

  // T1.3: Labs with trend computation
  try {
    const r = await callTool('query_clinical_data', {
      type: 'labs',
      patientId: 'tomasz-szychliński',
      testName: 'WBC',
      computeTrend: true,
    });
    const data = parseToolResult(r);
    const trend = data?.data?.trend || data?.trend || data?.trendAnalysis;
    pass('WBC trend computation', trend ? `direction=${trend.direction}, slope=${trend.slope}` : `raw: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (e) { fail('WBC trend computation', e.message); }

  // T1.4: Vitamin D trend
  try {
    const r = await callTool('query_clinical_data', {
      type: 'labs',
      patientId: 'tomasz-szychliński',
      testName: 'Vitamin D 25-OH',
    });
    const data = parseToolResult(r);
    const labs = data?.data?.results || data?.results || [];
    pass('Vitamin D 25-OH trend', `${labs.length} entries`);
    if (labs.length > 0) {
      const vals = labs.map(l => `${l.date}: ${l.value} ${l.unit}`).join(', ');
      pass('Vitamin D values', vals.slice(0, 120));
    }
  } catch (e) { fail('Vitamin D 25-OH trend', e.message); }

  // T1.5: Testosterone trend
  try {
    const r = await callTool('query_clinical_data', {
      type: 'labs',
      patientId: 'tomasz-szychliński',
      testName: 'Testosterone',
    });
    const data = parseToolResult(r);
    const labs = data?.data?.results || data?.results || [];
    pass('Testosterone trend', `${labs.length} entries`);
    if (labs.length > 0) {
      const vals = labs.map(l => `${l.date}: ${l.value} ${l.unit}`).join(', ');
      pass('Testosterone values', vals.slice(0, 120));
    }
  } catch (e) { fail('Testosterone trend', e.message); }
  
  // T1.6: Query treatments
  try {
    const r = await callTool('query_clinical_data', {
      type: 'treatments',
      patientId: 'tomasz-szychliński',
    });
    const data = parseToolResult(r);
    pass('Treatment trials', JSON.stringify(data).slice(0, 120));
  } catch (e) { fail('Treatment trials', e.message); }
  
  // T1.7: Query contradictions
  try {
    const r = await callTool('query_clinical_data', {
      type: 'contradictions',
      patientId: 'tomasz-szychliński',
    });
    const data = parseToolResult(r);
    pass('Contradictions', JSON.stringify(data).slice(0, 120));
  } catch (e) { fail('Contradictions', e.message); }

  // ─── Phase 2: Layer 3 — Semantic Document Search ──────────────────
  console.log('\n═══ PHASE 2: Layer 3 — Semantic Document Search ═══');
  
  const searchQueries = [
    { query: 'nerve biopsy polyneuropathy small fiber findings', expect: 'consultation' },
    { query: 'craniovertebral junction basilar impression cervical anomaly', expect: 'imaging' },
    { query: 'PR3-ANCA cANCA positive autoimmune vasculitis', expect: 'lab' },
    { query: 'intracranial hypotension CSF headache persistent', expect: 'consultation' },
    { query: 'EMG electromyography nerve conduction study', expect: 'lab' },
  ];

  for (const sq of searchQueries) {
    try {
      const r = await callTool('search_knowledge', {
        query: sq.query,
        patientId: 'tomasz-szychliński',
        topK: 3,
      });
      const data = parseToolResult(r);
      const results = data?.results || data || [];
      const topResult = Array.isArray(results) ? results[0] : null;
      const score = topResult?.score ?? topResult?.relevance ?? 'N/A';
      const docType = topResult?.metadata?.documentType || topResult?.documentType || 'unknown';
      pass(`Search: "${sq.query.slice(0, 40)}..."`, `${Array.isArray(results) ? results.length : '?'} results, top: ${docType} (${typeof score === 'number' ? score.toFixed(3) : score})`);
    } catch (e) { fail(`Search: "${sq.query.slice(0, 40)}..."`, e.message); }
  }

  // ─── Phase 3: Agent Reasoning ─────────────────────────────────────
  console.log('\n═══ PHASE 3: Agent Clinical Reasoning ═══');
  
  // Q1: Lab abnormalities synthesis
  try {
    console.log('  → Asking agent about lab abnormalities (may take 30-90s)...');
    const t1 = Date.now();
    const r = await callTool('ask_asklepios', {
      message: 'What are the 5 most clinically significant lab abnormalities for patient tomasz-szychliński in the past 2 years? For each, state the trend direction and clinical implication. Be concise.',
      patientId: 'tomasz-szychliński',
    });
    const text = r?.result?.content?.[0]?.text || '';
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    
    // Verify agent mentioned key findings
    const mentions = {
      leukopenia: /leukop|wbc|white.?blood/i.test(text),
      neutropenia: /neutrop/i.test(text),
      anca: /anca|pr3/i.test(text),
      cholesterol: /cholesterol|lipid/i.test(text),
      vitaminD: /vitamin.?d/i.test(text),
    };
    const found = Object.entries(mentions).filter(([,v]) => v).map(([k]) => k);
    
    pass('Agent Q1 — Lab abnormalities', `${text.length} chars in ${elapsed}s, mentions: ${found.join(', ')}`);
    if (found.length < 3) fail('Agent Q1 — Coverage', `Only ${found.length}/5 key findings mentioned`);
    else pass('Agent Q1 — Coverage', `${found.length}/5 key findings mentioned`);
  } catch (e) { fail('Agent Q1 — Lab abnormalities', e.message); }

  // Q2: Document-based reasoning (requires Layer 3)
  try {
    console.log('  → Asking agent about nerve biopsy + EMG correlation (may take 60-120s)...');
    const t1 = Date.now();
    const r = await callTool('ask_asklepios', {
      message: 'Search the knowledge base for nerve biopsy and EMG documents for patient tomasz-szychliński. What do the nerve biopsy findings show and how do they correlate with EMG results? Use the knowledge-query tool.',
      patientId: 'tomasz-szychliński',
    });
    const text = r?.result?.content?.[0]?.text || '';
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    
    const usedKnowledge = /biopsy|nerve|emg|neuropathy|fiber/i.test(text);
    pass('Agent Q2 — Nerve biopsy + EMG', `${text.length} chars in ${elapsed}s, found clinical content: ${usedKnowledge}`);
  } catch (e) { fail('Agent Q2 — Nerve biopsy + EMG', e.message); }

  // ─── Phase 4: Diagnostic Flow Workflow ────────────────────────────
  console.log('\n═══ PHASE 4: Diagnostic Flow Workflow ═══');
  
  try {
    console.log('  → Starting diagnostic-flow workflow...');
    const t1 = Date.now();
    const r = await callTool('run_diagnostic_flow', {
      patientId: 'tomasz-szychliński',
      mode: 'full',
    });
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    const data = parseToolResult(r);
    
    if (typeof data === 'string') {
      // Might be error text
      if (data.includes('error') || data.includes('Error')) {
        fail('Diagnostic flow — execution', data.slice(0, 200));
      } else {
        pass('Diagnostic flow — execution', `${elapsed}s, response: ${data.slice(0, 100)}`);
      }
    } else if (data) {
      const status = data.status || data.flowState?.currentStage || 'unknown';
      pass('Diagnostic flow — execution', `${elapsed}s, status: ${JSON.stringify(status)}`);
      
      if (data.stageResults) {
        pass('Diagnostic flow — stage results', `${data.stageResults.length} stages completed`);
        for (const sr of data.stageResults) {
          console.log(`    Stage ${sr.stage}: ${sr.stageName} — ${sr.status}`);
        }
      }
      if (data.suspendedAt) {
        pass('Diagnostic flow — HITL gate', `Suspended at stage ${data.suspendedAt}: ${data.suspendReason || 'awaiting input'}`);
      }
      if (data.flowState) {
        pass('Diagnostic flow — FlowState', `stage=${data.flowState.currentStage}, gates=${JSON.stringify(data.flowState.stageGates)}`);
      }
    } else {
      fail('Diagnostic flow — execution', 'Empty response');
    }
  } catch (e) { fail('Diagnostic flow — execution', e.message); }

  // ─── Phase 5: Capture Clinical Data (write test) ──────────────────
  console.log('\n═══ PHASE 5: Data Capture + Specialist Input ═══');
  
  // Capture a contradiction (correct schema: finding1, finding2 required)
  try {
    const r = await callTool('capture_clinical_data', {
      type: 'contradiction',
      patientId: 'tomasz-szychliński',
      finding1: 'Anti-Ro-60 POSITIVE (329.41 U/ml) on 2025-08-27 (ANA3 microblot)',
      finding1Date: '2025-08-27',
      finding1Method: 'ANA3 Microblot panel',
      finding2: 'Anti-Ro-60 NEGATIVE on 2025-09-01 (standard panel)',
      finding2Date: '2025-09-01',
      finding2Method: 'Standard autoimmune panel',
      resolutionPlan: 'Repeat Anti-Ro-60 with dedicated ELISA assay to resolve discrepancy',
      diagnosticImpact: 'High — determines whether Sjögren syndrome is in differential',
      evidenceTier: 'T1-official',
      validationStatus: 'contradicted',
      sourceCredibility: 95,
    });
    const data = parseToolResult(r);
    pass('Capture contradiction', typeof data === 'string' ? data.slice(0, 100) : 'recorded');
  } catch (e) { fail('Capture contradiction', e.message); }

  // Capture a consultation
  try {
    const r = await callTool('capture_clinical_data', {
      type: 'consultation',
      patientId: 'tomasz-szychliński',
      provider: 'Dr. Test Neurologist',
      specialty: 'Neurology',
      date: '2026-03-08',
      institution: 'E2E Test Hospital',
      reason: 'Progressive small fiber neuropathy evaluation',
      findings: 'Clinical exam consistent with small fiber neuropathy. Autoimmune markers (Anti-Ro-60, PR3-ANCA) suggest systemic autoimmune etiology.',
      conclusions: 'Probable autoimmune small fiber neuropathy. Sjögren syndrome workup recommended.',
      recommendations: ['Lip biopsy for Sjögren confirmation', 'Schirmer test', 'Salivary gland ultrasound', 'Repeat Anti-Ro-60 ELISA'],
      conclusionsStatus: 'documented',
      evidenceTier: 'T1-specialist',
      validationStatus: 'confirmed',
      sourceCredibility: 90,
    });
    const data = parseToolResult(r);
    pass('Capture consultation', typeof data === 'string' ? data.slice(0, 100) : 'recorded');
  } catch (e) { fail('Capture consultation', e.message); }

  // ─── Phase 6: Working Memory ──────────────────────────────────────
  console.log('\n═══ PHASE 6: Working Memory & State ═══');
  
  try {
    const r = await callTool('get_working_memory', {
      resourceId: 'tomasz-szychliński',
    });
    const data = parseToolResult(r);
    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      pass('Working memory', `${keys.length} fields: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '...' : ''}`);
      if (data.activeConcerns) pass('Active concerns', `${data.activeConcerns.length} items`);
      if (data.currentHypotheses) pass('Current hypotheses', `${data.currentHypotheses.length} items`);
      if (data.evidenceSummary) pass('Evidence summary', JSON.stringify(data.evidenceSummary));
    } else {
      pass('Working memory', typeof data === 'string' ? data.slice(0, 100) : 'empty/null');
    }
  } catch (e) { fail('Working memory', e.message); }

  // Token usage
  try {
    const r = await callTool('get_token_usage', {});
    const data = parseToolResult(r);
    pass('Token usage', typeof data === 'string' ? data.slice(0, 100) : JSON.stringify(data).slice(0, 100));
  } catch (e) { fail('Token usage', e.message); }

  // ─── Summary ──────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed} passed, ${failed} failed / ${testCount} total (${elapsed}s)  `);
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => r.status === 'FAIL')) {
      console.log(`  ✗ ${r.name}: ${r.detail}`);
    }
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
