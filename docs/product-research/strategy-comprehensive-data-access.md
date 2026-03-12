# Strategy: Comprehensive Biomedical Data Access Without Building Every Integration

_Date: 2026-03-08_
_Focus: Rare diseases, endometriosis, fertility, women's health_

---

## The Problem

Asklepios currently maintains **2,364 lines** of hand-built integration code across 8 tool files, with 30 custom schemas, 14 API endpoints across 6 external services. Each integration requires:

- Custom Zod schemas that must track upstream API changes
- Per-source rate limiting (only 4/8 tools have it today)
- Fragile regex-based XML parsing (PubMed/ClinVar)
- Scattered API key management (4 different patterns)
- Duplicated code (XML parsers copy-pasted between files)
- No shared caching, circuit-breaking, or timeout handling

Meanwhile, our agents need access to **50+ databases** to do the deepest possible research on hard cases. Building each one by hand is not sustainable.

### The Dual-Use Requirement

We need these data sources accessible in **two contexts**:

1. **Inside Asklepios agents** — Mastra agents use tools programmatically during diagnostic workflows
2. **Inside personal AI agents** — Claude Code, Cursor, Claude Desktop use MCP servers directly for ad-hoc research

The architecture must serve both. MCP is the natural bridge — it's the protocol both Mastra and Claude Code speak natively.

---

## Three Strategies

### Strategy 1: MCP Server Composition via `@mastra/mcp` MCPClient

**The idea:** Replace hand-built integrations with community-maintained MCP servers. Use Mastra's `MCPClient` (from `@mastra/mcp` v1.1.0) to connect to multiple external MCP servers, and expose their tools directly to our agents. The same MCP servers are also added to `.mcp.json` for Claude Code.

**How it works (Asklepios side):**

```typescript
// src/mcp/biomedical-client.ts
import { MCPClient } from '@mastra/mcp';

export const biomedicalMcp = new MCPClient({
  id: 'asklepios-biomedical',
  servers: {
    // PRIMARY: 12 entities, 15+ sources, 21 tools
    biomcp: {
      command: 'uvx',
      args: ['biomcp-cli', 'run'],
      env: { NCBI_API_KEY: process.env.NCBI_API_KEY },
    },
    // GENOMICS: Ensembl, BLAST, enrichment, sequences
    gget: {
      command: 'uvx',
      args: ['gget-mcp'],
    },
    // GENES + VARIANTS: 22M+ genes, 400M+ variants
    biothings: {
      command: 'uvx',
      args: ['biothings-mcp'],
    },
    // PHARMACOLOGY: drug targets, ligands, interactions
    pharmacology: {
      command: 'uvx',
      args: ['pharmacology-mcp'],
    },
    // 18+ databases: STRING, Reactome, UniProt, KEGG, AlphaFold, etc.
    biocontext: {
      command: 'uvx',
      args: ['biocontext_kb'],
    },
    // Gene-disease association scoring (49 GraphQL operations)
    opentargets: {
      command: 'npx',
      args: ['-y', 'opentargets-mcp'],
    },
  },
});

// In agent definition:
export const researchAgent = new Agent({
  id: 'research-agent',
  tools: {
    ...ourCustomTools,                    // ddx-generator, brain, etc.
    ...(await biomedicalMcp.listTools()), // All MCP tools, auto-namespaced
  },
});
```

**How it works (Claude Code / personal agent side):**

```jsonc
// .mcp.json — same servers, usable by Claude Code
{
  "mcpServers": {
    "asklepios": {
      "command": "node",
      "args": ["dist/mcp/stdio.js"],
      "cwd": "/path/to/mastra-asklepios"
    },
    "biomcp": {
      "command": "uvx",
      "args": ["biomcp-cli", "mcp"],
      "env": { "NCBI_API_KEY": "${NCBI_API_KEY}" }
    },
    "biothings": {
      "command": "uvx",
      "args": ["biothings-mcp"]
    },
    "gget": {
      "command": "uvx",
      "args": ["gget-mcp"]
    },
    "pharmacology": {
      "command": "uvx",
      "args": ["pharmacology-mcp"]
    },
    "biocontext": {
      "command": "uvx",
      "args": ["biocontext_kb"]
    },
    "opentargets": {
      "command": "npx",
      "args": ["-y", "opentargets-mcp"]
    }
  }
}
```

