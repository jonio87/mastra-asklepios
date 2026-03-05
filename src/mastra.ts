import { Mastra } from '@mastra/core';

import { asklepiosAgent } from './agents/asklepios.js';
import { phenotypeAgent } from './agents/phenotype-agent.js';
import { researchAgent } from './agents/research-agent.js';
import { synthesisAgent } from './agents/synthesis-agent.js';
import { storage } from './memory.js';
import {
  evidenceQualityProcessor,
  medicalDisclaimerProcessor,
  piiRedactorProcessor,
} from './processors/index.js';
import { diagnosticResearchWorkflow } from './workflows/diagnostic-research.js';
import { patientIntakeWorkflow } from './workflows/patient-intake.js';

/**
 * Mastra Instance: Central registry for all agents, workflows, storage, and memory.
 *
 * Access via:
 * - `mastra dev` → Studio UI at localhost:4111 (built-in chat, workflow management)
 * - `mastra.getAgent('asklepios')` → programmatic access
 * - `mastra.getWorkflow('patient-intake')` → workflow execution
 */
export const mastra = new Mastra({
  agents: {
    asklepios: asklepiosAgent,
    researchAgent,
    phenotypeAgent,
    synthesisAgent,
  },
  workflows: {
    'patient-intake': patientIntakeWorkflow,
    'diagnostic-research': diagnosticResearchWorkflow,
  },
  processors: {
    piiRedactor: piiRedactorProcessor,
    medicalDisclaimer: medicalDisclaimerProcessor,
    evidenceQuality: evidenceQualityProcessor,
  },
  storage,
});
