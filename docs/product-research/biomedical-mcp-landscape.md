# Biomedical MCP Servers & Open-Source Tools — Landscape Research

_Date: 2026-03-08_

## Context

Asklepios currently has hand-built integrations for: PubMed, ClinVar, OpenFDA, Orphanet, Clinical Trials, HPO mapping. Each requires its own rate limiter, schema, error handling, and ongoing maintenance. This document catalogues the most powerful open-source biomedical tools and MCP servers available today.

---

## Tier 1: Must-Have (Highest Value)

### 1. Open Targets Platform MCP

- **GitHub**: `opentargets/open-targets-platform-mcp` / `nickzren/opentargets-mcp`
- **What**: Gene-disease association scoring, drug target prioritization, evidence from 22+ integrated sources. Wraps 49 GraphQL operations.
- **Released by**: Open Targets in collaboration with Anthropic (official).
- **Install**: npm/uvx based MCP server
- **Gap it fills**: Systematic target-disease association scoring — the "why" behind a diagnosis. Critical for rare disease work.

### 2. ToolUniverse (Harvard / Zitnik Lab)

- **GitHub**: `mims-harvard/ToolUniverse`
- **What**: 211 biomedical tools covering drugs, diseases, pharmacology, adverse events, safety, clinical lab info, biological annotations. Integrates 1000+ ML models, datasets, APIs, and scientific packages. Linked to all US FDA-approved drugs since 1939, Open Targets, and Monarch.
- **Install**: `uvx tooluniverse`
- **Gap it fills**: Drug interactions, contraindications, pharmacology, treatment reasoning. Massive breadth.

### 3. BioContextAI Knowledgebase MCP

- **GitHub**: `biocontext-ai/knowledgebase-mcp`
- **What**: Single MCP server providing unified access to 18+ databases: STRINGDb, Open Targets, Reactome, UniProt, Human Protein Atlas, PanglaoDb, EuropePMC, AlphaFold, OLS, Ensembl, KEGG, OpenFDA, ClinicalTrials.gov, bioRxiv, Google Scholar, InterPro, PRIDE, Antibody Registry.
- **Install**: `uvx biocontext_kb@latest`
- **Gap it fills**: Protein interactions (STRING), pathways (Reactome/KEGG), protein structures (AlphaFold), ontologies (OLS) — all through one server.

---

## Tier 2: Very Useful Complements

### 4. gget MCP (Longevity Genie)

- **GitHub**: `longevity-genie/gget-mcp`
- **What**: Bioinformatics toolkit — Ensembl search, gene info, sequence retrieval, reference genomes, BLAST, enrichment analysis.
- **Gap it fills**: Genomics deep-dive — sequence analysis, gene enrichment, pathway analysis.

### 5. BioThings MCP

- **GitHub**: `longevity-genie/biothings-mcp` / `Augmented-Nature/BioThings-MCP-Server`
- **What**: MyGene.info (22M+ genes, 22K+ species), MyVariant.info (400M+ human variants), MyChem.info. Batch queries up to 1000 items.
- **Gap it fills**: Massive gene/variant annotation at scale — far broader variant coverage than ClinVar alone.

### 6. Medical MCP (NICE Guidelines)

- **GitHub**: `chris-lovejoy/medical-mcp`
- **What**: Access to NICE (National Institute for Health and Care Excellence) clinical guidelines.
- **Gap it fills**: Evidence-based treatment guidelines and clinical pathways.

### 7. Guide to PHARMACOLOGY MCP

- **GitHub**: `longevity-genie/holy-bio-mcp` (part of Holy Bio MCP suite)
- **What**: Comprehensive pharmacological data — targets, ligands, interactions, diseases, families.
- **Gap it fills**: Pharmacology depth beyond what OpenFDA provides.

---

## Tier 3: Specialty / Future Expansion

### 8. DICOM MCP

- **What**: MCP server for medical imaging (DICOM format).
- **Relevance**: If Asklepios ever needs imaging analysis (e.g., endometriosis ultrasound/MRI findings).

### 9. OmniPath MCP

- **What**: 150+ resources for molecular interactions, pathways, biological annotations. SQL-queryable.
- **Relevance**: Deep molecular pathway analysis for rare disease mechanisms.

### 10. OMOP MCP

- **What**: Map clinical terminology to OMOP concepts for healthcare data standardization.
- **Relevance**: Interoperability with EHR systems and standardized clinical data.

---

## Aggregation Projects

### Holy Bio MCP (Super-Bundle)

- **GitHub**: `longevity-genie/holy-bio-mcp`
- **What**: Aggregates multiple standalone MCP servers into one ecosystem. 51+ specialized bioinformatics tools.
- **Value**: One install, many databases.

### BioContextAI Registry

- **URL**: https://biocontext.ai/registry
- **What**: Community-driven registry of biomedical MCP servers (52+ catalogued). Follows FAIR4RS principles.
- **Value**: Discovery layer — "App Store" for biomedical MCP servers.

---

## Relevance to Asklepios Focus Areas

| Area | Most Relevant Tools |
|------|-------------------|
| **Rare Diseases** | Open Targets, Orphanet (existing), ToolUniverse, BioThings, OmniPath |
| **Endometriosis** | PubMed (existing), NICE Guidelines, Open Targets, Reactome pathways |
| **Fertility** | NICE Guidelines, ToolUniverse (drug safety), Clinical Trials (existing) |
| **Women's Health** | OpenFDA (existing), ToolUniverse, NICE Guidelines |
| **Genomics/Variants** | ClinVar (existing), BioThings, gget, Ensembl |
| **Drug Interactions** | ToolUniverse, Guide to PHARMACOLOGY, OpenFDA (existing) |

---

## Key Insight

The biggest gap is not individual databases — it's the **integration burden**. Asklepios currently maintains custom code for each source (rate limiters, schemas, parsers, error handling). The MCP ecosystem offers a path to access 50+ databases through standardized protocols without building each integration.

See: `strategy-comprehensive-data-access.md` for proposed approaches.
