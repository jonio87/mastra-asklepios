import { createClient } from '@libsql/client';

const c = createClient({ url: process.env.ASKLEPIOS_DB_URL ?? 'file:asklepios.db' });
const pid = 'tomasz-szychliński';

// Q1: WBC unit distribution
const q1 = await c.execute({ sql: "SELECT unit, COUNT(*) as cnt FROM clinical_lab_results WHERE patient_id = ? AND test_name = 'WBC' GROUP BY unit", args: [pid] });
console.log('=== WBC UNITS ===');
q1.rows.forEach(r => console.log(' ', r.unit, '→', r.cnt));

// Q2: Empty values
const q2 = await c.execute({ sql: "SELECT test_name, value, unit, date FROM clinical_lab_results WHERE patient_id = ? AND (value = '' OR value IS NULL) LIMIT 20", args: [pid] });
console.log('\n=== EMPTY VALUES ===', q2.rows.length, 'found');
q2.rows.forEach(r => console.log(' ', r.date, r.test_name, JSON.stringify(r.value), r.unit));

// Q3: Values with spaces
const q3 = await c.execute({ sql: "SELECT test_name, value, unit, date FROM clinical_lab_results WHERE patient_id = ? AND value LIKE '% %' LIMIT 30", args: [pid] });
console.log('\n=== SPACE-IN-VALUE ===', q3.rows.length, 'found');
q3.rows.forEach(r => console.log(' ', r.date, r.test_name, JSON.stringify(r.value), r.unit));

// Q4: All WBC-like test names + units
const q4 = await c.execute({ sql: "SELECT test_name, unit, COUNT(*) as cnt FROM clinical_lab_results WHERE patient_id = ? AND (test_name LIKE '%WBC%' OR test_name LIKE '%Leuk%' OR test_name LIKE '%leuk%') GROUP BY test_name, unit", args: [pid] });
console.log('\n=== WBC-RELATED ===');
q4.rows.forEach(r => console.log(' ', r.test_name, r.unit, '→', r.cnt));

// Q5: Missing evidence provenance
const q5 = await c.execute({ sql: "SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE patient_id = ? AND (evidence_tier IS NULL OR evidence_tier = '' OR validation_status IS NULL OR validation_status = '')", args: [pid] });
console.log('\n=== MISSING PROVENANCE ===', q5.rows[0]?.cnt);

// Q6: Numeric test names (extraction artifacts)
const q6 = await c.execute({ sql: "SELECT test_name, value, unit, date FROM clinical_lab_results WHERE patient_id = ? AND test_name GLOB '[0-9]*' LIMIT 20", args: [pid] });
console.log('\n=== NUMERIC TEST NAMES ===', q6.rows.length, 'found');
q6.rows.forEach(r => console.log(' ', r.date, JSON.stringify(r.test_name), '→', JSON.stringify(r.value), r.unit));

// Q7: Duplicate values (same test + date + value)
const q7 = await c.execute({ sql: "SELECT test_name, date, value, unit, COUNT(*) as cnt FROM clinical_lab_results WHERE patient_id = ? GROUP BY test_name, date, value, unit HAVING cnt > 1 LIMIT 20", args: [pid] });
console.log('\n=== DUPLICATES ===', q7.rows.length, 'found');
q7.rows.forEach(r => console.log(' ', r.date, r.test_name, r.value, r.unit, '×', r.cnt));

// Q8: Total count
const q8 = await c.execute({ sql: "SELECT COUNT(*) as cnt FROM clinical_lab_results WHERE patient_id = ?", args: [pid] });
console.log('\n=== TOTAL RECORDS ===', q8.rows[0]?.cnt);

c.close();
