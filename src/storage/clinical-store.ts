import { createHash } from 'node:crypto';
import type { Client, InValue } from '@libsql/client';
import { createClient } from '@libsql/client';
import type {
  BrainPattern,
  BrainPatternInput,
  BrainPatternQuery,
} from '../schemas/brain-pattern.js';
import type {
  AbdominalReport,
  AgentLearning,
  Consultation,
  Contradiction,
  ImagingReport,
  LabResult,
  LabTrend,
  PatientReport,
  TreatmentTrial,
} from '../schemas/clinical-record.js';
import type { Diagnosis, DiagnosisQuery } from '../schemas/diagnosis.js';
import type { GeneticVariant, GeneticVariantQuery } from '../schemas/genetic-variant.js';
import type { ImagingFinding, ImagingFindingQuery } from '../schemas/imaging-finding.js';
import type { Progression, ProgressionQuery } from '../schemas/progression.js';
import type { ReportDataIntegration, ReportVersion } from '../schemas/report-version.js';
import type {
  HypothesisEvidenceLink,
  ResearchFinding,
  ResearchHypothesis,
  ResearchQuery,
  ResearchSummary,
} from '../schemas/research-record.js';
import type { SourceDocument, SourceDocumentQuery } from '../schemas/source-document.js';
import { logger } from '../utils/logger.js';

/**
 * ClinicalStore — Layer 2 structured clinical data storage.
 *
 * Wraps LibSQL for direct SQL queries on clinical records (labs, meds,
 * consultations, contradictions, PROs, agent learnings). Provides:
 *
 * - CRUD operations per record type
 * - Filtered queries (by patient, date range, category)
 * - Lab trend computation (slope, direction, rate of change)
 *
 * Uses the same SQLite database as Mastra storage (co-located).
 */
export class ClinicalStore {
  private client: Client;
  private initialized = false;

