import type { Client } from '@libsql/client';
import { createClient } from '@libsql/client';
import type {
  AgentLearning,
  Consultation,
  Contradiction,
  LabResult,
  LabTrend,
  PatientReport,
  TreatmentTrial,
} from '../schemas/clinical-record.js';
import { logger } from '../utils/logger.js';

/**
 * ClinicalStore — Layer 2 structured clinical data storage.
 *
 * Wraps LibSQL for direct SQL queries on clinical records (labs, meds,
 * consultations, contradictions, PROs, agent learnings). Provides:
 *
 * - CRUD operations per record type
 * - Filtered queries (by patient, date range, category)
 * - Lab trend computation (slope, direction, rate of change)
 *
 * Uses the same SQLite database as Mastra storage (co-located).
 */
export class ClinicalStore {
  private client: Client;
  private initialized = false;

  constructor(dbUrl?: string) {
    this.client = createClient({
      url: dbUrl ?? process.env['ASKLEPIOS_DB_URL'] ?? 'file:asklepios.db',
    });
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.migrate();
    this.initialized = true;
  }

  private async migrate(): Promise<void> {
    const statements = [
      `CREATE TABLE IF NOT EXISTS clinical_lab_results (
				id TEXT PRIMARY KEY,
				patient_id TEXT NOT NULL,
				test_name TEXT NOT NULL,
				value TEXT NOT NULL,
				unit TEXT NOT NULL,
				reference_range TEXT,
				flag TEXT,
				date TEXT NOT NULL,
				source TEXT,
				notes TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
      `CREATE INDEX IF NOT EXISTS idx_labs_patient_date ON clinical_lab_results(patient_id, date)`,
      `CREATE INDEX IF NOT EXISTS idx_labs_patient_test ON clinical_lab_results(patient_id, test_name)`,

      `CREATE TABLE IF NOT EXISTS clinical_treatment_trials (
				id TEXT PRIMARY KEY,
				patient_id TEXT NOT NULL,
				medication TEXT NOT NULL,
				drug_class TEXT,
				indication TEXT,
				start_date TEXT,
				end_date TEXT,
				dosage TEXT,
				efficacy TEXT NOT NULL,
				side_effects TEXT,
				reason_discontinued TEXT,
				adequate_trial INTEGER,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
      `CREATE INDEX IF NOT EXISTS idx_treatments_patient ON clinical_treatment_trials(patient_id)`,

      `CREATE TABLE IF NOT EXISTS clinical_consultations (
				id TEXT PRIMARY KEY,
				patient_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				specialty TEXT NOT NULL,
				institution TEXT,
				date TEXT NOT NULL,
				reason TEXT,
				findings TEXT,
				conclusions TEXT,
				conclusions_status TEXT NOT NULL,
				recommendations TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
      `CREATE INDEX IF NOT EXISTS idx_consultations_patient ON clinical_consultations(patient_id)`,

      `CREATE TABLE IF NOT EXISTS clinical_contradictions (
				id TEXT PRIMARY KEY,
				patient_id TEXT NOT NULL,
				finding1 TEXT NOT NULL,
				finding1_date TEXT,
				finding1_method TEXT,
				finding2 TEXT NOT NULL,
				finding2_date TEXT,
				finding2_method TEXT,
				resolution_status TEXT NOT NULL,
				resolution_plan TEXT,
				diagnostic_impact TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
      `CREATE INDEX IF NOT EXISTS idx_contradictions_patient ON clinical_contradictions(patient_id)`,

      `CREATE TABLE IF NOT EXISTS clinical_patient_reports (
				id TEXT PRIMARY KEY,
				patient_id TEXT NOT NULL,
				date TEXT NOT NULL,
				type TEXT NOT NULL,
				content TEXT NOT NULL,
				severity INTEGER,
				extracted_insights TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
      `CREATE INDEX IF NOT EXISTS idx_reports_patient_type ON clinical_patient_reports(patient_id, type)`,

      `CREATE TABLE IF NOT EXISTS clinical_agent_learnings (
				id TEXT PRIMARY KEY,
				patient_id TEXT NOT NULL,
				date TEXT NOT NULL,
				category TEXT NOT NULL,
				content TEXT NOT NULL,
				confidence INTEGER,
				related_hypotheses TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			)`,
      `CREATE INDEX IF NOT EXISTS idx_learnings_patient_cat ON clinical_agent_learnings(patient_id, category)`,
    ];

    for (const sql of statements) {
      await this.client.execute(sql);
    }
    logger.debug('ClinicalStore migration complete');
  }

  // ─── Lab Results ──────────────────────────────────────────────────────

  async addLabResult(lab: LabResult): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_lab_results
				(id, patient_id, test_name, value, unit, reference_range, flag, date, source, notes)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        lab.id,
        lab.patientId,
        lab.testName,
        String(lab.value),
        lab.unit,
        lab.referenceRange ?? null,
        lab.flag ?? null,
        lab.date,
        lab.source ?? null,
        lab.notes ?? null,
      ],
    });
  }

  async queryLabs(params: {
    patientId: string;
    testName?: string;
    dateFrom?: string;
    dateTo?: string;
    flag?: string;
  }): Promise<LabResult[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.testName) {
      conditions.push('test_name = ?');
      args.push(params.testName);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }
    if (params.flag) {
      conditions.push('flag = ?');
      args.push(params.flag);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_lab_results WHERE ${conditions.join(' AND ')} ORDER BY date ASC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      testName: String(row['test_name']),
      value: Number.isNaN(Number(row['value'])) ? String(row['value']) : Number(row['value']),
      unit: String(row['unit']),
      referenceRange: row['reference_range'] ? String(row['reference_range']) : undefined,
      flag: row['flag'] as LabResult['flag'],
      date: String(row['date']),
      source: row['source'] ? String(row['source']) : undefined,
      notes: row['notes'] ? String(row['notes']) : undefined,
    }));
  }

  async getLabTrends(params: {
    patientId: string;
    testName: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<LabTrend | null> {
    const query: { patientId: string; testName: string; dateFrom?: string; dateTo?: string } = {
      patientId: params.patientId,
      testName: params.testName,
    };
    if (params.dateFrom) query.dateFrom = params.dateFrom;
    if (params.dateTo) query.dateTo = params.dateTo;
    const labs = await this.queryLabs(query);

    const numericLabs = labs.filter((l) => typeof l.value === 'number') as Array<
      LabResult & { value: number }
    >;
    if (numericLabs.length < 2) return null;

    const values = numericLabs.map((l) => ({
      date: l.date,
      value: l.value,
      flag: l.flag,
    }));

    const latest = numericLabs[numericLabs.length - 1];
    if (!latest) return null;

    const direction = computeTrendDirection(numericLabs.map((l) => l.value));
    const rateOfChange = computeRateOfChange(numericLabs);
    const isAbnormal = latest.flag !== undefined && latest.flag !== 'normal';

    return {
      testName: params.testName,
      values,
      direction,
      rateOfChange: rateOfChange ?? undefined,
      latestValue: latest.value,
      latestDate: latest.date,
      isAbnormal,
      clinicalNote: generateClinicalNote(direction, rateOfChange, isAbnormal, params.testName),
    };
  }

  // ─── Treatment Trials ─────────────────────────────────────────────────

  async addTreatmentTrial(trial: TreatmentTrial): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_treatment_trials
				(id, patient_id, medication, drug_class, indication, start_date, end_date,
				 dosage, efficacy, side_effects, reason_discontinued, adequate_trial)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        trial.id,
        trial.patientId,
        trial.medication,
        trial.drugClass ?? null,
        trial.indication ?? null,
        trial.startDate ?? null,
        trial.endDate ?? null,
        trial.dosage ?? null,
        trial.efficacy,
        trial.sideEffects ? JSON.stringify(trial.sideEffects) : null,
        trial.reasonDiscontinued ?? null,
        trial.adequateTrial === undefined ? null : trial.adequateTrial ? 1 : 0,
      ],
    });
  }

  async queryTreatments(params: {
    patientId: string;
    drugClass?: string;
    efficacy?: string;
  }): Promise<TreatmentTrial[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.drugClass) {
      conditions.push('drug_class = ?');
      args.push(params.drugClass);
    }
    if (params.efficacy) {
      conditions.push('efficacy = ?');
      args.push(params.efficacy);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_treatment_trials WHERE ${conditions.join(' AND ')} ORDER BY start_date ASC`,
      args,
    });

    return result.rows.map(mapRowToTreatmentTrial);
  }

  // ─── Consultations ────────────────────────────────────────────────────

  async addConsultation(consultation: Consultation): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_consultations
				(id, patient_id, provider, specialty, institution, date, reason, findings,
				 conclusions, conclusions_status, recommendations)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        consultation.id,
        consultation.patientId,
        consultation.provider,
        consultation.specialty,
        consultation.institution ?? null,
        consultation.date,
        consultation.reason ?? null,
        consultation.findings ?? null,
        consultation.conclusions ?? null,
        consultation.conclusionsStatus,
        consultation.recommendations ? JSON.stringify(consultation.recommendations) : null,
      ],
    });
  }

  async queryConsultations(params: {
    patientId: string;
    specialty?: string;
    provider?: string;
  }): Promise<Consultation[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.specialty) {
      conditions.push('specialty = ?');
      args.push(params.specialty);
    }
    if (params.provider) {
      conditions.push('provider LIKE ?');
      args.push(`%${params.provider}%`);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_consultations WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      provider: String(row['provider']),
      specialty: String(row['specialty']),
      institution: row['institution'] ? String(row['institution']) : undefined,
      date: String(row['date']),
      reason: row['reason'] ? String(row['reason']) : undefined,
      findings: row['findings'] ? String(row['findings']) : undefined,
      conclusions: row['conclusions'] ? String(row['conclusions']) : undefined,
      conclusionsStatus: String(row['conclusions_status']) as Consultation['conclusionsStatus'],
      recommendations: row['recommendations']
        ? (JSON.parse(String(row['recommendations'])) as string[])
        : undefined,
    }));
  }

  // ─── Contradictions ───────────────────────────────────────────────────

  async addContradiction(contradiction: Contradiction): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_contradictions
				(id, patient_id, finding1, finding1_date, finding1_method,
				 finding2, finding2_date, finding2_method,
				 resolution_status, resolution_plan, diagnostic_impact)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        contradiction.id,
        contradiction.patientId,
        contradiction.finding1,
        contradiction.finding1Date ?? null,
        contradiction.finding1Method ?? null,
        contradiction.finding2,
        contradiction.finding2Date ?? null,
        contradiction.finding2Method ?? null,
        contradiction.resolutionStatus,
        contradiction.resolutionPlan ?? null,
        contradiction.diagnosticImpact ?? null,
      ],
    });
  }

  async queryContradictions(params: {
    patientId: string;
    status?: string;
  }): Promise<Contradiction[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.status) {
      conditions.push('resolution_status = ?');
      args.push(params.status);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_contradictions WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      finding1: String(row['finding1']),
      finding1Date: row['finding1_date'] ? String(row['finding1_date']) : undefined,
      finding1Method: row['finding1_method'] ? String(row['finding1_method']) : undefined,
      finding2: String(row['finding2']),
      finding2Date: row['finding2_date'] ? String(row['finding2_date']) : undefined,
      finding2Method: row['finding2_method'] ? String(row['finding2_method']) : undefined,
      resolutionStatus: String(row['resolution_status']) as Contradiction['resolutionStatus'],
      resolutionPlan: row['resolution_plan'] ? String(row['resolution_plan']) : undefined,
      diagnosticImpact: row['diagnostic_impact'] ? String(row['diagnostic_impact']) : undefined,
    }));
  }

  // ─── Patient Reports (PROs) ───────────────────────────────────────────

  async addPatientReport(report: PatientReport): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_patient_reports
				(id, patient_id, date, type, content, severity, extracted_insights)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        report.id,
        report.patientId,
        report.date,
        report.type,
        report.content,
        report.severity ?? null,
        report.extractedInsights ? JSON.stringify(report.extractedInsights) : null,
      ],
    });
  }

  async queryPatientReports(params: {
    patientId: string;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PatientReport[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.type) {
      conditions.push('type = ?');
      args.push(params.type);
    }
    if (params.dateFrom) {
      conditions.push('date >= ?');
      args.push(params.dateFrom);
    }
    if (params.dateTo) {
      conditions.push('date <= ?');
      args.push(params.dateTo);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_patient_reports WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      date: String(row['date']),
      type: String(row['type']) as PatientReport['type'],
      content: String(row['content']),
      severity: row['severity'] !== null ? Number(row['severity']) : undefined,
      extractedInsights: row['extracted_insights']
        ? (JSON.parse(String(row['extracted_insights'])) as string[])
        : undefined,
    }));
  }

  // ─── Agent Learnings ──────────────────────────────────────────────────

  async addAgentLearning(learning: AgentLearning): Promise<void> {
    await this.ensureInitialized();
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO clinical_agent_learnings
				(id, patient_id, date, category, content, confidence, related_hypotheses)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        learning.id,
        learning.patientId,
        learning.date,
        learning.category,
        learning.content,
        learning.confidence ?? null,
        learning.relatedHypotheses ? JSON.stringify(learning.relatedHypotheses) : null,
      ],
    });
  }

  async queryLearnings(params: { patientId: string; category?: string }): Promise<AgentLearning[]> {
    await this.ensureInitialized();
    const conditions = ['patient_id = ?'];
    const args: (string | null)[] = [params.patientId];

    if (params.category) {
      conditions.push('category = ?');
      args.push(params.category);
    }

    const result = await this.client.execute({
      sql: `SELECT * FROM clinical_agent_learnings WHERE ${conditions.join(' AND ')} ORDER BY date DESC`,
      args,
    });

    return result.rows.map((row) => ({
      id: String(row['id']),
      patientId: String(row['patient_id']),
      date: String(row['date']),
      category: String(row['category']) as AgentLearning['category'],
      content: String(row['content']),
      confidence: row['confidence'] !== null ? Number(row['confidence']) : undefined,
      relatedHypotheses: row['related_hypotheses']
        ? (JSON.parse(String(row['related_hypotheses'])) as string[])
        : undefined,
    }));
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this.client.close();
  }
}

