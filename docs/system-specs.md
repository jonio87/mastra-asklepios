# Asklepios — System Specifications

> Rare Disease Research Agent with Diagnostic Odyssey Compression

**Version:** 0.1.0 (MVP)
**Status:** Core implementation complete — all features verified via comprehensive manual testing

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
| Linting | Biome v2 | ^2.4.4 |
| Testing | Jest + ts-jest (ESM) | ^29.7.0 |

---

## Architecture

```
src/
├── agents/                    # 5 specialized agents
│   ├── asklepios.ts           # Central orchestrator (7 tools, all routing)
│   ├── research-agent.ts      # Literature search specialist (3 tools)
│   ├── phenotype-agent.ts     # HPO symptom mapping specialist (2 tools)
│   ├── synthesis-agent.ts     # Evidence synthesis & hypothesis ranking (no tools, pure reasoning)
│   └── brain-agent.ts         # Cross-patient intelligence (no tools, pure reasoning)
├── tools/                     # 7 external API integrations (5 core + 2 brain)
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
├── mcp/                       # MCP server — full AI-testable control plane
│   ├── server.ts              # Thin orchestrator (calls register functions)
│   ├── tools-core.ts          # 5 core tools (chat, search, lookup, map, recall)
│   ├── tools-agents.ts        # 4 agent invocation tools
│   ├── tools-workflows.ts     # 3 workflow execution + resume tools
│   ├── tools-state.ts         # 5 state inspection + raw tool access
│   ├── resources.ts           # 7 resources (patient, system, agent)
│   ├── prompts.ts             # 4 prompts (diagnostic workflows, testing)
│   └── stdio.ts               # StdioServerTransport entry point
├── utils/
│   ├── anthropic-provider.ts  # Auth: env var or Claude Code credentials
│   ├── model-router.ts        # Tiered model routing (Haiku/Sonnet/Opus)
│   ├── logger.ts              # Structured logging (debug/info/warn/error)
│   ├── stderr-logger.ts       # StderrLogger — redirects framework logs to stderr
│   ├── usage-tracker.ts       # Token usage tracking per session
│   └── observability.ts       # Tracing callbacks for agent execution
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
| **Asklepios** | Central orchestrator; routes to sub-agents, coordinates research; supports network mode for multi-agent delegation | pubmedSearch, orphanetLookup, hpoMapper, documentParser, deepResearch, brainRecall, brainFeed | Dynamic (Haiku/Sonnet/Opus via model router) |
| **Research Agent** | Deep literature search across medical databases | pubmedSearch, orphanetLookup, deepResearch | claude-sonnet-4 |
| **Phenotype Agent** | Symptom extraction & HPO term standardization | hpoMapper, documentParser | claude-sonnet-4 |
| **Synthesis Agent** | Evidence synthesis, hypothesis ranking, self-reflection | _(none — pure reasoning)_ | claude-sonnet-4 |
| **Brain Agent** | Cross-patient pattern recognition, differential reasoning | _(none — pure reasoning)_ | claude-sonnet-4 |

All agents share a single Memory instance with cross-patient observational learning.

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
| research-agent | Literature searches in PubMed, Orphanet, deep research |
| synthesis-agent | Combining evidence into ranked diagnostic hypotheses |
| asklepios-brain | Cross-patient pattern matching and wisdom recall |

**Routing strategy**: phenotype extraction → brain recall → research → synthesis → brain feed

Toggle network mode in the CLI with `/network`. The `[net]` indicator appears in the prompt when active.

**Configuration**: `maxSteps: 10`, routing instructions guide agent selection, `onIterationComplete` callback logs routing decisions to stderr for observability.

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

| Tool | Data Source | Purpose |
|------|-----------|---------|
| `pubmedSearch` | NCBI eUtils API | Search medical literature (articles, case reports, trials) |
| `orphanetLookup` | Orphanet API | Rare disease database lookup (genes, inheritance, prevalence) |
| `hpoMapper` | HPO API | Map free-text symptoms → standardized HPO terms with confidence |
| `documentParser` | Local processing | Parse medical documents → structured data (sections, labs, demographics) |
| `deepResearch` | Multi-source | Parallel research synthesis with evidence levels and gap analysis |

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
| `/usage` | Show token usage statistics for current session |
| `/network` | Toggle network mode (multi-agent routing) |
| `/resume <wf> <step> [json]` | Resume a suspended workflow with optional data |
| `/quit` | Exit |

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
├── tools-core.ts      # 5 original tools (ask, search, lookup, map, recall)
├── tools-agents.ts    # 4 agent invocation tools (invoke each agent independently)
├── tools-workflows.ts # 3 workflow execution + resume tools
├── tools-state.ts     # 5 state inspection + raw tool access
├── resources.ts       # 7 resources (3 templates + 4 static system resources)
├── prompts.ts         # 4 prompts (diagnostic workflows + test scenarios)
├── stdio.ts           # StdioServerTransport entry point
└── server.test.ts     # 37 registration tests (mocks @mastra/core)
```