  constructor(dbUrl?: string) {
    this.client = createClient({
      url: dbUrl ?? process.env['ASKLEPIOS_DB_URL'] ?? 'file:asklepios.db',
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    // Enable FK constraints — SQLite disables them by default per-connection.
    // Use executeMultiple to avoid libsql treating PRAGMA as parameterized statement.
    await this.client.executeMultiple('PRAGMA foreign_keys = ON;');
    await this.migrate();
    this.initialized = true;
  }

  private async migrate(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS clinical_lab_results (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                test_name TEXT NOT NULL,
                value TEXT NOT NULL,
                unit TEXT NOT NULL,
                reference_range TEXT,
                flag TEXT,
                date TEXT NOT NULL,
                source TEXT,
                notes TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_labs_patient_date ON clinical_lab_results(patient_id, date)`,
      `CREATE INDEX IF NOT EXISTS idx_labs_patient_test ON clinical_lab_results(patient_id, test_name)`,
      `CREATE TABLE IF NOT EXISTS clinical_treatment_trials (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                medication TEXT NOT NULL,
                drug_class TEXT,
                indication TEXT,
                start_date TEXT,
                end_date TEXT,
                dosage TEXT,
                efficacy TEXT NOT NULL,
                side_effects TEXT,
                reason_discontinued TEXT,
                adequate_trial INTEGER,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_treatments_patient ON clinical_treatment_trials(patient_id)`,
      `CREATE TABLE IF NOT EXISTS clinical_consultations (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                specialty TEXT NOT NULL,
                institution TEXT,
                date TEXT NOT NULL,
                reason TEXT,
                findings TEXT,
                conclusions TEXT,
                conclusions_status TEXT NOT NULL,
                recommendations TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_consultations_patient ON clinical_consultations(patient_id)`,
      `CREATE TABLE IF NOT EXISTS clinical_contradictions (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                finding1 TEXT NOT NULL,
                finding1_date TEXT,
                finding1_method TEXT,
                finding2 TEXT NOT NULL,
                finding2_date TEXT,
                finding2_method TEXT,
                resolution_status TEXT NOT NULL,
                resolution_plan TEXT,
                diagnostic_impact TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_contradictions_patient ON clinical_contradictions(patient_id)`,
      `CREATE TABLE IF NOT EXISTS clinical_patient_reports (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                date TEXT NOT NULL,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                severity INTEGER,
                extracted_insights TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_reports_patient_type ON clinical_patient_reports(patient_id, type)`,
      `CREATE TABLE IF NOT EXISTS clinical_agent_learnings (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                date TEXT NOT NULL,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                confidence INTEGER,
                related_hypotheses TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_learnings_patient_cat ON clinical_agent_learnings(patient_id, category)`,

      // ─── Imaging Reports ───────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS clinical_imaging_reports (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                modality TEXT NOT NULL,
                body_region TEXT NOT NULL,
                date TEXT NOT NULL,
                facility TEXT,
                physician TEXT,
                technique TEXT,
                findings TEXT,
                impression TEXT,
                comparison TEXT,
                source TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_imaging_patient ON clinical_imaging_reports(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_imaging_modality ON clinical_imaging_reports(patient_id, modality)`,

      // ─── Abdominal Reports ─────────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS clinical_abdominal_reports (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                procedure_type TEXT NOT NULL,
                date TEXT NOT NULL,
                facility TEXT,
                physician TEXT,
                findings TEXT,
                conclusions TEXT,
                source TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_abdominal_patient ON clinical_abdominal_reports(patient_id)`,

      // ─── Layer 2: Research Data Store (Enrichment) ───────────────────
      `CREATE TABLE IF NOT EXISTS research_findings (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                source TEXT NOT NULL,
                source_tool TEXT,
                external_id TEXT,
                external_id_type TEXT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL,
                url TEXT,
                relevance REAL,
                evidence_level TEXT,
                research_query_id TEXT,
                date TEXT NOT NULL,
                raw_data TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                content_hash TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_findings_patient ON research_findings(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_findings_external ON research_findings(external_id, external_id_type)`,
      `CREATE INDEX IF NOT EXISTS idx_findings_query ON research_findings(research_query_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_dedup_external ON research_findings(patient_id, external_id, external_id_type) WHERE external_id IS NOT NULL`,

      `CREATE TABLE IF NOT EXISTS research_queries (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                query TEXT NOT NULL,
                tool_used TEXT NOT NULL,
                agent TEXT,
                result_count INTEGER DEFAULT 0,
                finding_ids TEXT,
                synthesis TEXT,
                gaps TEXT,
                suggested_follow_up TEXT,
                stage INTEGER,
                date TEXT NOT NULL,
                duration_ms INTEGER,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_queries_patient ON research_queries(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_queries_tool ON research_queries(tool_used)`,

      `CREATE TABLE IF NOT EXISTS research_hypotheses (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                name TEXT NOT NULL,
                icd_code TEXT,
                probability_low REAL,
                probability_high REAL,
                advocate_case TEXT,
                skeptic_case TEXT,
                arbiter_verdict TEXT,
                evidence_tier TEXT,
                certainty_level TEXT,
                stage INTEGER,
                version INTEGER DEFAULT 1,
                superseded_by TEXT,
                date TEXT NOT NULL,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_hypotheses_patient ON research_hypotheses(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hypotheses_name ON research_hypotheses(patient_id, name)`,

      `CREATE TABLE IF NOT EXISTS hypothesis_evidence_links (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                hypothesis_id TEXT NOT NULL,
                finding_id TEXT,
                clinical_record_id TEXT,
                clinical_record_type TEXT,
                direction TEXT NOT NULL,
                claim TEXT NOT NULL,
                confidence REAL,
                tier TEXT,
                date TEXT NOT NULL,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_links_hypothesis ON hypothesis_evidence_links(hypothesis_id)`,
      `CREATE INDEX IF NOT EXISTS idx_links_finding ON hypothesis_evidence_links(finding_id)`,
      `CREATE INDEX IF NOT EXISTS idx_links_clinical ON hypothesis_evidence_links(clinical_record_id)`,

      // ─── Layer 1: Genetic Variants ──────────────────────────────────
      `CREATE TABLE IF NOT EXISTS genetic_variants (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                rsid TEXT NOT NULL,
                chromosome TEXT NOT NULL,
                position INTEGER NOT NULL,
                genotype TEXT NOT NULL,
                source TEXT NOT NULL,
                source_version TEXT,
                reference_genome TEXT NOT NULL DEFAULT 'GRCh37',
                import_date TEXT NOT NULL,
                raw_line TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_variants_patient ON genetic_variants(patient_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_variants_rsid ON genetic_variants(patient_id, rsid)`,
      `CREATE INDEX IF NOT EXISTS idx_variants_chr_pos ON genetic_variants(patient_id, chromosome, position)`,
      `CREATE INDEX IF NOT EXISTS idx_variants_genotype ON genetic_variants(patient_id, genotype)`,

      // ─── Layer 3: Brain Patterns ──────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS brain_patterns (
                id TEXT PRIMARY KEY,
                pattern TEXT NOT NULL,
                category TEXT NOT NULL,
                phenotype_cluster TEXT NOT NULL,
                supporting_cases INTEGER DEFAULT 1,
                confidence REAL DEFAULT 0.5,
                related_diagnoses TEXT,
                related_genes TEXT,
                source_case_labels TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_brain_patterns_category ON brain_patterns(category)`,
      `CREATE INDEX IF NOT EXISTS idx_brain_patterns_confidence ON brain_patterns(confidence)`,

      // ─── Layer 0: Source Documents ──────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS source_documents (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                original_file_hash TEXT NOT NULL,
                original_file_size_bytes INTEGER NOT NULL,
                original_page_count INTEGER,
                mime_type TEXT,
                extraction_method TEXT NOT NULL,
                extraction_confidence REAL NOT NULL,
                extraction_date TEXT NOT NULL,
                extraction_tool TEXT NOT NULL,
                extraction_wave INTEGER,
                extracted_markdown_path TEXT NOT NULL,
                pre_processing TEXT,
                post_processing TEXT,
                pipeline_version TEXT,
                category TEXT NOT NULL,
                subcategory TEXT,
                date TEXT,
                facility TEXT,
                physician TEXT,
                language TEXT,
                tags TEXT,
                fhir_resource_type TEXT,
                loinc_doc_code TEXT,
                diagnostic_service_section TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_source_docs_patient ON source_documents(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_source_docs_category ON source_documents(patient_id, category)`,
      `CREATE INDEX IF NOT EXISTS idx_source_docs_hash ON source_documents(original_file_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_source_docs_date ON source_documents(patient_id, date)`,

      // ─── Layer 1: Structured Imaging Findings ──────────────────────────
      `CREATE TABLE IF NOT EXISTS clinical_imaging_findings (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                imaging_report_id TEXT NOT NULL
                    REFERENCES clinical_imaging_reports(id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                anatomical_location TEXT NOT NULL,
                finding_type TEXT NOT NULL,
                laterality TEXT,
                measurement REAL,
                measurement_unit TEXT,
                severity TEXT,
                description TEXT NOT NULL,
                nerve_involvement TEXT,
                comparison_to_prior TEXT,
                date TEXT NOT NULL,
                radiologist TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_findings_patient ON clinical_imaging_findings(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_findings_report ON clinical_imaging_findings(imaging_report_id)`,
      `CREATE INDEX IF NOT EXISTS idx_findings_location ON clinical_imaging_findings(patient_id, anatomical_location)`,
      `CREATE INDEX IF NOT EXISTS idx_findings_type ON clinical_imaging_findings(patient_id, finding_type)`,
      `CREATE INDEX IF NOT EXISTS idx_findings_date ON clinical_imaging_findings(patient_id, date)`,

      // ─── Layer 1: Diagnosis Registry ───────────────────────────────────
      `CREATE TABLE IF NOT EXISTS clinical_diagnoses (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                icd10_code TEXT,
                condition_name TEXT NOT NULL,
                condition_name_pl TEXT,
                onset_date TEXT,
                first_documented_date TEXT,
                current_status TEXT NOT NULL,
                body_region TEXT,
                confidence REAL,
                supporting_evidence_ids TEXT,
                notes TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_diagnoses_patient ON clinical_diagnoses(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_diagnoses_icd ON clinical_diagnoses(patient_id, icd10_code)`,
      `CREATE INDEX IF NOT EXISTS idx_diagnoses_status ON clinical_diagnoses(patient_id, current_status)`,

      // ─── Layer 1: Progression Tracking ─────────────────────────────────
      `CREATE TABLE IF NOT EXISTS clinical_progressions (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                finding_chain_id TEXT NOT NULL,
                finding_name TEXT NOT NULL,
                finding_domain TEXT NOT NULL,
                anatomical_location TEXT,
                date TEXT NOT NULL,
                value TEXT NOT NULL,
                numeric_value REAL,
                unit TEXT,
                description TEXT,
                direction TEXT NOT NULL,
                comparison_note TEXT,
                source_record_id TEXT,
                source_record_type TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_progressions_patient ON clinical_progressions(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_progressions_chain ON clinical_progressions(finding_chain_id)`,
      `CREATE INDEX IF NOT EXISTS idx_progressions_domain ON clinical_progressions(patient_id, finding_domain)`,
      `CREATE INDEX IF NOT EXISTS idx_progressions_date ON clinical_progressions(patient_id, date)`,

      // ─── Layer 4: Report Versions (Deliverables) ──────────────────────
      `CREATE TABLE IF NOT EXISTS report_versions (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                report_name TEXT NOT NULL,
                language TEXT NOT NULL,
                version TEXT NOT NULL,
                file_path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                line_count INTEGER,
                subsection_count INTEGER,
                changes_summary TEXT,
                change_source TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_report_versions_patient ON report_versions(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_report_versions_name ON report_versions(patient_id, report_name, language)`,

      // ─── Layer 4: Report Data Integration ──────────────────────────────
      `CREATE TABLE IF NOT EXISTS report_data_integration (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                report_version_id TEXT NOT NULL
                    REFERENCES report_versions(id)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                data_id TEXT NOT NULL,
                data_type TEXT NOT NULL,
                integration_status TEXT NOT NULL,
                section_affected TEXT,
                integrated_at TEXT,
                exclusion_reason TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      `CREATE INDEX IF NOT EXISTS idx_integration_patient ON report_data_integration(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_integration_report ON report_data_integration(report_version_id)`,
      `CREATE INDEX IF NOT EXISTS idx_integration_status ON report_data_integration(patient_id, integration_status)`,
    ];

    for (const sql of statements) {
      await this.client.execute(sql);
    }

    // Migration for existing databases: add evidence provenance columns
    const provenanceTables = [
      'clinical_lab_results',
      'clinical_treatment_trials',
      'clinical_consultations',
      'clinical_contradictions',
      'clinical_patient_reports',
      'clinical_agent_learnings',
    ];
    for (const table of provenanceTables) {
      for (const col of ['evidence_tier', 'validation_status', 'source_credibility']) {
        await this.client
          .execute(
            `ALTER TABLE ${table} ADD COLUMN ${col} ${col === 'source_credibility' ? 'INTEGER' : 'TEXT'}`,
          )
          .catch(() => {
            /* column already exists */
          });
      }
    }
    // Migration: add source column to non-lab tables for provenance tracking
    const sourceTables = [
      'clinical_consultations',
      'clinical_treatment_trials',
      'clinical_contradictions',
      'clinical_patient_reports',
      'clinical_agent_learnings',
    ];
    for (const table of sourceTables) {
      await this.client.execute(`ALTER TABLE ${table} ADD COLUMN source TEXT`).catch(() => {
        /* column already exists */
      });
    }

    // Migration: add document_category column to all clinical tables (FHIR alignment)
    const categoryMapping: Record<string, string> = {
      clinical_lab_results: 'diagnostic-report',
      clinical_imaging_reports: 'diagnostic-report',
      clinical_abdominal_reports: 'diagnostic-report',
      clinical_consultations: 'encounter',
      clinical_treatment_trials: 'medication-statement',
      clinical_contradictions: 'clinical-impression',
      clinical_patient_reports: 'patient-observation',
      clinical_agent_learnings: 'clinical-impression',
    };
    for (const [table, category] of Object.entries(categoryMapping)) {
      await this.client
        .execute(`ALTER TABLE ${table} ADD COLUMN document_category TEXT DEFAULT '${category}'`)
        .catch(() => {
          /* column already exists */
        });
    }

    // Migration: add FHIR R4 metadata columns to all L1 clinical tables
    const fhirTables = [
      'clinical_lab_results',
      'clinical_treatment_trials',
      'clinical_consultations',
      'clinical_contradictions',
      'clinical_patient_reports',
      'clinical_agent_learnings',
      'clinical_imaging_reports',
      'clinical_abdominal_reports',
      'genetic_variants',
    ];
    for (const table of fhirTables) {
      for (const col of ['source_document_id', 'fhir_resource_type', 'fhir_status']) {
        await this.client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`).catch(() => {
          /* column already exists */
        });
      }
    }

    // Migration: add domain-specific FHIR columns
    await this.client
      .execute(`ALTER TABLE clinical_lab_results ADD COLUMN loinc_code TEXT`)
      .catch(() => {
        /* column already exists */
      });
    await this.client
      .execute(`ALTER TABLE clinical_lab_results ADD COLUMN value_snomed_code TEXT`)
      .catch(() => {
        /* column already exists */
      });
    await this.client
      .execute(`ALTER TABLE clinical_consultations ADD COLUMN snomed_specialty_code TEXT`)
      .catch(() => {
        /* column already exists */
      });
    await this.client
      .execute(`ALTER TABLE clinical_imaging_reports ADD COLUMN diagnostic_service_section TEXT`)
      .catch(() => {
        /* column already exists */
      });
    await this.client
      .execute(`ALTER TABLE clinical_imaging_reports ADD COLUMN loinc_study_code TEXT`)
      .catch(() => {
        /* column already exists */
      });

    // Migration: add SNOMED CT qualitative value code for lab results
    await this.client
      .execute(`ALTER TABLE clinical_lab_results ADD COLUMN value_snomed_code TEXT`)
      .catch(() => {
        /* column already exists */
      });

    // Migration: add LOINC study/procedure codes
    await this.client
      .execute(`ALTER TABLE clinical_imaging_reports ADD COLUMN loinc_study_code TEXT`)
      .catch(() => {
        /* column already exists */
      });
    await this.client
      .execute(`ALTER TABLE clinical_abdominal_reports ADD COLUMN loinc_procedure_code TEXT`)
      .catch(() => {
        /* column already exists */
      });

    // Migration: add SNOMED CT body site code for imaging reports
    await this.client
      .execute(`ALTER TABLE clinical_imaging_reports ADD COLUMN body_site_snomed_code TEXT`)
      .catch(() => {
        /* column already exists */
      });

    // Migration: add SNOMED CT clinical finding codes
    await this.client
      .execute(`ALTER TABLE clinical_consultations ADD COLUMN snomed_finding_code TEXT`)
      .catch(() => {
        /* column already exists */
      });
    await this.client
      .execute(`ALTER TABLE clinical_diagnoses ADD COLUMN snomed_code TEXT`)
      .catch(() => {
        /* column already exists */
      });

    // Migration: add ICD-10 code to consultations (v3.0.0 — SNOMED crosswalk)
    await this.client
      .execute(`ALTER TABLE clinical_consultations ADD COLUMN icd10_code TEXT`)
      .catch(() => {
        /* column already exists */
      });

    // Migration: add extraction_confidence to all L1 tables (v3.0.0 — SOTA confidence scoring)
    for (const table of [
      'clinical_lab_results',
      'clinical_consultations',
      'clinical_imaging_reports',
      'clinical_abdominal_reports',
      'clinical_patient_reports',
    ]) {
      await this.client
        .execute(`ALTER TABLE ${table} ADD COLUMN extraction_confidence REAL`)
        .catch(() => {
          /* column already exists */
        });
    }

    // Migration: add clinical_medications table (RxNorm-coded)
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS clinical_medications (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL,
        medication_name TEXT NOT NULL,
        brand_name TEXT,
        rxnorm_code TEXT,
        dosage TEXT,
        route TEXT,
        frequency TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        start_date TEXT,
        end_date TEXT,
        prescriber TEXT,
        indication TEXT,
        source_document_id TEXT,
        evidence_tier TEXT,
        validation_status TEXT,
        source_credibility INTEGER,
        fhir_resource_type TEXT DEFAULT 'MedicationStatement',
        fhir_status TEXT DEFAULT 'active',
        document_category TEXT DEFAULT 'medication',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS idx_medications_patient ON clinical_medications(patient_id)`,
    );
    await this.client.execute(
      `CREATE INDEX IF NOT EXISTS idx_medications_rxnorm ON clinical_medications(rxnorm_code) WHERE rxnorm_code IS NOT NULL`,
    );

    // Migration: add genetic_variants provenance + SOTA genomic columns
    // (source_document_id, fhir_resource_type, fhir_status already added via fhirTables loop above)
    const geneticVariantColumns = [
      'evidence_tier TEXT',
      'validation_status TEXT',
      'source_credibility INTEGER',
      'document_category TEXT',
      // GA4GH VRS 2.0 computed identifiers
      'vrs_digest TEXT',
      'vrs_allele_id TEXT',
      // FHIR Genomics Reporting IG STU3 fields
      'genomic_source_class TEXT',
      'allelic_state TEXT',
      'coding_change_type TEXT',
      // ClinVar/ACMG clinical annotation
      'clinical_significance TEXT',
      'clinvar_id TEXT',
      'clinvar_last_evaluated TEXT',
      'review_status TEXT',
      'gene_symbol TEXT',
      'conditions TEXT',
      'molecular_consequence TEXT',
      // Pharmacogenomics (PharmGKB/CPIC)
      'pharmgkb_level TEXT',
      'star_allele TEXT',
      // Population frequency
      'global_minor_allele_freq REAL',
    ];
    for (const colDef of geneticVariantColumns) {
      await this.client
        .execute(`ALTER TABLE genetic_variants ADD COLUMN ${colDef}`)
        .catch(() => {
          /* column already exists */
        });
    }
    // Indexes for clinical annotation queries
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_variants_clinvar ON genetic_variants(clinvar_id) WHERE clinvar_id IS NOT NULL`,
      )
      .catch(() => {});
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_variants_gene ON genetic_variants(gene_symbol) WHERE gene_symbol IS NOT NULL`,
      )
      .catch(() => {});
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_variants_significance ON genetic_variants(clinical_significance) WHERE clinical_significance IS NOT NULL`,
      )
      .catch(() => {});
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_variants_vrs ON genetic_variants(vrs_digest) WHERE vrs_digest IS NOT NULL`,
      )
      .catch(() => {});

    // Migration: add FK indexes on source_document_id for provenance tracing
    for (const table of fhirTables) {
      const shortName = table.replace('clinical_', '');
      await this.client
        .execute(
          `CREATE INDEX IF NOT EXISTS idx_${shortName}_source_doc ON ${table}(source_document_id) WHERE source_document_id IS NOT NULL`,
        )
        .catch(() => {
          /* index already exists */
        });
    }

    // Migration: add Phase C tables (empty, ready for extraction)
    await this.client
      .execute(
        `CREATE TABLE IF NOT EXISTS clinical_conditions (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                code TEXT NOT NULL,
                code_system TEXT NOT NULL DEFAULT 'ICD-10',
                display_name TEXT NOT NULL,
                clinical_status TEXT NOT NULL,
                verification_status TEXT NOT NULL DEFAULT 'unconfirmed',
                onset_date TEXT,
                abatement_date TEXT,
                category TEXT,
                severity TEXT,
                notes TEXT,
                source_document_id TEXT,
                fhir_resource_type TEXT DEFAULT 'Condition',
                fhir_status TEXT DEFAULT 'final',
                document_category TEXT DEFAULT 'clinical-impression',
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      )
      .catch(() => {
        /* table already exists */
      });
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_conditions_patient ON clinical_conditions(patient_id)`,
      )
      .catch(() => {
        /* index already exists */
      });

    await this.client
      .execute(
        `CREATE TABLE IF NOT EXISTS clinical_allergy_intolerances (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                substance TEXT NOT NULL,
                reaction TEXT,
                severity TEXT,
                clinical_status TEXT NOT NULL DEFAULT 'active',
                type TEXT NOT NULL DEFAULT 'allergy',
                source_document_id TEXT,
                fhir_resource_type TEXT DEFAULT 'AllergyIntolerance',
                fhir_status TEXT DEFAULT 'final',
                document_category TEXT DEFAULT 'clinical-impression',
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      )
      .catch(() => {
        /* table already exists */
      });
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_allergies_patient ON clinical_allergy_intolerances(patient_id)`,
      )
      .catch(() => {
        /* index already exists */
      });

    await this.client
      .execute(
        `CREATE TABLE IF NOT EXISTS clinical_family_history (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                relationship TEXT NOT NULL,
                condition TEXT NOT NULL,
                onset_age TEXT,
                deceased INTEGER,
                source_document_id TEXT,
                fhir_resource_type TEXT DEFAULT 'FamilyMemberHistory',
                fhir_status TEXT DEFAULT 'final',
                document_category TEXT DEFAULT 'clinical-impression',
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )`,
      )
      .catch(() => {
        /* table already exists */
      });
    await this.client
      .execute(
        `CREATE INDEX IF NOT EXISTS idx_family_history_patient ON clinical_family_history(patient_id)`,
      )
      .catch(() => {
        /* index already exists */
      });

    // Migration: medication_changes table (L1 — temporal medication history)
    await this.client
      .execute(
        `CREATE TABLE IF NOT EXISTS medication_changes (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                medication_name TEXT NOT NULL,
                rxnorm_code TEXT,
                change_type TEXT NOT NULL,
                change_date TEXT,
                previous_value TEXT,
                new_value TEXT,
                reason TEXT,
                source_document_id TEXT,
                source_consultation_id TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )`,
      )
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_med_changes_patient ON medication_changes(patient_id)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_med_changes_medication ON medication_changes(medication_name)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_med_changes_date ON medication_changes(change_date) WHERE change_date IS NOT NULL`)
      .catch(() => {});

    // Migration: medication_interactions table (L2 — schema only, populated via future annotation script)
    await this.client
      .execute(
        `CREATE TABLE IF NOT EXISTS medication_interactions (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                medication_a_name TEXT NOT NULL,
                medication_a_rxnorm TEXT,
                medication_b_name TEXT NOT NULL,
                medication_b_rxnorm TEXT,
                severity TEXT NOT NULL,
                interaction_type TEXT,
                description TEXT NOT NULL,
                clinical_consequence TEXT,
                management TEXT,
                source TEXT NOT NULL,
                source_reference TEXT,
                evidence_tier TEXT DEFAULT 'expert-opinion',
                validation_status TEXT DEFAULT 'unvalidated',
                source_credibility INTEGER,
                active INTEGER DEFAULT 1,
                created_at TEXT DEFAULT (datetime('now'))
            )`,
      )
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_interactions_patient ON medication_interactions(patient_id)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_interactions_med_a ON medication_interactions(medication_a_name)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_interactions_med_b ON medication_interactions(medication_b_name)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_interactions_severity ON medication_interactions(severity)`)
      .catch(() => {});

    // Migration: medication_adherence table (L2 — FHIR R5 aligned, populated from clinical notes or patient reports)
    await this.client
      .execute(
        `CREATE TABLE IF NOT EXISTS medication_adherence (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL,
                medication_name TEXT NOT NULL,
                rxnorm_code TEXT,
                observation_date TEXT,
                adherence_code TEXT NOT NULL,
                reporter TEXT,
                notes TEXT,
                source_document_id TEXT,
                evidence_tier TEXT,
                validation_status TEXT,
                source_credibility INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )`,
      )
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_adherence_patient ON medication_adherence(patient_id)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_adherence_medication ON medication_adherence(medication_name)`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_adherence_date ON medication_adherence(observation_date) WHERE observation_date IS NOT NULL`)
      .catch(() => {});

    // Migration: add rxnorm_code to clinical_treatment_trials
    await this.client
      .execute(`ALTER TABLE clinical_treatment_trials ADD COLUMN rxnorm_code TEXT`)
      .catch(() => {});
    await this.client
      .execute(`CREATE INDEX IF NOT EXISTS idx_treatments_rxnorm ON clinical_treatment_trials(rxnorm_code) WHERE rxnorm_code IS NOT NULL`)
      .catch(() => {});

    // Migration: add content_hash to source_documents
    await this.client
      .execute(`ALTER TABLE source_documents ADD COLUMN content_hash TEXT`)
      .catch(() => {});

    // Migration: add evidence_tier and validation_status to brain_patterns
    await this.client
      .execute(`ALTER TABLE brain_patterns ADD COLUMN evidence_tier TEXT DEFAULT 'T3-ai-inferred'`)
      .catch(() => {});
    await this.client
      .execute(`ALTER TABLE brain_patterns ADD COLUMN validation_status TEXT DEFAULT 'unvalidated'`)
      .catch(() => {});

    // Migration: add updated_at to all L1 clinical tables (provenance tracking)
    const tablesNeedingUpdatedAt = [
      'clinical_lab_results',
      'clinical_consultations',
      'clinical_imaging_reports',
      'clinical_abdominal_reports',
      'clinical_patient_reports',
      'clinical_treatment_trials',
      'clinical_contradictions',
      'clinical_agent_learnings',
      'clinical_allergy_intolerances',
      'clinical_conditions',
      'clinical_family_history',
      'clinical_imaging_findings',
      'clinical_progressions',
    ];
    for (const table of tablesNeedingUpdatedAt) {
      await this.client
        .execute(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`)
        .catch(() => {});
    }

    logger.debug('ClinicalStore migration complete');
  }

  // ─── Lab Results ──────────────────────────────────────────────────────

  async addLabResult(lab: LabResult): Promise<void> {
    await this.ensureInitialized();
    this.requireLabSource(lab);
    await this.client.execute(this.labResultStatement(lab));
  }

  async addLabResultsBatch(labs: LabResult[]): Promise<{ inserted: number }> {
    await this.ensureInitialized();
    if (labs.length === 0) return { inserted: 0 };

    for (const lab of labs) {
      this.requireLabSource(lab);
    }

    const stmts = labs.map((lab) => this.labResultStatement(lab));

    // LibSQL batch in chunks of 100 (atomic per chunk)
    for (let i = 0; i < stmts.length; i += 100) {
      await this.client.batch(stmts.slice(i, i + 100), 'write');
    }

    return { inserted: labs.length };
  }

  /** Reject lab entries without source attribution to prevent hallucinated data. */
  private requireLabSource(lab: LabResult): void {
    if (!lab.source || lab.source.trim() === '') {
      throw new Error(
        `Lab result for "${lab.testName}" rejected: source is required (prevents agent-hallucinated entries)`,
      );
    }
  }

  private labResultStatement(lab: LabResult) {
    return {
      sql: `INSERT OR REPLACE INTO clinical_lab_results
                (id, patient_id, test_name, value, unit, reference_range, flag, date, source, notes,
                 evidence_tier, validation_status, source_credibility,
                 source_document_id, fhir_resource_type, fhir_status, document_category,
                 loinc_code, value_snomed_code, extraction_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        lab.id,
        lab.patientId,
        lab.testName,
        String(lab.value),
        lab.unit,
        lab.referenceRange ?? null,
        lab.flag ?? null,
        lab.date,
        lab.source ?? null,
        lab.notes ?? null,
        lab.evidenceTier ?? null,
        lab.validationStatus ?? null,
        lab.sourceCredibility ?? null,
        lab.sourceDocumentId ?? null,
        lab.fhirResourceType ?? null,
        lab.fhirStatus ?? null,
        lab.documentCategory ?? null,
        lab.loincCode ?? null,
        lab.valueSnomedCode ?? null,
        lab.extractionConfidence ?? null,
      ],
    };
  }

  async updateLabSnomedCode(labId: string, snomedCode: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE clinical_lab_results SET value_snomed_code = ? WHERE id = ?`,
      args: [snomedCode, labId],
    });
  }

  async updateConsultationSnomedFinding(
    consultationId: string,
    snomedCode: string,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE clinical_consultations SET snomed_finding_code = ? WHERE id = ?`,
      args: [snomedCode, consultationId],
    });
  }

  async updateConsultationIcd10Code(
    consultationId: string,
    icd10Code: string,
  ): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE clinical_consultations SET icd10_code = ? WHERE id = ?`,
      args: [icd10Code, consultationId],
    });
  }

  async updateLabLoincCode(labId: string, loincCode: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE clinical_lab_results SET loinc_code = ? WHERE id = ?`,
      args: [loincCode, labId],
    });
  }

  async updateImagingLoincCode(imagingId: string, loincCode: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE clinical_imaging_reports SET loinc_study_code = ? WHERE id = ?`,
      args: [loincCode, imagingId],
    });
  }

  /**
   * Returns all distinct patient_id values found across clinical tables.
   * Useful for detecting ID mismatches (e.g., 'tomasz-szychliński' vs 'patient-tomasz-szychlinski').
   */
  async getPatientIds(): Promise<string[]> {
    await this.ensureInitialized();
    const tables = [
      'clinical_lab_results',
      'clinical_treatment_trials',
      'clinical_consultations',
      'research_findings',
      'research_hypotheses',
    ];
    const ids = new Set<string>();
    for (const table of tables) {
      const result = await this.client.execute({
        sql: `SELECT DISTINCT patient_id FROM ${table}`,
        args: [],
      });
      for (const row of result.rows) {
        const pid = row['patient_id'];
        if (typeof pid === 'string') ids.add(pid);
      }
    }
    return Array.from(ids);
  }

  /**
   * Warns if a patient_id returns 0 results but similar IDs exist.
   * Call this from query methods to detect silent ID mismatches.
   */
  private async warnIfIdMismatch(
    patientId: string,
    table: string,
    resultCount: number,
  ): Promise<void> {
    if (resultCount > 0) return;
    // Extract the base name (remove 'patient-' prefix, normalize unicode)
    const baseName = patientId
      .replace(/^patient-/, '')
      .normalize('NFC')
      .toLowerCase();
    const result = await this.client.execute({
      sql: `SELECT DISTINCT patient_id FROM ${table} WHERE patient_id LIKE ?`,
      args: [`%${baseName.slice(0, 6)}%`],
    });
    const otherIds = result.rows
      .map((r) => String(r['patient_id']))
      .filter((id) => id !== patientId);
    if (otherIds.length > 0) {
      logger.warn('Patient ID mismatch detected', {
        queriedId: patientId,
        table,
        resultCount: 0,
        similarIds: otherIds,
        hint: 'Data may exist under a different patient ID. Run scripts/normalize-patient-ids.ts to fix.',
      });
    }
  }

  async queryLabs(params: {
    patientId: string;
    testName?: string;
    dateFrom?: string;
    dateTo?: string;
    flag?: string;
  }): Promise<LabResult[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.testName) {
      // Support both exact match and substring search (prefix with % for LIKE)
      if (params.testName.includes('%')) {
        conditions.push('test_name LIKE ?');
      } else {
        conditions.push('test_name = ?');
      }
      args.push(params.testName);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }
    if (params.flag) {
      conditions.push('flag = ?');
      args.push(params.flag);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_lab_results WHERE ${conditions.join(' AND ')} ORDER BY date ASC`,
      args,
    });

    const labs = result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      testName: String(row['test_name']),
      value: parseLabValue(row['value']),
      unit: String(row['unit']),
      referenceRange: row['reference_range'] ? String(row['reference_range']) : undefined,
      flag: row['flag'] as LabResult['flag'],
      date: String(row['date']),
      source: row['source'] ? String(row['source']) : undefined,
      notes: row['notes'] ? String(row['notes']) : undefined,
      loincCode: row['loinc_code'] ? String(row['loinc_code']) : undefined,
      valueSnomedCode: row['value_snomed_code'] ? String(row['value_snomed_code']) : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));

    await this.warnIfIdMismatch(params.patientId, 'clinical_lab_results', labs.length);
    return labs;
  }

  async getLabTrends(params: {
    patientId: string;
    testName: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<LabTrend | null> {
    const query: { patientId: string; testName: string; dateFrom?: string; dateTo?: string } = {
      patientId: params.patientId,
      testName: params.testName,
    };
    if (params.dateFrom) query.dateFrom = params.dateFrom;
    if (params.dateTo) query.dateTo = params.dateTo;
    const labs = await this.queryLabs(query);

    const numericLabs = labs.filter((l) => typeof l.value === 'number') as Array<
      LabResult & { value: number }
    >;
    if (numericLabs.length < 2) return null;

    const values = numericLabs.map((l) => ({
      date: l.date,
      value: l.value,
      flag: l.flag,
    }));

    const latest = numericLabs[numericLabs.length - 1];
    if (!latest) return null;

    const direction = computeTrendDirection(numericLabs.map((l) => l.value));
    const rateOfChange = computeRateOfChange(numericLabs);
    const isAbnormal = latest.flag !== undefined && latest.flag !== 'normal';

    return {
      testName: params.testName,
      values,
      direction,
      rateOfChange: rateOfChange ?? undefined,
      latestValue: latest.value,
      latestDate: latest.date,
      isAbnormal,
      clinicalNote: generateClinicalNote(direction, rateOfChange, isAbnormal, params.testName),
    };
  }

  // ─── Treatment Trials ─────────────────────────────────────────────────

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat INSERT with many nullable FHIR columns
  async addTreatmentTrial(trial: TreatmentTrial): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_treatment_trials
                (id, patient_id, medication, rxnorm_code, drug_class, indication, start_date, end_date,
                 dosage, efficacy, side_effects, reason_discontinued, adequate_trial,
                 evidence_tier, validation_status, source_credibility, source,
                 source_document_id, fhir_resource_type, fhir_status, document_category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        trial.id,
        trial.patientId,
        trial.medication,
        trial.rxnormCode ?? null,
        trial.drugClass ?? null,
        trial.indication ?? null,
        trial.startDate ?? null,
        trial.endDate ?? null,
        trial.dosage ?? null,
        trial.efficacy,
        trial.sideEffects ? JSON.stringify(trial.sideEffects) : null,
        trial.reasonDiscontinued ?? null,
        trial.adequateTrial === undefined ? null : trial.adequateTrial ? 1 : 0,
        trial.evidenceTier ?? null,
        trial.validationStatus ?? null,
        trial.sourceCredibility ?? null,
        trial.source ?? null,
        trial.sourceDocumentId ?? null,
        trial.fhirResourceType ?? null,
        trial.fhirStatus ?? null,
        trial.documentCategory ?? null,
      ],
    });
  }

  async queryTreatments(params: {
    patientId: string;
    drugClass?: string;
    efficacy?: string;
  }): Promise<TreatmentTrial[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.drugClass) {
      conditions.push('drug_class = ?');
      args.push(params.drugClass);
    }
    if (params.efficacy) {
      conditions.push('efficacy = ?');
      args.push(params.efficacy);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_treatment_trials WHERE ${conditions.join(' AND ')} ORDER BY start_date ASC`,
      args,
    });

    return result.rows.map(mapRowToTreatmentTrial);
  }

  /** Check if a treatment trial with the same (patientId, medication, startDate) exists. */
  async findTreatmentTrial(
    patientId: string,
    medication: string,
    startDate: string | null,
  ): Promise<string | null> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT id FROM clinical_treatment_trials
            WHERE patient_id = ? AND medication = ? AND (start_date = ? OR (start_date IS NULL AND ? IS NULL))
            LIMIT 1`,
      args: [patientId, medication, startDate, startDate],
    });
    return result.rows.length > 0 ? String(result.rows[0]?.['id']) : null;
  }

  // ─── Consultations ────────────────────────────────────────────────────

  async addConsultation(consultation: Consultation): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_consultations
                (id, patient_id, provider, specialty, institution, date, reason, findings,
                 conclusions, conclusions_status, recommendations,
                 evidence_tier, validation_status, source_credibility, source,
                 source_document_id, fhir_resource_type, fhir_status, document_category,
                 snomed_specialty_code, snomed_finding_code, icd10_code, extraction_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        consultation.id,
        consultation.patientId,
        consultation.provider,
        consultation.specialty,
        consultation.institution ?? null,
        consultation.date,
        consultation.reason ?? null,
        consultation.findings ?? null,
        consultation.conclusions ?? null,
        consultation.conclusionsStatus,
        consultation.recommendations ? JSON.stringify(consultation.recommendations) : null,
        consultation.evidenceTier ?? null,
        consultation.validationStatus ?? null,
        consultation.sourceCredibility ?? null,
        consultation.source ?? null,
        consultation.sourceDocumentId ?? null,
        consultation.fhirResourceType ?? null,
        consultation.fhirStatus ?? null,
        consultation.documentCategory ?? null,
        consultation.snomedSpecialtyCode ?? null,
        consultation.snomedFindingCode ?? null,
        consultation.icd10Code ?? null,
        consultation.extractionConfidence ?? null,
      ],
    });
  }

  async queryConsultations(params: {
    patientId: string;
    specialty?: string;
    provider?: string;
  }): Promise<Consultation[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.specialty) {
      conditions.push('specialty = ?');
      args.push(params.specialty);
    }
    if (params.provider) {
      conditions.push('provider LIKE ?');
      args.push(`%${params.provider}%`);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_consultations WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      provider: String(row['provider']),
      specialty: String(row['specialty']),
      institution: row['institution'] ? String(row['institution']) : undefined,
      date: String(row['date']),
      reason: row['reason'] ? String(row['reason']) : undefined,
      findings: row['findings'] ? String(row['findings']) : undefined,
      conclusions: row['conclusions'] ? String(row['conclusions']) : undefined,
      conclusionsStatus: String(row['conclusions_status']) as Consultation['conclusionsStatus'],
      recommendations: row['recommendations']
        ? (JSON.parse(String(row['recommendations'])) as string[])
        : undefined,
      snomedSpecialtyCode: row['snomed_specialty_code']
        ? String(row['snomed_specialty_code'])
        : undefined,
      snomedFindingCode: row['snomed_finding_code']
        ? String(row['snomed_finding_code'])
        : undefined,
      icd10Code: row['icd10_code'] ? String(row['icd10_code']) : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));
  }

  async queryConsultationsMissingSnomedFinding(): Promise<Consultation[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_consultations WHERE snomed_finding_code IS NULL ORDER BY date DESC`,
      args: [],
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      provider: String(row['provider']),
      specialty: String(row['specialty']),
      institution: row['institution'] ? String(row['institution']) : undefined,
      date: String(row['date']),
      reason: row['reason'] ? String(row['reason']) : undefined,
      findings: row['findings'] ? String(row['findings']) : undefined,
      conclusions: row['conclusions'] ? String(row['conclusions']) : undefined,
      conclusionsStatus: String(row['conclusions_status']) as Consultation['conclusionsStatus'],
      recommendations: row['recommendations']
        ? (JSON.parse(String(row['recommendations'])) as string[])
        : undefined,
      snomedSpecialtyCode: row['snomed_specialty_code']
        ? String(row['snomed_specialty_code'])
        : undefined,
      snomedFindingCode: row['snomed_finding_code']
        ? String(row['snomed_finding_code'])
        : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));
  }

  /** Check if a consultation with the same (patientId, specialty, date, provider) exists. */
  async findConsultation(
    patientId: string,
    specialty: string,
    date: string,
    provider: string,
  ): Promise<string | null> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT id FROM clinical_consultations
            WHERE patient_id = ? AND specialty = ? AND date = ? AND provider = ?
            LIMIT 1`,
      args: [patientId, specialty, date, provider],
    });
    return result.rows.length > 0 ? String(result.rows[0]?.['id']) : null;
  }

  // ─── Medications ─────────────────────────────────────────────────────

  async addMedication(med: import('../schemas/medication.js').Medication): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_medications
                (id, patient_id, medication_name, brand_name, rxnorm_code,
                 dosage, route, frequency, status, start_date, end_date,
                 prescriber, indication, source_document_id,
                 evidence_tier, validation_status, source_credibility,
                 fhir_resource_type, fhir_status, document_category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        med.id,
        med.patientId,
        med.medicationName,
        med.brandName ?? null,
        med.rxnormCode ?? null,
        med.dosage ?? null,
        med.route ?? null,
        med.frequency ?? null,
        med.status,
        med.startDate ?? null,
        med.endDate ?? null,
        med.prescriber ?? null,
        med.indication ?? null,
        med.sourceDocumentId ?? null,
        med.evidenceTier ?? null,
        med.validationStatus ?? null,
        med.sourceCredibility ?? null,
        med.fhirResourceType ?? 'MedicationStatement',
        med.fhirStatus ?? 'active',
        med.documentCategory ?? 'medication',
      ],
    });
  }

  async queryMedications(params: {
    patientId: string;
    status?: string;
  }): Promise<import('../schemas/medication.js').Medication[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.status) {
      conditions.push('status = ?');
      args.push(params.status);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_medications WHERE ${conditions.join(' AND ')} ORDER BY medication_name`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      medicationName: String(row['medication_name']),
      brandName: row['brand_name'] ? String(row['brand_name']) : undefined,
      rxnormCode: row['rxnorm_code'] ? String(row['rxnorm_code']) : undefined,
      dosage: row['dosage'] ? String(row['dosage']) : undefined,
      route: row['route'] as import('../schemas/medication.js').Medication['route'],
      frequency: row['frequency'] ? String(row['frequency']) : undefined,
      status: String(row['status']) as import('../schemas/medication.js').Medication['status'],
      startDate: row['start_date'] ? String(row['start_date']) : undefined,
      endDate: row['end_date'] ? String(row['end_date']) : undefined,
      prescriber: row['prescriber'] ? String(row['prescriber']) : undefined,
      indication: row['indication'] ? String(row['indication']) : undefined,
      sourceDocumentId: row['source_document_id'] ? String(row['source_document_id']) : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));
  }

  // ─── Medication Changes ──────────────────────────────────────────────

  async addMedicationChange(change: {
    id: string;
    patientId: string;
    medicationName: string;
    rxnormCode?: string;
    changeType: string;
    changeDate?: string;
    previousValue?: string;
    newValue?: string;
    reason?: string;
    sourceDocumentId?: string;
    sourceConsultationId?: string;
    evidenceTier?: string;
    validationStatus?: string;
    sourceCredibility?: number;
  }): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO medication_changes
                (id, patient_id, medication_name, rxnorm_code, change_type, change_date,
                 previous_value, new_value, reason, source_document_id, source_consultation_id,
                 evidence_tier, validation_status, source_credibility)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        change.id,
        change.patientId,
        change.medicationName,
        change.rxnormCode ?? null,
        change.changeType,
        change.changeDate ?? null,
        change.previousValue ?? null,
        change.newValue ?? null,
        change.reason ?? null,
        change.sourceDocumentId ?? null,
        change.sourceConsultationId ?? null,
        change.evidenceTier ?? null,
        change.validationStatus ?? null,
        change.sourceCredibility ?? null,
      ],
    });
  }

  async queryMedicationChanges(params: {
    patientId: string;
    medicationName?: string;
  }): Promise<Array<{
    id: string;
    patientId: string;
    medicationName: string;
    rxnormCode: string | undefined;
    changeType: string;
    changeDate: string | undefined;
    previousValue: string | undefined;
    newValue: string | undefined;
    reason: string | undefined;
    sourceDocumentId: string | undefined;
    sourceConsultationId: string | undefined;
  }>> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.medicationName) {
      conditions.push('medication_name = ?');
      args.push(params.medicationName);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM medication_changes WHERE ${conditions.join(' AND ')} ORDER BY change_date ASC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      medicationName: String(row['medication_name']),
      rxnormCode: row['rxnorm_code'] ? String(row['rxnorm_code']) : undefined,
      changeType: String(row['change_type']),
      changeDate: row['change_date'] ? String(row['change_date']) : undefined,
      previousValue: row['previous_value'] ? String(row['previous_value']) : undefined,
      newValue: row['new_value'] ? String(row['new_value']) : undefined,
      reason: row['reason'] ? String(row['reason']) : undefined,
      sourceDocumentId: row['source_document_id'] ? String(row['source_document_id']) : undefined,
      sourceConsultationId: row['source_consultation_id'] ? String(row['source_consultation_id']) : undefined,
    }));
  }

  // ─── Medication Interactions ────────────────────────────────────────

  async addMedicationInteraction(interaction: {
    id: string;
    patientId: string;
    medicationAName: string;
    medicationARxnorm?: string;
    medicationBName: string;
    medicationBRxnorm?: string;
    severity: string;
    interactionType?: string;
    description: string;
    clinicalConsequence?: string;
    management?: string;
    source: string;
    sourceReference?: string;
    evidenceTier?: string;
    validationStatus?: string;
    sourceCredibility?: number;
    active?: boolean;
  }): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO medication_interactions
                (id, patient_id, medication_a_name, medication_a_rxnorm,
                 medication_b_name, medication_b_rxnorm, severity, interaction_type,
                 description, clinical_consequence, management, source, source_reference,
                 evidence_tier, validation_status, source_credibility, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        interaction.id,
        interaction.patientId,
        interaction.medicationAName,
        interaction.medicationARxnorm ?? null,
        interaction.medicationBName,
        interaction.medicationBRxnorm ?? null,
        interaction.severity,
        interaction.interactionType ?? null,
        interaction.description,
        interaction.clinicalConsequence ?? null,
        interaction.management ?? null,
        interaction.source,
        interaction.sourceReference ?? null,
        interaction.evidenceTier ?? 'expert-opinion',
        interaction.validationStatus ?? 'unvalidated',
        interaction.sourceCredibility ?? null,
        interaction.active === false ? 0 : 1,
      ],
    });
  }

  async queryMedicationInteractions(params: {
    patientId: string;
    medicationName?: string;
    severity?: string;
    activeOnly?: boolean;
  }): Promise<Array<{
    id: string;
    patientId: string;
    medicationAName: string;
    medicationARxnorm: string | undefined;
    medicationBName: string;
    medicationBRxnorm: string | undefined;
    severity: string;
    interactionType: string | undefined;
    description: string;
    clinicalConsequence: string | undefined;
    management: string | undefined;
    source: string;
    active: boolean;
  }>> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | number | null)[] = [params.patientId];

    if (params.medicationName) {
      conditions.push('(medication_a_name = ? OR medication_b_name = ?)');
      args.push(params.medicationName, params.medicationName);
    }
    if (params.severity) {
      conditions.push('severity = ?');
      args.push(params.severity);
    }
    if (params.activeOnly) {
      conditions.push('active = 1');
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM medication_interactions WHERE ${conditions.join(' AND ')} ORDER BY severity DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      medicationAName: String(row['medication_a_name']),
      medicationARxnorm: row['medication_a_rxnorm'] ? String(row['medication_a_rxnorm']) : undefined,
      medicationBName: String(row['medication_b_name']),
      medicationBRxnorm: row['medication_b_rxnorm'] ? String(row['medication_b_rxnorm']) : undefined,
      severity: String(row['severity']),
      interactionType: row['interaction_type'] ? String(row['interaction_type']) : undefined,
      description: String(row['description']),
      clinicalConsequence: row['clinical_consequence'] ? String(row['clinical_consequence']) : undefined,
      management: row['management'] ? String(row['management']) : undefined,
      source: String(row['source']),
      active: row['active'] === 1,
    }));
  }

  // ─── Medication Adherence ───────────────────────────────────────────

  async addAdherenceObservation(observation: {
    id: string;
    patientId: string;
    medicationName: string;
    rxnormCode?: string;
    observationDate?: string;
    adherenceCode: string;
    reporter?: string;
    notes?: string;
    sourceDocumentId?: string;
    evidenceTier?: string;
    validationStatus?: string;
    sourceCredibility?: number;
  }): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO medication_adherence
                (id, patient_id, medication_name, rxnorm_code, observation_date,
                 adherence_code, reporter, notes, source_document_id,
                 evidence_tier, validation_status, source_credibility)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        observation.id,
        observation.patientId,
        observation.medicationName,
        observation.rxnormCode ?? null,
        observation.observationDate ?? null,
        observation.adherenceCode,
        observation.reporter ?? null,
        observation.notes ?? null,
        observation.sourceDocumentId ?? null,
        observation.evidenceTier ?? null,
        observation.validationStatus ?? null,
        observation.sourceCredibility ?? null,
      ],
    });
  }

  async queryAdherenceObservations(params: {
    patientId: string;
    medicationName?: string;
  }): Promise<Array<{
    id: string;
    patientId: string;
    medicationName: string;
    rxnormCode: string | undefined;
    observationDate: string | undefined;
    adherenceCode: string;
    reporter: string | undefined;
    notes: string | undefined;
    sourceDocumentId: string | undefined;
  }>> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.medicationName) {
      conditions.push('medication_name = ?');
      args.push(params.medicationName);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM medication_adherence WHERE ${conditions.join(' AND ')} ORDER BY observation_date ASC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      medicationName: String(row['medication_name']),
      rxnormCode: row['rxnorm_code'] ? String(row['rxnorm_code']) : undefined,
      observationDate: row['observation_date'] ? String(row['observation_date']) : undefined,
      adherenceCode: String(row['adherence_code']),
      reporter: row['reporter'] ? String(row['reporter']) : undefined,
      notes: row['notes'] ? String(row['notes']) : undefined,
      sourceDocumentId: row['source_document_id'] ? String(row['source_document_id']) : undefined,
    }));
  }

  // ─── Medication Timeline (cross-table UNION query) ────────────────────

  async queryMedicationTimeline(params: {
    patientId: string;
    medicationName?: string;
    rxnormCode?: string;
  }): Promise<Array<import('../schemas/medication.js').MedicationTimelineEntry>> {
    await this.ensureInitialized();

    const medFilter = params.medicationName
      ? ` AND medication_name = '${params.medicationName.replace(/'/g, "''")}'`
      : params.rxnormCode
        ? ` AND rxnorm_code = '${params.rxnormCode.replace(/'/g, "''")}'`
        : '';

    const trialMedFilter = params.medicationName
      ? ` AND medication = '${params.medicationName.replace(/'/g, "''")}'`
      : params.rxnormCode
        ? ` AND rxnorm_code = '${params.rxnormCode.replace(/'/g, "''")}'`
        : '';

    const sql = `
      SELECT change_date AS date, change_type AS event_type, medication_name, rxnorm_code,
             COALESCE(previous_value || ' → ' || new_value, new_value, previous_value, change_type) AS details,
             source_document_id
      FROM medication_changes
      WHERE patient_id = ?${medFilter}

      UNION ALL

      SELECT start_date AS date, 'trial_outcome' AS event_type, medication AS medication_name, rxnorm_code,
             'Efficacy: ' || efficacy || COALESCE(' | Dosage: ' || dosage, '') || COALESCE(' | Reason discontinued: ' || reason_discontinued, '') AS details,
             source_document_id
      FROM clinical_treatment_trials
      WHERE patient_id = ?${trialMedFilter}

      UNION ALL

      SELECT observation_date AS date, 'adherence_observation' AS event_type, medication_name, rxnorm_code,
             adherence_code || COALESCE(' (' || reporter || ')', '') || COALESCE(': ' || notes, '') AS details,
             source_document_id
      FROM medication_adherence
      WHERE patient_id = ?${medFilter}

      ORDER BY date ASC NULLS LAST
    `;

    const result = await this.client.execute({
      sql,
      args: [params.patientId, params.patientId, params.patientId],
    });

    return result.rows.map((row) => ({
      date: row['date'] ? String(row['date']) : null,
      eventType: String(row['event_type']),
      medicationName: String(row['medication_name']),
      rxnormCode: row['rxnorm_code'] ? String(row['rxnorm_code']) : undefined,
      details: String(row['details']),
      sourceDocumentId: row['source_document_id'] ? String(row['source_document_id']) : undefined,
    }));
  }

  // ─── Contradictions ───────────────────────────────────────────────────

  async addContradiction(contradiction: Contradiction): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_contradictions
                (id, patient_id, finding1, finding1_date, finding1_method,
                 finding2, finding2_date, finding2_method,
                 resolution_status, resolution_plan, diagnostic_impact,
                 evidence_tier, validation_status, source_credibility, source,
                 source_document_id, fhir_resource_type, fhir_status, document_category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        contradiction.id,
        contradiction.patientId,
        contradiction.finding1,
        contradiction.finding1Date ?? null,
        contradiction.finding1Method ?? null,
        contradiction.finding2,
        contradiction.finding2Date ?? null,
        contradiction.finding2Method ?? null,
        contradiction.resolutionStatus,
        contradiction.resolutionPlan ?? null,
        contradiction.diagnosticImpact ?? null,
        contradiction.evidenceTier ?? null,
        contradiction.validationStatus ?? null,
        contradiction.sourceCredibility ?? null,
        contradiction.source ?? null,
        contradiction.sourceDocumentId ?? null,
        contradiction.fhirResourceType ?? null,
        contradiction.fhirStatus ?? null,
        contradiction.documentCategory ?? null,
      ],
    });
  }

