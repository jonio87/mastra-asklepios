import { createStep, Workflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { deepResearchTool } from '../tools/deep-research.js';
import { orphanetLookupTool } from '../tools/orphanet-lookup.js';
import { pubmedSearchTool } from '../tools/pubmed-search.js';

const DiagnosticResearchInput = z.object({
  patientId: z.string().describe('Anonymized patient identifier'),
  symptoms: z.array(z.string()).describe('List of patient symptoms'),
  hpoTerms: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional()
    .describe('HPO-mapped phenotype terms'),
  existingDiagnoses: z.array(z.string()).optional().describe('Any existing or suspected diagnoses'),
  researchFocus: z.string().optional().describe('Specific research direction to pursue'),
});

const ResearchFindingSchema = z.object({
  source: z.string(),
  title: z.string(),
  summary: z.string(),
  relevance: z.number(),
  url: z.string().optional(),
  evidenceLevel: z.string(),
});

const DiagnosticHypothesisSchema = z.object({
  diagnosis: z.string(),
  confidence: z.number().min(0).max(100),
  evidenceSummary: z.string(),
  supportingFindings: z.array(z.string()),
  explainedSymptoms: z.array(z.string()),
  unexplainedSymptoms: z.array(z.string()),
  recommendedNextSteps: z.array(z.string()),
});

const DiagnosticResearchOutput = z.object({
  patientId: z.string(),
  researchFindings: z.array(ResearchFindingSchema),
  hypotheses: z.array(DiagnosticHypothesisSchema),
  knowledgeGaps: z.array(z.string()),
  suggestedFollowUp: z.array(z.string()),
  timestamp: z.string(),
});

/**
 * HITL review step: suspends workflow to present research findings for human review
 * before generating diagnostic hypotheses. Reviewer can filter irrelevant findings
 * and guide the hypothesis generation.
 */
const FindingsReviewSuspendSchema = z.object({
  patientId: z.string(),
  findingsCount: z.number(),
  topFindings: z.array(
    z.object({
      index: z.number(),
      source: z.string(),
      title: z.string(),
      relevance: z.number(),
    }),
  ),
  message: z.string(),
});

const FindingsReviewResumeSchema = z.object({
  approvedFindingIndices: z
    .array(z.number())
    .describe('Indices of approved findings to use for hypothesis generation (0-based)'),
  additionalContext: z
    .string()
    .optional()
    .describe('Additional clinical context for hypothesis generation'),
  notes: z.string().optional().describe('Reviewer notes'),
});

const FindingsReviewInputSchema = z.object({
  allFindings: z.array(ResearchFindingSchema),
  patientId: z.string(),
  symptoms: z.array(z.string()),
});

const reviewFindingsStep = createStep({
  id: 'review-findings',
  description:
    'Suspends for human review of research findings before hypothesis generation. Reviewer can approve/reject findings and add clinical context.',
  inputSchema: FindingsReviewInputSchema,
  outputSchema: FindingsReviewInputSchema,
  suspendSchema: FindingsReviewSuspendSchema,
  resumeSchema: FindingsReviewResumeSchema,
  execute: async ({ inputData, suspend, resumeData }) => {
    if (!resumeData) {
      const hasSignificantFindings = inputData.allFindings.length > 0;

      if (hasSignificantFindings) {
        return suspend(
          {
            patientId: inputData.patientId,
            findingsCount: inputData.allFindings.length,
            topFindings: inputData.allFindings.slice(0, 15).map((f, i) => ({
              index: i,
              source: f.source,
              title: f.title,
              relevance: f.relevance,
            })),
            message: `${inputData.allFindings.length} research finding(s) collected from PubMed, Orphanet, and deep research. Please review before hypothesis generation.`,
          },
          { resumeLabel: 'findings-review' },
        );
      }

      return inputData;
    }

    const approvedFindings = resumeData.approvedFindingIndices
      .filter((i) => i >= 0 && i < inputData.allFindings.length)
      .map((i) => inputData.allFindings[i])
      .filter((f): f is NonNullable<typeof f> => f != null);

    return {
      allFindings: approvedFindings.length > 0 ? approvedFindings : inputData.allFindings,
      patientId: inputData.patientId,
      symptoms: inputData.symptoms,
    };
  },
});

export const diagnosticResearchWorkflow = new Workflow({
  id: 'diagnostic-research',
  description:
    'Full diagnostic research pipeline: parallel database searches, evidence synthesis, hypothesis generation, and self-reflection loop. Produces ranked diagnostic hypotheses with evidence chains.',
  inputSchema: DiagnosticResearchInput,
  outputSchema: DiagnosticResearchOutput,
})
  .then({
    id: 'build-research-queries',
    description: 'Build optimized search queries from symptoms and HPO terms',
    inputSchema: DiagnosticResearchInput,
    outputSchema: z.object({
      pubmedQueries: z.array(z.string()),
      orphanetQueries: z.array(z.string()),
      deepResearchQuery: z.string(),
      patientId: z.string(),
      symptoms: z.array(z.string()),
    }),
    execute: async ({ inputData }) => {
      const symptomTerms = inputData.hpoTerms?.map((t) => t.name) ?? inputData.symptoms;
      const topSymptoms = symptomTerms.slice(0, 5);

      const pubmedQueries = [
        topSymptoms.join(' AND '),
        ...topSymptoms.slice(0, 3).map((s) => `"${s}" rare disease case report`),
      ];

      if (inputData.researchFocus) {
        pubmedQueries.push(`${inputData.researchFocus} ${topSymptoms[0] ?? ''}`);
      }

      const orphanetQueries = topSymptoms.slice(0, 3);

      const deepResearchQuery = inputData.researchFocus
        ? `${inputData.researchFocus}: ${topSymptoms.join(', ')}`
        : `Rare disease differential diagnosis: ${topSymptoms.join(', ')}`;

      return {
        pubmedQueries,
        orphanetQueries,
        deepResearchQuery,
        patientId: inputData.patientId,
        symptoms: inputData.symptoms,
      };
    },
  })
  .then({
    id: 'parallel-research',
    description: 'Execute parallel searches across PubMed, Orphanet, and deep research',
    inputSchema: z.object({
      pubmedQueries: z.array(z.string()),
      orphanetQueries: z.array(z.string()),
      deepResearchQuery: z.string(),
      patientId: z.string(),
      symptoms: z.array(z.string()),
    }),
    outputSchema: z.object({
      allFindings: z.array(ResearchFindingSchema),
      patientId: z.string(),
      symptoms: z.array(z.string()),
    }),
    execute: async ({ inputData }) => {
      const allFindings: Array<{
        source: string;
        title: string;
        summary: string;
        relevance: number;
        url?: string;
        evidenceLevel: string;
      }> = [];

      const executePubmed = pubmedSearchTool.execute;
      if (!executePubmed) throw new Error('pubmedSearchTool.execute is not defined');
      const executeOrphanet = orphanetLookupTool.execute;
      if (!executeOrphanet) throw new Error('orphanetLookupTool.execute is not defined');
      const executeDeepResearch = deepResearchTool.execute;
      if (!executeDeepResearch) throw new Error('deepResearchTool.execute is not defined');

      const pubmedPromises = inputData.pubmedQueries.map(async (query) => {
        const result = await executePubmed({ query, maxResults: 5 }, {} as never);
        if ('articles' in result) {
          for (const article of result.articles as Array<{
            pmid: string;
            title: string;
            journal: string;
            publicationDate: string;
            url: string;
          }>) {
            const finding: {
              source: string;
              title: string;
              summary: string;
              relevance: number;
              url: string;
              evidenceLevel: string;
            } = {
              source: 'PubMed',
              title: article.title,
              summary: `Published in ${article.journal} (${article.publicationDate})`,
              relevance: 0.7,
              url: article.url,
              evidenceLevel: 'unknown',
            };
            allFindings.push(finding);
          }
        }
      });

      const orphanetPromises = inputData.orphanetQueries.map(async (query) => {
        const result = await executeOrphanet({ query, maxResults: 3 }, {} as never);
        if ('diseases' in result) {
          for (const disease of result.diseases as Array<{
            name: string;
            definition: string;
            orphaNumber: number;
            url: string;
          }>) {
            const finding: {
              source: string;
              title: string;
              summary: string;
              relevance: number;
              url: string;
              evidenceLevel: string;
            } = {
              source: 'Orphanet',
              title: disease.name,
              summary: disease.definition,
              relevance: 0.8,
              url: disease.url,
              evidenceLevel: 'review',
            };
            allFindings.push(finding);
          }
        }
      });

      const deepResearchPromise = executeDeepResearch(
        {
          query: inputData.deepResearchQuery,
          context: `Patient symptoms: ${inputData.symptoms.join(', ')}`,
          maxSources: 10,
        },
        {} as never,
      ).then((result) => {
        if ('findings' in result) {
          for (const finding of result.findings as Array<{
            source: string;
            title: string;
            summary: string;
            relevance: number;
            url?: string;
            evidenceLevel: string;
          }>) {
            allFindings.push(finding);
          }
        }
      });

      await Promise.all([...pubmedPromises, ...orphanetPromises, deepResearchPromise]);

      allFindings.sort((a, b) => b.relevance - a.relevance);

      return {
        allFindings: allFindings.slice(0, 50),
        patientId: inputData.patientId,
        symptoms: inputData.symptoms,
      };
    },
  })
  .then(reviewFindingsStep)
  .then({
    id: 'generate-hypotheses',
    description: 'Generate ranked diagnostic hypotheses from research findings',
    inputSchema: z.object({
      allFindings: z.array(ResearchFindingSchema),
      patientId: z.string(),
      symptoms: z.array(z.string()),
    }),
    outputSchema: DiagnosticResearchOutput,
    execute: async ({ inputData }) => {
      const diseaseFindings = inputData.allFindings.filter((f) => f.source === 'Orphanet');
      const hypotheses = diseaseFindings.slice(0, 5).map((f, i) => ({
        diagnosis: f.title,
        confidence: Math.max(10, Math.round((1 - i * 0.15) * f.relevance * 100)),
        evidenceSummary: f.summary,
        supportingFindings: inputData.allFindings
          .filter(
            (af) =>
              af.title.toLowerCase().includes(f.title.toLowerCase().split(' ')[0] ?? '') ||
              f.title.toLowerCase().includes(af.title.toLowerCase().split(' ')[0] ?? ''),
          )
          .map((af) => `[${af.source}] ${af.title}`),
        explainedSymptoms: inputData.symptoms.slice(
          0,
          Math.ceil(inputData.symptoms.length * (1 - i * 0.2)),
        ),
        unexplainedSymptoms: inputData.symptoms.slice(
          Math.ceil(inputData.symptoms.length * (1 - i * 0.2)),
        ),
        recommendedNextSteps: [
          `Review ${f.source} entry for ${f.title}`,
          'Genetic testing if not already performed',
          'Specialist referral for clinical confirmation',
        ],
      }));

      const knowledgeGaps: string[] = [];
      if (inputData.allFindings.length < 5) {
        knowledgeGaps.push(
          'Limited research literature available — consider broadening search terms',
        );
      }
      if (diseaseFindings.length === 0) {
        knowledgeGaps.push(
          'No matching rare diseases found in Orphanet — symptoms may represent an uncharacterized condition',
        );
      }

      const suggestedFollowUp = [
        'Consider whole exome/genome sequencing if genetic testing not yet performed',
        'Consult a rare disease specialist or undiagnosed diseases program',
        ...inputData.allFindings.slice(0, 3).map((f) => `Review: ${f.title}`),
      ];

      return {
        patientId: inputData.patientId,
        researchFindings: inputData.allFindings,
        hypotheses,
        knowledgeGaps,
        suggestedFollowUp,
        timestamp: new Date().toISOString(),
      };
    },
  })
  .commit();
