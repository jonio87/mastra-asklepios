# Standards System Gap Analysis — Path to SOTA

**Date:** 2026-03-15
**Scope:** All healthcare interoperability standards in Asklepios
**Purpose:** Identify gaps between current implementation and state-of-the-art, propose fixes, and create a prioritized action plan for planning.

---

## Executive Summary

Asklepios implements 10 healthcare interoperability standards with varying degrees of maturity. The foundation is solid — FHIR R4 resource model, LOINC lab/imaging codes, SNOMED CT clinical findings, RxNorm medications, and W3C PROV provenance are all structurally present. However, the implementation relies heavily on **hardcoded lookup maps** rather than proper terminology services, **crosswalks are implicit** rather than validated, and several standards have **significant coverage gaps**.

### Maturity Scorecard

| Standard | Current Maturity | SOTA Target | Gap Size |
|----------|:----------------:|:-----------:|:--------:|
| FHIR R4 | 70% | 95% | Medium |
| LOINC | 75% | 95% | Medium |
| SNOMED CT | 60% | 90% | Large |
| ICD-10 | 25% | 85% | **Critical** |
| RxNorm | 65% | 90% | Medium |
| HL7 v2-0074 | 90% | 95% | Small |
| USCDI v3 | 40% | 85% | Large |
| W3C PROV | 55% | 90% | Large |
| GA4GH VRS | 70% | 85% | Medium |
| HL7 Genomics IG | 65% | 85% | Medium |

**Key architectural gap:** No unified Terminology Service layer. Each standard is implemented as an isolated hardcoded map in a separate file, with no validation, no versioning, no crosswalk infrastructure, and no API-based updates.

### Key SOTA Research Findings

1. **Stay on FHIR R4** — R4 dominates globally (31/57 countries in Firely 2025 survey). Epic/Oracle don't support R5. HTI-1 mandates R4-based US Core 6.1.0 through 2026+. But prepare for R5: `Condition.clinicalStatus` becomes **required** (1..1), `Encounter.statusHistory`/`classHistory` removed, and `CodeableReference` replaces several element types.

2. **Use NLM Extended Map for SNOMED↔ICD-10** — The NLM SNOMED CT to ICD-10-CM Extended Map (released with each US SNOMED CT Edition) provides rule-based crosswalks with Map Groups and Map Rules. Available as `der2_iisssccRefset_ExtendedMap_US1000124_YYYYMMDD.txt`. Free with UMLS license.

3. **LOINC FHIR API as Tier 4 fallback** — The official LOINC FHIR server at `fhir.loinc.org` provides `$lookup`, `$validate-code`, `$expand`, and `$translate`. Use as async fallback after local CSV tiers for the remaining uncoded labs.

4. **Snowstorm Lite for SNOMED** — SNOMED International's lightweight FHIR terminology server imports a release in ~5 minutes, runs as single Docker container. Provides `$lookup`, `$validate-code`, basic `$expand` — ideal for Phase 2 terminology service.

5. **UMLS CUI as crosswalk pivot** — Instead of N×N pairwise maps, each concept gets a UMLS CUI that anchors all code system representations (SNOMED → CUI → ICD-10, RxNorm, MeSH). Building a CUI-indexed table for the 400+ SNOMED findings would automatically provide ICD-10 and other mappings.

6. **RxNav API for ATC** — NLM's RxNav API (`rxnav.nlm.nih.gov`) provides free ATC classification via `getClassByRxNormDrugId`. No UMLS license needed, 20 req/sec rate limit.

7. **5 ad-hoc ICD-10 codes buried in SNOMED map** — `snomed-findings-normalizer.ts` lines 400, 442, 455, 465, 468 contain ICD-10 codes ('G44.8', 'G62.8', 'G90', 'M54.4', 'J31.0') mixed into the SNOMED findings map. These are implicit crosswalks in the wrong file — they should be in a crosswalk table.

---

## 1. FHIR R4 — Resource Model & Export

### Current State

**What exists:**
- 9 FHIR R4 serializers: Patient, Observation, DiagnosticReport, Encounter, Procedure, MedicationStatement, Condition, Provenance, Bundle (`src/fhir/`)
- Variant Observation following HL7 Genomics Reporting IG STU3 (`src/fhir/variant.ts`)
- Bundle export with collection/document types (`src/fhir/bundle.ts`)
- Terminology system URIs correctly used (LOINC, SNOMED, ICD-10, RxNorm, UCUM, DBSNP, HGNC, SO)
- UCUM code mapping for 40+ unit types (`src/fhir/observation.ts:22-77`)

**What's missing:**

| Gap | Severity | Details |
|-----|:--------:|---------|
| **No FHIR validation** | High | Resources are never validated against FHIR R4 profiles. No use of official FHIR validators (e.g., `hl7.fhir.r4.core` StructureDefinitions). Invalid resources could be exported silently. |
| **Missing serializers** | Medium | DocumentReference (narratives/externals), ClinicalImpression (contradictions/learnings), AllergyIntolerance, FamilyMemberHistory — schemas defined in `src/schemas/clinical-record.ts` but no FHIR serializers |
| **No IPS compliance** | Medium | International Patient Summary (IPS) IG requires specific profiles (IPS-Observation, IPS-Condition, etc.). Bundle type 'document' is available but doesn't follow IPS composition structure. |
| **Hardcoded patient data** | Low | Patient demographics hardcoded in `src/fhir/bundle.ts:47-62` instead of loaded from a Patient table |
| **No FHIR R5 preparation** | Info | R4 is dominant (2026), but R5 has breaking changes: `Condition.clinicalStatus` becomes required (1..1), `Encounter.statusHistory`/`classHistory` removed (replaced by EncounterHistory resource), `Condition.recorder`/`asserter` deleted (replaced by `participant`), `MedicationStatement.medication` uses new `CodeableReference` type. Current code at `condition.ts:60-69` doesn't always populate `clinicalStatus` — will break on R5. |
| **fhirStatus hardcoded** | Low | FHIR status is set to `'final'` in serializers rather than reading from schema's `fhirStatus` field. `src/fhir/observation.ts:84` always sets `status: 'final'`. |

