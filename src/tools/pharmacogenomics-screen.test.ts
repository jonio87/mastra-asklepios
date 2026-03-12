import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

// ─── Mocks ──────────────────────────────────────────────────────────────

const mockAddResearchFinding = jest
  .fn<() => Promise<{ id: string; duplicate: boolean }>>()
  .mockResolvedValue({
    id: 'f-1',
    duplicate: false,
  });

const mockStore = {
  queryTreatments: jest
    .fn<() => Promise<Array<{ medication: string; drugClass?: string }>>>()
    .mockResolvedValue([]),
  queryFindings: jest
    .fn<() => Promise<Array<{ externalId?: string; title: string; rawData?: string }>>>()
    .mockResolvedValue([]),
  addResearchFinding: mockAddResearchFinding,
};

jest.unstable_mockModule('../storage/clinical-store.js', () => ({
  getClinicalStore: () => mockStore,
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockGetBiomedicalTools = jest
  .fn<() => Promise<Record<string, unknown>>>()
  .mockResolvedValue({});

jest.unstable_mockModule('../clients/biomedical-mcp.js', () => ({
  getBiomedicalTools: mockGetBiomedicalTools,
}));

// biome-ignore lint/suspicious/noExplicitAny: dynamically imported
let pharmacogenomicsScreenTool: any;

beforeAll(async () => {
  const mod = await import('./pharmacogenomics-screen.js');
  pharmacogenomicsScreenTool = mod.pharmacogenomicsScreenTool;
});

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Build a mock DGIdb tool that returns interaction text for specific drug-gene pairs.
 */
function makeMockDgidbTool(interactions: Map<string, string>) {
  return {
    execute: jest
      .fn<(input: Record<string, unknown>, ctx: unknown) => Promise<string>>()
      .mockImplementation(async (input: Record<string, unknown>) => {
        const drug = input['drug'] as string;
        const gene = input['gene'] as string;
        const key = `${drug}|${gene}`;
        return interactions.get(key) ?? 'No interaction found.';
      }),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('pharmacogenomicsScreenTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.queryTreatments.mockResolvedValue([]);
    mockStore.queryFindings.mockResolvedValue([]);
    mockAddResearchFinding.mockResolvedValue({ id: 'f-1', duplicate: false });
    mockGetBiomedicalTools.mockResolvedValue({});
  });

  it('loads medications from Layer 2 when not provided', async () => {
    mockStore.queryTreatments.mockResolvedValue([
      { medication: 'clopidogrel', drugClass: 'antiplatelet' },
      { medication: 'omeprazole' },
    ]);
    mockStore.queryFindings.mockResolvedValue([
      { externalId: 'CYP2C19', title: 'CYP2C19 variant', rawData: '*2/*2' },
    ]);

    mockGetBiomedicalTools.mockResolvedValue({});

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
    });

    // Should have queried treatments from store
    expect(mockStore.queryTreatments).toHaveBeenCalledWith({ patientId: 'p-1' });
    // Even without BioMCP tools, the result should list medications without interactions
    expect(result.medicationsWithoutInteractions).toContain('clopidogrel');
    expect(result.medicationsWithoutInteractions).toContain('omeprazole');
  });

  it('loads gene variants from findings when not provided', async () => {
    mockStore.queryFindings.mockResolvedValue([
      { externalId: 'CYP2D6', title: 'CYP2D6 poor metabolizer', rawData: '*4/*4' },
      { externalId: 'DPYD', title: 'DPYD variant' },
    ]);

    mockGetBiomedicalTools.mockResolvedValue({});

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'codeine' }],
    });

    // Should have queried findings from store
    expect(mockStore.queryFindings).toHaveBeenCalledWith({
      patientId: 'p-1',
      externalIdType: 'gene',
    });
    // Genes should appear in the output (no interactions since no BioMCP tools)
    expect(result.genesWithoutInteractions).toContain('CYP2D6');
    expect(result.genesWithoutInteractions).toContain('DPYD');
  });

  it('classifies interaction significance correctly', async () => {
    const interactions = new Map([
      // "avoid" → major
      [
        'warfarin|CYP2C9',
        'Warfarin is metabolized by CYP2C9. Patients with CYP2C9 variants should avoid standard dosing due to increased bleeding risk. Score: 0.9',
      ],
      // "monitor" → moderate
      [
        'codeine|CYP2D6',
        'Codeine requires CYP2D6 for activation to morphine. Monitor for reduced efficacy in poor metabolizers. Score: 0.5',
      ],
      // Low score → minor
      ['ibuprofen|CYP2C9', 'Ibuprofen has minor CYP2C9 metabolism pathway involvement. Score: 0.2'],
    ]);

    const dgidbTool = makeMockDgidbTool(interactions);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_drug_gene_interactions: dgidbTool,
    });

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'warfarin' }, { name: 'codeine' }, { name: 'ibuprofen' }],
      geneVariants: [
        { gene: 'CYP2C9', variant: '*2/*3' },
        { gene: 'CYP2D6', variant: '*4/*4' },
      ],
    });

    const warfarinInteraction = result.interactions.find(
      (i: Record<string, unknown>) => i['medication'] === 'warfarin' && i['gene'] === 'CYP2C9',
    );
    const codeineInteraction = result.interactions.find(
      (i: Record<string, unknown>) => i['medication'] === 'codeine' && i['gene'] === 'CYP2D6',
    );
    const ibuprofenInteraction = result.interactions.find(
      (i: Record<string, unknown>) => i['medication'] === 'ibuprofen' && i['gene'] === 'CYP2C9',
    );

    expect(warfarinInteraction?.clinicalSignificance).toBe('major');
    expect(codeineInteraction?.clinicalSignificance).toBe('moderate');
    expect(ibuprofenInteraction?.clinicalSignificance).toBe('minor');
  });

  it('handles no interactions gracefully', async () => {
    mockGetBiomedicalTools.mockResolvedValue({});

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'aspirin' }],
      geneVariants: [{ gene: 'CYP2D6' }],
    });

    expect(result.interactions).toEqual([]);
    expect(result.medicationsWithoutInteractions).toContain('aspirin');
    expect(result.genesWithoutInteractions).toContain('CYP2D6');
    expect(result.summary).toContain('No drug-gene interactions found');
  });

  it('generates summary with recommendations', async () => {
    const interactions = new Map([
      [
        'tamoxifen|CYP2D6',
        'Tamoxifen is a prodrug activated by CYP2D6. Patients should avoid concomitant CYP2D6 inhibitors. Black box warning for poor metabolizers. Score: 0.95',
      ],
    ]);

    const dgidbTool = makeMockDgidbTool(interactions);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_drug_gene_interactions: dgidbTool,
    });

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'tamoxifen' }],
      geneVariants: [{ gene: 'CYP2D6', variant: '*4/*4' }],
    });

    expect(result.summary).toContain('drug-gene interaction');
    expect(result.summary).toContain('major');
    // Major interactions should trigger a warning in the summary
    expect(result.summary).toContain('⚠️');
    expect(result.summary).toContain('tamoxifen');
  });

  it('auto-persists interactions as findings', async () => {
    const interactions = new Map([
      [
        'warfarin|CYP2C9',
        'Warfarin metabolism is significantly affected by CYP2C9 variants. Avoid standard dosing. Contraindicated in certain genotypes. Score: 0.9',
      ],
    ]);

    const dgidbTool = makeMockDgidbTool(interactions);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_drug_gene_interactions: dgidbTool,
    });

    await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'warfarin' }],
      geneVariants: [{ gene: 'CYP2C9', variant: '*2/*3' }],
    });

    // Major/moderate interactions should be persisted
    expect(mockAddResearchFinding).toHaveBeenCalled();
    const call = (mockAddResearchFinding.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(call['patientId']).toBe('p-1');
    expect(call['sourceTool']).toBe('pharmacogenomics-screen');
    expect(call['externalId']).toBe('CYP2C9');
    expect(call['externalIdType']).toBe('gene');
    expect(call['title'] as string).toContain('warfarin');
    expect(call['title'] as string).toContain('CYP2C9');
  });

  it('handles BioMCP tools not found gracefully', async () => {
    // No BioMCP tools available at all
    mockGetBiomedicalTools.mockResolvedValue({});

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'metformin' }],
      geneVariants: [{ gene: 'SLC22A1' }],
    });

    expect(result.interactions).toEqual([]);
    expect(result.medicationsWithoutInteractions).toContain('metformin');
    expect(result.genesWithoutInteractions).toContain('SLC22A1');
    expect(result.summary).toContain('No drug-gene interactions found');
  });

  it('builds correct interaction matrix for multiple medications and genes', async () => {
    // 2 medications × 2 genes = 4 possible pairs, but only 2 have interactions
    const interactions = new Map([
      [
        'warfarin|CYP2C9',
        'Warfarin is metabolized by CYP2C9. Patients should avoid standard dosing. Contraindicated for poor metabolizers. Score: 0.85',
      ],
      [
        'codeine|CYP2D6',
        'Codeine requires CYP2D6 for activation. Monitor for reduced analgesic efficacy in poor metabolizers. Score: 0.6',
      ],
    ]);

    const dgidbTool = makeMockDgidbTool(interactions);
    mockGetBiomedicalTools.mockResolvedValue({
      biomcp_drug_gene_interactions: dgidbTool,
    });

    const result = await pharmacogenomicsScreenTool.execute({
      patientId: 'p-1',
      medications: [{ name: 'warfarin' }, { name: 'codeine' }],
      geneVariants: [
        { gene: 'CYP2C9', variant: '*2/*3' },
        { gene: 'CYP2D6', variant: '*4/*4' },
      ],
    });

    // Should find 2 interactions (warfarin×CYP2C9 and codeine×CYP2D6)
    expect(result.interactions.length).toBe(2);

    const warfarinCyp2c9 = result.interactions.find(
      (i: Record<string, unknown>) => i['medication'] === 'warfarin' && i['gene'] === 'CYP2C9',
    );
    const codeineCyp2d6 = result.interactions.find(
      (i: Record<string, unknown>) => i['medication'] === 'codeine' && i['gene'] === 'CYP2D6',
    );

    expect(warfarinCyp2c9).toBeDefined();
    expect(codeineCyp2d6).toBeDefined();
    expect(warfarinCyp2c9?.source).toBe('DGIdb');
    expect(codeineCyp2d6?.source).toBe('DGIdb');

    // No medications or genes should be listed as "without interactions" for the matched ones
    expect(result.medicationsWithoutInteractions).not.toContain('warfarin');
    expect(result.medicationsWithoutInteractions).not.toContain('codeine');
    expect(result.genesWithoutInteractions).not.toContain('CYP2C9');
    expect(result.genesWithoutInteractions).not.toContain('CYP2D6');
  });
});
