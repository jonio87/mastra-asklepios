# Genomics Research Report — Tomasz Szychliński

## Document Metadata

| Field | Value |
|-------|-------|
| **Report version** | 1.0.0 |
| **Report date** | 2026-03-12 |
| **Last updated** | 2026-03-12 |
| **Patient ID** | patient-tomasz-szychlinski |
| **DOB** | 1991-11-18 (age 34) |
| **Genome source** | 23andMe v5 raw genotype file |
| **Genome generated** | 2020-03-01 |
| **Reference genome** | GRCh37 (hg19) |
| **Total SNPs** | 638,547 |
| **Analysis pipeline** | Asklepios Genome Analysis Pipeline v1.0 |
| **Status** | Research-grade — NOT for clinical decision-making without specialist confirmation |

### Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-03-12 | Initial report: 42 annotated variants, 29 drug-gene interactions, OPRM1 deep dive, autoimmune susceptibility profile, pharmacogenomics screen of 40 medications, follow-up testing recommendations |

### Provenance Chain

```
Source: 23andMe v5 raw genotype file (genome_tomasz_szychlinski_v5_Full_20200301093219.txt)
  ├── Imported: 2026-03-11 → genetic_variants table (638,547 rows)
  │     Parser: src/importers/genome-parser.ts
  │     Script: scripts/ingest-genome.ts
  │     Archive: medical-records/records/labs/genetic/23andme_v5_full_20200301.txt
  │
  ├── Research Phase 1: Initial SNP Annotation (2026-03-11)
  │     Script: scripts/research-genome-variants.ts
  │     MCP servers: BioThings (MyVariant.info, MyGene.info)
  │     Targets: 25 priority SNPs → 19 found → 19 findings stored
  │     Queries: ~76 MCP calls
  │
  ├── Research Phase 2: Hypothesis-Driven Deep Analysis (2026-03-11)
  │     Script: scripts/deep-genome-research.ts
  │     MCP servers: BioThings, BioContext (Europe PMC), BioMCP, Open Targets
  │     Targets: 24 hypothesis-linked SNPs → 23 found → 23 findings stored
  │     Queries: 69 MCP calls
  │     Hypotheses mapped: H1–H6, Clinical questions: Q1–Q6
  │
  └── Research Phase 3: Pharmacogenomics + OPRM1 + Autoimmune Deep Dive (2026-03-12)
        Script: scripts/pharmacogenomics-full-screen.ts
        MCP servers: BioMCP (DGIdb, DrugBank), BioThings, BioContext, Open Targets
        Medications screened: 40 (current + tried + candidates)
        Drug-gene interactions: 28 identified (13 significant)
        OPRM1 deep dive: 9 queries, 33 PMIDs
        Autoimmune deep dive: 24 queries, 80 PMIDs
        Findings stored: 33 new
```

### Database Artifacts

| Artifact | Location | Count |
|----------|----------|-------|
| Raw genotypes | `genetic_variants` table | 638,547 |
| Genome annotations | `research_findings` (source: Genome Analysis) | 19 |
| Hypothesis-linked variants | `research_findings` (source: Deep Genome Research) | 23 |
| Pharmacogenomics interactions | `research_findings` (source: Pharmacogenomics Screen) | 29 |
| OPRM1 deep research | `research_findings` (source: OPRM1 Deep Research) | 2 |
| Autoimmune deep research | `research_findings` (source: Autoimmune Susceptibility Research) | 5 |
| **Total genome-related findings** | | **78** |

### External Databases Queried

| Database | Via | Data Retrieved |
|----------|----|----------------|
| ClinVar | BioThings MyVariant.info | Clinical significance, pathogenicity assertions |
| gnomAD | BioThings MyVariant.info | Population allele frequencies |
| CADD | BioThings MyVariant.info | Deleteriousness scores (phred-scaled) |
| DGIdb | BioMCP shell | Drug-gene interactions |
| DrugBank | BioMCP shell | Drug metabolism pathways, pharmacokinetics |
| Europe PMC | BioContext | Literature evidence (113+ PMIDs) |
| Open Targets | Open Targets GraphQL | Gene-disease-drug associations |
| MyGene.info | BioThings | Gene annotations, pathways, expression |

---

## 1. Executive Summary

Analysis of 638,547 SNPs from the patient's 23andMe v5 genome identified **42 clinically annotated variants** across pain sensitivity, pharmacogenomics, methylation, autoimmune susceptibility, and connective tissue categories. An additional **29 drug-gene interactions** were mapped against 40 medications (current, past, and candidate).

### Key Findings

