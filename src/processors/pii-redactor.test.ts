import { piiRedactorProcessor } from './pii-redactor.js';

describe('piiRedactorProcessor', () => {
  it('has correct processor configuration', () => {
    expect(piiRedactorProcessor.id).toBe('pii-detector');
    expect(piiRedactorProcessor.name).toBe('PII Detector');
  });

  it('is an instance of PIIDetector', () => {
    expect(piiRedactorProcessor).toBeDefined();
    expect(typeof piiRedactorProcessor.processInput).toBe('function');
    expect(typeof piiRedactorProcessor.processOutputResult).toBe('function');
    expect(typeof piiRedactorProcessor.processOutputStream).toBe('function');
  });
});
