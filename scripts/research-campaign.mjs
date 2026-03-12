#!/usr/bin/env node
/**
 * Comprehensive Research Campaign — Tomasz Szychliński
 *
 * Runs systematic biomedical MCP queries across all 7 connected servers
 * and persists findings to Layer 2B (research_findings table).
 *
 * Usage: node --require dotenv/config scripts/research-campaign.mjs [--dry-run]
 */
import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
config({ path: resolve(ROOT, '.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const DB_URL = process.env.ASKLEPIOS_DB_URL || 'file:asklepios.db';
const PATIENT_ID = 'tomasz-szychliński';
const db = createClient({ url: DB_URL });

// ─── Tool name mapping (actual MCP tool names) ──────────────────────
// biocontext: bc_get_europepmc_articles(query), bc_get_studies_by_condition(condition),
//   bc_search_studies(query), bc_search_drugs_fda(generic_name/brand_name),
//   bc_get_string_interactions(protein_symbol, species), bc_get_uniprot_protein_info(gene_symbol),
//   bc_get_human_protein_atlas_info(gene_symbol), bc_get_go_terms_by_gene(gene_name),
//   bc_query_open_targets_graphql(query_string), bc_get_efo_id_by_disease_name(disease_name),
//   bc_search_ontology_terms(search_term), bc_get_alphafold_info_by_protein_symbol(protein_symbol),
//   bc_get_protein_domains(protein_id), bc_get_reactome_info_by_identifier(identifier),
//   bc_query_kegg(operation, args), bc_get_interpro_entry(interpro_id)
// biomcp: shell(command) — 'search article "query" --limit N', 'get gene SYMBOL', 'search trial "query"'
// biothings: biothings_query_genes(q), biothings_get_gene(gene_id), biothings_query_chems(q), biothings_query_variants(q)
// opentargets: search_entities(query_strings[]), query_open_targets_graphql(query_string)
// gget: gget_search_genes(search_terms[]), gget_enrichr(genes[]), gget_opentargets(ensembl_id), gget_info(ensembl_ids[])
// opengenes: opengenes_db_query(query)
// synergyage: synergyage_db_query(query)

const RESEARCH_QUERIES = [
  // ────── H1: CVJ anomaly + trigeminocervical convergence (45-60%) ──────
  {
    id: 'cvj-trigeminocervical',
    category: 'CVJ/Pain',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "craniocervical junction anomaly trigeminal pain trigeminocervical convergence" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "C1 assimilation platybasia basilar impression craniofacial pain" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "craniovertebral junction anomaly surgical outcomes chronic pain" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "atlantoaxial instability trigeminal neuralgia" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'craniocervical junction trigeminal pain central sensitization' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'platybasia basilar impression neurological outcomes' } },
      { tool: 'opentargets_search_entities', input: { query_strings: ['platybasia'] } },
      { tool: 'opentargets_search_entities', input: { query_strings: ['basilar impression'] } },
      { tool: 'opentargets_search_entities', input: { query_strings: ['craniovertebral junction abnormality'] } },
      { tool: 'biocontext_bc_get_efo_id_by_disease_name', input: { disease_name: 'platybasia' } },
    ],
  },

  // ────── H2: Myelopathy / spinal cord compression (30-45%) ──────
  {
    id: 'myelopathy',
    category: 'Myelopathy',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "cervical myelopathy chronic pain central sensitization" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "craniocervical junction myelopathy dynamic MRI flexion extension" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "basilar impression medulla oblongata compression" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'craniocervical junction myelopathy dynamic imaging' } },
    ],
  },

  // ────── H3: Central sensitization (50-65%) ──────
  {
    id: 'central-sensitization',
    category: 'Central Sensitization',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "central sensitization chronic craniofacial pain low dose naltrexone" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "low dose naltrexone mechanism neuroinflammation microglia TLR4" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "naltrexone chronic pain neuropathic clinical trial" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'low dose naltrexone central pain neuroinflammation' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'naltrexone microglia TLR4 glial modulation pain' } },
      { tool: 'biothings_biothings_query_genes', input: { q: 'OPRM1' } },
      { tool: 'biothings_biothings_query_genes', input: { q: 'TLR4' } },
      { tool: 'biocontext_bc_get_string_interactions', input: { protein_symbol: 'OPRM1', species: 'Homo sapiens' } },
      { tool: 'biocontext_bc_get_string_interactions', input: { protein_symbol: 'TLR4', species: 'Homo sapiens' } },
      { tool: 'biocontext_bc_get_go_terms_by_gene', input: { gene_name: 'OPRM1' } },
      { tool: 'biocontext_bc_get_human_protein_atlas_info', input: { gene_symbol: 'OPRM1' } },
    ],
  },

  // ────── H4: Autoimmune component (10-25%) — PR3-ANCA + Anti-Ro-60 ──────
  {
    id: 'autoimmune',
    category: 'Autoimmune',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "PR3-ANCA intermittent positivity without vasculitis significance" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "Anti-Ro-60 SSA positive transient young male significance" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "ANCA associated small fiber neuropathy peripheral neuropathy" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "autoimmune neuropathy craniofacial pain leukopenia" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'PR3-ANCA positive neuropathy without vasculitis' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'anti-Ro-60 SSA significance neuropathy pain' } },
      { tool: 'opentargets_search_entities', input: { query_strings: ['ANCA-associated vasculitis'] } },
      { tool: 'opentargets_search_entities', input: { query_strings: ['Sjogren syndrome'] } },
      { tool: 'biocontext_bc_get_efo_id_by_disease_name', input: { disease_name: 'vasculitis' } },
    ],
  },

  // ────── H5: Connective tissue phenotype (15-25%) ──────
  {
    id: 'connective-tissue',
    category: 'Connective Tissue',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "Ehlers-Danlos craniocervical instability chronic pain" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "hypermobile connective tissue cervical spine instability craniofacial" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'Ehlers-Danlos hypermobility craniocervical instability pain' } },
      { tool: 'biothings_biothings_query_genes', input: { q: 'COL1A1' } },
      { tool: 'biothings_biothings_query_genes', input: { q: 'COL5A1' } },
      { tool: 'gget_gget_opentargets', input: { ensembl_id: 'ENSG00000108821' } }, // COL1A1
    ],
  },

  // ────── H6: Airway-bruxism-cervical feedback loop (20-30%) ──────
  {
    id: 'airway-bruxism',
    category: 'Airway/Bruxism',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "sleep bruxism craniofacial pain cervical spine" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "upper airway resistance syndrome chronic pain" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'bruxism trigeminal pain cervical spine relationship' } },
    ],
  },

  // ────── Progressive leukopenia workup ──────
  {
    id: 'leukopenia',
    category: 'Hematology',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "progressive leukopenia young male differential diagnosis" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "benign ethnic neutropenia leukopenia autoimmune chronic" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'chronic leukopenia neutropenia autoimmune young adult' } },
      { tool: 'opentargets_search_entities', input: { query_strings: ['neutropenia'] } },
      { tool: 'biocontext_bc_get_efo_id_by_disease_name', input: { disease_name: 'leukopenia' } },
    ],
  },

  // ────── Sensory axonal neuropathy workup ──────
  {
    id: 'neuropathy',
    category: 'Neuropathy',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "sensory axonal polyneuropathy young adult idiopathic" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "small fiber neuropathy craniofacial pain autonomic" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "HINT1 neuropathy gene mutation" --limit 10' } },
      { tool: 'biocontext_bc_get_europepmc_articles', input: { query: 'sensory neuropathy ANCA autoimmune small fiber' } },
      { tool: 'biothings_biothings_query_genes', input: { q: 'HINT1' } },
      { tool: 'gget_gget_opentargets', input: { ensembl_id: 'ENSG00000169567' } }, // HINT1
    ],
  },

  // ────── Treatment failures (42+ medications) ──────
  {
    id: 'treatment-failures',
    category: 'Treatment',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search article "treatment resistant craniofacial pain medication failure neuropathic" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "refractory neuropathic pain low dose naltrexone" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search article "pregabalin lamotrigine escitalopram combination craniofacial pain" --limit 10' } },
      { tool: 'biocontext_bc_search_drugs_fda', input: { generic_name: 'naltrexone' } },
      { tool: 'biocontext_bc_search_drugs_fda', input: { generic_name: 'pregabalin' } },
      { tool: 'biocontext_bc_search_drugs_fda', input: { generic_name: 'lamotrigine' } },
      { tool: 'biocontext_bc_search_drugs_fda', input: { generic_name: 'escitalopram' } },
      { tool: 'biothings_biothings_query_chems', input: { q: 'naltrexone' } },
      { tool: 'biothings_biothings_query_chems', input: { q: 'pregabalin' } },
    ],
  },

  // ────── Gene-disease associations & protein interactions ──────
  {
    id: 'gene-disease',
    category: 'Genetics/Protein',
    queries: [
      { tool: 'biocontext_bc_get_string_interactions', input: { protein_symbol: 'TRPV1', species: 'Homo sapiens' } },
      { tool: 'biocontext_bc_get_string_interactions', input: { protein_symbol: 'COL1A1', species: 'Homo sapiens' } },
      { tool: 'biocontext_bc_get_uniprot_protein_info', input: { gene_symbol: 'OPRM1' } },
      { tool: 'biocontext_bc_get_uniprot_protein_info', input: { gene_symbol: 'TLR4' } },
      { tool: 'biocontext_bc_get_uniprot_protein_info', input: { gene_symbol: 'TRPV1' } },
      { tool: 'biocontext_bc_get_go_terms_by_gene', input: { gene_name: 'TLR4' } },
      { tool: 'biocontext_bc_get_go_terms_by_gene', input: { gene_name: 'TRPV1' } },
      { tool: 'biocontext_bc_get_human_protein_atlas_info', input: { gene_symbol: 'TLR4' } },
      { tool: 'biocontext_bc_get_human_protein_atlas_info', input: { gene_symbol: 'TRPV1' } },
      { tool: 'biocontext_bc_get_alphafold_info_by_protein_symbol', input: { protein_symbol: 'OPRM1' } },
      { tool: 'biocontext_bc_get_alphafold_info_by_protein_symbol', input: { protein_symbol: 'TLR4' } },
      { tool: 'biocontext_bc_query_kegg', input: { operation: 'find', args: 'pathway pain signaling' } },
      { tool: 'gget_gget_enrichr', input: { genes: ['OPRM1', 'TLR4', 'TRPV1', 'IL6', 'TNF', 'CGRP', 'CALCA'] } },
      { tool: 'opengenes_opengenes_db_query', input: { query: "SELECT symbol, name, functions FROM genes WHERE symbol IN ('OPRM1', 'TLR4', 'IL6', 'TNF') LIMIT 10" } },
      { tool: 'synergyage_synergyage_db_query', input: { query: "SELECT * FROM interactions WHERE gene1 = 'TLR4' OR gene2 = 'TLR4' LIMIT 10" } },
    ],
  },

  // ────── Clinical trials ──────
  {
    id: 'clinical-trials',
    category: 'Clinical Trials',
    queries: [
      { tool: 'biomcp_shell', input: { command: 'search trial "craniocervical junction pain" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search trial "low dose naltrexone chronic pain" --limit 10' } },
      { tool: 'biomcp_shell', input: { command: 'search trial "central sensitization treatment" --limit 10' } },
      { tool: 'biocontext_bc_get_studies_by_condition', input: { condition: 'craniofacial pain' } },
      { tool: 'biocontext_bc_get_studies_by_condition', input: { condition: 'low dose naltrexone' } },
      { tool: 'biocontext_bc_get_studies_by_condition', input: { condition: 'central sensitization' } },
      { tool: 'biocontext_bc_search_studies', input: { query: 'craniocervical junction pain treatment' } },
    ],
  },

  // ────── Open Targets deep queries ──────
  {
    id: 'opentargets-deep',
    category: 'Open Targets',
    queries: [
      { tool: 'opentargets_query_open_targets_graphql', input: { query_string: '{ disease(efoId: "MONDO_0007188") { id name description } }' } },
      { tool: 'gget_gget_opentargets', input: { ensembl_id: 'ENSG00000112038' } }, // OPRM1
      { tool: 'gget_gget_opentargets', input: { ensembl_id: 'ENSG00000136869' } }, // TLR4
      { tool: 'gget_gget_opentargets', input: { ensembl_id: 'ENSG00000196689' } }, // TRPV1
      { tool: 'gget_gget_search_genes', input: { search_terms: ['OPRM1'] } },
      { tool: 'gget_gget_search_genes', input: { search_terms: ['TRPV1'] } },
    ],
  },
];

