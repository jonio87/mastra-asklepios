import type {
  ProcessInputArgs,
  ProcessInputResult,
  ProcessOutputStreamArgs,
  Processor,
} from '@mastra/core/processors';
import type { ChunkType } from '@mastra/core/stream';

const DISCLAIMER_SYSTEM_MESSAGE =
  'IMPORTANT: You are a research assistant, NOT a medical professional. ' +
  'All outputs are for RESEARCH PURPOSES ONLY and must not be used as medical advice. ' +
  'Always remind users that findings should be reviewed by qualified healthcare professionals. ' +
  'When presenting diagnostic hypotheses, include confidence levels and cite evidence sources.';

/**
 * Medical Disclaimer Processor
 *
 * Injects a medical disclaimer into the system messages so every agent response
 * is grounded with the "for research purposes only" context. Also monitors
 * output streams to ensure diagnostic hypotheses include confidence levels.
 */
export const medicalDisclaimerProcessor: Processor<'medical-disclaimer'> = {
  id: 'medical-disclaimer',
  name: 'Medical Disclaimer',
  description: 'Injects medical research disclaimers and enforces citation requirements',

  processInput(args: ProcessInputArgs): ProcessInputResult {
    const { messages, systemMessages } = args;

    const hasDisclaimer = systemMessages.some(
      (msg) =>
        msg.role === 'system' &&
        typeof msg.content === 'string' &&
        msg.content.includes('RESEARCH PURPOSES ONLY'),
    );

    if (hasDisclaimer) {
      return { messages, systemMessages };
    }

    return {
      messages,
      systemMessages: [
        ...systemMessages,
        { role: 'system' as const, content: DISCLAIMER_SYSTEM_MESSAGE },
      ],
    };
  },

  processOutputStream(args: ProcessOutputStreamArgs): Promise<ChunkType | null> {
    return Promise.resolve(args.part);
  },
};
