import {
  certaintyLevelEnum,
  directionEnum,
  evidenceLevelEnum,
  externalIdTypeEnum,
  hypothesisEvidenceLinkSchema,
  researchFindingSchema,
  researchHypothesisSchema,
  researchQuerySchema,
  researchSummarySchema,
} from './research-record.js';

// ─── External ID Type Enum ────────────────────────────────────────────

describe('externalIdTypeEnum', () => {
  it('accepts all valid external ID types', () => {
    for (const t of ['pmid', 'nct', 'orpha', 'omim', 'gene', 'pathway', 'variant', 'doi']) {
      expect(externalIdTypeEnum.safeParse(t).success).toBe(true);
    }
  });

  it('rejects invalid external ID type', () => {
    expect(externalIdTypeEnum.safeParse('genbank').success).toBe(false);
  });
});

// ─── Evidence Level Enum ──────────────────────────────────────────────

describe('evidenceLevelEnum', () => {
  it('accepts all valid evidence levels', () => {
    for (const l of [
      'meta-analysis',
      'rct',
      'cohort',
      'case-series',
      'case-report',
      'review',
      'expert-opinion',
      'unknown',
    ]) {
      expect(evidenceLevelEnum.safeParse(l).success).toBe(true);
    }
  });

  it('rejects invalid evidence level', () => {
    expect(evidenceLevelEnum.safeParse('anecdotal').success).toBe(false);
  });
});

// ─── Direction Enum ───────────────────────────────────────────────────

describe('directionEnum', () => {
  it('accepts all valid directions', () => {
    for (const d of ['supporting', 'contradicting', 'neutral', 'inconclusive']) {
      expect(directionEnum.safeParse(d).success).toBe(true);
    }
  });

  it('rejects invalid direction', () => {
    expect(directionEnum.safeParse('confirming').success).toBe(false);
  });
});

// ─── Certainty Level Enum ─────────────────────────────────────────────

describe('certaintyLevelEnum', () => {
  it('accepts all certainty levels', () => {
    for (const c of ['ESTABLISHED', 'STRONG', 'MODERATE', 'WEAK', 'SPECULATIVE']) {
      expect(certaintyLevelEnum.safeParse(c).success).toBe(true);
    }
  });

  it('rejects lowercase certainty level', () => {
    expect(certaintyLevelEnum.safeParse('moderate').success).toBe(false);
  });
});

// ─── Research Finding Schema ──────────────────────────────────────────