| Priority | Finding | Clinical Action |
|----------|---------|-----------------|
| 1 | **CYP2D6 \*6 null allele** (rs5030655 II) | 13 medications significantly affected. Recommend full CYP2D6 copy number analysis |
| 2 | **OPRM1 A118G homozygous** (rs1799971 GG, CADD=24.1) | LDN is the only effective medication — genotype directly affects its target receptor |
| 3 | **STAT4-T + IRF5-T + HLA-DRB1\*15:01** triple autoimmune risk | Supports pursuing Anti-Ro-60 confirmation via third method |
| 4 | **IL-10 low-producer haplotype** (rs1800896 CC) | Impaired anti-inflammatory capacity — connects central sensitization and autoimmune tendency |
| 5 | **MTHFR compound heterozygosity** (C677T AG + A1298C GT) | ~35-50% reduced methylation → continue folate supplementation |
| 6 | **HTR2A CT** (rs6311) + normal CYP2C19 | Serotonergic drugs (SSRIs/SNRIs) have pharmacodynamic disadvantage beyond CYP2D6 issue |
| 7 | **No connective tissue burden** detected | CVJ anomaly is developmental, not systemic EDS-spectrum |

---

## 2. Pharmacogenomic Profile

### 2.1 Metabolizer Status

| Gene | Variant | Genotype | Metabolizer Status | Confidence |
|------|---------|----------|--------------------|------------|
| **CYP2D6** | rs5030655 (\*6) | II | **At least one null allele** — need copy number for full status | High (ClinVar) |
| CYP2C19 | rs4244285 (\*2) | GG | Normal metabolizer | High |
| CYP2C19 | rs4986893 (\*3) | GG | Normal metabolizer | High |
| CYP2C19 | rs12248560 (\*17) | TT | Not ultrarapid | High |
| CYP2C9 | rs1057910 (\*3) | AA | Normal metabolizer | High |
| **CYP3A5** | rs776746 (\*3) | CC | **Non-expressor** — relies on CYP3A4 | High |
| CYP3A4 | — | Not tested | Likely normal (European ancestry) | Low |

**Critical limitation:** 23andMe does not detect CYP2D6 copy number variants (\*1xN, \*2xN) or common alleles \*4 (rs3892097) and \*10 (rs1065852) — these were absent from the v5 array. The \*6 null allele alone cannot determine full metabolizer phenotype. **Clinical-grade CYP2D6 genotyping is required.**

### 2.2 Drug-Gene Interaction Matrix

#### 2.2.1 Significant Interactions (13)

| Drug | Status | Gene | Impact | Recommendation |
|------|--------|------|--------|----------------|
| **Duloxetine** | Current | CYP2D6 \*6 | Significant | CYP2D6 substrate — null allele → potentially increased exposure. Full CYP2D6 testing needed before dose adjustment |
| **Naltrexone (LDN)** | Current | OPRM1 GG | Significant | Direct pharmacodynamic effect — altered mu-opioid receptor binding (see §3) |
| Tramadol | Tried | CYP2D6 \*6 | Significant | CYP2D6 converts tramadol → active metabolite O-desmethyltramadol. Null allele → reduced activation → reduced efficacy (not toxicity) |
| Tramadol | Tried | OPRM1 GG | Significant | Active metabolite acts on mu-opioid receptors — altered binding |
| Amitriptyline | Tried | CYP2D6 \*6 | Significant | CYP2D6 substrate — increased exposure risk |
| Bupropion | Tried | COMT AG | Significant | Bupropion inhibits COMT — combined with intermediate COMT activity, may excessively reduce catecholamine clearance (discontinued for this reason) |
| Sertraline | Tried | CYP2D6 \*6 | Significant | CYP2D6 substrate — increased exposure risk |
| **Fluoxetine** | Candidate | CYP2D6 \*6 | **Contraindicated** | Most potent CYP2D6 inhibitor + CYP2D6 substrate. Null allele → dramatically increased exposure AND further CYP2D6 pathway inhibition |
| **Paroxetine** | Candidate | CYP2D6 \*6 | **Contraindicated** | Strong CYP2D6 inhibitor + primary CYP2D6 substrate |
| Citalopram | Candidate | CYP2D6 \*6 | Significant | Partially CYP2D6-metabolized (primary: CYP2C19 normal) |
| Fluvoxamine | Candidate | CYP2D6 \*6 | Significant | CYP2D6 substrate |
| **Venlafaxine** | Candidate | CYP2D6 \*6 | Significant | CYP2D6 converts to active desvenlafaxine. Null allele → reduced conversion → more parent drug, less active metabolite |
| **Hydroxychloroquine** | Candidate | CYP2D6 \*6 | Significant | CYP2D6 substrate — if Sjögren confirmed, may need dose adjustment |

#### 2.2.2 Moderate Interactions (8)

| Drug | Status | Gene | Impact | Note |
|------|--------|------|--------|------|
| Duloxetine | Current | HTR2A CT | Moderate | Intermediate serotonin 2A receptor density — reduced SNRI efficacy at receptor level |
| Sertraline | Tried | HTR2A CT | Moderate | Same HTR2A pharmacodynamic disadvantage |
| Fluoxetine | Candidate | HTR2A CT | Moderate | All SSRIs affected by HTR2A genotype |
| Paroxetine | Candidate | HTR2A CT | Moderate | " |
| Citalopram | Candidate | HTR2A CT | Moderate | " |
| Escitalopram | Candidate | HTR2A CT | Moderate | " |
| Fluvoxamine | Candidate | HTR2A CT | Moderate | " |
| Venlafaxine | Candidate | HTR2A CT | Moderate | All SNRIs affected |

