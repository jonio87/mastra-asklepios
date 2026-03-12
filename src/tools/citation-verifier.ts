import type { Tool } from '@mastra/core/tools';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getBiomedicalTools } from '../clients/biomedical-mcp.js';
import { externalIdTypeEnum } from '../schemas/research-record.js';
import { getClinicalStore } from '../storage/clinical-store.js';
import { logger } from '../utils/logger.js';

function findMcpTool(tools: Record<string, Tool>, ...candidates: string[]): Tool | undefined {
  for (const candidate of candidates) {
    const exact = tools[candidate];
    if (exact) return exact;
  }
  const toolNames = Object.keys(tools);
  for (const candidate of candidates) {
    const suffix = toolNames.find((n) => n.endsWith(candidate));
    if (suffix) return tools[suffix];
  }
  return undefined;
}

async function executeMcpTool(tool: Tool, input: Record<string, unknown>): Promise<string> {
  if (!tool.execute) return '';
  try {
    const result = await tool.execute(input, {});
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (typeof r['content'] === 'string') return r['content'];
      if (Array.isArray(r['content'])) {
        return (r['content'] as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
      }
      return JSON.stringify(result);
    }
    return String(result);
  } catch {
    return '';
  }
}

const verificationStatus = z.enum([
  'verified',
  'partial',
  'unsupported',
  'contradicted',
  'unavailable',
]);

const findingInput = z.object({
  findingId: z.string().optional().describe('Layer 2B finding ID'),
  claim: z.string().describe('The claimed finding to verify'),
  pmid: z.string().optional().describe('PubMed ID to verify against'),
  externalId: z.string().optional().describe('Other external ID'),
  externalIdType: externalIdTypeEnum.optional(),
});

