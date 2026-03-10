import type {
  HypothesisEvidenceLink,
  ResearchFinding,
  ResearchHypothesis,
  ResearchQuery,
} from '../schemas/research-record.js';
import { ClinicalStore } from './clinical-store.js';

const TEST_PATIENT = 'patient-research-test';

describe('ClinicalStore — Research Persistence', () => {
  let store: ClinicalStore;

  beforeAll(async () => {
    store = new ClinicalStore('file::memory:?cache=shared');
    await store.ensureInitialized();
  });

  afterAll(async () => {
    await store.close();
  });

  // ─── Research Findings ────────────────────────────────────────────

  describe('research findings', () => {
    it('stores and retrieves a research finding', async () => {
      const finding: ResearchFinding = {
        id: 'finding-test-001',
        patientId: TEST_PATIENT,
        source: 'PubMed',
        sourceTool: 'deepResearch',
        externalId: '39465424',
        externalIdType: 'pmid',
        title: 'CBS/MTHFR homocysteine metabolism and neuropathy',
        summary: 'Elevated homocysteine causes axonal damage via oxidative stress',
        url: 'https://pubmed.ncbi.nlm.nih.gov/39465424/',
        relevance: 0.85,
        evidenceLevel: 'cohort',
        researchQueryId: 'rquery-test-001',
        date: '2026-03-09',
      };
      await store.addResearchFinding(finding);

      const results = await store.queryFindings({ patientId: TEST_PATIENT });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'finding-test-001');
      expect(found).toBeDefined();
      expect(found?.source).toBe('PubMed');
      expect(found?.externalId).toBe('39465424');
      expect(found?.externalIdType).toBe('pmid');
      expect(found?.relevance).toBe(0.85);
    });

    it('stores finding with evidence provenance', async () => {
      const finding: ResearchFinding = {
        id: 'finding-test-002',
        patientId: TEST_PATIENT,
        source: 'BioMCP/DGIdb',
        title: 'COMT-Bupropion drug interaction',
        summary: 'DGIdb score 0.219 for COMT-Bupropion interaction',
        date: '2026-03-09',
        evidenceTier: 'T1-official',
        validationStatus: 'confirmed',
        sourceCredibility: 90,
      };
      await store.addResearchFinding(finding);

      const results = await store.queryFindings({
        patientId: TEST_PATIENT,
        source: 'BioMCP/DGIdb',
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'finding-test-002');
      expect(found?.evidenceTier).toBe('T1-official');
      expect(found?.validationStatus).toBe('confirmed');
      expect(found?.sourceCredibility).toBe(90);
    });

    it('filters findings by source', async () => {
      const results = await store.queryFindings({ patientId: TEST_PATIENT, source: 'PubMed' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.source).toBe('PubMed');
      }
    });

    it('filters findings by external ID type', async () => {
      const results = await store.queryFindings({
        patientId: TEST_PATIENT,
        externalIdType: 'pmid',
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.externalIdType).toBe('pmid');
      }
    });

    it('filters findings by evidence level', async () => {
      const results = await store.queryFindings({
        patientId: TEST_PATIENT,
        evidenceLevel: 'cohort',
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.evidenceLevel).toBe('cohort');
      }
    });

    it('filters findings by date range', async () => {
      await store.addResearchFinding({
        id: 'finding-test-old',
        patientId: TEST_PATIENT,
        source: 'PubMed',
        title: 'Old finding',
        summary: 'Old finding summary',
        date: '2020-01-01',
      });

      const recent = await store.queryFindings({
        patientId: TEST_PATIENT,
        dateFrom: '2025-01-01',
      });
      const hasOld = recent.some((r) => r.id === 'finding-test-old');
      expect(hasOld).toBe(false);
    });

    it('filters findings by query ID', async () => {
      const results = await store.queryFindings({
        patientId: TEST_PATIENT,
        queryId: 'rquery-test-001',
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const r of results) {
        expect(r.researchQueryId).toBe('rquery-test-001');
      }
    });

    it('isolates findings by patient ID', async () => {
      await store.addResearchFinding({
        id: 'finding-other-patient',
        patientId: 'patient-other',
        source: 'Orphanet',
        title: 'Other patient finding',
        summary: 'Not for our test patient',
        date: '2026-03-09',
      });

      const results = await store.queryFindings({ patientId: TEST_PATIENT });
      const hasOther = results.some((r) => r.patientId === 'patient-other');
      expect(hasOther).toBe(false);
    });
  });

  // ─── Research Queries ─────────────────────────────────────────────

  describe('research queries', () => {
    it('stores and retrieves a research query', async () => {
      const query: ResearchQuery = {
        id: 'rquery-test-001',
        patientId: TEST_PATIENT,
        query: 'homocysteine neuropathy CBS MTHFR',
        toolUsed: 'deepResearch',
        agent: 'research-agent',
        resultCount: 10,
        findingIds: ['finding-test-001', 'finding-test-002'],
        synthesis: 'Homocysteine metabolism genes may contribute to neuropathy',
        gaps: ['No homocysteine measurement', 'Missing methylmalonic acid test'],
        suggestedFollowUp: ['Search for CBS deficiency neuropathy case reports'],
        stage: 4,
        date: '2026-03-09',
        durationMs: 12500,
      };
      await store.addResearchQuery(query);

      const results = await store.queryResearchQueries({ patientId: TEST_PATIENT });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'rquery-test-001');
      expect(found).toBeDefined();
      expect(found?.toolUsed).toBe('deepResearch');
      expect(found?.resultCount).toBe(10);
      expect(found?.stage).toBe(4);
    });

    it('preserves JSON array fields (findingIds, gaps, suggestedFollowUp)', async () => {
      const results = await store.queryResearchQueries({ patientId: TEST_PATIENT });
      const found = results.find((r) => r.id === 'rquery-test-001');
      expect(found?.findingIds).toEqual(['finding-test-001', 'finding-test-002']);
      expect(found?.gaps).toEqual([
        'No homocysteine measurement',
        'Missing methylmalonic acid test',
      ]);
      expect(found?.suggestedFollowUp).toEqual([
        'Search for CBS deficiency neuropathy case reports',
      ]);
    });

    it('filters queries by tool used', async () => {
      await store.addResearchQuery({
        id: 'rquery-test-002',
        patientId: TEST_PATIENT,
        query: 'LDN neuropathic pain clinical trials',
        toolUsed: 'biomcp_article_searcher',
        date: '2026-03-09',
      });

      const results = await store.queryResearchQueries({
        patientId: TEST_PATIENT,
        toolUsed: 'deepResearch',
      });
      for (const r of results) {
        expect(r.toolUsed).toBe('deepResearch');
      }
    });

    it('filters queries by agent', async () => {
      const results = await store.queryResearchQueries({
        patientId: TEST_PATIENT,
        agent: 'research-agent',
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('filters queries by stage', async () => {
      const results = await store.queryResearchQueries({
        patientId: TEST_PATIENT,
        stage: 4,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Hypotheses ───────────────────────────────────────────────────

  describe('hypotheses', () => {
    it('stores and retrieves a hypothesis', async () => {
      const hypothesis: ResearchHypothesis = {
        id: 'hyp-test-001',
        patientId: TEST_PATIENT,
        name: 'Granulomatosis with Polyangiitis (GPA)',
        icdCode: 'M31.3',
        probabilityLow: 35,
        probabilityHigh: 55,
        advocateCase: 'PR3-ANCA positive with persistent leukopenia supports active GPA',
        skepticCase: 'No organ involvement documented',
        arbiterVerdict: 'Plausible but needs confirmatory testing',
        evidenceTier: 'T1',
        certaintyLevel: 'MODERATE',
        stage: 5,
        version: 1,
        date: '2026-03-09',
      };
      await store.addHypothesis(hypothesis);

      const results = await store.queryHypotheses({ patientId: TEST_PATIENT });
      expect(results.length).toBeGreaterThanOrEqual(1);
      const found = results.find((r) => r.id === 'hyp-test-001');
      expect(found).toBeDefined();
      expect(found?.name).toBe('Granulomatosis with Polyangiitis (GPA)');
      expect(found?.probabilityLow).toBe(35);
      expect(found?.certaintyLevel).toBe('MODERATE');
    });

    it('supports hypothesis versioning (supersededBy)', async () => {
      // Version 2 supersedes version 1
      const v2: ResearchHypothesis = {
        id: 'hyp-test-001-v2',
        patientId: TEST_PATIENT,
        name: 'Granulomatosis with Polyangiitis (GPA)',
        icdCode: 'M31.3',
        probabilityLow: 55,
        probabilityHigh: 70,
        advocateCase: 'PR3-ANCA confirmed + leukopenia + Ro-60 positivity',
        skepticCase: 'Still no organ involvement',
        arbiterVerdict: 'Stronger case after lab confirmation',
        evidenceTier: 'T1',
        certaintyLevel: 'STRONG',
        stage: 7,
        version: 2,
        date: '2026-03-09',
      };
      await store.addHypothesis(v2);

      // When latestOnly=true (default), should only get the latest version
      const latest = await store.queryHypotheses({
        patientId: TEST_PATIENT,
        name: 'Granulomatosis with Polyangiitis (GPA)',
      });
      expect(latest.length).toBeGreaterThanOrEqual(1);
      // V2 should be present
      const v2Found = latest.find((h) => h.id === 'hyp-test-001-v2');
      expect(v2Found).toBeDefined();
      expect(v2Found?.probabilityLow).toBe(55);
    });

    it('filters hypotheses by certainty level', async () => {
      await store.addHypothesis({
        id: 'hyp-test-002',
        patientId: TEST_PATIENT,
        name: 'CVJ Syndrome',
        certaintyLevel: 'ESTABLISHED',
        date: '2026-03-09',
      });

      const results = await store.queryHypotheses({
        patientId: TEST_PATIENT,
        certaintyLevel: 'ESTABLISHED',
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      for (const h of results) {
        expect(h.certaintyLevel).toBe('ESTABLISHED');
      }
    });
  });

  // ─── Evidence Links ───────────────────────────────────────────────

  describe('evidence links', () => {
    it('links a research finding to a hypothesis', async () => {
      const link: HypothesisEvidenceLink = {
        id: 'elink-test-001',
        patientId: TEST_PATIENT,
        hypothesisId: 'hyp-test-001',
        findingId: 'finding-test-001',
        direction: 'supporting',
        claim: 'CBS/MTHFR pathway supports GPA via oxidative stress mechanism',
        confidence: 0.75,
        tier: 'T1',
        date: '2026-03-09',
      };
      await store.addEvidenceLink(link);

      const links = await store.queryEvidenceLinks({
        patientId: TEST_PATIENT,
        hypothesisId: 'hyp-test-001',
      });
      expect(links.length).toBeGreaterThanOrEqual(1);
      const found = links.find((l) => l.id === 'elink-test-001');
      expect(found).toBeDefined();
      expect(found?.direction).toBe('supporting');
      expect(found?.confidence).toBe(0.75);
    });

    it('links a clinical record to a hypothesis', async () => {
      const link: HypothesisEvidenceLink = {
        id: 'elink-test-002',
        patientId: TEST_PATIENT,
        hypothesisId: 'hyp-test-001',
        clinicalRecordId: 'lab-wbc-2025',
        clinicalRecordType: 'lab-result',
        direction: 'supporting',
        claim: 'Chronic leukopenia consistent with GPA',
        date: '2026-03-09',
      };
      await store.addEvidenceLink(link);

      const links = await store.queryEvidenceLinks({
        patientId: TEST_PATIENT,
        hypothesisId: 'hyp-test-001',
      });
      expect(links.length).toBeGreaterThanOrEqual(2);
      const found = links.find((l) => l.id === 'elink-test-002');
      expect(found?.clinicalRecordId).toBe('lab-wbc-2025');
      expect(found?.clinicalRecordType).toBe('lab-result');
    });

    it('stores contradicting evidence link', async () => {
      const link: HypothesisEvidenceLink = {
        id: 'elink-test-003',
        patientId: TEST_PATIENT,
        hypothesisId: 'hyp-test-001',
        findingId: 'finding-test-002',
        direction: 'contradicting',
        claim: 'No renal involvement argues against GPA',
        tier: 'T2',
        date: '2026-03-09',
      };
      await store.addEvidenceLink(link);

      const links = await store.queryEvidenceLinks({
        patientId: TEST_PATIENT,
        hypothesisId: 'hyp-test-001',
      });
      const contra = links.filter((l) => l.direction === 'contradicting');
      expect(contra.length).toBeGreaterThanOrEqual(1);
    });

    it('retrieves hypothesis with evidence via getHypothesisWithEvidence', async () => {
      const result = await store.getHypothesisWithEvidence('hyp-test-001');
      expect(result).toBeDefined();
      expect(result?.hypothesis.name).toBe('Granulomatosis with Polyangiitis (GPA)');
      expect(result?.links.length).toBeGreaterThanOrEqual(2);

      const supporting = result?.links.filter((l) => l.direction === 'supporting') ?? [];
      const contradicting = result?.links.filter((l) => l.direction === 'contradicting') ?? [];
      expect(supporting.length).toBeGreaterThanOrEqual(1);
      expect(contradicting.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Research Summary ─────────────────────────────────────────────

  describe('research summary', () => {
    it('returns aggregate metrics', async () => {
      const summary = await store.getPatientResearchSummary(TEST_PATIENT);
      expect(summary.patientId).toBe(TEST_PATIENT);
      expect(summary.findingCount).toBeGreaterThanOrEqual(2);
      expect(summary.queryCount).toBeGreaterThanOrEqual(1);
      expect(summary.hypothesisCount).toBeGreaterThanOrEqual(1);
      expect(summary.evidenceLinkCount).toBeGreaterThanOrEqual(2);
    });

    it('returns top sources ordered by count', async () => {
      const summary = await store.getPatientResearchSummary(TEST_PATIENT);
      expect(summary.topSources.length).toBeGreaterThanOrEqual(1);
      // PubMed and BioMCP/DGIdb should both appear
      const sourceNames = summary.topSources.map((s) => s.source);
      expect(sourceNames).toContain('PubMed');
    });

    it('returns latest dates', async () => {
      const summary = await store.getPatientResearchSummary(TEST_PATIENT);
      expect(summary.latestQueryDate).toBeDefined();
      expect(summary.latestFindingDate).toBeDefined();
    });

    it('returns zero counts for unknown patient', async () => {
      const summary = await store.getPatientResearchSummary('patient-nonexistent');
      expect(summary.findingCount).toBe(0);
      expect(summary.queryCount).toBe(0);
      expect(summary.hypothesisCount).toBe(0);
      expect(summary.evidenceLinkCount).toBe(0);
      expect(summary.topSources).toEqual([]);
    });
  });

  // ─── Deduplication ─────────────────────────────────────────────────

  describe('deduplication', () => {
    const DEDUP_PATIENT = 'patient-dedup-test';

    describe('research findings — external ID dedup', () => {
      it('skips duplicate with same external ID and type', async () => {
        const finding1: ResearchFinding = {
          id: 'dedup-find-001',
          patientId: DEDUP_PATIENT,
          source: 'PubMed',
          externalId: '12345678',
          externalIdType: 'pmid',
          title: 'Original finding',
          summary: 'First version',
          date: '2026-03-09',
        };
        const r1 = await store.addResearchFinding(finding1);
        expect(r1.duplicate).toBe(false);
        expect(r1.id).toBe('dedup-find-001');

        // Same PMID, different id/title/summary
        const finding2: ResearchFinding = {
          id: 'dedup-find-002',
          patientId: DEDUP_PATIENT,
          source: 'PubMed',
          externalId: '12345678',
          externalIdType: 'pmid',
          title: 'Duplicate finding with different title',
          summary: 'Second version',
          date: '2026-03-09',
        };
        const r2 = await store.addResearchFinding(finding2);
        expect(r2.duplicate).toBe(true);
        expect(r2.id).toBe('dedup-find-001'); // Returns existing ID

        // Only one record should exist
        const results = await store.queryFindings({
          patientId: DEDUP_PATIENT,
          externalIdType: 'pmid',
        });
        const pmidMatches = results.filter((r) => r.externalId === '12345678');
        expect(pmidMatches.length).toBe(1);
      });

      it('allows same external ID for different patients', async () => {
        const other: ResearchFinding = {
          id: 'dedup-find-003',
          patientId: 'other-patient',
          source: 'PubMed',
          externalId: '12345678',
          externalIdType: 'pmid',
          title: 'Same PMID different patient',
          summary: 'Should be inserted',
          date: '2026-03-09',
        };
        const result = await store.addResearchFinding(other);
        expect(result.duplicate).toBe(false);
      });

      it('allows different external ID types for same ID number', async () => {
        const nctFinding: ResearchFinding = {
          id: 'dedup-find-004',
          patientId: DEDUP_PATIENT,
          source: 'ClinicalTrials.gov',
          externalId: '12345678',
          externalIdType: 'nct',
          title: 'NCT finding with same number as PMID',
          summary: 'Different type should be separate',
          date: '2026-03-09',
        };
        const result = await store.addResearchFinding(nctFinding);
        expect(result.duplicate).toBe(false);
      });
    });

    describe('research findings — content hash dedup', () => {
      it('skips duplicate with same content hash (no external ID)', async () => {
        const finding1: ResearchFinding = {
          id: 'dedup-hash-001',
          patientId: DEDUP_PATIENT,
          source: 'BioMCP/Analysis',
          title: 'Gene pathway analysis result',
          summary: 'First version of analysis',
          date: '2026-03-09',
        };
        const r1 = await store.addResearchFinding(finding1);
        expect(r1.duplicate).toBe(false);

        // Same source + title + date → same content hash
        const finding2: ResearchFinding = {
          id: 'dedup-hash-002',
          patientId: DEDUP_PATIENT,
          source: 'BioMCP/Analysis',
          title: 'Gene pathway analysis result',
          summary: 'Different summary but same fingerprint',
          date: '2026-03-09',
        };
        const r2 = await store.addResearchFinding(finding2);
        expect(r2.duplicate).toBe(true);
        expect(r2.id).toBe('dedup-hash-001');
      });

      it('different title produces different hash', async () => {
        const finding: ResearchFinding = {
          id: 'dedup-hash-003',
          patientId: DEDUP_PATIENT,
          source: 'BioMCP/Analysis',
          title: 'Completely different analysis topic',
          summary: 'Unique content',
          date: '2026-03-09',
        };
        const result = await store.addResearchFinding(finding);
        expect(result.duplicate).toBe(false);
      });

      it('content hash is case-insensitive', async () => {
        const finding: ResearchFinding = {
          id: 'dedup-hash-004',
          patientId: DEDUP_PATIENT,
          source: 'biomcp/analysis',
          title: 'GENE PATHWAY ANALYSIS RESULT',
          summary: 'Case variant',
          date: '2026-03-09',
        };
        const result = await store.addResearchFinding(finding);
        // Same as dedup-hash-001 after lowercasing
        expect(result.duplicate).toBe(true);
      });
    });

    describe('research findings — findingExists pre-flight check', () => {
      it('returns true for existing external ID', async () => {
        const result = await store.findingExists(DEDUP_PATIENT, {
          externalId: '12345678',
          externalIdType: 'pmid',
        });
        expect(result.exists).toBe(true);
        expect(result.existingId).toBe('dedup-find-001');
      });

      it('returns false for non-existing external ID', async () => {
        const result = await store.findingExists(DEDUP_PATIENT, {
          externalId: '99999999',
          externalIdType: 'pmid',
        });
        expect(result.exists).toBe(false);
      });

      it('returns true for existing content hash', async () => {
        const result = await store.findingExists(DEDUP_PATIENT, {
          source: 'BioMCP/Analysis',
          title: 'Gene pathway analysis result',
          date: '2026-03-09',
        });
        expect(result.exists).toBe(true);
      });
    });

    describe('hypotheses — name+version dedup', () => {
      it('skips duplicate hypothesis with same name and version', async () => {
        const hyp1: ResearchHypothesis = {
          id: 'dedup-hyp-001',
          patientId: DEDUP_PATIENT,
          name: 'Granulomatosis with Polyangiitis',
          date: '2026-03-09',
          probabilityLow: 20,
          probabilityHigh: 40,
          certaintyLevel: 'MODERATE',
          version: 1,
        };
        const r1 = await store.addHypothesis(hyp1);
        expect(r1.duplicate).toBe(false);

        const hyp2: ResearchHypothesis = {
          id: 'dedup-hyp-002',
          patientId: DEDUP_PATIENT,
          name: 'Granulomatosis with Polyangiitis',
          date: '2026-03-09',
          probabilityLow: 25,
          probabilityHigh: 45,
          certaintyLevel: 'MODERATE',
          version: 1,
        };
        const r2 = await store.addHypothesis(hyp2);
        expect(r2.duplicate).toBe(true);
        expect(r2.id).toBe('dedup-hyp-001');
      });

      it('allows new version of same hypothesis', async () => {
        const hyp: ResearchHypothesis = {
          id: 'dedup-hyp-003',
          patientId: DEDUP_PATIENT,
          name: 'Granulomatosis with Polyangiitis',
          date: '2026-03-09',
          probabilityLow: 30,
          probabilityHigh: 55,
          certaintyLevel: 'STRONG',
          version: 2,
        };
        const result = await store.addHypothesis(hyp);
        expect(result.duplicate).toBe(false);
        expect(result.id).toBe('dedup-hyp-003');

        // Version 1 should now be superseded
        const allVersions = await store.queryHypotheses({
          patientId: DEDUP_PATIENT,
          name: 'Granulomatosis',
          latestOnly: false,
        });
        const v1 = allVersions.find((h) => h.version === 1);
        expect(v1?.supersededBy).toBe('dedup-hyp-003');
      });
    });

    describe('evidence links — hypothesis+evidence+direction dedup', () => {
      it('skips duplicate link with same hypothesis+finding+direction', async () => {
        const link1: HypothesisEvidenceLink = {
          id: 'dedup-link-001',
          patientId: DEDUP_PATIENT,
          hypothesisId: 'dedup-hyp-001',
          findingId: 'dedup-find-001',
          direction: 'supporting',
          claim: 'PR3-ANCA positive supports GPA diagnosis',
          date: '2026-03-09',
        };
        const r1 = await store.addEvidenceLink(link1);
        expect(r1.duplicate).toBe(false);

        const link2: HypothesisEvidenceLink = {
          id: 'dedup-link-002',
          patientId: DEDUP_PATIENT,
          hypothesisId: 'dedup-hyp-001',
          findingId: 'dedup-find-001',
          direction: 'supporting',
          claim: 'Different claim text but same link',
          date: '2026-03-09',
        };
        const r2 = await store.addEvidenceLink(link2);
        expect(r2.duplicate).toBe(true);
        expect(r2.id).toBe('dedup-link-001');
      });

      it('allows same finding with different direction', async () => {
        const link: HypothesisEvidenceLink = {
          id: 'dedup-link-003',
          patientId: DEDUP_PATIENT,
          hypothesisId: 'dedup-hyp-001',
          findingId: 'dedup-find-001',
          direction: 'contradicting',
          claim: 'Finding also contradicts in some aspect',
          date: '2026-03-09',
        };
        const result = await store.addEvidenceLink(link);
        expect(result.duplicate).toBe(false);
      });
    });

    describe('batch dedup', () => {
      it('addResearchFindings reports inserted vs duplicates', async () => {
        const findings: ResearchFinding[] = [
          {
            id: 'batch-001',
            patientId: DEDUP_PATIENT,
            source: 'PubMed',
            externalId: '12345678',
            externalIdType: 'pmid',
            title: 'Duplicate PMID',
            summary: 'Should be deduped',
            date: '2026-03-09',
          },
          {
            id: 'batch-002',
            patientId: DEDUP_PATIENT,
            source: 'PubMed',
            externalId: '88888888',
            externalIdType: 'pmid',
            title: 'Brand new finding',
            summary: 'Should be inserted',
            date: '2026-03-09',
          },
        ];
        const result = await store.addResearchFindings(findings);
        expect(result.inserted).toBe(1);
        expect(result.duplicates).toBe(1);
      });
    });
  });

  describe('getHypothesisTimeline()', () => {
    const timelinePatient = 'patient-timeline';

    beforeAll(async () => {
      await store.addHypothesis({
        id: 'hyp-tl-v1',
        patientId: timelinePatient,
        name: 'SLE',
        probabilityLow: 10,
        probabilityHigh: 25,
        certaintyLevel: 'WEAK',
        version: 1,
        date: '2024-01-01',
        evidenceTier: 'T3-ai-inferred',
      });
      await store.addHypothesis({
        id: 'hyp-tl-v2',
        patientId: timelinePatient,
        name: 'SLE',
        probabilityLow: 40,
        probabilityHigh: 60,
        certaintyLevel: 'MODERATE',
        version: 2,
        date: '2024-06-01',
        evidenceTier: 'T2-patient-reported',
      });
      await store.addHypothesis({
        id: 'hyp-tl-v3',
        patientId: timelinePatient,
        name: 'SLE',
        probabilityLow: 15,
        probabilityHigh: 30,
        certaintyLevel: 'WEAK',
        version: 3,
        date: '2025-01-01',
        evidenceTier: 'T1-specialist',
      });
    });

    it('returns version chain ordered by version ASC', async () => {
      const timeline = await store.getHypothesisTimeline({
        patientId: timelinePatient,
        name: 'SLE',
      });

      expect(timeline.name).toBe('SLE');
      expect(timeline.versions.length).toBe(3);
      expect(timeline.versions[0]?.version).toBe(1);
      expect(timeline.versions[2]?.version).toBe(3);
    });

    it('builds confidence trajectory with all version snapshots', async () => {
      const timeline = await store.getHypothesisTimeline({
        patientId: timelinePatient,
        name: 'SLE',
      });

      expect(timeline.confidenceTrajectory.length).toBe(3);
      expect(timeline.confidenceTrajectory[0]?.probabilityLow).toBe(10);
      expect(timeline.confidenceTrajectory[1]?.probabilityLow).toBe(40);
      expect(timeline.confidenceTrajectory[2]?.probabilityLow).toBe(15);
    });

    it('detects direction changes (probability reversal)', async () => {
      const timeline = await store.getHypothesisTimeline({
        patientId: timelinePatient,
        name: 'SLE',
      });

      // v1 midpoint ~17.5, v2 midpoint ~50 (↑), v3 midpoint ~22.5 (↓) = 1 direction change
      expect(timeline.directionChanges).toBe(1);
    });

    it('returns empty timeline for unknown hypothesis', async () => {
      const timeline = await store.getHypothesisTimeline({
        patientId: timelinePatient,
        name: 'Nonexistent Disease',
      });

      expect(timeline.versions.length).toBe(0);
      expect(timeline.confidenceTrajectory.length).toBe(0);
      expect(timeline.directionChanges).toBe(0);
    });

    it('includes evidence links for each version', async () => {
      // Add an evidence link to v2
      await store.addEvidenceLink({
        id: 'elink-tl-001',
        patientId: timelinePatient,
        hypothesisId: 'hyp-tl-v2',
        findingId: 'finding-tl-ref',
        direction: 'supporting',
        claim: 'Anti-Ro-60 positive supports SLE',
        confidence: 0.7,
        tier: 'T1',
        date: '2024-06-15',
      });

      const timeline = await store.getHypothesisTimeline({
        patientId: timelinePatient,
        name: 'SLE',
      });

      // v2 should have 1 evidence link
      const v2 = timeline.versions.find((v) => v.version === 2);
      expect(v2).toBeDefined();
      expect(v2?.evidenceLinks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
