#!/usr/bin/env node
/**
 * audit-abnormal-labs.mjs — Cross-reference all abnormal lab values across 3 stages:
 *
 *   Stage 1: Source PDF (via Tesseract OCR re-extraction)
 *   Stage 2: Medical-records markdown (YAML lab_values block)
 *   Stage 3: Asklepios database (clinical_lab_results table)
 *
 * Reports per-entry verification status:
 *   GREEN  — all 3 stages agree
 *   YELLOW — DB matches markdown but OCR unclear/partial
 *   RED    — mismatch between any stages
 *
 * Usage:
 *   node scripts/audit-abnormal-labs.mjs              # full audit
 *   node scripts/audit-abnormal-labs.mjs --json       # output JSON report
 *   node scripts/audit-abnormal-labs.mjs --critical   # only critical hypothesis-driving values
 *   node scripts/audit-abnormal-labs.mjs --pdf-verify # run OCR verification on source PDFs
 */

import { createClient } from '@libsql/client';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const RECORDS_DIR = process.env.RECORDS_DIR ?? '/Users/andrzej/Documents/GitHub/medical-records/records';
const SOURCE_DIR = process.env.SOURCE_DIR ?? '/Users/andrzej/Desktop/Dokumentacja_medyczna';
const JSON_OUTPUT = process.argv.includes('--json');
const CRITICAL_ONLY = process.argv.includes('--critical');
const PDF_VERIFY = process.argv.includes('--pdf-verify');

// ═══════════════════════════════════════════════════════════════════════
// Source PDF directory mapping
// ═══════════════════════════════════════════════════════════════════════
const PDF_DIRS = [
  join(SOURCE_DIR, 'Badania lata 2025-2019 pobrane z Diagnostyki'),
  join(SOURCE_DIR, 'Badania krwi, moczu, kału, genetyczne, PMR Diagnostyka'),
  join(SOURCE_DIR, 'Updates Mar 09/Mayo Clinic'),
  join(SOURCE_DIR, 'Updates Mar 09/Najnowsze badania'),
  join(SOURCE_DIR, 'Updates Mar 09/Hirslanden'),
  SOURCE_DIR,
];

// Critical hypothesis-driving values to prioritize
const CRITICAL_VALUES = new Set([
  'WBC', 'Neutrophils (abs)', 'Anti-Ro-60 (SSA)', 'Anti-PR3 (ANCA)',
  'DHEA-S', 'Testosterone', 'Total cholesterol', 'LDL cholesterol',
  'Vitamin D 25-OH', 'Vitamin D', 'Chloride', 'Monocytes %',
  'Lymphocytes (abs)', 'Ferritin', 'Albumin', 'Albumin %',
]);

// ═══════════════════════════════════════════════════════════════════════
// Utility: compare lab values across numeric format differences
// ═══════════════════════════════════════════════════════════════════════
function valuesEqual(a, b) {
  if (a === b) return true;
  const aNorm = String(a).replace(/\*\*/g, '').replace(',', '.').trim();
  const bNorm = String(b).replace(/\*\*/g, '').replace(',', '.').trim();
  if (aNorm === bNorm) return true;
  const aNum = parseFloat(aNorm);
  const bNum = parseFloat(bNorm);
  if (!isNaN(aNum) && !isNaN(bNum) && aNum === bNum) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════
// Utility: parse YAML frontmatter from markdown
// ═══════════════════════════════════════════════════════════════════════
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match?.[1]) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      fm[key] = val;
    }
  }
  return { fm, body: match[2] };
}

// ═══════════════════════════════════════════════════════════════════════
// Utility: parse YAML lab_values array from ## Structured Values block
// ═══════════════════════════════════════════════════════════════════════
function parseLabValuesFromMarkdown(body) {
  // The import pipeline extracts from ```yaml code blocks inside ## Structured Values
  const yamlMatch = body.match(/```yaml\n([\s\S]*?)```/);
  if (!yamlMatch?.[1]) return [];

  // Use simple YAML parsing for the lab_values array
  // Parse the yaml block manually (matching import pipeline behavior)
  const yamlText = yamlMatch[1];
  const labValues = [];
  
  // Split into entries by "  - " prefix (YAML array items)
  const entryTexts = yamlText.split(/\n  - /).slice(1); // skip "lab_values:" header
  
  for (const entryText of entryTexts) {
    const obj = {};
    const lines = ('- ' + entryText).split('\n');
    for (const line of lines) {
      const trimmed = line.replace(/^    /, '').replace(/^  - /, '').trim();
      if (!trimmed || trimmed === '-') continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx > 0) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        obj[key] = val;
      }
    }
    if (obj.test_name || obj.value) labValues.push(obj);
  }
  return labValues;
}