// ─── Row Mapping Helpers ─────────────────────────────────────────────────

function optStr(val: unknown): string | undefined {
  return val ? String(val) : undefined;
}

function mapRowToTreatmentTrial(row: Record<string, unknown>): TreatmentTrial {
  return {
    id: String(row['id']),
    patientId: String(row['patient_id']),
    medication: String(row['medication']),
    drugClass: optStr(row['drug_class']),
    indication: optStr(row['indication']),
    startDate: optStr(row['start_date']),
    endDate: optStr(row['end_date']),
    dosage: optStr(row['dosage']),
    efficacy: String(row['efficacy']) as TreatmentTrial['efficacy'],
    sideEffects: row['side_effects']
      ? (JSON.parse(String(row['side_effects'])) as string[])
      : undefined,
    reasonDiscontinued: optStr(row['reason_discontinued']),
    adequateTrial: row['adequate_trial'] === null ? undefined : Boolean(row['adequate_trial']),
  };
}

// ─── Trend Computation Helpers ────────────────────────────────────────────

function computeTrendDirection(values: number[]): 'rising' | 'falling' | 'stable' | 'fluctuating' {
  if (values.length < 2) return 'stable';

  let increases = 0;
  let decreases = 0;

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    if (prev === undefined || curr === undefined) continue;
    const diff = curr - prev;
    if (diff > 0) increases++;
    else if (diff < 0) decreases++;
  }

  const changes = increases + decreases;
  if (changes === 0) return 'stable';

  // If direction changes frequently, it's fluctuating
  if (increases > 0 && decreases > 0 && Math.min(increases, decreases) / changes > 0.3) {
    return 'fluctuating';
  }

  return increases > decreases ? 'rising' : 'falling';
}

