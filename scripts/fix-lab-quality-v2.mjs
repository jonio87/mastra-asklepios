#!/usr/bin/env node
/**
 * fix-lab-quality-v2.mjs — Clean up clinical_lab_results data quality issues
 *
 * 4 fixes:
 *   1. Delete 52 agent-generated garbage entries (lab-* IDs)
 *   2. Delete 44 duplicate diagnostyka-002 entries from 2021-09-20
 *   3. Rename 2 urinalysis WBC entries stored as blood WBC
 *   4. Mark onconeuronal intensity codes with unit='intensity_class'
 *
 * Usage:
 *   node scripts/fix-lab-quality-v2.mjs --dry-run   # preview changes
 *   node scripts/fix-lab-quality-v2.mjs              # apply changes
 */

import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const dryRun = process.argv.includes('--dry-run');

console.log(`\n=== fix-lab-quality-v2.mjs ===`);
console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'LIVE (applying changes)'}\n`);

const totalBefore = (await c.execute('SELECT COUNT(*) as cnt FROM clinical_lab_results')).rows[0].cnt;
console.log(`Total lab entries before: ${totalBefore}\n`);

// ── Fix 1: Delete 52 agent-generated garbage entries ────────────────────────
console.log('─── Fix 1: Delete agent-generated garbage entries (lab-* IDs) ───');
const agentEntries = (await c.execute(
  "SELECT test_name, COUNT(*) as cnt FROM clinical_lab_results WHERE id LIKE 'lab-%' GROUP BY test_name ORDER BY cnt DESC"
)).rows;
const agentCount = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE id LIKE 'lab-%'")).rows[0].cnt;

console.log(`  Found ${agentCount} agent-generated entries:`);
for (const row of agentEntries) {
  console.log(`    ${row.test_name}: ${row.cnt}×`);
}

if (!dryRun) {
  const result = await c.execute("DELETE FROM clinical_lab_results WHERE id LIKE 'lab-%'");
  console.log(`  DELETED: ${result.rowsAffected} rows\n`);
} else {
  console.log(`  Would delete: ${agentCount} rows\n`);
}

// ── Fix 2: Delete 44 duplicate diagnostyka-002 entries from 2021-09-20 ──────
console.log('─── Fix 2: Delete duplicate diagnostyka-002 entries (2021-09-20) ───');
const dupe002Count = (await c.execute(
  "SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE id LIKE 'import-lab-lab-20210920-diagnostyka-002-%'"
)).rows[0].cnt;

const dupe002Sample = (await c.execute(
  "SELECT test_name, value, unit FROM clinical_lab_results WHERE id LIKE 'import-lab-lab-20210920-diagnostyka-002-%' AND unit = '' LIMIT 5"
)).rows;
console.log(`  Found ${dupe002Count} entries from diagnostyka-002 (duplicate of diagnostyka-001)`);
console.log(`  Sample broken entries (unit in value column, empty unit):`);
for (const row of dupe002Sample) {
  console.log(`    ${row.test_name}: value="${row.value}", unit="${row.unit}"`);
}

if (!dryRun) {
  const result = await c.execute("DELETE FROM clinical_lab_results WHERE id LIKE 'import-lab-lab-20210920-diagnostyka-002-%'");
  console.log(`  DELETED: ${result.rowsAffected} rows\n`);
} else {
  console.log(`  Would delete: ${dupe002Count} rows\n`);
}

// ── Fix 3: Rename 2 urinalysis WBC entries ──────────────────────────────────
console.log('─── Fix 3: Rename urinalysis WBC entries stored as blood WBC ───');
const urinalysisWBC = (await c.execute(
  "SELECT id, test_name, value, unit, date FROM clinical_lab_results WHERE test_name = 'WBC' AND unit = '/µl'"
)).rows;
console.log(`  Found ${urinalysisWBC.length} urinalysis WBC entries mislabeled as blood WBC:`);
for (const row of urinalysisWBC) {
  console.log(`    ${row.id}: WBC=${row.value} ${row.unit} (${row.date}) → WBC (urine sediment)`);
}

if (!dryRun && urinalysisWBC.length > 0) {
  const ids = urinalysisWBC.map(r => r.id);
  const placeholders = ids.map(() => '?').join(', ');
  const result = await c.execute({
    sql: `UPDATE clinical_lab_results SET test_name = 'WBC (urine sediment)' WHERE id IN (${placeholders})`,
    args: ids,
  });
  console.log(`  RENAMED: ${result.rowsAffected} rows\n`);
} else {
  console.log(`  Would rename: ${urinalysisWBC.length} rows\n`);
}

// ── Fix 4: Mark onconeuronal intensity codes ────────────────────────────────
console.log('─── Fix 4: Mark onconeuronal intensity codes as qualitative ───');
const onconeuronalTests = [
  'Anti-Hu', 'Anti-Ri', 'Anti-Yo', 'Anti-amphiphysin', 'Anti-CV2',
  'Anti-Ma2/Ta', 'Anti-recoverin', 'Anti-SOX1', 'Anti-titin',
];
const placeholders4 = onconeuronalTests.map(() => '?').join(', ');

// Match entries where value looks like a Polish decimal number (e.g., "5,00", "2,00")
// and unit is empty — these are immunoblot intensity class codes, not measurements
const intensityEntries = (await c.execute({
  sql: `SELECT id, test_name, value, unit, date 
        FROM clinical_lab_results 
        WHERE id LIKE 'import-%' 
          AND test_name IN (${placeholders4}) 
          AND value GLOB '[0-9]*,[0-9]*' 
          AND unit = ''`,
  args: onconeuronalTests,
})).rows;

console.log(`  Found ${intensityEntries.length} onconeuronal intensity class entries:`);
for (const row of intensityEntries) {
  console.log(`    ${row.test_name}: value="${row.value}" (${row.date}) → unit='intensity_class'`);
}

if (!dryRun && intensityEntries.length > 0) {
  const ids = intensityEntries.map(r => r.id);
  const ph = ids.map(() => '?').join(', ');
  const result = await c.execute({
    sql: `UPDATE clinical_lab_results SET unit = 'intensity_class' WHERE id IN (${ph})`,
    args: ids,
  });
  console.log(`  UPDATED: ${result.rowsAffected} rows\n`);
} else {
  console.log(`  Would update: ${intensityEntries.length} rows\n`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
const totalAfter = (await c.execute('SELECT COUNT(*) as cnt FROM clinical_lab_results')).rows[0].cnt;
const agentRemaining = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE id LIKE 'lab-%'")).rows[0].cnt;
const dupe002Remaining = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE id LIKE 'import-lab-lab-20210920-diagnostyka-002-%'")).rows[0].cnt;
const urineWBC = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE test_name = 'WBC (urine sediment)'")).rows[0].cnt;
const intensityClass = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE unit = 'intensity_class'")).rows[0].cnt;

console.log('═══ Summary ═══');
console.log(`  Before: ${totalBefore}`);
console.log(`  After:  ${totalAfter}`);
console.log(`  Deleted: ${Number(totalBefore) - Number(totalAfter)}`);
console.log(`  Agent entries remaining: ${agentRemaining}`);
console.log(`  diagnostyka-002 remaining: ${dupe002Remaining}`);
console.log(`  Urinalysis WBC: ${urineWBC}`);
console.log(`  Intensity class entries: ${intensityClass}`);
console.log();

c.close();
