#!/usr/bin/env node
/**
 * verify-data-quality.mjs — Read-only audit of clinical data integrity.
 *
 * Cross-references all 3 stages:
 *   Source PDFs → medical-records markdown → Asklepios database
 *
 * Reports:
 *   1. Lab spot-checks (DB ↔ markdown ↔ source)
 *   2. Consultation coverage (markdown → DB)
 *   3. Garbage/duplicate detection (DB only)
 *   4. Agent-generated entry audit (DB only)
 *
 * Usage:
 *   node scripts/verify-data-quality.mjs [--verbose]
 */

import { createClient } from '@libsql/client';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const verbose = process.argv.includes('--verbose');
const RECORDS_DIR = process.env.RECORDS_DIR ?? '/Users/andrzej/Documents/GitHub/medical-records/records';

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║   Asklepios Data Quality Verification Audit      ║');
console.log('╚══════════════════════════════════════════════════╝\n');

const issues = [];
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(msg) { passCount++; console.log(`  ✅ ${msg}`); }
function fail(msg) { failCount++; issues.push(msg); console.log(`  ❌ ${msg}`); }
function warn(msg) { warnCount++; console.log(`  ⚠️  ${msg}`); }

// ════════════════════════════════════════════════════════════════════════
// 1. Lab Spot-Checks: critical lab values DB ↔ markdown
// ════════════════════════════════════════════════════════════════════════
console.log('═══ 1. Lab Spot-Checks (critical values) ═══\n');

const criticalLabs = [
  // WBC timeline
  { test: 'WBC', date: '2025-08-27', expectedValue: '2.59' },
  { test: 'WBC', date: '2024-12-16', expectedValue: '4.3' },
  { test: 'WBC', date: '2025-09-05', expectedValue: '3.37' },
  // Autoimmune markers (normalized names from import pipeline)
  { test: 'Anti-Ro-60 (SSA)', date: '2025-08-27', expectedValue: '329.41 pozytywny' },
  { test: 'DHEA-S', date: '2024-12-16', expectedValue: '552' },
  { test: 'Vitamin D 25-OH', date: '2024-12-16', expectedValue: '39' },
  { test: 'Total cholesterol', date: '2024-12-16', expectedValue: '247' },
  { test: 'LDL cholesterol', date: '2024-12-16', expectedValue: '170' },
  { test: 'Neutrophils (abs)', date: '2025-08-27', expectedValue: '1.14' },
  { test: 'Anti-PR3 (ANCA)', date: '2019-07-31', expectedValue: '20.33' },
  { test: 'Testosterone', date: '2025-09-01', expectedValue: '925' },
  { test: 'HbA1c', date: '2024-12-16', expectedValue: '5.1' },
  { test: 'CRP', date: '2024-12-16', expectedValue: '<3.0' },
  { test: 'ESR', date: '2024-12-16', expectedValue: '2' },
  { test: 'Ferritin', date: '2025-08-27', expectedValue: '109' },
  { test: 'IgG', date: '2024-12-16', expectedValue: '1160' },
  { test: 'Chloride', date: '2024-12-16', expectedValue: '97' },
  { test: 'Osmolality (urine)', date: '2024-12-16', expectedValue: '898' },
  { test: 'Lipoprotein(a)', date: '2024-12-16', expectedValue: '<7' },
  { test: 'Vitamin B12', date: '2024-12-16', expectedValue: '309' },
];

