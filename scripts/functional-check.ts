/**
 * Post-cleanup functional assessment.
 * Tests Layer 2 structured queries, Layer 3 semantic search, and agent reasoning.
 */

const MCP_URL = 'http://localhost:4112/mcp';

async function mcpCall(
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<{ data: unknown; sessionId: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 100000),
      method,
      params,
    }),
  });

  const newSessionId = res.headers.get('mcp-session-id');
  const text = await res.text();
  let jsonData: unknown = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try { jsonData = JSON.parse(line.slice(6)); } catch { /* skip */ }
    }
  }
  return { data: jsonData, sessionId: newSessionId ?? sessionId ?? null };
}

function extractText(data: unknown): string {
  const d = data as { result?: { content?: Array<{ text?: string }> } };
  return d?.result?.content?.[0]?.text ?? '';
}

async function main() {
  // Init session
  const init = await mcpCall('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'functional-check', version: '1.0' },
  });
  const session = init.sessionId!;
  await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': session },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  let pass = 0;
  let fail = 0;

  function check(name: string, ok: boolean, detail: string) {
    if (ok) { pass++; console.log(`  ✅ ${name}: ${detail}`); }
    else { fail++; console.log(`  ❌ ${name}: ${detail}`); }
  }

  console.log('=== LAYER 2: Structured Queries ===\n');

  // Test 1: WBC labs
  const wbc = await mcpCall('tools/call', {
    name: 'query_clinical_data',
    arguments: { type: 'labs', patientId: 'tomasz-szychliński', testName: 'WBC' },
  }, session);
  const wbcData = JSON.parse(extractText(wbc.data));
  const wbcCount = wbcData?.data?.results?.length ?? 0;
  check('WBC query', wbcCount >= 10, `${wbcCount} results`);

  // Test 2: Abnormal labs
  const abn = await mcpCall('tools/call', {
    name: 'query_clinical_data',
    arguments: { type: 'labs', patientId: 'tomasz-szychliński', dateFrom: '2025-01-01' },
  }, session);
  const abnData = JSON.parse(extractText(abn.data));
  const abnResults = abnData?.data?.results ?? [];
  const flagged = abnResults.filter((r: { flag: string }) => r.flag !== 'normal');
  check('Abnormal labs 2025', flagged.length > 0, `${abnResults.length} total, ${flagged.length} flagged`);

  // Test 3: Evidence provenance present
  const hasProvenance = abnResults.some((r: { evidenceTier?: string }) => r.evidenceTier);
  check('Evidence provenance', hasProvenance, hasProvenance ? 'present in results' : 'MISSING');

  console.log('\n=== LAYER 3: Semantic Search ===\n');

  // Test 4: Nerve biopsy search
  const nb = await mcpCall('tools/call', {
    name: 'search_knowledge',
    arguments: { query: 'nerve biopsy polyneuropathy', patientId: 'tomasz-szychliński', topK: 3 },
  }, session);
  const nbData = JSON.parse(extractText(nb.data));
  check('Nerve biopsy search', (nbData?.count ?? 0) > 0, `${nbData?.count ?? 0} results, score ${nbData?.results?.[0]?.score?.toFixed(3) ?? 'N/A'}`);

  // Test 5: CVJ imaging search
  const cvj = await mcpCall('tools/call', {
    name: 'search_knowledge',
    arguments: { query: 'craniovertebral junction basilar impression', patientId: 'tomasz-szychliński', topK: 3 },
  }, session);
  const cvjData = JSON.parse(extractText(cvj.data));
  check('CVJ imaging search', (cvjData?.count ?? 0) > 0, `${cvjData?.count ?? 0} results, score ${cvjData?.results?.[0]?.score?.toFixed(3) ?? 'N/A'}`);

  // Test 6: ANCA search
  const anca = await mcpCall('tools/call', {
    name: 'search_knowledge',
    arguments: { query: 'PR3-ANCA cANCA autoimmune vasculitis', patientId: 'tomasz-szychliński', topK: 3 },
  }, session);
  const ancaData = JSON.parse(extractText(anca.data));
  check('ANCA search', (ancaData?.count ?? 0) > 0, `${ancaData?.count ?? 0} results, score ${ancaData?.results?.[0]?.score?.toFixed(3) ?? 'N/A'}`);

  console.log('\n=== AGENT REASONING ===\n');

  // Test 7: Agent clinical reasoning (combines Layer 2 + Layer 3)
  const start = Date.now();
  const agent = await mcpCall('tools/call', {
    name: 'ask_asklepios',
    arguments: {
      message: 'Briefly summarize the 3 most urgent clinical findings for this patient. Use both lab data and knowledge base.',
      patientId: 'tomasz-szychliński',
    },
  }, session);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const agentText = extractText(agent.data);
  const hasContent = agentText.length > 200;
  const mentionsAnca = agentText.toLowerCase().includes('anca');
  const mentionsLeukopenia = agentText.toLowerCase().includes('leukopenia') || agentText.toLowerCase().includes('wbc');
  check('Agent response', hasContent, `${agentText.length} chars in ${elapsed}s`);
  check('Agent mentions ANCA', mentionsAnca, mentionsAnca ? 'yes' : 'NOT FOUND');
  check('Agent mentions leukopenia/WBC', mentionsLeukopenia, mentionsLeukopenia ? 'yes' : 'NOT FOUND');

  // Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  RESULTS: ${pass} passed, ${fail} failed / ${pass + fail} total`);
  console.log(`${'═'.repeat(50)}`);

  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error('Failed:', e); process.exit(1); });
