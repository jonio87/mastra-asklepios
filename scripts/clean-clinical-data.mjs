#!/usr/bin/env node
/**
 * clean-clinical-data.mjs — Delete garbage + deduplicate non-lab clinical tables.
 *
 * Targets:
 *   - clinical_consultations (garbage: specialty=Test/Y, duplicates: same specialty+date+provider)
 *   - clinical_treatment_trials (garbage: empty medication or Test-*, duplicates: same medication+start_date)
 *   - clinical_contradictions (garbage: Finding A/B, a/b, duplicates: same finding1+finding2)
 *   - clinical_patient_reports (duplicates: same type+content)
 *   - clinical_agent_learnings (duplicates: same category+content)
 *
 * Usage:
 *   node scripts/clean-clinical-data.mjs --dry-run   # preview changes
 *   node scripts/clean-clinical-data.mjs              # apply changes
 */

import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const dryRun = process.argv.includes('--dry-run');

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║   Clinical Data Cleanup                          ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log(`Mode: ${dryRun ? 'DRY-RUN (no changes)' : 'LIVE (applying changes)'}\n`);

let totalDeleted = 0;

// ─── Helper: count entries ───────────────────────────────────────────────
async function count(table) {
  return Number((await c.execute(`SELECT COUNT(*) as cnt FROM ${table}`)).rows[0].cnt);
}

// ═══ 1. Consultations ═══════════════════════════════════════════════════
console.log('═══ 1. Consultations ═══\n');
const consultBefore = await count('clinical_consultations');
console.log(`  Before: ${consultBefore} entries`);

// 1a. Delete garbage (specialty=Test/Y or provider contains Test)
const garbageConsultIds = (await c.execute(
  `SELECT id FROM clinical_consultations WHERE specialty IN ('Test', 'Y') OR provider LIKE '%Test%'`
)).rows.map(r => String(r.id));
console.log(`  Garbage entries (Test/Y specialty): ${garbageConsultIds.length}`);

if (!dryRun && garbageConsultIds.length > 0) {
  const ph = garbageConsultIds.map(() => '?').join(',');
  const res = await c.execute({ sql: `DELETE FROM clinical_consultations WHERE id IN (${ph})`, args: garbageConsultIds });
  console.log(`  DELETED: ${res.rowsAffected} garbage entries`);
  totalDeleted += res.rowsAffected;
}

// 1b. Deduplicate: keep oldest per (specialty, date, provider)
const consultDupeGroups = (await c.execute(
  `SELECT specialty, date, provider, GROUP_CONCAT(id) as ids, COUNT(*) as cnt 
   FROM clinical_consultations 
   GROUP BY specialty, date, provider HAVING cnt > 1`
)).rows;

let consultDupeCount = 0;
for (const group of consultDupeGroups) {
  const ids = String(group.ids).split(',');
  // Keep the first (oldest by ID), delete rest
  const toDelete = ids.slice(1);
  consultDupeCount += toDelete.length;
  if (!dryRun && toDelete.length > 0) {
    const ph = toDelete.map(() => '?').join(',');
    await c.execute({ sql: `DELETE FROM clinical_consultations WHERE id IN (${ph})`, args: toDelete });
    totalDeleted += toDelete.length;
  }
}
console.log(`  Duplicate entries: ${consultDupeCount}`);

const consultAfter = dryRun ? consultBefore : await count('clinical_consultations');
console.log(`  After: ${consultAfter} entries\n`);

// ═══ 2. Treatment Trials ════════════════════════════════════════════════
console.log('═══ 2. Treatment Trials ═══\n');
const treatBefore = await count('clinical_treatment_trials');
console.log(`  Before: ${treatBefore} entries`);

// 2a. Delete garbage (empty medication, Test-* medication, X medication)
const garbageTreatIds = (await c.execute(
  `SELECT id FROM clinical_treatment_trials 
   WHERE medication = '' OR medication IS NULL 
   OR medication LIKE 'Test-%' OR medication = 'X'`
)).rows.map(r => String(r.id));
console.log(`  Garbage entries (empty/Test/X medication): ${garbageTreatIds.length}`);

if (!dryRun && garbageTreatIds.length > 0) {
  const ph = garbageTreatIds.map(() => '?').join(',');
  const res = await c.execute({ sql: `DELETE FROM clinical_treatment_trials WHERE id IN (${ph})`, args: garbageTreatIds });
  console.log(`  DELETED: ${res.rowsAffected} garbage entries`);
  totalDeleted += res.rowsAffected;
}

// 2b. Deduplicate: keep oldest per (medication, start_date)
const treatDupeGroups = (await c.execute(
  `SELECT medication, start_date, GROUP_CONCAT(id) as ids, COUNT(*) as cnt 
   FROM clinical_treatment_trials 
   GROUP BY medication, start_date HAVING cnt > 1`
)).rows;

let treatDupeCount = 0;
for (const group of treatDupeGroups) {
  const ids = String(group.ids).split(',');
  const toDelete = ids.slice(1);
  treatDupeCount += toDelete.length;
  if (!dryRun && toDelete.length > 0) {
    const ph = toDelete.map(() => '?').join(',');
    await c.execute({ sql: `DELETE FROM clinical_treatment_trials WHERE id IN (${ph})`, args: toDelete });
    totalDeleted += toDelete.length;
  }
}
console.log(`  Duplicate entries: ${treatDupeCount}`);

const treatAfter = dryRun ? treatBefore : await count('clinical_treatment_trials');
console.log(`  After: ${treatAfter} entries\n`);

