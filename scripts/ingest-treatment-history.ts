/**
 * Ingest Full Treatment History into Database
 *
 * Captures all 42+ documented treatments from hypothesis analysis,
 * executive summary, and adversarial agent reports. Persists to
 * clinical_treatment_trials table with efficacy ratings and provenance.
 */

import { randomUUID } from 'node:crypto';
import { ClinicalStore } from '../src/storage/clinical-store.js';
import type { TreatmentTrial } from '../src/schemas/clinical-record.js';

const PATIENT_ID = 'patient-tomasz-szychlinski';

// ─── Treatment Data ────────────────────────────────────────────────────────

interface TreatmentEntry {
  medication: string;
  drugClass: string;
  indication?: string;
  startDate?: string;
  endDate?: string;
  dosage?: string;
  efficacy: 'none' | 'minimal' | 'partial' | 'significant' | 'complete' | 'unknown';
  sideEffects?: string[];
  reasonDiscontinued?: string;
  adequateTrial?: boolean;
  source: string;
}

const TREATMENTS: TreatmentEntry[] = [
  // ─── CGRP Monoclonal Antibodies (4/4 failed) ──────────────────────
  {
    medication: 'Erenumab (Aimovig)',
    drugClass: 'CGRP mAb',
    indication: 'Chronic facial/head pain prevention',
    efficacy: 'none',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Fremanezumab (Ajovy)',
    drugClass: 'CGRP mAb',
    indication: 'Chronic facial/head pain prevention',
    efficacy: 'none',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Galcanezumab (Emgality)',
    drugClass: 'CGRP mAb',
    indication: 'Chronic facial/head pain prevention',
    efficacy: 'none',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Eptinezumab (Vyepti)',
    drugClass: 'CGRP mAb',
    indication: 'Chronic facial/head pain prevention',
    efficacy: 'none',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  // ─── LDN (Only effective treatment) ────────────────────────────────
  {
    medication: 'Low-Dose Naltrexone (LDN)',
    drugClass: 'Glial modulator / opioid antagonist',
    indication: 'Chronic craniofacial pain, central sensitization',
    startDate: '2020-01-01',
    dosage: '2.5 mg/day',
    efficacy: 'significant',
    sideEffects: ['Vivid dreams (transient)'],
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0 + patient report',
  },
  // ─── Anticonvulsants ───────────────────────────────────────────────
  {
    medication: 'Pregabalin (Lyrica)',
    drugClass: 'Anticonvulsant / gabapentinoid',
    indication: 'Neuropathic pain',
    dosage: '150-300 mg/day',
    efficacy: 'minimal',
    sideEffects: ['Drowsiness', 'Weight gain'],
    reasonDiscontinued: 'Insufficient efficacy',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Gabapentin (Neurontin)',
    drugClass: 'Anticonvulsant / gabapentinoid',
    indication: 'Neuropathic pain',
    efficacy: 'minimal',
    reasonDiscontinued: 'Insufficient efficacy',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Topiramate (Topamax)',
    drugClass: 'Anticonvulsant',
    indication: 'Headache prevention',
    efficacy: 'none',
    sideEffects: ['Cognitive impairment', 'Weight loss', 'Paresthesia'],
    reasonDiscontinued: 'Side effects + no efficacy',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Carbamazepine (Tegretol)',
    drugClass: 'Anticonvulsant',
    indication: 'Trigeminal neuralgia',
    efficacy: 'none',
    reasonDiscontinued: 'No efficacy',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Antidepressants ───────────────────────────────────────────────
  {
    medication: 'Duloxetine (Cymbalta)',
    drugClass: 'SNRI antidepressant',
    indication: 'Neuropathic pain, depression',
    dosage: '60-90 mg/day',
    efficacy: 'none',
    reasonDiscontinued: 'No analgesic effect despite adequate dose',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0 + BioMCP COMT interaction analysis',
  },
  {
    medication: 'Sertraline (Zoloft)',
    drugClass: 'SSRI antidepressant',
    indication: 'Depression, pain modulation',
    efficacy: 'unknown',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Bupropion (Wellbutrin)',
    drugClass: 'NDRI antidepressant',
    indication: 'Depression',
    startDate: '2019-01-01',
    endDate: '2021-01-01',
    efficacy: 'unknown',
    sideEffects: ['Possible COMT interaction (DGIdb 0.219)', 'Possible drug-induced ANCA'],
    reasonDiscontinued: 'Pharmacogenomic concern (COMT variant interaction)',
    source: 'hypothesis-analysis v4.0 + BioMCP DGIdb analysis',
  },
  {
    medication: 'Amitriptyline',
    drugClass: 'TCA antidepressant',
    indication: 'Neuropathic pain, headache prevention',
    efficacy: 'minimal',
    reasonDiscontinued: 'Insufficient efficacy',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── NSAIDs / Analgesics ───────────────────────────────────────────
  {
    medication: 'Ibuprofen',
    drugClass: 'NSAID',
    indication: 'Pain relief',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Naproxen',
    drugClass: 'NSAID',
    indication: 'Pain relief',
    efficacy: 'none',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Paracetamol (Acetaminophen)',
    drugClass: 'Analgesic',
    indication: 'Pain relief',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Opioids ───────────────────────────────────────────────────────
  {
    medication: 'Tramadol',
    drugClass: 'Opioid analgesic',
    indication: 'Acute pain',
    efficacy: 'partial',
    reasonDiscontinued: 'Not sustainable for chronic use',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Muscle Relaxants ──────────────────────────────────────────────
  {
    medication: 'Tizanidine (Zanaflex)',
    drugClass: 'Muscle relaxant',
    indication: 'Cervical muscle spasm',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Baclofen',
    drugClass: 'Muscle relaxant / antispastic',
    indication: 'Muscle spasticity',
    efficacy: 'unknown',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Benzodiazepines ───────────────────────────────────────────────
  {
    medication: 'Clonazepam',
    drugClass: 'Benzodiazepine',
    indication: 'Anxiety, muscle tension',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Botulinum Toxin ───────────────────────────────────────────────
  {
    medication: 'Botulinum Toxin A (Botox)',
    drugClass: 'Neurotoxin',
    indication: 'Chronic migraine protocol, facial pain',
    efficacy: 'none',
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Supplements ───────────────────────────────────────────────────
  {
    medication: 'Coenzyme Q10',
    drugClass: 'Supplement',
    indication: 'Neuroprotection, migraine prevention',
    efficacy: 'unknown',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Magnesium',
    drugClass: 'Supplement',
    indication: 'Migraine prevention, muscle relaxation',
    efficacy: 'unknown',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Vitamin D3',
    drugClass: 'Supplement',
    indication: 'Deficiency correction',
    dosage: 'Variable',
    efficacy: 'unknown',
    source: 'hypothesis-analysis v4.0 + lab results',
  },
  {
    medication: 'B-complex vitamins',
    drugClass: 'Supplement',
    indication: 'Neuropathy support',
    efficacy: 'unknown',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Procedures: Nerve Blocks ──────────────────────────────────────
  {
    medication: 'GON Block (right, C2)',
    drugClass: 'Nerve block procedure',
    indication: 'Diagnostic + therapeutic for occipital pain',
    startDate: '2016-01-01',
    efficacy: 'significant',
    sideEffects: ['Pain migration from occiput to face (V1/V2) — TCC redistribution'],
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0 + adversarial reports',
  },
  {
    medication: 'SPG Block (sphenopalatine ganglion)',
    drugClass: 'Nerve block procedure',
    indication: 'Facial pain, autonomic symptoms',
    efficacy: 'partial',
    sideEffects: ['Transient numbness'],
    adequateTrial: true,
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Procedures: RFA ───────────────────────────────────────────────
  {
    medication: 'Partial RFA (radiofrequency ablation)',
    drugClass: 'Neuroablative procedure',
    indication: 'Facial pain',
    startDate: '2026-01-01',
    efficacy: 'none',
    adequateTrial: false,
    source: 'specialist report 2026',
  },
  // ─── Procedures: Surgery ───────────────────────────────────────────
  {
    medication: 'Rhinoseptoplasty',
    drugClass: 'Surgical procedure',
    indication: 'Nasal septum deviation',
    startDate: '2012-04-01',
    efficacy: 'unknown',
    sideEffects: ['Recurrent oral aphthae post-surgery (onset)'],
    source: 'medical records 2012',
  },
  // ─── Other Procedures ──────────────────────────────────────────────
  {
    medication: 'Dental occlusal splint',
    drugClass: 'Dental device',
    indication: 'Bruxism management',
    efficacy: 'none',
    sideEffects: ['Worsened pain'],
    reasonDiscontinued: 'Pain worsened',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Acupuncture',
    drugClass: 'Alternative medicine',
    indication: 'Pain management',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Massage therapy',
    drugClass: 'Physical therapy',
    indication: 'Cervical muscle tension',
    efficacy: 'partial',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'Physical therapy (cervical)',
    drugClass: 'Physical therapy',
    indication: 'Cervical spine rehabilitation',
    efficacy: 'partial',
    source: 'hypothesis-analysis v4.0',
  },
  {
    medication: 'TENS (transcutaneous electrical nerve stimulation)',
    drugClass: 'Neurostimulation',
    indication: 'Pain management',
    efficacy: 'none',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Psilocybin ───────────────────────────────────────────────────
  {
    medication: 'Psilocybin (microdose)',
    drugClass: 'Psychedelic',
    indication: 'Cluster headache, pain modulation',
    efficacy: 'unknown',
    source: 'patient report',
  },
  // ─── Neurostimulation devices ─────────────────────────────────────
  {
    medication: 'Nasal electrostimulator',
    drugClass: 'Neurostimulation device',
    indication: 'Trigeminal afferent modulation',
    startDate: '2026-03-01',
    efficacy: 'unknown',
    source: 'specialist report 2026',
  },
  {
    medication: 'Cefaly device',
    drugClass: 'Neurostimulation device',
    indication: 'Supraorbital nerve stimulation',
    efficacy: 'none',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Steroids ──────────────────────────────────────────────────────
  {
    medication: 'Dexamethasone (IV/oral courses)',
    drugClass: 'Corticosteroid',
    indication: 'Anti-inflammatory, nerve edema',
    efficacy: 'partial',
    sideEffects: ['Transient improvement only'],
    reasonDiscontinued: 'Not sustainable, transient effect',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Sleep ─────────────────────────────────────────────────────────
  {
    medication: 'Melatonin',
    drugClass: 'Sleep aid',
    indication: 'Sleep disturbance from chronic pain',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Cannabis ──────────────────────────────────────────────────────
  {
    medication: 'Medical cannabis (CBD oil)',
    drugClass: 'Cannabinoid',
    indication: 'Pain management, sleep',
    efficacy: 'minimal',
    source: 'patient report',
  },
  // ─── Oxygen ────────────────────────────────────────────────────────
  {
    medication: 'High-flow oxygen therapy',
    drugClass: 'Oxygen therapy',
    indication: 'Cluster headache protocol',
    efficacy: 'none',
    source: 'hypothesis-analysis v4.0',
  },
  // ─── Lidocaine ─────────────────────────────────────────────────────
  {
    medication: 'Topical lidocaine patches',
    drugClass: 'Local anesthetic',
    indication: 'Facial/cervical pain',
    efficacy: 'minimal',
    source: 'hypothesis-analysis v4.0',
  },
];

// ─── Main Ingestion ──────────────────────────────────────────────────────

async function main() {
  const store = new ClinicalStore();

  console.log('=== Ingesting Treatment History ===\n');
  console.log(`Total treatments to ingest: ${TREATMENTS.length}\n`);

  let inserted = 0;
  let skipped = 0;

  for (const entry of TREATMENTS) {
    // Check for existing treatment
    const existing = await store.findTreatmentTrial(
      PATIENT_ID,
      entry.medication,
      entry.startDate ?? null,
    );

    if (existing) {
      console.log(`  [skip] ${entry.medication} — already in database`);
      skipped++;
      continue;
    }

    const trial: TreatmentTrial = {
      id: randomUUID(),
      patientId: PATIENT_ID,
      medication: entry.medication,
      drugClass: entry.drugClass,
      indication: entry.indication,
      dosage: entry.dosage,
      efficacy: entry.efficacy,
      reasonDiscontinued: entry.reasonDiscontinued,
      adequateTrial: entry.adequateTrial,
      source: entry.source,
      evidenceTier: 'T1-official',
      validationStatus: 'unvalidated',
      sourceCredibility: 70,
    };
    if (entry.startDate) trial.startDate = entry.startDate;
    if (entry.endDate) trial.endDate = entry.endDate;
    if (entry.sideEffects) trial.sideEffects = entry.sideEffects;

    await store.addTreatmentTrial(trial);
    inserted++;
    console.log(`  [add]  ${entry.medication} (${entry.drugClass}) — ${entry.efficacy}`);
  }

  console.log(`\n--- Treatment History ---`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Already in database: ${skipped}`);
  console.log(`  Total in DB: ${inserted + skipped}`);
  console.log('\n=== Treatment Ingestion Complete ===');
}

main().catch(console.error);
