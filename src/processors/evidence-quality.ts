import type { MastraDBMessage } from '@mastra/core/agent';
import type {
  ProcessOutputResultArgs,
  Processor,
  ProcessorMessageResult,
} from '@mastra/core/processors';

const LOW_CONFIDENCE_THRESHOLD = 30;

/**
 * Extracts text content from a MastraDBMessage for analysis.
 * MastraDBMessage.content is MastraMessageContentV2 = { format: 2, parts: [...] }
 */
function extractText(message: MastraDBMessage): string {
  const { content } = message;

  // MastraMessageContentV2 has a parts array and optional content string
  if (typeof content.content === 'string') {
    return content.content;
  }

  if (Array.isArray(content.parts)) {
    return content.parts
      .filter((part): part is { type: 'text'; text: string } => {
        if (typeof part !== 'object' || part === null) return false;
        return 'type' in part && part.type === 'text' && 'text' in part;
      })
      .map((part) => part.text)
      .join('\n');
  }

  return '';
}

/**
 * Checks whether the text contains evidence citation patterns
 * (PMID, ORPHAcode, OMIM, DOI, or explicit source references).
 */
function hasEvidenceCitations(text: string): boolean {
  const citationPatterns = [
    /PMID[:\s]*\d+/i,
    /ORPHA[:\s]*\d+/i,
    /OMIM[:\s#]*\d+/i,
    /DOI[:\s]*10\.\d+/i,
    /PubMed/i,
    /Orphanet/i,
    /\[source/i,
    /\[ref/i,
    /citation/i,
  ];
  return citationPatterns.some((pattern) => pattern.test(text));
}

/**
 * Checks whether the text mentions confidence levels.
 */
function hasConfidenceIndicator(text: string): boolean {
  const confidencePatterns = [
    /confidence[:\s]*\d+/i,
    /\d+%\s*(confidence|certain|likely|probability)/i,
    /low confidence/i,
    /moderate confidence/i,
    /high confidence/i,
    /uncertain/i,
    /likelihood/i,
  ];
  return confidencePatterns.some((pattern) => pattern.test(text));
}

/**
 * Detects if the response contains diagnostic hypothesis content
 * that should include citations and confidence levels.
 */
function containsDiagnosticContent(text: string): boolean {
  const diagnosticPatterns = [
    /diagnos/i,
    /hypothesis/i,
    /differential/i,
    /condition.*suggest/i,
    /may have/i,
    /consistent with/i,
    /suspect/i,
    /indicat(e|es|ing|ive)/i,
  ];
  return diagnosticPatterns.some((pattern) => pattern.test(text));
}

/**
 * Extracts numeric confidence values from text.
 */
function extractConfidenceValues(text: string): number[] {
  const values: number[] = [];

  const percentMatches = text.matchAll(/(\d+)%\s*(confidence|certain|likely|probability)/gi);
  for (const match of percentMatches) {
    const value = Number.parseInt(match[1] ?? '0', 10);
    if (value >= 0 && value <= 100) {
      values.push(value);
    }
  }

  const labeledMatches = text.matchAll(/confidence[:\s]*(\d+)/gi);
  for (const match of labeledMatches) {
    const value = Number.parseInt(match[1] ?? '0', 10);
    if (value >= 0 && value <= 100) {
      values.push(value);
    }
  }

  return values;
}

const LOW_CONFIDENCE_WARNING =
  '\n\n---\n**⚠️ Low Confidence Alert:** Some hypotheses above have low confidence scores. ' +
  'Consider consulting a rare disease specialist or requesting additional diagnostic testing ' +
  'before proceeding with any clinical decisions.';

const CITATION_REMINDER =
  '\n\n---\n**📋 Note:** When possible, diagnostic hypotheses should be supported by evidence citations ' +
  '(PMID, ORPHAcode, OMIM numbers) to enable independent verification.';

/**
 * Evidence Quality Processor
 *
 * Monitors agent outputs for diagnostic content and enforces quality standards:
 * 1. Flags responses with low confidence scores (< 30%)
 * 2. Reminds when diagnostic content lacks evidence citations
 * 3. Appends warnings for specialist consultation when confidence is low
 */
export const evidenceQualityProcessor: Processor<'evidence-quality'> = {
  id: 'evidence-quality',
  name: 'Evidence Quality Monitor',
  description:
    'Monitors diagnostic outputs for evidence quality, confidence levels, and citation requirements',

  processOutputResult(args: ProcessOutputResultArgs): ProcessorMessageResult {
    const { messages } = args;

    // Find last assistant message (no findLastIndex in es2022)
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    if (lastAssistantIdx === -1) {
      return messages;
    }

    const lastAssistant = messages[lastAssistantIdx];
    if (!lastAssistant) {
      return messages;
    }

    const text = extractText(lastAssistant);
    if (!(text && containsDiagnosticContent(text))) {
      return messages;
    }

    const updatedMessages = [...messages];
    let appendText = '';

    const confidenceValues = extractConfidenceValues(text);
    const hasLowConfidence = confidenceValues.some((v) => v < LOW_CONFIDENCE_THRESHOLD);

    if (hasLowConfidence) {
      appendText += LOW_CONFIDENCE_WARNING;
    }

    if (!(hasEvidenceCitations(text) || hasConfidenceIndicator(text))) {
      appendText += CITATION_REMINDER;
    }

    if (appendText) {
      const updatedContent = { ...lastAssistant.content };
      // Append to the text content field if available
      if (typeof updatedContent.content === 'string') {
        updatedContent.content = updatedContent.content + appendText;
      }
      // Also append as a text part
      updatedContent.parts = [...updatedContent.parts, { type: 'text' as const, text: appendText }];
      updatedMessages[lastAssistantIdx] = { ...lastAssistant, content: updatedContent };
    }

    return updatedMessages;
  },
};