**What this means:** You open Claude Code in this project and immediately have access to 80+ biomedical tools alongside all Asklepios tools. Same tools, same data, whether it's the agent running autonomously or you doing research manually.

**What we'd delete:** All 8 hand-built tool files (2,284 lines), the NCBI rate limiter (80 lines), and the manual BioMCP client wrapper (243 lines). Total: ~2,600 lines removed.

**What we'd keep:** Our custom tools that have no MCP equivalent:
- `ddx-generator.ts` — differential diagnosis logic
- `adversarial-synthesis.ts` — adversarial reasoning
- `brain-feed.ts` / `brain-recall.ts` — learning memory
- `document-parser.ts` — clinical document parsing
- `specialist-input.ts` — specialist consultation simulation
- `capture-data.ts` / `query-data.ts` — patient data management
- `knowledge-query.ts` — knowledge base queries
- `parallel-research.ts` — orchestration (rewired to use MCP tools)

**Pros:**
- Mastra-native — `MCPClient` handles lifecycle, namespacing (`biomcp_article_searcher`), reconnection
- Same config works for Asklepios agents AND Claude Code
- Community maintains schemas, rate limiting, API tracking
- Tools auto-discovered — no schema maintenance
- Can add/remove servers with one config line
- `listTools()` vs `listToolsets()` — static or per-request tool loading

**Cons:**
- Each MCP server is a separate subprocess (memory overhead — ~6 processes)
- No control over tool quality — must trust community
- Tool descriptions may not be optimized for our agents
- Version pinning needed

**Effort:** ~1-2 weeks to migrate + validate

---

### Strategy 2: MCP Gateway (MetaMCP) + Unified Endpoint

**The idea:** Deploy MetaMCP — an open-source MCP aggregator/gateway — that combines all biomedical MCP servers behind a single endpoint. Both Asklepios and Claude Code connect to ONE URL instead of managing N subprocesses.

**What is MetaMCP?**

MetaMCP is a Docker-based MCP proxy that aggregates multiple MCP servers into a unified endpoint. It serves four roles:

1. **Aggregator** — combines tools from many MCP servers into one catalog
2. **Orchestrator** — manages server lifecycle via a web UI
3. **Middleware** — applies auth, rate limiting, logging, transforms at namespace level
4. **Gateway** — single secure entry point for all AI agents

Key: MetaMCP itself IS an MCP server, so any MCP client connects to it without modification.

**Architecture:**

```
┌─────────────────────┐
│  Claude Code         │──┐
│  (.mcp.json)         │  │
└─────────────────────┘  │
                          │     ┌──────────────────────────┐     ┌──────────────────┐
┌─────────────────────┐  ├────▶│     MetaMCP Gateway       │────▶│  BioMCP          │
│  Asklepios Agents    │──┤     │     (Docker)              │────▶│  BioThings       │
│  (MCPClient)         │  │     │                           │────▶│  gget            │
└─────────────────────┘  │     │  • Rate limiting per tool  │────▶│  Pharmacology    │
                          │     │  • Response caching        │────▶│  BioContextAI    │
┌─────────────────────┐  │     │  • Auth (API key / OAuth)  │────▶│  Open Targets    │
│  Claude Desktop      │──┘     │  • Tool filtering          │────▶│  Holy Bio MCP    │
│  Cursor / Windsurf   │        │  • Web UI dashboard        │     │  ToolUniverse    │
└─────────────────────┘        │  • Observability/logging   │     └──────────────────┘
                                └──────────────────────────┘
```

