import type { Client, InValue } from '@libsql/client';
import { createClient } from '@libsql/client';
import type {
  ChangeSignal,
  ProvActivity,
  ProvAgent,
  ProvEntity,
  ProvRelation,
} from '../schemas/provenance.js';
import { logger } from '../utils/logger.js';

/**
 * ProvenanceStore — W3C PROV-compliant audit trail for all data transformations.
 *
 * Tracks the complete lineage of every data artifact in Asklepios:
 *   - Entity: what data exists at each layer (source docs, findings, reports)
 *   - Activity: what transformations produced the data (extract, infer, regenerate)
 *   - Agent: who/what performed the transformation (user, AI agent, pipeline)
 *   - Relation: how entities, activities, and agents are connected
 *   - ChangeSignal: reactive propagation when lower-layer data changes
 *
 * Uses the same LibSQL database as ClinicalStore (co-located).
 */
export class ProvenanceStore {
  private client: Client;
  private initialized = false;

  constructor(dbUrl?: string) {
    this.client = createClient({
      url: dbUrl ?? process.env['ASKLEPIOS_DB_URL'] ?? 'file:asklepios.db',
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.migrate();
    this.initialized = true;
  }

  private async migrate(): Promise<void> {
    const statements = [
      // ─── W3C PROV: Entities (data artifacts at any layer) ──────────
      `CREATE TABLE IF NOT EXISTS prov_entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        layer INTEGER NOT NULL,
        content_hash TEXT,
        patient_id TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_prov_entities_patient ON prov_entities(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_prov_entities_type ON prov_entities(type)`,
      `CREATE INDEX IF NOT EXISTS idx_prov_entities_layer ON prov_entities(layer)`,

      // ─── W3C PROV: Activities (transformations) ────────────────────
      `CREATE TABLE IF NOT EXISTS prov_activities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_prov_activities_type ON prov_activities(type)`,

      // ─── W3C PROV: Agents (human/AI actors) ───────────────────────
      `CREATE TABLE IF NOT EXISTS prov_agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,

      // ─── W3C PROV: Relations (links between entities/activities/agents) ──
      `CREATE TABLE IF NOT EXISTS prov_relations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        object_id TEXT NOT NULL,
        activity_id TEXT,
        confidence REAL,
        reasoning TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_prov_relations_subject ON prov_relations(subject_id)`,
      `CREATE INDEX IF NOT EXISTS idx_prov_relations_object ON prov_relations(object_id)`,
      `CREATE INDEX IF NOT EXISTS idx_prov_relations_type ON prov_relations(type)`,
      `CREATE INDEX IF NOT EXISTS idx_prov_relations_activity ON prov_relations(activity_id)`,

      // ─── Reactive: Change propagation signals ─────────────────────
      `CREATE TABLE IF NOT EXISTS change_signals (
        id TEXT PRIMARY KEY,
        source_entity_id TEXT NOT NULL,
        affected_layers TEXT NOT NULL,
        affected_entity_ids TEXT,
        change_type TEXT NOT NULL,
        summary TEXT NOT NULL,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'pending',
        patient_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_signals_patient ON change_signals(patient_id)`,
      `CREATE INDEX IF NOT EXISTS idx_signals_status ON change_signals(status)`,
      `CREATE INDEX IF NOT EXISTS idx_signals_source ON change_signals(source_entity_id)`,
    ];

    for (const sql of statements) {
      await this.client.execute(sql);
    }

    logger.debug('ProvenanceStore migration complete');
  }

  async close(): Promise<void> {
    this.client.close();
    this.initialized = false;
  }

  // ─── Entity CRUD ────────────────────────────────────────────────────────

  async recordEntity(entity: ProvEntity): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO prov_entities (id, type, layer, content_hash, patient_id, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entity.id,
        entity.type,
        entity.layer,
        entity.contentHash ?? null,
        entity.patientId,
        entity.metadata ?? null,
        entity.createdAt,
      ],
    });
  }

  async getEntity(id: string): Promise<ProvEntity | undefined> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM prov_entities WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return mapEntity(row as Record<string, unknown>);
  }

  async getEntitiesByType(params: {
    patientId: string;
    type?: string;
    layer?: number;
  }): Promise<ProvEntity[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: InValue[] = [params.patientId];

    if (params.type) {
      conditions.push('type = ?');
      args.push(params.type);
    }
    if (params.layer !== undefined) {
      conditions.push('layer = ?');
      args.push(params.layer);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM prov_entities WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      args,
    });

    return result.rows.map((row) => mapEntity(row as Record<string, unknown>));
  }

  // ─── Activity CRUD ──────────────────────────────────────────────────────

  async recordActivity(activity: ProvActivity): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO prov_activities (id, type, started_at, ended_at, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        activity.id,
        activity.type,
        activity.startedAt,
        activity.endedAt ?? null,
        activity.metadata ?? null,
        activity.createdAt,
      ],
    });
  }

  async getActivity(id: string): Promise<ProvActivity | undefined> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM prov_activities WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return mapActivity(row as Record<string, unknown>);
  }

  // ─── Agent CRUD ─────────────────────────────────────────────────────────

  async recordAgent(agent: ProvAgent): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO prov_agents (id, type, name, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [agent.id, agent.type, agent.name, agent.createdAt],
    });
  }

  async getAgent(id: string): Promise<ProvAgent | undefined> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM prov_agents WHERE id = ?`,
      args: [id],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    return mapAgent(row as Record<string, unknown>);
  }

  // ─── Relation CRUD ──────────────────────────────────────────────────────

  async recordRelation(relation: ProvRelation): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO prov_relations (id, type, subject_id, object_id, activity_id, confidence, reasoning, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        relation.id,
        relation.type,
        relation.subjectId,
        relation.objectId,
        relation.activityId ?? null,
        relation.confidence ?? null,
        relation.reasoning ?? null,
        relation.createdAt,
      ],
    });
  }

  async getRelationsForEntity(entityId: string): Promise<ProvRelation[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT * FROM prov_relations WHERE subject_id = ? OR object_id = ? ORDER BY created_at DESC`,
      args: [entityId, entityId],
    });
    return result.rows.map((row) => mapRelation(row as Record<string, unknown>));
  }

  // ─── Lineage Queries ───────────────────────────────────────────────────

  /**
   * Trace the full derivation chain for an entity (what was it derived from, recursively).
   * Returns entities in order from oldest ancestor to the target.
   */
  async getDerivationChain(entityId: string, maxDepth = 10): Promise<ProvEntity[]> {
    await this.ensureInitialized();
    const chain: ProvEntity[] = [];
    const visited = new Set<string>();
    let currentId = entityId;

    for (let depth = 0; depth < maxDepth; depth++) {
      if (visited.has(currentId)) break;
      visited.add(currentId);

      const entity = await this.getEntity(currentId);
      if (!entity) break;
      chain.unshift(entity); // prepend to maintain ancestor-first order

      // Find what this entity was derived from
      const result = await this.client.execute({
        sql: `SELECT object_id FROM prov_relations WHERE subject_id = ? AND type = 'wasDerivedFrom' LIMIT 1`,
        args: [currentId],
      });
      const parentRow = result.rows[0];
      if (!parentRow) break;
      currentId = String(parentRow['object_id']);
    }

    return chain;
  }

  /**
   * Get all entities generated by a specific activity.
   */
  async getEntitiesGeneratedBy(activityId: string): Promise<ProvEntity[]> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT e.* FROM prov_entities e
            JOIN prov_relations r ON r.subject_id = e.id
            WHERE r.object_id = ? AND r.type = 'wasGeneratedBy'
            ORDER BY e.created_at DESC`,
      args: [activityId],
    });
    return result.rows.map((row) => mapEntity(row as Record<string, unknown>));
  }

  // ─── Change Signals (Reactive Propagation) ─────────────────────────────

  async emitChangeSignal(signal: ChangeSignal): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO change_signals (id, source_entity_id, affected_layers, affected_entity_ids, change_type, summary, priority, status, patient_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        signal.id,
        signal.sourceEntityId,
        JSON.stringify(signal.affectedLayers),
        signal.affectedEntityIds ? JSON.stringify(signal.affectedEntityIds) : null,
        signal.changeType,
        signal.summary,
        signal.priority,
        signal.status,
        signal.patientId,
        signal.createdAt,
      ],
    });
  }

  async getPendingSignals(params: {
    patientId: string;
    layer?: number;
    priority?: string;
  }): Promise<ChangeSignal[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?', "status = 'pending'"];
    const args: InValue[] = [params.patientId];

    if (params.layer !== undefined) {
      // JSON array contains the layer number
      conditions.push('affected_layers LIKE ?');
      args.push(`%${params.layer}%`);
    }
    if (params.priority) {
      conditions.push('priority = ?');
      args.push(params.priority);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM change_signals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      args,
    });

    return result.rows.map((row) => mapChangeSignal(row as Record<string, unknown>));
  }

  async acknowledgeSignal(signalId: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE change_signals SET status = 'acknowledged' WHERE id = ?`,
      args: [signalId],
    });
  }

  async dismissSignal(signalId: string): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `UPDATE change_signals SET status = 'dismissed' WHERE id = ?`,
      args: [signalId],
    });
  }

  // ─── Summary Queries ──────────────────────────────────────────────────

  async getEntityCountsByLayer(patientId: string): Promise<Record<number, number>> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT layer, COUNT(*) as count FROM prov_entities WHERE patient_id = ? GROUP BY layer ORDER BY layer`,
      args: [patientId],
    });
    const counts: Record<number, number> = {};
    for (const row of result.rows) {
      const layer = Number(row['layer']);
      counts[layer] = Number(row['count']);
    }
    return counts;
  }

  async getSignalSummary(patientId: string): Promise<{
    pending: number;
    propagated: number;
    acknowledged: number;
    dismissed: number;
  }> {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: `SELECT status, COUNT(*) as count FROM change_signals WHERE patient_id = ? GROUP BY status`,
      args: [patientId],
    });
    const summary = { pending: 0, propagated: 0, acknowledged: 0, dismissed: 0 };
    for (const row of result.rows) {
      const status = String(row['status']) as keyof typeof summary;
      if (status in summary) {
        summary[status] = Number(row['count']);
      }
    }
    return summary;
  }
}

