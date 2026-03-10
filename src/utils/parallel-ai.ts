import { logger } from './logger.js';

export interface ParallelSource {
  url: string;
  title: string;
  excerpt: string;
}

export interface ParallelAiResult {
  taskId: string;
  status: string;
  report: string;
  output: string;
  sources: ParallelSource[];
  durationMs: number;
}

interface TaskRunResponse {
  id?: string;
  status?: string;
  output?: string;
  sources?: Array<{ url?: string; title?: string; excerpt?: string }>;
}

interface RunDeepResearchOptions {
  processor?: 'base' | 'core' | 'ultra' | 'ultra2x';
  role?: 'advocate' | 'skeptic' | 'unbiased';
}

const API_BASE = 'https://api.parallel.ai/v1/tasks/runs';
const POLL_INTERVAL_MS = 5_000;

const TIMEOUT_BY_PROCESSOR: Record<string, number> = {
  base: 5 * 60_000,
  core: 5 * 60_000,
  ultra: 10 * 60_000,
  ultra2x: 10 * 60_000,
};

export async function runDeepResearch(
  input: string,
  options?: RunDeepResearchOptions,
): Promise<ParallelAiResult | null> {
  const apiKey = process.env['PARALLEL_API_KEY'];
  if (!apiKey) {
    logger.warn('PARALLEL_API_KEY not set — Parallel.ai deep research unavailable');
    return null;
  }

  const processor = options?.processor ?? 'ultra';
  const role = options?.role;
  const timeoutMs = TIMEOUT_BY_PROCESSOR[processor] ?? 10 * 60_000;

  logger.info('Starting Parallel.ai deep research', {
    processor,
    inputLength: input.length,
    ...(role !== undefined ? { role } : {}),
  });

  const startTime = Date.now();

  // Create task run
  const createResponse = await fetch(API_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input, processor }),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text().catch(() => 'unknown error');
    logger.error('Parallel.ai task creation failed', {
      status: createResponse.status,
      error: errorText,
    });
    return null;
  }

  const createData = (await createResponse.json()) as TaskRunResponse;
  const taskId = createData.id;

  if (!taskId) {
    logger.error('Parallel.ai returned no task ID', { response: JSON.stringify(createData) });
    return null;
  }

  logger.info('Parallel.ai task created', { taskId, processor });

  // Poll for completion
  return pollForCompletion(taskId, apiKey, timeoutMs, startTime);
}

async function pollForCompletion(
  taskId: string,
  apiKey: string,
  timeoutMs: number,
  startTime: number,
): Promise<ParallelAiResult | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(`${API_BASE}/${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!pollResponse.ok) {
      logger.warn('Parallel.ai poll request failed', {
        taskId,
        status: pollResponse.status,
      });
      continue;
    }

    const pollData = (await pollResponse.json()) as TaskRunResponse;
    const status = pollData.status ?? 'unknown';

    if (status === 'completed') {
      return buildResult(taskId, status, pollData, startTime);
    }

    if (status === 'failed') {
      logger.error('Parallel.ai task failed', { taskId, output: pollData.output });
      return null;
    }

    logger.debug('Parallel.ai task still running', { taskId, status });
  }

  logger.error('Parallel.ai task timed out', { taskId, timeoutMs });
  return null;
}

function buildResult(
  taskId: string,
  status: string,
  pollData: TaskRunResponse,
  startTime: number,
): ParallelAiResult {
  const sources: ParallelSource[] = (pollData.sources ?? []).reduce<ParallelSource[]>((acc, s) => {
    if (s.url && s.title) {
      acc.push({ url: s.url, title: s.title, excerpt: s.excerpt ?? '' });
    }
    return acc;
  }, []);

  const durationMs = Date.now() - startTime;
  const output = pollData.output ?? '';

  logger.info('Parallel.ai research completed', {
    taskId,
    sourceCount: sources.length,
    durationMs,
  });

  return { taskId, status, report: output, output, sources, durationMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