**Asklepios config with gateway:**

```typescript
// src/mcp/biomedical-client.ts
import { MCPClient } from '@mastra/mcp';

export const biomedicalMcp = new MCPClient({
  id: 'asklepios-biomedical',
  servers: {
    gateway: {
      url: new URL('http://localhost:12008/mcp'),
      requestInit: {
        headers: { Authorization: `Bearer ${process.env.METAMCP_API_KEY}` },
      },
    },
  },
});
```

**Claude Code config with gateway:**

```jsonc
// .mcp.json — single gateway endpoint
{
  "mcpServers": {
    "asklepios": {
      "command": "node",
      "args": ["dist/mcp/stdio.js"]
    },
    "biomedical": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:12008/mcp"]
    }
  }
}
```

**MetaMCP setup:**

```bash
# One-command deploy
git clone https://github.com/metatool-ai/metamcp.git
cd metamcp && ./setup-docker.sh

# Then via the web UI at localhost:12008:
# 1. Create MCP servers (biomcp, biothings, gget, etc.)
# 2. Group them into a "biomedical" namespace
# 3. Create an endpoint with auth
# 4. Set rate limits per tool
# 5. Apply middleware (filter inactive tools, add logging)
```

**MetaMCP features relevant to us:**

| Feature | Value for Asklepios |
|---------|-------------------|
| **Namespace grouping** | Group all bio servers into one `biomedical` namespace |
| **Per-tool rate limiting** | Set max requests/window per tool — prevents API bans |
| **Tool filtering** | Show only relevant tools to agents — reduces context window usage |
| **Tool renaming** | Customize tool names/descriptions for our agents' prompts |
| **Middleware pipeline** | Add logging, validation, error handling uniformly |
| **Multi-tenancy** | Give different API keys to Asklepios vs personal use |
| **Web UI** | Visual dashboard for managing all servers |
| **SSE + Streamable HTTP** | Both transport modes supported |
| **Docker packaging** | Single `docker-compose up` to run everything |

**Pros:**
- Single connection point — simplest possible agent config
- Centralized rate limiting, caching, auth — solves all current inconsistencies
- Web UI for managing servers — add/remove without code changes
- Works with ANY MCP client (Claude Code, Cursor, Claude Desktop, Asklepios)
- Can cache repeated queries (same gene lookup across agents)
- Tool-level observability — see what every agent is querying
- Multi-tenancy — separate API keys for Asklepios app vs personal research
- Dynamic server management — add ToolUniverse tomorrow without touching code

**Cons:**
- Operational overhead — another service to deploy (Docker)
- Single point of failure (unless HA)
- Added latency (proxy hop) — typically <5ms
- More complex local dev setup
- Gateway itself needs monitoring

**Effort:** ~2-3 weeks (gateway setup + migration + testing)

---

### Strategy 3: Holy Bio MCP as Foundation + Strategic Additions

**The idea:** Use Holy Bio MCP as a curated, pre-integrated biomedical platform — it already bundles 5 specialized MCP servers with 51+ tools — then add BioMCP and BioContextAI for the remaining gaps.

**What is Holy Bio MCP?**

Holy Bio MCP is a unified framework from the Longevity Genie project (IBIMA / Systems Biology of Aging Group), born during the Bio x AI Hackathon-2025. It aggregates specialized MCP servers into a cohesive bioinformatics ecosystem.

**The 5 servers in Holy Bio MCP:**

| Server | What it provides | Install |
|--------|-----------------|---------|
| **gget-mcp** | Ensembl search, gene info, sequences, BLAST, enrichment analysis | `uvx gget-mcp` |
| **biothings-mcp** | MyGene.info (22M+ genes), MyVariant.info (400M+ variants), MyChem.info | `uvx biothings-mcp` |
| **opengenes-mcp** | OpenGenes aging/longevity database (auto-downloads from HuggingFace) | `uvx opengenes-mcp` |
| **synergy-age-mcp** | Synergistic/antagonistic genetic interactions in longevity | `uvx synergy-age-mcp` |
| **pharmacology-mcp** | Guide to PHARMACOLOGY — drug targets, ligands, interactions, diseases | `uvx pharmacology-mcp` |

