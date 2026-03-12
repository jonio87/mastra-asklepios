# Asklepios Data Layer Architecture

## The Inverted Pyramid

```
                    ╔═══════════════════════════════════════════════════════════╗
                    ║                    LAYER 5: DELIVERABLES                 ║
                    ║         Versioned reports, clinical summaries            ║
                    ║    report_versions · report_data_integration             ║
                    ╚═══════════════════════╦═══════════════════════════════════╝
                                            ║ flag-report-regeneration
                    ╔═══════════════════════╩═══════════════════════════════════╗
                    ║                    LAYER 4: HYPOTHESES                    ║
                    ║      Research hypotheses, evidence links, DDx             ║
                    ║  research_hypotheses · hypothesis_evidence_links          ║
                    ╚═══════════════════════╦═══════════════════════════════════╝
                                            ║ update-research-findings
                    ╔═══════════════════════╩═══════════════════════════════════╗
                    ║                    LAYER 3: RESEARCH + BRAIN              ║
                    ║     Literature findings, brain patterns, embeddings       ║
                    ║  research_findings · brain_patterns · asklepios_documents ║
                    ╚═══════════════════════╦═══════════════════════════════════╝
                                            ║ re-embed-documents
        ╔═══════════════════════════════════╩═══════════════════════════════════════════╗
        ║                           LAYER 2: STRUCTURED CLINICAL DATA                  ║
        ║                                                                               ║
        ║   2A Core Records          2B Findings & Diagnoses     2C Genetic Data        ║
        ║   ─────────────            ──────────────────────      ─────────────          ║
        ║   clinical_lab_results     clinical_imaging_findings   genetic_variants       ║
        ║   clinical_consultations   clinical_diagnoses          (638K+ SNPs)           ║
        ║   clinical_imaging_reports clinical_progressions                               ║
        ║   clinical_abdominal_rpts                                                     ║
        ║   clinical_treatment_trials                                                   ║
        ║   clinical_patient_reports                                                    ║
        ║   clinical_contradictions                                                     ║
        ║   clinical_agent_learnings                                                    ║
        ╚═══════════════════════════════════╦═══════════════════════════════════════════╝
                                            ║ extract-findings, update-diagnoses
        ╔═══════════════════════════════════╩═══════════════════════════════════════════╗
        ║                          LAYER 1: WORKING MEMORY                              ║
        ║           Compact clinical dashboard (~1500 tokens)                           ║
        ║     SchemaWorkingMemory · ObservationalMemory · SemanticRecall                ║
        ║            (Injected into every agent context window)                         ║
        ╚═══════════════════════════════════╦═══════════════════════════════════════════╝
                                            ║
╔═══════════════════════════════════════════╩═══════════════════════════════════════════════╗
║                              LAYER 0: SOURCE DOCUMENTS                                    ║
║                                                                                           ║
║   source_documents — 322 extracted medical records (PDFs → markdown + YAML frontmatter)   ║
║                                                                                           ║
║   Fields: original_filename, original_file_hash (SHA-256), extraction_method,             ║
║           extraction_confidence, extraction_tool, extraction_wave, category,               ║
║           date, facility, physician, evidence_tier, validation_status                     ║
║                                                                                           ║
║   Lives in: /Users/andrzej/Documents/GitHub/medical-records/records/                      ║
║   322 markdown files with YAML frontmatter → imported into source_documents table         ║
╚═══════════════════════════════════════════════════════════════════════════════════════════╝

                    ╔═══════════════════════════════════════════════╗
                    ║          W3C PROV PROVENANCE (cross-cutting)  ║
                    ║                                               ║
                    ║  prov_entities    — what exists (all layers)  ║
                    ║  prov_activities  — what happened (extract,   ║
                    ║                     import, infer, validate)  ║
                    ║  prov_agents      — who did it (human, AI,   ║
                    ║                     pipeline, system)         ║
                    ║  prov_relations   — how connected             ║
                    ║                     (wasGeneratedBy,          ║
                    ║                      wasDerivedFrom,          ║
                    ║                      wasAttributedTo)         ║
                    ║  change_signals   — reactive propagation      ║
                    ║                     (new/updated/deleted →    ║
                    ║                      affected layers 0-5)     ║
                    ╚═══════════════════════════════════════════════╝
```

## Data Flow: Import Pipeline

```
Source Archive (326 PDFs)                medical-records repo               Asklepios DB
/Desktop/Dokumentacja_medyczna/    →    /GitHub/medical-records/records/  →  asklepios.db
                                                                             │
                                        ┌─── Phase 0: Validate ────────────▶│ (nothing written)
                                        │                                    │
                                        ├─── Phase 0.5: Layer 0 ──────────▶│ source_documents
                                        │                                    │ + prov_entities
                                        │                                    │ + prov_activities
                                        │                                    │ + change_signals
                                        │                                    │
                                        ├─── Phase 1: Layer 3 ─────────────▶│ asklepios_documents
                                        │    (embed via OpenAI)              │ (vector index)
                                        │                                    │
                                        ├─── Phase 2a: Labs ───────────────▶│ clinical_lab_results
                                        ├─── Phase 2b: Consultations ──────▶│ clinical_consultations
                                        ├─── Phase 2c: Imaging ────────────▶│ clinical_imaging_reports
                                        ├─── Phase 2d: Abdominal ──────────▶│ clinical_abdominal_reports
                                        └─── Phase 2e: Narrative/External ─▶│ clinical_patient_reports
                                                                             │ clinical_consultations
```

