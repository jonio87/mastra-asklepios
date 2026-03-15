/**
 * FHIR R4 Bundle Serializer
 *
 * Exports a patient's complete medical record as a FHIR R4 Bundle.
 * Supports both 'collection' (flat list) and 'document' (IPS) types.
 *
 * Usage:
 *   const bundle = await exportPatientBundle(store, patientId);
 *   const json = JSON.stringify(bundle, null, 2);
 */

import { getIcd10Code } from '../importers/icd10-normalizer.js';
import { getSnomedFindingCode } from '../importers/snomed-findings-normalizer.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { translateCode } from '../terminology/crosswalk-service.js';
import { SYSTEM_ICD10, SYSTEM_SNOMED } from '../terminology/terminology-service.js';
import { serializeCondition } from './condition.js';
import { serializeDiagnosticReport } from './diagnostic-report.js';
import { serializeEncounter } from './encounter.js';
import { serializeMedicationStatement } from './medication-statement.js';
import { serializeObservation } from './observation.js';
import { serializePatient } from './patient.js';
import { serializeProcedure } from './procedure.js';
import { serializeProvenance } from './provenance.js';
import type { Bundle, BundleEntry, FhirResource, Reference } from './types.js';
import { serializeVariantObservation } from './variant.js';

/**
 * Export a patient's complete record as a FHIR R4 Bundle.
 */
