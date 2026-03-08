# Asklepios — System Specifications

> Rare Disease Research Agent with Diagnostic Odyssey Compression

**Version:** 0.4.0
**Status:** Core implementation + Phase 8 enhancements + Ink TUI + Phase 9 medical research validation tools

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
| Embeddings | OpenAI text-embedding-3-small via @ai-sdk/openai | latest |
| Validation | Zod | ^4.3.6 |
| Terminal UI | Ink (React for CLI) + @inkjs/ui | ink ^6.8.0, react ^19.2.4 |
| Linting | Biome v2 | ^2.4.4 |
| Testing | Jest + ts-jest (ESM) | ^29.7.0 |

---

## Architecture

```
src/
├── agents/                    # 9 specialized agents
│   ├── asklepios.ts           # Central orchestrator (5 tools + network routing to 8 sub-agents)
│   ├── research-agent.ts      # Literature search specialist (7 tools)
│   ├── phenotype-agent.ts     # HPO symptom mapping specialist (2 tools)
│   ├── hypothesis-agent.ts    # Hypothesis generation with tier-weighted scoring (3 tools)
│   ├── synthesis-agent.ts     # Evidence synthesis & hypothesis ranking (no tools, pure reasoning)
│   ├── interview-agent.ts     # Diagnostic interview questions (3 tools)
│   ├── followup-agent.ts      # Follow-up question generation (2 tools)
│   ├── report-agent.ts        # Three-register deliverables (3 tools)
│   └── brain-agent.ts         # Cross-patient intelligence (no tools, pure reasoning)
├── tools/                     # 17 tool integrations
│   ├── pubmed-search.ts       # NCBI PubMed eUtils API — 4 modes: keyword, PMID lookup, batch, citedBy
│   ├── clinvar-lookup.ts      # NCBI ClinVar variant pathogenicity database
│   ├── orphanet-lookup.ts     # Orphanet rare disease database
│   ├── hpo-mapper.ts          # Human Phenotype Ontology API
│   ├── document-parser.ts     # Medical document extraction (local)
│   ├── deep-research.ts       # Multi-source research synthesis (PubMed + OMIM)
│   ├── clinical-trials.ts     # ClinicalTrials.gov API v2 (search + NCT ID lookup) [Phase 9]
│   ├── openfda-lookup.ts      # OpenFDA drug adverse events + labeling [Phase 9]
│   ├── evidence-search.ts     # Cochrane/systematic review evidence search with PICO [Phase 9]
│   ├── ddx-generator.ts       # Differential diagnosis generator (Isabel API + pattern matching) [Phase 9]
│   ├── capture-data.ts        # Write structured clinical records
│   ├── query-data.ts          # Read structured clinical records
│   ├── knowledge-query.ts     # Semantic search over documents
│   ├── brain-feed.ts          # Feed anonymized observations to brain
│   ├── brain-recall.ts        # Query cross-patient patterns
│   ├── parallel-research.ts   # Parallel.ai ultra-deep research
│   └── adversarial-synthesis.ts # Three-perspective adversarial analysis
├── workflows/                 # 2 multi-step orchestration pipelines
│   ├── patient-intake.ts      # Document → parse → phenotype → review
│   └── diagnostic-research.ts # Parallel research → synthesis → hypotheses
├── processors/                # 3 safety guardrails
│   ├── medical-disclaimer.ts  # Injects research-only disclaimers
│   ├── evidence-quality.ts    # Enforces citations + confidence levels
│   └── pii-redactor.ts        # HIPAA-compliant PII redaction
├── mcp/                       # MCP server — full AI-testable control plane
│   ├── server.ts              # Thin orchestrator (calls register functions)
│   ├── tools-core.ts          # 6 core tools (chat, search, lookup, map, recall)
│   ├── tools-agents.ts        # 8 agent invocation tools
│   ├── tools-workflows.ts     # 3 workflow execution + resume tools
│   ├── tools-state.ts         # 5 state inspection + raw tool access
│   ├── tools-validation.ts    # 4 validation tools (clinical trials, OpenFDA, evidence, DDx) [Phase 9]
│   ├── tools-research.ts      # 2 advanced research tools (parallel, adversarial)
│   ├── tools-clinical.ts      # 4 clinical data tools
│   ├── tools-tasks.ts         # 2 task-based tools for long-running operations
│   ├── resources.ts           # 7 resources (patient, system, agent)
│   ├── prompts.ts             # 4 prompts (diagnostic workflows, testing)
│   └── stdio.ts               # StdioServerTransport entry point
├── utils/
│   ├── anthropic-provider.ts  # Auth: env var or Claude Code credentials
│   ├── model-router.ts        # Tiered model routing (Haiku/Sonnet/Opus)
│   ├── logger.ts              # Structured logging (debug/info/warn/error)
│   ├── stderr-logger.ts       # StderrLogger — redirects framework logs to stderr
│   ├── usage-tracker.ts       # Token usage tracking per session
│   ├── observability.ts       # Tracing callbacks for agent execution
│   ├── ncbi-rate-limiter.ts   # Shared NCBI eUtils rate limiter with exponential backoff
│   └── max-steps.ts           # Dynamic maxSteps resolution based on query complexity
├── memory.ts                  # Shared Memory + Storage instances
├── tui/                       # Ink TUI components (split-pane terminal UI)
│   ├── App.tsx                # Root component (session, keyboard shortcuts)
│   ├── Header.tsx             # Status bar (patient, thread, mode, tokens)
│   ├── ConversationPane.tsx   # Scrollable message list with streaming
│   ├── MessageBubble.tsx      # Role-based message styling
│   ├── InputBar.tsx           # TextInput with slash command support
│   ├── useAsklepios.ts        # Hook encapsulating agent interaction logic
│   └── types.ts               # Shared Message interface
├── mastra.ts                  # Mastra instance (agent/workflow registry)
├── cli-core.ts                # Event-based streaming (shared by REPL + TUI)
├── cli.ts                     # Interactive REPL entry point (fallback)
├── cli-utils.ts               # CLI session management & command parsing
├── tui.tsx                    # TUI entry point (default)
└── index.ts                   # Library export
```

