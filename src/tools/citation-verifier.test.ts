import { beforeAll, describe, expect, it, jest } from '@jest/globals';

const mockStore = {
  updateFindingValidation: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  getClinicalStore: () => mockStore,
}));

// Mock article tool that returns abstract text based on input
const mockArticleExecute =
  jest.fn<(input: Record<string, unknown>, ctx: unknown) => Promise<string>>();

jest.unstable_mockModule('../clients/biomedical-mcp.js', () => ({
  getBiomedicalTools: jest.fn<() => Promise<Record<string, unknown>>>().mockResolvedValue({
    biomcp_article_searcher: {
      execute: mockArticleExecute,
    },
  }),
}));

// biome-ignore lint/suspicious/noExplicitAny: dynamically imported in beforeAll
let citationVerifierTool: any;

beforeAll(async () => {
  const mod = await import('./citation-verifier.js');
  citationVerifierTool = mod.citationVerifierTool;
});

const TEST_PATIENT = 'patient-cv-test';

describe('citationVerifierTool', () => {
  it('marks verified when abstract supports claim', async () => {
    // Return an abstract that strongly supports the claim with high keyword overlap
    mockArticleExecute.mockResolvedValueOnce(
      'This study demonstrates that BRCA1 mutations significantly increase breast cancer risk in women. ' +
        'Carriers of pathogenic BRCA1 variants have a lifetime breast cancer risk of 60-80%. ' +
        'Genetic testing for BRCA1 mutations is recommended for high-risk individuals. ' +
        'The association between BRCA1 mutations and breast cancer has been well established.',
    );

    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          {
            findingId: 'f-001',
            claim: 'BRCA1 mutations increase breast cancer risk',
            pmid: '12345678',
          },
        ],
      },
      {} as never,
    );

    const finding = result.verifiedFindings[0];
    expect(finding.verificationStatus).toBe('verified');
    expect(finding.confidence).toBeGreaterThan(0);
    expect(finding.pmid).toBe('12345678');
  });

  it('marks contradicted when abstract negates claim', async () => {
    // Return an abstract that negates the claim with negation patterns
    mockArticleExecute.mockResolvedValueOnce(
      'This large-scale study found that statin therapy did not reduce cardiovascular mortality in elderly patients. ' +
        'The results contradict previous claims about statin benefits in this population. ' +
        'Statin therapy failed to demonstrate significant reduction in cardiovascular events. ' +
        'These findings refute the hypothesis that statins provide cardiovascular protection in the elderly.',
    );

    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          {
            claim: 'Statin therapy reduces cardiovascular mortality in elderly patients',
            pmid: '23456789',
          },
        ],
      },
      {} as never,
    );

    const finding = result.verifiedFindings[0];
    expect(finding.verificationStatus).toBe('contradicted');
    expect(finding.confidence).toBeGreaterThan(0);
  });

  it('marks unavailable when no PMID provided', async () => {
    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          {
            claim: 'Some claim without a citation',
            // No pmid, no externalId
          },
        ],
      },
      {} as never,
    );

    const finding = result.verifiedFindings[0];
    expect(finding.verificationStatus).toBe('unavailable');
    expect(finding.confidence).toBe(0);
    expect(finding.reason).toContain('No PMID provided');
  });

  it('marks unsupported when abstract has no relevant content', async () => {
    // Return an abstract about a completely unrelated topic
    mockArticleExecute.mockResolvedValueOnce(
      'This paper examines the geological formations of the Jurassic period in central Europe. ' +
        'Sedimentary rock layers reveal patterns of ancient marine environments. ' +
        'Fossil evidence suggests diverse marine ecosystems existed during this era. ' +
        'The stratigraphic analysis provides insights into paleoclimate conditions.',
    );

    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          {
            claim: 'Metformin improves insulin sensitivity in type 2 diabetes',
            pmid: '34567890',
          },
        ],
      },
      {} as never,
    );

    const finding = result.verifiedFindings[0];
    expect(finding.verificationStatus).toBe('unsupported');
  });

  it('handles empty findings array', async () => {
    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [],
      },
      {} as never,
    );

    expect(result.verifiedFindings).toEqual([]);
    expect(result.summary.verified).toBe(0);
    expect(result.summary.contradicted).toBe(0);
    expect(result.summary.unsupported).toBe(0);
    expect(result.summary.unavailable).toBe(0);
    expect(result.summary.partial).toBe(0);
  });

  it('returns summary counts', async () => {
    // Finding 1: verified (strong overlap)
    mockArticleExecute.mockResolvedValueOnce(
      'BRCA1 mutations significantly increase breast cancer risk in women carriers. ' +
        'Pathogenic BRCA1 variants confer a lifetime breast cancer risk of 60-80%. ' +
        'BRCA1 mutations are the primary genetic risk factor for hereditary breast cancer.',
    );
    // Finding 2: unavailable (no PMID — won't call execute)
    // Finding 3: unsupported (unrelated abstract)
    mockArticleExecute.mockResolvedValueOnce(
      'This paper discusses the migration patterns of Arctic terns across hemispheres. ' +
        'The birds travel approximately 70,000 kilometers annually during their migration.',
    );

    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          { claim: 'BRCA1 mutations increase breast cancer risk', pmid: '11111111' },
          { claim: 'Claim without citation' },
          { claim: 'Aspirin prevents heart attacks', pmid: '33333333' },
        ],
      },
      {} as never,
    );

    // Summary should have counts for each status
    const total =
      result.summary.verified +
      result.summary.partial +
      result.summary.unsupported +
      result.summary.contradicted +
      result.summary.unavailable;
    expect(total).toBe(3);
    expect(result.verifiedFindings.length).toBe(3);
  });

  it('includes abstract excerpt for verified findings', async () => {
    mockArticleExecute.mockResolvedValueOnce(
      'Rituximab therapy demonstrates significant efficacy in treating ANCA-associated vasculitis. ' +
        'Patients receiving rituximab showed complete remission rates of 64% compared to 53% with cyclophosphamide. ' +
        'Rituximab is now considered a first-line treatment for ANCA vasculitis remission induction.',
    );

    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          {
            claim: 'Rituximab demonstrates efficacy in treating ANCA-associated vasculitis',
            pmid: '44444444',
          },
        ],
      },
      {} as never,
    );

    const finding = result.verifiedFindings[0];
    expect(finding.verificationStatus).toBe('verified');
    expect(finding.abstractExcerpt).toBeDefined();
    expect(typeof finding.abstractExcerpt).toBe('string');
    expect(finding.abstractExcerpt.length).toBeGreaterThan(0);
  });

  it('handles BioMCP tool not found gracefully', async () => {
    // Override the mock to return empty tools (no article searcher)
    const { getBiomedicalTools } = await import('../clients/biomedical-mcp.js');
    (getBiomedicalTools as jest.Mock).mockResolvedValueOnce({});

    const result = await citationVerifierTool.execute(
      {
        patientId: TEST_PATIENT,
        findings: [
          {
            claim: 'Some claim to verify',
            pmid: '55555555',
          },
        ],
      },
      {} as never,
    );

    const finding = result.verifiedFindings[0];
    expect(finding.verificationStatus).toBe('unavailable');
    expect(finding.reason).toContain('not available');
  });
});
