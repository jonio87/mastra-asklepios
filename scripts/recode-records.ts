/**
 * Retroactive Re-coding Script — Pipeline v3.0.0 (US-005)
 *
 * Reads existing L1 records that are missing terminology codes (LOINC, SNOMED,
 * ICD-10), re-runs normalizers with the latest terminology maps, and updates
 * records in-place. Reports before/after coverage.
 *
 * Usage:
 *   npx tsx scripts/recode-records.ts [options]
 *
 * Options:
 *   --patient-id <id>  Patient ID (default: 'patient-tomasz-szychlinski')
 *   --dry-run          Show what would change without updating DB
 *   --verbose          Print each re-coding action
 */

import { getClinicalStore } from '../src/storage/clinical-store.js';
import {
  getLoincCode,
  getLoincCodeAsync,
  getValueSnomedCode,
} from '../src/importers/normalizer.js';
import { getSnomedFindingCode } from '../src/importers/snomed-findings-normalizer.js';
import { getImagingLoincCode } from '../src/importers/imaging-loinc-normalizer.js';
import { translateCode } from '../src/terminology/crosswalk-service.js';
import { initTerminologyProviders } from '../src/terminology/init.js';
import { initLoincLookup } from '../src/importers/loinc-lookup.js';
import { SYSTEM_SNOMED, SYSTEM_ICD10 } from '../src/terminology/terminology-service.js';

// ─── CLI Args ─────────────────────────────────────────────────────────────────

function parseArgs(): { patientId: string; dryRun: boolean; verbose: boolean } {
  const args = process.argv.slice(2);
  let patientId = 'patient-tomasz-szychlinski';
  let dryRun = false;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--patient-id' && args[i + 1]) {
      patientId = args[i + 1] as string;
      i++;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--verbose') {
      verbose = true;
    }
  }

  return { patientId, dryRun, verbose };
}

// ─── Coverage Counters ────────────────────────────────────────────────────────

interface Coverage {
  labsLoincBefore: number;
  labsLoincAfter: number;
  labsTotal: number;
  snomedValueBefore: number;
  snomedValueAfter: number;
  snomedValueTotal: number;
  snomedFindingBefore: number;
  snomedFindingAfter: number;
  consultTotal: number;
  icd10Before: number;
  icd10After: number;
  imagingLoincBefore: number;
  imagingLoincAfter: number;
  imagingTotal: number;
}

// ─── Report Printer ───────────────────────────────────────────────────────────

function printReport(cov: Coverage, dryRun: boolean): void {
  const tag = dryRun ? ' (dry-run)' : '';
  console.log(`\nRe-coding Report${tag}`);
  console.log('═══════════════════════════════════════════');
  console.log('                    Before    After    Δ');
  console.log(
    `LOINC (labs):       ${fmt(cov.labsLoincBefore, cov.labsTotal)} ${fmt(cov.labsLoincAfter, cov.labsTotal)} ${delta(cov.labsLoincBefore, cov.labsLoincAfter)}`,
  );
  console.log(
    `SNOMED value:       ${fmt(cov.snomedValueBefore, cov.snomedValueTotal)} ${fmt(cov.snomedValueAfter, cov.snomedValueTotal)} ${delta(cov.snomedValueBefore, cov.snomedValueAfter)}`,
  );
  console.log(
    `SNOMED finding:     ${fmt(cov.snomedFindingBefore, cov.consultTotal)} ${fmt(cov.snomedFindingAfter, cov.consultTotal)} ${delta(cov.snomedFindingBefore, cov.snomedFindingAfter)}`,
  );
  console.log(
    `ICD-10 (consult):   ${fmt(cov.icd10Before, cov.consultTotal)} ${fmt(cov.icd10After, cov.consultTotal)} ${delta(cov.icd10Before, cov.icd10After)}`,
  );
  console.log(
    `Imaging LOINC:      ${fmt(cov.imagingLoincBefore, cov.imagingTotal)} ${fmt(cov.imagingLoincAfter, cov.imagingTotal)} ${delta(cov.imagingLoincBefore, cov.imagingLoincAfter)}`,
  );
  console.log('═══════════════════════════════════════════');
}

function fmt(count: number, total: number): string {
  return `${count}/${total}`.padEnd(10);
}

