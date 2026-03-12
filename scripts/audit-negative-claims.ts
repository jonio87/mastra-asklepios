/**
 * Audit Negative Claims in Research Documents
 *
 * Scans all research/*.md files for absence patterns ("never measured",
 * "never tested", "no evidence of", "has not been", "untested") and
 * cross-references each claim against Layer 2 (clinical store) data.
 * Flags contradictions where the claim says something is absent but
 * Layer 2 actually has the data.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { ClinicalStore } from '../src/storage/clinical-store.js';

const PATIENT_ID = 'patient-tomasz-szychlinski';

// Patterns that indicate a negative claim
const NEGATIVE_PATTERNS = [
  /never\s+(?:been\s+)?measured/gi,
  /never\s+(?:been\s+)?tested/gi,
  /never\s+(?:been\s+)?performed/gi,
  /never\s+(?:been\s+)?done/gi,
  /never\s+(?:been\s+)?ordered/gi,
  /has\s+not\s+been\s+(?:measured|tested|done|performed)/gi,
  /untested\s+lab/gi,
  /critical\s+(?:missing|gap)/gi,
  /no\s+evidence\s+of/gi,
  /NIGDY/g,
];

// Extract a test/finding name from surrounding context
function extractSubject(line: string, matchStart: number): string {
  // Look for the subject before the negative pattern
  const before = line.slice(Math.max(0, matchStart - 100), matchStart);
  // Try to find a capitalized term or quoted term
  const quotedMatch = before.match(/[""'`]([^""'`]+)[""'`]\s*$/);
  if (quotedMatch?.[1]) return quotedMatch[1];

  const boldMatch = before.match(/\*\*([^*]+)\*\*\s*$/);
  if (boldMatch?.[1]) return boldMatch[1];

  // Fall back to last few words
  const words = before.trim().split(/\s+/).slice(-4).join(' ');
  return words || 'unknown';
}

async function main() {
  const store = new ClinicalStore();

  console.log('=== Auditing Negative Claims in Research Documents ===\n');

  // Scan research directory
  const files = readdirSync('research')
    .filter((f) => f.endsWith('.md'))
    .map((f) => `research/${f}`);

  console.log(`Scanning ${files.length} files...\n`);

  let totalClaims = 0;
  let contradictions = 0;
  const issues: Array<{ file: string; line: number; claim: string; subject: string; contradiction: string }> = [];

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      for (const pattern of NEGATIVE_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          totalClaims++;
          const subject = extractSubject(line, match.index);

          // Extract searchable terms from the subject
          const searchTerms = subject
            .replace(/[*_`#|]/g, '')
            .split(/[\s/,]+/)
            .filter((w) => w.length > 3);

          // Search Layer 2 labs
          for (const term of searchTerms) {
            const labs = await store.queryLabs({
              patientId: PATIENT_ID,
              testName: `%${term}%`,
            });
            if (labs.length > 0) {
              contradictions++;
              const issue = {
                file,
                line: i + 1,
                claim: match[0],
                subject,
                contradiction: `Found ${labs.length} lab results for "${term}" (${labs.map((l) => `${l.date}: ${l.value} ${l.unit}`).join('; ')})`,
              };
              issues.push(issue);
              console.log(`  ❌ CONTRADICTION: ${file}:${i + 1}`);
              console.log(`     Claim: "${match[0]}" about "${subject}"`);
              console.log(`     Found: ${issue.contradiction}\n`);
            }
          }

          // Search Layer 2 treatments
          const treatments = await store.queryTreatments({ patientId: PATIENT_ID });
          for (const term of searchTerms) {
            const matchingTreatments = treatments.filter(
              (t) =>
                t.medication.toLowerCase().includes(term.toLowerCase()) ||
                (t.drugClass && t.drugClass.toLowerCase().includes(term.toLowerCase())),
            );
            if (matchingTreatments.length > 0) {
              contradictions++;
              const issue = {
                file,
                line: i + 1,
                claim: match[0],
                subject,
                contradiction: `Found ${matchingTreatments.length} treatment(s): ${matchingTreatments.map((t) => t.medication).join(', ')}`,
              };
              issues.push(issue);
              console.log(`  ❌ CONTRADICTION: ${file}:${i + 1}`);
              console.log(`     Claim: "${match[0]}" about "${subject}"`);
              console.log(`     Found: ${issue.contradiction}\n`);
            }
          }
        }
      }
    }
  }

  // Summary
  console.log('\n=== Audit Summary ===');
  console.log(`Files scanned: ${files.length}`);
  console.log(`Negative claims found: ${totalClaims}`);
  console.log(`Contradictions: ${contradictions}`);

  if (issues.length > 0) {
    console.log('\n--- Issues to Fix ---');
    for (const issue of issues) {
      console.log(`${issue.file}:${issue.line} — "${issue.claim}" about "${issue.subject}"`);
      console.log(`  → ${issue.contradiction}`);
    }
  } else {
    console.log('\n✅ No contradictions found — all negative claims appear valid.');
  }

  console.log('\n=== Audit Complete ===');
}

main().catch(console.error);
