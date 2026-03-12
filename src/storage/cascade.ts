import { randomUUID } from 'node:crypto';
import type { ChangeSignal } from '../schemas/provenance.js';
import { logger } from '../utils/logger.js';
import type { ClinicalStore } from './clinical-store.js';
import type { ProvenanceStore } from './provenance-store.js';

/**
 * Layer dependency graph — defines what layers are affected when a given layer changes.
 *
 * L0 (source docs) → L2 (structured records) → L3 (embeddings) → L4 (research) → L5 (reports)
 *
 * Used by the cascade orchestrator to determine which downstream layers
 * need processing when a change signal arrives.
 */
const LAYER_DEPENDENCIES: Record<number, number[]> = {
  0: [2, 3, 5], // Source doc change → structured records, embeddings, reports
  2: [3, 4, 5], // Structured record change → embeddings, research, reports
  3: [4, 5], // Embedding change → research, reports
  4: [5], // Research change → reports
  5: [], // Report change → nothing (terminal layer)
};

/**
 * Ordered cascade actions — when processing signals at a given layer,
 * these are the steps that should execute in order.
 */
const CASCADE_ACTIONS: Record<number, string[]> = {
  2: ['extract-findings', 'update-diagnoses', 'update-progressions'],
  3: ['re-embed-documents'],
  4: ['update-research-findings'],
  5: ['flag-report-regeneration'],
};

/** Result of processing a single change signal through the cascade. */
export interface CascadeAction {
  signalId: string;
  sourceLayer: number;
  targetLayer: number;
  action: string;
  status: 'executed' | 'skipped' | 'failed';
  detail: string;
}

/** Result of processing all pending signals for a patient. */
export interface CascadeResult {
  patientId: string;
  signalsProcessed: number;
  signalsSkipped: number;
  actions: CascadeAction[];
  newSignalsEmitted: number;
  dryRun: boolean;
  startedAt: string;
  completedAt: string;
}

/**
 * CascadeOrchestrator — consumes pending change signals and determines downstream effects.
 *
 * Design principles:
 * 1. Read-only analysis by default (dryRun: true) — shows what WOULD happen
 * 2. When executing, wraps multi-table operations in provenance audit trail
 * 3. Idempotent — processing the same signal twice produces the same result
 * 4. Ordered — processes layers in dependency order (L0 → L2 → L3 → L4 → L5)
 *
 * This orchestrator does NOT perform the actual extraction/regeneration work.
 * It determines WHAT needs to happen and records the cascade in provenance.
 * External agents (Claude Code via MCP) then execute the individual steps.
 */
export class CascadeOrchestrator {
  constructor(
    private provenance: ProvenanceStore,
    private _clinical: ClinicalStore,
  ) {}

  /** Access the clinical store (used by cascade actions that need data queries). */
  get clinical(): ClinicalStore {
    return this._clinical;
  }

  /**
   * Process all pending change signals for a patient.
   *
   * @param patientId - Patient to process signals for
   * @param dryRun - If true, analyze but don't modify state (default: true)
   * @returns CascadeResult with detailed action log
   */
  async processPendingSignals(patientId: string, dryRun = true): Promise<CascadeResult> {
    const startedAt = new Date().toISOString();
    const actions: CascadeAction[] = [];
    let signalsProcessed = 0;
    let signalsSkipped = 0;
    let newSignalsEmitted = 0;

    // Fetch all pending signals, sorted by layer (process lower layers first)
    const pendingSignals = await this.provenance.getPendingSignals({ patientId });
    const sortedSignals = this.sortBySourceLayer(pendingSignals);

    for (const signal of sortedSignals) {
      const sourceLayer = this.inferSourceLayer(signal);
      const downstreamLayers = LAYER_DEPENDENCIES[sourceLayer] ?? [];

      if (downstreamLayers.length === 0) {
        signalsSkipped++;
        continue;
      }

      signalsProcessed++;

      // For each downstream layer, determine required actions
      for (const targetLayer of downstreamLayers) {
        const layerActions = CASCADE_ACTIONS[targetLayer] ?? [];
        for (const action of layerActions) {
          const cascadeAction = this.buildCascadeAction(signal, sourceLayer, targetLayer, action);
          actions.push(cascadeAction);
        }
      }

      // Record cascade in provenance and acknowledge signal
      if (!dryRun) {
        await this.recordCascadeActivity(signal, actions, patientId);
        await this.provenance.acknowledgeSignal(signal.id);

        // Emit downstream signals for layers that need processing
        for (const targetLayer of downstreamLayers) {
          await this.emitDownstreamSignal(signal, targetLayer, patientId);
          newSignalsEmitted++;
        }
      }
    }

    const completedAt = new Date().toISOString();
    return {
      patientId,
      signalsProcessed,
      signalsSkipped,
      actions,
      newSignalsEmitted,
      dryRun,
      startedAt,
      completedAt,
    };
  }