---

## Agents

| Agent | Role | Tools | Model |
|-------|------|-------|-------|
| **Asklepios** | Central orchestrator; routes to 8 sub-agents via network mode | captureData, queryData, knowledgeQuery, brainRecall, brainFeed | Dynamic (Haiku/Sonnet/Opus via model router) |
| **Research Agent** | Literature search across 7 medical databases | pubmedSearch, orphanetLookup, clinvarLookup, deepResearch, clinicalTrials, openfdaLookup, evidenceSearch | claude-sonnet-4 |
| **Phenotype Agent** | Symptom extraction & HPO term standardization | hpoMapper, documentParser | claude-sonnet-4 |
| **Hypothesis Agent** | Preliminary hypothesis generation with tier-weighted scoring + independent DDx | queryData, captureData, knowledgeQuery, ddxGenerator | claude-sonnet-4 |
| **Interview Agent** | Diagnostic interview question generation from evidence gaps | queryData, captureData, knowledgeQuery | claude-sonnet-4 |
| **Followup Agent** | Follow-up question generation | queryData, captureData | claude-sonnet-4 |
| **Report Agent** | Three-register deliverables (technical, accessible, structured) | queryData, captureData, brainFeed | claude-sonnet-4 |
| **Synthesis Agent** | Evidence synthesis, hypothesis ranking, self-reflection | _(none — pure reasoning)_ | claude-sonnet-4 |
| **Brain Agent** | Cross-patient pattern recognition, differential reasoning | _(none — pure reasoning)_ | claude-sonnet-4 |

All 9 agents share a single Memory instance with cross-patient observational learning.

### Brain Agent (Cross-Patient Intelligence)

The brain agent is a specialized reasoning agent that identifies cross-patient patterns without direct tool access. It is invoked via the `brainRecall` and `brainFeed` tools by the Asklepios orchestrator to:
- Recognize symptom patterns seen across multiple patient cases
- Suggest differential diagnoses based on accumulated diagnostic wisdom
- Flag potential misdiagnoses by comparing against resolved cases

### Agent Network (Multi-Agent Orchestration)

Asklepios supports **network mode** via Mastra's `agent.network()` API. In network mode, the orchestrator agent dynamically routes tasks to specialized sub-agents based on the user's intent:

| Sub-Agent | When Routed To |
|-----------|---------------|
| phenotype-agent | Extracting symptoms from documents, mapping to HPO terms |
| research-agent | Literature searches: PubMed, ClinVar, ClinicalTrials.gov, OpenFDA, Cochrane, Orphanet |
| hypothesis-agent | Generating preliminary hypothesis set with tier-weighted confidence |
| interview-agent | Generating diagnostic interview questions from evidence gaps |
| synthesis-agent | Combining evidence into ranked diagnostic hypotheses |
| followup-agent | Generating follow-up questions |
| report-agent | Creating deliverables in technical/accessible/structured format |
| asklepios-brain | Cross-patient pattern matching and wisdom recall |

**Routing strategy**: phenotype extraction → brain recall → research → hypothesis → interview → synthesis → followup → report → brain feed

Toggle network mode in the CLI with `/network`. The `[net]` indicator appears in the prompt when active.

**Configuration**: `maxSteps: dynamic` (resolved per query via `resolveMaxSteps()` — see Dynamic maxSteps below), routing instructions guide agent selection, `onIterationComplete` callback logs routing decisions to stderr for observability.

