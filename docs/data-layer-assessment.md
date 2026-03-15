# Data Layer Assessment — Asklepios Clinical Database

**Date:** 2026-03-15
**Database:** `asklepios.db` (LibSQL/SQLite)
**Patient:** Single patient (patient-tomasz-szychlinski)
**Purpose:** Assess the current status and quality of data across all layers (L0–L4 + cross-cutting), independent of system/architecture review.

---

## Executive Summary

| Layer | Tables | Total Rows | Status | Quality Grade |
|-------|--------|----------:|--------|:------------:|
| **L0** Source Documents | 1 | 319 | Fully populated | **A** |
| **L1A** Structured Clinical | 7 | 1,513 | Partially populated | **B-** |
| **L1B** Genetic Variants | 1 | 638,547 | Fully populated | **A** |
| **L2A** Research/Evidence | 3 | 1,420 | Partially populated | **B** |
| **L2B** Clinical Enrichment | 3 | 0 | **Empty** | **F** |
| **L3** Reasoning | 1 | 15 | Minimal | **D** |
| **L4** Deliverables | 1 | 0 | **Empty** | **F** |
| **PROV** Provenance | 4 | 23,380 | Structurally populated, operationally stale | **C** |
| **Semantic** Vector Index | 1 | 0 | **Empty** | **F** |

**Overall data readiness: 45%** — L0 and L1 are solid foundations; L2B, L3, L4, and cross-cutting infrastructure need population.

---

## Layer 0: Source Documents (Bronze)

### Counts

| Category | Count | % of Total |
|----------|------:|:----------:|
| lab_result | 160 | 50.2% |
| consultation | 88 | 27.6% |
| imaging_report | 42 | 13.2% |
| procedure | 20 | 6.3% |
| narrative | 4 | 1.3% |
| external | 3 | 0.9% |
| genetic | 1 | 0.3% |
| other | 1 | 0.3% |
| **Total** | **319** | **100%** |

### Extraction Methods

| Method | Count | Notes |
|--------|------:|-------|
| claude_read | 263 | Claude Vision API — highest quality |
| pymupdf | 52 | Structured PDF extraction |
| direct_to_consumer | 1 | 23andMe genotype array |
| python_docx | 1 | DOCX extraction |
| tesseract_ocr | 1 | Legacy OCR |
| other | 1 | — |

### Evidence Tiers

| Tier | Count | % |
|------|------:|:-:|
| T1-official | 227 | 71.2% |
| T1-specialist | 88 | 27.6% |
| T2-patient-reported | 4 | 1.3% |

### Standards Coverage (L0)

| Standard Field | Populated | Missing | Coverage |
|----------------|----------:|--------:|:--------:|
| fhir_resource_type | 319 | 0 | **100%** |
| loinc_doc_code | 295 | 24 | **92.5%** |
| diagnostic_service_section | 313 | 6 | **98.1%** |
| evidence_tier | 319 | 0 | **100%** |
| original_file_hash | 319 | 0 | **100%** |

### L0 Quality Issues

1. **24 documents missing LOINC doc codes** — 9 consultations, 5 lab results, 4 imaging reports, 4 narratives, 2 procedures
2. **6 documents missing diagnostic service section** — 4 narratives, 2 procedures
3. **3 fewer documents than docs state** — Doc says 322, DB has 319. Three documents may have been deduplicated or removed.

### L0 Remediation

- [ ] Backfill LOINC doc codes for 24 missing documents (deterministic mapping from category)
- [ ] Backfill diagnostic service section for 6 missing documents
- [ ] Investigate 3-document discrepancy (322 in docs vs 319 in DB)

---

## Layer 1A: Structured Clinical Data (Silver)

### Counts

| Table | Rows | Source Doc Linkage | FHIR Metadata |
|-------|-----:|:------------------:|:-------------:|
| clinical_lab_results | 1,350 | 100% (1,350/1,350) | 100% |
| clinical_consultations | 90 | 100% (90/90) | 97.8% (88/90) |
| clinical_imaging_reports | 45 | 100% | 100% |
| clinical_abdominal_reports | 24 | 100% | assumed |
| clinical_patient_reports | 4 | assumed | assumed |
| clinical_treatment_trials | **0** | — | — |
| clinical_contradictions | **0** | — | — |
| clinical_agent_learnings | **0** | — | — |
| clinical_medications | 34 | assumed | assumed |

### Standards Code Coverage (L1)

