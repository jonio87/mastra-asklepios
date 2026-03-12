import { z } from 'zod';
import { evidenceProvenanceFields } from './clinical-record.js';

/**
 * Imaging Finding Schema — Layer 2A structured decomposition.
 *
 * Decomposes imaging report text blobs into queryable per-finding rows.
 * Each row represents a single anatomical finding with its measurements,
 * severity, and nerve involvement. This fixes the #1 gap that caused
 * Th6/7, AICA, and C7/T1 discrepancies in the diagnostic plan.
 *
 * "Show all findings at C7/T1" becomes a SQL query instead of text search.
 */

// ─── Finding Type Categories ────────────────────────────────────────────

export const findingTypeValues = [
  'herniation', // Disc herniation (protrusion, extrusion, sequestration)
  'protrusion', // Disc protrusion (less severe than extrusion)
  'extrusion', // Disc extrusion (through annulus fibrosis)
  'bulge', // Disc bulge (circumferential, mild)
  'stenosis', // Canal or foraminal narrowing
  'compression', // Neural compression (cord, root)
  'osteophyte', // Bony spur formation
  'cyst', // Retention cyst, arachnoid cyst, synovial cyst
  'atrophy', // Tissue atrophy (cortical, muscular)
  'vascular-loop', // Neurovascular compression (AICA, SCA loops)
  'anomaly', // Developmental anomaly (assimilation, fusion)
  'degeneration', // Degenerative change (facet, disc, joint)
  'inflammation', // Inflammatory finding (edema, enhancement)
  'mass', // Neoplastic or space-occupying lesion
  'normal', // Explicitly normal finding (documented absence)
  'other', // Anything not fitting above categories
] as const;

export const findingTypeEnum = z.enum(findingTypeValues);
export type FindingType = z.infer<typeof findingTypeEnum>;

// ─── Laterality ─────────────────────────────────────────────────────────

export const lateralityValues = [
  'left',
  'right',
  'bilateral',
  'midline',
  'left-lateral',
  'right-lateral',
] as const;

export const lateralityEnum = z.enum(lateralityValues);
export type Laterality = z.infer<typeof lateralityEnum>;

// ─── Severity ───────────────────────────────────────────────────────────

export const severityValues = ['minimal', 'mild', 'moderate', 'severe', 'critical'] as const;

export const severityEnum = z.enum(severityValues);
export type Severity = z.infer<typeof severityEnum>;

// ─── Imaging Finding Schema ─────────────────────────────────────────────

export const imagingFindingSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  imagingReportId: z.string(), // FK to clinical_imaging_reports
  // Anatomical location
  anatomicalLocation: z.string(), // 'C7/T1', 'Th6/Th7', 'left_maxillary_sinus'
  findingType: findingTypeEnum,
  laterality: lateralityEnum.optional(),
  // Measurements
  measurement: z.number().optional(), // Numeric measurement (e.g. 2.5 for cyst size)
  measurementUnit: z.string().optional(), // 'cm', 'mm', 'degrees'
  // Clinical details
  severity: severityEnum.optional(),
  description: z.string(), // Full finding description from report
  nerveInvolvement: z.string().optional(), // 'C8 root compression', 'CN VII/VIII encircled'
  comparisonToPrior: z.string().optional(), // 'stable', 'progressed', 'new finding'
  // Temporal metadata
  date: z.string(), // ISO 8601 — date of imaging study
  radiologist: z.string().optional(), // 'Dr. Paweł Szewczyk'
  // Evidence provenance
  ...evidenceProvenanceFields,
});

export type ImagingFinding = z.infer<typeof imagingFindingSchema>;

// ─── Imaging Finding Query ──────────────────────────────────────────────

export const imagingFindingQuerySchema = z.object({
  patientId: z.string(),
  imagingReportId: z.string().optional(),
  anatomicalLocation: z.string().optional(), // Supports LIKE patterns (e.g. 'C7%')
  findingType: findingTypeEnum.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export type ImagingFindingQuery = z.infer<typeof imagingFindingQuerySchema>;