---

## Memory System

### Observational Memory (Killer Feature)
- **Observer agent**: Compresses conversations into dense observation logs at 20K message tokens
- **Reflector agent**: Consolidates observations at 40K observation tokens
- **Scope**: Resource-level (spans all threads for a patient)
- **Cross-patient learning**: Uses shared `asklepios-knowledge` resource ID for accumulated diagnostic wisdom

### Working Memory (SchemaWorkingMemory)

Schema-based structured state for each patient using `patientProfileSchema` (Zod). The agent fills this via the framework's `update-working-memory` tool using **merge semantics**.

**PatientProfile fields:** `patientId`, `demographics` (nested object), `symptoms` (array), `medications` (array), `hpoTerms` (array), `diagnoses` (nested object with confirmed/suspected/ruledOut), `hypotheses` (array), `pendingTests` (array), `visits` (array), `lastUpdated`.

**Merge semantics** (validated via `scripts/test-working-memory.ts`):
- **Partial updates preserve existing fields** — only changed fields need to be sent
- **Arrays are REPLACED entirely** — `symptoms`, `hpoTerms`, `medications`, `hypotheses`, `visits`, `pendingTests` are overwritten when sent; always include the full array
- **Nested objects are recursively merged** — `demographics`, `diagnoses` merge sub-fields; only changed sub-fields need to be sent
- **Setting a field to `null` removes it** — useful for clearing stale data
- **Empty updates are no-ops** — sending `{}` changes nothing

**Scope:** `resource` — persists across all threads for the same patient. Switching threads within the same patient preserves working memory.

### Conversation History
- Last 20 messages retained per thread
- Thread-per-conversation, resource-per-patient model

---
## Tools

### Core Research Tools (7)

| Tool | Data Source | Purpose |
|------|-----------|---------| 
| `pubmedSearch` | NCBI eUtils API | Search medical literature — 4 modes: keyword search, PMID lookup, batch PMID verification, citedBy queries. Returns full abstracts, MeSH terms, publication types via efetch. |
| `clinvarLookup` | NCBI ClinVar API | Look up genetic variant pathogenicity, clinical significance, review status |
| `orphanetLookup` | Orphanet API | Rare disease database lookup (genes, inheritance, prevalence) |
| `deepResearch` | PubMed + OMIM | Multi-source research synthesis with evidence levels and gap analysis |
| `clinicalTrials` | ClinicalTrials.gov API v2 | Search clinical trials by condition, intervention, phase, status, country; NCT ID lookup [Phase 9] |
| `openfdaLookup` | OpenFDA API | Drug adverse event reports (FAERS), drug labeling, reaction-specific counts [Phase 9] |
| `evidenceSearch` | PubMed + Cochrane | Systematic review/RCT/meta-analysis search with PICO-structured queries [Phase 9] |

### Phenotype & Knowledge Tools (3)

| Tool | Data Source | Purpose |
|------|-----------|---------| 
| `hpoMapper` | HPO API | Map free-text symptoms → standardized HPO terms with confidence |
| `documentParser` | Local processing | Parse medical documents → structured data (sections, labs, demographics) |
| `knowledgeQuery` | Local vector store | Semantic search over ingested documents |

### Clinical Data Tools (2)

| Tool | Data Source | Purpose |
|------|-----------|---------| 
| `captureData` | Local storage | Write structured clinical records (patient-report, lab-result, treatment-trial, etc.) |
| `queryData` | Local storage | Read structured clinical records |

### Brain Tools (2)

| Tool | Data Source | Purpose |
|------|-----------|---------| 
| `brainFeed` | Local storage | Feed anonymized case observations to cross-patient brain |
| `brainRecall` | Local storage | Query cross-patient diagnostic patterns |

### Advanced Research Tools (3)

| Tool | Data Source | Purpose |
|------|-----------|---------| 
| `parallelResearch` | Parallel.ai API | Ultra-deep research with advocate/skeptic/unbiased framing |
| `adversarialSynthesis` | Internal | Three-perspective adversarial analysis |
| `ddxGenerator` | Isabel API + internal | Differential diagnosis generator with pattern matching fallback [Phase 9] |

### Phase 9: Medical Research Validation Tools

Four new tools added to strengthen evidence-based validation:

**ClinicalTrials.gov v2** (`src/tools/clinical-trials.ts`)
- **API**: `https://clinicaltrials.gov/api/v2/studies` (REST, no auth required)
- **Modes**: Search by condition/intervention/phase/status/country, or lookup by NCT ID
- **Output**: Study title, phase, status, enrollment, conditions, interventions, dates, NCT ID
- **Agent**: research-agent

