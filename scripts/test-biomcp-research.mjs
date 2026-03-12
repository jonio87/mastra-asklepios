#!/usr/bin/env node
/**
 * BioMCP Research Test for Tomasz Szychliński
 *
 * Queries Layer 2 + Layer 3 for clinical findings,
 * then runs BioMCP research queries against those findings.
 */
import { createClient } from '@libsql/client';

const PATIENT_ID = 'tomasz-szychlinski';
const DB_URL = process.env.ASKLEPIOS_DB_URL || 'file:asklepios.db';

// ─── Layer 2: Structured Clinical Data ───────────────────────────────

const db = createClient({ url: DB_URL });

console.log('═══════════════════════════════════════════════════════════');
console.log('  BioMCP Research Test — Tomasz Szychliński');
console.log('═══════════════════════════════════════════════════════════\n');

// 1. Abnormal labs summary
console.log('──── LAYER 2: Key Abnormal Labs ────');
const abnormalLabs = await db.execute({
  sql: `SELECT test_name, value, unit, date, flag, reference_range
        FROM clinical_lab_results
        WHERE flag IS NOT NULL AND flag != ''
        ORDER BY date DESC
        LIMIT 30`,
  args: [],
});

const labSummary = {};
for (const row of abnormalLabs.rows) {
  const name = String(row.test_name);
  if (!labSummary[name]) labSummary[name] = [];
  labSummary[name].push({
    value: row.value, unit: row.unit, date: row.date, flag: row.flag,
  });
}
console.log(`Found ${abnormalLabs.rows.length} flagged results across ${Object.keys(labSummary).length} test types:`);
for (const [name, entries] of Object.entries(labSummary)) {
  const latest = entries[0];
  console.log(`  • ${name}: ${latest.value} ${latest.unit} [${latest.flag}] (${latest.date}) — ${entries.length} flagged`);
}

// 2. WBC trend
console.log('\n──── LAYER 2: WBC Trend ────');
const wbcTrend = await db.execute({
  sql: `SELECT value, unit, date, flag FROM clinical_lab_results
        WHERE test_name LIKE '%WBC%' AND test_name NOT LIKE '%urine%'
        ORDER BY date ASC`,
  args: [],
});
for (const row of wbcTrend.rows) {
  const flag = row.flag ? ` [${row.flag}]` : '';
  console.log(`  ${row.date}: ${row.value} ${row.unit}${flag}`);
}

// 3. Autoimmune markers
console.log('\n──── LAYER 2: Autoimmune Markers ────');
const autoimmune = await db.execute({
  sql: `SELECT test_name, value, unit, date, flag FROM clinical_lab_results
        WHERE test_name LIKE '%ANCA%' OR test_name LIKE '%Ro-%' OR test_name LIKE '%ANA%'
           OR test_name LIKE '%RNP%' OR test_name LIKE '%anti-%'
        ORDER BY date DESC`,
  args: [],
});
for (const row of autoimmune.rows) {
  const flag = row.flag ? ` [${row.flag}]` : '';
  console.log(`  ${row.date}: ${row.test_name} = ${row.value} ${row.unit}${flag}`);
}

// 4. Key diagnoses from contradictions/learnings
console.log('\n──── LAYER 2: Agent Learnings ────');
const learnings = await db.execute({
  sql: `SELECT category, content FROM clinical_agent_learnings ORDER BY created_at DESC LIMIT 10`,
  args: [],
});
for (const row of learnings.rows) {
  console.log(`  [${row.category}] ${String(row.content).substring(0, 120)}...`);
}

db.close();

// ─── BioMCP Research Queries ─────────────────────────────────────────

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('  BioMCP Research Queries');
console.log('═══════════════════════════════════════════════════════════\n');

// Import BioMCP client
const { biomcpSearch, biomcpGet, biomcpEnrich, biomcpHelper, biomcpSearchAll, biomcpDisconnect } =
  await import('../dist/clients/biomcp-client.js');

const results = {};
let testNum = 0;

async function runTest(name, fn) {
  testNum++;
  const start = Date.now();
  try {
    console.log(`\n──── Test ${testNum}: ${name} ────`);
    const result = await fn();
    const elapsed = Date.now() - start;

    if (result.ok) {
      console.log(`  ✅ OK (${elapsed}ms, ${result.raw.length} chars)`);
      // Print first 500 chars of raw output
      const preview = result.raw.substring(0, 600).split('\n').map(l => `  │ ${l}`).join('\n');
      console.log(preview);
      if (result.raw.length > 600) console.log(`  │ ... (${result.raw.length - 600} more chars)`);
    } else {
      console.log(`  ❌ FAILED (${elapsed}ms): ${result.error}`);
    }
    results[name] = { ok: result.ok, elapsed, chars: result.raw?.length || 0 };
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`  ❌ ERROR (${elapsed}ms): ${err.message}`);
    results[name] = { ok: false, elapsed, error: err.message };
    return null;
  }
}