  async queryContradictions(params: {
    patientId: string;
    status?: string;
  }): Promise<Contradiction[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.status) {
      conditions.push('resolution_status = ?');
      args.push(params.status);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_contradictions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      finding1: String(row['finding1']),
      finding1Date: row['finding1_date'] ? String(row['finding1_date']) : undefined,
      finding1Method: row['finding1_method'] ? String(row['finding1_method']) : undefined,
      finding2: String(row['finding2']),
      finding2Date: row['finding2_date'] ? String(row['finding2_date']) : undefined,
      finding2Method: row['finding2_method'] ? String(row['finding2_method']) : undefined,
      resolutionStatus: String(row['resolution_status']) as Contradiction['resolutionStatus'],
      resolutionPlan: row['resolution_plan'] ? String(row['resolution_plan']) : undefined,
      diagnosticImpact: row['diagnostic_impact'] ? String(row['diagnostic_impact']) : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));
  }

  /** Check if a contradiction with the same (patientId, finding1, finding2) exists. */
  async findContradiction(
    patientId: string,
    finding1: string,
    finding2: string,
  ): Promise<string | null> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT id FROM clinical_contradictions
            WHERE patient_id = ? AND finding1 = ? AND finding2 = ?
            LIMIT 1`,
      args: [patientId, finding1, finding2],
    });
    return result.rows.length > 0 ? String(result.rows[0]?.['id']) : null;
  }

  // ─── Patient Reports (PROs) ───────────────────────────────────────────

  async addPatientReport(report: PatientReport): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_patient_reports
                (id, patient_id, date, type, content, severity, extracted_insights,
                 evidence_tier, validation_status, source_credibility, source,
                 source_document_id, fhir_resource_type, fhir_status, document_category, extraction_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        report.id,
        report.patientId,
        report.date,
        report.type,
        report.content,
        report.severity ?? null,
        report.extractedInsights ? JSON.stringify(report.extractedInsights) : null,
        report.evidenceTier ?? null,
        report.validationStatus ?? null,
        report.sourceCredibility ?? null,
        report.source ?? null,
        report.sourceDocumentId ?? null,
        report.fhirResourceType ?? null,
        report.fhirStatus ?? null,
        report.documentCategory ?? null,
        report.extractionConfidence ?? null,
      ],
    });
  }

  async queryPatientReports(params: {
    patientId: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PatientReport[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.type) {
      conditions.push('type = ?');
      args.push(params.type);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_patient_reports WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      date: String(row['date']),
      type: String(row['type']) as PatientReport['type'],
      content: String(row['content']),
      severity: row['severity'] !== null ? Number(row['severity']) : undefined,
      extractedInsights: row['extracted_insights']
        ? (JSON.parse(String(row['extracted_insights'])) as string[])
        : undefined,
      source: row['source'] ? String(row['source']) : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));
  }

  /** Check if a patient report with the same (patientId, type, content) exists. */
  async findPatientReport(
    patientId: string,
    type: string,
    content: string,
  ): Promise<string | null> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT id FROM clinical_patient_reports
            WHERE patient_id = ? AND type = ? AND content = ?
            LIMIT 1`,
      args: [patientId, type, content],
    });
    return result.rows.length > 0 ? String(result.rows[0]?.['id']) : null;
  }

  // ─── Agent Learnings ──────────────────────────────────────────────────

  async addAgentLearning(learning: AgentLearning): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_agent_learnings
                (id, patient_id, date, category, content, confidence, related_hypotheses,
                 evidence_tier, validation_status, source_credibility, source,
                 source_document_id, fhir_resource_type, fhir_status, document_category)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        learning.id,
        learning.patientId,
        learning.date,
        learning.category,
        learning.content,
        learning.confidence ?? null,
        learning.relatedHypotheses ? JSON.stringify(learning.relatedHypotheses) : null,
        learning.evidenceTier ?? null,
        learning.validationStatus ?? null,
        learning.sourceCredibility ?? null,
        learning.source ?? null,
        learning.sourceDocumentId ?? null,
        learning.fhirResourceType ?? null,
        learning.fhirStatus ?? null,
        learning.documentCategory ?? null,
      ],
    });
  }

  async queryLearnings(params: { patientId: string; category?: string }): Promise<AgentLearning[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.category) {
      conditions.push('category = ?');
      args.push(params.category);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_agent_learnings WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      date: String(row['date']),
      category: String(row['category']) as AgentLearning['category'],
      content: String(row['content']),
      confidence: row['confidence'] !== null ? Number(row['confidence']) : undefined,
      relatedHypotheses: row['related_hypotheses']
        ? (JSON.parse(String(row['related_hypotheses'])) as string[])
        : undefined,
      ...mapProvenance(row as Record<string, unknown>),
      ...mapFhirMetadata(row as Record<string, unknown>),
    }));
  }

  /** Check if an agent learning with the same (patientId, category, content) exists. */
  async findAgentLearning(
    patientId: string,
    category: string,
    content: string,
  ): Promise<string | null> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT id FROM clinical_agent_learnings
            WHERE patient_id = ? AND category = ? AND content = ?
            LIMIT 1`,
      args: [patientId, category, content],
    });
    return result.rows.length > 0 ? String(result.rows[0]?.['id']) : null;
  }

  // ─── Imaging Reports ───────────────────────────────────────────────────

  async addImagingReport(report: ImagingReport): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_imaging_reports
                (id, patient_id, modality, body_region, date, facility, physician,
                 technique, findings, impression, comparison, source,
                 evidence_tier, validation_status, source_credibility,
                 source_document_id, fhir_resource_type, fhir_status, document_category,
                 diagnostic_service_section, loinc_study_code, body_site_snomed_code, extraction_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        report.id,
        report.patientId,
        report.modality,
        report.bodyRegion,
        report.date,
        report.facility ?? null,
        report.physician ?? null,
        report.technique ?? null,
        report.findings ?? null,
        report.impression ?? null,
        report.comparison ?? null,
        report.source ?? null,
        report.evidenceTier ?? null,
        report.validationStatus ?? null,
        report.sourceCredibility ?? null,
        report.sourceDocumentId ?? null,
        report.fhirResourceType ?? null,
        report.fhirStatus ?? null,
        report.documentCategory ?? null,
        report.diagnosticServiceSection ?? null,
        report.loincStudyCode ?? null,
        report.bodySiteSnomedCode ?? null,
        report.extractionConfidence ?? null,
      ],
    });
  }

  async getImagingReports(
    patientId: string,
    filters?: { modality?: string; bodyRegion?: string },
  ): Promise<ImagingReport[]> {
    await this.ensureInitialized();
    let sql = 'SELECT * FROM clinical_imaging_reports WHERE patient_id = ?';
    const args: InValue[] = [patientId];

    if (filters?.modality) {
      sql += ' AND modality = ?';
      args.push(filters.modality);
    }
    if (filters?.bodyRegion) {
      sql += ' AND body_region = ?';
      args.push(filters.bodyRegion);
    }
    sql += ' ORDER BY date DESC';

    const result = await this.client.execute({ sql, args });
    return result.rows.map((r) => mapRowToImagingReport(r as Record<string, unknown>));
  }

  // ─── Abdominal Reports ────────────────────────────────────────────────

  async addAbdominalReport(report: AbdominalReport): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_abdominal_reports
                (id, patient_id, procedure_type, date, facility, physician,
                 findings, conclusions, source,
                 evidence_tier, validation_status, source_credibility,
                 source_document_id, fhir_resource_type, fhir_status, document_category,
                 loinc_procedure_code, extraction_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        report.id,
        report.patientId,
        report.procedureType,
        report.date,
        report.facility ?? null,
        report.physician ?? null,
        report.findings ?? null,
        report.conclusions ?? null,
        report.source ?? null,
        report.evidenceTier ?? null,
        report.validationStatus ?? null,
        report.sourceCredibility ?? null,
        report.sourceDocumentId ?? null,
        report.fhirResourceType ?? null,
        report.fhirStatus ?? null,
        report.documentCategory ?? null,
        report.loincProcedureCode ?? null,
        report.extractionConfidence ?? null,
      ],
    });
  }

  async getAbdominalReports(patientId: string): Promise<AbdominalReport[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT * FROM clinical_abdominal_reports WHERE patient_id = ? ORDER BY date DESC',
      args: [patientId],
    });
    return result.rows.map((r) => mapRowToAbdominalReport(r as Record<string, unknown>));
  }

  // ─── Research Findings ──────────────────────────────────────────────────

  /**
   * Add a research finding with three-layer dedup:
   * 1. If external_id + external_id_type match an existing record for this patient → skip (return existing ID)
   * 2. If no external_id, compute content_hash(source + title + date) → skip if hash matches
   * 3. Otherwise insert as new record
   *
   * Returns the ID of the inserted or existing record, and whether it was a duplicate.
   */
  async addResearchFinding(finding: ResearchFinding): Promise<{ id: string; duplicate: boolean }> {
    await this.ensureInitialized();

    // Layer 1: Dedup by external ID (PMID, NCT, ORPHA, OMIM, etc.)
    if (finding.externalId && finding.externalIdType) {
      const existing = await this.client.execute({
        sql: `SELECT id FROM research_findings WHERE patient_id = ? AND external_id = ? AND external_id_type = ?`,
        args: [finding.patientId, finding.externalId, finding.externalIdType],
      });
      const existingRow = existing.rows[0];
      if (existingRow) {
        logger.debug('Research finding dedup: external ID match', {
          externalId: finding.externalId,
          existingId: String(existingRow['id']),
        });
        return { id: String(existingRow['id']), duplicate: true };
      }
    }

    // Layer 2: Dedup by content hash (for findings without external IDs)
    const hash = computeFindingHash(finding);
    if (!finding.externalId) {
      const existing = await this.client.execute({
        sql: `SELECT id FROM research_findings WHERE patient_id = ? AND content_hash = ? AND external_id IS NULL`,
        args: [finding.patientId, hash],
      });
      const existingRow = existing.rows[0];
      if (existingRow) {
        logger.debug('Research finding dedup: content hash match', {
          hash,
          existingId: String(existingRow['id']),
        });
        return { id: String(existingRow['id']), duplicate: true };
      }
    }

    // Layer 3: Insert new record
    await this.client.execute(this.findingStatement(finding, hash));
    return { id: finding.id, duplicate: false };
  }

  async addResearchFindings(
    findings: ResearchFinding[],
  ): Promise<{ inserted: number; duplicates: number }> {
    await this.ensureInitialized();
    if (findings.length === 0) return { inserted: 0, duplicates: 0 };

    let inserted = 0;
    let duplicates = 0;

    for (const f of findings) {
      const result = await this.addResearchFinding(f);
      if (result.duplicate) {
        duplicates++;
      } else {
        inserted++;
      }
    }

    return { inserted, duplicates };
  }

  /**
   * Check if a research finding already exists by external ID or content hash.
   * Useful for pre-flight dedup checks before constructing expensive objects.
   */
  async findingExists(
    patientId: string,
    params: {
      externalId?: string;
      externalIdType?: string;
      source?: string;
      title?: string;
      date?: string;
    },
  ): Promise<{ exists: boolean; existingId?: string }> {
    await this.ensureInitialized();

    // Check by external ID first
    if (params.externalId && params.externalIdType) {
      const existing = await this.client.execute({
        sql: `SELECT id FROM research_findings WHERE patient_id = ? AND external_id = ? AND external_id_type = ?`,
        args: [patientId, params.externalId, params.externalIdType],
      });
      const row = existing.rows[0];
      if (row) {
        return { exists: true, existingId: String(row['id']) };
      }
    }

    // Check by content hash
    if (params.source && params.title && params.date) {
      const hash = computeFindingHash({
        source: params.source,
        title: params.title,
        date: params.date,
      });
      const existing = await this.client.execute({
        sql: `SELECT id FROM research_findings WHERE patient_id = ? AND content_hash = ? AND external_id IS NULL`,
        args: [patientId, hash],
      });
      const row = existing.rows[0];
      if (row) {
        return { exists: true, existingId: String(row['id']) };
      }
    }

    return { exists: false };
  }

  /**
   * Check if recent findings already cover a set of query terms.
   * Returns which terms are covered and what percentage of the query is already researched.
   */
  async getRecentFindingsForQuery(params: {
    patientId: string;
    queryTerms: string[];
    maxAgeDays?: number;
  }): Promise<{ coveredTerms: string[]; findings: ResearchFinding[]; coveragePercent: number }> {
    await this.ensureInitialized();
    const maxAge = params.maxAgeDays ?? 30;
    const cutoffDate = new Date(Date.now() - maxAge * 86_400_000).toISOString().split('T')[0] ?? '';

    const result = await this.client.execute({
      sql: `SELECT * FROM research_findings WHERE patient_id = ? AND date >= ? ORDER BY date DESC`,
      args: [params.patientId, cutoffDate],
    });

    const findings = result.rows.map(mapRowToFinding);

    // Check which query terms are covered by existing findings
    const coveredTerms: string[] = [];
    const normalizedTerms = params.queryTerms.map((t) => t.toLowerCase());

    for (const term of normalizedTerms) {
      const isCovered = findings.some(
        (f) =>
          f.title.toLowerCase().includes(term) ||
          f.summary.toLowerCase().includes(term) ||
          (f.rawData?.toLowerCase().includes(term) ?? false),
      );
      if (isCovered) coveredTerms.push(term);
    }

    const coveragePercent =
      normalizedTerms.length > 0 ? (coveredTerms.length / normalizedTerms.length) * 100 : 0;

    return { coveredTerms, findings, coveragePercent };
  }

  private findingStatement(f: ResearchFinding, hash?: string) {
    const contentHash = hash ?? computeFindingHash(f);
    return {
      sql: `INSERT OR REPLACE INTO research_findings
                (id, patient_id, source, source_tool, external_id, external_id_type,
                 title, summary, url, relevance, evidence_level, research_query_id,
                 date, raw_data, evidence_tier, validation_status, source_credibility, content_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        f.id,
        f.patientId,
        f.source,
        f.sourceTool ?? null,
        f.externalId ?? null,
        f.externalIdType ?? null,
        f.title,
        f.summary,
        f.url ?? null,
        f.relevance ?? null,
        f.evidenceLevel ?? null,
        f.researchQueryId ?? null,
        f.date,
        f.rawData ?? null,
        f.evidenceTier ?? null,
        f.validationStatus ?? null,
        f.sourceCredibility ?? null,
        contentHash,
      ],
    };
  }

  async queryFindings(params: {
    patientId: string;
    source?: string;
    externalIdType?: string;
    evidenceLevel?: string;
    dateFrom?: string;
    dateTo?: string;
    queryId?: string;
  }): Promise<ResearchFinding[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | number | null)[] = [params.patientId];

    if (params.source) {
      conditions.push('source = ?');
      args.push(params.source);
    }
    if (params.externalIdType) {
      conditions.push('external_id_type = ?');
      args.push(params.externalIdType);
    }
    if (params.evidenceLevel) {
      conditions.push('evidence_level = ?');
      args.push(params.evidenceLevel);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }
    if (params.queryId) {
      conditions.push('research_query_id = ?');
      args.push(params.queryId);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM research_findings WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map(mapRowToFinding);
  }

  // ─── Research Queries ──────────────────────────────────────────────────

  async addResearchQuery(query: ResearchQuery): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO research_queries
                (id, patient_id, query, tool_used, agent, result_count, finding_ids,
                 synthesis, gaps, suggested_follow_up, stage, date, duration_ms,
                 evidence_tier, validation_status, source_credibility)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        query.id,
        query.patientId,
        query.query,
        query.toolUsed,
        query.agent ?? null,
        query.resultCount ?? 0,
        query.findingIds ? JSON.stringify(query.findingIds) : null,
        query.synthesis ?? null,
        query.gaps ? JSON.stringify(query.gaps) : null,
        query.suggestedFollowUp ? JSON.stringify(query.suggestedFollowUp) : null,
        query.stage ?? null,
        query.date,
        query.durationMs ?? null,
        query.evidenceTier ?? null,
        query.validationStatus ?? null,
        query.sourceCredibility ?? null,
      ],
    });
  }

  async queryResearchQueries(params: {
    patientId: string;
    toolUsed?: string;
    agent?: string;
    stage?: number;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<ResearchQuery[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | number | null)[] = [params.patientId];

    if (params.toolUsed) {
      conditions.push('tool_used = ?');
      args.push(params.toolUsed);
    }
    if (params.agent) {
      conditions.push('agent = ?');
      args.push(params.agent);
    }
    if (params.stage !== undefined) {
      conditions.push('stage = ?');
      args.push(params.stage);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM research_queries WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map(mapRowToResearchQuery);
  }

  // ─── Research Hypotheses ───────────────────────────────────────────────

  /**
   * Add a hypothesis with dedup:
   * - If same patient + name + version already exists → skip (return existing ID)
   * - If version > 1, supersede the previous version
   */
  async addHypothesis(hypothesis: ResearchHypothesis): Promise<{ id: string; duplicate: boolean }> {
    await this.ensureInitialized();

    // Dedup: check if same patient + name + version already exists
    const version = hypothesis.version ?? 1;
    const dupCheck = await this.client.execute({
      sql: `SELECT id FROM research_hypotheses WHERE patient_id = ? AND name = ? AND version = ?`,
      args: [hypothesis.patientId, hypothesis.name, version],
    });
    const dupRow = dupCheck.rows[0];
    if (dupRow) {
      logger.debug('Hypothesis dedup: same name+version exists', {
        name: hypothesis.name,
        version,
        existingId: String(dupRow['id']),
      });
      return { id: String(dupRow['id']), duplicate: true };
    }

    // If a hypothesis with the same name exists, supersede it
    if (version > 1) {
      const existing = await this.client.execute({
        sql: `SELECT id FROM research_hypotheses
                    WHERE patient_id = ? AND name = ? AND superseded_by IS NULL
                    ORDER BY version DESC LIMIT 1`,
        args: [hypothesis.patientId, hypothesis.name],
      });

      const prevRow = existing.rows[0];
      if (prevRow) {
        await this.client.execute({
          sql: `UPDATE research_hypotheses SET superseded_by = ? WHERE id = ?`,
          args: [hypothesis.id, String(prevRow['id'])],
        });
      }
    }

    await this.client.execute({
      sql: `INSERT OR REPLACE INTO research_hypotheses
                (id, patient_id, name, icd_code, probability_low, probability_high,
                 advocate_case, skeptic_case, arbiter_verdict,
                 evidence_tier, certainty_level, stage, version, superseded_by, date,
                 validation_status, source_credibility)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        hypothesis.id,
        hypothesis.patientId,
        hypothesis.name,
        hypothesis.icdCode ?? null,
        hypothesis.probabilityLow ?? null,
        hypothesis.probabilityHigh ?? null,
        hypothesis.advocateCase ?? null,
        hypothesis.skepticCase ?? null,
        hypothesis.arbiterVerdict ?? null,
        hypothesis.evidenceTier ?? null,
        hypothesis.certaintyLevel ?? null,
        hypothesis.stage ?? null,
        hypothesis.version ?? 1,
        hypothesis.supersededBy ?? null,
        hypothesis.date,
        hypothesis.validationStatus ?? null,
        hypothesis.sourceCredibility ?? null,
      ],
    });
    return { id: hypothesis.id, duplicate: false };
  }

  async queryHypotheses(params: {
    patientId: string;
    name?: string;
    certaintyLevel?: string;
    latestOnly?: boolean;
  }): Promise<ResearchHypothesis[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | number | null)[] = [params.patientId];

    if (params.name) {
      conditions.push('name LIKE ?');
      args.push(`%${params.name}%`);
    }
    if (params.certaintyLevel) {
      conditions.push('certainty_level = ?');
      args.push(params.certaintyLevel);
    }
    if (params.latestOnly !== false) {
      // Default: only return latest (non-superseded) versions
      conditions.push('superseded_by IS NULL');
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM research_hypotheses WHERE ${conditions.join(' AND ')} ORDER BY probability_high DESC, date DESC`,
      args,
    });

    return result.rows.map(mapRowToHypothesis);
  }

  // ─── Hypothesis Timeline ─────────────────────────────────────────────

  /**
   * Get full version chain for a hypothesis — every version with its probability
   * snapshot, triggering evidence, and date — enabling "How did our thinking evolve?"
   */
  async getHypothesisTimeline(params: { patientId: string; name: string }): Promise<{
    name: string;
    versions: Array<ResearchHypothesis & { evidenceLinks: HypothesisEvidenceLink[] }>;
    confidenceTrajectory: Array<{
      version: number;
      date: string;
      probabilityLow: number;
      probabilityHigh: number;
      certaintyLevel: string;
    }>;
    directionChanges: number;
  }> {
    await this.ensureInitialized();

    // Fetch ALL versions (not just latest) ordered by version ASC
    const result = await this.client.execute({
      sql: `SELECT * FROM research_hypotheses WHERE patient_id = ? AND name = ? ORDER BY version ASC`,
      args: [params.patientId, params.name],
    });

    const hypotheses = result.rows.map(mapRowToHypothesis);

    // For each version, fetch evidence links
    const versions = await Promise.all(
      hypotheses.map(async (h) => {
        const links = await this.queryEvidenceLinks({ hypothesisId: h.id });
        return { ...h, evidenceLinks: links };
      }),
    );

    // Build confidence trajectory
    const confidenceTrajectory = hypotheses.map((h) => ({
      version: h.version ?? 1,
      date: h.date,
      probabilityLow: h.probabilityLow ?? 0,
      probabilityHigh: h.probabilityHigh ?? 0,
      certaintyLevel: h.certaintyLevel ?? 'SPECULATIVE',
    }));

    // Count direction changes (probability midpoint reversals)
    let directionChanges = 0;
    for (let i = 2; i < confidenceTrajectory.length; i++) {
      const prev = confidenceTrajectory[i - 1];
      const curr = confidenceTrajectory[i];
      const prevPrev = confidenceTrajectory[i - 2];
      if (!(prev && curr && prevPrev)) continue;
      const prevMid = (prev.probabilityLow + prev.probabilityHigh) / 2;
      const currMid = (curr.probabilityLow + curr.probabilityHigh) / 2;
      const prevPrevMid = (prevPrev.probabilityLow + prevPrev.probabilityHigh) / 2;
      const prevDirection = prevMid - prevPrevMid;
      const currDirection = currMid - prevMid;
      if (prevDirection * currDirection < 0) directionChanges++;
    }

    return {
      name: params.name,
      versions,
      confidenceTrajectory,
      directionChanges,
    };
  }

  // ─── Evidence Links ────────────────────────────────────────────────────

  /**
   * Add an evidence link with dedup:
   * Same hypothesis + finding/clinical record + direction = duplicate.
   */
  async addEvidenceLink(link: HypothesisEvidenceLink): Promise<{ id: string; duplicate: boolean }> {
    await this.ensureInitialized();

    // Dedup: check for existing link with same hypothesis + evidence + direction
    const evidenceColumn = link.findingId ? 'finding_id' : 'clinical_record_id';
    const evidenceValue = link.findingId ?? link.clinicalRecordId;

    if (evidenceValue) {
      const existing = await this.client.execute({
        sql: `SELECT id FROM hypothesis_evidence_links WHERE hypothesis_id = ? AND ${evidenceColumn} = ? AND direction = ?`,
        args: [link.hypothesisId, evidenceValue, link.direction],
      });
      const row = existing.rows[0];
      if (row) {
        logger.debug('Evidence link dedup: same hypothesis+evidence+direction', {
          hypothesisId: link.hypothesisId,
          evidenceValue,
          existingId: String(row['id']),
        });
        return { id: String(row['id']), duplicate: true };
      }
    }

    await this.client.execute({
      sql: `INSERT OR REPLACE INTO hypothesis_evidence_links
                (id, patient_id, hypothesis_id, finding_id, clinical_record_id, clinical_record_type,
                 direction, claim, confidence, tier, date, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        link.id,
        link.patientId,
        link.hypothesisId,
        link.findingId ?? null,
        link.clinicalRecordId ?? null,
        link.clinicalRecordType ?? null,
        link.direction,
        link.claim,
        link.confidence ?? null,
        link.tier ?? null,
        link.date,
        link.notes ?? null,
      ],
    });
    return { id: link.id, duplicate: false };
  }

  async queryEvidenceLinks(params: {
    hypothesisId?: string;
    findingId?: string;
    clinicalRecordId?: string;
    patientId?: string;
  }): Promise<HypothesisEvidenceLink[]> {
    await this.ensureInitialized();
    const conditions: string[] = [];
    const args: (string | number | null)[] = [];

    if (params.hypothesisId) {
      conditions.push('hypothesis_id = ?');
      args.push(params.hypothesisId);
    }
    if (params.findingId) {
      conditions.push('finding_id = ?');
      args.push(params.findingId);
    }
    if (params.clinicalRecordId) {
      conditions.push('clinical_record_id = ?');
      args.push(params.clinicalRecordId);
    }
    if (params.patientId) {
      conditions.push('patient_id = ?');
      args.push(params.patientId);
    }

    if (conditions.length === 0) {
      return [];
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM hypothesis_evidence_links WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map(mapRowToEvidenceLink);
  }

  async getHypothesisWithEvidence(
    hypothesisId: string,
  ): Promise<{ hypothesis: ResearchHypothesis; links: HypothesisEvidenceLink[] } | null> {
    await this.ensureInitialized();

    const hResult = await this.client.execute({
      sql: `SELECT * FROM research_hypotheses WHERE id = ?`,
      args: [hypothesisId],
    });

    const hRow = hResult.rows[0];
    if (!hRow) return null;

    const links = await this.queryEvidenceLinks({ hypothesisId });
    return { hypothesis: mapRowToHypothesis(hRow), links };
  }

  async getPatientResearchSummary(patientId: string): Promise<ResearchSummary> {
    await this.ensureInitialized();

    const [findings, queries, hypotheses, links] = await Promise.all([
      this.client.execute({
        sql: `SELECT COUNT(*) as cnt FROM research_findings WHERE patient_id = ?`,
        args: [patientId],
      }),
      this.client.execute({
        sql: `SELECT COUNT(*) as cnt FROM research_queries WHERE patient_id = ?`,
        args: [patientId],
      }),
      this.client.execute({
        sql: `SELECT COUNT(*) as cnt FROM research_hypotheses WHERE patient_id = ? AND superseded_by IS NULL`,
        args: [patientId],
      }),
      this.client.execute({
        sql: `SELECT COUNT(*) as cnt FROM hypothesis_evidence_links WHERE patient_id = ?`,
        args: [patientId],
      }),
    ]);

    // Top sources by finding count
    const sourceResult = await this.client.execute({
      sql: `SELECT source, COUNT(*) as cnt FROM research_findings WHERE patient_id = ? GROUP BY source ORDER BY cnt DESC LIMIT 10`,
      args: [patientId],
    });

    // Latest dates
    const latestDates = await Promise.all([
      this.client.execute({
        sql: `SELECT date FROM research_queries WHERE patient_id = ? ORDER BY date DESC LIMIT 1`,
        args: [patientId],
      }),
      this.client.execute({
        sql: `SELECT date FROM research_findings WHERE patient_id = ? ORDER BY date DESC LIMIT 1`,
        args: [patientId],
      }),
    ]);

    const latestQueryRow = latestDates[0]?.rows[0];
    const latestFindingRow = latestDates[1]?.rows[0];

    return {
      patientId,
      findingCount: Number(findings.rows[0]?.['cnt'] ?? 0),
      queryCount: Number(queries.rows[0]?.['cnt'] ?? 0),
      hypothesisCount: Number(hypotheses.rows[0]?.['cnt'] ?? 0),
      evidenceLinkCount: Number(links.rows[0]?.['cnt'] ?? 0),
      topSources: sourceResult.rows.map((row) => ({
        source: String(row['source']),
        count: Number(row['cnt']),
      })),
      latestQueryDate: latestQueryRow ? String(latestQueryRow['date']) : undefined,
      latestFindingDate: latestFindingRow ? String(latestFindingRow['date']) : undefined,
    };
  }

  // ─── Finding Validation Update ──────────────────────────────────────────

  /**
   * Update validation status and credibility for a research finding.
   * Used by citation-verifier to persist verification results.
   */
  async updateFindingValidation(
    findingId: string,
    status: string,
    credibility?: number,
  ): Promise<void> {
    await this.ensureInitialized();
    if (credibility !== undefined) {
      await this.client.execute({
        sql: `UPDATE research_findings SET validation_status = ?, source_credibility = ? WHERE id = ?`,
        args: [status, Math.round(credibility * 100), findingId],
      });
    } else {
      await this.client.execute({
        sql: `UPDATE research_findings SET validation_status = ? WHERE id = ?`,
        args: [status, findingId],
      });
    }
  }

  // ─── Brain Patterns ──────────────────────────────────────────────────

  async addBrainPattern(input: BrainPatternInput): Promise<{ id: string; merged: boolean }> {
    await this.ensureInitialized();

    // Check for existing similar pattern (same category + overlapping phenotype cluster)
    const existing = await this.findSimilarPattern(
      input.pattern,
      input.category,
      input.phenotypeCluster,
    );

    if (existing) {
      // Merge: increment supporting cases, update confidence, add case labels
      const mergedCaseLabels = [
        ...new Set([...existing.sourceCaseLabels, ...input.sourceCaseLabels]),
      ];
      const newSupportingCases = existing.supportingCases + input.supportingCases;
      const newConfidence = Math.min(1, existing.confidence + 0.1 * input.supportingCases);

      await this.client.execute({
        sql: `UPDATE brain_patterns SET
          supporting_cases = ?,
          confidence = ?,
          source_case_labels = ?,
          updated_at = datetime('now')
          WHERE id = ?`,
        args: [newSupportingCases, newConfidence, JSON.stringify(mergedCaseLabels), existing.id],
      });

      return { id: existing.id, merged: true };
    }

    // Insert new pattern
    const id = `bp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    await this.client.execute({
      sql: `INSERT INTO brain_patterns (id, pattern, category, phenotype_cluster, supporting_cases, confidence, related_diagnoses, related_genes, source_case_labels, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.pattern,
        input.category,
        JSON.stringify(input.phenotypeCluster),
        input.supportingCases,
        input.confidence,
        input.relatedDiagnoses ? JSON.stringify(input.relatedDiagnoses) : null,
        input.relatedGenes ? JSON.stringify(input.relatedGenes) : null,
        JSON.stringify(input.sourceCaseLabels),
        now,
        now,
      ],
    });

    return { id, merged: false };
  }

  private async findSimilarPattern(
    _pattern: string,
    category: string,
    phenotypeCluster: string[],
  ): Promise<BrainPattern | null> {
    await this.ensureInitialized();

    // Find patterns with same category
    const result = await this.client.execute({
      sql: `SELECT * FROM brain_patterns WHERE category = ? ORDER BY confidence DESC`,
      args: [category],
    });

    // Check for phenotype cluster overlap (Jaccard similarity > 0.5)
    for (const row of result.rows) {
      const existing = mapRowToBrainPattern(row as Record<string, unknown>);
      const existingSet = new Set(existing.phenotypeCluster);
      const inputSet = new Set(phenotypeCluster);
      const intersection = [...inputSet].filter((t) => existingSet.has(t)).length;
      const union = new Set([...existingSet, ...inputSet]).size;

      if (union > 0 && intersection / union > 0.5) {
        return existing;
      }
    }

    return null;
  }

  async queryBrainPatterns(query: BrainPatternQuery): Promise<BrainPattern[]> {
    await this.ensureInitialized();

    const conditions: string[] = [];
    const args: (string | number | null)[] = [];

    if (query.category) {
      conditions.push('category = ?');
      args.push(query.category);
    }
    if (query.minConfidence !== undefined) {
      conditions.push('confidence >= ?');
      args.push(query.minConfidence);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ?? 20;

    const result = await this.client.execute({
      sql: `SELECT * FROM brain_patterns ${whereClause} ORDER BY confidence DESC, supporting_cases DESC LIMIT ?`,
      args: [...args, limit],
    });

    let patterns = result.rows.map((row) => mapRowToBrainPattern(row as Record<string, unknown>));

    // Filter by symptom/HPO term overlap if provided
    const queryTerms = [...(query.symptoms ?? []), ...(query.hpoTerms ?? [])];
    if (queryTerms.length > 0) {
      const querySet = new Set(queryTerms.map((t) => t.toLowerCase()));
      patterns = patterns
        .map((p) => {
          const clusterSet = new Set(p.phenotypeCluster.map((t) => t.toLowerCase()));
          const overlap = [...querySet].filter((t) => clusterSet.has(t)).length;
          return { pattern: p, overlap };
        })
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap)
        .map((x) => x.pattern);
    }

    return patterns;
  }

  async getBrainPatternCount(): Promise<number> {
    await this.ensureInitialized();
    const result = await this.client.execute('SELECT COUNT(*) as cnt FROM brain_patterns');
    const row = result.rows[0];
    return Number(row?.['cnt'] ?? 0);
  }

  async getBrainCaseCount(): Promise<number> {
    await this.ensureInitialized();
    const result = await this.client.execute('SELECT source_case_labels FROM brain_patterns');
    const allLabels = new Set<string>();
    for (const row of result.rows) {
      const labels = JSON.parse(String(row['source_case_labels'] ?? '[]')) as string[];
      for (const label of labels) {
        allLabels.add(label);
      }
    }
    return allLabels.size;
  }

  // ─── Genetic Variants ────────────────────────────────────────────────

  async addGeneticVariant(variant: GeneticVariant): Promise<{ id: string; duplicate: boolean }> {
    await this.ensureInitialized();
    try {
      await this.client.execute({
        sql: `INSERT INTO genetic_variants
              (id, patient_id, rsid, chromosome, position, genotype, source, source_version, reference_genome, import_date, raw_line,
               vrs_digest, vrs_allele_id, genomic_source_class, allelic_state, coding_change_type,
               clinical_significance, clinvar_id, clinvar_last_evaluated, review_status, gene_symbol, conditions, molecular_consequence,
               pharmgkb_level, star_allele, global_minor_allele_freq,
               source_document_id, evidence_tier, validation_status, source_credibility, fhir_resource_type, fhir_status, document_category)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?,
                      ?, ?, ?, ?, ?, ?, ?,
                      ?, ?, ?,
                      ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          variant.id,
          variant.patientId,
          variant.rsid,
          variant.chromosome,
          variant.position,
          variant.genotype,
          variant.source,
          variant.sourceVersion ?? null,
          variant.referenceGenome,
          variant.importDate,
          variant.rawLine ?? null,
          // GA4GH VRS 2.0
          variant.vrsDigest ?? null,
          variant.vrsAlleleId ?? null,
          // FHIR Genomics Reporting IG
          variant.genomicSourceClass ?? null,
          variant.allelicState ?? null,
          variant.codingChangeType ?? null,
          // ClinVar/ACMG
          variant.clinicalSignificance ?? null,
          variant.clinvarId ?? null,
          variant.clinvarLastEvaluated ?? null,
          variant.reviewStatus ?? null,
          variant.geneSymbol ?? null,
          variant.conditions ?? null,
          variant.molecularConsequence ?? null,
          // Pharmacogenomics
          variant.pharmgkbLevel ?? null,
          variant.starAllele ?? null,
          // Population frequency
          variant.globalMinorAlleleFreq ?? null,
          // Provenance + FHIR
          variant.sourceDocumentId ?? null,
          variant.evidenceTier ?? null,
          variant.validationStatus ?? null,
          variant.sourceCredibility ?? null,
          variant.fhirResourceType ?? null,
          variant.fhirStatus ?? null,
          variant.documentCategory ?? null,
        ],
      });
      return { id: variant.id, duplicate: false };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
        return { id: variant.id, duplicate: true };
      }
      throw err;
    }
  }

  async addGeneticVariantsBatch(
    variants: GeneticVariant[],
  ): Promise<{ inserted: number; duplicates: number }> {
    await this.ensureInitialized();
    if (variants.length === 0) return { inserted: 0, duplicates: 0 };

    const stmts = variants.map((v) => ({
      sql: `INSERT OR IGNORE INTO genetic_variants
            (id, patient_id, rsid, chromosome, position, genotype, source, source_version, reference_genome, import_date, raw_line,
             vrs_digest, vrs_allele_id, genomic_source_class, allelic_state, coding_change_type,
             clinical_significance, clinvar_id, clinvar_last_evaluated, review_status, gene_symbol, conditions, molecular_consequence,
             pharmgkb_level, star_allele, global_minor_allele_freq,
             source_document_id, evidence_tier, validation_status, source_credibility, fhir_resource_type, fhir_status, document_category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        v.id,
        v.patientId,
        v.rsid,
        v.chromosome,
        v.position,
        v.genotype,
        v.source,
        v.sourceVersion ?? null,
        v.referenceGenome,
        v.importDate,
        v.rawLine ?? null,
        // GA4GH VRS 2.0
        v.vrsDigest ?? null,
        v.vrsAlleleId ?? null,
        // FHIR Genomics Reporting IG
        v.genomicSourceClass ?? null,
        v.allelicState ?? null,
        v.codingChangeType ?? null,
        // ClinVar/ACMG
        v.clinicalSignificance ?? null,
        v.clinvarId ?? null,
        v.clinvarLastEvaluated ?? null,
        v.reviewStatus ?? null,
        v.geneSymbol ?? null,
        v.conditions ?? null,
        v.molecularConsequence ?? null,
        // Pharmacogenomics
        v.pharmgkbLevel ?? null,
        v.starAllele ?? null,
        // Population frequency
        v.globalMinorAlleleFreq ?? null,
        // Provenance + FHIR
        v.sourceDocumentId ?? null,
        v.evidenceTier ?? null,
        v.validationStatus ?? null,
        v.sourceCredibility ?? null,
        v.fhirResourceType ?? null,
        v.fhirStatus ?? null,
        v.documentCategory ?? null,
      ] as InValue[],
    }));

    const results = await this.client.batch(stmts, 'write');
    let inserted = 0;
    for (const r of results) {
      if (r.rowsAffected > 0) inserted++;
    }
    return { inserted, duplicates: variants.length - inserted };
  }

  async queryGeneticVariants(params: GeneticVariantQuery): Promise<GeneticVariant[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: InValue[] = [params.patientId];

    if (params.chromosome) {
      conditions.push('chromosome = ?');
      args.push(params.chromosome);
    }
    if (params.rsid) {
      conditions.push('rsid = ?');
      args.push(params.rsid);
    }
    if (params.rsids && params.rsids.length > 0) {
      const placeholders = params.rsids.map(() => '?').join(', ');
      conditions.push(`rsid IN (${placeholders})`);
      for (const r of params.rsids) args.push(r);
    }
    if (params.positionFrom !== undefined) {
      conditions.push('position >= ?');
      args.push(params.positionFrom);
    }
    if (params.positionTo !== undefined) {
      conditions.push('position <= ?');
      args.push(params.positionTo);
    }
    if (params.genotype) {
      conditions.push('genotype = ?');
      args.push(params.genotype);
    }
    if (params.excludeNoCalls) {
      conditions.push("genotype != '--'");
    }
    // Annotation filters (SOTA genomic queries)
    if (params.clinicalSignificance) {
      conditions.push('clinical_significance = ?');
      args.push(params.clinicalSignificance);
    }
    if (params.geneSymbol) {
      conditions.push('gene_symbol = ?');
      args.push(params.geneSymbol);
    }
    if (params.hasAnnotation) {
      conditions.push('(clinical_significance IS NOT NULL OR gene_symbol IS NOT NULL OR clinvar_id IS NOT NULL)');
    }
    if (params.pharmgkbLevel) {
      conditions.push('pharmgkb_level = ?');
      args.push(params.pharmgkbLevel);
    }

    const limit = params.limit ?? 100;
    const offset = params.offset ?? 0;

    const result = await this.client.execute({
      sql: `SELECT * FROM genetic_variants WHERE ${conditions.join(' AND ')} ORDER BY chromosome, position LIMIT ? OFFSET ?`,
      args: [...args, limit, offset],
    });

    return result.rows.map((row) => mapRowToGeneticVariant(row as Record<string, unknown>));
  }

  async countGeneticVariants(patientId: string): Promise<number> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT COUNT(*) as cnt FROM genetic_variants WHERE patient_id = ?',
      args: [patientId],
    });
    const row = result.rows[0];
    return row ? Number(row['cnt']) : 0;
  }

  async getVariantByRsid(patientId: string, rsid: string): Promise<GeneticVariant | undefined> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT * FROM genetic_variants WHERE patient_id = ? AND rsid = ?',
      args: [patientId, rsid],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return mapRowToGeneticVariant(row as Record<string, unknown>);
  }

  /**
   * Query pharmacogenomically relevant variants (PharmGKB/CPIC-annotated).
   * Returns variants with non-null pharmgkb_level or star_allele.
   */
  async queryPharmacogenomicVariants(patientId: string): Promise<GeneticVariant[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM genetic_variants
            WHERE patient_id = ? AND (pharmgkb_level IS NOT NULL OR star_allele IS NOT NULL)
            ORDER BY gene_symbol, rsid`,
      args: [patientId],
    });
    return result.rows.map((row) => mapRowToGeneticVariant(row as Record<string, unknown>));
  }

  /**
   * Batch-update ClinVar annotation fields on genetic variants.
   * Used by the L2 ClinVar annotation pipeline.
   */
  async updateVariantClinvarBatch(
    updates: Array<{
      id: string;
      clinicalSignificance: string;
      clinvarId: string;
      reviewStatus: string;
      geneSymbol: string | null;
      conditions: string | null;
      molecularConsequence: string | null;
    }>,
  ): Promise<number> {
    await this.ensureInitialized();
    if (updates.length === 0) return 0;

    const CHUNK = 500;
    let totalUpdated = 0;

    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const stmts = chunk.map((u) => ({
        sql: `UPDATE genetic_variants SET
                clinical_significance = ?,
                clinvar_id = ?,
                clinvar_last_evaluated = datetime('now'),
                review_status = ?,
                gene_symbol = COALESCE(gene_symbol, ?),
                conditions = ?,
                molecular_consequence = ?
              WHERE id = ?`,
        args: [
          u.clinicalSignificance,
          u.clinvarId,
          u.reviewStatus,
          u.geneSymbol,
          u.conditions,
          u.molecularConsequence,
          u.id,
        ] as InValue[],
      }));
      const results = await this.client.batch(stmts, 'write');
      for (const r of results) {
        if (r.rowsAffected > 0) totalUpdated++;
      }
    }

    return totalUpdated;
  }

  // ─── Layer 0: Source Documents ────────────────────────────────────────

  async addSourceDocument(doc: SourceDocument): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO source_documents (
              id, patient_id, original_filename, original_file_hash, original_file_size_bytes,
              original_page_count, mime_type, extraction_method, extraction_confidence,
              extraction_date, extraction_tool, extraction_wave, extracted_markdown_path,
              pre_processing, post_processing, pipeline_version, content_hash, category, subcategory,
              date, facility, physician, language, tags,
              fhir_resource_type, loinc_doc_code, diagnostic_service_section,
              evidence_tier, validation_status, source_credibility
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        doc.id,
        doc.patientId,
        doc.originalFilename,
        doc.originalFileHash,
        doc.originalFileSizeBytes,
        doc.originalPageCount ?? null,
        doc.mimeType ?? null,
        doc.extractionMethod,
        doc.extractionConfidence,
        doc.extractionDate,
        doc.extractionTool,
        doc.extractionWave ?? null,
        doc.extractedMarkdownPath,
        doc.preProcessing ?? null,
        doc.postProcessing ?? null,
        doc.pipelineVersion ?? null,
        doc.contentHash ?? null,
        doc.category,
        doc.subcategory ?? null,
        doc.date ?? null,
        doc.facility ?? null,
        doc.physician ?? null,
        doc.language ?? null,
        doc.tags ? JSON.stringify(doc.tags) : null,
        doc.fhirResourceType ?? null,
        doc.loincDocCode ?? null,
        doc.diagnosticServiceSection ?? null,
        doc.evidenceTier ?? null,
        doc.validationStatus ?? null,
        doc.sourceCredibility ?? null,
      ],
    });
  }

  async getSourceDocument(id: string): Promise<SourceDocument | undefined> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT * FROM source_documents WHERE id = ?',
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return mapRowToSourceDocument(row as Record<string, unknown>);
  }

  /**
   * Delete all L0 + L1 records linked to a source document ID.
   * Used by force re-import to clean up old records before inserting new ones.
   */
  async deleteRecordsBySourceDocId(sourceDocId: string): Promise<number> {
    await this.ensureInitialized();
    // All tables with a source_document_id column
    const CHILD_TABLES = [
      'clinical_patient_reports',
      'clinical_lab_results',
      'clinical_consultations',
      'clinical_medications',
      'medication_changes',
      'medication_adherence',
      'clinical_imaging_reports',
      'clinical_abdominal_reports',
      'clinical_imaging_findings',
      'clinical_conditions',
      'clinical_allergy_intolerances',
      'clinical_family_history',
      'clinical_agent_learnings',
      'clinical_contradictions',
      'clinical_treatment_trials',
      'genetic_variants',
    ] as const;

    // Collect per-table counts for audit trail
    const deletionCounts: Record<string, number> = {};
    let totalDeleted = 0;
    for (const table of CHILD_TABLES) {
      try {
        const result = await this.client.execute({
          sql: `DELETE FROM ${table} WHERE source_document_id = ?`,
          args: [sourceDocId],
        });
        if (result.rowsAffected > 0) {
          deletionCounts[table] = result.rowsAffected;
        }
        totalDeleted += result.rowsAffected;
      } catch {
        // Table may not exist yet or may not have source_document_id column
      }
    }

    // Delete the L0 source document itself
    const srcResult = await this.client.execute({
      sql: 'DELETE FROM source_documents WHERE id = ?',
      args: [sourceDocId],
    });
    if (srcResult.rowsAffected > 0) {
      deletionCounts['source_documents'] = srcResult.rowsAffected;
    }
    totalDeleted += srcResult.rowsAffected;

    // Record deletion in W3C PROV audit trail (best-effort, don't block on failure)
    if (totalDeleted > 0) {
      try {
        const now = new Date().toISOString();
        const activityId = `act-deletion-${sourceDocId}-${Date.now()}`;
        await this.client.execute({
          sql: `INSERT INTO prov_activities (id, type, started_at, ended_at, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            activityId,
            'deletion',
            now,
            now,
            JSON.stringify({
              sourceDocId,
              tables: deletionCounts,
              totalDeleted,
              reason: 'force-reimport',
            }),
            now,
          ],
        });
        // Record wasInvalidatedBy relation
        await this.client.execute({
          sql: `INSERT INTO prov_relations (id, type, subject_id, object_id, activity_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            `rel-invalidated-${sourceDocId}-${Date.now()}`,
            'wasInvalidatedBy',
            sourceDocId,
            activityId,
            activityId,
            now,
          ],
        });
      } catch {
        // Audit trail is best-effort — don't block deletion if provenance tables don't exist
      }
    }

    return totalDeleted;
  }

  async querySourceDocuments(params: SourceDocumentQuery): Promise<SourceDocument[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: InValue[] = [params.patientId];

    if (params.category) {
      conditions.push('category = ?');
      args.push(params.category);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }
    if (params.facility) {
      conditions.push('facility LIKE ?');
      args.push(`%${params.facility}%`);
    }
    if (params.extractionMethod) {
      conditions.push('extraction_method = ?');
      args.push(params.extractionMethod);
    }

    const limit = params.limit ?? 500;
    const result = await this.client.execute({
      sql: `SELECT * FROM source_documents WHERE ${conditions.join(' AND ')} ORDER BY date ASC LIMIT ?`,
      args: [...args, limit],
    });
    return result.rows.map((row) => mapRowToSourceDocument(row as Record<string, unknown>));
  }

  async countSourceDocuments(patientId: string): Promise<number> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT COUNT(*) as cnt FROM source_documents WHERE patient_id = ?',
      args: [patientId],
    });
    const row = result.rows[0];
    return row ? Number(row['cnt']) : 0;
  }

  async getSourceDocumentsByCategory(patientId: string): Promise<Record<string, number>> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT category, COUNT(*) as cnt FROM source_documents WHERE patient_id = ? GROUP BY category',
      args: [patientId],
    });
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[String(row['category'])] = Number(row['cnt']);
    }
    return counts;
  }

  // ─── Layer 1: Imaging Findings ──────────────────────────────────────────

  async addImagingFinding(finding: ImagingFinding): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_imaging_findings (
              id, patient_id, imaging_report_id, anatomical_location, finding_type,
              laterality, measurement, measurement_unit, severity, description,
              nerve_involvement, comparison_to_prior, date, radiologist,
              evidence_tier, validation_status, source_credibility
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        finding.id,
        finding.patientId,
        finding.imagingReportId,
        finding.anatomicalLocation,
        finding.findingType,
        finding.laterality ?? null,
        finding.measurement ?? null,
        finding.measurementUnit ?? null,
        finding.severity ?? null,
        finding.description,
        finding.nerveInvolvement ?? null,
        finding.comparisonToPrior ?? null,
        finding.date,
        finding.radiologist ?? null,
        finding.evidenceTier ?? null,
        finding.validationStatus ?? null,
        finding.sourceCredibility ?? null,
      ],
    });
  }

  async addImagingFindingsBatch(findings: ImagingFinding[]): Promise<{ inserted: number }> {
    await this.ensureInitialized();
    if (findings.length === 0) return { inserted: 0 };

    const stmts = findings.map((f) => ({
      sql: `INSERT OR REPLACE INTO clinical_imaging_findings (
              id, patient_id, imaging_report_id, anatomical_location, finding_type,
              laterality, measurement, measurement_unit, severity, description,
              nerve_involvement, comparison_to_prior, date, radiologist,
              evidence_tier, validation_status, source_credibility
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        f.id,
        f.patientId,
        f.imagingReportId,
        f.anatomicalLocation,
        f.findingType,
        f.laterality ?? null,
        f.measurement ?? null,
        f.measurementUnit ?? null,
        f.severity ?? null,
        f.description,
        f.nerveInvolvement ?? null,
        f.comparisonToPrior ?? null,
        f.date,
        f.radiologist ?? null,
        f.evidenceTier ?? null,
        f.validationStatus ?? null,
        f.sourceCredibility ?? null,
      ] as InValue[],
    }));

    for (let i = 0; i < stmts.length; i += 100) {
      await this.client.batch(stmts.slice(i, i + 100), 'write');
    }
    return { inserted: findings.length };
  }

  async queryImagingFindings(params: ImagingFindingQuery): Promise<ImagingFinding[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: InValue[] = [params.patientId];

    if (params.imagingReportId) {
      conditions.push('imaging_report_id = ?');
      args.push(params.imagingReportId);
    }
    if (params.anatomicalLocation) {
      if (params.anatomicalLocation.includes('%')) {
        conditions.push('anatomical_location LIKE ?');
      } else {
        conditions.push('anatomical_location = ?');
      }
      args.push(params.anatomicalLocation);
    }
    if (params.findingType) {
      conditions.push('finding_type = ?');
      args.push(params.findingType);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }

    const limit = params.limit ?? 200;
    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_imaging_findings WHERE ${conditions.join(' AND ')} ORDER BY date ASC LIMIT ?`,
      args: [...args, limit],
    });
    return result.rows.map((row) => mapRowToImagingFinding(row as Record<string, unknown>));
  }

  // ─── Layer 1: Diagnoses ─────────────────────────────────────────────────

  async addDiagnosis(dx: Diagnosis): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_diagnoses (
              id, patient_id, icd10_code, condition_name, condition_name_pl,
              onset_date, first_documented_date, current_status, body_region, confidence,
              supporting_evidence_ids, notes,
              evidence_tier, validation_status, source_credibility,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        dx.id,
        dx.patientId,
        dx.icd10Code ?? null,
        dx.conditionName,
        dx.conditionNamePl ?? null,
        dx.onsetDate ?? null,
        dx.firstDocumentedDate ?? null,
        dx.currentStatus,
        dx.bodyRegion ?? null,
        dx.confidence ?? null,
        dx.supportingEvidenceIds ? JSON.stringify(dx.supportingEvidenceIds) : null,
        dx.notes ?? null,
        dx.evidenceTier ?? null,
        dx.validationStatus ?? null,
        dx.sourceCredibility ?? null,
        dx.createdAt ?? new Date().toISOString(),
        dx.updatedAt ?? new Date().toISOString(),
      ],
    });
  }

  async queryDiagnoses(params: DiagnosisQuery): Promise<Diagnosis[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: InValue[] = [params.patientId];

    if (params.icd10Code) {
      conditions.push('icd10_code = ?');
      args.push(params.icd10Code);
    }
    if (params.currentStatus) {
      conditions.push('current_status = ?');
      args.push(params.currentStatus);
    }
    if (params.bodyRegion) {
      conditions.push('body_region = ?');
      args.push(params.bodyRegion);
    }

    const limit = params.limit ?? 100;
    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_diagnoses WHERE ${conditions.join(' AND ')} ORDER BY first_documented_date ASC LIMIT ?`,
      args: [...args, limit],
    });
    return result.rows.map((row) => mapRowToDiagnosis(row as Record<string, unknown>));
  }

  // ─── Layer 1: Progressions ──────────────────────────────────────────────

  async addProgression(prog: Progression): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_progressions (
              id, patient_id, finding_chain_id, finding_name, finding_domain,
              anatomical_location, date, value, numeric_value, unit, description,
              direction, comparison_note, source_record_id, source_record_type,
              evidence_tier, validation_status, source_credibility
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        prog.id,
        prog.patientId,
        prog.findingChainId,
        prog.findingName,
        prog.findingDomain,
        prog.anatomicalLocation ?? null,
        prog.date,
        prog.value,
        prog.numericValue ?? null,
        prog.unit ?? null,
        prog.description ?? null,
        prog.direction,
        prog.comparisonNote ?? null,
        prog.sourceRecordId ?? null,
        prog.sourceRecordType ?? null,
        prog.evidenceTier ?? null,
        prog.validationStatus ?? null,
        prog.sourceCredibility ?? null,
      ],
    });
  }

  async queryProgressions(params: ProgressionQuery): Promise<Progression[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: InValue[] = [params.patientId];

    if (params.findingChainId) {
      conditions.push('finding_chain_id = ?');
      args.push(params.findingChainId);
    }
    if (params.findingName) {
      conditions.push('finding_name = ?');
      args.push(params.findingName);
    }
    if (params.findingDomain) {
      conditions.push('finding_domain = ?');
      args.push(params.findingDomain);
    }
    if (params.anatomicalLocation) {
      if (params.anatomicalLocation.includes('%')) {
        conditions.push('anatomical_location LIKE ?');
      } else {
        conditions.push('anatomical_location = ?');
      }
      args.push(params.anatomicalLocation);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }

    const limit = params.limit ?? 200;
    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_progressions WHERE ${conditions.join(' AND ')} ORDER BY date ASC LIMIT ?`,
      args: [...args, limit],
    });
    return result.rows.map((row) => mapRowToProgression(row as Record<string, unknown>));
  }

  async getProgressionChain(patientId: string, findingChainId: string): Promise<Progression[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT * FROM clinical_progressions WHERE patient_id = ? AND finding_chain_id = ? ORDER BY date ASC',
      args: [patientId, findingChainId],
    });
    return result.rows.map((row) => mapRowToProgression(row as Record<string, unknown>));
  }

  // ─── Layer 4: Report Versions ───────────────────────────────────────────

  async addReportVersion(report: ReportVersion): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO report_versions (
              id, patient_id, report_name, language, version, file_path,
              content_hash, line_count, subsection_count,
              changes_summary, change_source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        report.id,
        report.patientId,
        report.reportName,
        report.language,
        report.version,
        report.filePath,
        report.contentHash,
        report.lineCount ?? null,
        report.subsectionCount ?? null,
        report.changesSummary ?? null,
        report.changeSource ?? null,
        report.createdAt,
      ],
    });
  }

  async getLatestReportVersion(params: {
    patientId: string;
    reportName: string;
    language: string;
  }): Promise<ReportVersion | undefined> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM report_versions
            WHERE patient_id = ? AND report_name = ? AND language = ?
            ORDER BY created_at DESC LIMIT 1`,
      args: [params.patientId, params.reportName, params.language],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return mapRowToReportVersion(row as Record<string, unknown>);
  }

  async queryReportVersions(patientId: string): Promise<ReportVersion[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: 'SELECT * FROM report_versions WHERE patient_id = ? ORDER BY created_at DESC',
      args: [patientId],
    });
    return result.rows.map((row) => mapRowToReportVersion(row as Record<string, unknown>));
  }

  // ─── Layer 4: Report Data Integration ───────────────────────────────────

  async addReportDataIntegration(integration: ReportDataIntegration): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO report_data_integration (
              id, patient_id, report_version_id, data_id, data_type,
              integration_status, section_affected, integrated_at,
              exclusion_reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        integration.id,
        integration.patientId,
        integration.reportVersionId,
        integration.dataId,
        integration.dataType,
        integration.integrationStatus,
        integration.sectionAffected ?? null,
        integration.integratedAt ?? null,
        integration.exclusionReason ?? null,
        integration.createdAt,
      ],
    });
  }

  async getPendingIntegrations(params: {
    patientId: string;
    reportVersionId?: string;
  }): Promise<ReportDataIntegration[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?', "integration_status = 'pending'"];
    const args: InValue[] = [params.patientId];

    if (params.reportVersionId) {
      conditions.push('report_version_id = ?');
      args.push(params.reportVersionId);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM report_data_integration WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      args,
    });
    return result.rows.map((row) => mapRowToReportDataIntegration(row as Record<string, unknown>));
  }

  async getIntegrationStatus(params: {
    patientId: string;
    reportVersionId: string;
  }): Promise<Record<string, number>> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT integration_status, COUNT(*) as cnt FROM report_data_integration
            WHERE patient_id = ? AND report_version_id = ?
            GROUP BY integration_status`,
      args: [params.patientId, params.reportVersionId],
    });
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[String(row['integration_status'])] = Number(row['cnt']);
    }
    return counts;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.client.close();
  }
}

