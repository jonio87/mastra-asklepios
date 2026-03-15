/**
 * Terminology Service — public API
 *
 * Re-exports the unified terminology service interface, types, and constants.
 */

export {
  getTerminologyService,
  resetTerminologyService,
  TerminologyService,
  SYSTEM_ICD10,
  SYSTEM_LOINC,
  SYSTEM_RXNORM,
  SYSTEM_SNOMED,
  SYSTEM_UCUM,
} from './terminology-service.js';

export type {
  CodeResult,
  CrosswalkFn,
  CrosswalkResult,
  LookupFn,
  ValidateFn,
  ValidationResult,
} from './terminology-service.js';

export { isA, getAncestors, getChildren, getDisplay } from './snomed-hierarchy.js';

export { translateCode, getAllCrosswalks, resetCrosswalkCache } from './crosswalk-service.js';

export { initTerminologyProviders, resetTerminologyInit } from './init.js';