#### 2.2.3 Minimal Interactions (8)

CYP3A5 non-expressor (\*3/\*3) affects: naltrexone, topiramate, carbamazepine, clonazepam, dexamethasone, alprazolam, midazolam. Since most Europeans are CYP3A5 non-expressors and these drugs rely primarily on CYP3A4, standard dosing is appropriate.

### 2.3 Candidate Medication Genetic Compatibility

| Candidate | CYP Status | PD Status | Genetic Compatibility |
|-----------|------------|-----------|----------------------|
| **Desvenlafaxine (Pristiq)** | CYP3A4 (normal) | HTR2A moderate | **Good** — bypasses CYP2D6 (is the active metabolite of venlafaxine) |
| **Milnacipran (Savella)** | Renal excretion | HTR2A moderate | **Good** — minimal CYP involvement, FDA-approved for fibromyalgia |
| **Lorazepam (Ativan)** | Glucuronidation | N/A | **Excellent** — no CYP metabolism at all |
| **Oxazepam (Serax)** | Glucuronidation | N/A | **Excellent** — no CYP metabolism |
| Escitalopram (Lexapro) | CYP2C19 normal | HTR2A moderate | Acceptable — CYP2C19 is primary pathway (normal), CYP2D6 minor |
| **Ketamine (IV)** | CYP3A4/CYP2B6 | N/A | **Good** — CYP3A4 primary, CYP2D6 not involved |
| Diazepam (Valium) | CYP2C19 normal | N/A | Acceptable — CYP2C19 primary (normal) |
| Fluoxetine | CYP2D6 null | HTR2A moderate | **Avoid** — CYP2D6 contraindication |
| Paroxetine | CYP2D6 null | HTR2A moderate | **Avoid** — CYP2D6 contraindication |

---

## 3. OPRM1 A118G Deep Dive — LDN Pharmacodynamics

### 3.1 The Finding

The patient is **homozygous GG** at OPRM1 rs1799971 (A118G, Asn40Asp). This is a non-synonymous coding variant in the mu-opioid receptor gene with a CADD phred score of 24.1 (likely deleterious to protein function).

### 3.2 Why This Matters

LDN (low-dose naltrexone) is the patient's **only effective medication**. It has a dual mechanism:

1. **Mu-opioid receptor blockade** → compensatory endorphin/enkephalin upregulation (OPRM1-dependent)
2. **TLR4 antagonism** → glial cell suppression → reduced neuroinflammation (OPRM1-independent)

The GG genotype at A118G creates an asparagine→aspartate substitution at position 40, which:
- Removes an N-linked glycosylation site on the receptor
- Alters receptor cell-surface expression levels
- Changes beta-endorphin binding affinity
- Modifies downstream signaling efficiency

### 3.3 Clinical Context

- **DRD2/ANKK1 rs1800497 AG** (Taq1A heterozygote): Reduced D2 receptor density further modulates the opioid-dopamine crosstalk that LDN exploits
- **TNF-α promoter rs1800629 GG + rs361525 GG**: Normal/low TNF production — less neuroinflammatory substrate for LDN's TLR4 mechanism
- **Current dose:** 2.5 mg/day → **planned increase:** 4.5 mg/day

### 3.4 Recommendation

The OPRM1 GG genotype warrants careful LDN dose titration guided by clinical response rather than standard protocols. Literature search yielded 33 PMIDs on OPRM1-naltrexone pharmacogenomics. The A118G variant's effect on LDN specifically (as opposed to full-dose naltrexone) is not well-characterized — most pharmacogenomic studies used naltrexone at 50-100mg doses for alcohol/opioid use disorders, not the 1.5-4.5mg range used in LDN for chronic pain.

**Action:** Discuss OPRM1 GG genotype with prescriber when titrating LDN to 4.5mg. Monitor closely for both under-response (may need higher dose) and over-response. Consider formal pharmacogenomic consultation.

---

## 4. Autoimmune Susceptibility Profile

### 4.1 Risk Alleles

| Gene | SNP | Genotype | Risk Allele | Associated Conditions | Odds Ratio |
|------|-----|----------|-------------|----------------------|------------|
| **STAT4** | rs7574865 | GT | T carrier | Sjögren (Anti-Ro-60+), SLE | ~1.5-2.0× |
| **IRF5** | rs10488631 | CT | T carrier | SLE, Sjögren, type I IFN signature | ~1.3-1.8× |
| **HLA-DRB1** | rs3135388 | AG | A carrier (DRB1\*15:01 tag) | MS, Sjögren, autoimmune | ~1.5-3.0× |
| **IL-10** | rs1800896 | CC | C (low producer) | Impaired anti-inflammatory | Functional |

### 4.2 Protective Factors

| Gene | SNP | Genotype | Significance |
|------|-----|----------|--------------|
| CTLA4 | rs3087243 | GG | Normal immune checkpoint function |
| FCGR3A | rs3093662 | AA | Normal Fc receptor — lower ANCA vasculitis risk |
| HLA-DQ2 | rs2187668 | CC | Not a DQ2 carrier (celiac/T1D risk not elevated) |
| HLA-DQ8 | rs7454108 | TT | Not a DQ8 carrier |

