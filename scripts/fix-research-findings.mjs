/**
 * Comprehensive Research Database Ingestion Script
 *
 * Phases:
 * 1. Extract PMIDs/external IDs from 707 findings raw_data and classify evidence levels
 * 2. Persist 78 research queries from campaign-results.json
 * 3. Ingest citation-verified findings from citation-verification-report.md
 * 4. Ingest BioMCP investigation findings from biomcp-investigation-report.md
 * 5. Persist hypotheses v3.0 (baseline)
 * 6. Create evidence links (findings ↔ hypotheses)
 * 7. Update hypotheses to v4.0 with Mayo/MCP data
 *
 * Usage: node scripts/fix-research-findings.mjs [--dry-run] [--phase N]
 */
import { createClient } from '@libsql/client';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const pid = 'tomasz-szychliński';
const dryRun = process.argv.includes('--dry-run');
const phaseArg = process.argv.find(a => a.startsWith('--phase'));
const onlyPhase = phaseArg ? parseInt(process.argv[process.argv.indexOf(phaseArg) + 1], 10) : null;
const now = new Date().toISOString();

function makeId(prefix, ...parts) {
  const hash = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

const stats = { phase1: { pmids: 0, pmcids: 0, genes: 0, drugs: 0, diseases: 0, interactions: 0, trials: 0, evidenceLevels: 0 }, phase2: { queries: 0 }, phase3: { findings: 0 }, phase4: { findings: 0 }, phase5: { hypotheses: 0 }, phase6: { links: 0 }, phase7: { hypotheses: 0 } };

console.log(dryRun ? '=== DRY RUN ===' : '=== EXECUTING ===');
if (onlyPhase) console.log(`Running only Phase ${onlyPhase}`);

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: Extract PMIDs from raw_data and classify evidence levels
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 1) {
  console.log('\n━━━ PHASE 1: Extract external IDs & classify evidence levels ━━━');

  const findings = await c.execute({
    sql: `SELECT id, source, source_tool, title, raw_data FROM research_findings WHERE patient_id = ?`,
    args: [pid],
  });

  const updates = [];

  for (const row of findings.rows) {
    const id = String(row.id);
    const source = String(row.source);
    const rawStr = String(row.raw_data ?? '');
    let externalId = null;
    let externalIdType = null;
    let evidenceLevel = 'unknown';

    if (!rawStr || rawStr === 'null') continue;

    try {
      // ── biomcp articles: PMID in "id" field ──
      if (source === 'biomcp') {
        const pmidMatch = rawStr.match(/"id"\s*:\s*"(\d{6,})/);
        if (pmidMatch) {
          externalId = pmidMatch[1];
          externalIdType = 'pmid';
          evidenceLevel = 'article'; // BioMCP returns journal articles
          stats.phase1.pmids++;
        }
      }

      // ── biocontext articles: PMID in "pmid" field ──
      else if (source === 'biocontext') {
        const pmidMatch = rawStr.match(/"pmid"\s*:\s*"(\d+)/);
        const pmcMatch = rawStr.match(/"pmcid"\s*:\s*"(PMC\d+)/);

        if (pmidMatch) {
          externalId = pmidMatch[1];
          externalIdType = 'pmid';
          evidenceLevel = 'article';
          stats.phase1.pmids++;
        } else if (pmcMatch) {
          externalId = pmcMatch[1];
          externalIdType = 'pmcid';
          evidenceLevel = 'article';
          stats.phase1.pmcids++;
        }

        // FDA drug data (generic_name field present)
        if (!externalId && rawStr.includes('"generic_name"')) {
          const appNoMatch = rawStr.match(/"application_number"\s*:\s*"(\w+)/);
          if (appNoMatch) {
            externalId = appNoMatch[1];
            externalIdType = 'fda_application';
          }
          evidenceLevel = 'regulatory';
          stats.phase1.drugs++;
        }

        // STRING protein interactions (stringId_A field present)
        if (!externalId && rawStr.includes('"stringId_A"')) {
          const geneA = rawStr.match(/"preferredName_A"\s*:\s*"(\w+)/);
          const geneB = rawStr.match(/"preferredName_B"\s*:\s*"(\w+)/);
          if (geneA && geneB) {
            externalId = `${geneA[1]}-${geneB[1]}`;
            externalIdType = 'string_interaction';
          }
          evidenceLevel = 'database';
          stats.phase1.interactions++;
        }

        // Clinical trials (protocolSection field present)
        if (!externalId && rawStr.includes('"protocolSection"')) {
          const nctMatch = rawStr.match(/"nctId"\s*:\s*"(NCT\d+)/);
          if (nctMatch) {
            externalId = nctMatch[1];
            externalIdType = 'nct';
          }
          evidenceLevel = 'clinical-trial';
          stats.phase1.trials++;
        }
      }

      // ── biothings: gene data ──
      else if (source === 'biothings') {
        const symbolMatch = rawStr.match(/"symbol"\s*:\s*"(\w+)/);
        const entrezMatch = rawStr.match(/"_id"\s*:\s*"?(\d+)/);
        if (symbolMatch) {
          externalId = symbolMatch[1].toUpperCase();
          externalIdType = 'gene_symbol';
          stats.phase1.genes++;
        } else if (entrezMatch) {
          externalId = entrezMatch[1];
          externalIdType = 'entrez_gene';
          stats.phase1.genes++;
        }
        evidenceLevel = 'database';
      }

      // ── gget: disease/phenotype ontology ──
      else if (source === 'gget') {
        // gget returns dataframe-like JSON with id column
        const mondoMatch = rawStr.match(/MONDO_\d+/);
        const orphaMatch = rawStr.match(/Orphanet_\d+/);
        const hpMatch = rawStr.match(/HP_\d+/);
        if (mondoMatch) {
          externalId = mondoMatch[0];
          externalIdType = 'mondo';
          stats.phase1.diseases++;
        } else if (orphaMatch) {
          externalId = orphaMatch[0];
          externalIdType = 'orphanet';
          stats.phase1.diseases++;
        } else if (hpMatch) {
          externalId = hpMatch[0];
          externalIdType = 'hpo';
          stats.phase1.diseases++;
        }
        evidenceLevel = 'database';
      }

      // ── opentargets: disease-gene associations ──
      else if (source === 'opentargets') {
        const mondoMatch = rawStr.match(/MONDO_\d+/);
        const orphaMatch = rawStr.match(/Orphanet_\d+/);
        if (mondoMatch) {
          externalId = mondoMatch[0];
          externalIdType = 'mondo';
          stats.phase1.diseases++;
        } else if (orphaMatch) {
          externalId = orphaMatch[0];
          externalIdType = 'orphanet';
          stats.phase1.diseases++;
        }
        evidenceLevel = 'database';
      }
    } catch (e) {
      // JSON parse errors for truncated raw_data — skip
    }

    if (externalId || evidenceLevel !== 'unknown') {
      updates.push({ id, externalId, externalIdType, evidenceLevel });
    }
  }

  console.log(`  Found ${updates.length} findings to update (of ${findings.rows.length} total)`);
  console.log(`  PMIDs: ${stats.phase1.pmids}, PMCIDs: ${stats.phase1.pmcids}, Genes: ${stats.phase1.genes}, Drugs: ${stats.phase1.drugs}, Diseases: ${stats.phase1.diseases}, Interactions: ${stats.phase1.interactions}, Trials: ${stats.phase1.trials}`);

  if (!dryRun) {
    // Deduplicate: track which external IDs have been assigned
    const assignedIds = new Set();
    let updated = 0;
    let skippedDupes = 0;

    for (const u of updates) {
      const sets = [];
      const args = [];

      // Check if this external_id has already been assigned to another finding
      const extKey = u.externalId ? `${u.externalIdType}:${u.externalId}` : null;
      if (extKey && assignedIds.has(extKey)) {
        // Skip assigning external_id (would violate UNIQUE constraint)
        // Still update evidence_level
        if (u.evidenceLevel !== 'unknown') {
          sets.push('evidence_level = ?');
          args.push(u.evidenceLevel);
        }
        skippedDupes++;
      } else {
        if (u.externalId) {
          sets.push('external_id = ?');
          args.push(u.externalId);
          sets.push('external_id_type = ?');
          args.push(u.externalIdType);
          assignedIds.add(extKey);
        }
        if (u.evidenceLevel !== 'unknown') {
          sets.push('evidence_level = ?');
          args.push(u.evidenceLevel);
        }
      }

      if (sets.length > 0) {
        args.push(u.id);
        await c.execute({
          sql: `UPDATE research_findings SET ${sets.join(', ')} WHERE id = ?`,
          args,
        });
      }
      updated++;
      if (updated % 100 === 0) process.stdout.write(`  ... updated ${updated}/${updates.length}\n`);
    }
    console.log(`  Updated ${updated} findings (${skippedDupes} duplicate external IDs skipped)`);
  }

  // Count duplicate PMIDs (same article from different sources)
  if (!dryRun) {
    const dupes = await c.execute({
      sql: `SELECT external_id, COUNT(*) as cnt FROM research_findings
            WHERE patient_id = ? AND external_id_type = 'pmid' AND external_id IS NOT NULL
            GROUP BY external_id HAVING cnt > 1`,
      args: [pid],
    });
    console.log(`  Duplicate PMIDs across sources: ${dupes.rows.length}`);
    for (const d of dupes.rows) {
      console.log(`    PMID ${d.external_id}: ${d.cnt} copies`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: Persist 78 research queries from campaign-results.json
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 2) {
  console.log('\n━━━ PHASE 2: Persist research queries ━━━');

  const campaignData = JSON.parse(readFileSync('research/campaign-results.json', 'utf8'));
  const campaignDate = campaignData.timestamp;

  // For each successful query, find matching finding IDs
  // Findings were inserted in order matching queries
  const allFindings = await c.execute({
    sql: `SELECT id, source FROM research_findings WHERE patient_id = ? ORDER BY id`,
    args: [pid],
  });
  const findingIds = allFindings.rows.map(r => String(r.id));

  let findingOffset = 0;

  for (const result of campaignData.results) {
    const queryId = makeId('query', result.group, result.tool, result.category, String(result.findingCount));

    // Slice finding IDs for this query's results
    const qFindingIds = findingIds.slice(findingOffset, findingOffset + result.findingCount);
    findingOffset += result.findingCount;

    // Extract the actual query text from tool input (input is already an object)
    let queryText = '';
    const input = typeof result.input === 'string' ? JSON.parse(result.input) : result.input;
    if (input.command) {
      // biomcp_shell: extract query from "search article \"...\"" command
      const m = input.command.match(/search\s+article\s+"([^"]+)"/);
      queryText = m ? m[1] : input.command;
    } else if (input.queryString) {
      queryText = input.queryString;
    } else if (input.query_strings) {
      queryText = Array.isArray(input.query_strings) ? input.query_strings.join('; ') : input.query_strings;
    } else if (input.condition) {
      queryText = input.condition;
    } else if (input.q) {
      queryText = input.q;
    } else if (input.query) {
      queryText = input.query;
    } else if (input.gene_name) {
      queryText = `gene: ${input.gene_name}`;
    } else if (input.protein_symbol) {
      queryText = `protein: ${input.protein_symbol}`;
    } else {
      queryText = JSON.stringify(input).slice(0, 200);
    }

    if (!dryRun) {
      await c.execute({
        sql: `INSERT OR REPLACE INTO research_queries
              (id, patient_id, query, tool_used, agent, result_count, finding_ids,
               synthesis, gaps, suggested_follow_up, stage, date, duration_ms,
               evidence_tier, validation_status, source_credibility)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          queryId, pid, queryText, result.tool, 'mcp-research-campaign',
          result.findingCount, JSON.stringify(qFindingIds),
          null, null, null, null, campaignDate, result.elapsed,
          'T3-ai-inferred', 'unvalidated', 70,
        ],
      });
    }
    stats.phase2.queries++;
  }

  console.log(`  Persisted ${stats.phase2.queries} research queries`);
  console.log(`  Finding offset consumed: ${findingOffset} / ${findingIds.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: Ingest citation-verified findings
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 3) {
  console.log('\n━━━ PHASE 3: Ingest citation-verified findings ━━━');

  // 17 verified citations from citation-verification-report.md
  const citationFindings = [
    { pmid: '9414053', title: 'GON stimulation activates trigeminal nucleus caudalis neurons', claim: 'GON stimulation directly activates the trigeminal nucleus caudalis', alignment: 'likely-accurate', pubType: 'experimental' },
    { pmid: '18549410', title: 'Greater occipital nerve block for cluster headache', claim: 'GON block efficacy for headache conditions', alignment: 'likely-accurate', pubType: 'clinical-trial' },
    { pmid: '31229744', title: 'Atlantoaxial fixation for trigeminal neuralgia with CVJ anomaly', claim: 'Atlantoaxial fixation can resolve trigeminal pain in CVJ anomaly patients', alignment: 'likely-accurate', pubType: 'case-report' },
    { pmid: '19558301', title: 'Basilar artery ectasia and trigeminal neuralgia', claim: 'Basilar artery ectasia associated with trigeminal neuralgia', alignment: 'partially-supported', pubType: 'case-report' },
    { pmid: '28025837', title: 'Ketamine infusion for refractory chronic headache', claim: 'Ketamine effective for refractory headache', alignment: 'likely-accurate', pubType: 'clinical-trial' },
    { pmid: '19748401', title: 'Central sensitization in trigeminocervical complex', claim: 'Central sensitization mechanism in trigeminal-cervical convergence', alignment: 'likely-accurate', pubType: 'review' },
    { pmid: '34312221', title: 'SPG stimulation for cluster headache and chronic migraine', claim: 'SPG stimulation treats refractory craniofacial pain', alignment: 'likely-accurate', pubType: 'review' },
    { pmid: '23314784', title: 'Salivary gland biopsy for Sjögren syndrome diagnosis', claim: 'Salivary biopsy diagnostic criteria for Sjögren', alignment: 'likely-accurate', pubType: 'guideline' },
    { pmid: '41168553', title: 'ACR/EULAR classification criteria update', claim: 'ACR/EULAR criteria for rheumatic disease classification', alignment: 'likely-accurate', pubType: 'guideline' },
    { pmid: '27785888', title: 'Behçet disease diagnostic criteria review', claim: 'Behçet disease diagnostic criteria and clinical features', alignment: 'likely-accurate', pubType: 'review' },
    { pmid: '23441863', title: 'Dynamic cervical MRI technique for CVJ evaluation', claim: 'Dynamic MRI reveals CVJ abnormalities missed on static imaging', alignment: 'needs-manual-review', pubType: 'methodology' },
    { pmid: '29952883', title: 'CVJ realignment surgery outcomes', claim: 'CVJ surgical realignment can improve neurological outcomes', alignment: 'partially-supported', pubType: 'case-series' },
    { pmid: '16247236', title: 'Trigeminal neuralgia secondary to basilar impression', claim: 'Basilar impression can cause secondary trigeminal neuralgia', alignment: 'likely-accurate', pubType: 'case-report' },
  ];

  // PMC references
  const pmcFindings = [
    { pmcid: 'PMC4426526', title: 'Ultrasound-guided nerve blocks for craniofacial pain', alignment: 'likely-accurate', pubType: 'review' },
    { pmcid: 'PMC12004780', title: 'Anti-Ro60 antibody subsets in autoimmune disease', alignment: 'partially-supported', pubType: 'review' },
    { pmcid: 'PMC7744494', title: 'Cocaine/levamisole-induced vasculitis mimicking systemic autoimmune disease', alignment: 'needs-manual-review', pubType: 'case-report' },
    { pmcid: 'PMC11396482', title: 'Neuroinflammatory mechanisms in chronic pain syndromes', alignment: 'likely-accurate', pubType: 'review' },
  ];

  const pubTypeToEvidence = {
    'experimental': 'observational',
    'clinical-trial': 'rct',
    'case-report': 'case-report',
    'case-series': 'case-series',
    'review': 'review',
    'guideline': 'guideline',
    'methodology': 'observational',
  };

  for (const cf of citationFindings) {
    const findingId = makeId('finding', 'citation-verified', cf.pmid);
    if (!dryRun) {
      // Use dedup-aware insert: check external_id first
      const existing = await c.execute({
        sql: `SELECT id FROM research_findings WHERE patient_id = ? AND external_id = ? AND external_id_type = 'pmid'`,
        args: [pid, cf.pmid],
      });
      if (existing.rows.length > 0) {
        console.log(`  Skip PMID ${cf.pmid} (already exists as ${existing.rows[0].id})`);
        continue;
      }
      await c.execute({
        sql: `INSERT INTO research_findings
              (id, patient_id, source, source_tool, external_id, external_id_type,
               title, summary, url, relevance, evidence_level, date, raw_data,
               evidence_tier, validation_status, source_credibility, content_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          findingId, pid, 'citation-verification', 'manual-verification',
          cf.pmid, 'pmid', cf.title,
          `Verified citation: ${cf.claim}. Alignment: ${cf.alignment}`,
          `https://pubmed.ncbi.nlm.nih.gov/${cf.pmid}/`, 0.9,
          pubTypeToEvidence[cf.pubType] ?? 'article',
          now, JSON.stringify(cf),
          'T1-official', cf.alignment === 'likely-accurate' ? 'confirmed' : 'unvalidated',
          cf.alignment === 'likely-accurate' ? 90 : 70,
          createHash('sha256').update(`citation-verification|${cf.title}|${now}`).digest('hex').slice(0, 16),
          now,
        ],
      });
    }
    stats.phase3.findings++;
  }

  for (const pf of pmcFindings) {
    const findingId = makeId('finding', 'citation-verified', pf.pmcid);
    if (!dryRun) {
      const existing = await c.execute({
        sql: `SELECT id FROM research_findings WHERE patient_id = ? AND external_id = ? AND external_id_type = 'pmcid'`,
        args: [pid, pf.pmcid],
      });
      if (existing.rows.length > 0) {
        console.log(`  Skip ${pf.pmcid} (already exists as ${existing.rows[0].id})`);
        continue;
      }
      await c.execute({
        sql: `INSERT INTO research_findings
              (id, patient_id, source, source_tool, external_id, external_id_type,
               title, summary, url, relevance, evidence_level, date, raw_data,
               evidence_tier, validation_status, source_credibility, content_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          findingId, pid, 'citation-verification', 'manual-verification',
          pf.pmcid, 'pmcid', pf.title,
          `PMC reference: ${pf.alignment}`,
          `https://pmc.ncbi.nlm.nih.gov/articles/${pf.pmcid}/`, 0.85,
          pubTypeToEvidence[pf.pubType] ?? 'article',
          now, JSON.stringify(pf),
          'T1-official', 'unvalidated', 75,
          createHash('sha256').update(`citation-verification|${pf.title}|${now}`).digest('hex').slice(0, 16),
          now,
        ],
      });
    }
    stats.phase3.findings++;
  }

  console.log(`  Processed ${stats.phase3.findings} citation-verified findings`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4: Ingest BioMCP investigation findings
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 4) {
  console.log('\n━━━ PHASE 4: Ingest BioMCP investigation findings ━━━');

  const biomcpFindings = [
    {
      id: 'kf1-homocysteine-enrichment',
      title: 'SNP gene-set enrichment: homocysteine metabolic process',
      summary: 'Gene-set enrichment analysis of patient SNP panel (MTHFR, CBS, COMT, VDR, ACE, HFE) shows convergence on homocysteine metabolic process (GO:0050667) with p=3.29e-6. Homocysteine pathway unifies genetic findings into single metabolic vulnerability.',
      evidenceLevel: 'observational',
      externalId: 'GO:0050667',
      externalIdType: 'go_term',
    },
    {
      id: 'kf2-comt-cervical-expression',
      title: 'COMT cervical C-1 expression creates molecular link to CVJ anomaly',
      summary: 'GTEx tissue expression analysis shows COMT expressed at cervical C-1 spinal cord level (56.2 TPM). Creates molecular link between COMT Val158Met SNP and CVJ anomaly at C1 assimilation site. COMT modulates pain processing at the exact anatomical site of structural compression.',
      evidenceLevel: 'database',
      externalId: 'COMT',
      externalIdType: 'gene_symbol',
    },
    {
      id: 'kf3-comt-bupropion-interaction',
      title: 'COMT-Bupropion drug interaction documented in DGIdb',
      summary: 'DGIdb documents COMT-Bupropion interaction (score 0.219). Relevant for pharmacogenomic treatment planning given patient COMT Val158Met SNP status. Bupropion as potential dopamine-modulating intervention.',
      evidenceLevel: 'database',
      externalId: 'COMT',
      externalIdType: 'gene_symbol',
    },
    {
      id: 'kf4-ace-testicular-expression',
      title: 'ACE testicular expression explains elevated testosterone',
      summary: 'GTEx tissue expression analysis shows ACE highest expression in testicular tissue (112.3 TPM). Patient has ACE I/D polymorphism AND elevated testosterone (1,061 ng/dl). ACE tissue tropism provides mechanistic explanation for elevated androgen levels.',
      evidenceLevel: 'database',
      externalId: 'ACE',
      externalIdType: 'gene_symbol',
    },
    {
      id: 'kf5-cbs-mthfr-homocysteine-neurotoxicity',
      title: 'CBS/MTHFR → homocysteine neurotoxicity mechanism',
      summary: 'CBS 844ins68 + MTHFR C677T compound heterozygosity creates dual-pathway impairment of homocysteine metabolism. Elevated homocysteine is directly neurotoxic via NMDA receptor agonism, explaining small fiber neuropathy and sensory axonal neuropathy pattern. PMID 39465424.',
      evidenceLevel: 'article',
      externalId: '39465424',
      externalIdType: 'pmid',
    },
    {
      id: 'kf6-vdr-autoimmune-susceptibility',
      title: 'VDR variants predispose to SLE/Sjögren autoimmunity',
      summary: 'VDR TaqI/FokI/BsmI variants associated with increased susceptibility to SLE and Sjögren syndrome in multiple meta-analyses (PMIDs 34977255, 37189455). Patient has VDR Taq TT genotype + Anti-Ro-60 positive + history of vitamin D deficiency.',
      evidenceLevel: 'review',
      externalId: '34977255',
      externalIdType: 'pmid',
    },
    {
      id: 'kf7-ldn-trpm3-mechanism',
      title: 'LDN restores TRPM3 ion channels (novel mechanism)',
      summary: 'Low-dose naltrexone restores TRPM3 ion channel function in natural killer cells, providing novel mechanism beyond TLR4/microglial modulation for LDN efficacy in chronic pain. Published May 2025 (PMID 40458265). Explains partial response in patient on LDN 2.5mg/day.',
      evidenceLevel: 'article',
      externalId: '40458265',
      externalIdType: 'pmid',
    },
  ];

  for (const bf of biomcpFindings) {
    const findingId = makeId('finding', 'biomcp-investigation', bf.id);
    if (!dryRun) {
      // Check dedup by external_id
      if (bf.externalId && bf.externalIdType) {
        const existing = await c.execute({
          sql: `SELECT id FROM research_findings WHERE patient_id = ? AND external_id = ? AND external_id_type = ?`,
          args: [pid, bf.externalId, bf.externalIdType],
        });
        if (existing.rows.length > 0) {
          console.log(`  Skip ${bf.id} (${bf.externalIdType}:${bf.externalId} already exists as ${existing.rows[0].id})`);
          stats.phase4.findings++;
          continue;
        }
      }

      await c.execute({
        sql: `INSERT INTO research_findings
              (id, patient_id, source, source_tool, external_id, external_id_type,
               title, summary, url, relevance, evidence_level, date, raw_data,
               evidence_tier, validation_status, source_credibility, content_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          findingId, pid, 'biomcp-investigation', 'BioMCP',
          bf.externalId, bf.externalIdType,
          bf.title, bf.summary,
          bf.externalIdType === 'pmid' ? `https://pubmed.ncbi.nlm.nih.gov/${bf.externalId}/` : null,
          0.95, bf.evidenceLevel, now, JSON.stringify(bf),
          'T3-ai-inferred', 'unvalidated', 80,
          createHash('sha256').update(`biomcp-investigation|${bf.title}|${now}`).digest('hex').slice(0, 16),
          now,
        ],
      });
    }
    stats.phase4.findings++;
  }

  console.log(`  Processed ${stats.phase4.findings} BioMCP investigation findings`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5: Persist hypotheses v3.0 (baseline)
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 5) {
  console.log('\n━━━ PHASE 5: Persist v3.0 hypotheses ━━━');

  const hypotheses = [
    {
      name: 'H1: CVJ-Driven Multi-Node Pain Network',
      icdCode: 'Q75.9', // congenital malformation of skull/face bones
      probabilityLow: 45,
      probabilityHigh: 60,
      advocateCase: 'Structural CVJ anomaly (C1 assimilation, platybasia, basilar impression) creates compression at trigeminocervical complex. 4-step mechanism: structural compression → TCC convergence → migration event → SPG relay. COMT expression at C-1 (56.2 TPM) provides molecular link. Published case analogues of CVJ-driven trigeminal pain resolution after surgical correction. Multi-node circuit (GON/TCC/SPG/cervical muscles) explains pain migration pattern and partial treatment responses.',
      skepticCase: 'CVJ anomaly is congenital and lifelong, but pain onset at age 18 suggests trigger event. SPECT was negative for structural involvement. No dynamic MRI performed to confirm active compression. Many patients with similar CVJ anomalies are asymptomatic.',
      arbiterVerdict: 'STRONG: structural anomaly is undeniable (T1), mechanism well-supported by TCC literature. Needs dynamic CVJ MRI to confirm active compression vs stable variant.',
      certaintyLevel: 'STRONG',
    },
    {
      name: 'H2: Cervical Myelopathy',
      icdCode: 'G99.2', // myelopathy in diseases classified elsewhere
      probabilityLow: 30,
      probabilityHigh: 45,
      advocateCase: 'EMG 2025-03-31 confirms sensory axonal neuropathy. CVJ anomaly creates risk of cord compression at craniocervical junction. Basilar impression (Dens hochstand 10mm) with platybasia creates hypomochlion effect on medulla oblongata. Progressive weakness pattern consistent with myelopathy.',
      skepticCase: 'Skin biopsy 2024-06-06 showed normal IENFD (7.3/mm vs reference >4.7/mm), excluding small fiber neuropathy. MRI shows no edema or compression on static imaging. Weakness could be pain-driven deconditioning rather than true myelopathy.',
      arbiterVerdict: 'MODERATE: EMG-confirmed axonal neuropathy supports cervical involvement, but static MRI lacks compression signs. Dynamic MRI would be definitive.',
      certaintyLevel: 'MODERATE',
    },
    {
      name: 'H3: Central Sensitization / Nociplastic Pain',
      icdCode: 'G89.4', // chronic pain syndrome
      probabilityLow: 50,
      probabilityHigh: 65,
      advocateCase: 'Patient meets 5/5 central sensitization markers: allodynia, hyperalgesia, pain spreading beyond initial territory, pain amplification, temporal summation. 42+ treatment failures consistent with central sensitization phenotype. LDN 2.5mg/day is the ONLY partially effective treatment (addresses neuroinflammation via TLR4/TRPM3 mechanisms). LDN restoring TRPM3 channels (PMID 40458265) provides mechanistic support.',
      skepticCase: 'Central sensitization is a descriptor not a diagnosis — it describes a physiological state that requires an initiating cause. Cannot be the sole explanation. LDN partial response could be placebo or unrelated mechanism.',
      arbiterVerdict: 'STRONG as co-mechanism alongside H1 structural driver. H1+H3 combination (structural trigger → central amplification) is the strongest combined framework.',
      certaintyLevel: 'STRONG',
    },
    {
      name: 'H4: Autoimmune (Sjögren/GPA/Behçet)',
      icdCode: 'M35.0', // Sjögren syndrome
      probabilityLow: 10,
      probabilityHigh: 25,
      advocateCase: 'Anti-Ro-60 positive (329.41 U/ml, Aug 2025). PR3-ANCA intermittent positivity. VDR TaqI variant predisposes to SLE/Sjögren. Progressive leukopenia (WBC 3.5→2.59) consistent with autoimmune cytopenia. Oral ulcers and dry eyes reported.',
      skepticCase: 'Anti-Ro-60 is isolated finding — no SSA/SSB panel pattern. PR3-ANCA was transiently positive and drug-related elevation cannot be excluded. ANA repeatedly negative. CRP, ESR consistently normal. No synovitis, no rash, no systemic inflammatory markers.',
      arbiterVerdict: 'WEAK: single autoantibody (Anti-Ro-60) without supporting panel or inflammatory markers. Monitoring warranted but primary autoimmune disease unlikely.',
      certaintyLevel: 'WEAK',
    },
    {
      name: 'H5: Developmental/Connective Tissue Phenotype',
      icdCode: 'Q79.6', // Ehlers-Danlos syndrome
      probabilityLow: 15,
      probabilityHigh: 25,
      advocateCase: 'CVJ anomaly itself suggests developmental variant. DHEA-S elevated (552 mcg/dL). Cholesterol abnormalities suggest metabolic phenotype. ACE testicular expression (112.3 TPM) links to elevated testosterone. Homocysteine pathway convergence (p=3.29e-6) from SNP gene-set enrichment. CBS/MTHFR dual impairment creates connective tissue vulnerability.',
      skepticCase: 'No joint hypermobility (Beighton score not reported). No skin hyperextensibility. No family history of connective tissue disease. DHEA-S and testosterone elevations could be physiologic variation.',
      arbiterVerdict: 'WEAK: interesting metabolic/genetic pattern but lacks clinical phenotype of classical connective tissue disease. Genetic testing (WES) would clarify.',
      certaintyLevel: 'WEAK',
    },
    {
      name: 'H6: Airway-Bruxism-Cervical Feedback Loop',
      icdCode: 'G47.63', // sleep-related bruxism
      probabilityLow: 10,
      probabilityHigh: 20,
      advocateCase: 'Patient has documented sleep bruxism. Orthodontic treatment history. Nasal surgery 2012 preceded pain onset. Airway compromise → bruxism → cervical muscle strain → CVJ stress → pain amplification creates self-reinforcing loop. Individual components documented (T1) but loop mechanism is T3.',
      skepticCase: 'Loop mechanism is theoretical — no sleep study documenting airway obstruction. Bruxism is common (8-31% prevalence) and usually benign. No polysomnography performed.',
      arbiterVerdict: 'MODERATE as contributing factor, not standalone hypothesis. Individual components (bruxism, orthodontics, nasal surgery) are T1-documented but feedback loop is T3 speculation.',
      certaintyLevel: 'MODERATE',
    },
  ];

  for (const h of hypotheses) {
    const hypoId = makeId('hypothesis', h.name, 'v3');
    if (!dryRun) {
      const existing = await c.execute({
        sql: `SELECT id FROM research_hypotheses WHERE patient_id = ? AND name = ? AND version = 3`,
        args: [pid, h.name],
      });
      if (existing.rows.length > 0) {
        console.log(`  Skip ${h.name} v3 (already exists)`);
        stats.phase5.hypotheses++;
        continue;
      }
      await c.execute({
        sql: `INSERT OR REPLACE INTO research_hypotheses
              (id, patient_id, name, icd_code, probability_low, probability_high,
               advocate_case, skeptic_case, arbiter_verdict,
               evidence_tier, certainty_level, stage, version, superseded_by, date,
               validation_status, source_credibility)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          hypoId, pid, h.name, h.icdCode,
          h.probabilityLow, h.probabilityHigh,
          h.advocateCase, h.skepticCase, h.arbiterVerdict,
          'T3-ai-inferred', h.certaintyLevel,
          5, 3, null, '2026-03-08',
          'unvalidated', 75,
        ],
      });
    }
    stats.phase5.hypotheses++;
    console.log(`  ${dryRun ? 'Would add' : 'Added'} ${h.name} v3 (${h.probabilityLow}-${h.probabilityHigh}%)`);
  }

  console.log(`  Processed ${stats.phase5.hypotheses} v3.0 hypotheses`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6: Create evidence links (findings ↔ hypotheses)
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 6) {
  console.log('\n━━━ PHASE 6: Create evidence links ━━━');

  // Get hypothesis IDs (v3, non-superseded)
  const hypotheses = await c.execute({
    sql: `SELECT id, name FROM research_hypotheses WHERE patient_id = ? AND superseded_by IS NULL`,
    args: [pid],
  });
  const hypoMap = {};
  for (const h of hypotheses.rows) {
    hypoMap[String(h.name)] = String(h.id);
  }

  if (Object.keys(hypoMap).length === 0) {
    console.log('  No hypotheses found — run Phase 5 first');
  } else {
    // Get all findings with their titles for category mapping
    const findings = await c.execute({
      sql: `SELECT id, title, source FROM research_findings WHERE patient_id = ?`,
      args: [pid],
    });

    // Map campaign categories → hypothesis names
    // We use title keyword matching since findings don't store category directly
    const categoryPatterns = {
      'H1: CVJ-Driven Multi-Node Pain Network': [
        /craniocervical/i, /CVJ/i, /craniovertebral/i, /trigeminal/i, /occipital.*nerve/i,
        /trigeminocervical/i, /basilar.*impression/i, /platybasia/i, /atlantoaxial/i,
        /C1.*assimilation/i, /cervicogenic.*headache/i, /occipital.*neuralgia/i,
        /SPG/i, /sphenopalatine/i, /GON/i, /greater.*occipital/i, /craniofacial.*pain/i,
      ],
      'H2: Cervical Myelopathy': [
        /myelopathy/i, /spinal.*cord/i, /cervical.*stenosis/i, /cord.*compression/i,
        /cervical.*spine/i, /radiculopathy/i,
      ],
      'H3: Central Sensitization / Nociplastic Pain': [
        /central.*sensitiz/i, /nociplastic/i, /fibromyalgia/i, /allodynia/i,
        /hyperalgesia/i, /pain.*amplif/i, /chronic.*pain/i, /pain.*process/i,
        /neuropathic.*pain/i, /pain.*modulation/i, /pain.*mechanism/i,
        /low.*dose.*naltrexone/i, /LDN/i, /naltrexone/i, /TLR4/i, /TRPM3/i,
      ],
      'H4: Autoimmune (Sjögren/GPA/Behçet)': [
        /autoimmun/i, /Sjögren/i, /sjogren/i, /ANCA/i, /vasculit/i, /GPA/i,
        /Behçet/i, /behcet/i, /anti.*Ro/i, /SSA/i, /leukopenia/i, /WBC/i,
        /neutropenia/i, /lupus/i, /SLE/i, /rheumatoid/i,
      ],
      'H5: Developmental/Connective Tissue Phenotype': [
        /connective.*tissue/i, /Ehlers.*Danlos/i, /EDS/i, /collagen/i,
        /hypermobil/i, /DHEA/i, /testosterone/i, /homocysteine/i,
        /MTHFR/i, /CBS/i, /genetic/i, /developmental/i, /VDR/i,
      ],
      'H6: Airway-Bruxism-Cervical Feedback Loop': [
        /bruxism/i, /sleep.*apnea/i, /airway/i, /TMJ/i, /temporomandibular/i,
        /sleep.*disorder/i, /orthodontic/i,
      ],
    };

    let linkCount = 0;
    for (const f of findings.rows) {
      const title = String(f.title ?? '');
      const fId = String(f.id);

      for (const [hypoName, patterns] of Object.entries(categoryPatterns)) {
        const hypoId = hypoMap[hypoName];
        if (!hypoId) continue;

        const matched = patterns.some(p => p.test(title));
        if (!matched) continue;

        const linkId = makeId('link', hypoId, fId, 'supporting');

        if (!dryRun) {
          // Dedup check
          const existing = await c.execute({
            sql: `SELECT id FROM hypothesis_evidence_links WHERE hypothesis_id = ? AND finding_id = ? AND direction = 'supporting'`,
            args: [hypoId, fId],
          });
          if (existing.rows.length > 0) continue;

          await c.execute({
            sql: `INSERT INTO hypothesis_evidence_links
                  (id, patient_id, hypothesis_id, finding_id, clinical_record_id, clinical_record_type,
                   direction, claim, confidence, tier, date, notes)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              linkId, pid, hypoId, fId, null, null,
              'supporting', title.slice(0, 200), 0.6, 'T3-ai-inferred',
              now, `Auto-linked by keyword matching on title`,
            ],
          });
        }
        linkCount++;
      }
    }

    // Add clinical record links (key lab results → hypotheses)
    const clinicalLinks = [
      // H4 contradicting evidence (Mayo normal autoimmune panel)
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-ana-0.2', recordType: 'lab_result', direction: 'contradicting', claim: 'ANA 0.2 U (negative) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-anti-ccp-neg', recordType: 'lab_result', direction: 'contradicting', claim: 'Anti-CCP <15.6 U (negative) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-crp-normal', recordType: 'lab_result', direction: 'contradicting', claim: 'CRP <3.0 mg/L (normal) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-esr-2', recordType: 'lab_result', direction: 'contradicting', claim: 'ESR 2 mm/h (normal) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-rf-neg', recordType: 'lab_result', direction: 'contradicting', claim: 'Rheumatoid Factor <15 IU/mL (negative) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-iga-normal', recordType: 'lab_result', direction: 'contradicting', claim: 'IgA 120 mg/dL (normal) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-igg-normal', recordType: 'lab_result', direction: 'contradicting', claim: 'IgG 1160 mg/dL (normal) at Mayo Clinic Dec 2024' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'mayo-ttg-normal', recordType: 'lab_result', direction: 'contradicting', claim: 'tTG IgA <1.2 U/mL (normal) at Mayo Clinic Dec 2024' },

      // H4 supporting evidence
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'anti-ro60-positive', recordType: 'lab_result', direction: 'supporting', claim: 'Anti-Ro-60 329.41 U/ml (positive, Aug 2025)' },
      { hypoName: 'H4: Autoimmune (Sjögren/GPA/Behçet)', recordId: 'wbc-trend-declining', recordType: 'lab_result', direction: 'supporting', claim: 'WBC declining: 4.3 (Dec 2024) → 2.59 (Aug 2025)' },

      // H5 supporting evidence
      { hypoName: 'H5: Developmental/Connective Tissue Phenotype', recordId: 'mayo-dheas-552', recordType: 'lab_result', direction: 'supporting', claim: 'DHEA-S 552 mcg/dL (high, ref 57-522) at Mayo Clinic Dec 2024' },
      { hypoName: 'H5: Developmental/Connective Tissue Phenotype', recordId: 'cholesterol-high', recordType: 'lab_result', direction: 'supporting', claim: 'Total cholesterol 247 mg/dL (high), LDL 170 (high), Non-HDL 192 (high)' },
      { hypoName: 'H5: Developmental/Connective Tissue Phenotype', recordId: 'testosterone-high', recordType: 'lab_result', direction: 'supporting', claim: 'Testosterone 925 ng/dl (high, Sep 2025)' },
    ];

    for (const cl of clinicalLinks) {
      const hypoId = hypoMap[cl.hypoName];
      if (!hypoId) continue;

      const linkId = makeId('link', hypoId, cl.recordId, cl.direction);
      if (!dryRun) {
        const existing = await c.execute({
          sql: `SELECT id FROM hypothesis_evidence_links WHERE hypothesis_id = ? AND clinical_record_id = ? AND direction = ?`,
          args: [hypoId, cl.recordId, cl.direction],
        });
        if (existing.rows.length > 0) continue;

        await c.execute({
          sql: `INSERT INTO hypothesis_evidence_links
                (id, patient_id, hypothesis_id, finding_id, clinical_record_id, clinical_record_type,
                 direction, claim, confidence, tier, date, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            linkId, pid, hypoId, null, cl.recordId, cl.recordType,
            cl.direction, cl.claim, cl.direction === 'contradicting' ? 0.9 : 0.7,
            'T1-official', now, 'Mayo Clinic lab results (Dec 2024) / Diagnostyka labs (Aug-Sep 2025)',
          ],
        });
      }
      linkCount++;
    }

    stats.phase6.links = linkCount;
    console.log(`  Created ${linkCount} evidence links`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7: Update hypotheses to v4.0 with Mayo/MCP data
// ─────────────────────────────────────────────────────────────────────────────
if (!onlyPhase || onlyPhase === 7) {
  console.log('\n━━━ PHASE 7: Update hypotheses to v4.0 ━━━');

  const v4Hypotheses = [
    {
      name: 'H1: CVJ-Driven Multi-Node Pain Network',
      icdCode: 'Q75.9',
      probabilityLow: 45,
      probabilityHigh: 65,
      advocateCase: 'V4 UPDATE: Mayo normal autoimmune panel pushes structural explanation higher. 707 MCP findings reinforce TCC convergence mechanism. Hirslanden MR confirms CVJ anomaly with Dens hochstand 10mm and hypomochlion effect. COMT C-1 expression (56.2 TPM) links molecular to structural. Published case analogues of CVJ-driven trigeminal pain resolution. No alternative diagnosis better explains the pain distribution.',
      skepticCase: 'Still lacks dynamic CVJ MRI. SPECT was negative. Pain onset at 18 despite lifelong anomaly requires explanatory trigger event.',
      arbiterVerdict: 'STRONG (upgraded from v3): Mayo\'s remarkably normal autoimmune panel eliminates H4 as competing explanation, leaving structural H1 as the dominant pain driver.',
      certaintyLevel: 'STRONG',
    },
    {
      name: 'H2: Cervical Myelopathy',
      icdCode: 'G99.2',
      probabilityLow: 30,
      probabilityHigh: 45,
      advocateCase: 'V4: No new imaging data to change this estimate. EMG confirmation of sensory axonal neuropathy remains key evidence. Skanmex 2022 MR reports available but need radiologist review for cord compression assessment.',
      skepticCase: 'Static MRI shows no edema or compression. Skin biopsy excluded SFN. Weakness could be deconditioning.',
      arbiterVerdict: 'MODERATE: unchanged. Dynamic MRI remains the critical differentiating test.',
      certaintyLevel: 'MODERATE',
    },
    {
      name: 'H3: Central Sensitization / Nociplastic Pain',
      icdCode: 'G89.4',
      probabilityLow: 50,
      probabilityHigh: 65,
      advocateCase: 'V4: 110 MCP findings on central sensitization reinforce this mechanism. LDN TRPM3 mechanism (PMID 40458265) provides novel molecular support. 108 treatment-related findings document 42+ treatment failures consistent with nociplastic phenotype.',
      skepticCase: 'Central sensitization requires initiating cause. 707 MCP findings support mechanism but not as standalone diagnosis.',
      arbiterVerdict: 'STRONG: unchanged. H1+H3 combination remains strongest framework.',
      certaintyLevel: 'STRONG',
    },
    {
      name: 'H4: Autoimmune (Sjögren/GPA/Behçet)',
      icdCode: 'M35.0',
      probabilityLow: 5,
      probabilityHigh: 15,
      advocateCase: 'V4: Anti-Ro-60 positive (329.41 U/ml, Aug 2025) remains the sole positive autoantibody. Progressive leukopenia (WBC 4.3 Dec 2024 → 2.59 Aug 2025). VDR TaqI variant + vitamin D deficiency create autoimmune susceptibility.',
      skepticCase: 'V4 MAJOR DOWNGRADE: Mayo Clinic Dec 2024 shows comprehensively normal autoimmune panel: ANA 0.2 (negative), Anti-CCP <15.6 (negative), CRP <3.0 (normal), ESR 2 (normal), RF <15 (negative), IgA/IgG/IgM all normal, tTG IgA <1.2 (negative). This is a tier-1 facility with comprehensive testing. The only positive is isolated Anti-Ro-60 (Aug 2025) — which can be found in up to 3% of healthy population.',
      arbiterVerdict: 'WEAK (downgraded from v3): Mayo\'s normal autoimmune panel is strong contradicting evidence. Isolated Anti-Ro-60 without supporting markers (normal CRP, ESR, ANA, immunoglobulins) makes primary autoimmune disease very unlikely. Monitor for evolution but do not pursue as primary diagnosis.',
      certaintyLevel: 'WEAK',
    },
    {
      name: 'H5: Developmental/Connective Tissue Phenotype',
      icdCode: 'Q79.6',
      probabilityLow: 20,
      probabilityHigh: 30,
      advocateCase: 'V4 UPGRADE: Mayo DHEA-S 552 mcg/dL (high, ref 57-522) + cholesterol abnormalities (Total 247, LDL 170, Non-HDL 192 all high) + testosterone 925 ng/dl (high) create metabolic/endocrine pattern. ACE testicular expression (112.3 TPM) from BioMCP explains testosterone link. Homocysteine pathway enrichment (p=3.29e-6) unifies genetic findings. CBS/MTHFR dual impairment + serum homocysteine never measured.',
      skepticCase: 'No clinical hypermobility phenotype documented. DHEA-S/testosterone elevations could be physiologic. Cholesterol elevations could be dietary.',
      arbiterVerdict: 'WEAK→MODERATE (upgraded): DHEA-S + cholesterol + testosterone + ACE/homocysteine genetic convergence creates a meaningful metabolic phenotype that warrants investigation. Serum homocysteine + genetic testing (WES) would clarify.',
      certaintyLevel: 'MODERATE',
    },
    {
      name: 'H6: Airway-Bruxism-Cervical Feedback Loop',
      icdCode: 'G47.63',
      probabilityLow: 10,
      probabilityHigh: 20,
      advocateCase: 'V4: 45 MCP findings on airway/bruxism support individual components. No new clinical data to change loop mechanism assessment.',
      skepticCase: 'No sleep study. No polysomnography. Loop mechanism remains theoretical.',
      arbiterVerdict: 'MODERATE: unchanged. Contributing factor, not standalone hypothesis.',
      certaintyLevel: 'MODERATE',
    },
  ];

  for (const h of v4Hypotheses) {
    const hypoId = makeId('hypothesis', h.name, 'v4');
    if (!dryRun) {
      // Check if v4 already exists
      const existing = await c.execute({
        sql: `SELECT id FROM research_hypotheses WHERE patient_id = ? AND name = ? AND version = 4`,
        args: [pid, h.name],
      });
      if (existing.rows.length > 0) {
        console.log(`  Skip ${h.name} v4 (already exists)`);
        stats.phase7.hypotheses++;
        continue;
      }

      // Supersede v3
      const v3 = await c.execute({
        sql: `SELECT id FROM research_hypotheses WHERE patient_id = ? AND name = ? AND superseded_by IS NULL ORDER BY version DESC LIMIT 1`,
        args: [pid, h.name],
      });
      if (v3.rows.length > 0) {
        await c.execute({
          sql: `UPDATE research_hypotheses SET superseded_by = ? WHERE id = ?`,
          args: [hypoId, String(v3.rows[0].id)],
        });
      }

      await c.execute({
        sql: `INSERT OR REPLACE INTO research_hypotheses
              (id, patient_id, name, icd_code, probability_low, probability_high,
               advocate_case, skeptic_case, arbiter_verdict,
               evidence_tier, certainty_level, stage, version, superseded_by, date,
               validation_status, source_credibility)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          hypoId, pid, h.name, h.icdCode,
          h.probabilityLow, h.probabilityHigh,
          h.advocateCase, h.skepticCase, h.arbiterVerdict,
          'T3-ai-inferred', h.certaintyLevel,
          5, 4, null, now,
          'unvalidated', 80,
        ],
      });
    }
    stats.phase7.hypotheses++;
    console.log(`  ${dryRun ? 'Would add' : 'Added'} ${h.name} v4 (${h.probabilityLow}-${h.probabilityHigh}%)`);
  }

  console.log(`  Processed ${stats.phase7.hypotheses} v4.0 hypotheses`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n━━━ SUMMARY ━━━');
console.log(`Phase 1: ${stats.phase1.pmids + stats.phase1.pmcids + stats.phase1.genes + stats.phase1.drugs + stats.phase1.diseases + stats.phase1.interactions + stats.phase1.trials} external IDs extracted`);
console.log(`Phase 2: ${stats.phase2.queries} research queries persisted`);
console.log(`Phase 3: ${stats.phase3.findings} citation-verified findings`);
console.log(`Phase 4: ${stats.phase4.findings} BioMCP investigation findings`);
console.log(`Phase 5: ${stats.phase5.hypotheses} v3.0 hypotheses`);
console.log(`Phase 6: ${stats.phase6.links} evidence links`);
console.log(`Phase 7: ${stats.phase7.hypotheses} v4.0 hypotheses`);

// Final verification
if (!dryRun) {
  console.log('\n━━━ VERIFICATION ━━━');
  const fCount = await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM research_findings WHERE patient_id = ?', args: [pid] });
  const fExtId = await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM research_findings WHERE patient_id = ? AND external_id IS NOT NULL', args: [pid] });
  const fEvidence = await c.execute({ sql: 'SELECT evidence_level, COUNT(*) as cnt FROM research_findings WHERE patient_id = ? GROUP BY evidence_level', args: [pid] });
  const qCount = await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM research_queries WHERE patient_id = ?', args: [pid] });
  const hCount = await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM research_hypotheses WHERE patient_id = ?', args: [pid] });
  const hActive = await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM research_hypotheses WHERE patient_id = ? AND superseded_by IS NULL', args: [pid] });
  const lCount = await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM hypothesis_evidence_links WHERE patient_id = ?', args: [pid] });

  console.log(`  Findings: ${fCount.rows[0].cnt} total, ${fExtId.rows[0].cnt} with external_id`);
  console.log(`  Evidence levels:`, fEvidence.rows.map(r => `${r.evidence_level}=${r.cnt}`).join(', '));
  console.log(`  Queries: ${qCount.rows[0].cnt}`);
  console.log(`  Hypotheses: ${hCount.rows[0].cnt} total, ${hActive.rows[0].cnt} active (non-superseded)`);
  console.log(`  Evidence links: ${lCount.rows[0].cnt}`);
}

console.log('\nDone.');