// ═══ 3. Contradictions ═════════════════════════════════════════════════
console.log('═══ 3. Contradictions ═══\n');
const contraBefore = await count('clinical_contradictions');
console.log(`  Before: ${contraBefore} entries`);

// 3a. Delete garbage (Finding A/B, a/b patterns)
const garbageContraIds = (await c.execute(
  `SELECT id FROM clinical_contradictions 
   WHERE finding1 IN ('Finding A', 'a') OR finding2 IN ('Finding B', 'b')`
)).rows.map(r => String(r.id));
console.log(`  Garbage entries (Finding A/B, a/b): ${garbageContraIds.length}`);

if (!dryRun && garbageContraIds.length > 0) {
  const ph = garbageContraIds.map(() => '?').join(',');
  const res = await c.execute({ sql: `DELETE FROM clinical_contradictions WHERE id IN (${ph})`, args: garbageContraIds });
  console.log(`  DELETED: ${res.rowsAffected} garbage entries`);
  totalDeleted += res.rowsAffected;
}

// 3b. Deduplicate: keep oldest per (finding1, finding2)
const contraDupeGroups = (await c.execute(
  `SELECT finding1, finding2, GROUP_CONCAT(id) as ids, COUNT(*) as cnt 
   FROM clinical_contradictions 
   GROUP BY finding1, finding2 HAVING cnt > 1`
)).rows;

let contraDupeCount = 0;
for (const group of contraDupeGroups) {
  const ids = String(group.ids).split(',');
  const toDelete = ids.slice(1);
  contraDupeCount += toDelete.length;
  if (!dryRun && toDelete.length > 0) {
    const ph = toDelete.map(() => '?').join(',');
    await c.execute({ sql: `DELETE FROM clinical_contradictions WHERE id IN (${ph})`, args: toDelete });
    totalDeleted += toDelete.length;
  }
}
console.log(`  Duplicate entries: ${contraDupeCount}`);

const contraAfter = dryRun ? contraBefore : await count('clinical_contradictions');
console.log(`  After: ${contraAfter} entries\n`);

// ═══ 4. Patient Reports ═════════════════════════════════════════════════
console.log('═══ 4. Patient Reports ═══\n');
const reportBefore = await count('clinical_patient_reports');
console.log(`  Before: ${reportBefore} entries`);

// 4. Deduplicate: keep oldest per (type, content)
const reportDupeGroups = (await c.execute(
  `SELECT type, content, GROUP_CONCAT(id) as ids, COUNT(*) as cnt 
   FROM clinical_patient_reports 
   GROUP BY type, content HAVING cnt > 1`
)).rows;

let reportDupeCount = 0;
for (const group of reportDupeGroups) {
  const ids = String(group.ids).split(',');
  const toDelete = ids.slice(1);
  reportDupeCount += toDelete.length;
  if (!dryRun && toDelete.length > 0) {
    const ph = toDelete.map(() => '?').join(',');
    await c.execute({ sql: `DELETE FROM clinical_patient_reports WHERE id IN (${ph})`, args: toDelete });
    totalDeleted += toDelete.length;
  }
}
console.log(`  Duplicate entries: ${reportDupeCount}`);

const reportAfter = dryRun ? reportBefore : await count('clinical_patient_reports');
console.log(`  After: ${reportAfter} entries\n`);

// ═══ 5. Agent Learnings ═════════════════════════════════════════════════
console.log('═══ 5. Agent Learnings ═══\n');
const learnBefore = await count('clinical_agent_learnings');
console.log(`  Before: ${learnBefore} entries`);

// 5. Deduplicate: keep oldest per (category, content)
const learnDupeGroups = (await c.execute(
  `SELECT category, content, GROUP_CONCAT(id) as ids, COUNT(*) as cnt 
   FROM clinical_agent_learnings 
   GROUP BY category, content HAVING cnt > 1`
)).rows;

let learnDupeCount = 0;
for (const group of learnDupeGroups) {
  const ids = String(group.ids).split(',');
  const toDelete = ids.slice(1);
  learnDupeCount += toDelete.length;
  if (!dryRun && toDelete.length > 0) {
    const ph = toDelete.map(() => '?').join(',');
    await c.execute({ sql: `DELETE FROM clinical_agent_learnings WHERE id IN (${ph})`, args: toDelete });
    totalDeleted += toDelete.length;
  }
}
console.log(`  Duplicate entries: ${learnDupeCount}`);

const learnAfter = dryRun ? learnBefore : await count('clinical_agent_learnings');
console.log(`  After: ${learnAfter} entries\n`);

// ═══ Summary ═══════════════════════════════════════════════════════════
console.log('╔══════════════════════════════════════════════════╗');
console.log(`║ ${dryRun ? 'Would delete' : 'Deleted'}: ${totalDeleted} total entries`);
console.log('║');
console.log(`║ Consultations:  ${consultBefore} → ${dryRun ? consultBefore - garbageConsultIds.length - consultDupeCount : consultAfter}`);
console.log(`║ Treatments:     ${treatBefore} → ${dryRun ? treatBefore - garbageTreatIds.length - treatDupeCount : treatAfter}`);
console.log(`║ Contradictions: ${contraBefore} → ${dryRun ? contraBefore - garbageContraIds.length - contraDupeCount : contraAfter}`);
console.log(`║ Reports:        ${reportBefore} → ${dryRun ? reportBefore - reportDupeCount : reportAfter}`);
console.log(`║ Learnings:      ${learnBefore} → ${dryRun ? learnBefore - learnDupeCount : learnAfter}`);
console.log('╚══════════════════════════════════════════════════╝\n');