**Why Holy Bio MCP matters:**

1. **Unified config** — provides pre-made `mcp-config.json` files that enable all servers at once
2. **Data freshness** — OpenGenes and SynergyAge auto-download latest databases from HuggingFace Hub
3. **SQL-queryable** — OpenGenes and SynergyAge expose SQLite databases with `_db_query()` tools — allows arbitrary queries, not just pre-built endpoints
4. **Actively maintained** — award-winning project with academic backing (IBIMA, Rostock)
5. **51+ tools total** — but each server is independently installable

**The full stack — Holy Bio MCP + BioMCP + BioContextAI + Open Targets:**

```typescript
import { MCPClient } from '@mastra/mcp';

export const biomedicalMcp = new MCPClient({
  id: 'asklepios-biomedical',
  servers: {
    // === PRIMARY DATA LAYER ===
    // BioMCP: PubMed, ClinVar, ClinicalTrials, OpenFDA, variants, drugs
    biomcp: {
      command: 'uvx',
      args: ['biomcp-cli', 'run'],
      env: { NCBI_API_KEY: process.env.NCBI_API_KEY },
    },

    // === HOLY BIO MCP SUITE ===
    // Genomics: Ensembl, BLAST, enrichment, sequences
    gget: {
      command: 'uvx',
      args: ['gget-mcp'],
    },
    // Genes + Variants: 22M+ genes, 400M+ variants, chemicals
    biothings: {
      command: 'uvx',
      args: ['biothings-mcp'],
    },
    // Pharmacology: drug targets, ligands, interactions
    pharmacology: {
      command: 'uvx',
      args: ['pharmacology-mcp'],
    },
    // Aging/longevity: gene-lifespan data, criteria, hallmarks
    opengenes: {
      command: 'uvx',
      args: ['opengenes-mcp'],
    },
    // Genetic interactions: synergistic/antagonistic effects
    synergyage: {
      command: 'uvx',
      args: ['synergy-age-mcp'],
    },

    // === GAP FILLERS ===
    // 18+ databases: STRING, Reactome, UniProt, KEGG, AlphaFold, HPA
    biocontext: {
      command: 'uvx',
      args: ['biocontext_kb'],
    },
    // Gene-disease scoring: 22+ evidence sources, 49 GraphQL ops
    opentargets: {
      command: 'npx',
      args: ['-y', 'opentargets-mcp'],
    },
  },
});
```

**And the matching `.mcp.json` for Claude Code:**

```jsonc
{
  "mcpServers": {
    "asklepios": {
      "command": "node",
      "args": ["dist/mcp/stdio.js"],
      "cwd": "/Users/andrzej/Documents/GitHub/mastra-asklepios"
    },
    "biomcp": {
      "command": "uvx",
      "args": ["biomcp-cli", "mcp"],
      "env": { "NCBI_API_KEY": "${NCBI_API_KEY}" }
    },
    "gget": { "command": "uvx", "args": ["gget-mcp"] },
    "biothings": { "command": "uvx", "args": ["biothings-mcp"] },
    "pharmacology": { "command": "uvx", "args": ["pharmacology-mcp"] },
    "opengenes": { "command": "uvx", "args": ["opengenes-mcp"] },
    "synergy-age": { "command": "uvx", "args": ["synergy-age-mcp"] },
    "biocontext": { "command": "uvx", "args": ["biocontext_kb"] },
    "opentargets": { "command": "npx", "args": ["-y", "opentargets-mcp"] }
  }
}
```

**Coverage for our focus areas:**