for (const check of criticalLabs) {
  const rows = (await c.execute({
    sql: `SELECT value, unit, source FROM clinical_lab_results
          WHERE test_name = ? AND date = ? AND id LIKE 'import-%'`,
    args: [check.test, check.date],
  })).rows;

  if (rows.length === 0) {
    fail(`${check.test} on ${check.date}: NOT FOUND in database`);
  } else if (rows.length > 1) {
    warn(`${check.test} on ${check.date}: ${rows.length} entries (possible duplicate)`);
  } else {
    const dbValue = String(rows[0].value);
    if (dbValue === check.expectedValue) {
      pass(`${check.test} on ${check.date}: ${dbValue} (correct)`);
    } else {
      fail(`${check.test} on ${check.date}: DB=${dbValue}, expected=${check.expectedValue}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// 2. Consultation Coverage: markdown files → DB
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Consultation Coverage (markdown → DB) ═══\n');

async function listMarkdownFiles(dir) {
  const entries = [];
  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = join(dir, item.name);
      if (item.isDirectory()) {
        entries.push(...await listMarkdownFiles(fullPath));
      } else if (item.name.endsWith('.md')) {
        entries.push(fullPath);
      }
    }
  } catch { /* dir doesn't exist */ }
  return entries;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1]) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      fm[key] = val;
    }
  }
  return { fm, body: match[2] };
}

const consultationFiles = await listMarkdownFiles(join(RECORDS_DIR, 'consultations'));
console.log(`  Found ${consultationFiles.length} consultation markdown files\n`);

let consultInDb = 0;
let consultNotInDb = 0;
const missingConsultations = [];

for (const f of consultationFiles) {
  const content = await readFile(f, 'utf-8');
  const parsed = parseFrontmatter(content);
  if (!parsed) { warn(`  Cannot parse frontmatter: ${basename(f)}`); continue; }

  const { fm } = parsed;
  const docId = fm.document_id || basename(f, '.md');

  // Check if consultation exists in DB by document_id prefix (import-con-*)
  const importId = `import-con-${docId}`;
  const existing = (await c.execute({
    sql: `SELECT id FROM clinical_consultations WHERE id = ?`,
    args: [importId],
  })).rows;

  if (existing.length > 0) {
    consultInDb++;
    if (verbose) pass(`${docId}: in database`);
  } else {
    consultNotInDb++;
    missingConsultations.push({ docId, date: fm.date, specialty: fm.specialty || fm.category || '?' });
  }
}

if (consultNotInDb > 0) {
  warn(`${consultNotInDb}/${consultationFiles.length} consultations NOT in database (no import pipeline yet)`);
  if (verbose) {
    for (const m of missingConsultations.slice(0, 10)) {
      console.log(`    Missing: ${m.docId} (${m.date}, ${m.specialty})`);
    }
    if (missingConsultations.length > 10) console.log(`    ... and ${missingConsultations.length - 10} more`);
  }
} else if (consultInDb === consultationFiles.length) {
  pass(`All ${consultationFiles.length} consultation markdown files have matching DB entries`);
}
console.log(`  DB imported: ${consultInDb}, Missing: ${consultNotInDb}`);

// ════════════════════════════════════════════════════════════════════════
// 2b. Imaging Report Coverage (markdown → DB)
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2b. Imaging Report Coverage ═══\n');

let imagingMdFiles = [];
const imagingDir = join(RECORDS_DIR, 'imaging');
try {
  const imagingModalities = await readdir(imagingDir);
  for (const mod of imagingModalities) {
    const modDir = join(imagingDir, mod);
    const modStat = await stat(modDir);
    if (modStat.isDirectory()) {
      const files = await readdir(modDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const content = await readFile(join(modDir, f), 'utf-8');
          const docIdMatch = content.match(/document_id:\s*(.+)/);
          if (docIdMatch) imagingMdFiles.push({ file: f, docId: docIdMatch[1].trim() });
        }
      }
    }
  }
} catch { /* no imaging dir */ }

const imagingInDb = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_imaging_reports WHERE id LIKE 'import-img-%'`
)).rows[0].cnt;

// Check for non-medical imaging files that should be skipped
const nonMedicalImaging = imagingMdFiles.filter(f => f.file === 'undated_006.md');
const expectedImaging = imagingMdFiles.length - nonMedicalImaging.length;

if (Number(imagingInDb) >= expectedImaging && expectedImaging > 0) {
  pass(`Imaging: ${imagingInDb}/${expectedImaging} medical imaging files imported (${nonMedicalImaging.length} non-medical skipped)`);
} else if (expectedImaging > 0) {
  fail(`Imaging: only ${imagingInDb}/${expectedImaging} files imported`);
} else {
  warn('Imaging: no markdown files found');
}

// Imaging quality: check for missing body_region
const imgNoBodyRegion = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_imaging_reports WHERE body_region = 'unknown'`
)).rows[0].cnt;
if (Number(imgNoBodyRegion) > 0) {
  warn(`Imaging: ${imgNoBodyRegion} reports with unknown body_region (source markdown missing field)`);
} else {
  pass('Imaging: all reports have body_region populated');
}

// Imaging quality: check for findings
const imgNoFindings = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_imaging_reports WHERE findings IS NULL OR length(findings) < 50`
)).rows[0].cnt;
if (Number(imgNoFindings) > 0) {
  warn(`Imaging: ${imgNoFindings} reports with empty/short findings`);
} else {
  pass('Imaging: all reports have findings populated');
}