// ─── Row Mappers ──────────────────────────────────────────────────────────

function mapEntity(row: Record<string, unknown>): ProvEntity {
  return {
    id: String(row['id']),
    type: String(row['type']) as ProvEntity['type'],
    layer: Number(row['layer']),
    contentHash: row['content_hash'] ? String(row['content_hash']) : undefined,
    patientId: String(row['patient_id']),
    metadata: row['metadata'] ? String(row['metadata']) : undefined,
    createdAt: String(row['created_at']),
  };
}

function mapActivity(row: Record<string, unknown>): ProvActivity {
  return {
    id: String(row['id']),
    type: String(row['type']) as ProvActivity['type'],
    startedAt: String(row['started_at']),
    endedAt: row['ended_at'] ? String(row['ended_at']) : undefined,
    metadata: row['metadata'] ? String(row['metadata']) : undefined,
    createdAt: String(row['created_at']),
  };
}

function mapAgent(row: Record<string, unknown>): ProvAgent {
  return {
    id: String(row['id']),
    type: String(row['type']) as ProvAgent['type'],
    name: String(row['name']),
    createdAt: String(row['created_at']),
  };
}

function mapRelation(row: Record<string, unknown>): ProvRelation {
  return {
    id: String(row['id']),
    type: String(row['type']) as ProvRelation['type'],
    subjectId: String(row['subject_id']),
    objectId: String(row['object_id']),
    activityId: row['activity_id'] ? String(row['activity_id']) : undefined,
    confidence: row['confidence'] !== null ? Number(row['confidence']) : undefined,
    reasoning: row['reasoning'] ? String(row['reasoning']) : undefined,
    createdAt: String(row['created_at']),
  };
}

function mapChangeSignal(row: Record<string, unknown>): ChangeSignal {
  const affectedLayers: number[] = JSON.parse(String(row['affected_layers']));
  const affectedEntityIdsRaw = row['affected_entity_ids'];
  const affectedEntityIds: string[] | undefined = affectedEntityIdsRaw
    ? JSON.parse(String(affectedEntityIdsRaw))
    : undefined;

  return {
    id: String(row['id']),
    sourceEntityId: String(row['source_entity_id']),
    affectedLayers,
    affectedEntityIds,
    changeType: String(row['change_type']) as ChangeSignal['changeType'],
    summary: String(row['summary']),
    priority: String(row['priority']) as ChangeSignal['priority'],
    status: String(row['status']) as ChangeSignal['status'],
    patientId: String(row['patient_id']),
    createdAt: String(row['created_at']),
  };
}

// ─── Singleton ────────────────────────────────────────────────────────────

let instance: ProvenanceStore | undefined;

export function getProvenanceStore(): ProvenanceStore {
  if (!instance) {
    instance = new ProvenanceStore();
  }
  return instance;
}
