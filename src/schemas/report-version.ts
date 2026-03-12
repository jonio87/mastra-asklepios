import { z } from 'zod';

/**
 * Report Version & Data Integration Schemas — Layer 5 of the inverted pyramid.
 *
 * Tracks what version of each deliverable report exists, and which clinical
 * data has been integrated into each version. This enables the system to:
 *   - Know that v5.3 exists with specific content hash and line count
 *   - Flag when new data arrives that hasn't been integrated into the report
 *   - Track section-level changes between versions
 *   - Drive regeneration with precise diffs
 *
 * When 2022 Skanmex reports were located, the system should have flagged:
 * "3 imaging reports exist that haven't been integrated into v5.2."
 */

// ─── Report Language ────────────────────────────────────────────────────

export const reportLanguageValues = ['en', 'pl', 'de'] as const;
export const reportLanguageEnum = z.enum(reportLanguageValues);
export type ReportLanguage = z.infer<typeof reportLanguageEnum>;

// ─── Integration Status ─────────────────────────────────────────────────

export const integrationStatusValues = [
  'integrated', // Data has been incorporated into report
  'pending', // Data exists but not yet integrated
  'excluded', // Deliberately excluded (with reason)
  'partial', // Some aspects integrated, others pending
] as const;

export const integrationStatusEnum = z.enum(integrationStatusValues);
export type IntegrationStatus = z.infer<typeof integrationStatusEnum>;

// ─── Data Type (for integration tracking) ───────────────────────────────

export const integratedDataTypeValues = [
  'source-document',
  'imaging-report',
  'imaging-finding',
  'lab-result',
  'consultation',
  'treatment-trial',
  'research-finding',
  'diagnosis',
  'progression',
  'genetic-variant',
  'hypothesis',
] as const;

export const integratedDataTypeEnum = z.enum(integratedDataTypeValues);
export type IntegratedDataType = z.infer<typeof integratedDataTypeEnum>;

// ─── Report Version Schema ──────────────────────────────────────────────

export const reportVersionSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  reportName: z.string(), // 'diagnostic-therapeutic-plan'
  language: reportLanguageEnum,
  version: z.string(), // '5.3'
  filePath: z.string(), // 'research/diagnostic-therapeutic-plan-english.md'
  contentHash: z.string(), // SHA-256 of file content
  lineCount: z.number().int().nonnegative().optional(),
  subsectionCount: z.number().int().nonnegative().optional(),
  changesSummary: z.string().optional(), // Human-readable summary of changes from prior version
  changeSource: z.string().optional(), // What triggered this version ('2022 Skanmex integration')
  createdAt: z.string(), // ISO 8601
});

export type ReportVersion = z.infer<typeof reportVersionSchema>;

// ─── Report Data Integration Schema ─────────────────────────────────────

export const reportDataIntegrationSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  reportVersionId: z.string(), // FK to report_versions
  dataId: z.string(), // FK to the data record
  dataType: integratedDataTypeEnum,
  integrationStatus: integrationStatusEnum,
  sectionAffected: z.string().optional(), // '2.1 Confirmed Diagnoses', '4.1 Action Items'
  integratedAt: z.string().optional(), // ISO 8601
  exclusionReason: z.string().optional(), // Why data was excluded
  createdAt: z.string(), // ISO 8601
});

export type ReportDataIntegration = z.infer<typeof reportDataIntegrationSchema>;
