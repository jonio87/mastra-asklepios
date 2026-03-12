import { z } from 'zod';

/**
 * W3C PROV-aligned Provenance Schema — Cross-cutting audit trail.
 *
 * Implements three core W3C PROV concepts:
 *   Entity   — data artifact at any layer (source doc, imaging finding, report version)
 *   Activity — transformation process (extract, transform, infer, regenerate)
 *   Agent    — actor performing the activity (human, AI agent, pipeline)
 *
 * Plus two Asklepios extensions:
 *   Relation     — W3C PROV relationship (wasGeneratedBy, wasDerivedFrom, etc.)
 *   ChangeSignal — reactive propagation primitive (bubbles changes L0→L5)
 *
 * References:
 *   - W3C PROV-DM: https://www.w3.org/TR/prov-dm/
 *   - FHIR R6 Provenance: aligns with W3C PROV (ballot-4, March 2026)
 *   - MedBeads (arXiv 2602.01086): content-hash + causal linking patterns
 */

// ─── Entity Types (data artifacts at any layer) ─────────────────────────

export const provEntityTypeValues = [
  'source-doc', // Layer 0: PDF/scan → extracted markdown
  'document-chunk', // Layer 1: embedded chunk in vector store
  'lab-result', // Layer 2A: structured lab value
  'imaging-report', // Layer 2A: imaging report text blob
  'imaging-finding', // Layer 2A: structured per-finding row
  'diagnosis', // Layer 2A: explicit diagnosis registry entry
  'progression', // Layer 2A: temporal chain link
  'consultation', // Layer 2A: consultation record
  'treatment-trial', // Layer 2A: treatment trial record
  'abdominal-report', // Layer 2A: abdominal procedure report
  'research-finding', // Layer 3: literature/PGx/trial finding
  'research-query', // Layer 3: search query audit
  'hypothesis', // Layer 4: diagnostic hypothesis
  'evidence-link', // Layer 4: hypothesis↔evidence connection
  'report-section', // Layer 5: section of a deliverable
  'report-version', // Layer 5: versioned deliverable snapshot
] as const;

export const provEntityTypeEnum = z.enum(provEntityTypeValues);
export type ProvEntityType = z.infer<typeof provEntityTypeEnum>;

// ─── Activity Types (transformation processes) ──────────────────────────

export const provActivityTypeValues = [
  'extract', // PDF → markdown, text blob → structured findings
  'transform', // Normalize, chunk, embed
  'infer', // LLM-based extraction, hypothesis generation
  'validate', // Cross-reference, confirm, contradict
  'create', // New record inserted
  'update', // Existing record modified
  'delete', // Record removed
  'review', // Human review of AI output
  'regenerate', // Report regeneration from updated data
  'import', // Batch import from external source
  'research', // Literature/database search
  'link', // Evidence linking (hypothesis↔finding)
] as const;

export const provActivityTypeEnum = z.enum(provActivityTypeValues);
export type ProvActivityType = z.infer<typeof provActivityTypeEnum>;

// ─── Agent Types (actors) ───────────────────────────────────────────────

export const provAgentTypeValues = [
  'human', // User (e.g. 'user:andrzej')
  'agent', // Mastra AI agent (e.g. 'asklepios', 'research-agent')
  'pipeline', // Automated pipeline (e.g. 'import-records', 'research-campaign')
  'system', // External tool (e.g. 'tesseract-5.x', 'claude-sonnet-4')
] as const;

export const provAgentTypeEnum = z.enum(provAgentTypeValues);
export type ProvAgentType = z.infer<typeof provAgentTypeEnum>;

// ─── Relation Types (W3C PROV relationships) ────────────────────────────

export const provRelationTypeValues = [
  'wasGeneratedBy', // Entity was produced by Activity
  'wasDerivedFrom', // Entity derived from another Entity
  'wasAttributedTo', // Entity attributed to Agent
  'used', // Activity used Entity as input
  'wasInvalidatedBy', // Entity invalidated by Activity (triggers regeneration)
  'wasInformedBy', // Activity informed by another Activity
  'hadMember', // Collection membership (e.g. report has sections)
] as const;