### SOTA Recommendations

1. **Add FHIR resource validation layer** — Use `@ahryman40k/ts-fhir-types` or a lightweight JSON Schema validator against R4 StructureDefinitions. Validate every resource before adding to bundle.
   - Location: New `src/fhir/validator.ts`
   - Effort: **M**

2. **Implement missing serializers** — DocumentReference, ClinicalImpression, AllergyIntolerance, FamilyMemberHistory
   - Location: `src/fhir/document-reference.ts`, etc.
   - Effort: **M**

3. **IPS compliance** — Add IPS Bundle composition with required sections (Medications, Allergies, Conditions, Results)
   - Location: `src/fhir/ips-bundle.ts`
   - Effort: **L**

4. **Read fhirStatus from records** — Stop hardcoding `'final'`; use the `fhir_status` column from L1 tables
   - Location: All serializers in `src/fhir/`
   - Effort: **S**

---

## 2. LOINC — Laboratory, Document, Imaging & Procedure Codes

### Current State

**Architecture:** Three-tier lookup system

| Tier | Source | Size | Location |
|------|--------|------|----------|
| Tier 1 | `LOINC_CODE_MAP` (curated) | 300+ tests | `src/importers/normalizer.ts` |
| Tier 2 | `LoincTopRanked.csv` | 20K codes | `src/importers/loinc-lookup.ts` + `data/loinc/` |
| Tier 3 | `LoincTableCore.csv.gz` | 100K codes | `src/importers/loinc-lookup.ts` + `data/loinc/` |

**Coverage by role:**

| LOINC Role | Implementation | Coverage | Location |
|------------|---------------|:--------:|----------|
| Lab test codes | 300+ curated + 20K/100K fallback | **99.7%** of DB records | `normalizer.ts`, `loinc-lookup.ts` |
| Document ontology | 6 document type codes | **92.5%** of L0 docs | `source-document.ts` |
| Imaging study codes | ~30 modality×region combos | **100%** of DB records | `imaging-loinc-normalizer.ts` |
| Procedure codes | 14 procedure types | **100%** of DB records | `procedure-loinc-normalizer.ts` |

**What's missing:**

| Gap | Severity | Details |
|-----|:--------:|---------|
| **No LOINC version pinning** | High | Codes reference "v2.82 (local reference)" but no mechanism enforces version consistency. LOINC codes can be deprecated across versions. |
| **Tier 2/3 reverse index is name-only** | Medium | `searchLoincSync()` does exact match on component/longCommonName/shortName. No fuzzy matching, no synonyms, no LOINC Part-based matching. |
| **No LOINC Part hierarchy** | Medium | Can't determine that "WBC" and "Leukocytes in Blood" are the same Part. No Part-Component-System-Scale-Method axis decomposition. |
| **Imaging LOINC gaps** | Medium | Missing: ultrasound (abdomen/pelvis/thyroid/carotid), PET/SPECT, mammography, DEXA, fluoroscopy. Only ~30 combos in `imaging-loinc-normalizer.ts`. |
| **Procedure LOINC gaps** | Medium | Only 14 specific procedures; ~50 others fall back to generic 28570-0. Missing: lumbar puncture, nerve biopsy, specific endoscopy subtypes. `procedure-loinc-normalizer.ts` has 14 entries. |
| **No RELMA integration** | Low | RELMA is now in **maintenance mode** (no new features). Regenstrief migrating to web-based tools. Windows-only, not suitable for programmatic integration. **Skip for Asklepios.** |
| **No LOINC FHIR API** | Medium | Official LOINC FHIR server at `fhir.loinc.org` provides `$lookup`, `$validate-code`, `$expand`, `$translate`. Use as Tier 4 fallback for uncoded labs. Free account required. |

### SOTA Recommendations

1. **Implement LOINC version management** — Pin version in config, validate codes against version-specific active set.
   - Location: New `src/terminology/loinc-service.ts`
   - Effort: **M**

2. **Expand imaging LOINC map** — Add ultrasound body regions (10+), PET/SPECT, mammography, DEXA, fluoroscopy
   - Location: `src/importers/imaging-loinc-normalizer.ts`
   - Effort: **S**

3. **Expand procedure LOINC map** — Add 30+ specific procedure codes (lumbar puncture, nerve biopsy, etc.)
   - Location: `src/importers/procedure-loinc-normalizer.ts`
   - Effort: **S**

4. **Add LOINC Part-based matching** — Use LOINC Part hierarchy for semantic equivalence checking
   - Location: New `src/terminology/loinc-parts.ts`
   - Effort: **L**

---

## 3. SNOMED CT — Clinical Terminology

### Current State

**Architecture:** Flat lookup maps (no hierarchy, no ECL, no subsumption)

