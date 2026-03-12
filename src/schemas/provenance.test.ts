import {
  changeSignalSchema,
  provActivitySchema,
  provAgentSchema,
  provEntitySchema,
  provRelationSchema,
} from './provenance.js';

describe('provEntitySchema', () => {
  it('accepts a valid source document entity', () => {
    const result = provEntitySchema.safeParse({
      id: 'entity-source-doc-001',
      type: 'source-doc',
      layer: 0,
      contentHash: 'abc123def456',
      patientId: 'patient-001',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Layer 2 imaging finding entity', () => {
    const result = provEntitySchema.safeParse({
      id: 'entity-finding-001',
      type: 'imaging-finding',
      layer: 2,
      patientId: 'patient-001',
      metadata: JSON.stringify({ anatomicalLocation: 'C7/T1', findingType: 'extrusion' }),
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a Layer 5 report version entity', () => {
    const result = provEntitySchema.safeParse({
      id: 'entity-report-v5.3',
      type: 'report-version',
      layer: 5,
      contentHash: 'sha256-report-hash',
      patientId: 'patient-001',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid entity type', () => {
    const result = provEntitySchema.safeParse({
      id: 'entity-bad',
      type: 'invalid-type',
      layer: 0,
      patientId: 'p1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects layer outside 0-5 range', () => {
    const result = provEntitySchema.safeParse({
      id: 'entity-bad',
      type: 'source-doc',
      layer: 6,
      patientId: 'p1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('requires mandatory fields', () => {
    const result = provEntitySchema.safeParse({
      id: 'entity-partial',
      type: 'source-doc',
    });
    expect(result.success).toBe(false);
  });
});

describe('provActivitySchema', () => {
  it('accepts a complete extraction activity', () => {
    const result = provActivitySchema.safeParse({
      id: 'activity-extract-001',
      type: 'extract',
      startedAt: '2026-03-12T10:00:00Z',
      endedAt: '2026-03-12T10:05:00Z',
      metadata: JSON.stringify({ tool: 'tesseract-5.x', confidence: 0.95 }),
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an activity without endedAt (still running)', () => {
    const result = provActivitySchema.safeParse({
      id: 'activity-infer-001',
      type: 'infer',
      startedAt: '2026-03-12T10:00:00Z',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates activity type enum', () => {
    const result = provActivitySchema.safeParse({
      id: 'activity-bad',
      type: 'invalid-activity',
      startedAt: '2026-03-12T10:00:00Z',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('provAgentSchema', () => {
  it('accepts a human agent', () => {
    const result = provAgentSchema.safeParse({
      id: 'agent-user-andrzej',
      type: 'human',
      name: 'user:andrzej',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an AI agent', () => {
    const result = provAgentSchema.safeParse({
      id: 'agent-asklepios',
      type: 'agent',
      name: 'asklepios',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a system tool agent', () => {
    const result = provAgentSchema.safeParse({
      id: 'agent-tesseract',
      type: 'system',
      name: 'tesseract-5.x+pol+eng',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agent type', () => {
    const result = provAgentSchema.safeParse({
      id: 'agent-bad',
      type: 'robot',
      name: 'robot-1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('provRelationSchema', () => {
  it('accepts a wasGeneratedBy relation', () => {
    const result = provRelationSchema.safeParse({
      id: 'rel-001',
      type: 'wasGeneratedBy',
      subjectId: 'entity-finding-001',
      objectId: 'activity-extract-001',
      confidence: 0.95,
      reasoning: 'LLM extraction from imaging report text',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a wasDerivedFrom relation with activity context', () => {
    const result = provRelationSchema.safeParse({
      id: 'rel-002',
      type: 'wasDerivedFrom',
      subjectId: 'entity-finding-001',
      objectId: 'entity-source-doc-001',
      activityId: 'activity-extract-001',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid relation type', () => {
    const result = provRelationSchema.safeParse({
      id: 'rel-bad',
      type: 'createdBy',
      subjectId: 'a',
      objectId: 'b',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0-1 range', () => {
    const result = provRelationSchema.safeParse({
      id: 'rel-bad',
      type: 'wasGeneratedBy',
      subjectId: 'a',
      objectId: 'b',
      confidence: 1.5,
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('changeSignalSchema', () => {
  it('accepts a valid new-data change signal', () => {
    const result = changeSignalSchema.safeParse({
      id: 'signal-001',
      sourceEntityId: 'entity-source-doc-new',
      affectedLayers: [1, 2, 3, 4, 5],
      changeType: 'new',
      summary: 'New cervical MRI report from Skanmex (December 2022)',
      priority: 'high',
      status: 'pending',
      patientId: 'patient-001',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a signal with specific affected entity IDs', () => {
    const result = changeSignalSchema.safeParse({
      id: 'signal-002',
      sourceEntityId: 'entity-finding-c7t1',
      affectedLayers: [4, 5],
      affectedEntityIds: ['entity-hypothesis-h2', 'entity-report-v5.3'],
      changeType: 'new',
      summary: 'New C7/T1 extrusion finding affects myelopathy hypothesis and report',
      priority: 'critical',
      status: 'pending',
      patientId: 'patient-001',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates change type enum', () => {
    const result = changeSignalSchema.safeParse({
      id: 'signal-bad',
      sourceEntityId: 'e1',
      affectedLayers: [5],
      changeType: 'modified',
      summary: 'test',
      priority: 'medium',
      status: 'pending',
      patientId: 'p1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('validates priority enum', () => {
    const result = changeSignalSchema.safeParse({
      id: 'signal-bad',
      sourceEntityId: 'e1',
      affectedLayers: [5],
      changeType: 'new',
      summary: 'test',
      priority: 'urgent',
      status: 'pending',
      patientId: 'p1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('validates status enum', () => {
    const result = changeSignalSchema.safeParse({
      id: 'signal-bad',
      sourceEntityId: 'e1',
      affectedLayers: [5],
      changeType: 'new',
      summary: 'test',
      priority: 'medium',
      status: 'processed',
      patientId: 'p1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects layer numbers outside 0-5', () => {
    const result = changeSignalSchema.safeParse({
      id: 'signal-bad',
      sourceEntityId: 'e1',
      affectedLayers: [6],
      changeType: 'new',
      summary: 'test',
      priority: 'medium',
      status: 'pending',
      patientId: 'p1',
      createdAt: '2026-03-12T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});