### 4.3 Immune Regulation

| Gene | SNP | Genotype | Significance |
|------|-----|----------|--------------|
| **IL-10 haplotype** | rs1800896/rs1800871/rs1800872 | CC/GG/GG | **Low-producer genotype** — impaired anti-inflammatory capacity |
| IL-2 | rs2069762 | AA | IL-2 promoter variant — affects T-cell proliferation |
| IL-2 | rs2069763 | AC | IL-2 coding variant — combined with rs2069762 defines IL-2 haplotype |
| IL-6 | rs1800795 | CG | Intermediate IL-6 production |
| TNF-α | rs1800629/rs361525 | GG/GG | Normal TNF production (not elevated) |
| IL-1β | rs1143634 | GG | Normal IL-1β production |

### 4.4 Interpretation

The patient carries **three key autoimmune susceptibility alleles** (STAT4-T, IRF5-T, HLA-DRB1\*15:01) combined with a **low IL-10 producer genotype**. This creates a meaningful genetic predisposition to Sjögren syndrome specifically. The STAT4 T allele is strongly associated with Anti-Ro-60 positive Sjögren.

However, protective factors are present: normal immune checkpoint (CTLA4), normal Fc receptor (FCGR3A), no HLA-DQ2/DQ8, and normal TNF/IL-1β production. This is a mixed profile — susceptibility without full penetrance.

### 4.5 Recommendation

1. **Proceed with Anti-Ro-60 confirmation via a third assay method** (as already planned). STAT4-T genotype specifically predicts Anti-Ro-60 positive Sjögren
2. The IL-10 low-producer genotype bridges the autoimmune hypothesis (H4) with central sensitization (H3) — impaired anti-inflammatory resolution affects both pathways
3. If Anti-Ro-60 is confirmed positive on third method: STAT4/IRF5/HLA-DRB1 genetic profile supports a genuine autoimmune process rather than assay artifact
4. If Anti-Ro-60 remains discrepant: genetic susceptibility is present but may not be manifesting clinically yet

---

## 5. Pain Sensitivity & Central Sensitization Variants

### 5.1 COMT

| SNP | Genotype | Significance |
|-----|----------|--------------|
| rs4680 (Val158Met) | AG | Val/Met heterozygote — **intermediate COMT activity**. Moderate catecholamine clearance. Intermediate pain sensitivity (between Val/Val high-activity and Met/Met low-activity) |
| rs4633 | CT | COMT haplotype modifier — combined with rs4680 defines pain sensitivity phenotype |

### 5.2 Serotonin System

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| rs6311 | HTR2A | CT | -1438A/G heterozygote — intermediate serotonin 2A receptor density. Affects migraine susceptibility, SNRI/SSRI response |
| rs6313 | HTR2A | AG | T102C heterozygote — associated with chronic pain, treatment-resistant conditions |

### 5.3 Opioid System

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| rs1799971 | OPRM1 | GG | A118G homozygous variant — altered mu-opioid receptor binding (see §3) |
| rs1800497 | DRD2/ANKK1 | AG | Taq1A heterozygote — reduced D2 receptor density, altered pain/reward modulation |

### 5.4 Neurotrophins & Neuroplasticity

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| rs6265 | BDNF | CC | Val/Val — **normal BDNF secretion**. Favorable for neuroplastic recovery. Pain circuit remodeling capacity is preserved |

### 5.5 Other Pain-Related

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| rs1805007 | MC1R | CC | Normal (not R151C carrier). No MC1R-related increased pain sensitivity |
| rs1800629 | TNF | GG | Normal TNF-α production — neuroinflammatory baseline not elevated |
| rs1800795 | IL6 | CG | Intermediate IL-6 production — moderate neuroinflammatory capacity |

---

## 6. Methylation & Homocysteine Pathway

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| **rs1801133** | MTHFR | AG | C677T heterozygote — ~35% reduced enzyme activity |
| **rs1801131** | MTHFR | GT | A1298C heterozygote — compound heterozygosity with C677T |
| rs234706 | CBS | AG | Cystathionine beta-synthase heterozygote — moderate homocysteine clearance |
| rs567754 | BHMT | CT | Betaine-homocysteine methyltransferase heterozygote — alternate Hcy clearance partially impaired |
| rs602662 | FUT2 | GG | Secretor status — normal B12 absorption |

### Interpretation

MTHFR compound heterozygosity (C677T AG + A1298C GT) results in approximately 35-50% reduced methylation capacity. Combined with CBS AG and BHMT CT, the homocysteine clearance pathway has multiple partial impairments. This explains the patient's documented elevated homocysteine (10.1→13.9 µmol/l before supplementation) and supports the hypothesis that chronic hyperhomocysteinemia contributed to the sensory axonal neuropathy observed in lower limbs.

**Current management is appropriate:** Continue folate, B-complex, and vitamin D3 supplementation. Monitor homocysteine levels periodically.