| SNOMED Role | Implementation | Coverage | Location |
|-------------|---------------|:--------:|----------|
| Clinical findings | 400+ conditions (EN/PL/DE) | **66.7%** of consultations coded | `snomed-findings-normalizer.ts` |
| Specialty codes | 23 specialties | **98.9%** of consultations coded | `specialty-normalizer.ts` |
| Qualitative values | ~30 result values | **~71%** of qualitative labs coded | `normalizer.ts` (`SNOMED_QUALITATIVE_MAP`) |
| Body site codes | 8 anatomical regions | **0%** in DB (column missing) | `imaging-loinc-normalizer.ts` |

**What's missing:**

| Gap | Severity | Details |
|-----|:--------:|---------|
| **No SNOMED hierarchy/subsumption** | High | Flat map can't answer "Is X a type of Y?" — e.g., "Is Tension-type headache a Headache?" No Expression Constraint Language (ECL). |
| **Body site codes not persisted** | High | `BODY_REGION_SNOMED_MAP` exists (8 regions) but `body_site_snomed_code` column missing from DB migration. Schema defines it, code produces it, DB doesn't store it. |
| **Only 8 body regions** | Medium | Missing: lumbar spine (122496009), lumbosacral, sacroiliac, pelvis, hip, knee, ankle, upper/lower extremity (~12 more needed). |
| **No SNOMED version pinning** | Medium | Codes reference "International 2025-01" in comments but no enforcement. |
| **No SNOMED severity/grade codes** | Medium | Missing: numeric grades (1+/2+/3+/4+), severity scales (mild/moderate/severe). Only ~30 qualitative values in `SNOMED_QUALITATIVE_MAP`. |
| **Fuzzy matching risks** | Medium | `getSnomedFindingCode()` uses substring + reverse matching that could produce false positives for short strings (threshold is 10 chars, but "Headache" is 8 chars). |
| **No SNOMED CT GPS** | Low | SNOMED CT Global Patient Set (free international subset) not evaluated for international use. |

### SOTA Recommendations

1. **Add `body_site_snomed_code` column to DB** — Fix schema-DB drift. Add to migration, backfill existing records.
   - Location: `src/storage/clinical-store.ts` migration
   - Effort: **S**

2. **Expand body region SNOMED map** — Add 12+ missing anatomical regions
   - Location: `src/importers/imaging-loinc-normalizer.ts`
   - Effort: **S**

3. **Add severity/grade SNOMED codes** — Map mild/moderate/severe, 1+/2+/3+/4+ to SNOMED CT severity concepts
   - Location: `src/importers/normalizer.ts`
   - Effort: **S**

4. **Implement lightweight SNOMED subsumption** — Build ancestor index for the ~400 mapped concepts to enable "is-a" queries without a full terminology server
   - Location: New `src/terminology/snomed-service.ts`
   - Effort: **L**

---

## 4. ICD-10 — Diagnosis Codes

### Current State — CRITICAL GAP

**Status: 25% implemented**

| Component | Status | Details |
|-----------|--------|---------|
| Schema field | Implemented | `Diagnosis.icd10Code` on L2 schema, `Condition.code` on FHIR export |
| Validation regex | Implemented | `^[A-Z]\d{2}(\.[A-Za-z0-9]{1,4})?$` supports ICD-10-CM + PL extensions |
| FHIR dual-coding | Implemented | ICD-10 + SNOMED CT in `Condition.code.coding[]` |
| **Code lookup table** | **NOT implemented** | No `ICD10_CODE_MAP`. Codes only present when manually provided or AI-generated. |
| **ICD-10 hierarchy** | **NOT implemented** | No parent→child traversal |
| **ICD-10-PCS** | **NOT implemented** | No procedure codes |
| **Automatic assignment** | **NOT implemented** | Unlike LOINC (300+ map) and SNOMED (400+ map), no curated ICD-10 mappings |

**This is the single largest standards gap.** ICD-10 is:
- Required for insurance/billing in every healthcare system
- Required by USCDI v3 for diagnosis coding
- Required for FHIR US Core Condition profiles
- The primary classification system for epidemiological analysis

### SOTA Recommendations

1. **Build ICD-10 code map** — Map the 400+ conditions already in the SNOMED findings map to ICD-10-CM codes. This enables automatic dual-coding.
   - Location: New `src/importers/icd10-normalizer.ts`
   - Coverage target: Same 400+ conditions as SNOMED map
   - Effort: **L**

2. **Implement SNOMED → ICD-10 crosswalk** — Use the NLM SNOMED CT to ICD-10-CM mapping set (available from NLM UMLS) as authoritative crosswalk
   - Location: New `src/terminology/crosswalks.ts`
   - Effort: **L**

3. **Add ICD-10 hierarchy support** — Load ICD-10-CM tabular data for parent→child traversal (e.g., G62 → G62.0, G62.1, G62.8)
   - Location: New `src/terminology/icd10-service.ts`
   - Effort: **M**

4. **Validate dual-coding consistency** — When both ICD-10 and SNOMED are present on a Condition, validate that they map to the same clinical concept
   - Location: `src/fhir/condition.ts` or validation layer
   - Effort: **M**

---

## 5. RxNorm — Medication Codes

### Current State

**Architecture:** Two hardcoded maps

| Map | Size | Location |
|-----|------|----------|
| `RXNORM_CODE_MAP` | 160+ generic names → CUI | `src/importers/rxnorm-normalizer.ts:18-160` |
| `BRAND_TO_GENERIC` | 260+ brand/inflected → generic | `src/importers/rxnorm-normalizer.ts:166-261` |

**Coverage:** 100% of medications in DB (34/34) have RxNorm codes. This is good for current data but fragile for new medications.

