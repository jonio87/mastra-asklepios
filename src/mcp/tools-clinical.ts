import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mastra } from '../mastra.js';
import { evidenceProvenanceFields } from '../schemas/clinical-record.js';
import { bodyRegionEnum, diagnosisStatusEnum } from '../schemas/diagnosis.js';
import { findingTypeEnum } from '../schemas/imaging-finding.js';
import { findingDomainEnum, progressionDirectionEnum } from '../schemas/progression.js';
import { reportLanguageEnum } from '../schemas/report-version.js';
import {
  certaintyLevelEnum,
  evidenceLevelEnum,
  externalIdTypeEnum,
} from '../schemas/research-record.js';
import { extractionMethodEnum, sourceDocCategoryEnum } from '../schemas/source-document.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { captureDataTool } from '../tools/capture-data.js';
import { evidenceLinkTool } from '../tools/evidence-link.js';
import { ingestDocumentTool } from '../tools/ingest-document.js';
import { knowledgeQueryTool } from '../tools/knowledge-query.js';
import { queryDataTool } from '../tools/query-data.js';
import { mcpLog, notifyResourceUpdated } from './notifications.js';

/**
 * Clinical data tools — Layer 2 structured clinical record + Layer 3 document knowledge base.
 * Exposes tools for external agents to write/read patient clinical data, research findings, and documents.
 */