**OpenFDA Drug Safety** (`src/tools/openfda-lookup.ts`)
- **API**: `https://api.fda.gov/drug/event.json` and `/drug/label.json`
- **Modes**: Adverse event search (top-N reactions by drug), drug label lookup, reaction-specific counting
- **Output**: Reaction terms with report counts, safety signal detection
- **Agent**: research-agent
- **API key**: Optional `OPENFDA_API_KEY` (40 req/min without, 240/min with)

**Evidence Search** (`src/tools/evidence-search.ts`)
- **API**: NCBI eUtils with publication type filters + Cochrane via PubMed
- **Features**: PICO-structured queries, evidence type filtering (systematic reviews, RCTs, meta-analyses, guidelines, case reports)
- **Output**: Evidence items with quality scores, evidence types, PICO components
- **Agent**: research-agent

**DDx Generator** (`src/tools/ddx-generator.ts`)
- **API**: Isabel Healthcare API (optional, requires `ISABELDX_API_KEY`) + internal pattern matching
- **Features**: Symptom-to-diagnosis mapping, prevalence weighting, "don't miss" flags, age/sex/region filtering
- **Output**: Ranked differential diagnoses with likelihood scores
- **Agent**: hypothesis-agent + MCP `generate_ddx`

### PubMed Enhancement (Phase 9)

The `pubmedSearchTool` was significantly enhanced:
- **efetch integration**: Full abstracts retrieved via `efetch.fcgi?rettype=xml` (previously empty string)
- **PMID lookup mode**: Verify a single PMID exists, return title + abstract + MeSH terms
- **Batch PMID mode**: Verify multiple PMIDs in one call (batches of 200)
- **citedBy mode**: Find articles citing a given PMID via `elink.fcgi?linkname=pubmed_pubmed_citedin`
- **XML parsing**: Full PubmedArticle XML parsing with abstract, MeSH, publication type, DOI extraction

### ClinVar Integration (Phase 8)

The `clinvarLookupTool` searches the NCBI ClinVar database for genetic variant pathogenicity data:
- **Input**: `query` (free text), `gene` (gene symbol, e.g., "COL3A1"), `variant` (HGVS notation, e.g., "c.1854+1G>A")
- **Output**: Variants with `accession`, `clinicalSignificance`, `reviewStatus`, `gene`, `condition`, `lastEvaluated`, `hgvsNotation`, `url`
- Uses same NCBI eUtils API pattern as PubMed (`db=clinvar`), shares rate limiter
- Smart query builder combines gene + variant into field-tagged search terms

### OMIM Integration (Phase 8)

The `deepResearch` tool now includes real OMIM API integration (previously stub):
- Requires `OMIM_API_KEY` env var (free for academic use via registration at omim.org)
- Without key: graceful fallback to stub results (no behavior change)
- With key: fetches gene-disease relationships, MIM numbers, phenotype descriptions
- Maps OMIM entry prefixes to evidence levels (`*` gene → 'review', `#` phenotype → 'cohort')

### NCBI Rate Limiting (Phase 8)

All NCBI eUtils calls (PubMed + ClinVar + evidence search) go through a shared rate limiter (`src/utils/ncbi-rate-limiter.ts`):
- **Exponential backoff**: 1s → 2s → 4s → 8s → 16s on 429/500 responses (max 5 retries)
- **API key support**: Set `NCBI_API_KEY` env var to increase rate limit from 3 to 10 req/sec
- **Shared singleton**: All NCBI tools share one limiter to prevent cross-tool rate limit collisions
- **No retry on 400**: Client errors fail immediately without retry

---

## Workflows

Both workflows support **Human-in-the-Loop (HITL)** suspend/resume for critical diagnostic decisions.

### Patient Intake (`patient-intake`)
1. **Parse document** — Extract structured data from medical records
2. **Map phenotypes** — Convert symptoms to HPO terms with confidence scores
3. **Review phenotypes** _(HITL suspend point)_ — Suspends when any phenotype has confidence < 0.7; presents phenotypes for human review with approval/rejection interface
4. **Prepare output** — Uses approved phenotypes if resumed, otherwise flags for review

**Suspend payload:** `{ patientId, phenotypes: [{ term, hpoId, confidence, originalSymptom }], message }`
**Resume payload:** `{ approvedPhenotypes: string[], rejectedPhenotypes?: string[], notes?: string }`
**Status values:** `complete` | `needs-review` | `human-reviewed`

### Diagnostic Research (`diagnostic-research`)
1. **Build research queries** — Generate targeted queries from symptoms/HPO terms
2. **Parallel research** — Simultaneous PubMed + Orphanet + deep research
3. **Review findings** _(HITL suspend point)_ — Suspends when significant findings exist; presents top research findings for human review before hypothesis generation
4. **Generate hypotheses** — Rank diagnostic hypotheses using only approved findings