// ─── Row Mapping Helpers ─────────────────────────────────────────────────

function optStr(val: unknown): string | undefined {
  return val ? String(val) : undefined;
}

function mapRowToGeneticVariant(row: Record<string, unknown>): GeneticVariant {
  const result: GeneticVariant = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    rsid: String(row['rsid']),
    chromosome: String(row['chromosome']) as GeneticVariant['chromosome'],
    position: Number(row['position']),
    genotype: String(row['genotype']),
    source: String(row['source']),
    referenceGenome: String(row['reference_genome']),
    importDate: String(row['import_date']),
    // Provenance + FHIR
    ...mapProvenance(row),
    ...mapFhirMetadata(row),
  };
  if (row['source_version']) result.sourceVersion = String(row['source_version']);
  if (row['raw_line']) result.rawLine = String(row['raw_line']);
  // GA4GH VRS 2.0
  if (row['vrs_digest']) result.vrsDigest = String(row['vrs_digest']);
  if (row['vrs_allele_id']) result.vrsAlleleId = String(row['vrs_allele_id']);
  // FHIR Genomics Reporting IG
  if (row['genomic_source_class']) result.genomicSourceClass = String(row['genomic_source_class']) as GeneticVariant['genomicSourceClass'];
  if (row['allelic_state']) result.allelicState = String(row['allelic_state']) as GeneticVariant['allelicState'];
  if (row['coding_change_type']) result.codingChangeType = String(row['coding_change_type']);
  // ClinVar/ACMG
  if (row['clinical_significance']) result.clinicalSignificance = String(row['clinical_significance']) as GeneticVariant['clinicalSignificance'];
  if (row['clinvar_id']) result.clinvarId = String(row['clinvar_id']);
  if (row['clinvar_last_evaluated']) result.clinvarLastEvaluated = String(row['clinvar_last_evaluated']);
  if (row['review_status']) result.reviewStatus = String(row['review_status']);
  if (row['gene_symbol']) result.geneSymbol = String(row['gene_symbol']);
  if (row['conditions']) result.conditions = String(row['conditions']);
  if (row['molecular_consequence']) result.molecularConsequence = String(row['molecular_consequence']);
  // Pharmacogenomics
  if (row['pharmgkb_level']) result.pharmgkbLevel = String(row['pharmgkb_level']);
  if (row['star_allele']) result.starAllele = String(row['star_allele']);
  // Population frequency
  if (row['global_minor_allele_freq'] !== null && row['global_minor_allele_freq'] !== undefined) {
    result.globalMinorAlleleFreq = Number(row['global_minor_allele_freq']);
  }
  return result;
}

