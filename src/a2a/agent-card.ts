/**
 * Asklepios A2A Agent Card — self-describing manifest for agent discovery.
 *
 * Served at /.well-known/agent-card.json per A2A spec.
 * Other agents discover Asklepios and learn what skills it offers.
 */

import type { AgentCard } from '@a2a-js/sdk';

const A2A_PORT = Number(process.env['A2A_PORT'] ?? 4113);

export function getAgentCard(baseUrl?: string): AgentCard {
  const url = baseUrl ?? `http://localhost:${A2A_PORT}`;

  return {
    name: 'Asklepios',
    description:
      'AI-powered rare disease research assistant with diagnostic reasoning, ' +
      'multi-agent orchestration, and cross-patient pattern matching. ' +
      'Specializes in complex, unsolved medical cases with contradictory findings.',
    protocolVersion: '0.3.0',
    version: '0.4.0',
    url: `${url}/a2a`,
    provider: {
      organization: 'Asklepios Project',
      url: 'https://github.com/jonio87/mastra-asklepios',
    },
    skills: [
      {
        id: 'diagnose',
        name: 'Diagnostic Reasoning',
        description:
          'Analyze symptoms, generate ranked differential diagnoses with evidence chains. ' +
          'Uses multi-agent orchestration (phenotype, research, synthesis, brain agents).',
        tags: ['diagnosis', 'rare-disease', 'differential', 'multi-agent'],
        examples: [
          'Patient presents with 16-year chronic right-sided facial pain, progressive upper limb weakness, and emerging autoimmune markers. Generate differential diagnoses.',
          'Analyze these symptoms against known rare disease databases: photophobia, phonophobia, cognitive dysfunction, chronic fatigue.',
        ],
      },
      {
        id: 'research',
        name: 'Medical Research',
        description:
          'Search PubMed, Orphanet, ClinVar, and OMIM for evidence-based findings. ' +
          'Returns structured results with PMIDs, clinical significance, and phenotype data.',
        tags: ['pubmed', 'orphanet', 'clinvar', 'omim', 'research', 'literature'],
        examples: [
          'Search PubMed for recent studies on trigeminocervical convergence and craniocervical junction anomalies.',
          'Look up ClinVar entries for genes associated with Ehlers-Danlos syndrome.',
        ],
      },
      {
        id: 'phenotype',
        name: 'Phenotype Analysis',
        description:
          'Extract symptoms from clinical documents, map to HPO (Human Phenotype Ontology) terms. ' +
          'Parse unstructured medical text into structured phenotype data.',
        tags: ['hpo', 'phenotype', 'symptoms', 'document-parsing', 'nlp'],
        examples: [
          'Parse this discharge summary and extract all symptoms with HPO mappings.',
          'Map these patient-reported symptoms to standardized HPO terms: "pain behind right eye, sensitivity to light, brain fog".',
        ],
      },
      {
        id: 'cross-patient',
        name: 'Cross-Patient Pattern Matching',
        description:
          'Query accumulated diagnostic wisdom across anonymized patient cases. ' +
          'Identifies similar presentations, treatment patterns, and diagnostic breakthroughs.',
        tags: ['brain', 'patterns', 'cross-patient', 'diagnostic-wisdom'],
        examples: [
          'Have you seen similar cases with craniocervical junction anomalies and autoimmune seroconversion?',
          'What treatment patterns have been effective for patients with central sensitization and structural cervical pathology?',
        ],
      },
      {
        id: 'clinical-data',
        name: 'Clinical Data Management',
        description:
          'Capture and query structured clinical records: labs (with trend analysis), ' +
          'treatment trials (with drug class exhaustion tracking), consultations, ' +
          'contradictions, and patient reports.',
        tags: ['labs', 'treatments', 'clinical-record', 'contradictions', 'trends'],
        examples: [
          'Record WBC lab result: 2.59 tys/µl on 2025-01-15, reference range 4.0-10.0, flagged low.',
          'Query all treatment trials for this patient, grouped by drug class with efficacy ratings.',
        ],
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}
