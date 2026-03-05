import { Mastra } from '@mastra/core';
import { asklepiosAgent } from './agents/asklepios.js';
import { brainAgent } from './agents/brain-agent.js';
import { phenotypeAgent } from './agents/phenotype-agent.js';
import { researchAgent } from './agents/research-agent.js';
import { synthesisAgent } from './agents/synthesis-agent.js';
import { storage } from './memory.js';
import {
  evidenceQualityProcessor,
  medicalDisclaimerProcessor,
  piiRedactorProcessor,
} from './processors/index.js';
import { StderrLogger } from './utils/stderr-logger.js';
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
const logLevel = (process.env['LOG_LEVEL'] ?? 'info') as 'debug' | 'info' | 'warn' | 'error';

export const mastra = new Mastra({
  logger: new StderrLogger({ name: 'asklepios', level: logLevel }),
  agents: {
    asklepios: asklepiosAgent,
    'asklepios-brain': brainAgent,
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