function mapProvenance(row: Record<string, unknown>): {
  evidenceTier?: LabResult['evidenceTier'];
  validationStatus?: LabResult['validationStatus'];
  sourceCredibility?: number;
} {
  const result: Record<string, unknown> = {};
  if (row['evidence_tier']) result['evidenceTier'] = String(row['evidence_tier']);
  if (row['validation_status']) result['validationStatus'] = String(row['validation_status']);
  if (row['source_credibility'] !== null && row['source_credibility'] !== undefined)
    result['sourceCredibility'] = Number(row['source_credibility']);
  return result as ReturnType<typeof mapProvenance>;
}

function mapFhirMetadata(row: Record<string, unknown>): {
  sourceDocumentId?: string;
  fhirResourceType?: string;
  fhirStatus?: LabResult['fhirStatus'];
  documentCategory?: LabResult['documentCategory'];
  extractionConfidence?: number;
} {
  const result: Record<string, unknown> = {};
  if (row['source_document_id']) result['sourceDocumentId'] = String(row['source_document_id']);
  if (row['fhir_resource_type']) result['fhirResourceType'] = String(row['fhir_resource_type']);
  if (row['fhir_status']) result['fhirStatus'] = String(row['fhir_status']);
  if (row['document_category']) result['documentCategory'] = String(row['document_category']);
  if (row['extraction_confidence'] != null) result['extractionConfidence'] = Number(row['extraction_confidence']);
  return result as ReturnType<typeof mapFhirMetadata>;
}