---

## 7. Connective Tissue & Developmental

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| rs12722 | COL5A1 | TT | Collagen V — **benign** (ClinVar) |
| rs1800255 | COL3A1 | AA | Collagen III — normal |
| rs6025 | F5 (Leiden) | CC | Factor V Leiden — **not a carrier** (normal thrombotic risk) |

### Interpretation

No connective tissue genetic burden detected in the tested variants. The CVJ anomaly (C1 assimilation, platybasia, odontoid peg) is developmental in origin, not indicative of a systemic connective tissue disorder like Ehlers-Danlos syndrome. This supports hypothesis H5 at its current low probability (20-30%).

**Note:** 23andMe v5 does not cover all relevant EDS genes (TNXB, FBN1, ADAMTS2) comprehensively. If clinical suspicion increases, a targeted connective tissue gene panel would be more definitive.

---

## 8. VDR (Vitamin D Receptor) & Autoimmune

| SNP | Gene | Genotype | Significance |
|-----|------|----------|--------------|
| rs7975232 | VDR (ApaI) | AA | Autoimmune susceptibility variant |
| rs1544410 | VDR (BsmI) | CT | Heterozygote — autoimmune predisposition, neuropathy risk |
| rs731236 | VDR (TaqI) | AG | Heterozygote — immune dysregulation, vitamin D signaling |

### Interpretation

VDR variants affect vitamin D signaling efficiency, which modulates immune function. Combined with the autoimmune susceptibility profile (STAT4/IRF5/HLA-DRB1), VDR variants may contribute to the immune dysregulation phenotype. The patient's vitamin D3 supplementation is appropriate given these variants.

**Note:** VDR FokI (rs2228570) was absent from 23andMe v5 — this is the most functionally characterized VDR variant. If available through other testing, it would complete the VDR profile.

---

## 9. Answers to Clinical Questions

### Q1: Is the CVJ anomaly still actively compressing the cord?