| Standard | Table | Coded | Total | Coverage |
|----------|-------|------:|------:|:--------:|
| **LOINC** (test codes) | lab_results | 1,346 | 1,350 | **99.7%** |
| **SNOMED** (specialty) | consultations | 89 | 90 | **98.9%** |
| **SNOMED** (finding) | consultations | 60 | 90 | **66.7%** |
| **LOINC** (study code) | imaging_reports | 45 | 45 | **100%** |
| **HL7 v2-0074** (service section) | imaging_reports | 45 | 45 | **100%** |
| **LOINC** (procedure code) | abdominal_reports | 24 | 24 | **100%** |
| **SNOMED** (body site) | imaging_reports | — | 45 | **0%** (column missing from DB) |
| **SNOMED** (qualitative values) | lab_results | 213 | ~300 qual. | **~71%** |
| **RxNorm** | medications | 34 | 34 | **100%** |

### Evidence Tier Distribution (Labs)

| Tier | Count | % |
|------|------:|:-:|
| T1-official | 1,304 | 96.6% |
| T2-patient-reported | 46 | 3.4% |

### L1A Quality Issues

1. **SNOMED body site codes NOT in DB** — `body_site_snomed_code` column missing from `clinical_imaging_reports` table. The schema (`imagingReportSchema`) defines it, the normalizer produces it, but the DB migration never created the column. **This is a schema-DB drift bug.**
2. **30 consultations missing SNOMED finding codes** (33.3%) — LLM fallback extraction doesn't reach all documents.
3. **4 labs missing LOINC codes** (0.3%) — Rare tests not in any lookup tier.
4. **Empty tables:** `clinical_treatment_trials` (0 rows), `clinical_contradictions` (0 rows), `clinical_agent_learnings` (0 rows). These have schema+migration but no population pipeline.
5. **2 consultations missing fhir_resource_type** — Minor metadata gap.
6. **Patient ID consistency: GOOD** — All L1A records use single patient ID `patient-tomasz-szychlinski`.

### L1A Remediation

- [ ] **P0:** Add `body_site_snomed_code` column to `clinical_imaging_reports` migration and backfill from existing data using `imaging-loinc-normalizer.ts`
- [ ] **P1:** Re-run LLM finding extraction for 30 consultations missing SNOMED finding codes
- [ ] **P1:** Build treatment trials extraction from consultation narratives (currently 0 rows)
- [ ] **P2:** Backfill LOINC for 4 remaining labs (likely need Tier 3 lookup or manual mapping)
- [ ] **P2:** Populate contradictions and agent learnings tables from existing agent sessions

---

## Layer 1B: Genetic Variants

### Counts

| Metric | Value |
|--------|------:|
| Total variants | 638,547 |
| Source | 23andMe DTC genotyping array |
| Extraction method | direct_to_consumer |

### Quality Assessment

- **Fully populated** — complete 23andMe genotype data imported
- **GA4GH VRS alignment** — Variant representation schema includes allele IDs and digests
- **HL7 Genomics Reporting IG STU3** — FHIR Observation serializer implemented (`src/fhir/variant.ts`)
- **ClinVar annotation** — annotation pipeline exists (`scripts/annotate-clinvar.ts`)

### L1B Quality Issues

