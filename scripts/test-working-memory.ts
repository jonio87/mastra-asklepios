/**
 * Integration test: Validates deepMergeWorkingMemory semantics
 * from @mastra/memory against PatientProfile schema.
 *
 * Run: npx tsx scripts/test-working-memory.ts
 */
import { deepMergeWorkingMemory } from '@mastra/memory';

type ProfilePartial = Record<string, unknown>;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

// --- Test 1: Initial population ---
const initial: ProfilePartial = {};
const populate: ProfilePartial = {
  patientId: 'eds-01',
  demographics: { ageRange: '30-40', sex: 'female' },
  symptoms: [{ name: 'joint hypermobility', severity: 8 }],
  hpoTerms: ['HP:0001382'],
};
const afterPopulate = deepMergeWorkingMemory(initial, populate);
assert(afterPopulate['patientId'] === 'eds-01', '1a: patientId set');
assert(
  Array.isArray(afterPopulate['symptoms']) && (afterPopulate['symptoms'] as unknown[]).length === 1,
  '1b: symptoms array populated',
);

// --- Test 2: Partial update (only symptoms) preserves other fields ---
const symptomsUpdate: ProfilePartial = {
  symptoms: [
    { name: 'joint hypermobility', severity: 8 },
    { name: 'chronic fatigue', severity: 6 },
  ],
};
const afterPartial = deepMergeWorkingMemory(afterPopulate, symptomsUpdate);
assert(afterPartial['patientId'] === 'eds-01', '2a: patientId preserved after partial update');
assert(
  (afterPartial['demographics'] as ProfilePartial)?.['ageRange'] === '30-40',
  '2b: demographics preserved after partial update',
);
assert(
  Array.isArray(afterPartial['symptoms']) && (afterPartial['symptoms'] as unknown[]).length === 2,
  '2c: symptoms replaced with new array (2 items)',
);
assert(
  Array.isArray(afterPartial['hpoTerms']) && (afterPartial['hpoTerms'] as unknown[]).length === 1,
  '2d: hpoTerms preserved after partial update',
);

// --- Test 3: Arrays are REPLACED, not merged ---
const hpoUpdate: ProfilePartial = {
  hpoTerms: ['HP:0001382', 'HP:0003202', 'HP:0002758'],
};
const afterHpo = deepMergeWorkingMemory(afterPartial, hpoUpdate);
assert(
  Array.isArray(afterHpo['hpoTerms']) && (afterHpo['hpoTerms'] as unknown[]).length === 3,
  '3a: hpoTerms array entirely replaced (3 items)',
);
assert(afterHpo['patientId'] === 'eds-01', '3b: patientId still preserved');

// --- Test 4: Nested objects are recursively merged ---
const demoUpdate: ProfilePartial = {
  demographics: { ethnicity: 'European' },
};
const afterDemo = deepMergeWorkingMemory(afterHpo, demoUpdate);
const demo = afterDemo['demographics'] as ProfilePartial;
assert(demo?.['ageRange'] === '30-40', '4a: demographics.ageRange preserved (recursive merge)');
assert(demo?.['sex'] === 'female', '4b: demographics.sex preserved (recursive merge)');
assert(demo?.['ethnicity'] === 'European', '4c: demographics.ethnicity added (recursive merge)');

// --- Test 5: Setting a field to null removes it ---
const removeUpdate: ProfilePartial = { pendingTests: null };
const withPending = deepMergeWorkingMemory(afterDemo, { pendingTests: ['genetic panel'] });
assert(
  Array.isArray(withPending['pendingTests']) && (withPending['pendingTests'] as unknown[]).length === 1,
  '5a: pendingTests added',
);
const afterRemove = deepMergeWorkingMemory(withPending, removeUpdate);
assert(afterRemove['pendingTests'] === undefined, '5b: pendingTests removed via null');
assert(afterRemove['patientId'] === 'eds-01', '5c: patientId still preserved after null removal');

// --- Test 6: Empty update preserves everything ---
const afterEmpty = deepMergeWorkingMemory(afterRemove, {});
assert(afterEmpty['patientId'] === 'eds-01', '6a: empty update preserves all fields');
assert(
  Array.isArray(afterEmpty['symptoms']) && (afterEmpty['symptoms'] as unknown[]).length === 2,
  '6b: symptoms array preserved after empty update',
);

// --- Test 7: Nested diagnoses merge ---
const diagnosesUpdate1: ProfilePartial = {
  diagnoses: { suspected: ['Ehlers-Danlos Syndrome'] },
};
const afterDiag1 = deepMergeWorkingMemory(afterEmpty, diagnosesUpdate1);
const diag1 = afterDiag1['diagnoses'] as ProfilePartial;
assert(
  Array.isArray(diag1?.['suspected']) && (diag1['suspected'] as unknown[]).length === 1,
  '7a: diagnoses.suspected added',
);

const diagnosesUpdate2: ProfilePartial = {
  diagnoses: { confirmed: ['hEDS'] },
};
const afterDiag2 = deepMergeWorkingMemory(afterDiag1, diagnosesUpdate2);
const diag2 = afterDiag2['diagnoses'] as ProfilePartial;
assert(
  Array.isArray(diag2?.['confirmed']) && (diag2['confirmed'] as unknown[]).length === 1,
  '7b: diagnoses.confirmed added via recursive merge',
);
assert(
  Array.isArray(diag2?.['suspected']) && (diag2['suspected'] as unknown[]).length === 1,
  '7c: diagnoses.suspected preserved via recursive merge',
);

console.log('\n--- Summary ---');
console.log('Working memory merge semantics for PatientProfile:');
console.log('  • Partial updates preserve all existing fields');
console.log('  • Arrays (symptoms, hpoTerms, medications, hypotheses) are REPLACED entirely');
console.log('  • Nested objects (demographics, diagnoses) are RECURSIVELY MERGED');
console.log('  • Setting a field to null REMOVES it');
console.log('  • Empty updates are no-ops');
console.log(
  '\nIMPLICATION: When updating arrays, always send the FULL array content.',
);
console.log(
  'When updating nested objects, only send changed sub-fields.',
);