**Suspend payload:** `{ patientId, findingsCount, topFindings: [{ index, source, title, relevance }], message }`
**Resume payload:** `{ approvedFindingIndices: number[], additionalContext?: string, notes?: string }`

---

## Safety Processors

| Processor | Type | Function |
|-----------|------|----------|
| `medicalDisclaimer` | Input | Injects "research assistant, not a doctor" disclaimer into system messages |
| `evidenceQuality` | Output | Flags low confidence (<30%), enforces citation requirements |
| `piiRedactor` | Input | HIPAA-compliant PII detection and redaction (names, SSN, DOB, addresses) |

---

## Terminal Interface

Two UI modes share the same business logic via `cli-core.ts` event-based streaming:

### TUI Mode (default) — Ink Split-Pane Layout

```bash
npm start                        # Launch TUI (default)
npm start -- --patient marfan-42 # Launch TUI with patient context
npm run tui                      # Alias for npm start
```

**Layout:**
- **Header bar**: App title, patient context, thread ID (8 chars), network mode `[NET]/[DIRECT]`, live token counters
- **Conversation pane**: Scrollable message list using Ink `<Static>` for completed messages (no re-renders), live streaming with `<Spinner>` while waiting for first token
- **Input bar**: `<TextInput>` with slash command tab completion, disabled during streaming

**Keyboard shortcuts:**
- `Ctrl+N` — new thread
- `Ctrl+T` — toggle network mode
- `Ctrl+C` — exit

**Components:** `App.tsx` (root) → `Header.tsx`, `ConversationPane.tsx` → `MessageBubble.tsx`, `InputBar.tsx`
**State management:** `useAsklepios` hook encapsulates all agent interaction, consuming `StreamEvent` generators from `cli-core.ts`

**Tech:** React 19 + Ink 6.8 + @inkjs/ui (TextInput, Spinner)

### REPL Mode (fallback)

```bash
npm run start:repl                        # Launch readline REPL
npm run start:repl -- --patient marfan-42 # REPL with patient context
```

Readline-based text interface for scripting, piping, and environments without full terminal support.

### Commands (both modes)
| Command | Action |
|---------|--------|
| `/help` | Show available commands |
| `/patient <id>` | Switch patient context (new thread) |
| `/thread <id>` | Switch to specific thread |
| `/new` | Start new conversation thread |
| `/status` | Show current session info |
| `/usage` | Show token usage statistics for current session |
| `/network` | Toggle network mode (multi-agent routing) |
| `/resume <wf> <step> [json]` | Resume a suspended workflow with optional data |
| `/quit` | Exit |

### Event-Based Architecture

`cli-core.ts` yields typed `StreamEvent` objects instead of writing directly to stdout:

```
StreamEvent = text | agent-label | usage | error | done
```

Both REPL (`cli.ts`) and TUI (`tui.tsx`) consume the same async generators, ensuring identical business logic regardless of rendering layer.

---

## Model Routing

Tiered model selection via `DynamicModel` function (`src/utils/model-router.ts`):

| Mode | Model | Use Case | Target TTFT |
|------|-------|----------|-------------|
| `quick` | Claude Haiku 4.5 | Fast responses, simple updates, symptom diary | ~200ms |
| `voice` | Claude Haiku 4.5 | Voice-optimized latency | ~150ms |
| `research` | Claude Sonnet 4 | Standard analysis, literature search, tool calls | ~1.6s |
| `deep` | Claude Opus 4 | Complex differential diagnosis, multi-hypothesis reasoning | ~3-5s |

Mode is set via `requestContext.mode` and defaults to `research`.

---

## MCP Server

Full AI-testable control plane via Model Context Protocol (`src/mcp/`). Any MCP client (Claude Desktop, Cursor, Claude Code, or a custom QA agent) can connect and independently control every agent, workflow, and state surface.

### Architecture

```
src/mcp/
├── server.ts          # Thin orchestrator — creates McpServer, calls register functions
├── tools-core.ts      # 6 core tools (ask, search, lookup_orphanet, lookup_clinvar, map, recall)
├── tools-agents.ts    # 4 agent invocation tools (invoke each agent independently)
├── tools-workflows.ts # 3 workflow execution + resume tools
├── tools-state.ts     # 5 state inspection + raw tool access
├── tools-tasks.ts     # 2 task-based tools for long-running operations (experimental)
├── resources.ts       # 7 resources (3 templates + 4 static system resources)
├── prompts.ts         # 4 prompts (diagnostic workflows + test scenarios)
├── stdio.ts           # StdioServerTransport entry point
└── server.test.ts     # Registration tests (mocks @mastra/core)
```

### Tools (37+)

