/**
 * Deduplicate and fix research_findings data quality issues.
 * 
 * Issues addressed:
 * 1. Biothings non-human orthologs (rat, mouse, etc.) — keep human only
 * 2. Same article appearing multiple times (same title+source)
 * 3. "[object Object]" titles from gget serialization bug
 * 4. "Result" generic titles — extract real titles from raw_data/summary JSON
 * 5. Cross-source article duplicates (same article from biomcp + biocontext)
 */
import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const DRY = process.argv.includes('--dry-run');

let deleted = 0, fixed = 0, linksDeleted = 0;

async function deleteFinding(id) {
  if (DRY) { deleted++; return; }
  const links = (await c.execute({ sql: 'SELECT COUNT(*) as cnt FROM hypothesis_evidence_links WHERE finding_id = ?', args: [id] })).rows[0];
  if (links.cnt > 0) {
    await c.execute({ sql: 'DELETE FROM hypothesis_evidence_links WHERE finding_id = ?', args: [id] });
    linksDeleted += Number(links.cnt);
  }
  await c.execute({ sql: 'DELETE FROM research_findings WHERE id = ?', args: [id] });
  deleted++;
}

// ── 1. Biothings non-human orthologs ──
console.log('Phase 1: Cleaning biothings non-human orthologs...');
const btDupTitles = (await c.execute(`
  SELECT title, COUNT(*) as cnt
  FROM research_findings
  WHERE source = 'biothings'
  GROUP BY title
  HAVING cnt > 1
  ORDER BY cnt DESC
`)).rows;

for (const { title } of btDupTitles) {
  const entries = (await c.execute({
    sql: 'SELECT id, external_id, summary FROM research_findings WHERE title = ? AND source = ? ORDER BY id',
    args: [title, 'biothings']
  })).rows;
  
  if (entries.length <= 1) continue;
  
  // Keep the first entry (human), delete the rest (orthologs)
  const toDelete = entries.slice(1);
  for (const entry of toDelete) {
    await deleteFinding(entry.id);
  }
  console.log(`  ${title}: kept 1, ${DRY ? 'would delete' : 'deleted'} ${toDelete.length}`);
}

// ── 2. Same-title same-source duplicates (non-biothings) ──
console.log('\nPhase 2: Cleaning same-title same-source article duplicates...');
const artDups = (await c.execute(`
  SELECT title, source, COUNT(*) as cnt
  FROM research_findings
  WHERE source != 'biothings'
  AND title != 'Result'
  AND title != '[object Object]'
  AND external_id_type IS NULL OR external_id_type = 'pmid' OR external_id_type = 'pmcid'
  GROUP BY title, source
  HAVING cnt > 1
  ORDER BY cnt DESC
`)).rows;

for (const { title, source } of artDups) {
  const entries = (await c.execute({
    sql: 'SELECT id FROM research_findings WHERE title = ? AND source = ? ORDER BY id',
    args: [title, source]
  })).rows;
  
  if (entries.length <= 1) continue;
  
  const toDelete = entries.slice(1);
  for (const entry of toDelete) {
    await deleteFinding(entry.id);
  }
  console.log(`  ${source}: "${title.substring(0, 60)}..." — ${DRY ? 'would delete' : 'deleted'} ${toDelete.length}`);
}

// ── 3. Cross-source PMID duplicates (same article from biomcp + biocontext) ──
console.log('\nPhase 3: Cleaning cross-source PMID duplicates...');
const crossPmidDups = (await c.execute(`
  SELECT external_id, COUNT(*) as cnt, GROUP_CONCAT(source, '|') as sources
  FROM research_findings
  WHERE external_id_type = 'pmid' AND external_id IS NOT NULL
  GROUP BY external_id
  HAVING cnt > 1
  ORDER BY cnt DESC
`)).rows;

for (const { external_id, sources } of crossPmidDups) {
  const entries = (await c.execute({
    sql: "SELECT id, source FROM research_findings WHERE external_id = ? AND external_id_type = 'pmid' ORDER BY source, id",
    args: [external_id]
  })).rows;
  
  if (entries.length <= 1) continue;
  
  // Keep the first, delete duplicates
  const toDelete = entries.slice(1);
  for (const entry of toDelete) {
    await deleteFinding(entry.id);
  }
  console.log(`  PMID ${external_id}: kept ${entries[0].source}, ${DRY ? 'would delete' : 'deleted'} ${toDelete.length} from ${sources}`);
}

