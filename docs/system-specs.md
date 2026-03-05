# Asklepios — System Specifications

> Rare Disease Research Agent with Diagnostic Odyssey Compression

**Version:** 0.1.0 (MVP)
**Status:** Core implementation complete, pre-production

---

## Overview

Asklepios is a multi-agent AI system that helps patients with rare diseases compress their "diagnostic odyssey" (avg 5.6 years) by combining deep multi-source research, document analysis, phenotype mapping, and a conversational interface.

The killer feature is **Cross-Patient Observational Memory** — powered by Mastra's Observational Memory, the agent accumulates diagnostic wisdom across every patient case it researches. After 50+ cases, it carries compressed, prioritized observations about patterns, misdiagnoses, and successful diagnostic paths forward permanently.

---

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js (ESM-only) | >=22.0.0 |
| Language | TypeScript (strict mode) | ^5.7.0 |
| Framework | Mastra | @mastra/core ^1.9.0 |
| Memory | Mastra Memory (Observational + Working) | @mastra/memory ^1.6.0 |
| Storage | LibSQL (SQLite) | @mastra/libsql ^1.6.3 |
| LLM | Claude Sonnet 4 via @ai-sdk/anthropic | ^3.0.56 |
| Validation | Zod | ^4.3.6 |
| Linting | Biome v2 | ^2.0.0 |
| Testing | Jest + ts-jest (ESM) | ^29.7.0 |

---

## Architecture

```
src/
├── agents/                    # 4 specialized agents
│   ├── asklepios.ts           # Central orchestrator (5 tools, all routing)
│   ├── research-agent.ts      # Literature search specialist (3 tools)
│   ├── phenotype-agent.ts     # HPO symptom mapping specialist (2 tools)
│   └── synthesis-agent.ts     # Evidence synthesis & hypothesis ranking (no tools, pure reasoning)
├── tools/                     # 5 external API integrations
│   ├── pubmed-search.ts       # NCBI PubMed eUtils API
│   ├── orphanet-lookup.ts     # Orphanet rare disease database
│   ├── hpo-mapper.ts          # Human Phenotype Ontology API
│   ├── document-parser.ts     # Medical document extraction (local)
│   └── deep-research.ts       # Multi-source parallel research synthesis
├── workflows/                 # 2 multi-step orchestration pipelines
│   ├── patient-intake.ts      # Document → parse → phenotype → review
│   └── diagnostic-research.ts # Parallel research → synthesis → hypotheses
├── processors/                # 3 safety guardrails
│   ├── medical-disclaimer.ts  # Injects research-only disclaimers
│   ├── evidence-quality.ts    # Enforces citations + confidence levels
│   └── pii-redactor.ts        # HIPAA-compliant PII redaction
├── utils/
│   ├── anthropic-provider.ts  # Auth: env var or Claude Code credentials
│   └── logger.ts              # Structured logging (debug/info/warn/error)
├── memory.ts                  # Shared Memory + Storage instances
├── mastra.ts                  # Mastra instance (agent/workflow registry)
├── cli.ts                     # Interactive REPL entry point
├── cli-utils.ts               # CLI session management & command parsing
└── index.ts                   # Library export
```

---

## Agents

| Agent | Role | Tools | Model |
|-------|------|-------|-------|
| **Asklepios** | Central orchestrator; routes to sub-agents, coordinates research | pubmedSearch, orphanetLookup, hpoMapper, documentParser, deepResearch | claude-sonnet-4 |
| **Research Agent** | Deep literature search across medical databases | pubmedSearch, orphanetLookup, deepResearch | claude-sonnet-4 |
| **Phenotype Agent** | Symptom extraction & HPO term standardization | hpoMapper, documentParser | claude-sonnet-4 |
| **Synthesis Agent** | Evidence synthesis, hypothesis ranking, self-reflection | _(none — pure reasoning)_ | claude-sonnet-4 |

All agents share a single Memory instance with cross-patient observational learning.

---

## Memory System

### Observational Memory (Killer Feature)
- **Observer agent**: Compresses conversations into dense observation logs at 20K message tokens
- **Reflector agent**: Consolidates observations at 40K observation tokens
- **Scope**: Resource-level (spans all threads for a patient)
- **Cross-patient learning**: Uses shared `asklepios-knowledge` resource ID for accumulated diagnostic wisdom

### Working Memory
- Resource-scoped template tracking: Patient ID, Key Symptoms, HPO Terms, Current Hypotheses, Evidence Summary, Research Status
- Persists structured context across conversation threads

### Conversation History
- Last 20 messages retained per thread
- Thread-per-conversation, resource-per-patient model

---

## Tools

| Tool | Data Source | Purpose |
|------|-----------|---------|
| `pubmedSearch` | NCBI eUtils API | Search medical literature (articles, case reports, trials) |
| `orphanetLookup` | Orphanet API | Rare disease database lookup (genes, inheritance, prevalence) |
| `hpoMapper` | HPO API | Map free-text symptoms → standardized HPO terms with confidence |
| `documentParser` | Local processing | Parse medical documents → structured data (sections, labs, demographics) |
| `deepResearch` | Multi-source | Parallel research synthesis with evidence levels and gap analysis |

---

## Workflows

### Patient Intake (`patient-intake`)
1. **Parse document** — Extract structured data from medical records
2. **Map phenotypes** — Convert symptoms to HPO terms with confidence scores
3. **Prepare output** — Flag low-confidence mappings for human review

### Diagnostic Research (`diagnostic-research`)
1. **Build research queries** — Generate targeted queries from symptoms/HPO terms
2. **Parallel research** — Simultaneous PubMed + Orphanet + deep research
3. **Generate hypotheses** — Rank diagnostic hypotheses with evidence chains

---

## Safety Processors

| Processor | Type | Function |
|-----------|------|----------|
| `medicalDisclaimer` | Input | Injects "research assistant, not a doctor" disclaimer into system messages |
| `evidenceQuality` | Output | Flags low confidence (<30%), enforces citation requirements |
| `piiRedactor` | Input | HIPAA-compliant PII detection and redaction (names, SSN, DOB, addresses) |

---

## CLI Interface

Interactive REPL for direct agent interaction:

```bash
npm start                        # Launch REPL
npm start -- --patient marfan-42 # Launch with patient context
```

### Commands
| Command | Action |
|---------|--------|
| `/help` | Show available commands |
| `/patient <id>` | Switch patient context (new thread) |
| `/thread <id>` | Switch to specific thread |
| `/new` | Start new conversation thread |
| `/status` | Show current session info |
| `/quit` | Exit |

---

## Testing

- **144 tests** across 18 test suites
- Colocated test files (`*.test.ts` next to source)
- Coverage: tools (schema validation + execution), agents (config verification), workflows (schema + structure), processors (input/output behavior), CLI (command parsing + session management)

---

## Authentication

Two modes via `ASKLEPIOS_AUTH` env var or `--auth` flag:

1. **`env`** (default): Uses `ANTHROPIC_API_KEY` environment variable
2. **`claude-code`**: Reads OAuth token from macOS Keychain (`Claude Code-credentials`)

---

## Storage

- **Engine**: LibSQL (SQLite-based, file: `asklepios.db`)
- **Config**: `ASKLEPIOS_DB_URL` env var or default `file:asklepios.db`
- **Domains**: Memory (threads, messages, observations), Workflows (execution state), Agents (stored configs)
- **Zero infrastructure**: No external database required for MVP