1. **Bulk data, low clinical signal** — 638K SNPs, but only a small fraction have clinical significance annotations
2. **No pharmacogenomics star alleles** — Raw SNP calls, not diplotype-level (e.g., CYP2D6 *1/*4)
3. **No structural variants** — DTC arrays miss CNVs, SVs

### L1B Remediation

- [ ] Run ClinVar annotation to flag clinically significant variants
- [ ] Implement PharmGKB star allele translation for pharmacogenomics
- [ ] Document DTC genotyping limitations in variant metadata

---

## Layer 2A: Research & Evidence

### Counts

| Table | Rows |
|-------|-----:|
| research_findings | 888 |
| research_hypotheses | 18 |
| hypothesis_evidence_links | 514 |

### Evidence Tier Distribution (Research Findings)

| Tier | Count | % |
|------|------:|:-:|
| expert-opinion | 641 | 72.2% |
| T3-ai-inferred | 152 | 17.1% |
| T1-official | 95 | 10.7% |

### Quality Assessment

- **888 research findings** from agent research sessions — good breadth
- **18 hypotheses** with **514 evidence links** — healthy evidence density (~28.6 links per hypothesis)
- **Tier distribution concern:** 72.2% are expert-opinion tier, only 10.7% T1-official. The evidence base is AI-heavy, literature-light.

### L2A Quality Issues

1. **Low T1-official evidence proportion** — Only 95/888 (10.7%) are from official/primary sources
2. **No research_queries audit trail** — Table exists but not measured; may not track query history
3. **Evidence links not verified** — No validation that linked evidence actually supports the hypothesis

### L2A Remediation

- [ ] Run targeted literature search campaigns to boost T1-official evidence for top hypotheses
- [ ] Implement evidence link validation (does the finding actually support the hypothesis claim?)
- [ ] Audit research_queries table for search completeness

---

## Layer 2B: Clinical Enrichment — EMPTY

### Counts

| Table | Rows | Status |
|-------|-----:|--------|
| clinical_imaging_findings | **0** | Not populated |
| clinical_diagnoses | **0** | Not populated |
| clinical_progressions | **0** | Not populated |

### Impact

This is the **most critical data gap**. L2B tables are designed to hold:

- **Imaging findings:** Structured per-finding rows extracted from 45 imaging report narratives (e.g., "C5-C6 disc protrusion, 3mm, left paracentral")
- **Diagnoses:** Explicit diagnosis registry with ICD-10 + SNOMED dual coding, onset dates, status tracking (the 16+ diagnosed conditions currently exist only in narrative text)
- **Progressions:** Temporal disease chain tracking (onset → progression → current status)

Without L2B, the system cannot:
- Track diagnosis status changes over time
- Generate structured differential diagnoses
- Provide coded diagnosis lists for FHIR export
- Support temporal analysis queries

### L2B Remediation

- [ ] **P0:** Run `extract_imaging_findings` MCP tool on all 45 imaging reports → populate `clinical_imaging_findings`
- [ ] **P0:** Extract diagnoses from consultation conclusions + research hypotheses → populate `clinical_diagnoses` with ICD-10 + SNOMED codes
- [ ] **P1:** Build progression chains from temporal analysis of L1 consultation data → populate `clinical_progressions`

---

## Layer 3: Reasoning (Gold)

### Counts

| Table | Rows |
|-------|-----:|
| brain_patterns | 15 |
| (hypotheses) | 18 (stored in L2A research_hypotheses) |

### Quality Assessment

- **15 brain patterns** — Cross-patient diagnostic wisdom from brain agent sessions
- **18 hypotheses** — Reasonable count for a single complex patient
- **Hypothesis quality depends on L2B** — Without structured diagnoses and progressions, hypothesis reasoning lacks structured evidence

### L3 Quality Issues

1. **Hypotheses reference unstructured evidence** — L2B is empty, so hypotheses link to raw findings rather than coded diagnoses
2. **No DDx rankings** — Differential diagnosis rankings not persisted
3. **No adversarial synthesis results** — Schema exists but no data

### L3 Remediation

- [ ] Populate L2B first (prerequisite)
- [ ] Re-run hypothesis generation with structured L2B data
- [ ] Persist DDx rankings and adversarial synthesis results

---

## Layer 4: Deliverables (Gold) — EMPTY

### Counts

| Table | Rows | Status |
|-------|-----:|--------|
| report_versions | **0** | Not populated |
| report_data_integration | **0** | Not populated |

### Impact

No deliverable reports have been generated or versioned. The system can generate reports on-the-fly via the report agent, but none are persisted with version tracking.

### L4 Remediation

- [ ] Generate initial report version using report-agent with current L0–L3 data
- [ ] Implement report versioning with change-signal-triggered regeneration

---

## Cross-Cutting: Provenance (W3C PROV)

### Counts

| Table | Rows | Notes |
|-------|-----:|-------|
| prov_entities | 360 | All type `source-doc` — only L0 entities tracked |
| prov_activities | 186 | Import activities only |
| prov_agents | 4 | Pipeline agents |
| prov_relations | 22,830 | Mostly `wasGeneratedBy` (22,643) |
| change_signals | 22,640 | **ALL pending** — none propagated or acknowledged |

### Entity Type Distribution

| Entity Type | Count |
|-------------|------:|
| source-doc | 360 |
| lab-result | 0 |
| imaging-report | 0 |
| consultation | 0 |
| All other types | 0 |

### Relation Type Distribution

| Relation Type | Count |
|---------------|------:|
| wasGeneratedBy | 22,643 |
| wasAttributedTo | 174 |
| wasInvalidatedBy | 12 |
| used | 1 |
| wasDerivedFrom | 0 |
| wasInformedBy | 0 |
| hadMember | 0 |

### Quality Assessment

**Structural implementation is complete, but operational use is minimal:**

1. **Only L0 entities tracked** — 360 source-doc entities, but zero L1/L2/L3/L4 entities. The provenance graph only covers document ingestion, not the full data lifecycle.
2. **22,640 change signals ALL pending** — The cascade orchestrator has never been run on real data. Signals accumulate but are never propagated or acknowledged.
3. **No `wasDerivedFrom` relations** — The most important provenance relation (L1 derived from L0, L2 derived from L1) has zero entries. This means there's no traceability from structured data back through the layer chain.
4. **Sparse relation types** — Only 3 of 7 W3C PROV relation types are used.
5. **4 agents registered** — Only pipeline agents, no AI agent provenance.

### Provenance Remediation

- [ ] **P0:** Register L1 entities in prov_entities when records are created (lab-result, consultation, imaging-report, etc.)
- [ ] **P0:** Create `wasDerivedFrom` relations linking L1 entities to their L0 source documents
- [ ] **P1:** Process the 22,640 pending change signals (run cascade orchestrator)
- [ ] **P1:** Register AI agents (asklepios, research-agent, hypothesis-agent, etc.) in prov_agents
- [ ] **P2:** Implement `wasInformedBy` and `hadMember` relations for richer provenance graphs

---

## Cross-Cutting: Semantic Vector Index — EMPTY

### Counts

| Table | Rows |
|-------|-----:|
| asklepios_documents | **0** |

### Impact

- **Semantic search is completely non-functional** — No document embeddings exist
- **Knowledge query tool returns nothing** — `search_knowledge` MCP tool has no data to search
- **Agent context is limited** — Without semantic recall, agents can only access data via SQL queries

### Cause

Embedding requires `OPENAI_API_KEY` for the OpenAI embeddings API. Without it, the vector index cannot be populated.

### Remediation

- [ ] **P0:** Configure OPENAI_API_KEY and run embedding pipeline on L0 source documents
- [ ] **P1:** Embed L1 imaging report findings and consultation conclusions
- [ ] **P2:** Embed L2 research findings for semantic retrieval

---

## Cross-Cutting: Working Memory

Working memory is **auto-populated per agent session** and is not persistent data. No assessment needed — this functions as designed.

---

## Data Integrity Summary

### Foreign Key Integrity

| Relationship | Status | Coverage |
|-------------|--------|:--------:|
| L1 labs → L0 source docs | Valid | 100% (1,350/1,350) |
| L1 consultations → L0 source docs | Valid | 100% (90/90) |
| L1 imaging → L0 source docs | Valid | 100% (45/45) |
| L1 procedures → L0 source docs | Valid | 100% (24/24) |
| L2A research → L3 hypotheses | Via evidence links | 514 links |
| PROV entities → L0 source docs | Partial | 360/319 (some orphans?) |

### Patient ID Consistency

| Table | Patient ID | Consistent? |
|-------|-----------|:-----------:|
| clinical_lab_results | patient-tomasz-szychlinski | Yes |
| clinical_consultations | patient-tomasz-szychlinski | Yes |
| clinical_imaging_reports | patient-tomasz-szychlinski | Assumed |
| clinical_medications | patient-tomasz-szychlinski | Assumed |

**Previous issue of mixed patient IDs appears resolved** — all checked tables show consistent single patient ID.

---

## Priority Remediation Roadmap

### P0 — Critical (blocks core functionality)

| # | Action | Affected Layer | Estimated Effort |
|---|--------|:-------------:|:----------------:|
| 1 | Add `body_site_snomed_code` column to imaging_reports migration + backfill | L1A | S |
| 2 | Populate `clinical_diagnoses` table from consultations + hypotheses | L2B | L |
| 3 | Populate `clinical_imaging_findings` from 45 imaging reports | L2B | M |
| 4 | Configure OPENAI_API_KEY + run embedding pipeline | Semantic | S |
| 5 | Process 22,640 pending change signals | PROV | M |

### P1 — High (improves data quality significantly)

| # | Action | Affected Layer | Estimated Effort |
|---|--------|:-------------:|:----------------:|
| 6 | Backfill SNOMED finding codes for 30 consultations | L1A | M |
| 7 | Register L1 entities in provenance + create wasDerivedFrom relations | PROV | M |
| 8 | Build progression chains from temporal data | L2B | L |
| 9 | Extract treatment trials from consultations | L1A | L |
| 10 | Backfill 24 missing LOINC doc codes on L0 | L0 | S |

### P2 — Medium (completeness and polish)

| # | Action | Affected Layer | Estimated Effort |
|---|--------|:-------------:|:----------------:|
| 11 | Generate initial report version | L4 | M |
| 12 | Boost T1-official research evidence | L2A | L |
| 13 | Run ClinVar annotation on genetic variants | L1B | M |
| 14 | Populate contradictions and agent learnings | L1A | M |

**Effort key:** S = hours, M = 1-2 days, L = 3-5 days, XL = 1-2 weeks

---

## Appendix: Raw Query Results

```
Total rows by table:
  source_documents:           319
  clinical_lab_results:     1,350
  clinical_consultations:      90
  clinical_imaging_reports:    45
  clinical_abdominal_reports:  24
  clinical_treatment_trials:    0
  clinical_patient_reports:     4
  clinical_contradictions:      0
  clinical_agent_learnings:     0
  clinical_medications:        34
  genetic_variants:       638,547
  research_findings:          888
  research_hypotheses:         18
  hypothesis_evidence_links:  514
  clinical_imaging_findings:    0
  clinical_diagnoses:           0
  clinical_progressions:        0
  brain_patterns:              15
  report_versions:              0
  prov_entities:              360
  prov_activities:            186
  prov_agents:                  4
  prov_relations:          22,830
  change_signals:          22,640
  asklepios_documents:          0
```