// Test 1: Gene set enrichment — Tomasz's genetic panel
await runTest('Gene Enrichment (COMT,MTHFR,CBS,VDR,ACE)', async () => {
  return biomcpEnrich('COMT,MTHFR,CBS,VDR,ACE');
});

// Test 2: COMT gene details — key gene linked to CVJ anomaly site
await runTest('Gene Details: COMT', async () => {
  return biomcpGet('gene', 'COMT');
});

// Test 3: GTEx tissue expression — COMT at cervical spinal cord
await runTest('COMT Tissue Expression (GTEx)', async () => {
  return biomcpSearch('gene', 'COMT expression cervical spinal cord');
});

// Test 4: Drug-gene interactions for COMT
await runTest('COMT Drug Interactions (DGIdb)', async () => {
  return biomcpHelper('gene', 'drugs', 'COMT');
});

// Test 5: Duloxetine interactions — failed medication
await runTest('Duloxetine Drug Investigation', async () => {
  return biomcpSearch('drug', 'duloxetine');
});

// Test 6: Naltrexone (LDN) — working medication
await runTest('Naltrexone Drug Details', async () => {
  return biomcpGet('drug', 'naltrexone');
});

// Test 7: Naltrexone adverse events
await runTest('Naltrexone Adverse Events (OpenFDA)', async () => {
  return biomcpHelper('drug', 'adverse-events', 'naltrexone');
});

// Test 8: Phenotype triage — Tomasz's HPO terms
// HP:0001882 = Leukopenia, HP:0001875 = Neutropenia, HP:0009830 = Peripheral neuropathy
// HP:0011107 = Recurrent aphthous stomatitis, HP:0002315 = Headache
await runTest('Phenotype Triage (leukopenia+neutropenia+neuropathy+stomatitis+headache)', async () => {
  return biomcpSearch('phenotype', 'HP:0001882 HP:0001875 HP:0009830 HP:0011107 HP:0002315');
});

// Test 9: Disease search — craniovertebral junction anomaly
await runTest('Disease Search: Craniovertebral Junction Anomaly', async () => {
  return biomcpSearch('disease', 'craniovertebral junction anomaly Klippel-Feil');
});

// Test 10: Disease search — ANCA vasculitis
await runTest('Disease Search: ANCA Vasculitis', async () => {
  return biomcpSearch('disease', 'ANCA associated vasculitis granulomatosis polyangiitis');
});

// Test 11: PR3-ANCA variant research
await runTest('Variant Search: PR3-ANCA PROTEINASE3', async () => {
  return biomcpSearch('variant', 'PRTN3 PR3');
});

// Test 12: Clinical trials — LDN for neuropathic pain (trial uses flag syntax)
await runTest('Clinical Trials: LDN Neuropathic Pain', async () => {
  return biomcpSearch('trial', '-c "neuropathic pain" -i naltrexone -s recruiting');
});

// Test 13: Clinical trials — craniovertebral junction
await runTest('Clinical Trials: CVJ Anomaly', async () => {
  return biomcpSearch('trial', '-c "craniovertebral junction" -s recruiting');
});

// Test 14: Cross-entity search — COMT + neuropathy
await runTest('Cross-Entity: COMT + Neuropathy', async () => {
  return biomcpSearchAll({ gene: 'COMT', disease: 'neuropathy' });
});

// Test 15: Literature — homocysteine neuropathy mechanism
await runTest('Article Search: Homocysteine Neuropathy', async () => {
  return biomcpSearch('article', 'homocysteine metabolism sensory neuropathy mechanism');
});

// Test 16: VDR autoimmune susceptibility
await runTest('Gene Details: VDR (Vitamin D Receptor)', async () => {
  return biomcpGet('gene', 'VDR');
});

// Test 17: Pathway — homocysteine metabolism
await runTest('Pathway: Homocysteine Metabolism', async () => {
  return biomcpSearch('pathway', 'homocysteine metabolism methylation folate');
});

// Cleanup
await biomcpDisconnect();

// ─── Summary ─────────────────────────────────────────────────────────

console.log('\n\n═══════════════════════════════════════════════════════════');
console.log('  SUMMARY');
console.log('═══════════════════════════════════════════════════════════\n');

const passed = Object.values(results).filter(r => r.ok).length;
const failed = Object.values(results).filter(r => !r.ok).length;
const totalTime = Object.values(results).reduce((a, r) => a + r.elapsed, 0);
const totalChars = Object.values(results).reduce((a, r) => a + (r.chars || 0), 0);

console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`);
console.log(`Total time: ${(totalTime / 1000).toFixed(1)}s`);
console.log(`Total data: ${totalChars.toLocaleString()} chars received`);
console.log('');

for (const [name, r] of Object.entries(results)) {
  const status = r.ok ? '✅' : '❌';
  const detail = r.ok ? `${r.elapsed}ms, ${r.chars} chars` : r.error || 'failed';
  console.log(`  ${status} ${name} — ${detail}`);
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
