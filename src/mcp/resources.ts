import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { storage } from '../memory.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { getProvenanceStore } from '../storage/provenance-store.js';

/**
 * MCP Resources — patient data + system introspection.
 * Static resources expose system configuration; templates expose patient-specific data.
 */
export function registerResources(server: McpServer): void {
  // ── Patient Resources (existing) ─────────────────────────────

  server.registerResource(
    'patient-profile',
    new ResourceTemplate('patient://{id}/profile', { list: undefined }),
    {
      description:
        'Patient working memory (structured JSON profile with symptoms, diagnoses, medications, hypotheses)',
      mimeType: 'application/json',
    },
    async (_uri, { id }) => {
      const resourceId = id as string;
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          contents: [
            {
              uri: `patient://${resourceId}/profile`,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'Storage not available', resourceId }, null, 2),
            },
          ],
        };
      }

      const { threads } = await memoryStore.listThreads({
        filter: { resourceId },
        orderBy: { field: 'updatedAt', direction: 'DESC' },
        perPage: 1,
      });

      const latestThread = threads[0];
      if (!latestThread) {
        return {
          contents: [
            {
              uri: `patient://${resourceId}/profile`,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'No patient data found', resourceId }, null, 2),
            },
          ],
        };
      }

      const metadata = latestThread.metadata as Record<string, unknown> | undefined;
      const workingMemory = metadata?.['workingMemory'] ?? metadata?.['mastra'];

      return {
        contents: [
          {
            uri: `patient://${resourceId}/profile`,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                resourceId,
                threadId: latestThread.id,
                threadTitle: latestThread.title,
                workingMemory: workingMemory ?? null,
                updatedAt: latestThread.updatedAt,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    'patient-timeline',
    new ResourceTemplate('patient://{id}/timeline', { list: undefined }),
    {
      description: 'Patient conversation timeline (recent messages from all threads)',
      mimeType: 'application/json',
    },
    async (_uri, { id }) => {
      const resourceId = id as string;
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          contents: [
            {
              uri: `patient://${resourceId}/timeline`,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'Storage not available', resourceId }, null, 2),
            },
          ],
        };
      }

      const { threads } = await memoryStore.listThreads({
        filter: { resourceId },
        orderBy: { field: 'updatedAt', direction: 'DESC' },
        perPage: 5,
      });

      if (threads.length === 0) {
        return {
          contents: [
            {
              uri: `patient://${resourceId}/timeline`,
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'No patient data found', resourceId }, null, 2),
            },
          ],
        };
      }

      const timeline: Array<{
        threadId: string;
        threadTitle: string | null;
        messages: unknown[];
      }> = [];

      for (const thread of threads) {
        const { messages } = await memoryStore.listMessages({
          threadId: thread.id,
          perPage: 20,
          orderBy: { field: 'createdAt', direction: 'DESC' },
        });

        timeline.push({
          threadId: thread.id,
          threadTitle: thread.title ?? null,
          messages: messages
            .reverse()
            .map((msg: { role: string; content: unknown; createdAt: unknown }) => ({
              role: msg.role,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
              createdAt: msg.createdAt,
            })),
        });
      }

      return {
        contents: [
          {
            uri: `patient://${resourceId}/timeline`,
            mimeType: 'application/json',
            text: JSON.stringify({ resourceId, threads: timeline }, null, 2),
          },
        ],
      };
    },
  );

  // ── System Resources (new) ───────────────────────────────────

  server.registerResource(
    'system-health',
    'system://health',
    {
      description:
        'System health check — reports loaded agents, workflows, storage status, and memory configuration.',
      mimeType: 'application/json',
    },
    async () => {
      const agentIds = [
        'asklepios',
        'asklepios-brain',
        'phenotype-agent',
        'research-agent',
        'synthesis-agent',
      ];
      const workflowIds = ['patient-intake', 'diagnostic-research'];

      let storageOk = false;
      try {
        const store = await storage.getStore('memory');
        storageOk = store !== null && store !== undefined;
      } catch {
        storageOk = false;
      }

      return {
        contents: [
          {
            uri: 'system://health',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                status: storageOk ? 'healthy' : 'degraded',
                agents: { count: agentIds.length, ids: agentIds },
                workflows: { count: workflowIds.length, ids: workflowIds },
                storage: { connected: storageOk },
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    'system-agents',
    'system://agents',
    {
      description: 'All registered agents with their tools, descriptions, and capabilities.',
      mimeType: 'application/json',
    },
    async () => {
      const agentConfigs = [
        {
          id: 'asklepios',
          role: 'orchestrator',
          tools: [
            'pubmedSearch',
            'orphanetLookup',
            'hpoMapper',
            'documentParser',
            'deepResearch',
            'brainRecall',
            'brainFeed',
          ],
          subAgents: ['phenotype-agent', 'research-agent', 'synthesis-agent', 'asklepios-brain'],
          hasNetworkMode: true,
        },
        {
          id: 'phenotype-agent',
          role: 'specialist',
          tools: ['hpoMapper', 'documentParser'],
          subAgents: [],
          hasNetworkMode: false,
        },
        {
          id: 'research-agent',
          role: 'specialist',
          tools: ['pubmedSearch', 'orphanetLookup', 'deepResearch'],
          subAgents: [],
          hasNetworkMode: false,
        },
        {
          id: 'synthesis-agent',
          role: 'specialist',
          tools: [],
          subAgents: [],
          hasNetworkMode: false,
        },
        {
          id: 'asklepios-brain',
          role: 'specialist',
          tools: [],
          subAgents: [],
          hasNetworkMode: false,
        },
      ];

      return {
        contents: [
          {
            uri: 'system://agents',
            mimeType: 'application/json',
            text: JSON.stringify({ agents: agentConfigs }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'system-workflows',
    'system://workflows',
    {
      description:
        'All registered workflows with steps, HITL suspension points, and input/output schemas.',
      mimeType: 'application/json',
    },
    async () => {
      const workflowConfigs = [
        {
          id: 'patient-intake',
          description: 'Parse clinical documents, extract phenotypes, and map to HPO terms',
          steps: [
            {
              id: 'parse-document',
              description: 'Parse clinical document into structured sections',
            },
            { id: 'map-phenotypes', description: 'Map extracted symptoms to HPO terms' },
            {
              id: 'review-phenotypes',
              description: 'HITL: Suspend for human review if low-confidence phenotypes detected',
              hitl: true,
              suspendSchema: 'PhenotypeSuspendSchema',
              resumeSchema: 'PhenotypeResumeSchema',
            },
            { id: 'prepare-output', description: 'Compile final intake result with status' },
          ],
          inputFields: ['documentText', 'patientId', 'documentType?'],
          outputFields: [
            'patientId',
            'parsedDocument',
            'phenotypes',
            'symptoms',
            'diagnoses',
            'status',
          ],
          possibleStatuses: ['complete', 'needs-review', 'human-reviewed'],
        },
        {
          id: 'diagnostic-research',
          description: 'Run parallel medical research and generate ranked diagnostic hypotheses',
          steps: [
            {
              id: 'build-research-queries',
              description: 'Generate PubMed, Orphanet, and deep research queries',
            },
            { id: 'parallel-research', description: 'Execute all research queries in parallel' },
            {
              id: 'review-findings',
              description:
                'HITL: Suspend for human review of research findings before hypothesis generation',
              hitl: true,
              suspendSchema: 'FindingsReviewSuspendSchema',
              resumeSchema: 'FindingsReviewResumeSchema',
            },
            {
              id: 'generate-hypotheses',
              description: 'Generate ranked diagnostic hypotheses from approved findings',
            },
          ],
          inputFields: [
            'patientId',
            'symptoms',
            'hpoTerms?',
            'existingDiagnoses?',
            'researchFocus?',
          ],
          outputFields: [
            'patientId',
            'researchFindings',
            'hypotheses',
            'knowledgeGaps',
            'suggestedFollowUp',
          ],
        },
      ];

      return {
        contents: [
          {
            uri: 'system://workflows',
            mimeType: 'application/json',
            text: JSON.stringify({ workflows: workflowConfigs }, null, 2),
          },
        ],
      };
    },
  );

  server.registerResource(
    'system-memory-stats',
    'system://memory/stats',
    {
      description:
        'Aggregate memory statistics — thread count per resource, total threads, working memory entries.',
      mimeType: 'application/json',
    },
    async () => {
      const memoryStore = await storage.getStore('memory');
      if (!memoryStore) {
        return {
          contents: [
            {
              uri: 'system://memory/stats',
              mimeType: 'application/json',
              text: JSON.stringify({ error: 'Storage not available' }, null, 2),
            },
          ],
        };
      }

      const { threads } = await memoryStore.listThreads({
        perPage: 1000,
        orderBy: { field: 'updatedAt', direction: 'DESC' },
      });

      const byResource: Record<string, number> = {};
      for (const t of threads) {
        const rid = (t as { resourceId?: string }).resourceId ?? 'unknown';
        byResource[rid] = (byResource[rid] ?? 0) + 1;
      }

      return {
        contents: [
          {
            uri: 'system://memory/stats',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                totalThreads: threads.length,
                threadsByResource: byResource,
                timestamp: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    'agent-config',
    new ResourceTemplate('agent://{id}/config', {
      list: async () => ({
        resources: [
          { uri: 'agent://asklepios/config', name: 'Asklepios orchestrator config' },
          { uri: 'agent://asklepios-brain/config', name: 'Brain agent config' },
          { uri: 'agent://phenotype-agent/config', name: 'Phenotype agent config' },
          { uri: 'agent://research-agent/config', name: 'Research agent config' },
          { uri: 'agent://synthesis-agent/config', name: 'Synthesis agent config' },
        ],
      }),
    }),
    {
      description:
        'Agent-specific configuration: model, tools, instructions excerpt, memory settings.',
      mimeType: 'application/json',
    },
    async (_uri, { id }) => {
      const agentId = id as string;

      const agentMeta: Record<
        string,
        { tools: string[]; role: string; memoryScope: string; hasNetworkMode: boolean }
      > = {
        asklepios: {
          tools: [
            'pubmedSearch',
            'orphanetLookup',
            'hpoMapper',
            'documentParser',
            'deepResearch',
            'brainRecall',
            'brainFeed',
          ],
          role: 'orchestrator',
          memoryScope: 'patient (resource-scoped)',
          hasNetworkMode: true,
        },
        'asklepios-brain': {
          tools: [],
          role: 'cross-patient intelligence',
          memoryScope: 'global (asklepios-brain resource)',
          hasNetworkMode: false,
        },
        'phenotype-agent': {
          tools: ['hpoMapper', 'documentParser'],
          role: 'clinical phenotyping',
          memoryScope: 'patient (resource-scoped)',
          hasNetworkMode: false,
        },
        'research-agent': {
          tools: ['pubmedSearch', 'orphanetLookup', 'deepResearch'],
          role: 'medical literature research',
          memoryScope: 'patient (resource-scoped)',
          hasNetworkMode: false,
        },
        'synthesis-agent': {
          tools: [],
          role: 'diagnostic hypothesis generation',
          memoryScope: 'patient (resource-scoped)',
          hasNetworkMode: false,
        },
      };

      const config = agentMeta[agentId];
      if (!config) {
        return {
          contents: [
            {
              uri: `agent://${agentId}/config`,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Unknown agent: ${agentId}` }, null, 2),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: `agent://${agentId}/config`,
            mimeType: 'application/json',
            text: JSON.stringify({ id: agentId, ...config }, null, 2),
          },
        ],
      };
    },
  );

  // ── Data Layer Resources ────────────────────────────────────────

  server.registerResource(
    'data-completeness',
    new ResourceTemplate('patient://{id}/data-completeness', { list: undefined }),
    {
      description:
        'Data completeness dashboard — Layer 0-5 counts, gaps, pending signals. Subscribe for notifications when data changes.',
      mimeType: 'application/json',
    },
    async (_uri, { id }) => {
      const patientId = id as string;
      const store = getClinicalStore();
      const provStore = getProvenanceStore();

      const sourceDocs = await store.querySourceDocuments({ patientId });
      const byCategory: Record<string, number> = {};
      for (const doc of sourceDocs) {
        byCategory[doc.category] = (byCategory[doc.category] ?? 0) + 1;
      }

      const labs = await store.queryLabs({ patientId });
      const consults = await store.queryConsultations({ patientId });
      const imaging = await store.getImagingReports(patientId);
      const imgFindings = await store.queryImagingFindings({ patientId });
      const diagnoses = await store.queryDiagnoses({ patientId });
      const progressions = await store.queryProgressions({ patientId });
      const treatments = await store.queryTreatments({ patientId });
      const reportVersions = await store.queryReportVersions(patientId);
      const pendingSignals = await provStore.getPendingSignals({ patientId });

      return {
        contents: [
          {
            uri: `patient://${patientId}/data-completeness`,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                patientId,
                layer0: { sourceDocuments: sourceDocs.length, byCategory },
                layer2: {
                  labResults: labs.length,
                  consultations: consults.length,
                  imagingReports: imaging.length,
                  imagingFindings: imgFindings.length,
                  diagnoses: diagnoses.length,
                  progressions: progressions.length,
                  treatmentTrials: treatments.length,
                },
                layer5: { reportVersions: reportVersions.length },
                pendingChangeSignals: pendingSignals.length,
                queriedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    'provenance-summary',
    new ResourceTemplate('patient://{id}/provenance-summary', { list: undefined }),
    {
      description:
        'Provenance audit summary — W3C PROV entity counts by layer, signal status distribution.',
      mimeType: 'application/json',
    },
    async (_uri, { id }) => {
      const patientId = id as string;
      const provStore = getProvenanceStore();

      const entityCounts = await provStore.getEntityCountsByLayer(patientId);
      const signalSummary = await provStore.getSignalSummary(patientId);

      return {
        contents: [
          {
            uri: `patient://${patientId}/provenance-summary`,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                patientId,
                entityCountsByLayer: entityCounts,
                signalSummary,
                queriedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