// ═══════════════════════════════════════════════════════════════════════
// Utility: find source PDF in known directories
// ═══════════════════════════════════════════════════════════════════════
function findSourcePdf(sourceFile) {
  if (!sourceFile) return null;
  for (const dir of PDF_DIRS) {
    const fullPath = join(dir, sourceFile);
    if (existsSync(fullPath)) return fullPath;
  }
  // Try recursive search in source dir
  try {
    const result = execSync(
      `find "${SOURCE_DIR}" -name "${sourceFile.replace(/"/g, '')}" -type f 2>/dev/null | head -1`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    return result || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Utility: OCR a PDF page using PyMuPDF + Tesseract
// ═══════════════════════════════════════════════════════════════════════
function ocrPdfPage(pdfPath, pageNum = 0) {
  try {
    const script = `
import fitz, subprocess, os, sys
doc = fitz.open("${pdfPath.replace(/"/g, '\\"')}")
if ${pageNum} >= doc.page_count:
    print("")
    sys.exit(0)
page = doc[${pageNum}]
pix = page.get_pixmap(dpi=300)
cwd = os.getcwd()
img_path = os.path.join(cwd, '_ocr_temp.png')
pix.save(img_path)
doc.close()
result = subprocess.run(['tesseract', img_path, os.path.join(cwd, '_ocr_temp_out'), '-l', 'pol+eng'],
                       capture_output=True, cwd=cwd)
out_path = os.path.join(cwd, '_ocr_temp_out.txt')
if os.path.exists(out_path):
    with open(out_path, 'r') as f:
        print(f.read())
os.remove(img_path)
if os.path.exists(out_path):
    os.remove(out_path)
`;
    const result = execSync(`python3 -c '${script.replace(/'/g, "'\"'\"'")}'`, {
      encoding: 'utf-8',
      timeout: 30000,
      cwd: process.cwd(),
    });
    return result;
  } catch (err) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Utility: search OCR text for a lab value
// ═══════════════════════════════════════════════════════════════════════
function searchOcrForValue(ocrText, testName, value, testNamePl) {
  if (!ocrText) return { found: false, confidence: 0, detail: 'OCR failed' };
  
  const normalizedOcr = ocrText.toLowerCase().replace(/\s+/g, ' ');
  const normalizedValue = String(value).toLowerCase().replace(',', '.').trim();
  
  // Try to find the numeric value in OCR text
  // Handle European format: 3,37 vs 3.37
  const valueVariants = [normalizedValue];
  if (normalizedValue.includes('.')) {
    valueVariants.push(normalizedValue.replace('.', ','));
  }
  if (normalizedValue.includes(',')) {
    valueVariants.push(normalizedValue.replace(',', '.'));
  }

  // Search for test name (Polish or English) near the value
  const testTerms = [testName.toLowerCase()];
  if (testNamePl) testTerms.push(testNamePl.toLowerCase());
  
  // Also add common Polish abbreviated forms
  const plAbbreviations = {
    'wbc': ['leukocyty', 'białe krwinki'],
    'neutrophils (abs)': ['neutrofile', 'neutrofile (abs'],
    'lymphocytes (abs)': ['limfocyty', 'limfocyty (abs'],
    'monocytes %': ['monocyty'],
    'rbc': ['erytrocyty', 'czerwone krwinki'],
    'hemoglobin': ['hemoglobina'],
    'hematocrit': ['hematokryt'],
    'platelets': ['trombocyty', 'płytki'],
    'albumin %': ['albuminy', 'albumina'],
    'total cholesterol': ['cholesterol całkowity', 'cholesterol'],
    'ldl cholesterol': ['ldl-cholesterol', 'ldl'],
    'hdl cholesterol': ['hdl-cholesterol', 'hdl'],
    'triglycerides': ['trójglicerydy', 'triglicerydy'],
    'vitamin d': ['witamina d', '25-oh'],
    'testosterone': ['testosteron'],
    'ferritin': ['ferrytyna'],
    'crp': ['białko c-reaktywne', 'c-reaktywne'],
    'anti-ro-60 (ssa)': ['anti-ro-60', 'ro-60', 'ssa'],
    'anti-pr3 (anca)': ['anti-pr3', 'pr3-anca', 'canca', 'c-anca'],
    'dhea-s': ['dhea-s', 'dhea', 'siarczan dehydroepiandrosteronu'],
    'chloride': ['chlorki'],
    'pdw': ['pdw'],
    'p-lcr': ['p-lcr'],
    'eosinophils (abs)': ['eozynofile', 'eozynof'],
    'basophils (abs)': ['bazofile', 'bazof'],
    'alpha-2 globulins %': ['alfa-2-globuliny', 'alfa-2'],
  };
  
  const key = testName.toLowerCase();
  if (plAbbreviations[key]) testTerms.push(...plAbbreviations[key]);

  let nameFound = false;
  let valueFound = false;
  let detail = '';

  // Check for test name presence
  for (const term of testTerms) {
    if (normalizedOcr.includes(term)) {
      nameFound = true;
      detail += `Name found: "${term}". `;
      break;
    }
  }

  // Check for value presence
  for (const variant of valueVariants) {
    if (normalizedOcr.includes(variant)) {
      valueFound = true;
      detail += `Value found: "${variant}". `;
      break;
    }
  }

  if (nameFound && valueFound) {
    return { found: true, confidence: 1.0, detail: detail.trim() };
  } else if (valueFound) {
    return { found: true, confidence: 0.7, detail: detail + 'Name not found in OCR text.' };
  } else if (nameFound) {
    return { found: false, confidence: 0.3, detail: detail + 'Value not found in OCR text.' };
  }
  return { found: false, confidence: 0, detail: 'Neither name nor value found in OCR text.' };
}

// ═══════════════════════════════════════════════════════════════════════
// Main audit
// ═══════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Abnormal Lab Values Audit — 3-Stage Cross-Reference   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // 1. Query all abnormal lab entries from database
  const abnormalRows = (await c.execute(
    `SELECT id, test_name, value, unit, reference_range, flag, date, source, notes 
     FROM clinical_lab_results 
     WHERE flag NOT IN ('normal', '') AND flag IS NOT NULL 
     ORDER BY date, test_name`
  )).rows;

  console.log(`Total abnormal entries: ${abnormalRows.length}`);
  if (CRITICAL_ONLY) {
    console.log(`(Filtering to critical hypothesis-driving values only)`);
  }
  console.log('');

  // 2. Build document ID → markdown file mapping
  const labDirs = [
    join(RECORDS_DIR, 'labs', 'diagnostyka'),
    join(RECORDS_DIR, 'labs', 'mayo_clinic'),
  ];
  
  const mdFiles = new Map(); // document_id → { path, fm, body }
  for (const dir of labDirs) {
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const fullPath = join(dir, file);
        const content = await readFile(fullPath, 'utf-8');
        const parsed = parseFrontmatter(content);
        if (parsed?.fm?.document_id) {
          mdFiles.set(parsed.fm.document_id, { 
            path: fullPath, 
            fm: parsed.fm, 
            body: parsed.body,
            filename: file,
          });
        }
      }
    } catch { /* dir not found */ }
  }
  console.log(`Loaded ${mdFiles.size} markdown files for cross-reference\n`);

  // 3. Cache: OCR results per source PDF (avoid re-OCRing the same PDF)
  const ocrCache = new Map();

  // 4. Audit each abnormal entry
  const results = [];
  let greenCount = 0, yellowCount = 0, redCount = 0;

  for (const row of abnormalRows) {
    // Filter if --critical
    if (CRITICAL_ONLY && !CRITICAL_VALUES.has(row.test_name)) continue;

    // Extract document_id from entry ID: import-lab-{document_id}-{index}
    const idStr = String(row.id);
    const prefix = 'import-lab-';
    const rest = idStr.startsWith(prefix) ? idStr.slice(prefix.length) : idStr;
    const lastDash = rest.lastIndexOf('-');
    const documentId = rest.slice(0, lastDash);
    const entryIndex = parseInt(rest.slice(lastDash + 1), 10);

    // ─── Stage 2: Cross-reference with markdown ───
    const mdFile = mdFiles.get(documentId);
    let mdMatch = null;
    let mdTestNamePl = null;
    
    if (mdFile) {
      const labValues = parseLabValuesFromMarkdown(mdFile.body);
      const dbValue = String(row.value);
      
      // Strategy: try index first, then fall back to value-based search.
      // Index may be off when normalizer/schema filters some entries during import.
      let mdEntry = labValues[entryIndex];
      
      // If index-based match doesn't have matching value, search by value + flag
      if (!mdEntry || !valuesEqual(dbValue, String(mdEntry.value ?? ''))) {
        mdEntry = labValues.find(lv => {
          const lvVal = String(lv.value ?? '').replace(/\*\*/g, '');
          const lvFlag = lv.flag || '';
          const flagOk = lvFlag === row.flag || 
            (lvFlag === 'L' && row.flag === 'low') ||
            (lvFlag === 'H' && row.flag === 'high') ||
            (lvFlag === 'low' && row.flag === 'low') ||
            (lvFlag === 'high' && row.flag === 'high');
          return valuesEqual(dbValue, lvVal) && flagOk;
        }) || null;
      }
      
      if (mdEntry) {
        const mdValue = String(mdEntry.value ?? '').replace(/\*\*/g, '');
        mdTestNamePl = mdEntry.test_name_pl || null;
        
        const valuesMatch = valuesEqual(dbValue, mdValue);
        
        const flagsMatch = !mdEntry.flag || mdEntry.flag === row.flag || 
          (mdEntry.flag === 'L' && row.flag === 'low') || 
          (mdEntry.flag === 'H' && row.flag === 'high');

        mdMatch = {
          found: true,
          valuesMatch,
          flagsMatch,
          mdTestName: mdEntry.test_name || '',
          mdTestNamePl: mdEntry.test_name_pl || '',
          mdValue,
          mdUnit: mdEntry.unit || '',
          mdFlag: mdEntry.flag || '',
          mdRefRange: mdEntry.reference_range || '',
        };
      } else {
        mdMatch = { found: false, detail: `Value ${dbValue} not found in YAML (${labValues.length} entries parsed)` };
      }
    } else {
      mdMatch = { found: false, detail: `Markdown file not found for document_id: ${documentId}` };
    }

    // ─── Stage 1: OCR verification of source PDF ───
    let pdfVerification = { status: 'skipped', detail: 'Use --pdf-verify to enable' };
    
    if (PDF_VERIFY && mdFile?.fm?.source_file) {
      const sourceFile = mdFile.fm.source_file;
      const pdfPath = findSourcePdf(sourceFile);
      
      if (pdfPath) {
        // Use cache to avoid re-OCRing same PDF
        if (!ocrCache.has(pdfPath)) {
          console.log(`  OCR: ${basename(pdfPath)}...`);
          const allPagesText = [];
          // OCR first 3 pages (most lab PDFs are 1-3 pages)
          for (let p = 0; p < 3; p++) {
            const pageText = ocrPdfPage(pdfPath, p);
            if (pageText) allPagesText.push(pageText);
          }
          ocrCache.set(pdfPath, allPagesText.join('\n'));
        }
        
        const ocrText = ocrCache.get(pdfPath);
        const ocrResult = searchOcrForValue(ocrText, row.test_name, row.value, mdTestNamePl);
        pdfVerification = {
          status: ocrResult.found ? 'verified' : 'unverified',
          confidence: ocrResult.confidence,
          detail: ocrResult.detail,
          pdfPath: basename(pdfPath),
        };
      } else {
        pdfVerification = { status: 'pdf_not_found', detail: `Source PDF not found: ${sourceFile}` };
      }
    }

    // ─── Classification ───
    let classification = 'RED';
    let reason = '';
    
    if (mdMatch.found && mdMatch.valuesMatch && mdMatch.flagsMatch) {
      if (PDF_VERIFY) {
        if (pdfVerification.status === 'verified') {
          classification = 'GREEN';
          reason = 'All 3 stages match (DB = markdown = PDF OCR)';
        } else if (pdfVerification.status === 'pdf_not_found') {
          classification = 'YELLOW';
          reason = `DB matches markdown, but source PDF not found: ${pdfVerification.detail}`;
        } else if (pdfVerification.status === 'unverified') {
          classification = 'YELLOW';
          reason = `DB matches markdown, but OCR could not confirm: ${pdfVerification.detail}`;
        } else {
          classification = 'YELLOW';
          reason = 'DB matches markdown (PDF verification skipped)';
        }
      } else {
        classification = 'GREEN';
        reason = 'DB matches markdown (PDF verification not run)';
      }
    } else if (!mdMatch.found) {
      classification = 'RED';
      reason = `Markdown cross-reference failed: ${mdMatch.detail}`;
    } else if (!mdMatch.valuesMatch) {
      classification = 'RED';
      reason = `Value mismatch: DB="${row.value}" vs Markdown="${mdMatch.mdValue}"`;
    } else if (!mdMatch.flagsMatch) {
      classification = 'YELLOW';
      reason = `Flag mismatch: DB="${row.flag}" vs Markdown="${mdMatch.mdFlag}" (values match)`;
    }

    const entry = {
      id: row.id,
      testName: row.test_name,
      value: row.value,
      unit: row.unit,
      referenceRange: row.reference_range,
      flag: row.flag,
      date: row.date,
      source: row.source,
      documentId,
      classification,
      reason,
      isCritical: CRITICAL_VALUES.has(row.test_name),
      markdown: mdMatch,
      pdfVerification,
    };

    results.push(entry);

    if (classification === 'GREEN') greenCount++;
    else if (classification === 'YELLOW') yellowCount++;
    else redCount++;

    // Console output
    const icon = classification === 'GREEN' ? '🟢' : classification === 'YELLOW' ? '🟡' : '🔴';
    const crit = entry.isCritical ? ' ⚡' : '';
    if (!JSON_OUTPUT) {
      console.log(`  ${icon} ${row.test_name} = ${row.value} ${row.unit} [${row.flag}] on ${row.date}${crit}`);
      if (classification !== 'GREEN' || process.argv.includes('--verbose')) {
        console.log(`     ${reason}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════════
  const total = results.length;
  
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    AUDIT SUMMARY                        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Total audited:  ${total}`);
  console.log(`  🟢 GREEN:       ${greenCount} (${(greenCount/total*100).toFixed(1)}%) — verified correct`);
  console.log(`  🟡 YELLOW:      ${yellowCount} (${(yellowCount/total*100).toFixed(1)}%) — needs review`);
  console.log(`  🔴 RED:         ${redCount} (${(redCount/total*100).toFixed(1)}%) — mismatch found`);
  
  // Critical values summary
  const criticalResults = results.filter(r => r.isCritical);
  if (criticalResults.length > 0) {
    console.log('\n  ─── Critical Hypothesis-Driving Values ───');
    console.log(`  Total critical: ${criticalResults.length}`);
    console.log(`  🟢 GREEN:       ${criticalResults.filter(r => r.classification === 'GREEN').length}`);
    console.log(`  🟡 YELLOW:      ${criticalResults.filter(r => r.classification === 'YELLOW').length}`);
    console.log(`  🔴 RED:         ${criticalResults.filter(r => r.classification === 'RED').length}`);
  }

  // RED entries detail
  const redEntries = results.filter(r => r.classification === 'RED');
  if (redEntries.length > 0) {
    console.log('\n  ─── RED Entries (require investigation) ───');
    for (const r of redEntries) {
      console.log(`  🔴 ${r.testName} = ${r.value} on ${r.date} [${r.source}]`);
      console.log(`     ${r.reason}`);
    }
  }

  // YELLOW entries detail
  const yellowEntries = results.filter(r => r.classification === 'YELLOW');
  if (yellowEntries.length > 0) {
    console.log('\n  ─── YELLOW Entries (needs manual review) ───');
    for (const r of yellowEntries) {
      console.log(`  🟡 ${r.testName} = ${r.value} on ${r.date} [${r.source}]`);
      console.log(`     ${r.reason}`);
    }
  }

  // JSON report
  if (JSON_OUTPUT) {
    const report = {
      timestamp: new Date().toISOString(),
      totalAudited: total,
      summary: { green: greenCount, yellow: yellowCount, red: redCount },
      criticalSummary: {
        total: criticalResults.length,
        green: criticalResults.filter(r => r.classification === 'GREEN').length,
        yellow: criticalResults.filter(r => r.classification === 'YELLOW').length,
        red: criticalResults.filter(r => r.classification === 'RED').length,
      },
      entries: results,
    };
    const reportPath = 'audit-report.json';
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n  JSON report written to: ${reportPath}`);
  }

  console.log('');
  process.exit(redCount > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