  /**
   * Get the full dependency chain for a given layer — all layers that would
   * be affected by a change at the source layer (transitive closure).
   */
  getDownstreamLayers(sourceLayer: number): number[] {
    const visited = new Set<number>();
    const queue = [sourceLayer];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const deps = LAYER_DEPENDENCIES[current] ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }
    return [...visited].sort((a, b) => a - b);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  /** Sort signals by source layer (ascending) so lower layers process first. */
  private sortBySourceLayer(signals: ChangeSignal[]): ChangeSignal[] {
    return [...signals].sort((a, b) => {
      const layerA = Math.min(...a.affectedLayers);
      const layerB = Math.min(...b.affectedLayers);
      return layerA - layerB;
    });
  }

  /** Infer which layer the signal originated from based on affectedLayers. */
  private inferSourceLayer(signal: ChangeSignal): number {
    // The source layer is typically the lowest layer in the affectedLayers array,
    // since changes propagate upward. If only one layer, that's the source.
    const layers = signal.affectedLayers;
    if (layers.length === 0) return 0;
    return Math.min(...layers);
  }

  /** Build a cascade action describing what needs to happen at a target layer. */
  private buildCascadeAction(
    signal: ChangeSignal,
    sourceLayer: number,
    targetLayer: number,
    action: string,
  ): CascadeAction {
    return {
      signalId: signal.id,
      sourceLayer,
      targetLayer,
      action,
      status: 'executed',
      detail: `${signal.changeType} at L${sourceLayer} → ${action} at L${targetLayer}: ${signal.summary}`,
    };
  }

  /** Record the cascade activity in W3C PROV provenance. */
  private async recordCascadeActivity(
    signal: ChangeSignal,
    actions: CascadeAction[],
    patientId: string,
  ): Promise<void> {
    const activityId = `cascade-${randomUUID()}`;
    const now = new Date().toISOString();

    await this.provenance.recordActivity({
      id: activityId,
      type: 'transform',
      startedAt: now,
      endedAt: now,
      metadata: JSON.stringify({
        cascadeActions: actions.length,
        sourceSignalId: signal.id,
        patientId,
      }),
      createdAt: now,
    });

    // Link cascade activity to source signal's entity via wasInformedBy
    await this.provenance.recordRelation({
      id: `rel-${randomUUID()}`,
      type: 'wasInformedBy',
      subjectId: activityId,
      objectId: signal.sourceEntityId,
      createdAt: now,
    });

    logger.debug(`Cascade activity ${activityId} recorded for signal ${signal.id}`);
  }

  /** Emit a downstream change signal for a target layer. */
  private async emitDownstreamSignal(
    sourceSignal: ChangeSignal,
    targetLayer: number,
    patientId: string,
  ): Promise<void> {
    await this.provenance.emitChangeSignal({
      id: `csig-cascade-${randomUUID()}`,
      sourceEntityId: sourceSignal.sourceEntityId,
      affectedLayers: [targetLayer],
      changeType: sourceSignal.changeType,
      summary: `Cascade from L${this.inferSourceLayer(sourceSignal)}: ${sourceSignal.summary}`,
      priority: sourceSignal.priority,
      status: 'pending',
      patientId,
      createdAt: new Date().toISOString(),
    });
  }
}