describe('researchFindingSchema', () => {
  it('accepts a complete research finding', () => {
    const result = researchFindingSchema.safeParse({
      id: 'finding-001',
      patientId: 'patient-001',
      source: 'PubMed',
      sourceTool: 'deepResearch',
      externalId: '39465424',
      externalIdType: 'pmid',
      title: 'CBS/MTHFR homocysteine metabolism and sensory axonal neuropathy',
      summary: 'Elevated homocysteine causes axonal damage via oxidative stress',
      url: 'https://pubmed.ncbi.nlm.nih.gov/39465424/',
      relevance: 0.85,
      evidenceLevel: 'cohort',
      researchQueryId: 'rquery-001',
      date: '2026-03-09',
      rawData: '{"pmid":"39465424","title":"..."}',
      evidenceTier: 'T1-official',
      validationStatus: 'unvalidated',
      sourceCredibility: 85,
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal research finding (required fields only)', () => {
    const result = researchFindingSchema.safeParse({
      id: 'finding-002',
      patientId: 'patient-001',
      source: 'BioMCP/DGIdb',
      title: 'COMT drug interaction',
      summary: 'COMT-Bupropion interaction documented',
      date: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('rejects relevance outside 0-1 range', () => {
    const result = researchFindingSchema.safeParse({
      id: 'finding-003',
      patientId: 'patient-001',
      source: 'PubMed',
      title: 'Test',
      summary: 'Test',
      date: '2026-03-09',
      relevance: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid externalIdType', () => {
    const result = researchFindingSchema.safeParse({
      id: 'finding-004',
      patientId: 'patient-001',
      source: 'PubMed',
      title: 'Test',
      summary: 'Test',
      date: '2026-03-09',
      externalIdType: 'genbank',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = researchFindingSchema.safeParse({
      id: 'finding-005',
      patientId: 'patient-001',
      // missing source, title, summary, date
    });
    expect(result.success).toBe(false);
  });
});

// ─── Research Query Schema ────────────────────────────────────────────

describe('researchQuerySchema', () => {
  it('accepts a complete research query', () => {
    const result = researchQuerySchema.safeParse({
      id: 'rquery-001',
      patientId: 'patient-001',
      query: 'homocysteine neuropathy CBS MTHFR',
      toolUsed: 'deepResearch',
      agent: 'research-agent',
      resultCount: 10,
      findingIds: ['finding-001', 'finding-002'],
      synthesis: 'Homocysteine metabolism genes may contribute to neuropathy via oxidative stress',
      gaps: ['No direct measurement of homocysteine levels', 'Missing methylmalonic acid test'],
      suggestedFollowUp: ['Search for CBS deficiency neuropathy case reports'],
      stage: 4,
      date: '2026-03-09',
      durationMs: 12500,
      evidenceTier: 'T3-ai-inferred',
      validationStatus: 'unvalidated',
      sourceCredibility: 75,
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal research query', () => {
    const result = researchQuerySchema.safeParse({
      id: 'rquery-002',
      patientId: 'patient-001',
      query: 'LDN chronic neuropathic pain',
      toolUsed: 'biomcp_article_searcher',
      date: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('rejects stage outside 0-9 range', () => {
    const result = researchQuerySchema.safeParse({
      id: 'rquery-003',
      patientId: 'patient-001',
      query: 'test',
      toolUsed: 'test',
      date: '2026-03-09',
      stage: 15,
    });
    expect(result.success).toBe(false);
  });
});

// ─── Research Hypothesis Schema ───────────────────────────────────────

describe('researchHypothesisSchema', () => {
  it('accepts a complete hypothesis', () => {
    const result = researchHypothesisSchema.safeParse({
      id: 'hyp-001',
      patientId: 'patient-001',
      name: 'Granulomatosis with Polyangiitis (GPA)',
      icdCode: 'M31.3',
      probabilityLow: 35,
      probabilityHigh: 55,
      advocateCase: 'PR3-ANCA positive with persistent leukopenia supports active GPA',
      skepticCase: 'No organ involvement documented — renal and pulmonary clear',
      arbiterVerdict: 'Plausible but needs confirmatory testing',
      evidenceTier: 'T1',
      certaintyLevel: 'MODERATE',
      stage: 5,
      version: 1,
      date: '2026-03-09',
      validationStatus: 'unvalidated',
      sourceCredibility: 80,
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal hypothesis (required fields only)', () => {
    const result = researchHypothesisSchema.safeParse({
      id: 'hyp-002',
      patientId: 'patient-001',
      name: 'CVJ Syndrome',
      date: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('rejects probability outside 0-100', () => {
    const result = researchHypothesisSchema.safeParse({
      id: 'hyp-003',
      patientId: 'patient-001',
      name: 'Test',
      date: '2026-03-09',
      probabilityLow: -10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid certainty level', () => {
    const result = researchHypothesisSchema.safeParse({
      id: 'hyp-004',
      patientId: 'patient-001',
      name: 'Test',
      date: '2026-03-09',
      certaintyLevel: 'UNKNOWN',
    });
    expect(result.success).toBe(false);
  });

  it('validates version is positive integer', () => {
    const result = researchHypothesisSchema.safeParse({
      id: 'hyp-005',
      patientId: 'patient-001',
      name: 'Test',
      date: '2026-03-09',
      version: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts supersededBy for version chains', () => {
    const result = researchHypothesisSchema.safeParse({
      id: 'hyp-001-v1',
      patientId: 'patient-001',
      name: 'GPA',
      date: '2026-03-09',
      version: 1,
      supersededBy: 'hyp-001-v2',
    });
    expect(result.success).toBe(true);
  });
});

// ─── Hypothesis Evidence Link Schema ──────────────────────────────────

describe('hypothesisEvidenceLinkSchema', () => {
  it('accepts a link to a research finding', () => {
    const result = hypothesisEvidenceLinkSchema.safeParse({
      id: 'elink-001',
      patientId: 'patient-001',
      hypothesisId: 'hyp-001',
      findingId: 'finding-001',
      direction: 'supporting',
      claim: 'PR3-ANCA positive supports GPA diagnosis',
      confidence: 0.8,
      tier: 'T1',
      date: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a link to a clinical record', () => {
    const result = hypothesisEvidenceLinkSchema.safeParse({
      id: 'elink-002',
      patientId: 'patient-001',
      hypothesisId: 'hyp-001',
      clinicalRecordId: 'lab-wbc-2025',
      clinicalRecordType: 'lab-result',
      direction: 'supporting',
      claim: 'Chronic leukopenia consistent with GPA',
      date: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('accepts contradicting direction', () => {
    const result = hypothesisEvidenceLinkSchema.safeParse({
      id: 'elink-003',
      patientId: 'patient-001',
      hypothesisId: 'hyp-001',
      findingId: 'finding-002',
      direction: 'contradicting',
      claim: 'No renal involvement argues against GPA',
      date: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid clinical record type', () => {
    const result = hypothesisEvidenceLinkSchema.safeParse({
      id: 'elink-004',
      patientId: 'patient-001',
      hypothesisId: 'hyp-001',
      clinicalRecordId: 'rec-001',
      clinicalRecordType: 'imaging-report', // not a valid Layer 2A type
      direction: 'neutral',
      claim: 'test',
      date: '2026-03-09',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence outside 0-1 range', () => {
    const result = hypothesisEvidenceLinkSchema.safeParse({
      id: 'elink-005',
      patientId: 'patient-001',
      hypothesisId: 'hyp-001',
      findingId: 'finding-001',
      direction: 'supporting',
      claim: 'test',
      confidence: 1.5,
      date: '2026-03-09',
    });
    expect(result.success).toBe(false);
  });

  it('requires direction and claim', () => {
    const result = hypothesisEvidenceLinkSchema.safeParse({
      id: 'elink-006',
      patientId: 'patient-001',
      hypothesisId: 'hyp-001',
      findingId: 'finding-001',
      date: '2026-03-09',
      // missing direction and claim
    });
    expect(result.success).toBe(false);
  });
});

// ─── Research Summary Schema ──────────────────────────────────────────

describe('researchSummarySchema', () => {
  it('accepts a complete research summary', () => {
    const result = researchSummarySchema.safeParse({
      patientId: 'patient-001',
      findingCount: 42,
      queryCount: 7,
      hypothesisCount: 5,
      evidenceLinkCount: 23,
      topSources: [
        { source: 'PubMed', count: 25 },
        { source: 'BioMCP/DGIdb', count: 10 },
        { source: 'ClinicalTrials.gov', count: 7 },
      ],
      latestQueryDate: '2026-03-09',
      latestFindingDate: '2026-03-09',
    });
    expect(result.success).toBe(true);
  });

  it('accepts summary with zero counts', () => {
    const result = researchSummarySchema.safeParse({
      patientId: 'patient-001',
      findingCount: 0,
      queryCount: 0,
      hypothesisCount: 0,
      evidenceLinkCount: 0,
      topSources: [],
    });
    expect(result.success).toBe(true);
  });
});
