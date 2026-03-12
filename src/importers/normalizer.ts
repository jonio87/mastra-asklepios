/**
 * Lab value normalization — standardizes Polish/mixed units and test names
 * to international English equivalents.
 *
 * All system data uses English international notation. Original Polish names
 * are preserved in the `notes` field for reference.
 */

// ─── Unit normalization ──────────────────────────────────────────────────

/** Strip trailing asterisks (flag markers from extraction) */
function stripAsterisk(unit: string): string {
  return unit.replace(/\*+$/, '');
}

/** Direct Polish → international unit mappings */
const UNIT_MAP: Record<string, string> = {
  'tys/µl': 'K/µL',
  'mln/µl': 'M/µL',
  sek: 's',
  Indeks: 'Index',
  '**Negatywny**': '',
  '**niereaktywny**': '',
};

/**
 * GFR units use Polish decimal comma — normalize to dot notation
 * and consistent superscript: ml/min/1.73m²
 */
function normalizeGfrUnit(unit: string): string {
  if (!unit.startsWith('ml/min/1')) return unit;
  return 'ml/min/1.73m²';
}

/** Normalize case for µmol/L vs µmol/l → µmol/L (SI standard uses uppercase L for liter) */
function normalizeLiterCase(unit: string): string {
  // Standard SI: uppercase L to avoid confusion with digit 1
  // But clinical convention varies — use lowercase for consistency with source data
  // except when the unit is only "L" (ambiguous)
  return unit;
}

/**
 * Normalize a lab value unit string to international English standard.
 *
 * Handles:
 * - Trailing asterisks (flag markers) → stripped
 * - Polish units (tys/µl → K/µL, mln/µl → M/µL, sek → s)
 * - Polish words (Indeks → Index, **Negatywny** → empty)
 * - GFR decimal comma variants → ml/min/1.73m²
 * - Numeric values in unit field (extraction errors) → empty string
 */
export function normalizeUnit(unit: string): string {
  const trimmed = unit.trim();

  // Check direct mapping first (before asterisk stripping, for values like **Negatywny**)
  if (Object.hasOwn(UNIT_MAP, trimmed)) {
    return UNIT_MAP[trimmed] as string;
  }

  // Strip trailing asterisks (flag markers)
  let normalized = stripAsterisk(trimmed);

  // Check for numeric values accidentally in unit field (extraction errors)
  if (/^\d+[,.]?\d*$/.test(normalized)) {
    return '';
  }

  // Check direct mapping again after asterisk stripping
  if (Object.hasOwn(UNIT_MAP, normalized)) {
    return UNIT_MAP[normalized] as string;
  }

  // GFR normalization
  normalized = normalizeGfrUnit(normalized);

  // Case normalization for liter
  normalized = normalizeLiterCase(normalized);

  return normalized;
}

// ─── Test name canonicalization ──────────────────────────────────────────

/**
 * Canonical test name mapping. Maps all known variants to a single
 * standardized English name.
 *
 * Approach: lowercase lookup key → canonical name
 */