function mapRowToImagingReport(row: Record<string, unknown>): ImagingReport {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    modality: String(row['modality']),
    bodyRegion: String(row['body_region']),
    date: String(row['date']),
    facility: optStr(row['facility']),
    physician: optStr(row['physician']),
    technique: optStr(row['technique']),
    findings: optStr(row['findings']),
    impression: optStr(row['impression']),
    comparison: optStr(row['comparison']),
    source: optStr(row['source']),
    diagnosticServiceSection: optStr(row['diagnostic_service_section']),
    loincStudyCode: optStr(row['loinc_study_code']),
    bodySiteSnomedCode: optStr(row['body_site_snomed_code']),
    ...mapProvenance(row),
    ...mapFhirMetadata(row),
  } as ImagingReport;
}

function mapRowToAbdominalReport(row: Record<string, unknown>): AbdominalReport {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    procedureType: String(row['procedure_type']),
    date: String(row['date']),
    facility: optStr(row['facility']),
    physician: optStr(row['physician']),
    findings: optStr(row['findings']),
    conclusions: optStr(row['conclusions']),
    source: optStr(row['source']),
    loincProcedureCode: optStr(row['loinc_procedure_code']),
    ...mapProvenance(row),
    ...mapFhirMetadata(row),
  } as AbdominalReport;
}