// ── 4. Fix [object Object] titles ──
console.log('\nPhase 4: Fixing [object Object] titles...');
const objEntries = (await c.execute(
  "SELECT id, external_id, raw_data FROM research_findings WHERE title = '[object Object]'"
)).rows;

for (const entry of objEntries) {
  let newTitle = entry.external_id || 'gget result';
  try {
    const raw = JSON.parse(entry.raw_data);
    if (raw.name) newTitle = String(raw.name);
    else if (raw.id) newTitle = String(raw.id);
  } catch {
    // raw_data is also [object Object] — use external_id as title
    if (entry.external_id) newTitle = entry.external_id;
  }
  
  if (!DRY) {
    await c.execute({ sql: 'UPDATE research_findings SET title = ? WHERE id = ?', args: [newTitle, entry.id] });
  }
  fixed++;
  console.log(`  ${entry.id}: → "${newTitle}"`);
}

// ── 5. Fix generic "Result" titles ──
console.log('\nPhase 5: Fixing generic "Result" titles...');
const resultEntries = (await c.execute(
  "SELECT id, source, source_tool, external_id, external_id_type, raw_data, summary FROM research_findings WHERE title = 'Result'"
)).rows;

for (const entry of resultEntries) {
  let newTitle = null;
  
  // Try raw_data first
  try {
    const raw = JSON.parse(entry.raw_data);
    if (raw.brand_name) newTitle = raw.brand_name + (raw.generic_name ? ' (' + raw.generic_name + ')' : '');
    else if (raw.name) newTitle = String(raw.name);
    else if (raw.protocolSection?.identificationModule?.briefTitle)
      newTitle = raw.protocolSection.identificationModule.briefTitle;
    else if (raw.nctId) newTitle = 'Trial ' + raw.nctId;
  } catch {}
  
  // Try summary
  if (!newTitle) {
    try {
      const summ = JSON.parse(entry.summary);
      if (summ.brand_name) newTitle = summ.brand_name + (summ.generic_name ? ' (' + summ.generic_name + ')' : '');
      else if (summ.efo_ids?.[0]?.label?.[0]) newTitle = summ.efo_ids[0].label[0];
      else if (summ.protocolSection?.identificationModule?.briefTitle)
        newTitle = summ.protocolSection.identificationModule.briefTitle;
      else if (summ.name) newTitle = String(summ.name);
    } catch {}
  }
  
  // Fallback: use external_id
  if (!newTitle && entry.external_id) {
    newTitle = entry.external_id_type + ': ' + entry.external_id;
  }
  
  if (newTitle) {
    if (!DRY) {
      await c.execute({ sql: 'UPDATE research_findings SET title = ? WHERE id = ?', args: [newTitle, entry.id] });
    }
    fixed++;
  }
}
console.log(`  Fixed ${fixed} Result titles`);

// ── Summary ──
const total = (await c.execute('SELECT COUNT(*) as cnt FROM research_findings')).rows[0];
const resultCount = (await c.execute("SELECT COUNT(*) as cnt FROM research_findings WHERE title = 'Result'")).rows[0];
const objCount = (await c.execute("SELECT COUNT(*) as cnt FROM research_findings WHERE title = '[object Object]'")).rows[0];
const dupTitles = (await c.execute(`
  SELECT COUNT(*) as cnt FROM (
    SELECT title, source, COUNT(*) as c FROM research_findings GROUP BY title, source HAVING c > 1
  )
`)).rows[0];

console.log(`\n=== ${DRY ? 'DRY RUN ' : ''}SUMMARY ===`);
console.log(`${DRY ? 'Would delete' : 'Deleted'}:`, deleted, 'duplicate rows');
console.log(`${DRY ? 'Would delete' : 'Deleted'}:`, linksDeleted, 'orphaned evidence links');
console.log(`${DRY ? 'Would fix' : 'Fixed'}:`, fixed, 'titles');
console.log('Total findings now:', total.cnt);
console.log('Remaining "Result" titles:', resultCount.cnt);
console.log('Remaining "[object Object]" titles:', objCount.cnt);
console.log('Remaining same-title same-source groups:', dupTitles.cnt);

c.close();
