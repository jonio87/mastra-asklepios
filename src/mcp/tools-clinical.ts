import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mastra } from '../mastra.js';
import { captureDataTool } from '../tools/capture-data.js';
import { ingestDocumentTool } from '../tools/ingest-document.js';
import { knowledgeQueryTool } from '../tools/knowledge-query.js';
import { queryDataTool } from '../tools/query-data.js';

/**
 * Clinical data tools — Layer 2 structured clinical record + Layer 3 document knowledge base.
 * Exposes 4 tools for external agents to write/read patient clinical data and documents.
 */
export function registerClinicalTools(server: McpServer): void {
  // ─── capture_clinical_data — write to Layer 2 structured store ─────
  server.registerTool(
    'capture_clinical_data',
    {
      description:
        'Capture clinical data into the structured clinical record. Uses a type discriminator to route data to the correct handler. Supports: patient-report (symptom updates, concerns, goals), agent-learning (diagnostic insights, patterns), contradiction (conflicting findings), lab-result, treatment-trial, consultation.',
      inputSchema: {
        type: z
          .enum([
            'patient-report',
            'agent-learning',
            'contradiction',
            'lab-result',
            'treatment-trial',
            'consultation',
          ])
          .describe('Type of clinical data to capture'),
        patientId: z.string().describe('Patient resource ID (e.g., "patient-001")'),
        // patient-report fields
        reportType: z
          .enum([
            'symptom-update',
            'treatment-response',
            'concern',
            'goal',
            'functional-status',
            'self-observation',
          ])
          .optional()
          .describe('[patient-report] Type of patient report'),
        content: z.string().optional().describe('[patient-report|agent-learning] The text content'),
        severity: z.number().min(1).max(10).optional().describe('[patient-report] Severity 1-10'),
        extractedInsights: z
          .array(z.string())
          .optional()
          .describe('[patient-report] Key clinical insights extracted'),
        // agent-learning fields
        category: z
          .enum([
            'pattern-noticed',
            'contradiction-found',
            'treatment-insight',
            'patient-behavior',
            'temporal-correlation',
            'diagnostic-clue',
            'evidence-gap',
          ])
          .optional()
          .describe('[agent-learning] Category of learning'),
        confidence: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('[agent-learning] Confidence 0-100'),
        relatedHypotheses: z
          .array(z.string())
          .optional()
          .describe('[agent-learning] Related diagnostic hypotheses'),
        // contradiction fields
        finding1: z.string().optional().describe('[contradiction] First finding'),
        finding1Date: z.string().optional().describe('[contradiction] Date of first finding'),
        finding1Method: z
          .string()
          .optional()
          .describe('[contradiction] Method/platform of first finding'),
        finding2: z.string().optional().describe('[contradiction] Second (contradicting) finding'),
        finding2Date: z.string().optional().describe('[contradiction] Date of second finding'),
        finding2Method: z
          .string()
          .optional()
          .describe('[contradiction] Method/platform of second finding'),
        resolutionPlan: z.string().optional().describe('[contradiction] Plan to resolve'),
        diagnosticImpact: z
          .string()
          .optional()
          .describe('[contradiction] Impact on differential diagnosis'),
        // lab-result fields
        testName: z.string().optional().describe('[lab-result] Test name (e.g., "WBC", "CRP")'),
        value: z.union([z.number(), z.string()]).optional().describe('[lab-result] Test value'),
        unit: z.string().optional().describe('[lab-result] Unit of measurement'),
        date: z.string().optional().describe('[lab-result|consultation] Date (ISO 8601)'),
        referenceRange: z.string().optional().describe('[lab-result] Reference range'),
        flag: z
          .enum(['normal', 'low', 'high', 'critical'])
          .optional()
          .describe('[lab-result] Flag status'),
        source: z.string().optional().describe('[lab-result] Lab/institution'),
        notes: z.string().optional().describe('[lab-result] Additional notes'),
        // treatment-trial fields
        medication: z.string().optional().describe('[treatment-trial] Medication name'),
        efficacy: z
          .enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown'])
          .optional()
          .describe('[treatment-trial] Treatment efficacy'),
        drugClass: z
          .string()
          .optional()
          .describe('[treatment-trial] Drug class (e.g., "CGRP mAb")'),
        indication: z.string().optional().describe('[treatment-trial] What it was prescribed for'),
        startDate: z.string().optional().describe('[treatment-trial] When started'),
        endDate: z.string().optional().describe('[treatment-trial] When stopped'),
        dosage: z.string().optional().describe('[treatment-trial] Dosage and frequency'),
        sideEffects: z.array(z.string()).optional().describe('[treatment-trial] Side effects'),
        reasonDiscontinued: z.string().optional().describe('[treatment-trial] Why stopped'),
        adequateTrial: z.boolean().optional().describe('[treatment-trial] Was the trial adequate?'),
        // consultation fields
        provider: z.string().optional().describe('[consultation] Provider name'),
        specialty: z.string().optional().describe('[consultation] Medical specialty'),
        conclusionsStatus: z
          .enum(['documented', 'unknown', 'pending'])
          .optional()
          .describe('[consultation] Whether conclusions are documented'),
        institution: z.string().optional().describe('[consultation] Institution name'),
        reason: z.string().optional().describe('[consultation] Reason for consultation'),
        findings: z.string().optional().describe('[consultation] Clinical findings'),
        conclusions: z.string().optional().describe('[consultation] Specialist conclusions'),
        recommendations: z
          .array(z.string())
          .optional()
          .describe('[consultation] Specialist recommendations'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      if (!captureDataTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Clinical capture tool not available' }],
          isError: true,
        };
      }

      // Build the discriminated union input from flat MCP fields
      const toolInput = buildCaptureInput(input);

      const result = await captureDataTool.execute(toolInput, { mastra });

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

  // ─── query_clinical_data — read from Layer 2 structured store ──────
  server.registerTool(
    'query_clinical_data',
    {
      description:
        'Query the structured clinical record. Uses a type discriminator to route the query. Supports: labs (with trend computation), treatments (with exhausted-class detection), consultations (with missing-conclusion flagging), contradictions (with resolution tracking), patient-history (composite recent view).',
      inputSchema: {
        type: z
          .enum(['labs', 'treatments', 'consultations', 'contradictions', 'patient-history'])
          .describe('Type of clinical data to query'),
        patientId: z.string().describe('Patient resource ID'),
        // labs filters
        testName: z.string().optional().describe('[labs] Filter by test name (e.g., "WBC")'),
        dateFrom: z.string().optional().describe('[labs|treatments] Start date filter'),
        dateTo: z.string().optional().describe('[labs|treatments] End date filter'),
        computeTrend: z
          .boolean()
          .optional()
          .describe('[labs] Also compute trend analysis for the test'),
        // treatments filters
        drugClass: z.string().optional().describe('[treatments] Filter by drug class'),
        filterEfficacy: z
          .enum(['none', 'minimal', 'partial', 'significant', 'complete', 'unknown'])
          .optional()
          .describe('[treatments] Filter by efficacy'),
        // consultations filters
        filterSpecialty: z.string().optional().describe('[consultations] Filter by specialty'),
        filterProvider: z.string().optional().describe('[consultations] Filter by provider name'),
        // contradictions filters
        status: z
          .enum(['unresolved', 'pending', 'resolved'])
          .optional()
          .describe('[contradictions] Filter by resolution status'),
        // patient-history filters
        recentDays: z
          .number()
          .optional()
          .describe('[patient-history] Number of days to look back (default: 30)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!queryDataTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Clinical query tool not available' }],
          isError: true,
        };
      }

      const toolInput = buildQueryInput(input);

      const result = await queryDataTool.execute(toolInput, { mastra });

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

  // ─── ingest_document — write to Layer 3 knowledge base ────────────
  server.registerTool(
    'ingest_document',
    {
      description:
        "Ingest a medical document into the patient's knowledge base for semantic search. The document is chunked by type, embedded, and stored. Requires OPENAI_API_KEY for embeddings.",
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
        text: z.string().describe('Full text of the document'),
        documentType: z
          .enum([
            'clinical-note',
            'lab-report',
            'imaging-report',
            'research-paper',
            'consultation-letter',
            'other',
          ])
          .describe('Type of medical document'),
        date: z.string().optional().describe('Document date (ISO 8601)'),
        source: z.string().optional().describe('Source institution or provider'),
        title: z.string().optional().describe('Document title or description'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      if (!ingestDocumentTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Document ingestion tool not available' }],
          isError: true,
        };
      }

      const result = await ingestDocumentTool.execute(input, { mastra });

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

  // ─── search_knowledge — read from Layer 3 knowledge base ──────────
  server.registerTool(
    'search_knowledge',
    {
      description:
        "Search the patient's document knowledge base using natural language. Returns relevant document chunks ranked by semantic similarity. Requires OPENAI_API_KEY.",
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
        query: z.string().describe('Natural language search query'),
        documentType: z
          .enum([
            'clinical-note',
            'lab-report',
            'imaging-report',
            'research-paper',
            'consultation-letter',
            'other',
          ])
          .optional()
          .describe('Filter by document type'),
        topK: z.number().optional().describe('Number of results to return (default: 5)'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      if (!knowledgeQueryTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Knowledge search tool not available' }],
          isError: true,
        };
      }

      const result = await knowledgeQueryTool.execute(input, { mastra });

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
}

// ─── Input builders ─────────────────────────────────────────────────

type CaptureInput = Parameters<NonNullable<typeof captureDataTool.execute>>[0];
type QueryInput = Parameters<NonNullable<typeof queryDataTool.execute>>[0];

function g(input: Record<string, unknown>, key: string): unknown {
  return input[key];
}

function gs(input: Record<string, unknown>, key: string): string {
  return input[key] as string;
}

function buildCaptureReport(input: Record<string, unknown>, patientId: string): CaptureInput {
  return {
    type: 'patient-report',
    patientId,
    reportType: gs(input, 'reportType') as
      | 'symptom-update'
      | 'treatment-response'
      | 'concern'
      | 'goal'
      | 'functional-status'
      | 'self-observation',
    content: gs(input, 'content'),
    ...(g(input, 'severity') !== undefined ? { severity: g(input, 'severity') as number } : {}),
    ...(g(input, 'extractedInsights')
      ? { extractedInsights: g(input, 'extractedInsights') as string[] }
      : {}),
  };
}

function buildCaptureLearning(input: Record<string, unknown>, patientId: string): CaptureInput {
  return {
    type: 'agent-learning',
    patientId,
    category: gs(input, 'category') as
      | 'pattern-noticed'
      | 'contradiction-found'
      | 'treatment-insight'
      | 'patient-behavior'
      | 'temporal-correlation'
      | 'diagnostic-clue'
      | 'evidence-gap',
    content: gs(input, 'content'),
    ...(g(input, 'confidence') !== undefined
      ? { confidence: g(input, 'confidence') as number }
      : {}),
    ...(g(input, 'relatedHypotheses')
      ? { relatedHypotheses: g(input, 'relatedHypotheses') as string[] }
      : {}),
  };
}

function buildCaptureContradiction(
  input: Record<string, unknown>,
  patientId: string,
): CaptureInput {
  return {
    type: 'contradiction',
    patientId,
    finding1: gs(input, 'finding1'),
    finding2: gs(input, 'finding2'),
    ...(g(input, 'finding1Date') ? { finding1Date: gs(input, 'finding1Date') } : {}),
    ...(g(input, 'finding1Method') ? { finding1Method: gs(input, 'finding1Method') } : {}),
    ...(g(input, 'finding2Date') ? { finding2Date: gs(input, 'finding2Date') } : {}),
    ...(g(input, 'finding2Method') ? { finding2Method: gs(input, 'finding2Method') } : {}),
    ...(g(input, 'resolutionPlan') ? { resolutionPlan: gs(input, 'resolutionPlan') } : {}),
    ...(g(input, 'diagnosticImpact') ? { diagnosticImpact: gs(input, 'diagnosticImpact') } : {}),
  };
}

function buildCaptureLab(input: Record<string, unknown>, patientId: string): CaptureInput {
  return {
    type: 'lab-result',
    patientId,
    testName: gs(input, 'testName'),
    value: g(input, 'value') as number | string,
    unit: gs(input, 'unit'),
    date: gs(input, 'date'),
    ...(g(input, 'referenceRange') ? { referenceRange: gs(input, 'referenceRange') } : {}),
    ...(g(input, 'flag')
      ? { flag: gs(input, 'flag') as 'normal' | 'low' | 'high' | 'critical' }
      : {}),
    ...(g(input, 'source') ? { source: gs(input, 'source') } : {}),
    ...(g(input, 'notes') ? { notes: gs(input, 'notes') } : {}),
  };
}

function buildCaptureTrial(input: Record<string, unknown>, patientId: string): CaptureInput {
  return {
    type: 'treatment-trial',
    patientId,
    medication: gs(input, 'medication'),
    efficacy: gs(input, 'efficacy') as
      | 'none'
      | 'minimal'
      | 'partial'
      | 'significant'
      | 'complete'
      | 'unknown',
    ...(g(input, 'drugClass') ? { drugClass: gs(input, 'drugClass') } : {}),
    ...(g(input, 'indication') ? { indication: gs(input, 'indication') } : {}),
    ...(g(input, 'startDate') ? { startDate: gs(input, 'startDate') } : {}),
    ...(g(input, 'endDate') ? { endDate: gs(input, 'endDate') } : {}),
    ...(g(input, 'dosage') ? { dosage: gs(input, 'dosage') } : {}),
    ...(g(input, 'sideEffects') ? { sideEffects: g(input, 'sideEffects') as string[] } : {}),
    ...(g(input, 'reasonDiscontinued')
      ? { reasonDiscontinued: gs(input, 'reasonDiscontinued') }
      : {}),
    ...(g(input, 'adequateTrial') !== undefined
      ? { adequateTrial: g(input, 'adequateTrial') as boolean }
      : {}),
  };
}

function buildCaptureConsultation(input: Record<string, unknown>, patientId: string): CaptureInput {
  return {
    type: 'consultation',
    patientId,
    provider: gs(input, 'provider'),
    specialty: gs(input, 'specialty'),
    date: gs(input, 'date'),
    conclusionsStatus: gs(input, 'conclusionsStatus') as 'documented' | 'unknown' | 'pending',
    ...(g(input, 'institution') ? { institution: gs(input, 'institution') } : {}),
    ...(g(input, 'reason') ? { reason: gs(input, 'reason') } : {}),
    ...(g(input, 'findings') ? { findings: gs(input, 'findings') } : {}),
    ...(g(input, 'conclusions') ? { conclusions: gs(input, 'conclusions') } : {}),
    ...(g(input, 'recommendations')
      ? { recommendations: g(input, 'recommendations') as string[] }
      : {}),
  };
}

function buildCaptureInput(input: Record<string, unknown>): CaptureInput {
  const type = gs(input, 'type');
  const patientId = gs(input, 'patientId');

  switch (type) {
    case 'patient-report':
      return buildCaptureReport(input, patientId);
    case 'agent-learning':
      return buildCaptureLearning(input, patientId);
    case 'contradiction':
      return buildCaptureContradiction(input, patientId);
    case 'lab-result':
      return buildCaptureLab(input, patientId);
    case 'treatment-trial':
      return buildCaptureTrial(input, patientId);
    case 'consultation':
      return buildCaptureConsultation(input, patientId);
    default:
      return {
        type: 'patient-report',
        patientId,
        reportType: 'concern',
        content: `Unknown: ${type}`,
      };
  }
}

function buildQueryLabs(input: Record<string, unknown>, patientId: string): QueryInput {
  return {
    type: 'labs',
    patientId,
    ...(g(input, 'testName') ? { testName: gs(input, 'testName') } : {}),
    ...(g(input, 'dateFrom') ? { dateFrom: gs(input, 'dateFrom') } : {}),
    ...(g(input, 'dateTo') ? { dateTo: gs(input, 'dateTo') } : {}),
    ...(g(input, 'computeTrend') !== undefined
      ? { computeTrend: g(input, 'computeTrend') as boolean }
      : {}),
  };
}

function buildQueryTreatments(input: Record<string, unknown>, patientId: string): QueryInput {
  return {
    type: 'treatments',
    patientId,
    ...(g(input, 'drugClass') ? { drugClass: gs(input, 'drugClass') } : {}),
    ...(g(input, 'filterEfficacy')
      ? {
          efficacy: gs(input, 'filterEfficacy') as
            | 'none'
            | 'minimal'
            | 'partial'
            | 'significant'
            | 'complete'
            | 'unknown',
        }
      : {}),
  };
}

function buildQueryInput(input: Record<string, unknown>): QueryInput {
  const type = gs(input, 'type');
  const patientId = gs(input, 'patientId');

  switch (type) {
    case 'labs':
      return buildQueryLabs(input, patientId);
    case 'treatments':
      return buildQueryTreatments(input, patientId);
    case 'consultations':
      return {
        type: 'consultations',
        patientId,
        ...(g(input, 'filterSpecialty') ? { specialty: gs(input, 'filterSpecialty') } : {}),
        ...(g(input, 'filterProvider') ? { provider: gs(input, 'filterProvider') } : {}),
      };
    case 'contradictions':
      return {
        type: 'contradictions',
        patientId,
        ...(g(input, 'status')
          ? { status: gs(input, 'status') as 'unresolved' | 'pending' | 'resolved' }
          : {}),
      };
    case 'patient-history':
      return {
        type: 'patient-history',
        patientId,
        ...(g(input, 'recentDays') !== undefined
          ? { recentDays: g(input, 'recentDays') as number }
          : {}),
      };
    default:
      return { type: 'patient-history', patientId };
  }
}