// ─── MCP Tool Execution ──────────────────────────────────────────────

let tools = {};

async function connectMcp() {
  console.log('Connecting to biomedical MCP servers...');
  const { getBiomedicalTools } = await import('../dist/clients/biomedical-mcp.js');
  const start = Date.now();
  tools = await getBiomedicalTools();
  const elapsed = Date.now() - start;
  console.log(`Connected: ${Object.keys(tools).length} tools (${elapsed}ms)\n`);
}

async function executeTool(toolName, input) {
  const tool = tools[toolName];
  if (!tool) return { ok: false, error: `Tool ${toolName} not found` };
  
  try {
    const result = await tool.execute(input, {});
    // Handle MCP content format
    if (result && typeof result === 'object' && result.content) {
      const textContent = result.content.find(c => c.type === 'text');
      if (textContent) {
        if (result.isError) return { ok: false, error: textContent.text.slice(0, 200) };
        return { ok: true, text: textContent.text, chars: textContent.text.length };
      }
    }
    // Handle error format from @mastra/mcp
    if (result && typeof result === 'object' && result.error) {
      return { ok: false, error: result.message || JSON.stringify(result).slice(0, 200) };
    }
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return { ok: true, text, chars: text.length };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ─── Persistence ─────────────────────────────────────────────────────

async function persistFinding({ patientId, source, title, summary, url, relevance, evidenceLevel, queryId, rawData }) {
  if (DRY_RUN) return;
  const id = `finding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO research_findings
            (id, patient_id, source, source_tool, title, summary, url, relevance, evidence_level,
             research_query_id, date, evidence_tier, validation_status, source_credibility, raw_data, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, patientId, source, 'mcp-research-campaign', title.slice(0, 500), summary.slice(0, 2000),
        url || '', relevance, evidenceLevel,
        queryId || '', new Date().toISOString().split('T')[0],
        'expert-opinion', 'unvalidated', 50,
        rawData ? rawData.slice(0, 5000) : '', new Date().toISOString(),
      ],
    });
    return id;
  } catch (err) {
    // Silently skip persistence errors
    return null;
  }
}

async function persistQuery({ patientId, queryText, category, findingCount }) {
  if (DRY_RUN) return null;
  const id = `rquery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.execute({
      sql: `INSERT OR REPLACE INTO research_queries
            (id, patient_id, query_text, query_type, status, finding_count, date, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, patientId, queryText.slice(0, 500), category, 'completed', findingCount,
        new Date().toISOString().split('T')[0], new Date().toISOString(),
      ],
    });
    return id;
  } catch {
    return null;
  }
}

// ─── Result Parsing ──────────────────────────────────────────────────

function parseFindings(text) {
  try {
    const data = JSON.parse(text);
    
    // EuropePMC: { resultList: { result: [...] } }
    if (data?.resultList?.result) return data.resultList.result;
    
    // BioMCP: markdown table — parse articles
    if (typeof text === 'string' && text.includes('| PMID |')) {
      const lines = text.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('PMID'));
      return lines.map(l => {
        const cells = l.split('|').filter(Boolean).map(c => c.trim());
        return { pmid: cells[0], title: cells[1], journal: cells[2], date: cells[3], source: 'PubMed' };
      });
    }
    
    // Array response
    if (Array.isArray(data)) return data;
    // Nested result
    if (data?.result) return Array.isArray(data.result) ? data.result : [data.result];
    if (data?.results) return Array.isArray(data.results) ? data.results : [data.results];
    if (data?.hits) return Array.isArray(data.hits) ? data.hits : [data.hits];
    
    // Single object
    return [data];
  } catch {
    // BioMCP text format
    if (text.includes('| PMID |') || text.includes('| NCTId |')) {
      const lines = text.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('PMID') && !l.includes('NCTId'));
      return lines.map(l => {
        const cells = l.split('|').filter(Boolean).map(c => c.trim());
        return { id: cells[0], title: cells[1] || cells[0], text: l };
      });
    }
    if (text.length > 20) return [{ text }];
    return [];
  }
}

// ─── Main Execution ──────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════════');
console.log('  COMPREHENSIVE RESEARCH CAMPAIGN — Tomasz Szychliński');
console.log('═══════════════════════════════════════════════════════════════');
console.log(DRY_RUN ? '  [DRY RUN — no DB writes]' : '  [LIVE — writing to research database]');
console.log();

await connectMcp();

const stats = {
  totalQueries: 0,
  successfulQueries: 0,
  failedQueries: 0,
  totalFindings: 0,
  totalChars: 0,
  byCategory: {},
  errors: [],
};

const allResults = [];

for (const group of RESEARCH_QUERIES) {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  ${group.category} (${group.id})`);
  console.log(`║  ${group.queries.length} queries`);
  console.log(`╚══════════════════════════════════════════════════╝`);
  
  const groupStart = Date.now();
  let groupFindings = 0;
  
  for (const q of group.queries) {
    stats.totalQueries++;
    const queryDesc = `${q.tool}: ${JSON.stringify(q.input).slice(0, 70)}`;
    process.stdout.write(`  → ${queryDesc}...`);
    
    const start = Date.now();
    const result = await executeTool(q.tool, q.input);
    const elapsed = Date.now() - start;
    
    if (result.ok) {
      stats.successfulQueries++;
      stats.totalChars += result.chars;
      
      const findings = parseFindings(result.text);
      groupFindings += findings.length;
      stats.totalFindings += findings.length;
      
      console.log(` ✅ ${elapsed}ms, ${result.chars} chars, ${findings.length} items`);
      
      const queryId = await persistQuery({
        patientId: PATIENT_ID,
        queryText: JSON.stringify(q.input),
        category: group.category,
        findingCount: findings.length,
      });
      
      for (const finding of findings.slice(0, 25)) {
        const title = finding.title || finding.name || finding.symbol || finding.preferredName_A || finding.id || finding.pmid || 'Result';
        const summary = finding.abstractText || finding.abstract || finding.summary || finding.description || finding.text || JSON.stringify(finding).slice(0, 500);
        const url = finding.doi ? `https://doi.org/${finding.doi}` : (finding.url || finding.link || (finding.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${finding.pmid}/` : ''));
        
        await persistFinding({
          patientId: PATIENT_ID,
          source: q.tool.split('_')[0],
          title: String(title).slice(0, 500),
          summary: String(summary).slice(0, 2000),
          url: String(url),
          relevance: 0.7,
          evidenceLevel: 'unknown',
          queryId,
          rawData: JSON.stringify(finding),
        });
      }
      
      allResults.push({
        group: group.id,
        category: group.category,
        tool: q.tool,
        input: q.input,
        findingCount: findings.length,
        chars: result.chars,
        elapsed,
      });
      
    } else {
      stats.failedQueries++;
      stats.errors.push({ tool: q.tool, input: JSON.stringify(q.input).slice(0, 80), error: result.error });
      console.log(` ❌ ${elapsed}ms: ${result.error.slice(0, 100)}`);
    }
    
    // Delay between queries to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }
  
  const groupElapsed = Date.now() - groupStart;
  stats.byCategory[group.category] = { queries: group.queries.length, findings: groupFindings, elapsed: groupElapsed };
  console.log(`  ── ${group.category}: ${groupFindings} findings in ${(groupElapsed/1000).toFixed(1)}s`);
}

// ─── Summary ─────────────────────────────────────────────────────────

console.log('\n\n═══════════════════════════════════════════════════════════════');
console.log('  RESEARCH CAMPAIGN SUMMARY');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`  Total queries: ${stats.totalQueries}`);
console.log(`  Successful: ${stats.successfulQueries} (${((stats.successfulQueries/stats.totalQueries)*100).toFixed(0)}%)`);
console.log(`  Failed: ${stats.failedQueries}`);
console.log(`  Total findings: ${stats.totalFindings}`);
console.log(`  Total data: ${(stats.totalChars/1024).toFixed(0)} KB`);
console.log();
console.log('  By Category:');
for (const [cat, s] of Object.entries(stats.byCategory)) {
  console.log(`    ${cat}: ${s.findings} findings (${s.queries} queries, ${(s.elapsed/1000).toFixed(1)}s)`);
}

if (stats.errors.length > 0) {
  console.log(`\n  Errors (${stats.errors.length}):`);
  for (const e of stats.errors.slice(0, 20)) {
    console.log(`    ✗ ${e.tool}: ${e.error.slice(0, 100)}`);
  }
  if (stats.errors.length > 20) console.log(`    ... and ${stats.errors.length - 20} more`);
}

// Save results
const reportPath = resolve(ROOT, 'research/campaign-results.json');
mkdirSync(resolve(ROOT, 'research'), { recursive: true });
writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), stats, results: allResults }, null, 2));
console.log(`\n  Results saved to: ${reportPath}`);

// Verify DB
if (!DRY_RUN) {
  const fc = await db.execute({ sql: 'SELECT COUNT(*) as n FROM research_findings WHERE patient_id = ?', args: [PATIENT_ID] });
  const qc = await db.execute({ sql: 'SELECT COUNT(*) as n FROM research_queries WHERE patient_id = ?', args: [PATIENT_ID] });
  console.log(`\n  Database:`);
  console.log(`    research_findings: ${fc.rows[0].n}`);
  console.log(`    research_queries: ${qc.rows[0].n}`);
}

const { disconnectBiomedicalMcp } = await import('../dist/clients/biomedical-mcp.js');
await disconnectBiomedicalMcp();
db.close();

console.log('\n  Done.\n');
