/**
 * Specialty normalizer — maps variant specialty names to canonical forms.
 *
 * Canonical names are SNOMED CT-aligned but stored as human-readable
 * lowercase strings (not SNOMED codes) for simplicity.
 *
 * Handles:
 *  - Case normalization: "Neurology" → "neurology"
 *  - Synonym resolution: "Cardiovascular Medicine" → "cardiology"
 *  - Polish → English: "laryngologia" → "otolaryngology"
 *  - Compound names: "Psychiatry and Psychology" → "psychiatry"
 *  - Institution-specific names: "Laboratory Medicine and Pathology, Mayo Building," → "pathology"
 */

/** Canonical specialty values — SNOMED CT-aligned categories */
export type CanonicalSpecialty =
  | 'neurology'
  | 'neurosurgery'
  | 'cardiology'
  | 'rheumatology'
  | 'psychiatry'
  | 'pain_medicine'
  | 'physical_medicine'
  | 'otolaryngology'
  | 'ophthalmology'
  | 'immunology'
  | 'gastroenterology'
  | 'endocrinology'
  | 'pathology'
  | 'neurophysiology'
  | 'orthodontics'
  | 'dentistry'
  | 'radiology'
  | 'sleep_medicine'
  | 'orthopedics'
  | 'general_medicine'
  | 'nuclear_medicine'
  | 'other';

/**
 * Pattern-based normalization: each entry is [regex, canonicalSpecialty].
 * Checked in order — first match wins.
 * More specific patterns must come before broader ones.
 */
const SPECIALTY_PATTERNS: Array<[RegExp, CanonicalSpecialty]> = [
  // Neurosurgery must come before neurology
  [/neuro(?:chirurg|surg)/i, 'neurosurgery'],
  [/neurophysiol|EMG.*(?:nerve|conduction)|nerve\s*conduction/i, 'neurophysiology'],
  [/neurology|neurolog/i, 'neurology'],

  // Cardiology variants
  [/cardiovascular\s*medicine|cardiol|kardiolog/i, 'cardiology'],

  // Psychiatry variants
  [/psychiatr.*(?:and|&).*psychol|psychiatr|psychiatria/i, 'psychiatry'],

  // Pain medicine (before general medicine)
  [
    /orofacial\s*pain|trigeminal\s*pain|pain[_\s](?:manag|medic)|leczenia\s*b[oó]lu/i,
    'pain_medicine',
  ],

  // Physical medicine / rehabilitation
  [/physical\s*medicine|rehabilitation|rehabilitac/i, 'physical_medicine'],

  // ENT
  [/otolaryngol|laryngol|ENT/i, 'otolaryngology'],

  // Ophthalmology
  [/ophthalmol|okulist/i, 'ophthalmology'],

  // Immunology
  [/immunol/i, 'immunology'],

  // Gastroenterology
  [/gastroenterol|gastro/i, 'gastroenterology'],

  // Endocrinology
  [/endocrinol|endokryno/i, 'endocrinology'],

  // Pathology / lab medicine
  [/pathol|laboratory\s*medicine/i, 'pathology'],

  // Orthodontics (before dentistry)
  [/orthodont|ortodont/i, 'orthodontics'],
  [/dentist|stomat/i, 'dentistry'],

  // Radiology / imaging
  [/radiol|ultrasound|USG/i, 'radiology'],

  // Sleep medicine
  [/sleep[_\s]medicine|polisom/i, 'sleep_medicine'],

  // Rheumatology
  [/rheumatol|reumatol/i, 'rheumatology'],

  // Nuclear medicine
  [/nuclear\s*medic|scintigr|scyntygraf/i, 'nuclear_medicine'],

  // Orthopedics
  [/orthoped|ortoped/i, 'orthopedics'],

  // General / discharge — catch near the end
  [/general[_\s]medicine|discharge[_\s]summary|epikryza/i, 'general_medicine'],
];

/**
 * Normalize a specialty string to its canonical form.
 *
 * Returns the original value lowercased if no pattern matches and it's
 * not "other" / "Unknown" / empty.
 */
export function normalizeSpecialty(raw: string): CanonicalSpecialty {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'Unknown') return 'other';

  for (const [pattern, canonical] of SPECIALTY_PATTERNS) {
    if (pattern.test(trimmed)) return canonical;
  }

  // If it's already a known canonical value, return it
  const lower = trimmed.toLowerCase();
  const knownValues: ReadonlySet<string> = new Set([
    'neurology',
    'neurosurgery',
    'cardiology',
    'rheumatology',
    'psychiatry',
    'pain_medicine',
    'physical_medicine',
    'otolaryngology',
    'ophthalmology',
    'immunology',
    'gastroenterology',
    'endocrinology',
    'pathology',
    'neurophysiology',
    'orthodontics',
    'dentistry',
    'radiology',
    'sleep_medicine',
    'orthopedics',
    'general_medicine',
    'nuclear_medicine',
  ]);
  if (knownValues.has(lower)) return lower as CanonicalSpecialty;

  return 'other';
}
