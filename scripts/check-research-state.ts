#!/usr/bin/env npx tsx
import { getClinicalStore } from '../src/storage/clinical-store.js';

async function main() {
  const store = getClinicalStore();
  const pid = 'patient-tomasz-szychlinski';

  // Hypotheses
  const hyps = await store.queryHypotheses({ patientId: pid });
  console.log('=== HYPOTHESES ===');
  for (const h of hyps) {
    console.log(`  ${h.name} | ${h.certaintyLevel} | prob: ${h.probabilityLow}-${h.probabilityHigh}`);
  }

  // Genome variant count
  const count = await store.countGeneticVariants(pid);
  console.log(`\n=== GENOME ===`);
  console.log(`Total SNPs in DB: ${count}`);

  // Existing genome findings
  const gf = await store.queryFindings({ patientId: pid, source: 'Genome Analysis' });
  console.log(`Genome research findings: ${gf.length}`);
  for (const f of gf) {
    const raw = f.rawData ? JSON.parse(f.rawData) : {};
    console.log(`  ${f.externalId} | ${raw.gene} | ${raw.genotype} | sig: ${raw.clinicalSignificance ?? 'unknown'}`);
  }

  // Check which genes/SNPs have NOT been researched yet
  const knownGenes = ['COMT', 'MTHFR', 'VDR', 'CBS', 'BHMT', 'FUT2', 'CYP2D6', 'CYP2C19', 'CYP2C9', 'CYP3A5', 'COL5A1', 'COL3A1', 'F5'];
  console.log(`\n=== GENES RESEARCHED ===`);
  console.log(knownGenes.join(', '));

  // Check for important SNPs not yet queried
  const additionalRsids = [
    'rs4818', 'rs1801198', 'rs2228570', 'rs4646994', 'rs3892097', 'rs1065852', // Tier 1-2 not found initially
    'rs1800497', // DRD2 (pain/reward, relevant to LDN response)
    'rs6311', 'rs6313', // HTR2A (serotonin receptor, SNRI response)
    'rs25531', 'rs25532', // SLC6A4 (5-HTTLPR, serotonin transporter)
    'rs1799971', // OPRM1 (opioid receptor, LDN/naltrexone target)
    'rs4411417', // TRPM3 (ion channel, LDN mechanism)
    'rs1800896', 'rs1800871', // IL10 (anti-inflammatory cytokine)
    'rs1800795', // IL6 (proinflammatory, central sensitization)
    'rs6265', // BDNF (brain-derived neurotrophic factor, neuroplasticity)
    'rs1800629', // TNF-alpha (neuroinflammation)
    'rs3135388', // HLA-DRB1*1501 (autoimmune susceptibility)
    'rs2187668', // HLA-DQ2 (autoimmune)
    'rs7454108', // HLA-DQ8 (autoimmune)
    'rs3093662', // FCGR3A (immune complex clearance)
    'rs1143634', // IL1B (neuroinflammation)
    'rs2069762', // IL2 (T-cell regulation, leukopenia)
    'rs1805009', 'rs1805007', // MC1R (pain sensitivity)
    'rs28362491', // NFKB1 (master immune regulator)
    'rs2476601', // PTPN22 (autoimmune susceptibility)
    'rs3761847', // TRAF1 (autoimmune)
    'rs10488631', // IRF5 (SLE/Sjögren susceptibility)
    'rs7574865', // STAT4 (autoimmune susceptibility)
    'rs2004640', // IRF5 (SLE/Sjögren susceptibility)
    'rs11568821', // CTLA4 (autoimmune, T-cell regulation)
    'rs3087243', // CTLA4 (autoimmune checkpoint)
    'rs2069763', // IL2 (lymphocyte regulation)
    'rs1800872', // IL10 promoter
    'rs361525', // TNF-alpha promoter
  ];

  console.log(`\n=== CHECKING ADDITIONAL CLINICALLY RELEVANT SNPS ===`);
  const foundAdditional: string[] = [];
  const notFound: string[] = [];
  for (const rsid of additionalRsids) {
    const v = await store.getVariantByRsid(pid, rsid);
    if (v) {
      foundAdditional.push(`${rsid}: ${v.genotype} (chr${v.chromosome}:${v.position})`);
    } else {
      notFound.push(rsid);
    }
  }
  console.log(`Found ${foundAdditional.length}/${additionalRsids.length}:`);
  for (const f of foundAdditional) {
    console.log(`  ${f}`);
  }
  console.log(`Not in genome: ${notFound.join(', ')}`);

  process.exit(0);
}

main();