**What's missing:**

| Gap | Severity | Details |
|-----|:--------:|---------|
| **No NLM RxNorm API integration** | High | Codes are hardcoded. New medications require manual map updates. NLM provides free RxNorm REST API for real-time lookup. |
| **No ATC coding** | High | WHO Anatomical Therapeutic Classification not implemented. Required for international medication analysis, drug-drug interaction classification, and pharmacoepidemiological research. |
| **No RxNorm term type awareness** | Medium | Map uses ingredient-level CUIs (IN). Doesn't distinguish IN vs BN vs SCD vs SBD. Clinical dose forms (SCD) needed for prescribing context. |
| **No automated CUI validation** | Medium | No check that hardcoded CUIs are still active in current RxNorm release. |
| **Polish medication gaps** | Medium | ~30% of Polish medications may be unmapped (herbal supplements, compounded drugs, Polish-specific brands). |
| **No SNOMED medication concept mapping** | Low | RxNorm → SNOMED drug concept mapping not implemented. |

### SOTA Recommendations

1. **Implement NLM RxNorm API client** — For real-time medication lookup with caching
   - Location: New `src/terminology/rxnorm-service.ts`
   - Effort: **M**

2. **Add ATC coding** — Map medications to WHO ATC codes. NLM provides RxNorm→ATC crosswalk via UMLS.
   - Location: New `src/importers/atc-normalizer.ts` or extend `rxnorm-normalizer.ts`
   - Effort: **M**

3. **Validate existing CUIs** — Script to check all hardcoded CUIs against current RxNorm release
   - Location: New `scripts/validate-rxnorm-codes.ts`
   - Effort: **S**

---

## 6. Crosswalks — Cross-System Code Mappings

### Current State — ARCHITECTURAL GAP

**All crosswalks are implicit.** There is no crosswalk infrastructure. Codes are assigned independently per system.

| Crosswalk | Status | Mechanism | Risk |
|-----------|--------|-----------|------|
| SNOMED ↔ ICD-10 | **Implicit** | Same condition name → two independent code lookups | High — codes may not represent the same concept |
| LOINC → SNOMED (values) | **Implemented** | LOINC question + SNOMED answer on lab results | Low |
| LOINC → SNOMED (body sites) | **Implemented** | Imaging LOINC + SNOMED body site | Low |
| RxNorm → ATC | **Not implemented** | — | Medium |
| RxNorm → SNOMED drug | **Not implemented** | — | Low |
| ICD-10 ↔ SNOMED (explicit) | **Not implemented** | No crosswalk table | High |
| LOINC → SNOMED (test concepts) | **Not implemented** | No mapping from LOINC test code to SNOMED observable entity | Medium |

### Architecture Anti-Pattern: Ad-hoc ICD-10 in SNOMED Map

The SNOMED findings normalizer (`snomed-findings-normalizer.ts`) contains **5 ad-hoc ICD-10→SNOMED entries** mixed into what should be a pure SNOMED lookup:
- Line 400: `'J31.0': '6847001'` (Chronic rhinitis)
- Line 442: `'G62.8': '42345000'` (Polyneuropathy)
- Line 455: `'G44.8': '398057008'` (Tension-type headache)
- Line 465: `'G90': '72167002'` (Autonomic dysfunction)
- Line 468: `'M54.4': '23056005'` (Sciatica)

These are implicit crosswalks in the wrong file. They should be extracted to a dedicated crosswalk table.

### SOTA Architecture for Crosswalks

**The SOTA approach uses FHIR ConceptMap resources for explicit crosswalks:**

```
ConceptMap {
  source: "http://snomed.info/sct"
  target: "http://hl7.org/fhir/sid/icd-10"
  group: [
    { element: [
      { code: "398057008", display: "Tension-type headache",
        target: [{ code: "G44.2", equivalence: "equivalent" }] }
    ]}
  ]
}
```

**Recommended crosswalk data sources:**

| Crosswalk | Authoritative Source | Format | License |
|-----------|---------------------|--------|---------|
| SNOMED → ICD-10 | NLM UMLS Metathesaurus | MRCONSO.RRF | UMLS license (free) |
| SNOMED → ICD-10 | SNOMED International map | RF2 distribution | SNOMED license |
| RxNorm → ATC | NLM UMLS | MRREL.RRF | UMLS license |
| LOINC → SNOMED | LOINC-SNOMED CT cooperation | Part mapping | LOINC license |

### SOTA Recommendations

1. **Build crosswalk infrastructure** — FHIR ConceptMap-based crosswalk service with $translate operation
   - Location: New `src/terminology/crosswalk-service.ts`
   - Effort: **L**

2. **Load NLM SNOMED→ICD-10-CM Extended Map** — The authoritative source: `der2_iisssccRefset_ExtendedMap_US1000124_YYYYMMDD.txt` from NLM. Uses Map Groups and Map Rules with the I-MAGIC algorithm. Free with UMLS license. Start with the ~400 conditions already in the SNOMED findings map.
   - Location: `data/crosswalks/snomed-icd10.json`
   - Effort: **M**
   - Note: Poland uses WHO ICD-10 (not ICD-10-CM). Ensure crosswalk handles both targets since Polish records use WHO codes.

3. **Use UMLS CUI as crosswalk pivot** — Instead of N×N pairwise maps, anchor each concept to a UMLS CUI. Example: CUI C0018681 (Headache) → SNOMED 25064002, ICD-10-CM R51.9, ICD-10 R51, MeSH D006261. Building a CUI-indexed table for the 400+ mapped conditions provides automatic multi-system mappings.
   - Location: Add `umlsCui` field to `Diagnosis` schema + `data/crosswalks/cui-index.json`
   - Effort: **M**