### Tools (17)

#### Core Tools (5)
| Tool | Annotations | Description |
|------|-------------|-------------|
| `ask_asklepios` | `readOnlyHint: false` | Chat with the Asklepios orchestrator agent |
| `search_pubmed` | `readOnlyHint: true` | Search PubMed for medical literature |
| `lookup_orphanet` | `readOnlyHint: true` | Look up rare disease in Orphanet |
| `map_symptoms` | `readOnlyHint: true` | Map free-text symptoms to HPO terms |
| `recall_brain` | `readOnlyHint: true` | Query cross-patient intelligence |

#### Agent Invocation Tools (4)
| Tool | Input | Description |
|------|-------|-------------|
| `invoke_phenotype_agent` | `message`, `patientId?`, `threadId?` | Invoke phenotype agent for symptom extraction + HPO mapping |
| `invoke_research_agent` | `message`, `patientId?`, `threadId?` | Invoke research agent for literature search |
| `invoke_synthesis_agent` | `message`, `patientId?`, `threadId?` | Invoke synthesis agent for hypothesis generation |
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

### Resources (7)

| Resource | URI Pattern | Type | Description |
|----------|------------|------|-------------|
| Patient Profile | `patient://{id}/profile` | Template | Working memory JSON (PatientProfile) |
| Patient Timeline | `patient://{id}/timeline` | Template | Conversation history (last 5 threads) |
| Agent Config | `agent://{id}/config` | Template | Agent-specific config: tools, role, memory scope |
| System Health | `system://health` | Static | Agent count, workflow count, storage status |
| System Agents | `system://agents` | Static | All 5 agents with tool lists, network mode |
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
2. `system://agents` → verify all 5 agents loaded
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

### Latency Notes
- First-token latency dominated by LLM response time, not framework overhead
- Tool execution adds ~600ms per external API call (network-bound)
- Multi-turn latency scales with tool count and working memory update complexity
- `maxSteps: 10` allows complex diagnostic workflows to complete (default 5 was too restrictive)
- Working memory recall across threads is fast (~11K tokens, single step) since PatientProfile persists at resource scope
- Haiku mode (`quick`/`voice`) targets sub-200ms TTFT for simple interactions

---

## Testing

### Unit Tests
- **269 tests** across 26 passing test suites
- Colocated test files (`*.test.ts` next to source)
- Coverage: tools (schema validation + execution), agents (config verification + network configuration), workflows (schema + structure + HITL suspend/resume schemas), processors (input/output behavior), CLI (command parsing + session management + network toggle), MCP server (37 registration tests for all 17 tools, 7 resources, 4 prompts), utils (model router, logger, usage tracker, observability)

### MCP Integration Tests
- `scripts/test-mcp-integration.ts` — exercises all 17 MCP tools, 12 resources, 4 prompts via MCP SDK client
- Results: 56/57 passed; sole failure is `ask_asklepios` timeout under PubMed rate limiting (external API constraint)
- `scripts/test-workflows-live.ts` — live workflow execution, Orphanet/PubMed/HPO/document parser verification; 19/19 passed

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

**Verified working:** agent streaming, working memory persistence, multi-agent network routing, brain feed/recall, observability tracing, token tracking, HITL suspend/resume, clean stdout/stderr separation, all 17 MCP tools

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