export function registerClinicalTools(server: McpServer): void {
  // ─── capture_clinical_data — write to Layer 2 structured store ─────
  server.registerTool(
    'capture_clinical_data',
    {
      description:
        'Capture clinical or research data into the structured record. Uses a type discriminator to route data to the correct handler. Supports: patient-report, agent-learning, contradiction, lab-result, treatment-trial, consultation, research-finding, research-query, hypothesis, source-document (Layer 0 provenance-tracked source files), diagnosis (Layer 2F explicit diagnosis registry), progression (Layer 2G temporal finding chains), report-version (Layer 5 versioned report tracking).',
      inputSchema: {
        type: z
          .enum([
            'patient-report',
            'agent-learning',
            'contradiction',
            'lab-result',
            'treatment-trial',
            'consultation',
            'research-finding',
            'research-query',
            'hypothesis',
            'source-document',
            'diagnosis',
            'progression',
            'report-version',
          ])
          .describe('Type of clinical/research data to capture'),
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
        // research-finding fields
        sourceTool: z
          .string()
          .optional()
          .describe('[research-finding] Tool that produced this finding'),
        externalId: z
          .string()
          .optional()
          .describe('[research-finding] External identifier (PMID, NCT ID, ORPHA code, etc.)'),
        externalIdType: externalIdTypeEnum
          .optional()
          .describe('[research-finding] Type of external identifier'),
        title: z.string().optional().describe('[research-finding|hypothesis] Title or name'),
        summary: z.string().optional().describe('[research-finding] Finding summary'),
        url: z.string().optional().describe('[research-finding] Source URL'),
        relevance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('[research-finding] Relevance score 0.0-1.0'),
        evidenceLevel: evidenceLevelEnum.optional().describe('[research-finding] Evidence level'),
        researchQueryId: z
          .string()
          .optional()
          .describe('[research-finding] FK to research query that produced this'),
        rawData: z
          .string()
          .optional()
          .describe('[research-finding] Full JSON response for re-processing'),
        // research-query fields
        query: z.string().optional().describe('[research-query] Original search query'),
        toolUsed: z
          .string()
          .optional()
          .describe('[research-query] Tool used (e.g., "deepResearch", "biomcp_article_searcher")'),
        agent: z.string().optional().describe('[research-query] Agent that initiated the query'),
        resultCount: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('[research-query] Number of results found'),
        findingIds: z
          .array(z.string())
          .optional()
          .describe('[research-query] IDs of research findings from this query'),
        synthesis: z.string().optional().describe('[research-query] Synthesized summary'),
        researchGaps: z
          .array(z.string())
          .optional()
          .describe('[research-query] Identified knowledge gaps'),
        suggestedFollowUp: z
          .array(z.string())
          .optional()
          .describe('[research-query] Suggested follow-up queries'),
        stage: z
          .number()
          .int()
          .min(0)
          .max(9)
          .optional()
          .describe('[research-query|hypothesis] Diagnostic flow stage (0-9)'),
        durationMs: z
          .number()
          .int()
          .optional()
          .describe('[research-query] Query execution time in ms'),
        // hypothesis fields
        name: z.string().optional().describe('[hypothesis] Hypothesis name'),
        icdCode: z.string().optional().describe('[hypothesis] ICD-10 code'),
        probabilityLow: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('[hypothesis] Lower bound probability 0-100'),
        probabilityHigh: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe('[hypothesis] Upper bound probability 0-100'),
        advocateCase: z.string().optional().describe('[hypothesis] Case in favor'),
        skepticCase: z.string().optional().describe('[hypothesis] Case against'),
        arbiterVerdict: z.string().optional().describe('[hypothesis] Arbiter synthesis/verdict'),
        hypothesisEvidenceTier: z
          .enum(['T1', 'T2', 'T3'])
          .optional()
          .describe('[hypothesis] Evidence tier for hypothesis'),
        certaintyLevel: certaintyLevelEnum.optional().describe('[hypothesis] Certainty level'),
        version: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('[hypothesis] Version number (increments on re-ranking)'),
        // source-document fields (Layer 0)
        originalFilename: z.string().optional().describe('[source-document] Original file name'),
        originalFileHash: z
          .string()
          .optional()
          .describe('[source-document] SHA-256 of source file'),
        originalFileSizeBytes: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('[source-document] File size in bytes'),
        originalPageCount: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('[source-document] Page count'),
        mimeType: z.string().optional().describe('[source-document] MIME type'),
        extractionMethod: extractionMethodEnum
          .optional()
          .describe('[source-document] Extraction method'),
        extractionConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('[source-document] Extraction confidence 0.0-1.0'),
        extractionDate: z.string().optional().describe('[source-document] Extraction date'),
        extractionTool: z.string().optional().describe('[source-document] Extraction tool'),
        extractionWave: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('[source-document] Batch number'),
        extractedMarkdownPath: z
          .string()
          .optional()
          .describe('[source-document] Path to extracted markdown'),
        preProcessing: z.string().optional().describe('[source-document] Pre-processing steps'),
        postProcessing: z.string().optional().describe('[source-document] Post-processing steps'),
        pipelineVersion: z.string().optional().describe('[source-document] Pipeline version'),
        docCategory: sourceDocCategoryEnum
          .optional()
          .describe('[source-document] Document category'),
        subcategory: z.string().optional().describe('[source-document] Subcategory'),
        facility: z.string().optional().describe('[source-document|consultation] Facility name'),
        physician: z.string().optional().describe('[source-document] Physician name'),
        docLanguage: z
          .string()
          .optional()
          .describe('[source-document] Document language (pl, en, de)'),
        tags: z.array(z.string()).optional().describe('[source-document] Document tags'),
        // diagnosis fields (Layer 2F)
        conditionName: z.string().optional().describe('[diagnosis] Condition name'),
        conditionNamePl: z.string().optional().describe('[diagnosis] Polish condition name'),
        onsetDate: z.string().optional().describe('[diagnosis] When condition started'),
        firstDocumentedDate: z.string().optional().describe('[diagnosis] First documented date'),
        currentStatus: diagnosisStatusEnum.optional().describe('[diagnosis] Current status'),
        bodyRegion: bodyRegionEnum.optional().describe('[diagnosis] Body region'),
        diagnosisConfidence: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('[diagnosis] Confidence 0.0-1.0'),
        supportingEvidenceIds: z
          .array(z.string())
          .optional()
          .describe('[diagnosis] Supporting evidence IDs'),
        // progression fields (Layer 2G)
        findingChainId: z.string().optional().describe('[progression] Shared chain ID'),
        findingName: z.string().optional().describe('[progression] Finding name'),
        findingDomain: findingDomainEnum.optional().describe('[progression] Finding domain'),
        anatomicalLocation: z.string().optional().describe('[progression] Anatomical location'),
        progressionDate: z.string().optional().describe('[progression] Observation date'),
        progressionValue: z.string().optional().describe('[progression] Observed value'),
        numericValue: z.number().optional().describe('[progression] Numeric value'),
        progressionUnit: z.string().optional().describe('[progression] Unit of measurement'),
        direction: progressionDirectionEnum.optional().describe('[progression] Direction'),
        comparisonNote: z.string().optional().describe('[progression] Comparison note'),
        sourceRecordId: z.string().optional().describe('[progression] FK to source record'),
        sourceRecordType: z.string().optional().describe('[progression] Source record type'),
        // report-version fields (Layer 5)
        reportName: z.string().optional().describe('[report-version] Report name'),
        reportLanguage: reportLanguageEnum.optional().describe('[report-version] Language'),
        reportVersion: z.string().optional().describe('[report-version] Version string'),
        filePath: z.string().optional().describe('[report-version] File path'),
        contentHash: z.string().optional().describe('[report-version] SHA-256 content hash'),
        lineCount: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('[report-version] Line count'),
        subsectionCount: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('[report-version] Subsection count'),
        changesSummary: z.string().optional().describe('[report-version] Changes summary'),
        changeSource: z
          .string()
          .optional()
          .describe('[report-version] What triggered this version'),
        // evidence provenance fields (apply to all types) — imported from clinical-record.ts
        ...evidenceProvenanceFields,
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
      const patientId = gs(input, 'patientId');

      // Notify subscribed clients that patient data changed
      mcpLog(
        server,
        'info',
        { tool: 'capture_clinical_data', type: gs(input, 'type'), patientId },
        'clinical',
      );
      notifyResourceUpdated(server, `patient://${patientId}/profile`);

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
        'Query structured clinical or research data. Uses a type discriminator to route the query. Supports: labs, treatments, consultations, contradictions, patient-history, findings, research-queries, hypotheses, hypothesis-timeline, research-summary, source-documents (Layer 0 with category counts), imaging-findings (structured decomposed findings), diagnoses (ICD-10 registry), progressions (temporal chains), report-versions (version history).',
      inputSchema: {
        type: z
          .enum([
            'labs',
            'treatments',
            'consultations',
            'contradictions',
            'patient-history',
            'findings',
            'research-queries',
            'hypotheses',
            'hypothesis-timeline',
            'research-summary',
            'source-documents',
            'imaging-findings',
            'diagnoses',
            'progressions',
            'report-versions',
          ])
          .describe('Type of clinical/research data to query'),
        patientId: z.string().describe('Patient resource ID'),
        // labs filters
        testName: z.string().optional().describe('[labs] Filter by test name (e.g., "WBC")'),
        dateFrom: z.string().optional().describe('[labs|treatments] Start date filter'),
        dateTo: z.string().optional().describe('[labs|treatments] End date filter'),
        computeTrend: z
          .boolean()
          .optional()
          .describe('[labs] Also compute trend analysis for the test'),
        flag: z
          .enum(['LOW', 'HIGH', 'normal', 'CRITICAL'])
          .optional()
          .describe('[labs] Filter by flag status (LOW, HIGH, normal, CRITICAL)'),
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
        // findings filters
        filterSource: z
          .string()
          .optional()
          .describe('[findings] Filter by source (e.g., "PubMed", "ClinicalTrials.gov")'),
        filterExternalIdType: externalIdTypeEnum
          .optional()
          .describe('[findings] Filter by external ID type (pmid, nct, orpha, omim, gene, etc.)'),
        filterEvidenceLevel: evidenceLevelEnum
          .optional()
          .describe('[findings] Filter by evidence level'),
        researchQueryId: z.string().optional().describe('[findings] Filter by research query ID'),
        // research-queries filters
        filterToolUsed: z.string().optional().describe('[research-queries] Filter by tool used'),
        filterAgent: z.string().optional().describe('[research-queries] Filter by agent name'),
        filterStage: z
          .number()
          .int()
          .min(0)
          .max(9)
          .optional()
          .describe('[research-queries] Filter by diagnostic flow stage'),
        // hypotheses filters
        filterName: z
          .string()
          .optional()
          .describe('[hypotheses] Filter by hypothesis name (LIKE search)'),
        filterCertaintyLevel: certaintyLevelEnum
          .optional()
          .describe('[hypotheses] Filter by certainty level'),
        latestOnly: z
          .boolean()
          .optional()
          .describe('[hypotheses] Only return latest (non-superseded) versions (default: true)'),
        withEvidence: z
          .boolean()
          .optional()
          .describe('[hypotheses] Include linked evidence for each hypothesis'),
        // hypothesis-timeline filters
        hypothesisName: z
          .string()
          .optional()
          .describe('[hypothesis-timeline] Exact hypothesis name to trace through version history'),
        // source-documents filters (Layer 0)
        category: sourceDocCategoryEnum
          .optional()
          .describe('[source-documents] Filter by document category'),
        qFacility: z.string().optional().describe('[source-documents] Filter by facility'),
        extractionMethod: extractionMethodEnum
          .optional()
          .describe('[source-documents] Filter by extraction method'),
        // imaging-findings filters (Layer 2E)
        anatomicalLocation: z
          .string()
          .optional()
          .describe('[imaging-findings|progressions] Filter by anatomical location'),
        findingType: findingTypeEnum
          .optional()
          .describe('[imaging-findings] Filter by finding type'),
        imagingReportId: z
          .string()
          .optional()
          .describe('[imaging-findings] Filter by parent imaging report'),
        // diagnoses filters (Layer 2F)
        icd10Code: z.string().optional().describe('[diagnoses] Filter by ICD-10 code'),
        qCurrentStatus: diagnosisStatusEnum
          .optional()
          .describe('[diagnoses] Filter by diagnosis status'),
        qBodyRegion: bodyRegionEnum.optional().describe('[diagnoses] Filter by body region'),
        // progressions filters (Layer 2G)
        findingChainId: z.string().optional().describe('[progressions] Filter by finding chain ID'),
        qFindingName: z.string().optional().describe('[progressions] Filter by finding name'),
        qFindingDomain: findingDomainEnum
          .optional()
          .describe('[progressions] Filter by domain (imaging, lab, clinical, functional)'),
        // report-versions filters (Layer 5)
        qReportName: z.string().optional().describe('[report-versions] Filter by report name'),
        qLanguage: reportLanguageEnum.optional().describe('[report-versions] Filter by language'),
        limit: z.number().int().positive().optional().describe('Max results (multiple types)'),
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
      const patientId = gs(input, 'patientId');

      mcpLog(
        server,
        'info',
        { tool: 'ingest_document', patientId, documentType: gs(input, 'documentType') },
        'knowledge',
      );
      notifyResourceUpdated(server, `patient://${patientId}/profile`);

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

  // ─── link_evidence — link findings/clinical records to hypotheses ───
  server.registerTool(
    'link_evidence',
    {
      description:
        'Link a research finding or clinical record to a diagnostic hypothesis. Tracks directional relationship (supporting, contradicting, neutral, inconclusive) with confidence scoring. Use action="link" to create links, action="query" to retrieve all evidence for a hypothesis.',
      inputSchema: {
        action: z.enum(['link', 'query']).describe('"link" to create, "query" to retrieve'),
        patientId: z.string().describe('Patient resource ID'),
        hypothesisId: z
          .string()
          .describe('Hypothesis ID to link evidence to or query evidence for'),
        findingId: z
          .string()
          .optional()
          .describe('(link) Research finding ID — provide this OR clinicalRecordId'),
        clinicalRecordId: z
          .string()
          .optional()
          .describe('(link) Clinical record ID — provide this OR findingId'),
        clinicalRecordType: z
          .enum([
            'lab-result',
            'consultation',
            'contradiction',
            'treatment-trial',
            'patient-report',
            'agent-learning',
          ])
          .optional()
          .describe('(link) Type of clinical record'),
        direction: z
          .enum(['supporting', 'contradicting', 'neutral', 'inconclusive'])
          .optional()
          .describe('(link) Relationship direction'),
        claim: z.string().optional().describe('(link) Evidence claim text'),
        confidence: z.number().min(0).max(1).optional().describe('(link) Confidence 0.0-1.0'),
        tier: z.enum(['T1', 'T2', 'T3']).optional().describe('(link) Evidence tier'),
        notes: z.string().optional().describe('(link) Additional notes'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      if (!evidenceLinkTool.execute) {
        return {
          content: [{ type: 'text' as const, text: 'Evidence link tool not available' }],
          isError: true,
        };
      }

      const result = await evidenceLinkTool.execute(input, { mastra });
      const patientId = gs(input, 'patientId');

      if (gs(input, 'action') === 'link') {
        mcpLog(
          server,
          'info',
          { tool: 'link_evidence', patientId, hypothesisId: gs(input, 'hypothesisId') },
          'clinical',
        );
        notifyResourceUpdated(server, `patient://${patientId}/profile`);
      }

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

  // ─── patient_research_summary — aggregate research statistics ───────
  server.registerTool(
    'patient_research_summary',
    {
      description:
        'Get aggregate research statistics for a patient: total findings, queries, hypotheses, evidence links, top sources, and latest dates.',
      inputSchema: {
        patientId: z.string().describe('Patient resource ID'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => {
      const store = getClinicalStore();
      const patientId = gs(input, 'patientId');
      const summary = await store.getPatientResearchSummary(patientId);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
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

function spreadProvenance(input: Record<string, unknown>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (g(input, 'evidenceTier')) p['evidenceTier'] = gs(input, 'evidenceTier');
  if (g(input, 'validationStatus')) p['validationStatus'] = gs(input, 'validationStatus');
  if (g(input, 'sourceCredibility') !== undefined)
    p['sourceCredibility'] = g(input, 'sourceCredibility');
  return p;
}

// ─── Per-type field definitions ─────────────────────────────────────
// Each entry: source field → target field (or just field name if same).
// Rename entries use { from, to } syntax.

type FieldSpec = string | { from: string; to: string };

const captureFieldsByType: Record<string, FieldSpec[]> = {
  'patient-report': ['reportType', 'content', 'severity', 'extractedInsights'],
  'agent-learning': ['category', 'content', 'confidence', 'relatedHypotheses'],
  contradiction: [
    'finding1',
    'finding2',
    'finding1Date',
    'finding1Method',
    'finding2Date',
    'finding2Method',
    'resolutionPlan',
    'diagnosticImpact',
  ],
  'lab-result': ['testName', 'value', 'unit', 'date', 'referenceRange', 'flag', 'source', 'notes'],
  'treatment-trial': [
    'medication',
    'efficacy',
    'drugClass',
    'indication',
    'startDate',
    'endDate',
    'dosage',
    'sideEffects',
    'reasonDiscontinued',
    'adequateTrial',
  ],
  consultation: [
    'provider',
    'specialty',
    'date',
    'conclusionsStatus',
    'institution',
    'reason',
    'findings',
    'conclusions',
    'recommendations',
  ],
  'research-finding': [
    'source',
    'sourceTool',
    'externalId',
    'externalIdType',
    'title',
    'summary',
    'url',
    'relevance',
    'evidenceLevel',
    'researchQueryId',
    'rawData',
    'date',
  ],
  'research-query': [
    'query',
    'toolUsed',
    'agent',
    'resultCount',
    'findingIds',
    'synthesis',
    { from: 'researchGaps', to: 'gaps' },
    'suggestedFollowUp',
    'stage',
    'durationMs',
  ],
  hypothesis: [
    'name',
    'icdCode',
    'probabilityLow',
    'probabilityHigh',
    'advocateCase',
    'skepticCase',
    'arbiterVerdict',
    { from: 'hypothesisEvidenceTier', to: 'evidenceTier' },
    'certaintyLevel',
    'stage',
    'version',
  ],
  'source-document': [
    'originalFilename',
    'originalFileHash',
    'originalFileSizeBytes',
    'originalPageCount',
    'mimeType',
    'extractionMethod',
    'extractionConfidence',
    'extractionDate',
    'extractionTool',
    'extractionWave',
    'extractedMarkdownPath',
    'preProcessing',
    'postProcessing',
    'pipelineVersion',
    { from: 'docCategory', to: 'category' },
    'subcategory',
    'date',
    'facility',
    'physician',
    { from: 'docLanguage', to: 'language' },
    'tags',
  ],
  diagnosis: [
    'conditionName',
    'conditionNamePl',
    'icdCode',
    'onsetDate',
    'firstDocumentedDate',
    'currentStatus',
    'bodyRegion',
    'diagnosisConfidence',
    'supportingEvidenceIds',
    'notes',
  ],
  progression: [
    'findingChainId',
    'findingName',
    'findingDomain',
    'anatomicalLocation',
    'progressionDate',
    'progressionValue',
    'numericValue',
    'progressionUnit',
    'direction',
    'comparisonNote',
    'sourceRecordId',
    'sourceRecordType',
  ],
  'report-version': [
    'reportName',
    'reportLanguage',
    'reportVersion',
    'filePath',
    'contentHash',
    'lineCount',
    'subsectionCount',
    'changesSummary',
    'changeSource',
  ],
};

const queryFieldsByType: Record<string, FieldSpec[]> = {
  labs: ['testName', 'dateFrom', 'dateTo', 'computeTrend', 'flag'],
  treatments: ['drugClass', { from: 'filterEfficacy', to: 'efficacy' }],
  consultations: [
    { from: 'filterSpecialty', to: 'specialty' },
    { from: 'filterProvider', to: 'provider' },
  ],
  contradictions: ['status'],
  'patient-history': ['recentDays'],
  findings: [
    { from: 'filterSource', to: 'source' },
    { from: 'filterExternalIdType', to: 'externalIdType' },
    { from: 'filterEvidenceLevel', to: 'evidenceLevel' },
    'dateFrom',
    'dateTo',
    'researchQueryId',
  ],
  'research-queries': [
    { from: 'filterToolUsed', to: 'toolUsed' },
    { from: 'filterAgent', to: 'agent' },
    { from: 'filterStage', to: 'stage' },
    'dateFrom',
    'dateTo',
  ],
  hypotheses: [
    { from: 'filterName', to: 'name' },
    { from: 'filterCertaintyLevel', to: 'certaintyLevel' },
    'latestOnly',
    'withEvidence',
  ],
  'hypothesis-timeline': [{ from: 'hypothesisName', to: 'name' }],
  'research-summary': [],
  'source-documents': [
    'category',
    'dateFrom',
    'dateTo',
    { from: 'qFacility', to: 'facility' },
    'extractionMethod',
    'limit',
  ],
  'imaging-findings': ['anatomicalLocation', 'findingType', 'imagingReportId', 'limit'],
  diagnoses: [
    'icd10Code',
    { from: 'qCurrentStatus', to: 'currentStatus' },
    { from: 'qBodyRegion', to: 'bodyRegion' },
    'limit',
  ],
  progressions: [
    'findingChainId',
    { from: 'qFindingName', to: 'findingName' },
    { from: 'qFindingDomain', to: 'findingDomain' },
    'anatomicalLocation',
    'dateFrom',
    'dateTo',
    'limit',
  ],
  'report-versions': [
    { from: 'qReportName', to: 'reportName' },
    { from: 'qLanguage', to: 'language' },
  ],
};

/** Pick declared fields from flat MCP input into a typed object. */
function pickFields(input: Record<string, unknown>, fields: FieldSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of fields) {
    const from = typeof spec === 'string' ? spec : spec.from;
    const to = typeof spec === 'string' ? spec : spec.to;
    const v = g(input, from);
    if (v !== undefined && v !== null) {
      out[to] = v;
    }
  }
  return out;
}

function buildCaptureInput(input: Record<string, unknown>): CaptureInput {
  const type = gs(input, 'type');
  const patientId = gs(input, 'patientId');
  const fields = captureFieldsByType[type];

  if (!fields) {
    return {
      type: 'patient-report',
      patientId,
      reportType: 'concern',
      content: `Unknown: ${type}`,
    };
  }

  return {
    type,
    patientId,
    ...pickFields(input, fields),
    ...spreadProvenance(input),
  } as CaptureInput;
}

function buildQueryInput(input: Record<string, unknown>): QueryInput {
  const type = gs(input, 'type');
  const patientId = gs(input, 'patientId');
  const fields = queryFieldsByType[type];

  if (!fields) {
    return { type: 'patient-history', patientId };
  }

  return { type, patientId, ...pickFields(input, fields) } as QueryInput;
}
