/**
 * SNOMED CT Lightweight Subsumption Index
 *
 * Provides is-a hierarchy queries for the ~90 unique SNOMED CT concepts
 * used in the Asklepios findings map. Uses a curated parent-child graph
 * rather than the full SNOMED CT ontology (~350K concepts).
 *
 * Data source: data/terminology/snomed-hierarchy.json
 *
 * Key capability: isA(child, parent) — answers "Is concept X a type of concept Y?"
 * Example: isA('398057008', '25064002') → true (Tension-type headache is-a Headache)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Data loading ──────────────────────────────────────────────────────────

interface HierarchyEntry {
  display: string;
  parents: string[];
}

interface HierarchyData {
  hierarchy: Record<string, HierarchyEntry>;
}

let hierarchyMap: Map<string, HierarchyEntry> | null = null;

function loadHierarchy(): Map<string, HierarchyEntry> {
  if (hierarchyMap) return hierarchyMap;

  let dataDir: string;
  try {
    const thisFile = fileURLToPath(import.meta.url);
    dataDir = join(dirname(thisFile), '..', '..', 'data', 'terminology');
  } catch {
    dataDir = join(process.cwd(), 'data', 'terminology');
  }

  const raw = readFileSync(join(dataDir, 'snomed-hierarchy.json'), 'utf-8');
  const data = JSON.parse(raw) as HierarchyData;

  hierarchyMap = new Map(Object.entries(data.hierarchy));
  return hierarchyMap;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Check if childCode is-a (subtype of) parentCode in the SNOMED hierarchy.
 *
 * Uses breadth-first search up the parent chain. Returns true if parentCode
 * appears anywhere in the ancestor chain of childCode, or if they are the same code.
 *
 * @param childCode — SNOMED CT concept ID to check
 * @param parentCode — SNOMED CT concept ID that might be an ancestor
 * @returns true if childCode is-a parentCode (or they are equal)
 */
export function isA(childCode: string, parentCode: string): boolean {
  if (childCode === parentCode) return true;

  const hierarchy = loadHierarchy();
  const visited = new Set<string>();
  const queue = [childCode];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const entry = hierarchy.get(current);
    if (!entry) continue;

    for (const parent of entry.parents) {
      if (parent === parentCode) return true;
      queue.push(parent);
    }
  }

  return false;
}

/**
 * Get all ancestor codes for a given SNOMED concept (transitive closure).
 *
 * @param code — SNOMED CT concept ID
 * @returns Array of ancestor concept IDs (not including the code itself)
 */
export function getAncestors(code: string): string[] {
  const hierarchy = loadHierarchy();
  const ancestors = new Set<string>();
  const queue = [code];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const entry = hierarchy.get(current);
    if (!entry) continue;

    for (const parent of entry.parents) {
      if (parent !== code) ancestors.add(parent);
      queue.push(parent);
    }
  }

  return [...ancestors];
}

/**
 * Get the display name for a SNOMED concept from the hierarchy.
 *
 * @param code — SNOMED CT concept ID
 * @returns Display name or undefined if not in hierarchy
 */
export function getDisplay(code: string): string | undefined {
  const hierarchy = loadHierarchy();
  return hierarchy.get(code)?.display;
}

/**
 * Get direct children of a SNOMED concept.
 *
 * @param parentCode — SNOMED CT concept ID
 * @returns Array of child concept IDs
 */
export function getChildren(parentCode: string): string[] {
  const hierarchy = loadHierarchy();
  const children: string[] = [];

  for (const [code, entry] of hierarchy) {
    if (entry.parents.includes(parentCode)) {
      children.push(code);
    }
  }

  return children;
}

/** Reset cache (for testing). */
export function resetHierarchyCache(): void {
  hierarchyMap = null;
}
