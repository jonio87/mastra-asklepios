#!/usr/bin/env node

/**
 * Citation Verification Script
 *
 * Parses all PMIDs and PMC IDs from the hypothesis analysis file,
 * verifies each citation exists in PubMed, and checks if the claimed
 * finding matches the actual paper content.
 *
 * Usage: node scripts/verify-citations.mjs [--file path/to/file.md]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NCBI_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const API_KEY = process.env.NCBI_API_KEY;
const RATE_LIMIT_MS = API_KEY ? 100 : 334;

const DEFAULT_FILE = 'research/hypothesis-analysis-tomasz-szychlinski.md';

// --- Rate limiting ---
let lastRequest = 0;
async function throttledFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequest;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequest = Date.now();

  const fullUrl = API_KEY
    ? `${url}${url.includes('?') ? '&' : '?'}api_key=${API_KEY}`
    : url;

  const response = await fetch(fullUrl);
  if (response.status === 429) {
    console.log('  ⏳ Rate limited, waiting 2s...');
    await new Promise((r) => setTimeout(r, 2000));
    return fetch(fullUrl);
  }
  return response;
}

// --- XML helpers ---
function extractXmlText(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match?.[1]?.trim() ?? '';
}

function extractAllXmlText(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const text = match[1]?.trim();
    if (text) results.push(text);
  }
  return results;
}

function stripXmlTags(text) {
  return text.replace(/<[^>]+>/g, '').trim();
}

// --- Citation extraction ---
function extractCitations(markdown) {
  const citations = [];

  // Match "PMID: NNNNNNN" or "PMID:NNNNNNN"
  const pmidRegex = /PMID:\s*(\d{7,8})/gi;
  let match;
  while ((match = pmidRegex.exec(markdown)) !== null) {
    const pmid = match[1];
    if (!citations.some((c) => c.id === pmid && c.type === 'pmid')) {
      // Find the context (the full line or table row)
      const lineStart = markdown.lastIndexOf('\n', match.index) + 1;
      const lineEnd = markdown.indexOf('\n', match.index);
      const context = markdown.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

      citations.push({ type: 'pmid', id: pmid, context });
    }
  }

  // Match "PMCNNNNNNN" or "PMC NNNNNNN"
  const pmcRegex = /PMC\s*(\d{5,8})/gi;
  while ((match = pmcRegex.exec(markdown)) !== null) {
    const pmcId = `PMC${match[1]}`;
    if (!citations.some((c) => c.id === pmcId && c.type === 'pmc')) {
      const lineStart = markdown.lastIndexOf('\n', match.index) + 1;
      const lineEnd = markdown.indexOf('\n', match.index);
      const context = markdown.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();

      citations.push({ type: 'pmc', id: pmcId, context });
    }
  }

  return citations;
}

// --- PMID verification ---
async function verifyPmid(pmid) {
  const url = `${NCBI_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=xml&retmode=xml`;

  try {
    const response = await throttledFetch(url);
    if (!response.ok) {
      return { exists: false, error: `HTTP ${response.status}` };
    }

    const xml = await response.text();

    if (xml.includes('<ERROR>')) {
      return { exists: false, error: extractXmlText(xml, 'ERROR') || 'Unknown error' };
    }

    const medlineCitation = extractXmlText(xml, 'MedlineCitation');
    if (!medlineCitation) {
      return { exists: false, error: 'No MedlineCitation found' };
    }

    const article = extractXmlText(medlineCitation, 'Article');
    const title = stripXmlTags(extractXmlText(article, 'ArticleTitle'));

    // Abstract
    const abstractSection = extractXmlText(article, 'Abstract');
    const abstractParts = extractAllXmlText(abstractSection, 'AbstractText');
    const abstract = abstractParts.map(stripXmlTags).join(' ');

    // Journal
    const journalXml = extractXmlText(article, 'Journal');
    const journal =
      extractXmlText(journalXml, 'Title') ||
      extractXmlText(journalXml, 'ISOAbbreviation');

    // Publication date
    const pubDateXml = extractXmlText(journalXml, 'PubDate');
    const year = extractXmlText(pubDateXml, 'Year');

    // Authors
    const authorListXml = extractXmlText(article, 'AuthorList');
    const authorBlocks = extractAllXmlText(authorListXml, 'Author');
    const firstAuthor = authorBlocks.length > 0
      ? extractXmlText(authorBlocks[0], 'LastName')
      : 'Unknown';

    // MeSH terms
    const meshListXml = extractXmlText(medlineCitation, 'MeshHeadingList');
    const meshHeadings = extractAllXmlText(meshListXml, 'MeshHeading');
    const meshTerms = meshHeadings
      .map((h) => stripXmlTags(extractXmlText(h, 'DescriptorName')))
      .filter(Boolean);

    // Publication types
    const pubTypeListXml = extractXmlText(article, 'PublicationTypeList');
    const pubTypes = extractAllXmlText(pubTypeListXml, 'PublicationType')
      .map(stripXmlTags)
      .filter(Boolean);

    return {
      exists: true,
      title,
      abstract: abstract.slice(0, 1000),
      journal,
      year,
      firstAuthor,
      meshTerms: meshTerms.slice(0, 10),
      publicationTypes: pubTypes,
    };
  } catch (error) {
    return { exists: false, error: String(error) };
  }
}

// --- PMC verification (convert to PMID first) ---
async function verifyPmc(pmcId) {
  // Use NCBI ID converter
  const url = `${NCBI_BASE}/esearch.fcgi?db=pubmed&term=${pmcId}[pmcid]&retmode=json`;

  try {
    const response = await throttledFetch(url);
    if (!response.ok) {
      return { exists: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const ids = data.esearchresult?.idlist ?? [];

    if (ids.length === 0) {
      return { exists: false, error: 'PMC ID not found in PubMed' };
    }

    // Verify the PMID we found
    const pmidResult = await verifyPmid(ids[0]);
    return { ...pmidResult, linkedPmid: ids[0] };
  } catch (error) {
    return { exists: false, error: String(error) };
  }
}

// --- Claim matching ---
function extractClaimFromContext(context) {
  // Extract the finding/claim from a markdown table row
  // Format: | # | Citation | Finding/Case/Claim |
  const parts = context.split('|').map((p) => p.trim());
  // The finding is usually in the last meaningful column
  const meaningful = parts.filter((p) => p.length > 10);
  return meaningful[meaningful.length - 1] ?? context;
}

function checkClaimAlignment(claim, articleData) {
  if (!articleData.exists || !articleData.abstract) return 'unverifiable';

  const combinedText = `${articleData.title} ${articleData.abstract}`.toLowerCase();
  const claimLower = claim.toLowerCase();

  // Extract key numbers from claim
  const claimNumbers = claimLower.match(/\d+\.?\d*%?/g) ?? [];
  const textNumbers = combinedText.match(/\d+\.?\d*%?/g) ?? [];

  // Check if key numbers from claim appear in abstract
  let numberMatches = 0;
  for (const num of claimNumbers) {
    if (textNumbers.includes(num)) numberMatches++;
  }

  // Check key terms
  const keyTerms = claimLower
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 4);
  let termMatches = 0;
  for (const term of keyTerms) {
    if (combinedText.includes(term)) termMatches++;
  }

  const termMatchRatio = keyTerms.length > 0 ? termMatches / keyTerms.length : 0;
  const numberMatchRatio = claimNumbers.length > 0 ? numberMatches / claimNumbers.length : 1;

  if (termMatchRatio > 0.5 && numberMatchRatio > 0.5) return 'likely-accurate';
  if (termMatchRatio > 0.3 || numberMatchRatio > 0.3) return 'partially-supported';
  return 'needs-manual-review';
}

// --- Main ---
async function main() {
  const fileArg = process.argv.find((a) => a.startsWith('--file='));
  const filePath = fileArg
    ? fileArg.split('=')[1]
    : DEFAULT_FILE;

  console.log(`\n📚 Citation Verification Script`);
  console.log(`   File: ${filePath}`);
  console.log(`   API Key: ${API_KEY ? 'configured (10 req/s)' : 'not set (3 req/s)'}\n`);

  const fullPath = resolve(process.cwd(), filePath);
  const markdown = readFileSync(fullPath, 'utf-8');

  const citations = extractCitations(markdown);
  console.log(`Found ${citations.length} unique citations to verify:\n`);

  const results = [];

  for (let i = 0; i < citations.length; i++) {
    const citation = citations[i];
    const claim = extractClaimFromContext(citation.context);

    process.stdout.write(`  [${i + 1}/${citations.length}] ${citation.type.toUpperCase()} ${citation.id}... `);

    let articleData;
    if (citation.type === 'pmid') {
      articleData = await verifyPmid(citation.id);
    } else {
      articleData = await verifyPmc(citation.id);
    }

    let status;
    let claimCheck;
    if (!articleData.exists) {
      status = '❌ NOT FOUND';
      claimCheck = 'n/a';
    } else {
      status = '✅ EXISTS';
      claimCheck = checkClaimAlignment(claim, articleData);
    }

    console.log(`${status} — ${claimCheck}`);

    results.push({
      citation,
      articleData,
      claim,
      status: articleData.exists ? 'found' : 'not-found',
      claimAlignment: claimCheck,
    });
  }

  // Generate report
  console.log('\n─────────────────────────────────────────');
  console.log('VERIFICATION REPORT');
  console.log('─────────────────────────────────────────\n');

  const found = results.filter((r) => r.status === 'found');
  const notFound = results.filter((r) => r.status === 'not-found');
  const likelyAccurate = results.filter((r) => r.claimAlignment === 'likely-accurate');
  const needsReview = results.filter((r) => r.claimAlignment === 'needs-manual-review');

  console.log(`Total citations: ${results.length}`);
  console.log(`  ✅ Found:          ${found.length}`);
  console.log(`  ❌ Not found:      ${notFound.length}`);
  console.log(`  📗 Likely accurate: ${likelyAccurate.length}`);
  console.log(`  📙 Needs review:   ${needsReview.length}`);
  console.log('');

  // Detailed results
  const reportLines = [
    '# Citation Verification Report',
    '',
    `**File**: \`${filePath}\``,
    `**Date**: ${new Date().toISOString().split('T')[0]}`,
    `**Total citations**: ${results.length}`,
    `**Found**: ${found.length} | **Not found**: ${notFound.length}`,
    '',
    '## Results',
    '',
    '| # | ID | Status | Title | Claim Alignment | Notes |',
    '|---|-----|--------|-------|:---------------:|-------|',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const id = `${r.citation.type.toUpperCase()}: ${r.citation.id}`;
    const statusIcon = r.status === 'found' ? '✅' : '❌';
    const title = r.articleData.title
      ? r.articleData.title.slice(0, 60) + (r.articleData.title.length > 60 ? '…' : '')
      : 'Not found';
    const alignment = r.claimAlignment === 'likely-accurate' ? '📗'
      : r.claimAlignment === 'partially-supported' ? '📙'
        : r.claimAlignment === 'needs-manual-review' ? '🔍'
          : r.claimAlignment === 'unverifiable' ? '⚠️'
            : '❌';
    const notes = r.articleData.error
      ? r.articleData.error
      : r.articleData.publicationTypes?.join(', ') ?? '';

    reportLines.push(`| ${i + 1} | ${id} | ${statusIcon} | ${title} | ${alignment} | ${notes} |`);
  }

  reportLines.push('');
  reportLines.push('## Detailed Findings');
  reportLines.push('');

  for (const r of results) {
    reportLines.push(`### ${r.citation.type.toUpperCase()}: ${r.citation.id}`);
    reportLines.push('');

    if (r.articleData.exists) {
      reportLines.push(`**Title**: ${r.articleData.title}`);
      reportLines.push(`**Journal**: ${r.articleData.journal} (${r.articleData.year})`);
      reportLines.push(`**First Author**: ${r.articleData.firstAuthor}`);
      if (r.articleData.linkedPmid) {
        reportLines.push(`**Linked PMID**: ${r.articleData.linkedPmid}`);
      }
      reportLines.push(`**Publication Types**: ${r.articleData.publicationTypes?.join(', ') ?? 'unknown'}`);
      reportLines.push(`**MeSH Terms**: ${r.articleData.meshTerms?.join(', ') ?? 'none'}`);
      reportLines.push('');
      reportLines.push(`**Claim in document**: ${r.claim.slice(0, 200)}`);
      reportLines.push(`**Claim alignment**: ${r.claimAlignment}`);
      if (r.articleData.abstract) {
        reportLines.push('');
        reportLines.push(`**Abstract excerpt**: ${r.articleData.abstract.slice(0, 500)}…`);
      }
    } else {
      reportLines.push(`**Status**: NOT FOUND — ${r.articleData.error}`);
      reportLines.push(`**Context**: ${r.citation.context.slice(0, 200)}`);
    }

    reportLines.push('');
    reportLines.push('---');
    reportLines.push('');
  }

  reportLines.push('');
  reportLines.push('## Legend');
  reportLines.push('');
  reportLines.push('- ✅ = Citation exists in PubMed');
  reportLines.push('- ❌ = Citation not found (may be incorrect PMID, preprint, or non-PubMed source)');
  reportLines.push('- 📗 = Claim text aligns with abstract content (key terms + numbers match)');
  reportLines.push('- 📙 = Claim partially supported (some terms match but needs manual verification)');
  reportLines.push('- 🔍 = Needs manual review (claim may use different terminology than abstract)');
  reportLines.push('- ⚠️ = Unverifiable (no abstract available for comparison)');
  reportLines.push('');

  const reportPath = resolve(process.cwd(), 'research/citation-verification-report.md');
  writeFileSync(reportPath, reportLines.join('\n'));
  console.log(`\n📄 Report saved to: research/citation-verification-report.md\n`);
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