const verifiedFindingSchema = z.object({
  findingId: z.string().optional(),
  claim: z.string(),
  pmid: z.string().optional(),
  verificationStatus,
  abstractExcerpt: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

type FindingInput = z.infer<typeof findingInput>;
type VerifiedFinding = z.infer<typeof verifiedFindingSchema>;

function buildVerifiedFinding(
  finding: FindingInput,
  pmid: string | undefined,
  status: 'verified' | 'partial' | 'unsupported' | 'contradicted' | 'unavailable',
  confidence: number,
  reason: string,
  excerpt?: string,
): VerifiedFinding {
  return {
    ...(finding.findingId ? { findingId: finding.findingId } : {}),
    claim: finding.claim,
    ...(pmid ? { pmid } : {}),
    verificationStatus: status,
    ...(excerpt ? { abstractExcerpt: excerpt } : {}),
    confidence,
    reason,
  };
}

async function verifySingleFinding(
  finding: FindingInput,
  articleTool: Tool | undefined,
  store: ReturnType<typeof getClinicalStore>,
): Promise<{ result: VerifiedFinding }> {
  const pmid = finding.pmid ?? finding.externalId;

  if (!(pmid && articleTool)) {
    return {
      result: buildVerifiedFinding(
        finding,
        undefined,
        'unavailable',
        0,
        pmid ? 'Article search tool not available' : 'No PMID provided',
      ),
    };
  }

  try {
    const abstractText = await executeMcpTool(articleTool, { query: `PMID:${pmid}`, pmid });

    if (abstractText.length < 50) {
      return {
        result: buildVerifiedFinding(
          finding,
          pmid,
          'unavailable',
          0,
          'Abstract not found or too short',
        ),
      };
    }

    const verification = verifyClaimAgainstAbstract(finding.claim, abstractText);

    if (finding.findingId) {
      await persistVerificationStatus(store, finding.findingId, verification);
    }

    return {
      result: buildVerifiedFinding(
        finding,
        pmid,
        verification.status,
        verification.confidence,
        verification.reason,
        verification.excerpt,
      ),
    };
  } catch (err) {
    return {
      result: buildVerifiedFinding(
        finding,
        pmid,
        'unavailable',
        0,
        `Error fetching abstract: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
}

async function persistVerificationStatus(
  store: ReturnType<typeof getClinicalStore>,
  findingId: string,
  verification: VerificationResult,
): Promise<void> {
  try {
    await store.updateFindingValidation(findingId, verification.status, verification.confidence);
  } catch {
    logger.debug('Failed to update finding validation', { findingId });
  }
}

export const citationVerifierTool = createTool({
  id: 'citation-verifier',
  description:
    'Verify whether cited papers (by PMID) actually support the claimed findings. Fetches PubMed abstracts and runs keyword overlap + negation detection to classify each citation as verified, partial, unsupported, contradicted, or unavailable. Updates finding validation status in Layer 2B.',
  inputSchema: z.object({
    patientId: z.string().describe('Patient resource ID'),
    findings: z.array(findingInput).describe('Findings with claims and PMIDs to verify'),
  }),
  outputSchema: z.object({
    verifiedFindings: z.array(verifiedFindingSchema),
    summary: z.object({
      verified: z.number(),
      partial: z.number(),
      unsupported: z.number(),
      contradicted: z.number(),
      unavailable: z.number(),
    }),
  }),
  execute: async (input) => {
    const { patientId, findings } = input;
    logger.info('Verifying citations', { patientId, findingCount: findings.length });

    const tools = await getBiomedicalTools();
    const store = getClinicalStore();
    const articleTool = findMcpTool(tools, 'biomcp_article_searcher', 'article_searcher');

    const verifiedFindings: z.infer<typeof verifiedFindingSchema>[] = [];
    const summary = { verified: 0, partial: 0, unsupported: 0, contradicted: 0, unavailable: 0 };

    for (const finding of findings) {
      const verified = await verifySingleFinding(finding, articleTool, store);
      verifiedFindings.push(verified.result);
      summary[verified.result.verificationStatus]++;
    }

    return { verifiedFindings, summary };
  },
});

// ─── Verification helpers ────────────────────────────────────────────────

interface VerificationResult {
  status: 'verified' | 'partial' | 'unsupported' | 'contradicted';
  confidence: number;
  reason: string;
  excerpt?: string;
}

const NEGATION_PATTERNS = [
  /\bnot\b/i,
  /\bno\b/i,
  /\bnor\b/i,
  /\bnever\b/i,
  /\bneither\b/i,
  /\bfailed to\b/i,
  /\bdid not\b/i,
  /\bwithout\b/i,
  /\babsence of\b/i,
  /\binsufficient\b/i,
  /\bunlikely\b/i,
  /\brule[sd]? out\b/i,
  /\bcontradicts?\b/i,
  /\brefutes?\b/i,
  /\bdisproves?\b/i,
];

function verifyClaimAgainstAbstract(claim: string, abstractText: string): VerificationResult {
  // Extract key terms from the claim (words > 3 chars, not stopwords)
  const stopwords = new Set([
    'with',
    'from',
    'that',
    'this',
    'have',
    'been',
    'were',
    'they',
    'their',
    'also',
    'than',
    'more',
    'most',
    'some',
    'such',
    'only',
    'into',
    'over',
    'both',
    'each',
    'after',
    'before',
    'between',
    'under',
    'about',
    'which',
    'when',
    'where',
    'while',
  ]);
  const claimTerms = claim
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));

  if (claimTerms.length === 0) {
    return {
      status: 'unsupported',
      confidence: 0,
      reason: 'Claim has no substantive terms to verify',
    };
  }

  const abstractLower = abstractText.toLowerCase();
  const sentences = abstractText.split(/[.!?]+/).filter((s) => s.trim().length > 10);

  // Find sentences with highest keyword overlap
  let bestSentence = '';
  let bestOverlap = 0;
  let bestNegated = false;

  for (const sentence of sentences) {
    const sentenceLower = sentence.toLowerCase();
    const matchCount = claimTerms.filter((t) => sentenceLower.includes(t)).length;
    const overlap = matchCount / claimTerms.length;

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSentence = sentence.trim();
      bestNegated = NEGATION_PATTERNS.some((p) => p.test(sentenceLower));
    }
  }

  // Overall term coverage in the full abstract
  const totalMatched = claimTerms.filter((t) => abstractLower.includes(t)).length;
  const overallCoverage = totalMatched / claimTerms.length;

  // Check for negation in context of matched terms
  const hasContradiction = bestNegated && bestOverlap > 0.3;

  if (hasContradiction) {
    return {
      status: 'contradicted',
      confidence: Math.min(bestOverlap, 0.8),
      reason: `Abstract appears to negate the claim (${totalMatched}/${claimTerms.length} key terms found, negation detected in best-matching sentence)`,
      excerpt: bestSentence.slice(0, 200),
    };
  }

  if (bestOverlap >= 0.6) {
    return {
      status: 'verified',
      confidence: Math.min(bestOverlap, 0.95),
      reason: `Strong keyword overlap (${totalMatched}/${claimTerms.length} key terms found in abstract, ${(bestOverlap * 100).toFixed(0)}% in best sentence)`,
      excerpt: bestSentence.slice(0, 200),
    };
  }

  if (overallCoverage >= 0.4) {
    return {
      status: 'partial',
      confidence: overallCoverage * 0.7,
      reason: `Moderate keyword overlap (${totalMatched}/${claimTerms.length} terms found across abstract, but no single sentence strongly supports claim)`,
      excerpt: bestSentence.slice(0, 200),
    };
  }

  return {
    status: 'unsupported',
    confidence: overallCoverage * 0.3,
    reason: `Low keyword overlap (only ${totalMatched}/${claimTerms.length} key terms found in abstract)`,
    ...(bestSentence.length > 0 ? { excerpt: bestSentence.slice(0, 200) } : {}),
  };
}