export async function exportPatientBundle(
  patientId: string,
  options?: {
    type?: 'collection' | 'document';
    includeConditions?: boolean;
    /** Include genetic variants. Default: clinicallyRelevantOnly (annotated variants).
     *  Set to { limit: Infinity } for full export (warning: ~638K resources). */
    includeGenetics?:
      | boolean
      | { limit?: number; rsids?: string[]; clinicallyRelevantOnly?: boolean };
  },
): Promise<Bundle> {
  const store = getClinicalStore();
  const bundleType = options?.type ?? 'collection';
  const patientRef = `Patient/${patientId}`;

  const entries: BundleEntry[] = [];

  // 1. Patient resource
  const patient = serializePatient({
    id: patientId,
    familyName: 'Szychliński',
    givenNames: ['Tomasz'],
    birthDate: '1991-11-18',
    gender: 'male',
    identifier: {
      system: 'urn:oid:2.16.840.1.113883.3.4424.1.1.616',
      value: '91111807912',
    },
    address: {
      line: ['ul. ŻOŁNIERSKA 10'],
      city: 'Wrocław',
      postalCode: '53-014',
      country: 'PL',
    },
  });
  entries.push(makeEntry(patient));

  // 2. Lab results → Observations
  const labs = await store.queryLabs({ patientId });
  for (const lab of labs) {
    entries.push(makeEntry(serializeObservation(lab, patientRef)));
  }

  // 3. Consultations → Encounters
  const consultations = await store.queryConsultations({ patientId });
  for (const con of consultations) {
    entries.push(makeEntry(serializeEncounter(con, patientRef)));
  }

  // 4. Imaging → DiagnosticReports
  const imaging = await store.getImagingReports(patientId);
  for (const img of imaging) {
    entries.push(makeEntry(serializeDiagnosticReport(img, patientRef)));
  }

  // 5. Medications → MedicationStatements
  const meds = await store.queryMedications({ patientId });
  for (const med of meds) {
    entries.push(makeEntry(serializeMedicationStatement(med, patientRef)));
  }

  // 6. Procedures
  const procedures = await store.getAbdominalReports(patientId);
  for (const proc of procedures) {
    entries.push(makeEntry(serializeProcedure(proc, patientRef)));
  }

  // 7. Genetic Variants → Variant Observations (Genomics Reporting IG STU3)
  if (options?.includeGenetics !== false) {
    const geneticOpts = typeof options?.includeGenetics === 'object' ? options.includeGenetics : {};
    const clinicallyRelevantOnly = geneticOpts.clinicallyRelevantOnly !== false;
    const variantLimit = geneticOpts.limit ?? 1000;

    if (clinicallyRelevantOnly) {
      // Only annotated variants (clinical significance, gene symbol, or ClinVar ID)
      const variants = await store.queryGeneticVariants({
        patientId,
        hasAnnotation: true,
        limit: variantLimit,
      });
      for (const v of variants) {
        entries.push(makeEntry(serializeVariantObservation(v, patientRef)));
      }
    } else if (geneticOpts.rsids) {
      // Specific rsids
      const variants = await store.queryGeneticVariants({
        patientId,
        rsids: geneticOpts.rsids,
        limit: variantLimit,
      });
      for (const v of variants) {
        entries.push(makeEntry(serializeVariantObservation(v, patientRef)));
      }
    } else {
      // Full export (caution: ~638K variants)
      const variants = await store.queryGeneticVariants({
        patientId,
        excludeNoCalls: true,
        limit: variantLimit,
      });
      for (const v of variants) {
        entries.push(makeEntry(serializeVariantObservation(v, patientRef)));
      }
    }
  }

  // 8. Conditions (from research hypotheses) — with crosswalk-enhanced dual coding
  if (options?.includeConditions !== false) {
    const hypotheses = await store.queryHypotheses({ patientId });
    for (const h of hypotheses) {
      // Resolve codes: start with what the hypothesis has, fill gaps via crosswalk
      let icd10Code = h.icdCode;
      let snomedCode: string | undefined;

      // Look up SNOMED code by condition name
      snomedCode = getSnomedFindingCode(h.name);

      // If we have SNOMED but no ICD-10, try crosswalk
      if (snomedCode && !icd10Code) {
        const crosswalkResults = translateCode(SYSTEM_SNOMED, snomedCode, SYSTEM_ICD10);
        if (crosswalkResults.length > 0) {
          icd10Code = crosswalkResults[0]!.targetCode;
        } else {
          // Fall back to direct ICD-10 lookup by name
          icd10Code = getIcd10Code(h.name);
        }
      }

      // If we have ICD-10 but no SNOMED, try reverse crosswalk
      if (icd10Code && !snomedCode) {
        const crosswalkResults = translateCode(SYSTEM_ICD10, icd10Code, SYSTEM_SNOMED);
        if (crosswalkResults.length > 0) {
          snomedCode = crosswalkResults[0]!.targetCode;
        }
      }

      // Export condition if we have at least one code
      if (icd10Code || snomedCode) {
        const conditionData: Parameters<typeof serializeCondition>[0] = {
          id: h.id,
          name: h.name,
          status: 'active',
        };
        if (icd10Code) conditionData.icd10Code = icd10Code;
        if (snomedCode) conditionData.snomedCode = snomedCode;
        entries.push(makeEntry(serializeCondition(conditionData, patientRef)));
      }
    }
  }

  // 9. Provenance — one per source document, linking to all derived resources
  const sourceDocs = await store.querySourceDocuments({ patientId, limit: 10000 });
  // Build a map of sourceDocumentId → resource references
  const sourceDocRefMap = new Map<string, Reference[]>();
  for (const entry of entries) {
    const meta = entry.resource.meta;
    const src = meta?.source;
    if (src) {
      let refs = sourceDocRefMap.get(src);
      if (!refs) {
        refs = [];
        sourceDocRefMap.set(src, refs);
      }
      refs.push({ reference: `urn:uuid:${entry.resource.id}` });
    }
  }
  for (const doc of sourceDocs) {
    const targetRefs = sourceDocRefMap.get(doc.id) ?? [];
    if (targetRefs.length > 0) {
      const docInfo: Parameters<typeof serializeProvenance>[0] = {
        id: doc.id,
        extractionDate: doc.extractionDate,
      };
      docInfo.originalFilename = doc.originalFilename;
      docInfo.contentHash = doc.originalFileHash;
      if (doc.pipelineVersion) docInfo.pipelineVersion = doc.pipelineVersion;
      docInfo.extractionMethod = doc.extractionMethod;
      entries.push(makeEntry(serializeProvenance(docInfo, targetRefs)));
    }
  }

  return {
    resourceType: 'Bundle',
    type: bundleType,
    timestamp: new Date().toISOString(),
    entry: entries,
    total: entries.length,
  };
}

function makeEntry(resource: FhirResource): BundleEntry {
  return {
    fullUrl: `urn:uuid:${resource.id}`,
    resource,
  };
}
