import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * MCP Prompts — pre-built instruction sets for multi-step interactions.
 * Guides AI clients through diagnostic workflows and testing scenarios.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'diagnose_patient',
    {
      description:
        'Full diagnostic workflow: phenotype extraction → brain recall → literature search → hypothesis synthesis. Guides the client through each step using the available tools.',
      argsSchema: {
        patientId: z.string().describe('Patient ID to diagnose'),
        symptoms: z.string().describe('Comma-separated list of patient symptoms'),
      },
    },
    ({ patientId, symptoms }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Diagnose patient ${patientId} presenting with: ${symptoms}`,
              '',
              'Follow this diagnostic workflow using the available MCP tools:',
              '',
              '1. **Phenotype extraction**: Call `invoke_phenotype_agent` with the symptoms to extract and map to HPO terms.',
              '2. **Brain recall**: Call `recall_brain` with the symptoms to check for cross-patient diagnostic patterns.',
              '3. **Literature search**: Call `search_pubmed` and `lookup_orphanet` with the key phenotypes.',
              '4. **Deep research**: Call `deep_research` for any rare findings that need deeper investigation.',
              '5. **Synthesis**: Call `invoke_synthesis_agent` with all gathered evidence to generate ranked diagnostic hypotheses.',
              '6. **Verify**: Call `get_working_memory` with the patient resource to confirm the profile was updated.',
              '',
              'Report your findings as a structured differential diagnosis with confidence levels.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'review_case',
    {
      description:
        'Load a patient profile and conversation timeline, then generate a differential diagnosis summary.',
      argsSchema: {
        patientId: z.string().describe('Patient ID to review'),
      },
    },
    ({ patientId }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Review the clinical case for patient ${patientId}.`,
              '',
              'Steps:',
              `1. Read the patient profile from resource \`patient://${patientId}/profile\``,
              `2. Read the conversation timeline from resource \`patient://${patientId}/timeline\``,
              '3. Call `get_working_memory` with the patient resource ID to get the current PatientProfile',
              '4. Summarize:',
              '   - Current symptoms and HPO mappings',
              '   - Active diagnostic hypotheses with confidence levels',
              '   - Evidence gaps and recommended next steps',
              '   - Any cross-patient patterns from brain recall',
              '',
              'Present a concise case review suitable for clinical discussion.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'compare_patients',
    {
      description:
        'Cross-patient comparison using the brain agent. Identifies shared patterns, diagnostic overlaps, and phenotype-genotype correlations between two patients.',
      argsSchema: {
        patientId1: z.string().describe('First patient ID'),
        patientId2: z.string().describe('Second patient ID'),
      },
    },
    ({ patientId1, patientId2 }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Compare patients ${patientId1} and ${patientId2} for diagnostic patterns.`,
              '',
              'Steps:',
              `1. Call \`get_working_memory\` for resource "${patientId1}" to load first patient profile`,
              `2. Call \`get_working_memory\` for resource "${patientId2}" to load second patient profile`,
              '3. Call `invoke_brain_agent` with a summary of both patients to identify:',
              '   - Shared symptoms and phenotypes',
              '   - Overlapping diagnostic hypotheses',
              '   - Phenotype-genotype correlations',
              '   - Differences that suggest distinct conditions',
              '4. Call `recall_brain` with shared symptoms to find broader patterns',
              '',
              'Present a comparison report highlighting actionable diagnostic insights.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'test_scenario',
    {
      description:
        'Execute a natural language test scenario against the Asklepios system. Structures the scenario into a systematic test plan with tool calls and assertions.',
      argsSchema: {
        scenario: z
          .string()
          .describe(
            'Natural language test scenario (e.g., "Verify that submitting EDS symptoms returns correct HPO mappings")',
          ),
      },
    },
    ({ scenario }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Execute this test scenario against Asklepios: "${scenario}"`,
              '',
              'You have access to these MCP tools for testing:',
              '',
              '**Agent tools**: invoke_phenotype_agent, invoke_research_agent, invoke_synthesis_agent, invoke_brain_agent, ask_asklepios',
              '**Workflow tools**: run_patient_intake, run_diagnostic_research, resume_workflow',
              '**Raw tools**: search_pubmed, lookup_orphanet, map_symptoms, recall_brain, parse_document, deep_research',
              '**State inspection**: get_working_memory, list_threads, get_thread_messages',
              '**System resources**: system://health, system://agents, system://workflows, system://memory/stats',
              '',
              'Test plan:',
              '1. **Pre-conditions**: Check system://health to verify the system is ready',
              '2. **Setup**: Create any necessary test state (patient IDs, threads)',
              '3. **Execute**: Run the tools needed to test the scenario',
              '4. **Assert**: Verify the results match expected behavior using state inspection tools',
              '5. **Report**: Summarize what passed, what failed, and any unexpected behavior',
              '',
              'Execute each step and report results as PASS/FAIL with evidence.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
