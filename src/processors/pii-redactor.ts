import { PIIDetector } from '@mastra/core/processors';
import { anthropic } from '../utils/anthropic-provider.js';

/**
 * PII Redactor Processor
 *
 * Uses Mastra's built-in PIIDetector with medical-specific configuration.
 * Detects and redacts patient PII (names, SSNs, dates of birth, addresses)
 * to ensure HIPAA compliance before data reaches the LLM.
 *
 * Strategy: 'redact' — replaces PII with placeholders ([NAME], [SSN], etc.)
 * rather than blocking the entire message, so research can continue safely.
 */
export const piiRedactorProcessor = new PIIDetector({
  model: anthropic('claude-haiku-3-5-20241022'),
  detectionTypes: [
    'name',
    'ssn',
    'date-of-birth',
    'address',
    'phone',
    'email',
    'credit-card',
    'medical-record-number',
  ],
  threshold: 0.5,
  strategy: 'redact',
  redactionMethod: 'placeholder',
  includeDetections: true,
  preserveFormat: false,
  instructions:
    'You are a medical PII detector. Identify personally identifiable information in patient medical records, ' +
    'clinical notes, and health data. Pay special attention to: patient names, Social Security numbers, ' +
    'dates of birth, medical record numbers (MRN), insurance IDs, addresses, and phone numbers. ' +
    'Do NOT flag medical terminology, drug names, disease names, or HPO terms as PII. ' +
    'Do NOT flag anonymized patient identifiers like "patient-anon-001" as PII.',
});