#### Core Tools (6)
| Tool | Annotations | Description |
|------|-------------|-------------|
| `ask_asklepios` | `readOnlyHint: false` | Chat with the Asklepios orchestrator agent |
| `search_pubmed` | `readOnlyHint: true` | Search PubMed — supports keyword, PMID lookup, batch verification, citedBy |
| `lookup_orphanet` | `readOnlyHint: true` | Look up rare disease in Orphanet |
| `lookup_clinvar` | `readOnlyHint: true` | Look up genetic variants in ClinVar (pathogenicity, review status) |
| `map_symptoms` | `readOnlyHint: true` | Map free-text symptoms to HPO terms |
| `recall_brain` | `readOnlyHint: true` | Query cross-patient intelligence |

#### Validation Tools (4) [Phase 9]
| Tool | Annotations | Description |
|------|-------------|-------------|
| `search_clinical_trials` | `readOnlyHint: true` | Search ClinicalTrials.gov v2 by condition, intervention, phase, status, country; NCT ID lookup |
| `lookup_openfda` | `readOnlyHint: true` | Search OpenFDA for drug adverse events (FAERS) and drug labeling |
| `search_evidence` | `readOnlyHint: true` | Search for systematic reviews, meta-analyses, RCTs with PICO queries |
| `generate_ddx` | `readOnlyHint: true` | Generate differential diagnosis from clinical features |

#### Agent Invocation Tools (8)
| Tool | Input | Description |
|------|-------|-------------|
| `invoke_phenotype_agent` | `message`, `patientId?`, `threadId?` | Invoke phenotype agent for symptom extraction + HPO mapping |
| `invoke_research_agent` | `message`, `patientId?`, `threadId?` | Invoke research agent for literature search |
| `invoke_synthesis_agent` | `message`, `patientId?`, `threadId?` | Invoke synthesis agent for hypothesis generation |
| `invoke_hypothesis_agent` | `message`, `patientId?`, `threadId?` | Invoke hypothesis agent for tier-weighted hypothesis generation |
| `invoke_interview_agent` | `message`, `patientId?`, `threadId?` | Invoke interview agent for diagnostic questions |
| `invoke_followup_agent` | `message`, `patientId?`, `threadId?` | Invoke followup agent for follow-up questions |
| `invoke_report_agent` | `message`, `patientId?`, `threadId?` | Invoke report agent for deliverable generation |
| `invoke_brain_agent` | `message` | Invoke brain agent for cross-patient pattern matching |

#### Workflow Execution Tools (3)
| Tool | Input | Description |
|------|-------|-------------|
| `run_patient_intake` | `documentText`, `patientId`, `documentType?` | Execute patient-intake workflow; returns runId + status |
| `run_diagnostic_research` | `patientId`, `symptoms[]`, `hpoTerms?`, `researchFocus?` | Execute diagnostic-research workflow; returns runId + hypotheses |
| `resume_workflow` | `workflowId` (enum), `runId`, `stepId`, `resumeData` (JSON) | Resume a suspended workflow with human review data |

#### State Inspection Tools (5)
| Tool | Input | Description |
|------|-------|-------------|
| `get_working_memory` | `resourceId` | Retrieve PatientProfile working memory for a patient |
| `list_threads` | `resourceId`, `limit?` | List conversation threads for a patient (paginated) |
| `get_thread_messages` | `threadId`, `limit?` | Retrieve messages from a specific thread |
| `parse_document` | `text`, `documentType?` | Raw tool: parse a medical document (no agent involved) |
| `deep_research` | `query`, `context?`, `focusAreas?`, `maxSources?` | Raw tool: run deep research query (no agent involved) |

#### Task-Based Tools (2) — Experimental MCP Tasks API

Long-running operations that return a task ID immediately, allowing clients to poll for completion. Uses `server.experimental.tasks.registerToolTask()` from MCP SDK v1.27.1.

| Tool | Input | TTL | Description |
|------|-------|-----|-------------|
| `run_deep_research` | `query`, `context?`, `focusAreas?`, `maxSources?` | 5 min | Async deep research — returns task ID, poll for ResearchReport |
| `run_diagnostic_workflow` | `workflowId`, `patientId`, `documentText?`, `symptoms?`, ... | 10 min | Async workflow execution — returns task ID, poll for workflow result |

**Why tasks?** The `ask_asklepios` MCP tool timed out during testing because deep-research makes 10+ API calls. Task-based tools return immediately with a task ID, letting clients poll at their own pace.

### Resources (7)