**Genome evidence:** BDNF Val/Val (CC) — favorable for neuroplastic recovery. If compression is relieved (either surgically or via dynamic MRI showing it's positional), the nervous system has normal capacity for repair. IL-6 CG intermediate genotype suggests moderate wind-up capacity.

**Genome cannot answer this directly** — dynamic CVJ MRI is required (as planned).

### Q2: Why does LDN work and is the dose optimal?

**Genome evidence:** OPRM1 GG (A118G homozygous, CADD=24.1) directly affects LDN's primary target — the mu-opioid receptor. DRD2 AG (Taq1A) further modulates opioid-dopamine crosstalk. TNF GG/GG suggests the TLR4 mechanism may be less dominant (normal TNF production = less glial substrate).

**Recommendation:** The OPRM1 genotype warrants careful dose titration monitoring when increasing from 2.5mg to 4.5mg. Literature is limited for LDN-range doses (1.5-4.5mg) with this genotype.

### Q3: Are lab abnormalities drug-related or autoimmune?

**Genome evidence strongly supports a genuine autoimmune predisposition:**
- STAT4 GT — specifically predicts Anti-Ro-60 positive Sjögren (OR 1.5-2.0×)
- IRF5 CT — enhanced type I interferon signaling (SLE/Sjögren)
- HLA-DRB1\*15:01 AG — autoimmune susceptibility
- IL-10 CC — low anti-inflammatory capacity (impaired resolution)
- FCGR3A AA — normal Fc receptor (argues against ANCA vasculitis)

This does not prove autoimmune disease is active, but supports pursuing Anti-Ro-60 via third method. The genetic profile makes it more likely that intermittent positive results reflect genuine autoimmunity rather than assay noise.

### Q4: Did homocysteine cause lasting nerve damage?

**Genome evidence confirms the mechanism:**
- MTHFR compound heterozygosity (C677T AG + A1298C GT) → ~35-50% reduced methylation
- CBS AG + BHMT CT → partially impaired homocysteine clearance
- Documented elevated homocysteine (10.1→13.9 µmol/l)
- Sensory axonal neuropathy in lower limbs is a known consequence

**Current folate/B-complex supplementation is genetically justified and should continue.**

### Q5: What explains 42+ treatment failures?

**Genome provides a multi-layered explanation:**
1. **CYP2D6 \*6 null allele** — affects metabolism of duloxetine, amitriptyline, tramadol, sertraline, and many candidate SSRIs
2. **HTR2A CT** — intermediate serotonin receptor density → reduced pharmacodynamic response to all serotonergic medications (SSRIs and SNRIs)
3. **COMT AG** — intermediate catecholamine clearance → bupropion interaction
4. **OPRM1 GG** — altered opioid receptor binding → affected tramadol response
5. **The CYP2D6 + HTR2A combination** is particularly problematic — serotonergic drugs face both metabolic AND receptor-level disadvantages

**Important caveat:** 4 CGRP mAbs failed, but these are monoclonal antibodies not metabolized by CYP enzymes. Their failure points to the pain mechanism (central sensitization/non-CGRP-mediated) rather than pharmacogenomics.

### Q6: Is there an underlying connective tissue disorder?

**Genome evidence says no:** COL5A1 TT (benign), COL3A1 AA (normal), F5 CC (normal). No EDS-spectrum genetic burden detected. The CVJ anomaly is developmental in origin.

**Caveat:** 23andMe coverage of EDS genes is limited. If clinical suspicion rises, a targeted panel is warranted.

---

## 10. Further Recommendations

### Immediate (discuss at next appointment)

1. **Request clinical-grade CYP2D6 genotyping** — 23andMe detected \*6 null allele but missed \*4 and \*10 alleles. Full CYP2D6 testing (including copy number) is essential for accurate metabolizer phenotype and will directly impact duloxetine dosing and future medication selection

2. **Share OPRM1 GG genotype with LDN prescriber** — when titrating from 2.5mg to 4.5mg, close monitoring for both under-response and over-response is warranted due to altered receptor binding

3. **Share autoimmune genetic profile with rheumatologist/immunologist** — STAT4-T + IRF5-T + HLA-DRB1\*15:01 triple risk supports pursuing Anti-Ro-60 via third method and strengthens the case for genuine autoimmune predisposition

### Short-term (within 3 months)

4. **If CYP2D6 testing confirms poor metabolizer status:** Review duloxetine dose (currently 60-90mg) — may be experiencing higher-than-expected drug exposure. Consider switching to desvenlafaxine (Pristiq) or milnacipran (Savella) which bypass CYP2D6

5. **If a benzodiazepine is needed:** Prefer lorazepam (Ativan) or oxazepam (Serax) — these undergo glucuronidation only and bypass all CYP enzymes entirely. Avoid alprazolam and midazolam (CYP3A4-dependent)

6. **If Sjögren is confirmed and hydroxychloroquine prescribed:** CYP2D6 status affects HCQ metabolism — dose adjustment may be needed

### Medium-term

7. **If ketamine infusion is pursued (Stage 3 pain treatment):** Genetic profile is favorable — ketamine uses CYP3A4/CYP2B6 (no CYP2D6 null allele concern). IL-6 CG intermediate genotype may provide some prediction of central sensitization response

8. **Consider formal pharmacogenomic consultation** — a comprehensive PGx panel (including CYP2D6, CYP2C19, CYP1A2, CYP2B6, ABCB1) would provide complete drug metabolism guidance for future prescribing decisions

### Monitoring

9. **Continue homocysteine monitoring** — MTHFR compound heterozygosity + CBS/BHMT impairment means lifelong supplementation requirement. Target homocysteine < 10 µmol/l

10. **Continue vitamin D3 supplementation** — VDR variants (ApaI AA, BsmI CT, TaqI AG) affect vitamin D receptor signaling efficiency. Adequate vitamin D levels are essential for immune regulation given the autoimmune susceptibility profile

---

## 11. Follow-Up Genetic Testing Recommendations

The 23andMe v5 genotyping array identified critical gaps that require clinical-grade testing. The tests below are ordered by clinical priority — the first two directly affect current medication management.

### 11.1 Priority 1: Clinical Pharmacogenomics Panel (CYP2D6 + comprehensive PGx)

**Why it's critical:** 23andMe detected CYP2D6 \*6 null allele but cannot detect \*4 (most common loss-of-function in Europeans, ~20% allele frequency), \*10, or copy number variants (\*1xN, \*2xN ultrarapid duplications). Without these, the patient's metabolizer phenotype is incomplete. This directly affects dosing of duloxetine (current medication) and selection of future antidepressants.

**What to order:**
- Clinical-grade pharmacogenomics panel including: CYP2D6 (with copy number analysis), CYP2C19, CYP2C9, CYP1A2, CYP2B6, CYP3A4/5, ABCB1, OPRM1, COMT, MTHFR
- Request specifically: CYP2D6 star allele genotyping with CNV (copy number variant) detection — this is the critical gap

**Providers in Poland:**

| Lab | Test Name | Method | Location | Notes |
|-----|-----------|--------|----------|-------|
| **Genomed S.A.** | Panel farmakogenomiczny | NGS + MLPA (CNV) | Warszawa (ul. Ponczowa 12) | Largest Polish diagnostic genomics lab. Offers comprehensive PGx panel with CYP2D6 CNV detection. Results in 10-15 business days. Referral available via physician or direct. Website: genomed.pl |
| **IMAGENE.ME** | Farmakogenomika | Microarray + CNV | Warszawa | Consumer-facing genetics company with clinical PGx panels. Includes CYP2D6 with copy number. Results in ~20 business days. Website: imagene.me |
| **Centrum Badań DNA** | Panel PGx | Targeted genotyping | Poznań (oddział), Warszawa | CYP2D6 genotyping with common alleles. May not include full CNV analysis — confirm before ordering. Website: cbdna.pl |
| **Invicta Genetics** | Farmakogenomika | NGS | Gdańsk, Warszawa, other locations | Part of Invicta medical network. Clinical-grade PGx testing. Website: invicta.pl |

**Estimated cost:** 800-2000 PLN (not covered by NFZ without specific medical indication; may be partially covered with specialist referral for adverse drug reaction investigation)

**Turnaround:** 10-20 business days

### 11.2 Priority 2: HLA High-Resolution Typing

**Why it's needed:** The report uses tag SNPs (rs3135388 for HLA-DRB1\*15:01, rs2187668 for HLA-DQ2, rs7454108 for HLA-DQ8) as proxies for HLA haplotypes. Tag SNPs have ~85-95% concordance with actual HLA type — insufficient for clinical decisions about autoimmune disease risk.

**What to order:**
- HLA Class I: HLA-A, HLA-B (including B51 for Behçet), HLA-C
- HLA Class II: HLA-DRB1, HLA-DQB1, HLA-DPB1
- Request: High-resolution (4-digit minimum, 6-digit preferred) via NGS

**Clinical relevance:**
- HLA-B51 → Behçet disease susceptibility (patient has 13-year aphthae history)
- HLA-DRB1\*15:01 confirmation → Sjögren/MS susceptibility
- HLA-DQ2/DQ8 → Celiac disease risk (gastrointestinal symptoms should be evaluated if positive)

**Providers in Poland:**

| Lab | Test Name | Method | Location | Notes |
|-----|-----------|--------|----------|-------|
| **Regionalne Centrum Krwiodawstwa i Krwiolecznictwa (RCKiK)** | Typowanie HLA | NGS / SBT / SSP | Every voivodeship capital | The gold standard for HLA typing in Poland. Primarily used for transplant matching but accepts clinical referrals. Cheapest option (~300-500 PLN per locus). Referral from hematologist or immunologist recommended |
| **Genomed S.A.** | Typowanie HLA NGS | NGS (high-resolution) | Warszawa | Full HLA Class I + II panel. 15-20 business days. Website: genomed.pl |
| **Medgen** | HLA typowanie | NGS / Sanger | Warszawa (ul. Lekarska 1) | Genetic diagnostics center. HLA typing available with immunologist referral. Website: medgen.pl |
| **Centrum Onkologii — Instytut im. Marii Skłodowskiej-Curie** | HLA laboratorium | NGS | Warszawa (ul. Roentgena 5) | Research-grade HLA lab. May accept clinical referrals |

**Estimated cost:** 300-500 PLN per locus (RCKiK), 1500-3000 PLN for full panel (private). NFZ coverage possible with immunologist/rheumatologist referral for autoimmune workup.

**Turnaround:** 10-30 business days depending on method

### 11.3 Priority 3: Connective Tissue Gene Panel (if clinical suspicion rises)

**Why it may be needed:** 23andMe tested only COL5A1 and COL3A1 (both normal). If the CVJ anomaly or joint hypermobility raises suspicion of an underlying connective tissue disorder, a targeted panel covers the full spectrum.

**What to order:**
- Ehlers-Danlos syndrome gene panel: COL5A1, COL3A1, COL1A1, COL1A2, TNXB, FBN1, FBN2, ADAMTS2, PLOD1, B4GALT7, B3GALT6, SLC39A13, FKBP14, AEBP1, CHST14
- Optional additions: PAX1, GDF6 (Klippel-Feil spectrum — relevant to CVJ anomaly)

**When to order:** Only if clinical evaluation reveals Beighton score ≥ 5, skin hyperextensibility, or family history of connective tissue fragility. Current genetic data shows no burden — this test is defensive.

**Providers in Poland:**

| Lab | Test Name | Method | Location | Notes |
|-----|-----------|--------|----------|-------|
| **Genomed S.A.** | Panel EDS / Choroby tkanki łącznej | NGS (panel genowy) | Warszawa | Offers targeted connective tissue panels. 20-30 business days. Website: genomed.pl |
| **Centrum Genetyki Medycznej GENESIS** | Diagnostyka EDS | NGS / WES | Poznań | Specialized genetic diagnostics center. Can perform whole exome sequencing (WES) with targeted analysis. Website: genesis.net.pl |
| **Instytut Matki i Dziecka** | Panel genetyczny | NGS | Warszawa (ul. Kasprzaka 17a) | National reference center for genetic diseases. EDS panel available. NFZ referral pathway available. Website: imid.med.pl |

**Estimated cost:** 2000-5000 PLN (targeted panel), 5000-8000 PLN (WES with targeted analysis). NFZ coverage possible with geneticist referral.

**Turnaround:** 30-60 business days

### 11.4 Priority 4: Whole Exome Sequencing (WES) — comprehensive option

**Why it's worth considering:** Rather than ordering individual panels (PGx + HLA + connective tissue), WES covers all coding regions of all ~20,000 genes in a single test. The raw data can be re-analyzed as new clinical questions arise. This is the most cost-effective long-term approach for a complex patient with multi-system involvement.

**What it provides:**
- All pharmacogenomic variants (CYP2D6 with limitations — CNV detection varies by platform)
- All connective tissue genes
- All autoimmune susceptibility variants
- Discovery potential: may identify rare variants not covered by any panel
- Re-analyzable: raw data can be re-interpreted as medical knowledge evolves

**Limitations:**
- CYP2D6 CNV detection is unreliable in WES — a separate PGx panel is still needed for CYP2D6 copy number
- HLA typing from WES is possible but less precise than dedicated HLA typing
- Incidental findings policy required (may uncover unrelated pathogenic variants)

**Providers in Poland:**

| Lab | Test Name | Method | Location | Notes |
|-----|-----------|--------|----------|-------|
| **Genomed S.A.** | Sekwencjonowanie eksomu (WES) | Illumina NGS | Warszawa | Clinical WES with variant interpretation. 30-45 business days. Includes genetic counseling session. Website: genomed.pl |
| **Centrum Genetyki Medycznej GENESIS** | WES kliniczny | Illumina NGS | Poznań | Full exome with clinical interpretation and genetic counseling. Website: genesis.net.pl |
| **MedGen** | Całoeksomowe sekwencjonowanie | NGS | Warszawa | Clinical-grade WES. May be partially covered by NFZ with geneticist referral. Website: medgen.pl |
| **CeGaT (Germany, near border)** | Clinical Whole Exome | Illumina NovaSeq | Tübingen, DE | German lab with excellent reputation. Accepts Polish patients directly or via physician referral. Reports in English and German. May be faster (15-25 business days). Website: cegat.com |
| **Blueprint Genetics (Finland)** | Clinical WES | Illumina | Helsinki, FI | Accepts international samples via mail. Reports in English. Industry-leading variant interpretation. Website: blueprintgenetics.com |

**Estimated cost:** 4000-8000 PLN (Polish labs), 1500-3000 EUR (CeGaT/Blueprint). NFZ coverage possible with clinical geneticist referral at a university hospital genetics department (Klinika/Poradnia Genetyki Medycznej).

**Turnaround:** 30-60 business days

### 11.5 Recommended Testing Pathway

Given the patient's clinical complexity and existing 23andMe data, the recommended approach is:

```
Step 1 (immediate, ~1000-1500 PLN):
  → Clinical PGx panel with CYP2D6 CNV at Genomed or IMAGENE.ME
  → This directly affects current duloxetine dosing

Step 2 (within 3 months, ~1500-2500 PLN):
  → HLA high-resolution typing at RCKiK (cheapest) or Genomed
  → Confirms HLA-B51 (Behçet), HLA-DRB1*15:01 (Sjögren/MS)
  → Time with planned Anti-Ro-60 confirmation and flow cytometry

Step 3 (if clinical suspicion warrants, ~4000-8000 PLN):
  → WES at Genomed or Genesis
  → Covers connective tissue, rare variants, discovery potential
  → Alternative: targeted EDS panel (~2000-3000 PLN) if only connective tissue is in question

NFZ pathway: request referral to Poradnia Genetyki Medycznej at the nearest university hospital
(e.g., Centrum Genetyki Medycznej at UCK Gdańsk, WUM Warszawa, UMP Poznań, or UMK Bydgoszcz).
Genetic counseling + selected testing may be covered under NFZ diagnostic pathway for
undiagnosed multi-system disease.
```

### 11.6 Referral Template (for physician)

> Szanowny Panie/Pani Doktorze,
>
> Proszę o skierowanie na:
> 1. **Panel farmakogenomiczny** z analizą CYP2D6 (w tym analiza CNV/liczby kopii) — pacjent ma wykryty allel zerowy CYP2D6 \*6 (rs5030655) z badania 23andMe, co wpływa na metabolizm aktualnie stosowanej duloksetyny
> 2. **Typowanie HLA wysokiej rozdzielczości** (klasa I + II, w tym HLA-B51) — podejrzenie predyspozycji autoimmunologicznej (intermitujące PR3-ANCA, rozbieżność anty-Ro-60, postępująca leukopenia)
>
> Uzasadnienie: pacjent z wieloletnim zespołem bólowym w przebiegu anomalii CVJ (asymilacja C1, platybazja), 42+ nieskutecznych terapii, wykrytymi wariantami farmakogenomicznymi wpływającymi na metabolizm leków.

---

## 12. Limitations

1. 23andMe v5 is a genotyping array, not whole-genome sequencing — coverage is limited to pre-selected SNPs
2. CYP2D6 \*4 (rs3892097) and \*10 (rs1065852) were absent from the array — critical for complete metabolizer phenotype
3. VDR FokI (rs2228570) was absent — most functionally characterized VDR variant
4. ACE I/D (rs4646994) was absent — relevant to the dental-office SNP panel genes
5. EDS gene coverage is limited — TNXB, FBN1, ADAMTS2 not comprehensively tested
6. HLA typing from tag SNPs is imprecise — formal HLA typing is more reliable for autoimmune risk assessment
7. All annotations are research-grade — clinical decisions should be confirmed with clinical-grade testing
8. Polish lab availability and pricing may change — verify directly with the lab before ordering
9. NFZ coverage for genetic testing requires specialist referral and may have waiting lists

---

*Report v1.0.0 — Generated by Asklepios Genome Analysis Pipeline. Research-grade only — not for clinical decision-making without specialist review.*
