import { createStep, Workflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { documentParserTool } from '../tools/document-parser.js';
import { hpoMapperTool } from '../tools/hpo-mapper.js';

const PatientIntakeInput = z.object({
  documentText: z.string().describe('Raw text content of the patient medical document'),
  documentType: z
    .enum([
      'diagnostic-report',
      'procedure-note',
      'clinical-note',
      'patient-document',
      'research-paper',
      'other',
    ])
    .optional()
    .describe('Type of document being uploaded'),
  patientId: z.string().describe('Anonymized patient identifier'),
});

const PhenotypeSchema = z.object({
  originalText: z.string(),
  hpoTerms: z.array(z.object({ id: z.string(), name: z.string() })),
  confidence: z.number(),
});

const PatientIntakeOutput = z.object({
  patientId: z.string(),
  parsedDocument: z.record(z.string(), z.unknown()),
  phenotypes: z.array(PhenotypeSchema),
  symptoms: z.array(z.string()),
  diagnoses: z.array(z.string()),
  status: z.enum(['complete', 'needs-review', 'human-reviewed']),
});

/**
 * HITL review step: suspends workflow to present extracted phenotypes for human review.
 * The suspend payload contains the phenotypes to review.
 * The resume payload contains the reviewer's decisions.
 */
const PhenotypeSuspendSchema = z.object({
  phenotypes: z.array(PhenotypeSchema),
  patientId: z.string(),
  message: z.string(),
});

const PhenotypeResumeSchema = z.object({
  approvedIndices: z.array(z.number()).describe('Indices of approved phenotypes (0-based)'),
  notes: z.string().optional().describe('Optional reviewer notes'),
});

const ReviewInputSchema = z.object({
  patientId: z.string(),
  parsedDocument: z.record(z.string(), z.unknown()),
  phenotypes: z.array(PhenotypeSchema),
  symptoms: z.array(z.string()),
  diagnoses: z.array(z.string()),
});

const reviewPhenotypesStep = createStep({
  id: 'review-phenotypes',
  description:
    'Suspends for human review of extracted phenotypes before proceeding to output. Reviewer can approve or reject individual phenotype mappings.',
  inputSchema: ReviewInputSchema,
  outputSchema: ReviewInputSchema,
  suspendSchema: PhenotypeSuspendSchema,
  resumeSchema: PhenotypeResumeSchema,
  execute: async ({ inputData, suspend, resumeData }) => {
    if (!resumeData) {
      const lowConfidence = inputData.phenotypes.filter((p) => p.confidence < 0.7);
      const needsReview = lowConfidence.length > 0;

      if (needsReview) {
        return suspend(
          {
            phenotypes: inputData.phenotypes,
            patientId: inputData.patientId,
            message: `${inputData.phenotypes.length} phenotype(s) extracted. ${lowConfidence.length} have low confidence (<0.7). Please review and approve.`,
          },
          { resumeLabel: 'phenotype-review' },
        );
      }

      return inputData;
    }

    const approved = resumeData.approvedIndices
      .filter((i) => i >= 0 && i < inputData.phenotypes.length)
      .map((i) => inputData.phenotypes[i])
      .filter((p): p is NonNullable<typeof p> => p != null);

    return {
      ...inputData,
      phenotypes: approved,
    };
  },
});

export const patientIntakeWorkflow = new Workflow({
  id: 'patient-intake',
  description:
    'Process uploaded patient documents: parse medical records, extract symptoms, map to HPO terms, and prepare for research. Suspends for human review of extracted phenotypes.',
  inputSchema: PatientIntakeInput,
  outputSchema: PatientIntakeOutput,
})
  .then({
    id: 'parse-document',
    description: 'Parse the uploaded medical document to extract structured data',
    inputSchema: PatientIntakeInput,
    outputSchema: z.object({
      parsedDocument: z.record(z.string(), z.unknown()),
      symptoms: z.array(z.string()),
      diagnoses: z.array(z.string()),
      patientId: z.string(),
    }),
    execute: async ({ inputData }) => {
      const executeParse = documentParserTool.execute;
      if (!executeParse) throw new Error('documentParserTool.execute is not defined');
      const result = await executeParse(
        {
          text: inputData.documentText,
          ...(inputData.documentType ? { documentType: inputData.documentType } : {}),
        },
        {} as never,
      );

      return {
        parsedDocument: result as unknown as Record<string, unknown>,
        symptoms: 'symptoms' in result ? (result.symptoms as string[]) : [],
        diagnoses: 'diagnoses' in result ? (result.diagnoses as string[]) : [],
        patientId: inputData.patientId,
      };
    },
  })
  .then({
    id: 'map-phenotypes',
    description: 'Map extracted symptoms to HPO terms',
    inputSchema: z.object({
      parsedDocument: z.record(z.string(), z.unknown()),
      symptoms: z.array(z.string()),
      diagnoses: z.array(z.string()),
      patientId: z.string(),
    }),
    outputSchema: ReviewInputSchema,
    execute: async ({ inputData }) => {
      const allSymptoms = [...inputData.symptoms, ...inputData.diagnoses];

      if (allSymptoms.length === 0) {
        return {
          patientId: inputData.patientId,
          parsedDocument: inputData.parsedDocument,
          phenotypes: [],
          symptoms: inputData.symptoms,
          diagnoses: inputData.diagnoses,
        };
      }

      const executeMapper = hpoMapperTool.execute;
      if (!executeMapper) throw new Error('hpoMapperTool.execute is not defined');
      const mappingResult = await executeMapper({ symptoms: allSymptoms }, {} as never);

      const phenotypes =
        'mappings' in mappingResult
          ? (
              mappingResult.mappings as Array<{
                originalText: string;
                matchedTerms: Array<{ id: string; name: string }>;
                confidence: number;
              }>
            ).map((m) => ({
              originalText: m.originalText,
              hpoTerms: m.matchedTerms.map((t) => ({ id: t.id, name: t.name })),
              confidence: m.confidence,
            }))
          : [];

      return {
        patientId: inputData.patientId,
        parsedDocument: inputData.parsedDocument,
        phenotypes,
        symptoms: inputData.symptoms,
        diagnoses: inputData.diagnoses,
      };
    },
  })
  .then(reviewPhenotypesStep)
  .then({
    id: 'prepare-output',
    description: 'Prepare final intake output with review status',
    inputSchema: ReviewInputSchema,
    outputSchema: PatientIntakeOutput,
    execute: async ({ inputData, getStepResult }) => {
      const reviewResult = getStepResult<{
        status: string;
        suspendPayload?: unknown;
        resumePayload?: unknown;
      }>('review-phenotypes');
      const wasHumanReviewed = reviewResult?.resumePayload !== undefined;

      const hasLowConfidence = inputData.phenotypes.some((p) => p.confidence < 0.7);
      const status: 'complete' | 'needs-review' | 'human-reviewed' = wasHumanReviewed
        ? 'human-reviewed'
        : hasLowConfidence
          ? 'needs-review'
          : 'complete';

      return {
        patientId: inputData.patientId,
        parsedDocument: inputData.parsedDocument,
        phenotypes: inputData.phenotypes,
        symptoms: inputData.symptoms,
        diagnoses: inputData.diagnoses,
        status,
      };
    },
  })
  .commit();
