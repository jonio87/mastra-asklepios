import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RecordFrontmatter, StructuredLabValue } from './schemas.js';
import { recordFrontmatterSchema, structuredValuesBlockSchema } from './schemas.js';

/**
 * Parsed medical-records file — frontmatter, body text, and optional
 * structured lab values extracted from the ## Structured Values block.
 */
export interface ParsedRecord {
  filePath: string;
  frontmatter: RecordFrontmatter;
  body: string;
  structuredValues?: StructuredLabValue[];
}

/**
 * Parse a medical-records markdown file and validate its contents.
 *
 * Splits YAML frontmatter from body, validates frontmatter against the
 * RecordFrontmatter schema, and extracts structured lab values if present.
 * Throws with file path context on validation failure.
 */
export async function parseRecordFile(filePath: string): Promise<ParsedRecord> {
  const raw = await readFile(filePath, 'utf-8');
  const { frontmatterRaw, body } = splitFrontmatter(raw, filePath);

  // Parse YAML frontmatter
  const parsed: unknown = parseYaml(frontmatterRaw);
  const frontmatterResult = recordFrontmatterSchema.safeParse(parsed);
  if (!frontmatterResult.success) {
    const issues = frontmatterResult.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Frontmatter validation failed in ${filePath}:\n${issues}`);
  }

  const frontmatter = frontmatterResult.data;

  // Extract structured lab values if present
  const structuredValues = extractStructuredValues(body, filePath);

  const result: ParsedRecord = { filePath, frontmatter, body };
  if (structuredValues) {
    result.structuredValues = structuredValues;
  }
  return result;
}

/**
 * Split YAML frontmatter (between --- markers) from markdown body.
 * Returns both parts as strings.
 */
function splitFrontmatter(
  content: string,
  filePath: string,
): { frontmatterRaw: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error(`No YAML frontmatter found in ${filePath}`);
  }
  return { frontmatterRaw: match[1], body: match[2] };
}

/**
 * Extract structured lab values from a ## Structured Values YAML code block.
 * Returns undefined if no structured values section exists.
 */
function extractStructuredValues(body: string, filePath: string): StructuredLabValue[] | undefined {
  const marker = '## Structured Values';
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) return undefined;

  // Find the YAML code block after the marker
  const afterMarker = body.slice(markerIndex + marker.length);
  const yamlMatch = afterMarker.match(/```yaml\n([\s\S]*?)```/);
  if (!yamlMatch?.[1]) {
    throw new Error(`Found "## Structured Values" but no yaml code block in ${filePath}`);
  }

  const parsed: unknown = parseYaml(yamlMatch[1]);
  const blockResult = structuredValuesBlockSchema.safeParse(parsed);
  if (!blockResult.success) {
    const issues = blockResult.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Structured values validation failed in ${filePath}:\n${issues}`);
  }

  return blockResult.data.lab_values;
}

/**
 * Strip YAML frontmatter from content, returning body text only.
 * Used for Layer 3 document ingestion (we don't want YAML metadata in the vector index).
 */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match?.[1] ?? content;
}

/**
 * Recursively discover all .md files under a directory.
 * Sorted by filename for deterministic processing order.
 */
export async function discoverRecordFiles(recordsDir: string): Promise<string[]> {
  const files: string[] = [];
  await walkDir(recordsDir, files);
  files.sort((a, b) => relative(recordsDir, a).localeCompare(relative(recordsDir, b)));
  return files;
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      await walkDir(fullPath, results);
    } else if (entry.endsWith('.md')) {
      results.push(fullPath);
    }
  }
}
