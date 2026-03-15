/**
 * Unified Terminology Service — facade for all healthcare code systems.
 *
 * Provides a single interface for code lookup, validation, and cross-system
 * translation (crosswalks) across LOINC, SNOMED CT, ICD-10, and RxNorm.
 *
 * Design principles:
 * - Code system implementations register themselves via registerLookup/registerCrosswalk
 * - The facade delegates to the appropriate implementation based on system URI
 * - All terminology URIs follow FHIR R4 conventions
 * - Lookup functions are synchronous (backed by in-memory maps)
 * - Crosswalk functions return all known mappings for a source code
 */

// ─── System URIs (FHIR R4 standard) ──────────────────────────────────────

export const SYSTEM_LOINC = 'http://loinc.org';
export const SYSTEM_SNOMED = 'http://snomed.info/sct';
export const SYSTEM_ICD10 = 'http://hl7.org/fhir/sid/icd-10';
export const SYSTEM_RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
export const SYSTEM_UCUM = 'http://unitsofmeasure.org';

// ─── Result Types ─────────────────────────────────────────────────────────

/** Result of looking up a term in a code system. */
export interface CodeResult {
  /** Code system URI (e.g., 'http://loinc.org') */
  system: string;
  /** The code value (e.g., '6690-2') */
  code: string;
  /** Human-readable display name (e.g., 'Leukocytes [#/volume] in Blood') */
  display: string;
  /** Whether the code is active in the current edition (undefined = unknown) */
  active?: boolean;
}

/** Result of translating a code from one system to another. */
export interface CrosswalkResult {
  sourceSystem: string;
  sourceCode: string;
  sourceDisplay?: string;
  targetSystem: string;
  targetCode: string;
  targetDisplay?: string;
  /** Relationship between source and target concepts */
  relationship: 'equivalent' | 'broader' | 'narrower' | 'related';
}

// ─── Provider Interfaces ──────────────────────────────────────────────────

/** Result of validating a code in a code system. */
export interface ValidationResult {
  /** Whether the code is recognized in this code system */
  valid: boolean;
  /** Whether the code is active (undefined = unknown) */
  active?: boolean;
  /** Human-readable display name if found */
  display?: string;
  /** Warnings (e.g., "code is deprecated", "not in expected hierarchy") */
  warnings?: string[];
}

/**
 * Lookup function signature — registered per code system.
 * Takes a search term (e.g., condition name, test name, medication name)
 * and returns a CodeResult if found.
 */
export type LookupFn = (term: string) => CodeResult | undefined;

/**
 * Validation function signature — registered per code system.
 * Takes a code and returns validation result.
 */
export type ValidateFn = (code: string) => ValidationResult;

/**
 * Crosswalk function signature — registered per source→target system pair.
 * Takes a source code and returns all known mappings to the target system.
 */
export type CrosswalkFn = (sourceCode: string) => CrosswalkResult[];

// ─── Terminology Service ──────────────────────────────────────────────────

export class TerminologyService {
  private lookups = new Map<string, LookupFn>();
  private validators = new Map<string, ValidateFn>();
  private crosswalks = new Map<string, CrosswalkFn>();

  /**
   * Register a lookup function for a code system.
   * @param system — Code system URI (e.g., SYSTEM_LOINC)
   * @param fn — Lookup function that maps terms to codes
   */
  registerLookup(system: string, fn: LookupFn): void {
    this.lookups.set(system, fn);
  }

  /**
   * Register a validation function for a code system.
   * @param system — Code system URI
   * @param fn — Validation function that checks if a code is valid
   */
  registerValidator(system: string, fn: ValidateFn): void {
    this.validators.set(system, fn);
  }

  /**
   * Register a crosswalk function for a source→target system pair.
   * @param sourceSystem — Source code system URI
   * @param targetSystem — Target code system URI
   * @param fn — Translation function
   */
  registerCrosswalk(sourceSystem: string, targetSystem: string, fn: CrosswalkFn): void {
    const key = `${sourceSystem}|${targetSystem}`;
    this.crosswalks.set(key, fn);
  }

  /**
   * Look up a code in a specific code system by term.
   *
   * @param system — Code system URI
   * @param term — Search term (condition name, test name, medication name, etc.)
   * @returns CodeResult if found, undefined otherwise
   */
  lookup(system: string, term: string): CodeResult | undefined {
    const fn = this.lookups.get(system);
    if (!fn) return undefined;
    return fn(term);
  }

  /**
   * Validate a code in a specific code system.
   *
   * @param system — Code system URI
   * @param code — Code to validate
   * @returns ValidationResult with valid/active/display/warnings
   */
  validate(system: string, code: string): ValidationResult {
    const fn = this.validators.get(system);
    if (!fn) return { valid: false, warnings: [`No validator registered for system: ${system}`] };
    return fn(code);
  }

  /**
   * Translate a code from one system to another via crosswalk.
   *
   * @param sourceSystem — Source code system URI
   * @param sourceCode — Code in the source system
   * @param targetSystem — Target code system URI
   * @returns Array of CrosswalkResults (may be empty if no mapping exists)
   */
  translate(sourceSystem: string, sourceCode: string, targetSystem: string): CrosswalkResult[] {
    const key = `${sourceSystem}|${targetSystem}`;
    const fn = this.crosswalks.get(key);
    if (!fn) return [];
    return fn(sourceCode);
  }

  /** List all registered code system URIs. */
  registeredSystems(): string[] {
    return [...this.lookups.keys()];
  }

  /** List all registered crosswalk pairs as "source|target" strings. */
  registeredCrosswalks(): string[] {
    return [...this.crosswalks.keys()];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let instance: TerminologyService | null = null;

/**
 * Get the singleton TerminologyService instance.
 * Providers register themselves on first access via initTerminologyService().
 */
export function getTerminologyService(): TerminologyService {
  if (!instance) {
    instance = new TerminologyService();
  }
  return instance;
}

/** Reset the singleton (for testing). */
export function resetTerminologyService(): void {
  instance = null;
}