| Area | Sources (with this stack) |
|------|--------------------------|
| **Endometriosis** | PubMed + bioRxiv (BioMCP), Reactome/KEGG pathways (BioContextAI), gene-disease associations (Open Targets), drug interactions (Pharmacology MCP), clinical trials (BioMCP), STRING protein interactions (BioContextAI), variant analysis (BioThings — 400M variants) |
| **Rare Diseases** | ClinVar + CIViC + COSMIC (BioMCP), Orphanet (BioContextAI), Open Targets disease scoring, HPO phenotypes (BioMCP), gene enrichment (gget), OMIM (BioMCP) |
| **Fertility** | ClinicalTrials.gov (BioMCP), drug safety (BioMCP OpenFDA), pharmacology data (Pharmacology MCP), PubMed literature, gene expression (gget Ensembl), UniProt protein data (BioContextAI) |
| **Women's Health** | OpenFDA adverse events (BioMCP), drug interactions (Pharmacology MCP), clinical guidelines, literature (PubMed), gene-disease associations (Open Targets) |
| **Genomics/Variants** | ClinVar (BioMCP), MyVariant.info 400M variants (BioThings), Ensembl (gget), BLAST sequences (gget), gene enrichment pathways (gget), AlphaFold structures (BioContextAI) |
| **Drug Analysis** | OpenFDA (BioMCP), Guide to PHARMACOLOGY targets/ligands/interactions (Pharmacology MCP), drug-gene interactions (Open Targets), adverse events (BioMCP) |
| **Aging/Longevity** | OpenGenes gene-lifespan data (SQL-queryable), SynergyAge genetic interactions, gene hallmarks of aging |

**Pros:**
- Academic-quality tools with proper validation
- SQL-queryable databases (OpenGenes, SynergyAge) — not just REST wrappers
- Auto-updating data from HuggingFace Hub — always fresh
- Same tools available to both Asklepios agents and Claude Code via `.mcp.json`
- Each server independently installable — pick what you need
- 80+ unique tools across all servers
- Covers 50+ unique databases

**Cons:**
- 8 MCP server subprocesses — memory overhead
- No centralized rate limiting (each server manages its own)
- Tool name collisions possible without gateway namespacing
- Some overlap between BioMCP and BioThings (variants) — redundant but not harmful

**Effort:** ~1 week to set up + validate

---

## Recommendation

### Phase 1 (Week 1): Strategy 3 — Maximum Coverage, Minimum Effort

Start with the full stack: BioMCP + Holy Bio MCP suite + BioContextAI + Open Targets. This gives you:

- **80+ biomedical tools**
- **50+ unique databases**
- **Zero hand-built integration code** (delete 2,600 lines)
- **Dual-use** — same servers work in Asklepios AND Claude Code

The `@mastra/mcp` MCPClient handles everything: connection lifecycle, tool namespacing (prevents conflicts), auto-discovery. Mastra's `listTools()` gives all tools to agents. The `.mcp.json` gives the same tools to Claude Code.

### Phase 2 (Week 2-3): Add MetaMCP Gateway

Once running, deploy MetaMCP to solve the operational gaps:

- **Rate limiting** — prevent API bans across all servers centrally
- **Caching** — same endometriosis gene query hit 5 times? Cached after the first
- **Tool filtering** — give research-agent only research tools, not all 80+
- **Observability** — see what every agent queries, measure latency, find bottlenecks
- **Single endpoint** — replace 8 subprocess configs with 1 URL

The migration is seamless: MCPClient config changes from 8 servers to 1 gateway URL. `.mcp.json` changes similarly. No agent logic changes.

### Phase 3 (Ongoing): Expand as needed

- **ToolUniverse** (211 drug/treatment tools) — add when treatment reasoning depth is needed
- **Medical MCP** (NICE guidelines) — add for evidence-based treatment pathways
- **DICOM MCP** — add if imaging analysis enters scope (ultrasound/MRI for endometriosis)

---

## The Key Architecture: Build Once, Use Everywhere