function mapRowToTreatmentTrial(row: Record<string, unknown>): TreatmentTrial {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    medication: String(row['medication']),
    rxnormCode: optStr(row['rxnorm_code']),
    drugClass: optStr(row['drug_class']),
    indication: optStr(row['indication']),
    startDate: optStr(row['start_date']),
    endDate: optStr(row['end_date']),
    dosage: optStr(row['dosage']),
    efficacy: String(row['efficacy']) as TreatmentTrial['efficacy'],
    sideEffects: row['side_effects']
      ? (JSON.parse(String(row['side_effects'])) as string[])
      : undefined,
    reasonDiscontinued: optStr(row['reason_discontinued']),
    adequateTrial: row['adequate_trial'] === null ? undefined : Boolean(row['adequate_trial']),
    ...mapProvenance(row),
    ...mapFhirMetadata(row),
  };
}

// ─── Research Row Mapping Helpers ──────────────────────────────────────────

function optNum(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = Number(val);
  return Number.isNaN(n) ? undefined : n;
}

function mapRowToFinding(row: Record<string, unknown>): ResearchFinding {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    source: String(row['source']),
    sourceTool: optStr(row['source_tool']),
    externalId: optStr(row['external_id']),
    externalIdType: optStr(row['external_id_type']) as ResearchFinding['externalIdType'],
    title: String(row['title']),
    summary: String(row['summary']),
    url: optStr(row['url']),
    relevance: optNum(row['relevance']),
    evidenceLevel: optStr(row['evidence_level']) as ResearchFinding['evidenceLevel'],
    researchQueryId: optStr(row['research_query_id']),
    date: String(row['date']),
    rawData: optStr(row['raw_data']),
    ...mapProvenance(row),
  };
}

