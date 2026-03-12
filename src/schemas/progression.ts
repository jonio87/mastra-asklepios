import { z } from 'zod';
import { evidenceProvenanceFields } from './clinical-record.js';

/**
 * Progression Schema — Layer 2A temporal chain tracking.
 *
 * Links the same clinical finding across multiple dates to track
 * progression over time. Examples:
 *   - C6/7: protrusion (2014) → moderate herniation (2019) → stable (2022)
 *   - Maxillary cyst: 2.5 cm (April 2022) → 3.7 cm (Dec 2022)
 *   - WBC: 3.5 → 4.37 → 3.74 → 2.59 (nadir) → 3.37
 *
 * Each row is one point in the temporal chain. The chain is linked
 * via findingChainId (shared by all observations of the same finding).
 */

// ─── Progression Direction ──────────────────────────────────────────────

export const progressionDirectionValues = [
  'stable', // No significant change
  'improving', // Getting better
  'worsening', // Getting worse
  'fluctuating', // Going up and down
  'new', // First observation (no prior comparison)
  'resolved', // Finding no longer present
] as const;

export const progressionDirectionEnum = z.enum(progressionDirectionValues);
export type ProgressionDirection = z.infer<typeof progressionDirectionEnum>;

// ─── Finding Domain ─────────────────────────────────────────────────────

export const findingDomainValues = [
  'imaging', // Imaging findings (disc, cyst, atrophy)
  'lab', // Lab values (WBC, CRP, ANCA)
  'clinical', // Clinical observations (pain score, ROM, strength)
  'functional', // Functional measures (grip strength, gait)
] as const;

export const findingDomainEnum = z.enum(findingDomainValues);
export type FindingDomain = z.infer<typeof findingDomainEnum>;

// ─── Progression Schema ─────────────────────────────────────────────────

export const progressionSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  // Chain identification
  findingChainId: z.string(), // Shared ID across all observations of same finding
  findingName: z.string(), // 'C6/C7 disc', 'WBC count', 'maxillary cyst size'
  findingDomain: findingDomainEnum,
  anatomicalLocation: z.string().optional(), // 'C6/C7', 'left_maxillary_sinus'
  // This observation
  date: z.string(), // ISO 8601
  value: z.string(), // 'protrusion', '3.7 cm', '2.59 K/µL'
  numericValue: z.number().optional(), // For quantifiable findings
  unit: z.string().optional(), // 'cm', 'K/µL', 'degrees'
  description: z.string().optional(), // Detailed finding description
  // Comparison
  direction: progressionDirectionEnum,
  comparisonNote: z.string().optional(), // 'Increased 48% from April 2022'
  // Source records
  sourceRecordId: z.string().optional(), // FK to clinical_imaging_reports, clinical_lab_results, etc.
  sourceRecordType: z.string().optional(), // 'imaging-report', 'lab-result'
  // Evidence provenance
  ...evidenceProvenanceFields,
});

export type Progression = z.infer<typeof progressionSchema>;

// ─── Progression Query ──────────────────────────────────────────────────

export const progressionQuerySchema = z.object({
  patientId: z.string(),
  findingChainId: z.string().optional(),
  findingName: z.string().optional(),
  findingDomain: findingDomainEnum.optional(),
  anatomicalLocation: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

export type ProgressionQuery = z.infer<typeof progressionQuerySchema>;
