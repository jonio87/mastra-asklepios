import type {
  ChangeSignal,
  ProvActivity,
  ProvAgent,
  ProvEntity,
  ProvRelation,
} from '../schemas/provenance.js';
import { ProvenanceStore } from './provenance-store.js';

const TEST_PATIENT = 'patient-test-prov';

describe('ProvenanceStore', () => {
  let store: ProvenanceStore;

  beforeAll(async () => {
    store = new ProvenanceStore('file::memory:?cache=shared');
    await store.ensureInitialized();
  });

  afterAll(async () => {
    await store.close();
  });

  // ─── Entity CRUD ──────────────────────────────────────────────────

  describe('entities', () => {
    it('stores and retrieves a provenance entity', async () => {
      const entity: ProvEntity = {
        id: 'entity-source-doc-001',
        type: 'source-doc',
        layer: 0,
        contentHash: 'abc123',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:00:00Z',
      };
      await store.recordEntity(entity);

      const retrieved = await store.getEntity('entity-source-doc-001');
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('source-doc');
      expect(retrieved?.layer).toBe(0);
      expect(retrieved?.contentHash).toBe('abc123');
      expect(retrieved?.patientId).toBe(TEST_PATIENT);
    });

    it('returns undefined for non-existent entity', async () => {
      const result = await store.getEntity('does-not-exist');
      expect(result).toBeUndefined();
    });

    it('queries entities by type and layer', async () => {
      await store.recordEntity({
        id: 'entity-finding-001',
        type: 'imaging-finding',
        layer: 2,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:01:00Z',
      });
      await store.recordEntity({
        id: 'entity-finding-002',
        type: 'imaging-finding',
        layer: 2,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:02:00Z',
      });
      await store.recordEntity({
        id: 'entity-report-001',
        type: 'report-version',
        layer: 5,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:03:00Z',
      });

      const findings = await store.getEntitiesByType({
        patientId: TEST_PATIENT,
        type: 'imaging-finding',
      });
      expect(findings.length).toBe(2);

      const layer2 = await store.getEntitiesByType({
        patientId: TEST_PATIENT,
        layer: 2,
      });
      expect(layer2.length).toBe(2);

      const reports = await store.getEntitiesByType({
        patientId: TEST_PATIENT,
        type: 'report-version',
      });
      expect(reports.length).toBe(1);
    });

    it('upserts entity on duplicate id', async () => {
      await store.recordEntity({
        id: 'entity-upsert',
        type: 'source-doc',
        layer: 0,
        contentHash: 'hash-v1',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:00:00Z',
      });
      await store.recordEntity({
        id: 'entity-upsert',
        type: 'source-doc',
        layer: 0,
        contentHash: 'hash-v2',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:01:00Z',
      });
      const result = await store.getEntity('entity-upsert');
      expect(result?.contentHash).toBe('hash-v2');
    });
  });

  // ─── Activity CRUD ────────────────────────────────────────────────

  describe('activities', () => {
    it('stores and retrieves an activity', async () => {
      const activity: ProvActivity = {
        id: 'activity-extract-001',
        type: 'extract',
        startedAt: '2026-03-12T10:00:00Z',
        endedAt: '2026-03-12T10:05:00Z',
        metadata: JSON.stringify({ tool: 'tesseract-5.x', pages: 1 }),
        createdAt: '2026-03-12T10:00:00Z',
      };
      await store.recordActivity(activity);

      const retrieved = await store.getActivity('activity-extract-001');
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('extract');
      expect(retrieved?.endedAt).toBe('2026-03-12T10:05:00Z');
    });

    it('accepts activity without endedAt', async () => {
      await store.recordActivity({
        id: 'activity-running',
        type: 'infer',
        startedAt: '2026-03-12T10:00:00Z',
        createdAt: '2026-03-12T10:00:00Z',
      });
      const result = await store.getActivity('activity-running');
      expect(result).toBeDefined();
      expect(result?.endedAt).toBeUndefined();
    });
  });

  // ─── Agent CRUD ───────────────────────────────────────────────────

  describe('agents', () => {
    it('stores and retrieves an agent', async () => {
      const agent: ProvAgent = {
        id: 'agent-tesseract',
        type: 'system',
        name: 'tesseract-5.x+pol+eng',
        createdAt: '2026-03-12T10:00:00Z',
      };
      await store.recordAgent(agent);

      const retrieved = await store.getAgent('agent-tesseract');
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('system');
      expect(retrieved?.name).toBe('tesseract-5.x+pol+eng');
    });
  });

  // ─── Relation CRUD ────────────────────────────────────────────────

  describe('relations', () => {
    it('stores and retrieves relations for an entity', async () => {
      const relation: ProvRelation = {
        id: 'rel-gen-001',
        type: 'wasGeneratedBy',
        subjectId: 'entity-finding-001',
        objectId: 'activity-extract-001',
        confidence: 0.95,
        reasoning: 'LLM extraction from imaging report',
        createdAt: '2026-03-12T10:00:00Z',
      };
      await store.recordRelation(relation);

      const derived: ProvRelation = {
        id: 'rel-derived-001',
        type: 'wasDerivedFrom',
        subjectId: 'entity-finding-001',
        objectId: 'entity-source-doc-001',
        activityId: 'activity-extract-001',
        createdAt: '2026-03-12T10:00:00Z',
      };
      await store.recordRelation(derived);

      const relations = await store.getRelationsForEntity('entity-finding-001');
      expect(relations.length).toBe(2);
      expect(relations.map((r) => r.type).sort()).toEqual(['wasDerivedFrom', 'wasGeneratedBy']);
    });
  });

  // ─── Lineage Queries ──────────────────────────────────────────────

  describe('derivation chain', () => {
    it('traces the full derivation chain', async () => {
      // Set up a 3-level chain: source-doc → imaging-report → imaging-finding
      await store.recordEntity({
        id: 'chain-l0',
        type: 'source-doc',
        layer: 0,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:00:00Z',
      });
      await store.recordEntity({
        id: 'chain-l2a',
        type: 'imaging-report',
        layer: 2,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:01:00Z',
      });
      await store.recordEntity({
        id: 'chain-l2b',
        type: 'imaging-finding',
        layer: 2,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:02:00Z',
      });
      await store.recordRelation({
        id: 'chain-rel-1',
        type: 'wasDerivedFrom',
        subjectId: 'chain-l2a',
        objectId: 'chain-l0',
        createdAt: '2026-03-12T10:01:00Z',
      });
      await store.recordRelation({
        id: 'chain-rel-2',
        type: 'wasDerivedFrom',
        subjectId: 'chain-l2b',
        objectId: 'chain-l2a',
        createdAt: '2026-03-12T10:02:00Z',
      });

      const chain = await store.getDerivationChain('chain-l2b');
      expect(chain.length).toBe(3);
      expect(chain[0]?.id).toBe('chain-l0');
      expect(chain[1]?.id).toBe('chain-l2a');
      expect(chain[2]?.id).toBe('chain-l2b');
    });

    it('returns single entity when no derivation exists', async () => {
      await store.recordEntity({
        id: 'chain-orphan',
        type: 'source-doc',
        layer: 0,
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:00:00Z',
      });
      const chain = await store.getDerivationChain('chain-orphan');
      expect(chain.length).toBe(1);
      expect(chain[0]?.id).toBe('chain-orphan');
    });
  });

  // ─── Change Signals ───────────────────────────────────────────────

  describe('change signals', () => {
    it('emits and retrieves pending signals', async () => {
      const signal: ChangeSignal = {
        id: 'signal-001',
        sourceEntityId: 'entity-source-doc-001',
        affectedLayers: [1, 2, 3, 4, 5],
        changeType: 'new',
        summary: 'New cervical MRI report from Skanmex (December 2022)',
        priority: 'high',
        status: 'pending',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:00:00Z',
      };
      await store.emitChangeSignal(signal);

      const pending = await store.getPendingSignals({ patientId: TEST_PATIENT });
      expect(pending.length).toBeGreaterThanOrEqual(1);
      const found = pending.find((s) => s.id === 'signal-001');
      expect(found).toBeDefined();
      expect(found?.affectedLayers).toEqual([1, 2, 3, 4, 5]);
      expect(found?.priority).toBe('high');
    });

    it('filters pending signals by layer', async () => {
      await store.emitChangeSignal({
        id: 'signal-layer5-only',
        sourceEntityId: 'entity-finding-001',
        affectedLayers: [5],
        changeType: 'updated',
        summary: 'Diagnosis status changed',
        priority: 'medium',
        status: 'pending',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:01:00Z',
      });

      const layer5 = await store.getPendingSignals({ patientId: TEST_PATIENT, layer: 5 });
      expect(layer5.length).toBeGreaterThanOrEqual(2); // signal-001 + signal-layer5-only

      const layer3 = await store.getPendingSignals({ patientId: TEST_PATIENT, layer: 3 });
      // signal-001 has layer 3, signal-layer5-only does not
      const found3 = layer3.find((s) => s.id === 'signal-layer5-only');
      expect(found3).toBeUndefined();
    });

    it('acknowledges a signal', async () => {
      await store.acknowledgeSignal('signal-layer5-only');
      const pending = await store.getPendingSignals({ patientId: TEST_PATIENT });
      const found = pending.find((s) => s.id === 'signal-layer5-only');
      expect(found).toBeUndefined(); // no longer pending
    });

    it('dismisses a signal', async () => {
      await store.emitChangeSignal({
        id: 'signal-dismiss',
        sourceEntityId: 'entity-source-doc-001',
        affectedLayers: [2],
        changeType: 'new',
        summary: 'Duplicate re-extraction',
        priority: 'low',
        status: 'pending',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:02:00Z',
      });
      await store.dismissSignal('signal-dismiss');
      const pending = await store.getPendingSignals({ patientId: TEST_PATIENT });
      const found = pending.find((s) => s.id === 'signal-dismiss');
      expect(found).toBeUndefined();
    });

    it('preserves affectedEntityIds in round-trip', async () => {
      await store.emitChangeSignal({
        id: 'signal-with-entities',
        sourceEntityId: 'entity-finding-c7t1',
        affectedLayers: [4, 5],
        affectedEntityIds: ['entity-hypothesis-h2', 'entity-report-v5.3'],
        changeType: 'new',
        summary: 'C7/T1 extrusion finding',
        priority: 'critical',
        status: 'pending',
        patientId: TEST_PATIENT,
        createdAt: '2026-03-12T10:03:00Z',
      });
      const pending = await store.getPendingSignals({ patientId: TEST_PATIENT });
      const found = pending.find((s) => s.id === 'signal-with-entities');
      expect(found?.affectedEntityIds).toEqual(['entity-hypothesis-h2', 'entity-report-v5.3']);
    });
  });

  // ─── Summary Queries ──────────────────────────────────────────────

  describe('summary queries', () => {
    it('returns entity counts by layer', async () => {
      const counts = await store.getEntityCountsByLayer(TEST_PATIENT);
      expect(counts[0]).toBeGreaterThanOrEqual(1); // source docs
      expect(counts[2]).toBeGreaterThanOrEqual(1); // findings
      expect(counts[5]).toBeGreaterThanOrEqual(1); // reports
    });

    it('returns signal summary', async () => {
      const summary = await store.getSignalSummary(TEST_PATIENT);
      expect(summary.pending).toBeGreaterThanOrEqual(1);
      expect(summary.acknowledged).toBeGreaterThanOrEqual(1);
      expect(summary.dismissed).toBeGreaterThanOrEqual(1);
      expect(typeof summary.propagated).toBe('number');
    });
  });
});
