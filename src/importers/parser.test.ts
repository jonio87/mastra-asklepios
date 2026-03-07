import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { discoverRecordFiles, parseRecordFile, stripFrontmatter } from './parser.js';

const TEST_DIR = join(tmpdir(), `asklepios-parser-test-${Date.now()}`);

// Helper to create a temp test file
async function createTestFile(name: string, content: string): Promise<string> {
  await mkdir(TEST_DIR, { recursive: true });
  const filePath = join(TEST_DIR, name);
  await writeFile(filePath, content);
  return filePath;
}

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('parseRecordFile', () => {
  it('parses frontmatter and body correctly', async () => {
    const content = `---
document_id: test-001
document_type: lab_result
patient_id: test-patient
asklepios_type: lab-report
evidence_tier: T1-official
validation_status: confirmed
source_credibility: 95
date: "2025-01-15"
---
# Lab Results

WBC: 3.5 tys/µl
`;
    const filePath = await createTestFile('basic.md', content);
    const result = await parseRecordFile(filePath);

    expect(result.frontmatter.document_id).toBe('test-001');
    expect(result.frontmatter.document_type).toBe('lab_result');
    expect(result.frontmatter.patient_id).toBe('test-patient');
    expect(result.frontmatter.evidence_tier).toBe('T1-official');
    expect(result.frontmatter.source_credibility).toBe(95);
    expect(result.body).toContain('Lab Results');
    expect(result.body).toContain('WBC: 3.5');
    expect(result.structuredValues).toBeUndefined();
  });

  it('extracts structured lab values from YAML block', async () => {
    const content = `---
document_id: test-002
document_type: lab_result
patient_id: test-patient
asklepios_type: lab-report
evidence_tier: T1-official
validation_status: confirmed
source_credibility: 98
---
# Lab Report

## Structured Values

\`\`\`yaml
lab_values:
  - test_name: "White blood cells (WBC)"
    test_name_pl: "Leukocyty (WBC)"
    loinc: "26464-8"
    value: 2.59
    unit: "tys/µl"
    reference_range: "4.00 - 10.00"
    flag: "low"
    date: "2025-09-01"
  - test_name: "Red blood cells (RBC)"
    value: 4.82
    unit: "mln/µl"
    reference_range: "4.63 - 6.08"
    flag: "normal"
    date: "2025-09-01"
\`\`\`
`;
    const filePath = await createTestFile('with-values.md', content);
    const result = await parseRecordFile(filePath);

    expect(result.structuredValues).toBeDefined();
    expect(result.structuredValues).toHaveLength(2);
    expect(result.structuredValues?.[0]?.test_name).toBe('White blood cells (WBC)');
    expect(result.structuredValues?.[0]?.value).toBe(2.59);
    expect(result.structuredValues?.[0]?.flag).toBe('low');
    expect(result.structuredValues?.[1]?.flag).toBe('normal');
  });

  it('throws on missing YAML frontmatter', async () => {
    const content = '# Just a markdown file\nNo frontmatter here.\n';
    const filePath = await createTestFile('no-frontmatter.md', content);

    await expect(parseRecordFile(filePath)).rejects.toThrow('No YAML frontmatter');
  });

  it('throws on invalid frontmatter values', async () => {
    const content = `---
document_id: test-bad
document_type: pdf
patient_id: test
asklepios_type: lab-report
evidence_tier: T1-official
validation_status: confirmed
source_credibility: 95
---
Body text
`;
    const filePath = await createTestFile('bad-type.md', content);
    await expect(parseRecordFile(filePath)).rejects.toThrow('Frontmatter validation failed');
  });

  it('throws on malformed structured values YAML', async () => {
    const content = `---
document_id: test-bad-sv
document_type: lab_result
patient_id: test
asklepios_type: lab-report
evidence_tier: T1-official
validation_status: confirmed
source_credibility: 90
---
## Structured Values

\`\`\`yaml
lab_values:
  - test_name: "WBC"
    value: 3.5
    flag: "invalid_flag"
    date: "2025-01-01"
    unit: "x"
\`\`\`
`;
    const filePath = await createTestFile('bad-sv.md', content);
    await expect(parseRecordFile(filePath)).rejects.toThrow('Structured values validation failed');
  });

  it('handles null date in frontmatter', async () => {
    const content = `---
document_id: test-null-date
document_type: lab_result
patient_id: test
asklepios_type: lab-report
evidence_tier: T1-official
validation_status: confirmed
source_credibility: 85
date: null
---
Undated document
`;
    const filePath = await createTestFile('null-date.md', content);
    const result = await parseRecordFile(filePath);
    expect(result.frontmatter.date).toBeUndefined();
  });

  it('handles extra frontmatter fields via passthrough', async () => {
    const content = `---
document_id: test-extra
document_type: imaging_report
patient_id: test
asklepios_type: imaging-report
evidence_tier: T1-official
validation_status: confirmed
source_credibility: 96
modality: MRI
body_region: cervical spine
---
Imaging report body
`;
    const filePath = await createTestFile('extra-fields.md', content);
    const result = await parseRecordFile(filePath);
    expect(result.frontmatter.document_id).toBe('test-extra');
    // Extra fields pass through without error
  });
});

describe('stripFrontmatter', () => {
  it('returns body without YAML frontmatter', () => {
    const content = `---
key: value
---
Body text here
More body
`;
    expect(stripFrontmatter(content)).toBe('Body text here\nMore body\n');
  });

  it('returns original content if no frontmatter', () => {
    const content = 'Just plain text';
    expect(stripFrontmatter(content)).toBe('Just plain text');
  });
});

describe('discoverRecordFiles', () => {
  it('finds all .md files recursively', async () => {
    const subDir = join(TEST_DIR, 'discover-test', 'subdir');
    await mkdir(subDir, { recursive: true });

    await writeFile(join(TEST_DIR, 'discover-test', 'root.md'), '# Root');
    await writeFile(join(subDir, 'nested.md'), '# Nested');
    await writeFile(join(subDir, 'not-md.txt'), 'Not markdown');

    const files = await discoverRecordFiles(join(TEST_DIR, 'discover-test'));
    const names = files.map((f) => f.split('/').pop());

    expect(names).toContain('root.md');
    expect(names).toContain('nested.md');
    expect(names).not.toContain('not-md.txt');
    expect(files).toHaveLength(2);
  });

  it('returns sorted file list', async () => {
    const sortDir = join(TEST_DIR, 'sort-test');
    await mkdir(sortDir, { recursive: true });

    await writeFile(join(sortDir, 'c.md'), '# C');
    await writeFile(join(sortDir, 'a.md'), '# A');
    await writeFile(join(sortDir, 'b.md'), '# B');

    const files = await discoverRecordFiles(sortDir);
    const names = files.map((f) => f.split('/').pop());

    expect(names).toEqual(['a.md', 'b.md', 'c.md']);
  });
});