function delta(before: number, after: number): string {
  const d = after - before;
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return '0';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { patientId, dryRun, verbose } = parseArgs();

  console.log(`Re-coding records for patient: ${patientId}`);
  if (dryRun) console.log('DRY RUN — no changes will be written\n');

  // 1. Initialize terminology providers + LOINC lookup
  console.log('Initializing terminology providers...');
  initTerminologyProviders();
  await initLoincLookup();
  console.log('Terminology ready.\n');

  const store = getClinicalStore();

  const cov: Coverage = {
    labsLoincBefore: 0,
    labsLoincAfter: 0,
    labsTotal: 0,
    snomedValueBefore: 0,
    snomedValueAfter: 0,
    snomedValueTotal: 0,
    snomedFindingBefore: 0,
    snomedFindingAfter: 0,
    consultTotal: 0,
    icd10Before: 0,
    icd10After: 0,
    imagingLoincBefore: 0,
    imagingLoincAfter: 0,
    imagingTotal: 0,
  };

  // ── 2a. Labs — LOINC + SNOMED value ───────────────────────────────────────
  console.log('Processing lab results...');
  const labs = await store.queryLabs({ patientId });
  cov.labsTotal = labs.length;

  for (const lab of labs) {
    // LOINC
    if (lab.loincCode) {
      cov.labsLoincBefore++;
      cov.labsLoincAfter++;
    } else {
      // Try sync first, then async with embedding/axis fallback
      let loincCode = getLoincCode(lab.testName);
      if (!loincCode) {
        loincCode = await getLoincCodeAsync(lab.testName);
      }
      if (loincCode) {
        if (verbose) console.log(`  LAB LOINC  ${lab.id} (${lab.testName}) → ${loincCode}`);
        if (!dryRun) await store.updateLabLoincCode(lab.id, loincCode);
        cov.labsLoincAfter++;
      }
    }

    // SNOMED qualitative value (only for non-empty string values)
    const valueStr = typeof lab.value === 'string' ? lab.value : undefined;
    if (valueStr !== undefined) {
      cov.snomedValueTotal++;
      if (lab.valueSnomedCode) {
        cov.snomedValueBefore++;
        cov.snomedValueAfter++;
      } else {
        const snomedCode = getValueSnomedCode(valueStr);
        if (snomedCode) {
          if (verbose)
            console.log(`  LAB SNOMED ${lab.id} (${lab.testName}="${valueStr}") → ${snomedCode}`);
          if (!dryRun) await store.updateLabSnomedCode(lab.id, snomedCode);
          cov.snomedValueAfter++;
        }
      }
    }
  }

  console.log(`  Labs processed: ${labs.length}`);

  // ── 2b. Consultations — SNOMED finding + ICD-10 ───────────────────────────
  console.log('Processing consultations...');
  const consultations = await store.queryConsultations({ patientId });
  cov.consultTotal = consultations.length;

  for (const consult of consultations) {
    // SNOMED finding
    let snomedFindingCode = consult.snomedFindingCode;

    if (snomedFindingCode) {
      cov.snomedFindingBefore++;
      cov.snomedFindingAfter++;
    } else {
      // Try conclusions first, then reason as fallback
      const textToTry = [consult.conclusions, consult.reason].filter(
        (t): t is string => typeof t === 'string' && t.length > 0,
      );

      for (const text of textToTry) {
        const code = getSnomedFindingCode(text);
        if (code) {
          snomedFindingCode = code;
          break;
        }
      }

      if (snomedFindingCode) {
        if (verbose)
          console.log(
            `  CON SNOMED ${consult.id} (${consult.specialty} ${consult.date}) → ${snomedFindingCode}`,
          );
        if (!dryRun)
          await store.updateConsultationSnomedFinding(consult.id, snomedFindingCode);
        cov.snomedFindingAfter++;
      }
    }

    // ICD-10 — use existing SNOMED finding code (just assigned or pre-existing)
    if (consult.icd10Code) {
      cov.icd10Before++;
      cov.icd10After++;
    } else if (snomedFindingCode) {
      const crosswalkResults = translateCode(SYSTEM_SNOMED, snomedFindingCode, SYSTEM_ICD10);
      const icd10Code = crosswalkResults[0]?.targetCode;
      if (icd10Code) {
        if (verbose)
          console.log(
            `  CON ICD-10  ${consult.id} (${consult.specialty} ${consult.date}) → ${icd10Code}`,
          );
        if (!dryRun) await store.updateConsultationIcd10Code(consult.id, icd10Code);
        cov.icd10After++;
      }
    }
  }

  console.log(`  Consultations processed: ${consultations.length}`);

  // ── 2c. Imaging — LOINC study code ────────────────────────────────────────
  console.log('Processing imaging reports...');
  const imagingReports = await store.getImagingReports(patientId);
  cov.imagingTotal = imagingReports.length;

  for (const report of imagingReports) {
    if (report.loincStudyCode) {
      cov.imagingLoincBefore++;
      cov.imagingLoincAfter++;
    } else {
      const loincCode = getImagingLoincCode(report.modality, report.bodyRegion);
      if (loincCode) {
        if (verbose)
          console.log(
            `  IMG LOINC   ${report.id} (${report.modality} ${report.bodyRegion}) → ${loincCode}`,
          );
        if (!dryRun) await store.updateImagingLoincCode(report.id, loincCode);
        cov.imagingLoincAfter++;
      }
    }
  }

  console.log(`  Imaging reports processed: ${imagingReports.length}`);

  // 3. Print before/after coverage report
  printReport(cov, dryRun);
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