4. **Validate dual-coded resources** — When FHIR Condition has both ICD-10 and SNOMED, verify they map to equivalent concepts via the crosswalk
   - Location: `src/fhir/validator.ts`
   - Effort: **M**

5. **Extract ad-hoc ICD-10 entries from SNOMED map** — Move the 5 ICD-10 codes from `snomed-findings-normalizer.ts` to the crosswalk table
   - Location: `snomed-findings-normalizer.ts` lines 400, 442, 455, 465, 468
   - Effort: **S**

---

## 7. HL7 v2-0074 — Diagnostic Service Section Codes

### Current State — NEAR COMPLETE

| Component | Status |
|-----------|--------|
| 5 codes implemented (LAB, RAD, GE, NRS, OTH) | Good |
| Applied to L0 source docs | 98.1% coverage |
| Applied to L1 imaging reports | 100% coverage |

### Gaps

- **6 documents missing diagnostic service section** (4 narratives, 2 procedures)
- **Missing codes:** NUC (Nuclear Medicine), AU (Audiology), CT (Cardiology/Echocardiography) — not needed for current data but would be for completeness

### Recommendations

- Backfill 6 missing documents — **Effort: S**
- No architectural changes needed

---

## 8. USCDI v3/v4 Compliance

### Current State

| USCDI Data Class | Asklepios Coverage | Status |
|-----------------|-------------------|--------|
| Patient Demographics | Patient FHIR resource | Partial (hardcoded) |
| Allergies & Intolerances | Schema defined, no data | **Gap** |
| Medications | 34 medications with RxNorm | Implemented |
| Problems (Conditions) | ICD-10 + SNOMED dual-coding | Partial (no ICD-10 map) |
| Laboratory Results | 1,350 with LOINC codes | **Implemented** |
| Vital Signs | Not tracked | **Gap** |
| Procedures | 24 with LOINC codes | Implemented |
| Clinical Notes | Consultation + Procedure notes | Partial |
| Assessment & Plan | Not structured separately | **Gap** |
| Health Concerns | Not tracked | **Gap** |
| Goals | Patient reports (goals type) | Partial |
| Immunizations | Not tracked | **Gap** |
| Provenance | W3C PROV implemented | Implemented (but underpopulated) |
| Clinical Tests | Imaging reports | Partial |
| Diagnostic Imaging | LOINC-coded imaging reports | Implemented |

### USCDI v4/v5 New Requirements (HTI-2)

| New Data Class (v4/v5) | Current Status |
|------------------------|---------------|
| Average Blood Pressure | Not tracked |
| Medications: Dose, Route, Timing | Partial (dose only) |
| Clinical Notes: expanded types | Partial |
| Health Insurance Information | Not applicable |
| Specimen | Not tracked |
| Tribal Affiliation | Not applicable |

### Recommendations

1. **Implement Vital Signs tracking** — Add vital signs to L1 schema and FHIR Observation export
   - Effort: **M**

2. **Structure Assessment & Plan** — Extract from consultation conclusions
   - Effort: **M**

3. **Add AllergyIntolerance data** — Schema exists, needs population + FHIR serializer
   - Effort: **S**

---

## 9. W3C PROV — Provenance Model

### Current State

**Schema is comprehensive; operational implementation is incomplete.**

| Component | Schema | Code | Data | Overall |
|-----------|:------:|:----:|:----:|:-------:|
| Entity types (16) | Complete | Complete | L0 only (360) | Partial |
| Activity types (12) | Complete | Complete | Import only (186) | Partial |
| Agent types (4) | Complete | Complete | Pipeline only (4) | Partial |
| Relation types (7) | Complete | Complete | 3 of 7 used | Partial |
| Change signals | Complete | Complete | 22,640 pending, 0 processed | **Broken** |
| Cascade orchestrator | — | Complete | Never executed | **Broken** |

### Gaps

| Gap | Severity | Details |
|-----|:--------:|---------|
| **Change signals never processed** | Critical | 22,640 signals accumulated, all pending. Cascade orchestrator exists but was never run. |
| **Only L0 entities tracked** | High | No L1, L2, L3, or L4 entities in provenance. Cannot trace from report → hypothesis → finding → lab result → source doc. |
| **No `wasDerivedFrom` relations** | High | The most important provenance relation has 0 entries. L1 records should be `wasDerivedFrom` L0 source documents. |
| **No AI agent provenance** | Medium | Only pipeline agents registered. No records of asklepios, research-agent, hypothesis-agent actions. |
| **No content hash chain** | Medium | Source documents have `contentHash` but no hash chain linking derived artifacts for integrity verification. |

### SOTA Recommendations

1. **Register all layer entities in provenance** — When creating L1/L2/L3/L4 records, also create prov_entities entries
   - Location: `src/storage/clinical-store.ts` (in add* methods) or `src/importers/ingest-pipeline.ts`
   - Effort: **L**

2. **Create wasDerivedFrom chains** — L1 → L0, L2 → L1, L3 → L2, L4 → L3
   - Location: Same as above
   - Effort: **M**

3. **Process pending change signals** — Run cascade orchestrator to clear backlog
   - Location: MCP tool `process_cascade` or new maintenance script
   - Effort: **S**

4. **Register AI agents** — Record agent provenance when tools are called
   - Location: Agent tool wrappers
   - Effort: **M**

---