| Resource | URI Pattern | Type | Description |
|----------|------------|------|-------------|
| Patient Profile | `patient://{id}/profile` | Template | Working memory JSON (PatientProfile) |
| Patient Timeline | `patient://{id}/timeline` | Template | Conversation history (last 5 threads) |
| Agent Config | `agent://{id}/config` | Template | Agent-specific config: tools, role, memory scope |
| System Health | `system://health` | Static | Agent count, workflow count, storage status |
| System Agents | `system://agents` | Static | All 9 agents with tool lists, network mode |
| System Workflows | `system://workflows` | Static | Both workflows with steps, HITL suspension points |
| Memory Stats | `system://memory/stats` | Static | Thread count aggregated by resource |

### Prompts (4)

| Prompt | Arguments | Description |
|--------|-----------|-------------|
| `diagnose_patient` | `patientId`, `symptoms` | Full diagnostic workflow: phenotype → brain → research → synthesis |
| `review_case` | `patientId` | Load patient profile + timeline, generate differential diagnosis |
| `compare_patients` | `patientId1`, `patientId2` | Cross-patient comparison using brain agent |
| `test_scenario` | `scenario` (free text) | Structure a test scenario into systematic test plan with tool calls |

### AI Testing Workflow Example

An AI agent can programmatically test a full diagnostic workflow:
1. `system://health` → verify system ready
2. `system://agents` → verify all 9 agents loaded
3. `invoke_phenotype_agent` → test isolated symptom extraction
4. `run_patient_intake` → trigger workflow, verify it suspends at HITL point
5. `resume_workflow` → resume with review data, verify status changes
6. `get_working_memory` → verify patient profile updated correctly
7. `get_thread_messages` → verify conversation persisted

---

## Token Usage Tracking

Per-session token usage tracking via `src/utils/usage-tracker.ts`:
- Records `inputTokens`, `outputTokens`, `totalTokens`, plus optional `reasoningTokens` and `cachedInputTokens` from each interaction
- Displayed inline after each response: `[in: 1,234 | out: 567 | total: 1,801]`
- Session summary via `/usage` command shows cumulative totals across all interactions

---

## Observability

