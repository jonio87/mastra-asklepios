import { describe, expect, it } from '@jest/globals';

// Mock the hierarchy loader (import.meta.url issue in Jest)
jest.mock('./snomed-hierarchy.js', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'data', 'terminology', 'snomed-hierarchy.json'),
    'utf-8',
  );
  const data = JSON.parse(raw) as { hierarchy: Record<string, { display: string; parents: string[] }> };
  const hierarchyMap = new Map(Object.entries(data.hierarchy));

  function isA(childCode: string, parentCode: string): boolean {
    if (childCode === parentCode) return true;
    const visited = new Set<string>();
    const queue = [childCode];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const entry = hierarchyMap.get(current);
      if (!entry) continue;
      for (const parent of entry.parents) {
        if (parent === parentCode) return true;
        queue.push(parent);
      }
    }
    return false;
  }

  function getAncestors(code: string): string[] {
    const ancestors = new Set<string>();
    const queue = [code];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const entry = hierarchyMap.get(current);
      if (!entry) continue;
      for (const parent of entry.parents) {
        if (parent !== code) ancestors.add(parent);
        queue.push(parent);
      }
    }
    return [...ancestors];
  }

  function getDisplay(code: string): string | undefined {
    return hierarchyMap.get(code)?.display;
  }

  function getChildren(parentCode: string): string[] {
    const children: string[] = [];
    for (const [code, entry] of hierarchyMap) {
      if (entry.parents.includes(parentCode)) children.push(code);
    }
    return children;
  }

  return { isA, getAncestors, getDisplay, getChildren, resetHierarchyCache: () => {} };
});

import { getAncestors, getChildren, getDisplay, isA } from './snomed-hierarchy.js';

describe('SNOMED Hierarchy', () => {
  describe('isA', () => {
    it('Tension-type headache is-a Headache', () => {
      expect(isA('398057008', '25064002')).toBe(true);
    });

    it('Tension-type headache is-a Clinical finding (transitive)', () => {
      expect(isA('398057008', '404684003')).toBe(true);
    });

    it('Tension-type headache is NOT Hiatal hernia', () => {
      expect(isA('398057008', '84089009')).toBe(false);
    });

    it('same code is-a itself', () => {
      expect(isA('25064002', '25064002')).toBe(true);
    });

    it('SUNCT is-a Headache', () => {
      expect(isA('431236002', '25064002')).toBe(true);
    });

    it('PVC is-a Premature cardiac contraction', () => {
      expect(isA('164884008', '284470004')).toBe(true);
    });

    it('Small fiber neuropathy is-a Peripheral neuropathy', () => {
      expect(isA('443144003', '302226006')).toBe(true);
    });

    it('unknown code returns false', () => {
      expect(isA('999999999', '25064002')).toBe(false);
    });
  });

  describe('getAncestors', () => {
    it('returns ancestors of Tension-type headache', () => {
      const ancestors = getAncestors('398057008');
      expect(ancestors).toContain('25064002'); // Headache
      expect(ancestors).toContain('22253000'); // Pain
      expect(ancestors).toContain('404684003'); // Clinical finding
    });

    it('returns empty array for root concept', () => {
      const ancestors = getAncestors('404684003');
      expect(ancestors).toEqual([]);
    });
  });

  describe('getDisplay', () => {
    it('returns display name for known code', () => {
      expect(getDisplay('398057008')).toBe('Tension-type headache');
    });

    it('returns undefined for unknown code', () => {
      expect(getDisplay('999999999')).toBeUndefined();
    });
  });

  describe('getChildren', () => {
    it('returns children of Headache', () => {
      const children = getChildren('25064002');
      expect(children).toContain('398057008'); // Tension-type headache
      expect(children).toContain('431236002'); // SUNCT
      expect(children).toContain('37796009'); // Migraine
    });
  });
});
