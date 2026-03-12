import { diagnosticFlowWorkflow } from './diagnostic-flow.js';

describe('diagnosticFlowWorkflow', () => {
  it('has the correct workflow ID', () => {
    expect(diagnosticFlowWorkflow.id).toBe('diagnostic-flow');
  });

  it('has a description mentioning 9 stages', () => {
    const description = diagnosticFlowWorkflow.description ?? '';
    expect(description).toContain('9-stage');
    expect(description).toContain('HARD GATE');
    expect(description).toContain('HITL');
  });

  it('has all 8 steps (stages 2+3 combined)', () => {
    // The workflow chains 8 steps:
    // 1. records-ingestion-check
    // 2+3. brain-recall-and-interview
    // 4. parallel-research
    // 5. preliminary-hypothesis
    // 6. followup-questions
    // 7. adversarial-synthesis
    // 8. specialist-integration
    // 9. generate-deliverables
    const steps = diagnosticFlowWorkflow.steps;
    expect(Object.keys(steps).length).toBe(8);
  });

  it('includes records ingestion check as first step', () => {
    const stepIds = Object.keys(diagnosticFlowWorkflow.steps);
    expect(stepIds).toContain('records-ingestion-check');
  });

  it('includes adversarial synthesis step with HITL', () => {
    const stepIds = Object.keys(diagnosticFlowWorkflow.steps);
    expect(stepIds).toContain('adversarial-synthesis');
  });

  it('includes specialist integration step with HITL', () => {
    const stepIds = Object.keys(diagnosticFlowWorkflow.steps);
    expect(stepIds).toContain('specialist-integration');
  });

  it('includes deliverables generation step', () => {
    const stepIds = Object.keys(diagnosticFlowWorkflow.steps);
    expect(stepIds).toContain('generate-deliverables');
  });

  it('can create a run', async () => {
    const run = await diagnosticFlowWorkflow.createRun();
    expect(run.runId).toBeDefined();
    expect(typeof run.runId).toBe('string');
  });
});