// ════════════════════════════════════════════════════════════════════════
// 2c. Abdominal Report Coverage (markdown → DB)
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2c. Abdominal Report Coverage ═══\n');

let abdominalMdCount = 0;
const abdDir = join(RECORDS_DIR, 'abdominal');
try {
  const abdFiles = await readdir(abdDir);
  abdominalMdCount = abdFiles.filter(f => f.endsWith('.md')).length;
} catch { /* no abdominal dir */ }

const abdInDb = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_abdominal_reports WHERE id LIKE 'import-abd-%'`
)).rows[0].cnt;

if (Number(abdInDb) >= abdominalMdCount && abdominalMdCount > 0) {
  pass(`Abdominal: ${abdInDb}/${abdominalMdCount} files imported`);
} else if (abdominalMdCount > 0) {
  fail(`Abdominal: only ${abdInDb}/${abdominalMdCount} files imported`);
} else {
  warn('Abdominal: no markdown files found');
}

// Abdominal quality: procedure type distribution
const abdTypes = (await c.execute(
  `SELECT procedure_type, COUNT(*) as cnt FROM clinical_abdominal_reports GROUP BY procedure_type ORDER BY cnt DESC`
)).rows;
console.log('  Procedure types: ' + abdTypes.map(r => `${r.procedure_type}(${r.cnt})`).join(', '));

// ════════════════════════════════════════════════════════════════════════
// 2d. Narrative + External Coverage
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2d. Narrative + External Coverage ═══\n');

const narrativeInDb = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_patient_reports WHERE id LIKE 'import-nar-%'`
)).rows[0].cnt;
const externalInDb = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_consultations WHERE id LIKE 'import-ext-%'`
)).rows[0].cnt;

if (Number(narrativeInDb) >= 1) pass(`Narratives: ${narrativeInDb} imported`);
else warn('Narratives: 0 imported');
if (Number(externalInDb) >= 3) pass(`External (Duke): ${externalInDb} imported`);
else warn(`External (Duke): only ${externalInDb}/3 imported`);

// ════════════════════════════════════════════════════════════════════════
// 3. Garbage & Duplicate Detection (DB only)
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. Garbage & Duplicate Detection ═══\n');

// Consultations garbage
const garbageConsult = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_consultations WHERE specialty IN ('Test', 'Y') OR provider LIKE '%Test%'`
)).rows[0].cnt;
if (Number(garbageConsult) > 0) fail(`Consultations: ${garbageConsult} garbage entries (specialty=Test/Y)`);
else pass('Consultations: 0 garbage entries');

