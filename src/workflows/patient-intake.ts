import { Workflow } from '@mastra/core/workflows';
import { z } from 'zod';

import { documentParserTool } from '../tools/document-parser.js';
import { hpoMapperTool } from '../tools/hpo-mapper.js';

const PatientIntakeInput = z.object({
  documentText: z.string().describe('Raw text content of the patient medical document'),
  documentType: z
    .enum([
      'medical-record',
      'lab-report',
      'genetic-report',
      'clinical-note',
      'referral',
      'unknown',
    ])
    .optional()
    .describe('Type of document being uploaded'),
  patientId: z.string().describe('Anonymized patient identifier'),
});

const PatientIntakeOutput = z.object({
  patientId: z.string(),
  parsedDocument: z.record(z.string(), z.unknown()),
  phenotypes: z.array(
    z.object({
      originalText: z.string(),
      hpoTerms: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
      confidence: z.number(),
    }),
  ),
  symptoms: z.array(z.string()),
  diagnoses: z.array(z.string()),
  status: z.enum(['complete', 'needs-review']),
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
    outputSchema: z.object({
      patientId: z.string(),
      parsedDocument: z.record(z.string(), z.unknown()),
      phenotypes: z.array(
        z.object({
          originalText: z.string(),
          hpoTerms: z.array(z.object({ id: z.string(), name: z.string() })),
          confidence: z.number(),
        }),
      ),
      symptoms: z.array(z.string()),
      diagnoses: z.array(z.string()),
    }),
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
  .then({
    id: 'prepare-output',
    description: 'Prepare final intake output with review status',
    inputSchema: z.object({
      patientId: z.string(),
      parsedDocument: z.record(z.string(), z.unknown()),
      phenotypes: z.array(
        z.object({
          originalText: z.string(),
          hpoTerms: z.array(z.object({ id: z.string(), name: z.string() })),
          confidence: z.number(),
        }),
      ),
      symptoms: z.array(z.string()),
      diagnoses: z.array(z.string()),
    }),
    outputSchema: PatientIntakeOutput,
    execute: async ({ inputData }) => {
      const hasLowConfidence = inputData.phenotypes.some((p) => p.confidence < 0.7);
      const status: 'complete' | 'needs-review' = hasLowConfidence ? 'needs-review' : 'complete';

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