export const provRelationTypeEnum = z.enum(provRelationTypeValues);
export type ProvRelationType = z.infer<typeof provRelationTypeEnum>;

// ─── Change Signal Types (reactive propagation) ─────────────────────────

export const changeTypeValues = [
  'new', // New data added
  'updated', // Existing data modified
  'deleted', // Data removed
  'invalidated', // Data marked as stale (triggers downstream regeneration)
] as const;

export const changeTypeEnum = z.enum(changeTypeValues);
export type ChangeType = z.infer<typeof changeTypeEnum>;

export const changePriorityValues = [
  'low', // Minor update, no clinical impact
  'medium', // Standard update, may affect report sections
  'high', // Clinically significant, affects diagnosis/treatment
  'critical', // Safety-relevant, requires immediate attention
] as const;

export const changePriorityEnum = z.enum(changePriorityValues);
export type ChangePriority = z.infer<typeof changePriorityEnum>;

export const changeSignalStatusValues = [
  'pending', // Not yet processed by higher layers
  'propagated', // Signal sent to affected layers
  'acknowledged', // Higher layer has incorporated the change
  'dismissed', // Manually dismissed (e.g. duplicate, irrelevant)
] as const;

export const changeSignalStatusEnum = z.enum(changeSignalStatusValues);
export type ChangeSignalStatus = z.infer<typeof changeSignalStatusEnum>;

// ─── W3C PROV: Entity Schema ────────────────────────────────────────────

export const provEntitySchema = z.object({
  id: z.string(),
  type: provEntityTypeEnum,
  layer: z.number().int().min(0).max(5),
  contentHash: z.string().optional(), // SHA-256 for integrity verification
  patientId: z.string(),
  metadata: z.string().optional(), // JSON — flexible per-type metadata
  createdAt: z.string(), // ISO 8601
});

export type ProvEntity = z.infer<typeof provEntitySchema>;

// ─── W3C PROV: Activity Schema ──────────────────────────────────────────

export const provActivitySchema = z.object({
  id: z.string(),
  type: provActivityTypeEnum,
  startedAt: z.string(), // ISO 8601
  endedAt: z.string().optional(), // ISO 8601, null if still running
  metadata: z.string().optional(), // JSON — tool params, config, etc.
  createdAt: z.string(), // ISO 8601
});

export type ProvActivity = z.infer<typeof provActivitySchema>;

// ─── W3C PROV: Agent Schema ─────────────────────────────────────────────

export const provAgentSchema = z.object({
  id: z.string(),
  type: provAgentTypeEnum,
  name: z.string(), // 'asklepios', 'user:andrzej', 'tesseract-5.x+pol+eng'
  createdAt: z.string(), // ISO 8601
});

export type ProvAgent = z.infer<typeof provAgentSchema>;

// ─── W3C PROV: Relation Schema ──────────────────────────────────────────

export const provRelationSchema = z.object({
  id: z.string(),
  type: provRelationTypeEnum,
  subjectId: z.string(), // Entity or Activity being described
  objectId: z.string(), // Entity, Activity, or Agent being referenced
  activityId: z.string().optional(), // Activity context (for wasDerivedFrom)
  confidence: z.number().min(0).max(1).optional(), // 0.0-1.0
  reasoning: z.string().optional(), // Why this relation exists
  createdAt: z.string(), // ISO 8601
});

export type ProvRelation = z.infer<typeof provRelationSchema>;

// ─── Change Signal Schema (reactive propagation) ────────────────────────

export const changeSignalSchema = z.object({
  id: z.string(),
  sourceEntityId: z.string(), // The entity that changed
  affectedLayers: z.array(z.number().int().min(0).max(5)), // Layers that need updating
  affectedEntityIds: z.array(z.string()).optional(), // Specific entities affected
  changeType: changeTypeEnum,
  summary: z.string(), // Human-readable description of what changed
  priority: changePriorityEnum,
  status: changeSignalStatusEnum,
  patientId: z.string(),
  createdAt: z.string(), // ISO 8601
});

export type ChangeSignal = z.infer<typeof changeSignalSchema>;