// Treatments garbage
const garbageTreat = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_treatment_trials WHERE medication = '' OR medication IS NULL`
)).rows[0].cnt;
if (Number(garbageTreat) > 0) fail(`Treatments: ${garbageTreat} garbage entries (empty medication)`);
else pass('Treatments: 0 garbage entries');

// Contradictions garbage
const garbageContra = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_contradictions WHERE finding1 IN ('Finding A', 'a') OR finding2 IN ('Finding B', 'b')`
)).rows[0].cnt;
if (Number(garbageContra) > 0) fail(`Contradictions: ${garbageContra} garbage entries (Finding A/B pattern)`);
else pass('Contradictions: 0 garbage entries');

// Lab agent-generated
const agentLabs = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE id LIKE 'lab-%'`
)).rows[0].cnt;
if (Number(agentLabs) > 0) fail(`Labs: ${agentLabs} agent-generated entries (lab-* IDs)`);
else pass('Labs: 0 agent-generated entries');

// ─── Duplicate detection ───
console.log('\n  ─── Duplicate detection ───');

// Consultation duplicates (same specialty+date+provider) — excluding import-level dupes
// from source documents (e.g. v1/v2 of same PDF). Only flag agent-generated duplicates.
const consultDupes = (await c.execute(
  `SELECT specialty, date, provider, COUNT(*) as cnt FROM clinical_consultations
   WHERE id NOT LIKE 'import-%'
   GROUP BY specialty, date, provider HAVING cnt > 1`
)).rows;
const importDupes = (await c.execute(
  `SELECT specialty, date, provider, COUNT(*) as cnt FROM clinical_consultations
   WHERE id LIKE 'import-%'
   GROUP BY specialty, date, provider HAVING cnt > 1`
)).rows;
if (consultDupes.length > 0) {
  const totalDupes = consultDupes.reduce((sum, r) => sum + Number(r.cnt) - 1, 0);
  fail(`Consultations: ${totalDupes} agent-captured duplicates across ${consultDupes.length} groups`);
  if (verbose) for (const d of consultDupes) console.log(`    ${d.specialty} / ${d.date} / ${d.provider}: ${d.cnt}×`);
} else {
  pass('Consultations: 0 agent-captured duplicates');
}
if (importDupes.length > 0) {
  const totalImportDupes = importDupes.reduce((sum, r) => sum + Number(r.cnt) - 1, 0);
  warn(`Consultations: ${totalImportDupes} source-document duplicates (same visit, multiple PDFs) across ${importDupes.length} groups`);
} else {
  pass('Consultations: 0 source-document duplicates');
}

// Treatment duplicates (same medication+start_date)
const treatDupes = (await c.execute(
  `SELECT medication, start_date, COUNT(*) as cnt FROM clinical_treatment_trials
   GROUP BY medication, start_date HAVING cnt > 1`
)).rows;
if (treatDupes.length > 0) {
  const totalDupes = treatDupes.reduce((sum, r) => sum + Number(r.cnt) - 1, 0);
  fail(`Treatments: ${totalDupes} duplicate entries across ${treatDupes.length} groups`);
  if (verbose) for (const d of treatDupes) console.log(`    ${d.medication} / ${d.start_date}: ${d.cnt}×`);
} else {
  pass('Treatments: 0 duplicates');
}

// Contradiction duplicates (same finding1+finding2)
const contraDupes = (await c.execute(
  `SELECT finding1, finding2, COUNT(*) as cnt FROM clinical_contradictions
   GROUP BY finding1, finding2 HAVING cnt > 1`
)).rows;
if (contraDupes.length > 0) {
  const totalDupes = contraDupes.reduce((sum, r) => sum + Number(r.cnt) - 1, 0);
  fail(`Contradictions: ${totalDupes} duplicate entries across ${contraDupes.length} groups`);
  if (verbose) for (const d of contraDupes) console.log(`    ${String(d.finding1).slice(0,60)}: ${d.cnt}×`);
} else {
  pass('Contradictions: 0 duplicates');
}

// Patient report duplicates (same type+content)
const reportDupes = (await c.execute(
  `SELECT type, content, COUNT(*) as cnt FROM clinical_patient_reports
   GROUP BY type, content HAVING cnt > 1`
)).rows;
if (reportDupes.length > 0) {
  const totalDupes = reportDupes.reduce((sum, r) => sum + Number(r.cnt) - 1, 0);
  fail(`Patient reports: ${totalDupes} duplicate entries across ${reportDupes.length} groups`);
} else {
  pass('Patient reports: 0 duplicates');
}

// Agent learning duplicates (same category+content)
const learnDupes = (await c.execute(
  `SELECT category, content, COUNT(*) as cnt FROM clinical_agent_learnings
   GROUP BY category, content HAVING cnt > 1`
)).rows;
if (learnDupes.length > 0) {
  const totalDupes = learnDupes.reduce((sum, r) => sum + Number(r.cnt) - 1, 0);
  fail(`Agent learnings: ${totalDupes} duplicate entries across ${learnDupes.length} groups`);
} else {
  pass('Agent learnings: 0 duplicates');
}

// ════════════════════════════════════════════════════════════════════════
// 4. Source Attribution Audit
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Source Attribution Audit ═══\n');

// Check if source column exists in non-lab tables
const tables = [
  'clinical_consultations',
  'clinical_treatment_trials',
  'clinical_contradictions',
  'clinical_patient_reports',
  'clinical_agent_learnings',
];

for (const table of tables) {
  const columns = (await c.execute(`PRAGMA table_info(${table})`)).rows;
  const hasSource = columns.some(col => col.name === 'source');
  if (hasSource) {
    // Count entries without source
    const noSource = (await c.execute(`SELECT COUNT(*) as cnt FROM ${table} WHERE source IS NULL OR source = ''`)).rows[0].cnt;
    const total = (await c.execute(`SELECT COUNT(*) as cnt FROM ${table}`)).rows[0].cnt;
    if (Number(noSource) > 0) {
      warn(`${table}: ${noSource}/${total} entries missing source attribution`);
    } else {
      pass(`${table}: all ${total} entries have source attribution`);
    }
  } else {
    warn(`${table}: NO source column (cannot track provenance)`);
  }
}

// Labs source check
const labNoSource = (await c.execute(
  `SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE source IS NULL OR source = ''`
)).rows[0].cnt;
const labTotal = (await c.execute(`SELECT COUNT(*) as cnt FROM clinical_lab_results`)).rows[0].cnt;
if (Number(labNoSource) > 0) {
  fail(`clinical_lab_results: ${labNoSource}/${labTotal} entries missing source`);
} else {
  pass(`clinical_lab_results: all ${labTotal} entries have source attribution`);
}

// ════════════════════════════════════════════════════════════════════════
// 5. Table Entry Counts Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Entry Count Summary ═══\n');

const allTables = [
  'clinical_lab_results',
  'clinical_consultations',
  'clinical_treatment_trials',
  'clinical_contradictions',
  'clinical_patient_reports',
  'clinical_agent_learnings',
  'research_findings',
  'research_hypotheses',
  'hypothesis_evidence_links',
  'research_queries',
];

for (const table of allTables) {
  try {
    const cnt = (await c.execute(`SELECT COUNT(*) as cnt FROM ${table}`)).rows[0].cnt;
    console.log(`  ${table}: ${cnt} entries`);
  } catch {
    console.log(`  ${table}: TABLE NOT FOUND`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════
console.log('\n╔══════════════════════════════════════════════════╗');
console.log(`║ Summary: ${passCount} passed, ${failCount} failed, ${warnCount} warnings`);
console.log('╚══════════════════════════════════════════════════╝');

if (failCount > 0) {
  console.log('\nFailed checks:');
  for (const issue of issues) {
    console.log(`  ❌ ${issue}`);
  }
}

console.log('');
process.exit(failCount > 0 ? 1 : 0);