## Reactive Change Cascade

When lower-layer data changes, change signals propagate upward:

```
L0 change (new source doc)
  ├──▶ L2: extract-findings, update-diagnoses, update-progressions
  ├──▶ L3: re-embed-documents
  └──▶ L5: flag-report-regeneration

L2 change (new lab result)
  ├──▶ L3: re-embed-documents
  ├──▶ L4: update-research-findings
  └──▶ L5: flag-report-regeneration

L3 change (new research finding)
  ├──▶ L4: update-research-findings
  └──▶ L5: flag-report-regeneration
```

Processing: `process_cascade` MCP tool → CascadeOrchestrator → walks dependency graph → marks signals as propagated.

## Where Layer 0 Lives

Layer 0 exists in **two places**:

1. **Filesystem** (source of truth): `/Users/andrzej/Documents/GitHub/medical-records/records/`
   - 322 markdown files with YAML frontmatter
   - Each file = one extracted medical document
   - Frontmatter contains all Layer 0 metadata (source hash, extraction method, confidence, etc.)

2. **Database** (queryable mirror): `asklepios.db` → `source_documents` table
   - Populated by `import-records.ts` Phase 0.5
   - Makes Layer 0 queryable via SQL ("how many imaging reports from 2022?")
   - Linked to W3C PROV via `prov_entities` (type='source-doc', layer=0)

## Current Population Status

| Layer | Table | Rows | Status |
|-------|-------|-----:|--------|
| L0 | source_documents | 0 | **Empty** — never imported with new pipeline |
| L1 | working memory | — | Auto-populated per agent session |
| L2A | clinical_lab_results | 1,144 | Populated (old import, pre-redesign) |
| L2A | clinical_consultations | 96 | Populated (old import) |
| L2A | clinical_imaging_reports | 0 | **Empty** |
| L2A | clinical_imaging_findings | 0 | **Empty** |
| L2A | clinical_abdominal_reports | 0 | **Empty** |
| L2A | clinical_diagnoses | 0 | **Empty** |
| L2A | clinical_progressions | 0 | **Empty** |
| L2A | clinical_treatment_trials | 0 | **Empty** |
| L2A | clinical_patient_reports | 2 | Minimal |
| L2B | research_findings | 888 | Populated (from agent research sessions) |
| L2B | research_hypotheses | 18 | Populated (from synthesis agent) |
| L2C | genetic_variants | 638,547 | **Fully populated** (23andMe import) |
| L3 | brain_patterns | 15 | Populated (from brain agent) |
| L3 | asklepios_documents | 0 | **Empty** — no embeddings |
| L5 | report_versions | 0 | **Empty** |
| PROV | prov_entities | 0* | **Empty** — tables not yet created |
| PROV | change_signals | 0* | **Empty** — tables not yet created |

\* Provenance tables created on first migration, not yet triggered.

### Data Quality Issues in Current DB

- **Mixed patient IDs**: 6 different IDs (`patient-tomasz-szychlinski`, `tomasz-szychliński`, `patient-capture-test`, `test-patient-mcp`, `patient-integration-test`, `patient-test-phase10`)
- **No Layer 0**: source_documents table is empty — no provenance chain to source PDFs
- **No embeddings**: Vector index is empty — semantic search doesn't work
- **Stale L2 data**: Labs/consultations from old import using pre-QA extractions (Tesseract OCR artifacts, wrong dates, missing fields)
- **No imaging/abdominal/treatment data**: Several L2 tables completely empty

## MCP Tools for Layer Population

| Tool | Layer | Purpose |
|------|-------|---------|
| `capture_clinical_data` (type: source-document) | L0 | Add source documents interactively |
| `ingest_document` | L3 | Chunk and embed documents |
| `capture_clinical_data` (type: lab-result) | L2A | Add structured lab results |
| `capture_clinical_data` (type: consultation) | L2A | Add consultations |
| `capture_clinical_data` (type: diagnosis) | L2A | Add diagnoses |
| `capture_clinical_data` (type: progression) | L2A | Track temporal progressions |
| `extract_imaging_findings` | L2A | Decompose imaging reports into findings |
| `capture_clinical_data` (type: report-version) | L5 | Version deliverable reports |
| `check_data_completeness` | audit | Check what's missing across all layers |
| `process_cascade` | all | Propagate change signals through layers |
| `query_provenance` | PROV | Trace lineage and audit trail |
