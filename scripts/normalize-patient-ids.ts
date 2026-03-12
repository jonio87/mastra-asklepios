/**
 * Normalize Patient IDs Across All Database Tables
 *
 * Problem: Two patient ID formats exist:
 *   - 'tomasz-szychliński' (Polish ń, original lab/consultation import)
 *   - 'patient-tomasz-szychlinski' (ASCII, new scripts convention)
 *
 * This causes queryLabs({ patientId: 'patient-tomasz-szychlinski' }) → 0 results
 * even though 1,144 lab results exist under the other ID.
 *
 * Solution: Normalize all Tomasz-related IDs to 'patient-tomasz-szychlinski'.
 */

import { ClinicalStore } from '../src/storage/clinical-store.js';

const CANONICAL_ID = 'patient-tomasz-szychlinski';

// All known variant IDs for this patient
const VARIANT_IDS = [
  'tomasz-szychliński',
  'tomasz-s',
  'patient-tomasz',
];

const TABLES_WITH_PATIENT_ID = [
  'clinical_lab_results',
  'clinical_treatment_trials',
  'clinical_consultations',
  'clinical_contradictions',
  'clinical_patient_reports',
  'clinical_agent_learnings',
  'research_findings',
  'research_queries',
  'research_hypotheses',
  'hypothesis_evidence_links',
];

async function main() {
  const store = new ClinicalStore();

  console.log('=== Patient ID Normalization ===\n');
  console.log(`Canonical ID: ${CANONICAL_ID}`);
  console.log(`Variant IDs to normalize: ${VARIANT_IDS.join(', ')}\n`);

  // 1. Show current state
  console.log('--- Before ---');
  for (const table of TABLES_WITH_PATIENT_ID) {
    const r = await store.client.execute({
      sql: `SELECT patient_id, COUNT(*) as cnt FROM ${table} WHERE patient_id LIKE '%tomasz%' GROUP BY patient_id`,
      args: [],
    });
    if (r.rows.length > 0) {
      for (const row of r.rows) {
        console.log(`  ${table}: "${row.patient_id}" → ${row.cnt} rows`);
      }
    }
  }

  // 2. Normalize each variant ID
  console.log('\n--- Normalizing ---');
  let totalUpdated = 0;

  for (const table of TABLES_WITH_PATIENT_ID) {
    for (const variantId of VARIANT_IDS) {
      const result = await store.client.execute({
        sql: `UPDATE ${table} SET patient_id = ? WHERE patient_id = ?`,
        args: [CANONICAL_ID, variantId],
      });
      const affected = result.rowsAffected;
      if (affected > 0) {
        console.log(`  ${table}: "${variantId}" → "${CANONICAL_ID}" (${affected} rows)`);
        totalUpdated += affected;
      }
    }
  }

  console.log(`\nTotal rows updated: ${totalUpdated}`);

  // 3. Show final state
  console.log('\n--- After ---');
  for (const table of TABLES_WITH_PATIENT_ID) {
    const r = await store.client.execute({
      sql: `SELECT patient_id, COUNT(*) as cnt FROM ${table} WHERE patient_id LIKE '%tomasz%' GROUP BY patient_id`,
      args: [],
    });
    if (r.rows.length > 0) {
      for (const row of r.rows) {
        console.log(`  ${table}: "${row.patient_id}" → ${row.cnt} rows`);
      }
    }
  }

  // 4. Verify homocysteine is now findable
  console.log('\n--- Verification ---');
  const labs = await store.queryLabs({
    patientId: CANONICAL_ID,
    testName: '%omocyst%',
  });
  console.log(`Homocysteine labs (${CANONICAL_ID}): ${labs.length} results`);
  for (const l of labs) {
    console.log(`  ${l.date}: ${l.value} ${l.unit} (${l.flag})`);
  }

  const allLabs = await store.queryLabs({ patientId: CANONICAL_ID });
  console.log(`\nTotal labs: ${allLabs.length}`);

  const consults = await store.queryConsultations({ patientId: CANONICAL_ID });
  console.log(`Total consultations: ${consults.length}`);

  const treatments = await store.queryTreatments({ patientId: CANONICAL_ID });
  console.log(`Total treatments: ${treatments.length}`);

  console.log('\n=== Normalization Complete ===');
}

main().catch(console.error);