```
┌──────────────────────────────────────────────────────┐
│                    MCP Servers                         │
│                                                        │
│  BioMCP · BioThings · gget · Pharmacology · OpenGenes │
│  SynergyAge · BioContextAI · Open Targets             │
│                                                        │
│  (community-maintained, open-source, auto-updating)    │
└──────────────────┬─────────────────┬──────────────────┘
                   │                 │
        ┌──────────┴──────┐   ┌─────┴───────────────┐
        │                 │   │                      │
        ▼                 ▼   ▼                      ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Asklepios   │  │ Claude Code  │  │ Claude Desktop   │
│  Agents      │  │ (your        │  │ / Cursor /       │
│              │  │  personal    │  │ Windsurf         │
│ MCPClient    │  │  research)   │  │                  │
│ .listTools() │  │              │  │                  │
│              │  │ .mcp.json    │  │ config.json      │
└──────────────┘  └──────────────┘  └──────────────────┘
```

The MCP servers are the **shared infrastructure**. They don't care who's calling — Asklepios agent, Claude Code, or Claude Desktop. Same data, same tools, same protocol.

Our custom tools (ddx-generator, brain memory, adversarial synthesis) remain Mastra-native and are ALSO exposed as MCP via our existing MCPServer in `src/mcp/`. So Claude Code gets both: community biomedical tools + Asklepios-specific tools.

---

## Appendix: Database Coverage Matrix

| Database | Hand-Built | BioMCP | Holy Bio (5 servers) | BioContextAI | Open Targets |
|----------|:----------:|:------:|:--------------------:|:------------:|:------------:|
| PubMed / PubTator3 | ✅ | ✅ | | ✅ (EuropePMC) | |
| ClinVar | ✅ | ✅ | | | |
| ClinicalTrials.gov | ✅ | ✅ | | ✅ | |
| OpenFDA | ✅ | ✅ | | ✅ | |
| Orphanet | ✅ | | | ✅ | |
| HPO (JAX) | ✅ | ✅ | | | |
| OMIM | ✅ (partial) | | | | |
| bioRxiv / medRxiv | | ✅ | | ✅ | |
| MyVariant.info (400M+) | | ✅ | ✅ (biothings) | | |
| MyGene.info (22M+) | | ✅ | ✅ (biothings) | | |
| MyChem.info | | | ✅ (biothings) | | |
| CIViC | | ✅ | | | |
| COSMIC | | ✅ | | | |
| dbSNP | | ✅ | | | |
| cBioPortal | | ✅ | | | |
| Ensembl | | | ✅ (gget) | ✅ | |
| BLAST | | | ✅ (gget) | | |
| g:Profiler enrichment | | ✅ | ✅ (gget) | | |
| Guide to PHARMACOLOGY | | | ✅ (pharmacology) | | |
| OpenGenes (aging) | | | ✅ (opengenes) | | |
| SynergyAge | | | ✅ (synergy-age) | | |
| STRING (protein) | | | | ✅ | |
| Reactome (pathways) | | | | ✅ | |
| KEGG | | | | ✅ | |
| UniProt | | | | ✅ | |
| AlphaFold | | | | ✅ | |
| Human Protein Atlas | | | | ✅ | |
| InterPro | | | | ✅ | |
| OLS (ontologies) | | | | ✅ | |
| Google Scholar | | | | ✅ | |
| PRIDE | | | | ✅ | |
| Antibody Registry | | | | ✅ | |
| Gene-disease scoring | | | | | ✅ |
| Drug targets | | | | | ✅ |
| Evidence scoring | | | | | ✅ |
| 22+ integrated sources | | | | | ✅ |
| **Unique sources** | **6** | **~15** | **~10** | **~18** | **~22** |

**Combined coverage (Strategy 3 full stack):** **50+ unique databases** via 8 MCP servers
**After adding ToolUniverse:** **60+ unique databases** with 211 additional drug/treatment tools