## 10. GA4GH VRS & HL7 Genomics Reporting IG

### Current State

| Component | Status |
|-----------|--------|
| Variant schema with VRS fields (allele IDs, digests) | Implemented |
| FHIR Observation serializer (Genomics IG STU3) | Implemented |
| ClinVar annotation pipeline | Exists (script) |
| Pharmacogenomics screen tool | Implemented |

### Gaps

| Gap | Severity | Details |
|-----|:--------:|---------|
| **No VRS digest computation** | Medium | Schema has fields but digests not computed. GA4GH VRS 2.0 specifies SHA-512t24u digest algorithm. |
| **No star allele translation** | Medium | Raw SNP calls not translated to diplotype star alleles (e.g., CYP2D6 *1/*4). Needed for pharmacogenomics. |
| **No ClinGen/ClinVar integration** | Medium | Static annotation script exists but no real-time ClinVar API integration. |
| **Genomics IG STU3 vs STU4** | Low | STU4 published; changes to variant representation profiles. |

### Recommendations

1. **Implement VRS digest computation** — For variant deduplication and cross-system matching
   - Effort: **M**

2. **Add star allele translation** — Using PharmVar/PharmGKB diplotype tables
   - Effort: **L**

---

## 11. Terminology Service Architecture — THE MISSING LAYER

### Current Architecture (Anti-Pattern)

```
src/importers/
├── normalizer.ts               # 300+ LOINC codes as Record<string, string>
├── loinc-lookup.ts             # 3-tier CSV lookup (2K/20K/100K)
├── snomed-findings-normalizer.ts  # 400+ SNOMED codes as Record<string, string>
├── rxnorm-normalizer.ts        # 160+ RxNorm CUIs as Record<string, string>
├── imaging-loinc-normalizer.ts # 30 imaging LOINC + 8 body site SNOMED
├── procedure-loinc-normalizer.ts  # 14 procedure LOINC codes
└── specialty-normalizer.ts     # 23 SNOMED specialty codes
```

**Problems:**
1. **No single source of truth** — Each file has its own map format (flat Record, nested Record, CSV)
2. **No validation** — Codes are never checked against authoritative sources
3. **No versioning** — No way to know which SNOMED/LOINC/RxNorm version the codes came from
4. **No crosswalks** — No infrastructure for code-to-code mapping across systems
5. **No update mechanism** — Adding a code requires editing TypeScript source files
6. **No audit trail** — No record of when codes were added, by whom, or why

### SOTA Target Architecture

```
src/terminology/
├── terminology-service.ts       # Unified facade (lookup, validate, translate)
├── code-system-registry.ts      # Registered code systems with versions
├── loinc-service.ts             # LOINC: lookup, validate, Part hierarchy
├── snomed-service.ts            # SNOMED CT: lookup, validate, subsumption
├── icd10-service.ts             # ICD-10: lookup, validate, hierarchy
├── rxnorm-service.ts            # RxNorm: lookup, validate, API client
├── crosswalk-service.ts         # ConceptMap-based $translate
├── ucum-service.ts              # UCUM unit validation
└── data/
    ├── loinc/                   # (existing CSV files)
    ├── snomed/                  # SNOMED CT subset (400+ mapped concepts + hierarchy)
    ├── icd10/                   # ICD-10-CM tabular data
    ├── crosswalks/              # ConceptMap JSON files
    └── versions.json            # Pinned terminology versions
```

**Key design principles:**
1. **Unified interface** — `terminologyService.lookup(system, code)`, `terminologyService.validate(system, code)`, `terminologyService.translate(sourceSystem, sourceCode, targetSystem)`
2. **Version-pinned** — All code systems have explicit version identifiers
3. **Validatable** — Every code can be checked against authoritative sources
4. **Auditable** — Code additions/changes tracked with provenance
5. **Extensible** — New code systems and crosswalks can be added without modifying existing code
6. **Hybrid local/API** — Local data for fast lookup, API fallback for validation and updates

### Migration Path

The existing hardcoded maps would become **data files** loaded by the terminology service:

| Current File | Becomes | Format |
|-------------|---------|--------|
| `normalizer.ts` LOINC_CODE_MAP | `data/loinc/curated-lab-map.json` | JSON |
| `normalizer.ts` SNOMED_QUALITATIVE_MAP | `data/snomed/qualitative-values.json` | JSON |
| `snomed-findings-normalizer.ts` | `data/snomed/clinical-findings.json` | JSON |
| `rxnorm-normalizer.ts` | `data/rxnorm/curated-medications.json` | JSON |
| `imaging-loinc-normalizer.ts` | `data/loinc/imaging-studies.json` + `data/snomed/body-sites.json` | JSON |
| `procedure-loinc-normalizer.ts` | `data/loinc/procedures.json` | JSON |
| `specialty-normalizer.ts` | `data/snomed/specialties.json` | JSON |

**Effort: XL** (but can be done incrementally, starting with the facade + one code system at a time)

### Phased Terminology Server Strategy

| Phase | Architecture | Effort | Capability |
|-------|-------------|--------|------------|
| **Phase 1 (now)** | Keep local CSV/maps + validate against LOINC FHIR API (`fhir.loinc.org`) + RxNav API (`rxnav.nlm.nih.gov`) | Low | Code lookup, validation, ATC crosswalk |
| **Phase 2 (6 mo)** | Add Snowstorm Lite (Docker) for SNOMED ECL + ICD-10 maps | Medium | Subsumption, `$validate-code`, crosswalks |
| **Phase 3 (12+ mo)** | Full Ontoserver/Snowstorm for multi-terminology | High | Full terminology services (`$expand`, `$translate`, ECL) |

**Terminology server comparison (2025 research):**

| Feature | HAPI FHIR | Snowstorm | Ontoserver |
|---------|-----------|-----------|------------|
| License | Apache 2.0 | Apache 2.0 | Commercial |
| SNOMED ECL | No | **Full** | **Full** |
| `$subsumes` | No | Full | Full |
| `$translate` | Custom maps | **SNOMED implicit maps** | Simple + association |
| Lightweight? | No (~1GB+) | **Snowstorm Lite** (~5 min import) | No |

**Recommendation:** Phase 1 is pragmatic — use hosted APIs for validation without running your own server. Phase 2 adds SNOMED-specific capability that external APIs cannot provide efficiently.

---

## 12. Ingestion Pipeline Standards Integration

### Current Pipeline (`src/importers/ingest-pipeline.ts`)

```
Raw File → LLM Triage → Vision Extraction → L0 Source Document → L1 Structured Records
```

### Where Standards Codes Are Assigned

| Code | Assigned During | Mechanism | Location |
|------|---------------|-----------|----------|
| LOINC lab codes | L1 import (mapLabValue) | `getLoincCode()` → Tier 1 curated map, then `searchLoincSync()` → Tier 2/3 | `ingest-pipeline.ts:641`, `normalizer.ts`, `loinc-lookup.ts` |
| SNOMED qualitative values | L1 import (mapLabValue) | `getValueSnomedCode()` → flat map | `ingest-pipeline.ts:644`, `normalizer.ts` |
| SNOMED specialty codes | L1 import (consultation) | `getSnomedSpecialtyCode()` → flat map | `ingest-pipeline.ts:815`, `specialty-normalizer.ts` |
| SNOMED finding codes | L1 import (consultation) | LLM fallback extraction | `ingest-pipeline.ts:663-679` |
| LOINC imaging study codes | L1 import (imaging) | `mapImagingReport()` → flat map | `imaging-parser.ts` → `imaging-loinc-normalizer.ts` |
| SNOMED body site codes | L1 import (imaging) | `mapImagingReport()` → flat map | `imaging-loinc-normalizer.ts` (BUT NOT STORED IN DB) |
| LOINC procedure codes | L1 import (procedure) | `mapProcedureReport()` → flat map | `procedure-parser.ts` → `procedure-loinc-normalizer.ts` |
| RxNorm medication codes | L1 import (medications) | `getRxnormCode()` → flat map | `ingest-pipeline.ts:908`, `rxnorm-normalizer.ts` |
| LOINC document codes | L0 frontmatter building | `buildSourceDocument()` → category mapping | `frontmatter-builder.ts` |
| HL7 v2-0074 codes | L0 frontmatter building | `buildSourceDocument()` → category mapping | `frontmatter-builder.ts` |
| ICD-10 codes | **NOT ASSIGNED** | Only present if in YAML frontmatter | — |

### Pipeline Gaps

| Gap | Severity | Details |
|-----|:--------:|---------|
| **No ICD-10 assignment** | Critical | Only standard without automatic assignment during import |
| **Body site SNOMED not persisted** | High | Code is generated but lost because DB column doesn't exist |
| **No code validation** | High | Assigned codes are never validated (could be deprecated, wrong hierarchy, etc.) |
| **No retroactive enrichment** | Medium | When maps are updated (new codes added), existing records aren't re-coded |
| **LLM finding extraction unreliable** | Medium | Only reaches 66.7% of consultations. Failures are silent (caught + ignored). |
| **No provenance for code assignment** | Medium | No record of which pipeline version or map version assigned which code |
| **Sequential processing** | Low | `ingestBatch()` processes files sequentially, not in parallel |

### SOTA Recommendations for Pipeline

1. **Add ICD-10 assignment** — After SNOMED finding extraction, look up ICD-10 code via crosswalk
   - Location: `src/importers/ingest-pipeline.ts` L1 handlers
   - Effort: **M** (depends on ICD-10 map being built first)

2. **Fix body site SNOMED persistence** — Add column to migration, store in pipeline
   - Location: `src/storage/clinical-store.ts`, `src/importers/ingest-pipeline.ts`
   - Effort: **S**

3. **Add code validation step** — After assignment, validate all codes
   - Location: New validation step in pipeline
   - Effort: **M**

4. **Build retroactive re-coding script** — When maps are updated, re-process existing records
   - Location: New `scripts/recode-records.ts`
   - Effort: **M**

5. **Record code assignment provenance** — Log which map version assigned which code
   - Location: `src/importers/ingest-pipeline.ts` (enhance provenance recording)
   - Effort: **S**

---

## 13. Prioritized Action Plan

### Phase 1 — Foundation Fixes (Effort: ~2 weeks)

| # | Action | Standard | Gap Type | Effort |
|---|--------|----------|----------|:------:|
| 1 | Fix `body_site_snomed_code` DB column + backfill | SNOMED | Schema-DB drift | **S** |
| 2 | Backfill 24 missing LOINC doc codes on L0 | LOINC | Coverage | **S** |
| 3 | Expand imaging LOINC map (+20 combos) | LOINC | Coverage | **S** |
| 4 | Expand procedure LOINC map (+30 codes) | LOINC | Coverage | **S** |
| 5 | Expand body region SNOMED map (+12 regions) | SNOMED | Coverage | **S** |
| 6 | Add severity/grade SNOMED codes | SNOMED | Coverage | **S** |
| 7 | Read fhirStatus from records instead of hardcoding | FHIR | Correctness | **S** |
| 8 | Process 22,640 pending change signals | W3C PROV | Operational | **S** |

### Phase 2 — Critical Standards Gaps (Effort: ~4 weeks)

| # | Action | Standard | Gap Type | Effort |
|---|--------|----------|----------|:------:|
| 9 | Build ICD-10 code map (400+ conditions) | ICD-10 | **Critical gap** | **L** |
| 10 | Build SNOMED ↔ ICD-10 crosswalk table | Crosswalk | **Critical gap** | **L** |
| 11 | Implement missing FHIR serializers (4 resources) | FHIR | Completeness | **M** |
| 12 | Add FHIR resource validation | FHIR | Quality | **M** |
| 13 | Register L1/L2/L3/L4 entities in provenance | W3C PROV | Completeness | **M** |
| 14 | Create wasDerivedFrom chains | W3C PROV | Traceability | **M** |
| 15 | Re-run SNOMED finding extraction for 30 consultations | SNOMED | Coverage | **M** |
| 16 | Add ICD-10 assignment to ingestion pipeline | ICD-10 + Pipeline | Automation | **M** |

### Phase 3 — Terminology Service (Effort: ~6 weeks)

| # | Action | Standard | Gap Type | Effort |
|---|--------|----------|----------|:------:|
| 17 | Design terminology service facade | Architecture | **Structural** | **M** |
| 18 | Migrate LOINC maps to data files + service | LOINC | Architecture | **L** |
| 19 | Migrate SNOMED maps to data files + service | SNOMED | Architecture | **L** |
| 20 | Migrate RxNorm maps to data files + service | RxNorm | Architecture | **M** |
| 21 | Implement crosswalk service (ConceptMap-based) | Crosswalk | Architecture | **L** |
| 22 | Add code validation to terminology service | All | Quality | **M** |
| 23 | Add version pinning for all code systems | All | Governance | **M** |

### Phase 4 — SOTA Enhancements (Effort: ~8 weeks)

| # | Action | Standard | Gap Type | Effort |
|---|--------|----------|----------|:------:|
| 24 | NLM RxNorm API integration | RxNorm | Maintenance | **M** |
| 25 | ATC coding for medications | RxNorm/ATC | International | **M** |
| 26 | LOINC Part-based matching | LOINC | Intelligence | **L** |
| 27 | SNOMED subsumption queries | SNOMED | Intelligence | **L** |
| 28 | IPS (International Patient Summary) compliance | FHIR | Exchange | **L** |
| 29 | VRS digest computation | GA4GH | Compliance | **M** |
| 30 | Star allele translation | Genomics | Clinical | **L** |
| 31 | USCDI v4/v5 new data classes | USCDI | Compliance | **L** |
| 32 | Retroactive re-coding infrastructure | Pipeline | Maintenance | **M** |

---

## Appendix A: File Reference Index

| File | Standards Covered | Line Count |
|------|-------------------|:----------:|
| `src/importers/normalizer.ts` | LOINC (300+ codes), SNOMED (qualitative values) | ~900 |
| `src/importers/loinc-lookup.ts` | LOINC (3-tier: 2K/20K/100K) | ~300 |
| `src/importers/snomed-findings-normalizer.ts` | SNOMED CT (400+ findings, EN/PL/DE) | ~520 |
| `src/importers/rxnorm-normalizer.ts` | RxNorm (160+ CUIs, 260+ brands) | ~310 |
| `src/importers/imaging-loinc-normalizer.ts` | LOINC (imaging studies), SNOMED (body sites) | ~70 |
| `src/importers/procedure-loinc-normalizer.ts` | LOINC (14 procedure codes) | ~30 |
| `src/importers/specialty-normalizer.ts` | SNOMED CT (23 specialties) | ~200 |
| `src/importers/ingest-pipeline.ts` | All (pipeline orchestration) | ~937 |
| `src/fhir/*.ts` | FHIR R4 (9 serializers + types + bundle) | ~500 |
| `src/schemas/provenance.ts` | W3C PROV-DM | ~194 |
| `src/schemas/clinical-record.ts` | FHIR metadata, evidence tiers | ~356 |
| `src/schemas/diagnosis.ts` | ICD-10, SNOMED CT | ~99 |
| `src/schemas/source-document.ts` | LOINC doc codes, HL7 v2-0074 | ~100 |
| `src/storage/cascade.ts` | W3C PROV (change signals) | ~254 |

## Appendix B: Standards Version Matrix

| Standard | Current Version Used | Latest Available | Update Needed? |
|----------|---------------------|-----------------|:--------------:|
| HL7 FHIR | R4 (4.0.1) | R5 (5.0.0), R6 ballot | No (R4 dominant) |
| LOINC | v2.82 (local) | v2.82 (current as of 2026) | Check |
| SNOMED CT | International 2025-01 | 2026-01 (if available) | Check |
| ICD-10-CM | Not versioned | 2026 release | Need to implement |
| RxNorm | Not versioned | Monthly NLM releases | Need to implement |
| HL7 v2-0074 | 2.9 | Current | No |
| USCDI | v3 (Jan 2026) | v4, v5 planned | Monitor |
| W3C PROV | PROV-DM 1.0 | Current | No |
| GA4GH VRS | 2.0 | Current | No |
| Genomics IG | STU3 | STU4 | Monitor |

---

**Effort key:** S = hours, M = 1-2 days, L = 3-5 days, XL = 1-2 weeks