Lightweight tracing via `src/utils/observability.ts` (no external dependency required):
- **`traceOnFinish`** callback: Logs completion spans with token usage and duration after each agent response
- **`traceOnStepFinish`** callback: Logs per-step details including tool calls and results
- Callbacks wired into `agent.stream()` via `onFinish`/`onStepFinish` options
- Framework-level logging via `StderrLogger` (extends Mastra's ConsoleLogger, redirects all framework logs to stderr for clean stdout/stderr separation)
- `LOG_LEVEL` env var controls verbosity: `debug` | `info` (default) | `warn` | `error`
- Run with `LOG_LEVEL=debug node dist/cli.js 2>logs/debug.log` for parallel log monitoring

---

## Semantic Recall

Vector-based semantic search over conversation history:
- **Embedder**: OpenAI `text-embedding-3-small` via `@ai-sdk/openai`
- **Vector store**: `LibSQLVector` (co-located with main SQLite database)
- **Patient memory**: `topK: 5`, `messageRange: { before: 2, after: 1 }` — retrieves 5 most similar past messages
- **Brain memory**: `topK: 10` — broader recall for cross-patient pattern matching
- Automatically indexes new messages and retrieves semantically similar context on each interaction

---

## Performance Characteristics

Measured baselines (Claude Sonnet 4, macOS, local SQLite):

| Metric | Measured | Notes |
|--------|----------|-------|
| First token (simple chat) | ~1,628ms | Sonnet 4, no tools |
| Tool execution (direct) | ~600-700ms | HPO mapper, PubMed search |
| Working memory recall (no tools) | ~10-13s | Agent retrieves full PatientProfile from memory, single step |
| Research workflow (6 steps) | ~36s | updateWorkingMemory → hpoMapper → pubmedSearch → brainRecall → research → response |
| Complex variant research (8 steps) | ~49s | Multiple PubMed queries, updateWorkingMemory, literature synthesis |
| Network mode (routing + synthesis) | ~19-35s | Routing agent → synthesis-agent for pure reasoning task |
| Brain feed/recall (4 steps) | ~38s | brainFeed → brainRecall → updateWorkingMemory → response |
| Token usage per turn | 10K-110K total | Simple recall ~11K, complex research ~110K |

### Dynamic maxSteps (Phase 8)

Intelligent step limit scaling via `resolveMaxSteps(message)` (`src/utils/max-steps.ts`):

| Query Type | maxSteps | Examples |
|-----------|----------|---------|
| Simple chat | 5 | Greetings, status checks, short questions (<50 chars) |
| Standard query | 10 | Symptom descriptions, single research questions |
| Complex research | 15 | Variant analysis, differential diagnosis ("research", "investigate") |
| Deep diagnostic | 20 | Comprehensive workups ("comprehensive", "deep dive", "full workup") |

- Override via `ASKLEPIOS_MAX_STEPS` env var (explicit tuning)
- Bounded: `Math.min(Math.max(result, 3), 25)`
- Applied in both direct mode and network mode

### Latency Notes
- First-token latency dominated by LLM response time, not framework overhead
- Tool execution adds ~600ms per external API call (network-bound)
- Multi-turn latency scales with tool count and working memory update complexity
- Dynamic `maxSteps` adapts to query complexity (5-20 steps) — simple chat uses 5, complex research uses 15-20
- Working memory recall across threads is fast (~11K tokens, single step) since PatientProfile persists at resource scope
- Haiku mode (`quick`/`voice`) targets sub-200ms TTFT for simple interactions
- NCBI rate limiter adds ~1s delay per retry on 429 responses (exponential backoff)

---

## Testing

### Unit Tests
- **500+ tests** across 50+ passing test suites
- Colocated test files (`*.test.ts` / `*.test.tsx` next to source)
- Coverage: tools (schema validation + execution for all 17 tools), agents (config verification + network configuration + dynamic maxSteps), workflows (schema + structure + HITL suspend/resume schemas), processors (input/output behavior), CLI (command parsing + session management + network toggle + cli-core event types), MCP server (registration tests for all 37+ tools, 7 resources, 4 prompts + task-based tools), utils (model router, logger, usage tracker, observability, NCBI rate limiter, maxSteps resolver), Phase 9 tools (clinical-trials 9 tests, openfda 8 tests, evidence-search 8 tests, ddx-generator 8 tests, pubmed-search 24 tests), TUI components (Header rendering, MessageBubble role-based styling, token display)

### MCP Integration Tests
- `scripts/test-mcp-integration.ts` — exercises MCP tools, resources, prompts via MCP SDK client
- Results: 56/57 passed; sole failure is `ask_asklepios` timeout under PubMed rate limiting (mitigated by task-based tools in Phase 8)
- `scripts/test-workflows-live.ts` — live workflow execution, Orphanet/PubMed/HPO/document parser verification; 19/19 passed
- `scripts/verify-citations.mjs` — PMID/PMC citation verification against NCBI database (404 lines) [Phase 9]

### Comprehensive Manual Verification (6-turn patient simulation)
Patient persona: Maria Kowalski (32F, 8-year diagnostic odyssey, vascular EDS, arterial dissection)

| Turn | Feature Tested | Result |
|------|---------------|--------|
| 1 | Initial presentation → symptom extraction, HPO mapping, PubMed search, brain recall | 6 steps, 75K tokens, 36s — completed naturally |
| 2 | Working memory persistence across threads | Full PatientProfile recalled, 11K tokens, 13s |
| 3 | Complex genetic variant research (COL3A1 c.1854+1G>A) | 8 steps, 110K tokens, 49s — referenced real literature |
| 4 | Network mode → synthesis-agent routing | Correctly routed to synthesis-agent, 35K tokens |
| 5 | Brain feed/recall (cross-patient learning) | Case ingested as Case-vEDS-maria-002, 58K tokens |
| 6 | Multi-session memory continuity | All patient data persisted across CLI restarts |

**Verified working:** agent streaming, working memory persistence, multi-agent network routing, brain feed/recall, observability tracing, token tracking, HITL suspend/resume, clean stdout/stderr separation, all MCP tools

### Phase 9 Live API Validation

| Tool | Query | Result |
|------|-------|--------|
| Citation verification | 17 PMIDs from hypothesis file | **17/17 citations exist** in PubMed (zero fabricated) |
| OpenFDA | bupropion + leukopenia | **194 FAERS reports** (confirms real adverse event signal) |
| ClinicalTrials.gov | ketamine + chronic headache | Found **NCT04814381** (KETALGIA, RECRUITING) |
| ClinicalTrials.gov | LDN + chronic pain | Found completed LDN and naltrexone trials |

---

## External MCP Servers

Configured in `.mcp.json`:

| Server | Command | Purpose |
|--------|---------|---------|
| `asklepios` | `node dist/mcp/stdio.js` | Asklepios MCP server (37+ tools, 7 resources, 4 prompts) |
| `biomcp` | `uvx biomcp run` | BioMCP — biological databases: drug adverse events, gene pathways, variant annotations, trial matching [Phase 9] |

---

## Known Gaps

| Gap | Impact | Mitigation |
|-----|--------|------------|
| ~~`ddxGeneratorTool` not wired to any agent~~ | ~~DDx only available via MCP~~ | **Fixed** — wired to hypothesis-agent |
| ClinVar lacks `rsId` input field | Cannot search by dbSNP rsID (e.g., rs1801133 for MTHFR C677T) | Use `gene` + `variant` fields as workaround |
| BioMCP untested | Configured in `.mcp.json` but never verified working | Run `uvx biomcp run` to verify |

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
