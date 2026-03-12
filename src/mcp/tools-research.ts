import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { mastra } from '../mastra.js';
import { adversarialSynthesisTool } from '../tools/adversarial-synthesis.js';
import { citationVerifierTool } from '../tools/citation-verifier.js';
import { parallelResearchTool } from '../tools/parallel-research.js';
import { patientContextTool } from '../tools/patient-context.js';
import { pharmacogenomicsScreenTool } from '../tools/pharmacogenomics-screen.js';
import { phenotypeMatchTool } from '../tools/phenotype-match.js';
import { researchPlanTool } from '../tools/research-plan.js';
import { temporalAnalysisTool } from '../tools/temporal-analysis.js';
import { testPrioritizerTool } from '../tools/test-prioritizer.js';
import { trialEligibilityTool } from '../tools/trial-eligibility.js';

/**
 * Research tools — adversarial research, synthesis, and advanced analysis.
 * Provides deep research with role-based framing, phenotype-genotype correlation,
 * trial eligibility, citation verification, pharmacogenomics, and temporal analysis.
 */
export function registerResearchTools(server: McpServer): void {
  server.registerTool(
    'parallel_deep_research',
    {
      description:
        'Run ultra-deep research on a topic using Parallel.ai. Supports adversarial framing (advocate/skeptic/unbiased roles). Returns markdown report with citations. Requires PARALLEL_API_KEY env var.',
      inputSchema: {
        query: z.string().describe('Research question or hypothesis to investigate'),
        context: z.string().optional().describe('Additional context to guide the research'),
        processor: z
          .enum(['base', 'core', 'ultra'])
          .optional()
          .describe('Research depth: base (fast), core (balanced), ultra (deepest, ~10 min)'),
        role: z
          .enum(['advocate', 'skeptic', 'unbiased'])
          .optional()
          .describe(
            'Adversarial framing role: advocate (build case FOR), skeptic (build case AGAINST), unbiased (balanced)',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!parallelResearchTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Parallel research tool not available' }],
          isError: true,
        };
      }
      const result = await parallelResearchTool.execute(input, { mastra });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // biomcp_query removed — now proxied from upstream BioMCP server
  // via tools-biomedical.ts with full tool granularity (80+ individual tools)

  server.registerTool(
    'adversarial_synthesis',
    {
      description:
        'Run three-perspective adversarial analysis (advocate/skeptic/unbiased). External mode uses Parallel.ai ultra-deep research (20+ min). Internal mode uses orchestrator-driven synthesis.',
      inputSchema: {
        hypothesis: z.string().describe('Diagnostic hypothesis to evaluate adversarially'),
        patientContext: z.string().describe('Patient clinical context for grounding the analysis'),
        mode: z
          .enum(['internal', 'external'])
          .describe(
            'Execution mode: external (Parallel.ai, deeper but slower) or internal (orchestrator-driven)',
          ),
        processor: z
          .enum(['ultra', 'ultra2x'])
          .optional()
          .describe('Parallel.ai processor tier (external mode only)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!adversarialSynthesisTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Adversarial synthesis tool not available' }],
          isError: true,
        };
      }
      const result = await adversarialSynthesisTool.execute(input, { mastra });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ─── Test Prioritizer ──────────────────────────────────────────────

  server.registerTool(
    'prioritize_tests',
    {
      description:
        'Prioritize diagnostic tests by composite score (information gain, cost, invasiveness, urgency, availability). Filters out already-done tests and checks Layer 2 for existing lab results.',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        tests: z.string().describe('JSON array of InformativeTest objects to prioritize'),
        budget: z.number().optional().describe('Maximum budget in USD'),
        urgencyBias: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('0 = cost-optimize, 1 = speed-optimize'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MCP string→JSON boundary; Zod validates inside tool
      const tests = JSON.parse(input.tests);
      const result = await testPrioritizerTool.execute?.(
        { patientId: input.patientId, tests, budget: input.budget, urgencyBias: input.urgencyBias },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Phenotype-Genotype Correlation ─────────────────────────────────

  server.registerTool(
    'phenotype_match',
    {
      description:
        'Correlate patient HPO terms with Mendelian disease candidates using Jaccard similarity. Queries OMIM/Orphanet/Monarch via BioMCP and returns ranked disease matches with phenotype overlap scores.',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        hpoTerms: z.string().describe('JSON array of { id, name } HPO term objects'),
        includeGenes: z
          .string()
          .optional()
          .describe('JSON array of gene symbols to cross-reference'),
        maxCandidates: z.number().optional().describe('Max candidates to return (default: 20)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MCP string→JSON boundary; Zod validates inside tool
      const hpoTerms = JSON.parse(input.hpoTerms);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const includeGenes = input.includeGenes ? JSON.parse(input.includeGenes) : undefined;
      const result = await phenotypeMatchTool.execute?.(
        {
          patientId: input.patientId,
          hpoTerms,
          ...(includeGenes ? { includeGenes } : {}),
          ...(input.maxCandidates ? { maxCandidates: input.maxCandidates } : {}),
        },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Clinical Trial Eligibility ────────────────────────────────────

  server.registerTool(
    'trial_eligibility',
    {
      description:
        'Check patient eligibility against clinical trials from ClinicalTrials.gov. Matches demographics, diagnoses, labs, and medications against inclusion/exclusion criteria.',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        nctIds: z
          .string()
          .optional()
          .describe('Comma-separated NCT IDs to check (e.g. "NCT05537935,NCT04762758")'),
        searchQuery: z
          .string()
          .optional()
          .describe('Search ClinicalTrials.gov for matching trials'),
        maxTrials: z.number().optional().describe('Max trials to evaluate (default: 10)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      const nctIds = input.nctIds
        ? input.nctIds.split(',').map((s: string) => s.trim())
        : undefined;
      const result = await trialEligibilityTool.execute?.(
        {
          patientId: input.patientId,
          ...(nctIds ? { nctIds } : {}),
          ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
          ...(input.maxTrials ? { maxTrials: input.maxTrials } : {}),
        },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Citation Verifier ─────────────────────────────────────────────

  server.registerTool(
    'verify_citations',
    {
      description:
        'Verify research citations against PubMed abstracts. Checks whether cited papers actually support claimed findings using keyword overlap and negation detection.',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        findings: z
          .string()
          .describe(
            'JSON array of { claim, pmid?, externalId?, externalIdType? } objects to verify',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MCP string→JSON boundary; Zod validates inside tool
      const findings = JSON.parse(input.findings);
      const result = await citationVerifierTool.execute?.(
        { patientId: input.patientId, findings },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Pharmacogenomics Screen ───────────────────────────────────────

  server.registerTool(
    'pharmacogenomics_screen',
    {
      description:
        'Screen for drug-gene interactions across patient medication list and known genetic variants. Uses DGIdb and PharmGKB via BioMCP to produce pharmacogenomic interaction matrix.',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        medications: z
          .string()
          .optional()
          .describe(
            'JSON array of { name, drugClass? } objects (default: pulled from Layer 2 treatment_trials)',
          ),
        geneVariants: z
          .string()
          .optional()
          .describe(
            'JSON array of { gene, variant? } objects (default: pulled from research findings)',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MCP string→JSON boundary; Zod validates inside tool
      const medications = input.medications ? JSON.parse(input.medications) : undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const geneVariants = input.geneVariants ? JSON.parse(input.geneVariants) : undefined;
      const result = await pharmacogenomicsScreenTool.execute?.(
        {
          patientId: input.patientId,
          ...(medications ? { medications } : {}),
          ...(geneVariants ? { geneVariants } : {}),
        },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Temporal Analysis ─────────────────────────────────────────────

  server.registerTool(
    'temporal_analysis',
    {
      description:
        'Construct disease timeline from Layer 2 data and check temporal consistency of hypotheses against known disease natural history. Identifies phases, turning points, and timeline conflicts.',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        hypotheses: z
          .string()
          .optional()
          .describe(
            'JSON array of { name, expectedProgression? } objects (default: pulled from Layer 2B)',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- MCP string→JSON boundary; Zod validates inside tool
      const hypotheses = input.hypotheses ? JSON.parse(input.hypotheses) : undefined;
      const result = await temporalAnalysisTool.execute?.(
        {
          patientId: input.patientId,
          ...(hypotheses ? { hypotheses } : {}),
        },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── patient_context — build patient context summary ───────────────
  server.registerTool(
    'patient_context',
    {
      description:
        'Build a structured patient context summary from Layer 2 clinical data. Returns Tier A (compact ~2K tokens: demographics, hypotheses, treatment landscape) and optionally Tier B (expanded ~8K tokens: lab trends, temporal map, research audit).',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        includeTierB: z
          .boolean()
          .optional()
          .describe(
            'Include expanded Tier B context (lab trends, temporal map, research audit). Default: false',
          ),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      const result = await patientContextTool.execute?.(
        {
          patientId: input.patientId,
          includeTierB: input.includeTierB ?? false,
        },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── research_plan — generate prioritized research plan ────────────
  server.registerTool(
    'research_plan',
    {
      description:
        'Generate a prioritized research plan from patient context. Analyzes hypotheses, evidence gaps, lab trends, and treatment failures to produce specific research questions grouped by urgency phase (immediate/short-term/deep-dive).',
      inputSchema: {
        patientId: z.string().describe('Patient identifier'),
        focusHypotheses: z
          .string()
          .optional()
          .describe(
            'JSON array of hypothesis names to focus on. If empty, covers all active hypotheses.',
          ),
        maxQuestions: z
          .number()
          .int()
          .min(1)
          .max(30)
          .optional()
          .describe('Maximum number of research questions to generate (default: 15)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      const focusHypotheses = input.focusHypotheses ? JSON.parse(input.focusHypotheses) : undefined;
      const result = await researchPlanTool.execute?.(
        {
          patientId: input.patientId,
          ...(focusHypotheses ? { focusHypotheses } : {}),
          maxQuestions: input.maxQuestions ?? 15,
        },
        { mastra },
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
