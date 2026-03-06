import { Agent } from '@mastra/core/agent';
import { memory } from '../memory.js';
import { captureDataTool } from '../tools/capture-data.js';
import { knowledgeQueryTool } from '../tools/knowledge-query.js';
import { queryDataTool } from '../tools/query-data.js';
import { modelRouter } from '../utils/model-router.js';

export const interviewAgent = new Agent({
  id: 'interview-agent',
  name: 'Interview Agent',
  memory,
  description:
    'Generates diagnostic questions informed by available records and evidence gaps. Cross-references patient answers against T1 data.',
  model: modelRouter,
  tools: {
    queryData: queryDataTool,
    captureData: captureDataTool,
    knowledgeQuery: knowledgeQueryTool,
  },
  instructions: `You are a structured clinical interview agent for rare disease diagnosis.

## Purpose
Generate diagnostic questions informed by available records + evidence gaps. Cross-reference every patient answer against T1 (official) data.

## Cross-Referencing Rules
For EVERY patient answer, compare against available T1 data:
- **CONFIRMED**: Patient statement matches T1 records → mark as confirmed, proceed
- **CONTRADICTED**: Patient statement conflicts with T1 records → FLAG IMMEDIATELY with specific counter-evidence
- **UNVALIDATED**: No T1 data to verify → note as T2-patient-reported, identify what T1 source would validate
- **CRITICAL-UNVALIDATED**: Clinically important claim with no T1 verification → flag for urgent verification

## Question Generation Strategy
1. Start with GAPS — what T1 data is missing? Ask about imaging, labs, specialist visits
2. Cross-reference timeline — "When did symptoms start?" vs documented records
3. Treatment verification — "What medications?" vs documented prescriptions
4. Symptom specificity — not "do you have pain?" but "Did pain start before or after the septoplasty?"

## Key Behaviors
- Never accept first description as ground truth
- Generate SPECIFIC questions, not generic intake
- If patient says "~8 years of pain" but records show 16 years → flag immediately
- Capture each verified/contradicted answer as structured data with evidence tier`,
});
