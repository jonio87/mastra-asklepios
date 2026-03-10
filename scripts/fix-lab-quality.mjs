/**
 * Fix lab data quality issues in Asklepios Layer 2 (clinical_lab_results)
 *
 * Issues identified:
 * 1. 14 numeric test names (specimen type headers treated as tests)
 * 2. 34+ duplicate lab values (same test+date+value+unit)
 * 3. 1 empty value (Vitamin B12 Assay with blank value)
 * 4. Comma decimal separators in test_name field (extraction artifacts)
 */
import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const pid = 'tomasz-szychliński';
const dryRun = process.argv.includes('--dry-run');

console.log(dryRun ? '=== DRY RUN ===' : '=== EXECUTING FIXES ===');

// ─── Fix 1: Delete numeric/specimen-type test names ───
// These are extraction artifacts where specimen type headers (WYMAZ/MOCZ/SUROWICA)
// were mistakenly treated as lab results
const numericTests = await c.execute({
  sql: `SELECT id, test_name, value, unit, date FROM clinical_lab_results
        WHERE patient_id = ? AND (
          test_name GLOB '[0-9]*'
          AND test_name NOT LIKE '25-Hydroxy%'
        )`,
  args: [pid],
});
console.log(`\n--- Fix 1: Numeric/specimen test names: ${numericTests.rows.length} rows ---`);
for (const r of numericTests.rows) {
  console.log(`  DELETE ${r.id} | ${r.test_name} = ${r.value} ${r.unit} (${r.date})`);
}
if (!dryRun && numericTests.rows.length > 0) {
  const ids = numericTests.rows.map(r => r.id);
  for (const id of ids) {
    await c.execute({ sql: 'DELETE FROM clinical_lab_results WHERE id = ?', args: [id] });
  }
  console.log(`  ✓ Deleted ${ids.length} rows`);
}

// ─── Fix 2: Delete duplicate lab values (keep lowest ID) ───
// Same test+date+value+unit appearing twice (from overlapping document extraction)
const dupes = await c.execute({
  sql: `SELECT b.id, b.test_name, b.value, b.unit, b.date, b.source
        FROM clinical_lab_results a
        JOIN clinical_lab_results b
          ON a.patient_id = b.patient_id
         AND a.test_name = b.test_name
         AND a.date = b.date
         AND a.value = b.value
         AND a.unit = b.unit
         AND a.id < b.id
        WHERE a.patient_id = ?
        ORDER BY b.date, b.test_name`,
  args: [pid],
});
console.log(`\n--- Fix 2: Duplicate lab values: ${dupes.rows.length} rows ---`);
for (const r of dupes.rows) {
  console.log(`  DELETE ${r.id} | ${r.date} ${r.test_name} = ${r.value} ${r.unit}`);
}
if (!dryRun && dupes.rows.length > 0) {
  const ids = dupes.rows.map(r => r.id);
  for (const id of ids) {
    await c.execute({ sql: 'DELETE FROM clinical_lab_results WHERE id = ?', args: [id] });
  }
  console.log(`  ✓ Deleted ${ids.length} duplicate rows`);
}

// ─── Fix 3: Fix empty values ───
// Vitamin B12 Assay with blank value from Mayo — delete (no actual result)
const empties = await c.execute({
  sql: `SELECT id, test_name, value, unit, date, source FROM clinical_lab_results
        WHERE patient_id = ? AND (value = '' OR value IS NULL)`,
  args: [pid],
});
console.log(`\n--- Fix 3: Empty values: ${empties.rows.length} rows ---`);
for (const r of empties.rows) {
  console.log(`  DELETE ${r.id} | ${r.date} ${r.test_name} = "${r.value}" ${r.unit} [${r.source}]`);
}
if (!dryRun && empties.rows.length > 0) {
  const ids = empties.rows.map(r => r.id);
  for (const id of ids) {
    await c.execute({ sql: 'DELETE FROM clinical_lab_results WHERE id = ?', args: [id] });
  }
  console.log(`  ✓ Deleted ${ids.length} empty-value rows`);
}

// ─── Fix 4: Fix comma decimal separators stored as test_name ───
// E.g., test_name "14,2" value "11.1 – 18.8" — these are reference ranges
// mistakenly parsed as test results. Excludes legitimate names like "Sodium, S"
const commaNames = await c.execute({
  sql: `SELECT id, test_name, value, unit, date FROM clinical_lab_results
        WHERE patient_id = ? AND test_name LIKE '%,%' AND length(test_name) < 10
        AND test_name NOT LIKE '%[A-Za-z]%'
        AND test_name GLOB '*[0-9],[0-9]*'`,
  args: [pid],
});
console.log(`\n--- Fix 4: Comma-in-test-name: ${commaNames.rows.length} rows ---`);
for (const r of commaNames.rows) {
  console.log(`  DELETE ${r.id} | test_name="${r.test_name}" value="${r.value}" (${r.date})`);
}
if (!dryRun && commaNames.rows.length > 0) {
  const ids = commaNames.rows.map(r => r.id);
  for (const id of ids) {
    await c.execute({ sql: 'DELETE FROM clinical_lab_results WHERE id = ?', args: [id] });
  }
  console.log(`  ✓ Deleted ${ids.length} comma-name rows`);
}

// ─── Fix 5: Fix corrupted unit fields (comma fragments from extraction) ───
const corruptUnits = await c.execute({
  sql: `SELECT id, test_name, value, unit, date FROM clinical_lab_results
        WHERE patient_id = ? AND (unit LIKE ',%')`,
  args: [pid],
});
console.log(`\n--- Fix 5: Corrupted unit fields: ${corruptUnits.rows.length} rows ---`);
const unitFixes = {
  'Immunoglobulin G (IgG), S': { value: '767', unit: 'mg/dL', refRange: '700-1600' },
  'Osmolality, U': { value: '150', unit: 'mOsm/kg', refRange: '50-1200' },
};
for (const r of corruptUnits.rows) {
  const fix = unitFixes[r.test_name];
  if (fix) {
    console.log(`  FIX ${r.id} | ${r.test_name}: unit "${r.unit}" → "${fix.unit}", value "${r.value}" → "${fix.value}"`);
    if (!dryRun) {
      await c.execute({
        sql: 'UPDATE clinical_lab_results SET value = ?, unit = ?, reference_range = ? WHERE id = ?',
        args: [fix.value, fix.unit, fix.refRange, r.id],
      });
    }
  } else {
    console.log(`  SKIP ${r.id} | ${r.test_name}: no fix defined for unit "${r.unit}"`);
  }
}
if (!dryRun && corruptUnits.rows.length > 0) {
  console.log(`  ✓ Fixed ${corruptUnits.rows.length} corrupted units`);
}

// ─── Summary ───
const totalBefore = await c.execute({
  sql: 'SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE patient_id = ?',
  args: [pid],
});
console.log(`\n=== SUMMARY ===`);
console.log(`Total lab results remaining: ${totalBefore.rows[0].cnt}`);
if (dryRun) {
  console.log('(dry run — no changes made, re-run without --dry-run to apply)');
}