function computeRateOfChange(labs: Array<{ date: string; value: number }>): number | null {
  if (labs.length < 2) return null;

  const first = labs[0];
  const last = labs[labs.length - 1];
  if (!(first && last)) return null;

  const firstDate = new Date(first.date).getTime();
  const lastDate = new Date(last.date).getTime();
  const yearsDiff = (lastDate - firstDate) / (365.25 * 24 * 60 * 60 * 1000);

  if (yearsDiff === 0) return null;

  return Number(((last.value - first.value) / yearsDiff).toFixed(2));
}

function generateClinicalNote(
  direction: string,
  rateOfChange: number | null,
  isAbnormal: boolean,
  testName: string,
): string | undefined {
  const parts: string[] = [];

  if (direction === 'falling' && isAbnormal) {
    parts.push(`${testName} declining and currently abnormal`);
  } else if (direction === 'rising' && isAbnormal) {
    parts.push(`${testName} rising and currently abnormal`);
  } else if (direction === 'stable' && isAbnormal) {
    parts.push(`${testName} persistently abnormal`);
  }

  if (rateOfChange !== null && Math.abs(rateOfChange) > 0) {
    const direction2 = rateOfChange > 0 ? 'increase' : 'decrease';
    parts.push(`rate: ${Math.abs(rateOfChange)} units/year ${direction2}`);
  }

  return parts.length > 0 ? parts.join('; ') : undefined;
}

// ─── Singleton ────────────────────────────────────────────────────────────

let Instance: ClinicalStore | undefined;

export function getClinicalStore(): ClinicalStore {
  if (!Instance) {
    Instance = new ClinicalStore();
  }
  return Instance;
}