function mapRowToResearchQuery(row: Record<string, unknown>): ResearchQuery {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    query: String(row['query']),
    toolUsed: String(row['tool_used']),
    agent: optStr(row['agent']),
    resultCount: optNum(row['result_count']),
    findingIds: row['finding_ids']
      ? (JSON.parse(String(row['finding_ids'])) as string[])
      : undefined,
    synthesis: optStr(row['synthesis']),
    gaps: row['gaps'] ? (JSON.parse(String(row['gaps'])) as string[]) : undefined,
    suggestedFollowUp: row['suggested_follow_up']
      ? (JSON.parse(String(row['suggested_follow_up'])) as string[])
      : undefined,
    stage: optNum(row['stage']),
    date: String(row['date']),
    durationMs: optNum(row['duration_ms']),
    ...mapProvenance(row),
  };
}

function mapRowToHypothesis(row: Record<string, unknown>): ResearchHypothesis {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    name: String(row['name']),
    icdCode: optStr(row['icd_code']),
    probabilityLow: optNum(row['probability_low']),
    probabilityHigh: optNum(row['probability_high']),
    advocateCase: optStr(row['advocate_case']),
    skepticCase: optStr(row['skeptic_case']),
    arbiterVerdict: optStr(row['arbiter_verdict']),
    evidenceTier: optStr(row['evidence_tier']) as ResearchHypothesis['evidenceTier'],
    certaintyLevel: optStr(row['certainty_level']) as ResearchHypothesis['certaintyLevel'],
    stage: optNum(row['stage']),
    version: optNum(row['version']),
    supersededBy: optStr(row['superseded_by']),
    date: String(row['date']),
    validationStatus: optStr(row['validation_status']) as ResearchHypothesis['validationStatus'],
    sourceCredibility: optNum(row['source_credibility']),
  };
}

function mapRowToBrainPattern(row: Record<string, unknown>): BrainPattern {
  const base = {
    id: String(row['id']),
    pattern: String(row['pattern']),
    category: String(row['category']) as BrainPattern['category'],
    phenotypeCluster: JSON.parse(String(row['phenotype_cluster'] ?? '[]')) as string[],
    supportingCases: Number(row['supporting_cases'] ?? 0),
    confidence: Number(row['confidence'] ?? 0.5),
    sourceCaseLabels: JSON.parse(String(row['source_case_labels'] ?? '[]')) as string[],
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
  };

  const result: BrainPattern = { ...base };
  if (row['related_diagnoses']) {
    result.relatedDiagnoses = JSON.parse(String(row['related_diagnoses'])) as string[];
  }
  if (row['related_genes']) {
    result.relatedGenes = JSON.parse(String(row['related_genes'])) as string[];
  }
  return result;
}

function mapRowToEvidenceLink(row: Record<string, unknown>): HypothesisEvidenceLink {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    hypothesisId: String(row['hypothesis_id']),
    findingId: optStr(row['finding_id']),
    clinicalRecordId: optStr(row['clinical_record_id']),
    clinicalRecordType: optStr(
      row['clinical_record_type'],
    ) as HypothesisEvidenceLink['clinicalRecordType'],
    direction: String(row['direction']) as HypothesisEvidenceLink['direction'],
    claim: String(row['claim']),
    confidence: optNum(row['confidence']),
    tier: optStr(row['tier']) as HypothesisEvidenceLink['tier'],
    date: String(row['date']),
    notes: optStr(row['notes']),
  };
}

// ─── Layer 0 + Layer 2 Enhancement Row Mapping Helpers ────────────────────

function parseJsonArray(val: unknown): string[] | undefined {
  if (!val) return undefined;
  try {
    const parsed: unknown = JSON.parse(String(val));
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

function mapRowToSourceDocument(row: Record<string, unknown>): SourceDocument {
  const result: SourceDocument = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    originalFilename: String(row['original_filename']),
    originalFileHash: String(row['original_file_hash']),
    originalFileSizeBytes: Number(row['original_file_size_bytes']),
    extractionMethod: String(row['extraction_method']) as SourceDocument['extractionMethod'],
    extractionConfidence: Number(row['extraction_confidence']),
    extractionDate: String(row['extraction_date']),
    extractionTool: String(row['extraction_tool']),
    extractedMarkdownPath: String(row['extracted_markdown_path']),
    category: String(row['category']) as SourceDocument['category'],
    ...mapProvenance(row),
  };
  if (row['original_page_count'] !== null && row['original_page_count'] !== undefined)
    result.originalPageCount = Number(row['original_page_count']);
  if (row['mime_type']) result.mimeType = String(row['mime_type']);
  if (row['extraction_wave'] !== null && row['extraction_wave'] !== undefined)
    result.extractionWave = Number(row['extraction_wave']);
  if (row['pre_processing']) result.preProcessing = String(row['pre_processing']);
  if (row['post_processing']) result.postProcessing = String(row['post_processing']);
  if (row['pipeline_version']) result.pipelineVersion = String(row['pipeline_version']);
  if (row['content_hash']) result.contentHash = String(row['content_hash']);
  if (row['subcategory']) result.subcategory = String(row['subcategory']);
  if (row['date']) result.date = String(row['date']);
  if (row['facility']) result.facility = String(row['facility']);
  if (row['physician']) result.physician = String(row['physician']);
  if (row['language']) result.language = String(row['language']);
  const tags = parseJsonArray(row['tags']);
  if (tags) result.tags = tags;
  if (row['fhir_resource_type'])
    result.fhirResourceType = String(
      row['fhir_resource_type'],
    ) as SourceDocument['fhirResourceType'];
  if (row['loinc_doc_code']) result.loincDocCode = String(row['loinc_doc_code']);
  if (row['diagnostic_service_section'])
    result.diagnosticServiceSection = String(
      row['diagnostic_service_section'],
    ) as SourceDocument['diagnosticServiceSection'];
  return result;
}

function mapRowToImagingFinding(row: Record<string, unknown>): ImagingFinding {
  const result: ImagingFinding = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    imagingReportId: String(row['imaging_report_id']),
    anatomicalLocation: String(row['anatomical_location']),
    findingType: String(row['finding_type']) as ImagingFinding['findingType'],
    description: String(row['description']),
    date: String(row['date']),
    ...mapProvenance(row),
  };
  if (row['laterality'])
    result.laterality = String(row['laterality']) as ImagingFinding['laterality'];
  if (row['measurement'] !== null && row['measurement'] !== undefined)
    result.measurement = Number(row['measurement']);
  if (row['measurement_unit']) result.measurementUnit = String(row['measurement_unit']);
  if (row['severity']) result.severity = String(row['severity']) as ImagingFinding['severity'];
  if (row['nerve_involvement']) result.nerveInvolvement = String(row['nerve_involvement']);
  if (row['comparison_to_prior']) result.comparisonToPrior = String(row['comparison_to_prior']);
  if (row['radiologist']) result.radiologist = String(row['radiologist']);
  return result;
}

function mapRowToDiagnosis(row: Record<string, unknown>): Diagnosis {
  const result: Diagnosis = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    conditionName: String(row['condition']),
    currentStatus: String(row['current_status']) as Diagnosis['currentStatus'],
    ...mapProvenance(row),
  };
  if (row['icd10_code']) result.icd10Code = String(row['icd10_code']);
  if (row['condition_name_pl']) result.conditionNamePl = String(row['condition_name_pl']);
  if (row['onset_date']) result.onsetDate = String(row['onset_date']);
  if (row['first_documented_date'])
    result.firstDocumentedDate = String(row['first_documented_date']);
  if (row['body_region']) result.bodyRegion = String(row['body_region']) as Diagnosis['bodyRegion'];
  if (row['confidence'] !== null && row['confidence'] !== undefined)
    result.confidence = Number(row['confidence']);
  const evidence = parseJsonArray(row['supporting_evidence_ids']);
  if (evidence) result.supportingEvidenceIds = evidence;
  if (row['notes']) result.notes = String(row['notes']);
  if (row['created_at']) result.createdAt = String(row['created_at']);
  if (row['updated_at']) result.updatedAt = String(row['updated_at']);
  return result;
}

function mapRowToProgression(row: Record<string, unknown>): Progression {
  const result: Progression = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    findingChainId: String(row['finding_chain_id']),
    findingName: String(row['finding_name']),
    findingDomain: String(row['finding_domain']) as Progression['findingDomain'],
    date: String(row['date']),
    value: String(row['value']),
    direction: String(row['direction']) as Progression['direction'],
    ...mapProvenance(row),
  };
  if (row['anatomical_location']) result.anatomicalLocation = String(row['anatomical_location']);
  if (row['numeric_value'] !== null && row['numeric_value'] !== undefined)
    result.numericValue = Number(row['numeric_value']);
  if (row['unit']) result.unit = String(row['unit']);
  if (row['description']) result.description = String(row['description']);
  if (row['comparison_note']) result.comparisonNote = String(row['comparison_note']);
  if (row['source_record_id']) result.sourceRecordId = String(row['source_record_id']);
  if (row['source_record_type']) result.sourceRecordType = String(row['source_record_type']);
  return result;
}

function mapRowToReportVersion(row: Record<string, unknown>): ReportVersion {
  const result: ReportVersion = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    reportName: String(row['report_name']),
    language: String(row['language']) as ReportVersion['language'],
    version: String(row['version']),
    filePath: String(row['file_path']),
    contentHash: String(row['content_hash']),
    createdAt: String(row['created_at']),
  };
  if (row['line_count'] !== null && row['line_count'] !== undefined)
    result.lineCount = Number(row['line_count']);
  if (row['subsection_count'] !== null && row['subsection_count'] !== undefined)
    result.subsectionCount = Number(row['subsection_count']);
  if (row['changes_summary']) result.changesSummary = String(row['changes_summary']);
  if (row['change_source']) result.changeSource = String(row['change_source']);
  return result;
}

function mapRowToReportDataIntegration(row: Record<string, unknown>): ReportDataIntegration {
  const result: ReportDataIntegration = {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    reportVersionId: String(row['report_version_id']),
    dataId: String(row['data_id']),
    dataType: String(row['data_type']) as ReportDataIntegration['dataType'],
    integrationStatus: String(
      row['integration_status'],
    ) as ReportDataIntegration['integrationStatus'],
    createdAt: String(row['created_at']),
  };
  if (row['section_affected']) result.sectionAffected = String(row['section_affected']);
  if (row['integrated_at']) result.integratedAt = String(row['integrated_at']);
  if (row['exclusion_reason']) result.exclusionReason = String(row['exclusion_reason']);
  return result;
}

// ─── Value Parsing ────────────────────────────────────────────────────────

/**
 * Parse a lab value from the database, handling European number formats
 * (space as thousands separator, comma as decimal separator) and
 * stripping non-numeric prefixes like "< " or "> ".
 */
function parseLabValue(raw: unknown): string | number {
  const s = String(raw ?? '').trim();
  if (s === '') return s;

  // Strip comparison prefixes but keep the value numeric
  const stripped = s.replace(/^[<>]=?\s*/, '');

  // Try direct parse first (covers "3.5", "0.07" etc.)
  const direct = Number(stripped);
  if (!Number.isNaN(direct)) return direct;

  // Handle European thousands separator: "1 061.00" → "1061.00"
  const noSpaces = stripped.replace(/\s/g, '');
  const spaceParsed = Number(noSpaces);
  if (!Number.isNaN(spaceParsed)) return spaceParsed;

  // Handle comma-as-decimal: "14,2" → "14.2"
  const commaFixed = noSpaces.replace(',', '.');
  const commaParsed = Number(commaFixed);
  if (!Number.isNaN(commaParsed)) return commaParsed;

  // Non-numeric (e.g., "ujemny (negative)") — return as string
  return s;
}

// ─── Trend Computation Helpers ────────────────────────────────────────────

function computeTrendDirection(values: number[]): 'rising' | 'falling' | 'stable' | 'fluctuating' {
  if (values.length < 2) return 'stable';

  let increases = 0;
  let decreases = 0;

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev === undefined || curr === undefined) continue;
    const diff = curr - prev;
    if (diff > 0) increases++;
    else if (diff < 0) decreases++;
  }

  const changes = increases + decreases;
  if (changes === 0) return 'stable';

  // If direction changes frequently, it's fluctuating
  if (increases > 0 && decreases > 0 && Math.min(increases, decreases) / changes > 0.3) {
    return 'fluctuating';
  }

  return increases > decreases ? 'rising' : 'falling';
}

function computeRateOfChange(labs: Array<{ date: string; value: number }>): number | null {
  if (labs.length < 2) return null;

  const first = labs[0];
  const last = labs[labs.length - 1];
  if (!(first && last)) return null;

  const firstDate = new Date(first.date).getTime();
  const lastDate = new Date(last.date).getTime();
  const yearsDiff = (lastDate - firstDate) / (365.25 * 24 * 60 * 60 * 1000);

  if (yearsDiff === 0) return null;

  return Number(((last.value - first.value) / yearsDiff).toFixed(2));
}

function generateClinicalNote(
  direction: string,
  rateOfChange: number | null,
  isAbnormal: boolean,
  testName: string,
): string | undefined {
  const parts: string[] = [];

  if (direction === 'falling' && isAbnormal) {
    parts.push(`${testName} declining and currently abnormal`);
  } else if (direction === 'rising' && isAbnormal) {
    parts.push(`${testName} rising and currently abnormal`);
  } else if (direction === 'stable' && isAbnormal) {
    parts.push(`${testName} persistently abnormal`);
  }

  if (rateOfChange !== null && Math.abs(rateOfChange) > 0) {
    const direction2 = rateOfChange > 0 ? 'increase' : 'decrease';
    parts.push(`rate: ${Math.abs(rateOfChange)} units/year ${direction2}`);
  }

  return parts.length > 0 ? parts.join('; ') : undefined;
}

// ─── Content Hash ─────────────────────────────────────────────────────────

/**
 * Compute a stable content fingerprint for a research finding.
 * Uses SHA-256 of normalized (source + title + date) — three fields
 * that uniquely identify a finding even without an external ID.
 */
function computeFindingHash(f: { source: string; title: string; date: string }): string {
  const input = `${f.source.trim().toLowerCase()}|${f.title.trim().toLowerCase()}|${f.date.trim()}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ─── Singleton ────────────────────────────────────────────────────────────

let Instance: ClinicalStore | undefined;

export function getClinicalStore(): ClinicalStore {
  if (!Instance) {
    Instance = new ClinicalStore();
  }
  return Instance;
}

/** Replace the singleton for testing — ONLY for test use. */
export function setClinicalStoreForTest(store: ClinicalStore): void {
  Instance = store;
}
