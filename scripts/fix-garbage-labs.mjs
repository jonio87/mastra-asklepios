#!/usr/bin/env node
/**
 * fix-garbage-labs.mjs — Remove 15 garbage lab entries from clinical_lab_results.
 *
 * These are extraction artifacts where column shifts, sample metadata rows,
 * or interpretation rows leaked into structured lab_values YAML blocks.
 *
 * Categories:
 *   1. Column-shifted protein electrophoresis (7 entries from 2021-09-20)
 *   2. Sample/order ID metadata rows (7 entries: WYMAZ, MOCZ, SUROWICA, order IDs)
 *   3. Interpretation metadata row (1 entry: "Interpretation"/"DODATNI")
 *
 * Usage:
 *   node scripts/fix-garbage-labs.mjs              # dry-run (default)
 *   node scripts/fix-garbage-labs.mjs --live        # actually delete
 */

import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const DRY_RUN = !process.argv.includes('--live');

const GARBAGE_IDS = [
  // Category 1: Column-shifted protein electrophoresis (2021-09-20)
  'import-lab-lab-20210920-diagnostyka-001-31', // test_name "5.9" (Alpha-2 globulins shifted)
  'import-lab-lab-20210920-diagnostyka-002-24', // test_name "66,0" (Albumin % shifted)
  'import-lab-lab-20210920-diagnostyka-002-25', // test_name "3,6" (Alpha-1 shifted)
  'import-lab-lab-20210920-diagnostyka-002-26', // test_name "5,9" (Alpha-2 shifted)
  'import-lab-lab-20210920-diagnostyka-002-27', // test_name "5,7" (Beta-1 shifted)
  'import-lab-lab-20210920-diagnostyka-002-28', // test_name "4,6" (Beta-2 shifted)
  'import-lab-lab-20210920-diagnostyka-002-29', // test_name "14,2" (Gamma shifted)

  // Category 2: Sample/order ID metadata rows
  'import-lab-lab-20240220-diagnostyka-004-7',  // test_name "1", unit "WYMAZ"
  'import-lab-lab-20240801-diagnostyka-001-1',  // test_name "7100824", unit "wymaz / gardło"
  'import-lab-lab-20240801-diagnostyka-003-7',  // test_name "1", unit "MOCZ"
  'import-lab-lab-20240801-diagnostyka-004-1',  // test_name "1", unit "WYMAZ"
  'import-lab-lab-20241210-diagnostyka-001-2',  // test_name "1", unit "SUROWICA"
  'import-lab-lab-20250127-diagnostyka-004-1',  // test_name "1", unit "SUROWICA"
  'import-lab-lab-20250127-diagnostyka-005-1',  // test_name "170880125", unit "wymaz / gardło"

  // Category 3: Interpretation metadata row
  'import-lab-lab-20231123-diagnostyka-001-1',  // test_name "Interpretation", value "DODATNI"
];

async function main() {
  console.log('\n=== Fix Garbage Lab Entries ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (use --live to execute)' : 'LIVE'}\n`);

  // Verify all entries exist
  let found = 0;
  let missing = 0;

  for (const id of GARBAGE_IDS) {
    const result = await c.execute({ sql: 'SELECT id, test_name, value, unit, date FROM clinical_lab_results WHERE id = ?', args: [id] });
    if (result.rows.length > 0) {
      const row = result.rows[0];
      found++;
      console.log(`  FOUND: ${row.id} → test="${row.test_name}" value="${row.value}" unit="${row.unit}" date=${row.date}`);
    } else {
      missing++;
      console.log(`  MISSING: ${id}`);
    }
  }

  console.log(`\nSummary: ${found} found, ${missing} missing out of ${GARBAGE_IDS.length} targeted\n`);

  if (found === 0) {
    console.log('Nothing to delete. Database is already clean.');
    return;
  }

  // Get counts before
  const countBefore = (await c.execute('SELECT COUNT(*) as cnt FROM clinical_lab_results')).rows[0].cnt;
  const abnormalBefore = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE flag NOT IN ('normal', '') AND flag IS NOT NULL")).rows[0].cnt;

  if (DRY_RUN) {
    console.log(`Would delete ${found} entries.`);
    console.log(`Lab entries: ${countBefore} → ${Number(countBefore) - found}`);
    console.log(`Abnormal entries: ${abnormalBefore} (check after deletion)`);
    console.log('\nRun with --live to execute.\n');
  } else {
    let deleted = 0;
    for (const id of GARBAGE_IDS) {
      const result = await c.execute({ sql: 'DELETE FROM clinical_lab_results WHERE id = ?', args: [id] });
      deleted += result.rowsAffected;
    }

    const countAfter = (await c.execute('SELECT COUNT(*) as cnt FROM clinical_lab_results')).rows[0].cnt;
    const abnormalAfter = (await c.execute("SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE flag NOT IN ('normal', '') AND flag IS NOT NULL")).rows[0].cnt;

    console.log(`Deleted ${deleted} entries.`);
    console.log(`Lab entries: ${countBefore} → ${countAfter}`);
    console.log(`Abnormal entries: ${abnormalBefore} → ${abnormalAfter}`);
  }

  console.log('\nDone.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