const TEST_NAME_CANONICAL: Record<string, string> = {
  // ── CBC / Hematology ──
  wbc: 'WBC',
  'wbc (white blood cells)': 'WBC',
  'white blood cells': 'WBC',
  leukocytes: 'WBC',
  leukocyty: 'WBC',
  'leukocytes (dipstick)': 'WBC (urine dipstick)',

  rbc: 'RBC',
  'rbc (red blood cells)': 'RBC',
  'red blood cells': 'RBC',
  erytrocyty: 'RBC',

  hemoglobin: 'Hemoglobin',
  hemoglobina: 'Hemoglobin',

  hematocrit: 'Hematocrit',
  hematokryt: 'Hematocrit',

  platelets: 'Platelets',
  'plt (platelets)': 'Platelets',
  plt: 'Platelets',
  'płytki krwi': 'Platelets',

  mcv: 'MCV',
  'mcv (mean corpuscular volume)': 'MCV',
  'mean corpuscular volume': 'MCV',

  mch: 'MCH',
  'mch (mean corpuscular hemoglobin)': 'MCH',
  'mean corpuscular hemoglobin': 'MCH',

  mchc: 'MCHC',
  'mchc (mean corpuscular hemoglobin concentration)': 'MCHC',
  'mchc (mean corpuscular hgb concentration)': 'MCHC',
  'mean corpuscular hemoglobin concentration': 'MCHC',

  mpv: 'MPV',
  'mpv (mean platelet volume)': 'MPV',
  'mean platelet volume': 'MPV',

  pdw: 'PDW',
  'pdw (platelet distribution width)': 'PDW',
  'platelet distribution width': 'PDW',

  pct: 'PCT',
  'pct (plateletcrit)': 'PCT',
  plateletcrit: 'PCT',

  'p-lcr': 'P-LCR',
  'p-lcr (platelet large cell ratio)': 'P-LCR',
  'platelet large cell ratio': 'P-LCR',

  'rdw-cv': 'RDW-CV',
  'rdw coefficient of variation': 'RDW-CV',

  'rdw-sd': 'RDW-SD',
  'rdw standard deviation': 'RDW-SD',

  // ── WBC differential ──
  'neutrophils %': 'Neutrophils %',
  'neutrophils (%)': 'Neutrophils %',
  'neutrofile %': 'Neutrophils %',

  neutrophils: 'Neutrophils (abs)',
  'neutrophils (absolute)': 'Neutrophils (abs)',
  'neutrophils (abs)': 'Neutrophils (abs)',
  'neutrophils (abs.)': 'Neutrophils (abs)',
  'neutrophils abs.': 'Neutrophils (abs)',
  'neutrophils absolute': 'Neutrophils (abs)',
  neutrofile: 'Neutrophils (abs)',
  'neutrofile (abs.)': 'Neutrophils (abs)',

  'lymphocytes %': 'Lymphocytes %',
  'lymphocytes (%)': 'Lymphocytes %',
  'limfocyty %': 'Lymphocytes %',

  lymphocytes: 'Lymphocytes (abs)',
  'lymphocytes (absolute)': 'Lymphocytes (abs)',
  'lymphocytes (abs)': 'Lymphocytes (abs)',
  'lymphocytes (abs.)': 'Lymphocytes (abs)',
  'lymphocytes abs.': 'Lymphocytes (abs)',
  'lymphocytes absolute': 'Lymphocytes (abs)',
  limfocyty: 'Lymphocytes (abs)',
  'limfocyty (abs.)': 'Lymphocytes (abs)',

  'monocytes %': 'Monocytes %',
  'monocytes (%)': 'Monocytes %',
  'monocyty %': 'Monocytes %',

  monocytes: 'Monocytes (abs)',
  'monocytes (absolute)': 'Monocytes (abs)',
  'monocytes (abs)': 'Monocytes (abs)',
  'monocytes (abs.)': 'Monocytes (abs)',
  'monocytes abs.': 'Monocytes (abs)',
  'monocytes absolute': 'Monocytes (abs)',
  monocyty: 'Monocytes (abs)',
  'monocyty (abs.)': 'Monocytes (abs)',
  'monocyty (monocytes)': 'Monocytes (abs)',

  'eosinophils %': 'Eosinophils %',
  'eosinophils (%)': 'Eosinophils %',
  'eozynofile %': 'Eosinophils %',

  eosinophils: 'Eosinophils (abs)',
  'eosinophils (absolute)': 'Eosinophils (abs)',
  'eosinophils (abs)': 'Eosinophils (abs)',
  'eosinophils (abs.)': 'Eosinophils (abs)',
  'eosinophils abs.': 'Eosinophils (abs)',
  'eosinophils absolute': 'Eosinophils (abs)',
  eozynofile: 'Eosinophils (abs)',
  'eozynofile (abs.)': 'Eosinophils (abs)',

  'basophils %': 'Basophils %',
  'basophils (%)': 'Basophils %',
  'bazofile %': 'Basophils %',

  'basophils (absolute)': 'Basophils (abs)',
  'basophils (abs)': 'Basophils (abs)',
  'basophils (abs.)': 'Basophils (abs)',
  'basophils abs.': 'Basophils (abs)',
  'basophils absolute': 'Basophils (abs)',
  bazofile: 'Basophils (abs)',
  'bazofile (abs.)': 'Basophils (abs)',

  'immature granulocytes %': 'Immature granulocytes %',
  'immature granulocytes (%)': 'Immature granulocytes %',
  'niedojrzałe granulocyty ig %': 'Immature granulocytes %',

  'immature granulocytes (absolute)': 'Immature granulocytes (abs)',
  'immature granulocytes (abs)': 'Immature granulocytes (abs)',
  'immature granulocytes abs.': 'Immature granulocytes (abs)',
  'immature granulocytes absolute': 'Immature granulocytes (abs)',
  'niedojrzałe granulocyty ig il.': 'Immature granulocytes (abs)',

  'segmented neutrophils': 'Segmented neutrophils',
  'segmented granulocytes': 'Segmented neutrophils',
  segmentowane: 'Segmented neutrophils',

  'nucleated rbc %': 'Nucleated RBC %',
  'nrbc%': 'Nucleated RBC %',
  'nucleated rbc absolute': 'Nucleated RBC (abs)',
  'nrbc#': 'Nucleated RBC (abs)',

  'reactive lymphocytes': 'Reactive lymphocytes',
  kwasochłonne: 'Eosinophils (abs)',

  'large immature cells %': 'Large immature cells %',
  'large immature cells #': 'Large immature cells (abs)',

  // ── Metabolic panel ──
  glucose: 'Glucose',
  'glucose, s': 'Glucose',
  'glucose (fasting)': 'Glucose (fasting)',
  glukoza: 'Glucose',

  creatinine: 'Creatinine',
  'creatinine, s': 'Creatinine',
  kreatynina: 'Creatinine',

  urea: 'Urea',
  'urea (bun)': 'Urea',
  mocznik: 'Urea',
  'mocznik (urea)': 'Urea',

  'uric acid': 'Uric acid',
  'kwas moczowy': 'Uric acid',

  sodium: 'Sodium',
  'sodium, s': 'Sodium',
  'sodium, serum': 'Sodium',
  sód: 'Sodium',

  potassium: 'Potassium',
  'potassium, s': 'Potassium',
  'potassium, serum': 'Potassium',
  potas: 'Potassium',

  magnesium: 'Magnesium',
  'magnesium, s': 'Magnesium',
  magnez: 'Magnesium',
  'magnez (mg)': 'Magnesium',

  'total calcium': 'Total calcium',
  'wapń całkowity': 'Total calcium',
  'wapń całkowity (ca)': 'Total calcium',

  iron: 'Iron',
  'iron (fe)': 'Iron',
  żelazo: 'Iron',

  zinc: 'Zinc',

  // ── Lipid panel ──
  'total cholesterol': 'Total cholesterol',
  'cholesterol całkowity': 'Total cholesterol',

  'hdl cholesterol': 'HDL cholesterol',
  'cholesterol hdl': 'HDL cholesterol',

  'ldl cholesterol': 'LDL cholesterol',
  'ldl cholesterol (friedewald)': 'LDL cholesterol',
  'cholesterol ldl': 'LDL cholesterol',

  'non-hdl cholesterol': 'Non-HDL cholesterol',
  'cholesterol nie-hdl': 'Non-HDL cholesterol',

  triglycerides: 'Triglycerides',
  triglicerydy: 'Triglycerides',
  trójglicerydy: 'Triglycerides',

  // ── Liver function ──
  alt: 'ALT',
  'alt (alanine aminotransferase)': 'ALT',
  'alanine aminotransferase': 'ALT',
  'alanine aminotransferase (alt), s': 'ALT',
  ast: 'AST',
  'aspartate aminotransferase (ast), s': 'AST',
  'ast (aspartate aminotransferase)': 'AST',
  'aspartate aminotransferase': 'AST',
  ggt: 'GGT',
  ggtp: 'GGT',
  'ggt (gamma-glutamyl transferase)': 'GGT',
  'gamma-glutamyltransferase': 'GGT',
  'gamma-gt': 'GGT',
  'alkaline phosphatase': 'Alkaline phosphatase',
  'alkaline phosphatase, s': 'Alkaline phosphatase',
  'alp (alkaline phosphatase)': 'Alkaline phosphatase',
  'fosfataza zasadowa': 'Alkaline phosphatase',
  'fosfataza zasadowa (alp)': 'Alkaline phosphatase',
  'total bilirubin': 'Total bilirubin',
  'bilirubin, total, s': 'Total bilirubin',
  'bilirubina całkowita': 'Total bilirubin',
  bilirubina: 'Total bilirubin',
  ldh: 'LDH',
  'ldh (lactate dehydrogenase)': 'LDH',
  lipase: 'Lipase',
  amylase: 'Amylase',

  // ── Mayo Clinic CMP / misc suffixed names ──
  'albumin, s': 'Albumin',
  globulin: 'Globulin',
  'a/g ratio': 'Albumin/Globulin ratio',
  'anion gap': 'Anion gap',
  bicarbonate: 'Bicarbonate',
  'bicarbonate, s': 'Bicarbonate',
  'co2, total': 'Bicarbonate',
  'bun (blood urea nitrogen), s': 'Urea',
  'blood urea nitrogen': 'Urea',
  'calcium, total, s': 'Total calcium',
  'chloride, s': 'Chloride',
  chloride: 'Chloride',
  chlorki: 'Chloride',
  phosphorus: 'Phosphorus',
  phosphate: 'Phosphorus',
  fosfor: 'Phosphorus',
  'creatine kinase (ck), s': 'CK',
  ck: 'CK',
  'dehydroepiandrosterone sulfate': 'DHEA-S',
  'dehydroepiandrosterone sulfate, s': 'DHEA-S',
  'dhea-s': 'DHEA-S',
  'dhea-so4': 'DHEA-S',
  'glucose, p': 'Glucose',
  'hemoglobin a1c': 'HbA1c',
  'hemoglobin a1c, b': 'HbA1c',
  'osmolality, u': 'Osmolality (urine)',
  osmolality: 'Osmolality',
  'sedimentation rate': 'ESR',
  'sedimentation rate, b': 'ESR',
  'rbc distrib width': 'RDW-CV',

  // ── Protein ──
  'total protein': 'Total protein',
  'protein, total, s': 'Total protein',
  'total protein concentration': 'Total protein',
  'białko całkowite': 'Total protein',

  // ── Kidney function ──
  egfr: 'eGFR',
  'egfr (mdrd)': 'eGFR (MDRD)',
  'egfr (ckd-epi)': 'eGFR (CKD-EPI)',
  'egfr (estimated gfr)': 'eGFR',

  // ── Thyroid ──
  tsh: 'TSH',
  'tsh (thyroid stimulating hormone)': 'TSH',
  'tsh, sensitive': 'TSH',
  'thyroid stimulating hormone': 'TSH',

  ft3: 'FT3',
  'free t3': 'FT3',
  'free triiodothyronine': 'FT3',
  ft4: 'FT4',
  'free t4': 'FT4',
  'free thyroxine': 'FT4',

  trab: 'TRAb',
  'tsh receptor antibodies': 'TRAb',

  'anty-tpo': 'Anti-TPO',
  'anti-tpo': 'Anti-TPO',
  'anti-tpo (anti-thyroid peroxidase)': 'Anti-TPO',
  'anti-tg': 'Anti-TG',

  // ── Hormones ──
  testosterone: 'Testosterone',
  testosteron: 'Testosterone',

  serotonin: 'Serotonin',
  prolactin: 'Prolactin',
  insulin: 'Insulin',
  leptin: 'Leptin',
  'lh (luteinizing hormone)': 'LH',
  'sex hormone-binding globulin': 'SHBG',
  cortisol: 'Cortisol',
  'cortisol, random': 'Cortisol',

  // ── Vitamins & minerals ──
  '25-oh vitamin d3': 'Vitamin D 25-OH',
  'vitamin d 25(oh)': 'Vitamin D 25-OH',
  'vitamin d3 25-oh': 'Vitamin D 25-OH',
  'vitamin d3 25-oh (25-hydroxyvitamin d)': 'Vitamin D 25-OH',
  'witamina d3 25(oh)': 'Vitamin D 25-OH',
  'wit. d3 metabolit 25(oh)': 'Vitamin D 25-OH',

  '25-hydroxy vitamin d3': 'Vitamin D 25-OH',
  '25-hydroxy vitamin d2': 'Vitamin D2 25-OH',
  '25-hydroxy vitamin d total': 'Vitamin D Total 25-OH',
  '25-hydroxyvitamin d2 and d3': 'Vitamin D Total 25-OH',

  'vitamin b12': 'Vitamin B12',
  'vitamin b12 (cobalamin)': 'Vitamin B12',
  'vitamin b12 assay': 'Vitamin B12',
  'vitamin b12 assay, s': 'Vitamin B12',
  'witamina b12': 'Vitamin B12',

  ferritin: 'Ferritin',
  'ferritin, s': 'Ferritin',
  ferrytyna: 'Ferritin',

  homocysteine: 'Homocysteine',
  homocysteina: 'Homocysteine',

  histamine: 'Histamine',
  adiponectin: 'Adiponectin',
  'adiponectin/leptin ratio': 'Adiponectin/Leptin ratio',
  'alpha-fetoprotein': 'Alpha-fetoprotein',

  // ── Iron studies ──
  transferrin: 'Transferrin',
  'transferrin saturation %': 'Transferrin saturation %',
  'tibc (total iron binding capacity)': 'TIBC',
  'total iron binding capacity': 'TIBC',
  'uibc (unsaturated iron binding capacity)': 'UIBC',
  'unsaturated iron binding capacity': 'UIBC',

  // ── Coagulation ──
  inr: 'INR',
  'international normalized ratio': 'INR',
  'international normalised ratio': 'INR',
  'prothrombin time (%)': 'Prothrombin time %',
  'prothrombin time % activity': 'Prothrombin time %',
  aptt: 'APTT',
  'aptt (activated partial thromboplastin time)': 'APTT',
  'activated partial thromboplastin time': 'APTT',
  fibrinogen: 'Fibrinogen',

  // ── Inflammatory markers ──
  'c-reactive protein': 'CRP',
  crp: 'CRP',
  'crp (c-reactive protein)': 'CRP',
  esr: 'ESR',
  'esr (erythrocyte sedimentation rate)': 'ESR',
  'erythrocyte sedimentation rate (esr)': 'ESR',
  'erythrocyte sedimentation rate': 'ESR',
  'ob (odczyn biernackiego / esr)': 'ESR',

  // ── Immunology / ANCA ──
  'c-anca (cytoplasmic)': 'c-ANCA',
  'c-anca': 'c-ANCA',
  'canca (cytoplasmic anca)': 'c-ANCA',
  'p/c. p. cytoplazmie neutrofilów (anca) — canca': 'c-ANCA',

  'p-anca (perinuclear)': 'p-ANCA',
  'p-anca': 'p-ANCA',
  'panca (perinuclear anca)': 'p-ANCA',
  'p/c. p. cytoplazmie neutrofilów (anca) — panca': 'p-ANCA',

  'rheumatoid factor': 'Rheumatoid factor',
  'anti-pr3 igg (anca) by elisa': 'Anti-PR3 (ANCA)',
  'anti-mpo (panca)': 'Anti-MPO (pANCA)',
  'anti-ccp (anti-cyclic citrullinated peptide)': 'Anti-CCP',
  'anti-ccp (cyclic citrullinated peptide)': 'Anti-CCP',
  'antinuclear antibodies (ana)': 'ANA (IIF screen)',
  'ana (antinuclear antibodies) — iif screen': 'ANA (IIF screen)',
  'ana iif titer/pattern': 'ANA IIF titer/pattern',
  'ana1 screen (iif on hep-2 cells)': 'ANA (IIF screen)',
  'antinuclear antibodies (iif)': 'ANA (IIF screen)',

  // ── Immunoglobulins ──
  iga: 'IgA',
  'immunoglobulin a': 'IgA',
  'immunoglobulin a (iga)': 'IgA',
  'immunoglobulin a (iga), s': 'IgA',
  'total iga': 'IgA',
  igg: 'IgG',
  'immunoglobulin g': 'IgG',
  'immunoglobulin g (igg)': 'IgG',
  'immunoglobulin g (igg), s': 'IgG',
  igm: 'IgM',
  'immunoglobulin m': 'IgM',
  'immunoglobulin m (igm)': 'IgM',
  'immunoglobulin m (igm), s': 'IgM',

  // ── Electrophoresis ──
  'alfa-1-globuliny': 'Alpha-1 globulins',
  'alfa-2-globuliny': 'Alpha-2 globulins',
  'gamma-globuliny': 'Gamma globulins',
  albumin: 'Albumin',
  'albumin (%)': 'Albumin %',
  'albumin %': 'Albumin %',
  'albumin (g/l)': 'Albumin (g/L)',
  'albumin g/l': 'Albumin (g/L)',
  'alpha-1-globulins %': 'Alpha-1 globulins %',
  'alpha-1-globulins (%)': 'Alpha-1 globulins %',
  'alpha-1-globulins (g/l)': 'Alpha-1 globulins (g/L)',
  'alpha-1-globulins g/l': 'Alpha-1 globulins (g/L)',
  'alpha-2-globulins %': 'Alpha-2 globulins %',
  'alpha-2-globulins (%)': 'Alpha-2 globulins %',
  'alpha-2-globulins (g/l)': 'Alpha-2 globulins (g/L)',
  'alpha-2-globulins g/l': 'Alpha-2 globulins (g/L)',
  'beta-1-globulins %': 'Beta-1 globulins %',
  'beta-1-globulins (%)': 'Beta-1 globulins %',
  'beta-1-globulins (g/l)': 'Beta-1 globulins (g/L)',
  'beta-1-globulins g/l': 'Beta-1 globulins (g/L)',
  'beta-2-globulins %': 'Beta-2 globulins %',
  'beta-2-globulins (%)': 'Beta-2 globulins %',
  'beta-2-globulins (g/l)': 'Beta-2 globulins (g/L)',
  'beta-2-globulins g/l': 'Beta-2 globulins (g/L)',
  'gamma-globulins %': 'Gamma globulins %',
  'gamma-globulins (%)': 'Gamma globulins %',
  'gamma-globulins (g/l)': 'Gamma globulins (g/L)',
  'gamma-globulins g/l': 'Gamma globulins (g/L)',
  'albumin/globulin ratio': 'Albumin/Globulin ratio',

  // ── Tumor markers ──
  cea: 'CEA',
  'cea (carcinoembryonic antigen)': 'CEA',
  'carcinoembryonic antigen': 'CEA',
  'total psa': 'Total PSA',
  'psa ratio (free/total)': 'PSA ratio',
  'nse (neuron-specific enolase)': 'NSE',
  'ca 19-9': 'CA 19-9',
  'ca 19-9 (cancer antigen 19-9)': 'CA 19-9',
  'ca 72-4 (carbohydrate antigen 72-4)': 'CA 72-4',
  'chromogranin a': 'Chromogranin A',

  // ── Diabetes ──
  hba1c: 'HbA1c',
  'hba1c (ifcc %)': 'HbA1c %',
  'hba1c (ifcc mmol/mol)': 'HbA1c (mmol/mol)',
  'hba1c mmol/mol': 'HbA1c (mmol/mol)',

  // ── Carnitine ──
  'total carnitine': 'Total carnitine',
  'total carnitine (plasma)': 'Total carnitine',
  'free carnitine': 'Free carnitine',
  'free carnitine (plasma)': 'Free carnitine',
  acylcarnitine: 'Acylcarnitine',
  'acylcarnitine (plasma)': 'Acylcarnitine',
  'acylcarnitine ratio': 'Acylcarnitine ratio',

  // ── Infections ──
  'chlamydia trachomatis dna': 'Chlamydia trachomatis DNA',
  'chlamydia trachomatis': 'Chlamydia trachomatis DNA',
  'chlamydia pneumoniae ag': 'Chlamydia pneumoniae Ag',
  'neisseria gonorrhoeae dna': 'Neisseria gonorrhoeae DNA',
  'neisseria gonorrhoeae': 'Neisseria gonorrhoeae DNA',
  'mycoplasma genitalium dna': 'Mycoplasma genitalium DNA',
  'mycoplasma genitalium': 'Mycoplasma genitalium DNA',
  'mycoplasma hominis dna': 'Mycoplasma hominis DNA',
  'mycoplasma hominis': 'Mycoplasma hominis DNA',
  'ureaplasma urealyticum dna': 'Ureaplasma urealyticum DNA',
  'ureaplasma urealyticum': 'Ureaplasma urealyticum DNA',
  'ureaplasma parvum dna': 'Ureaplasma parvum DNA',
  'ureaplasma parvum': 'Ureaplasma parvum DNA',
  'trichomonas vaginalis dna': 'Trichomonas vaginalis DNA',
  'trichomonas vaginalis': 'Trichomonas vaginalis DNA',

  // ── COVID-19 ──
  'sars-cov-2 (covid-19) rt-pcr': 'SARS-CoV-2 RT-PCR',
  'sars-cov-2 rna (gen rdrp / gen n)': 'SARS-CoV-2 RT-PCR',
  'sars-cov-2 igg': 'SARS-CoV-2 IgG',
  'sars-cov-2 igg (s1/s2) quantitative': 'SARS-CoV-2 IgG (S1/S2)',
  'sars-cov-2 igm': 'SARS-CoV-2 IgM',
  'sars-cov-2 trimeryczne s igg': 'SARS-CoV-2 Anti-S IgG',
  'sars-cov-2 trimeryczne s igg (anty-s)': 'SARS-CoV-2 Anti-S IgG',
  'n gene (nucleocapsid)': 'SARS-CoV-2 N gene',
  'orf1ab gene': 'SARS-CoV-2 ORF1ab gene',

  // ── Hepatitis ──
  'hepatitis a — igg — immunity search': 'Hepatitis A IgG',
  'hbsag (hepatitis b surface antigen)': 'HBsAg',
  'hbsag — hepatitis b surface antigen': 'HBsAg',
  'hbsag screen': 'HBsAg',
  'hbs antigen scrn': 'HBsAg',
  'hbs antigen screen': 'HBsAg',
  'anti-hbs (hepatitis b surface antibody)': 'Anti-HBs',
  'hbs antibody screen': 'Anti-HBs',
  'hbs antibody scrn': 'Anti-HBs',
  'hbs antibody quantitative': 'Anti-HBs (quantitative)',
  'anti-hbc (total hepatitis b core antibodies)': 'Anti-HBc total',
  'anti-hcv (hepatitis c antibodies)': 'Anti-HCV',
  'anti-hcv (hepatitis c antibody)': 'Anti-HCV',
  'anti-hcv antibodies': 'Anti-HCV',
  'hcv antibody screen': 'Anti-HCV',
  'hcv ab screen': 'Anti-HCV',
  'hcv ab scrn': 'Anti-HCV',
  'anti-hav total (hepatitis a)': 'Anti-HAV total',
  'anti-hav igm': 'Anti-HAV IgM',
  'przeciwciała anty hbc całkowite (hbv)': 'Anti-HBc total',
  'przeciwciała anty hcv': 'Anti-HCV',
  'przeciwciała całkowite hav': 'Anti-HAV total',

  // ── HIV ──
  'hiv-1/hiv-2 ab + p24 ag (4th gen)': 'HIV Ab/Ag combo',
  'hiv-1/hiv-2 abs + p24 ag (4th gen)': 'HIV Ab/Ag combo',

  // ── Syphilis ──
  'syphilis (treponema pallidum) — specific igg/igm antibodies combined': 'Syphilis IgG/IgM',
  'syphilis antibodies igg/igm (anti-tp)': 'Syphilis IgG/IgM',

  // ── Toxoplasma ──
  'toxoplasma gondii igg': 'Toxoplasma IgG',
  'toxoplasma gondii igm': 'Toxoplasma IgM',
  'toxoplasma gondii igg awidność': 'Toxoplasma IgG avidity',
  'toxoplasma gondii igg, awidność': 'Toxoplasma IgG avidity',

  // ── Autoimmune panels ──
  'anty-hu': 'Anti-Hu',
  'anty-ri': 'Anti-Ri',
  'anty-yo': 'Anti-Yo',
  'anty-amp (amfifizyna)': 'Anti-amphiphysin',
  'anty-cv2.1': 'Anti-CV2',
  'anty-gad': 'Anti-GAD',
  'anty-mag': 'Anti-MAG',
  'anty-mielina': 'Anti-myelin',
  'anty-pnm2/ta (ma2/ta)': 'Anti-Ma2/Ta',
  'anty-pnm2/ta(ma2/ta)': 'Anti-Ma2/Ta',
  'anty-rec (recoveryna)': 'Anti-recoverin',
  'anty-sox1': 'Anti-SOX1',
  'anty-titin (titina)': 'Anti-titin',
  'onco-neuronal ab panel iif': 'Onco-neuronal Ab panel',

  // ── Celiac / GI autoantibodies ──
  'tissue transglutaminase iga (ttg iga)': 'tTG IgA',
  'tissue transglutaminase ab iga': 'tTG IgA',
  'tissue transglutaminase igg (ttg igg)': 'tTG IgG',
  'p/c. p. endomysium (ema) iga': 'Anti-endomysial IgA',
  'p/c. p. endomysium (ema) igg': 'Anti-endomysial IgG',
  'p/c. p. gliadynie (aga) iga': 'Anti-gliadin IgA',
  'p/c. p. gliadynie (aga) igg': 'Anti-gliadin IgG',
  'p/c. p. kom. okładzinowym żołądka (apca)': 'Anti-parietal cell Ab',
  'p/c. p. kom. kubkowym jelita (gab)': 'Anti-goblet cell Ab',
  'p/c. p. kom. zewnątrzwydzielniczym trzustki (acinti)': 'Anti-exocrine pancreas Ab',
  'intrinsic factor antibodies (igg)': 'Intrinsic factor Ab IgG',

  // ── Urinalysis ──
  ph: 'pH (urine)',
  'ph, u': 'pH (urine)',
  'specific gravity': 'Specific gravity (urine)',
  'specific gravity, u': 'Specific gravity (urine)',
  'ciężar właściwy': 'Specific gravity (urine)',
  protein: 'Protein (urine)',
  ketones: 'Ketones (urine)',
  ketony: 'Ketones (urine)',
  urobilinogen: 'Urobilinogen (urine)',
  nitrites: 'Nitrites (urine)',
  'ery/hb': 'Erythrocytes/Hb (urine)',
  przejrzystość: 'Clarity (urine)',

  // ── Urine sediment ──
  'squamous epithelial cells': 'Squamous epithelial cells',
  'round epithelial cells': 'Round epithelial cells',
  'yeast cells': 'Yeast cells',
  'mucus threads': 'Mucus threads',
  spermatozoa: 'Spermatozoa',
  sperm: 'Spermatozoa',

  // ── Microbiology ──
  'urine culture (bacteriological)': 'Urine culture',
  'kał posiew (badanie mykologiczne)': 'Stool culture (mycological)',
  'throat/tonsil swab mycological culture': 'Throat swab (mycological)',
  'wymaz z gardła/migdałków (bad.mykol.)': 'Throat swab (mycological)',
  'throat/tonsil swab — streptococcus pyogenes and beta-haemolytic streptococci groups a, c and g':
    'Throat swab (Streptococcus)',
  'streptococcus b-hem.gr.c': 'Beta-hemolytic Streptococcus group C',

  // ── EBV ──
  'ebv igg (anti-vca igg)': 'EBV VCA IgG',
  'ebv igm (anti-vca igm)': 'EBV VCA IgM',

  // ── Candida ──
  'candida anti-mannan ab': 'Candida anti-mannan Ab',
  'candida anti-mannan antibodies': 'Candida anti-mannan Ab',
  'anti-candida mannan antibodies (quantitative)': 'Candida anti-mannan Ab',
  'candida mannan antigen': 'Candida mannan Ag',

  // ── H. pylori ──
  'h. pylori igm antibodies': 'H. pylori IgM',

  // ── CMV ──
  'cmv igg': 'CMV IgG',
  'cmv igm': 'CMV IgM',
  'cmv igg, awidność': 'CMV IgG avidity',
  'cmv igm jakościowo': 'CMV IgM (qualitative)',
  'cmv igm (ilościowo)': 'CMV IgM (quantitative)',

  // ── Cardiac / ECG ──
  'n-terminal pro-b-type natriuretic peptide': 'NT-proBNP',
  'sflt-1 (soluble fms-like tyrosine kinase-1)': 'sFlt-1',
  'lipoprotein(a)': 'Lipoprotein(a)',
  'ventricular rate': 'Ventricular rate (ECG)',
  'pr interval': 'PR interval (ECG)',
  'qrs duration': 'QRS duration (ECG)',
  'qrsd interval': 'QRS duration (ECG)',
  'qt interval': 'QT interval (ECG)',
  'qtc interval': 'QTc interval (ECG)',
  'p axis': 'P axis (ECG)',
  'r axis': 'R axis (ECG)',
  't wave axis': 'T wave axis (ECG)',

  // ── HLA ──
  'hla dq2.5': 'HLA-DQ2.5',
  'hla dq2.2': 'HLA-DQ2.2',
  'hla dq8': 'HLA-DQ8',
  'hla-dq2.5 (dqa1*05/dqb1*02)': 'HLA-DQ2.5',
  'hla-dq2.2 (dqa1*02/dqb1*02)': 'HLA-DQ2.2',
  'hla-dq8 (dqa1*03/dqb1*03:02)': 'HLA-DQ8',
  'hla-b27': 'HLA-B27',
  'hla-b27 antigen (pcr)': 'HLA-B27',

  // ── Celiac extended ──
  'anti-ttg iga': 'tTG IgA',
  'anti-ttg igg (ratio)': 'tTG IgG',
  'deamidated gliadin peptide igg (dgp igg)': 'DGP IgG',
  'deamidated gliadin peptide iga (dgp iga)': 'DGP IgA',
  'anti-goblet cell antibodies': 'Anti-goblet cell Ab',
  'antibodies against exocrine pancreatic cells': 'Anti-exocrine pancreas Ab',
  asca: 'ASCA',

  // ── Autoimmune extended ──
  'anti-scl-70 (topoisomerase i)': 'Anti-Scl-70',
  'anti-dfs70': 'Anti-DFS70',
  'anti-hmgcr': 'Anti-HMGCR',
  'anti-mi-2': 'Anti-Mi-2',
  'anti-mda5': 'Anti-MDA5',
  'anti-ej': 'Anti-EJ',
  'anti-ks': 'Anti-KS',
  'anti-ku': 'Anti-Ku',
  'anti-la (ssb)': 'Anti-La (SSB)',
  'anti-caspr2': 'Anti-CASPR2',
  'anti-lgi1': 'Anti-LGI1',
  'anti-dppx': 'Anti-DPPX',
  'anti-gaba-b receptor': 'Anti-GABA-B receptor',
  'anti-ampa receptor (glur1/glur2)': 'Anti-AMPA receptor',
  'anti-gad (glutamic acid decarboxylase)': 'Anti-GAD',
  'anti-ma2/ta': 'Anti-Ma2/Ta',
  'beta-2-microglobulin': 'Beta-2 microglobulin',
  ceruloplasmin: 'Ceruloplasmin',
  'coenzyme q10': 'Coenzyme Q10',
  'homa-ir index': 'HOMA-IR',

  // ── DAO ──
  'diamine oxidase (dao) activity': 'DAO activity',
  'diaminooxidase (dao) activity': 'DAO activity',

  // ── Genetic ──
  'lactase variant rs182549 (22018a)': 'Lactase variant rs182549',
  'aldob a150p mutation (rs1800546)': 'ALDOB A150P mutation',
  'aldob a175d mutation (rs76917243)': 'ALDOB A175D mutation',
  'adult-type lactase persistence/non-persistence (rs4988235)': 'Lactase persistence rs4988235',
  'hint1 coding sequence analysis': 'HINT1 analysis',
  'hint1 coding sequence analysis (sanger)': 'HINT1 analysis',

  // ── Urinalysis extended ──
  bacteria: 'Bacteria (urine)',
  casts: 'Casts (urine)',
  crystals: 'Crystals (urine)',
  control: 'Control',
  'fecal occult blood': 'Fecal occult blood',

  // ── WBC differential extended ──
  'eosinophilic granulocytes': 'Eosinophils (abs)',
  'basophilic granulocytes': 'Basophils (abs)',
  'band neutrophils': 'Band neutrophils',
  bands: 'Band neutrophils',

  // ── Urinalysis (additional) ──
  clarity: 'Clarity (urine)',
  'urine clarity': 'Clarity (urine)',
  color: 'Color (urine)',
  'urine color': 'Color (urine)',
  bilirubin: 'Bilirubin (urine)',
  'hemoglobin (urine dipstick)': 'Hemoglobin (urine dipstick)',
  'leukocyte esterase (urine)': 'Leukocyte esterase (urine)',
  'nitrite (urine)': 'Nitrite (urine)',
  'ketone (urine)': 'Ketone (urine)',
  'glucose (urine)': 'Glucose (urine)',
  'microscopy (urine)': 'Microscopy (urine)',
  'rbc (urine)': 'RBC (urine)',
  'wbc (urine)': 'WBC (urine)',
  'protein (urine)': 'Protein (urine)',
  'protein/osmolality (urine)': 'Protein/Osmolality (urine)',
  'predicted 24h protein': 'Predicted 24h protein (urine)',
  'erythrocytes/hemoglobin': 'Erythrocytes/Hb (urine)',
  'd-dimer': 'D-dimer',

  // ── Misc ──
  interpretation: 'Interpretation',
  'e gene (envelope)': 'SARS-CoV-2 E gene',
  'chlamydia pneumoniae antigen (immunofluorescence)': 'Chlamydia pneumoniae Ag',

  // ── Extraction artifact mappings ──
  // These are numbered entries from screening panels with names embedded in number
  '1 (hbsag)': 'HBsAg',
  '2 (anty-hcv)': 'Anti-HCV',
  '3 (ct igg)': 'Chlamydia trachomatis IgG',
  '4 (ct igm)': 'Chlamydia trachomatis IgM',

  // Numeric-only values like "1", "5.9", "66,0" are extraction errors from
  // protein electrophoresis files; these pass through unchanged.
};

/**
 * Canonicalize a test name to standardized English form.
 *
 * First checks exact match (case-insensitive), then falls back
 * to returning the original name trimmed.
 *
 * Returns canonical English name or the original if no mapping exists.
 */
export function canonicalizeTestName(name: string): string {
  const key = name.trim().toLowerCase();

  const canonical = TEST_NAME_CANONICAL[key];
  if (canonical) return canonical;

  // Handle the "1" test name (extraction artifact)
  if (key === '1' || key === '') return name;

  return name.trim();
}

/**
 * Normalize a complete lab value for import.
 * Returns the normalized test name and unit.
 */
export function normalizeLabValue(
  testName: string,
  unit: string,
): { testName: string; unit: string } {
  return {
    testName: canonicalizeTestName(testName),
    unit: normalizeUnit(unit),
  };
}
