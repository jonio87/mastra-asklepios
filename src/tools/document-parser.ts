import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

const ParsedSectionSchema = z.object({
  title: z.string().describe('Section title (e.g., "Chief Complaint", "Lab Results")'),
  content: z.string().describe('Section content text'),
  type: z
    .enum([
      'demographics',
      'symptoms',
      'diagnosis',
      'labs',
      'imaging',
      'genetics',
      'medications',
      'history',
      'notes',
      'other',
    ])
    .describe('Categorized section type'),
});

const ParsedDocumentSchema = z.object({
  documentType: z
    .enum([
      'medical-record',
      'lab-report',
      'genetic-report',
      'clinical-note',
      'referral',
      'unknown',
    ])
    .describe('Detected document type'),
  patientAge: z.string().optional().describe('Patient age if found'),
  patientSex: z.string().optional().describe('Patient sex if found'),
  sections: z.array(ParsedSectionSchema).describe('Parsed document sections'),
  rawText: z.string().describe('Full raw text of the document'),
  symptoms: z.array(z.string()).describe('Extracted symptom mentions'),
  diagnoses: z.array(z.string()).describe('Extracted diagnosis mentions'),
  medications: z.array(z.string()).describe('Extracted medication mentions'),
  labValues: z
    .array(
      z.object({
        name: z.string().describe('Lab test name'),
        value: z.string().describe('Lab test value'),
        unit: z.string().optional().describe('Unit of measurement'),
        flag: z
          .enum(['normal', 'high', 'low', 'critical', 'unknown'])
          .optional()
          .describe('Result flag'),
      }),
    )
    .describe('Extracted lab values'),
});

export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;

export const documentParserTool = createTool({
  id: 'document-parser',
  description:
    'Parse patient medical documents (plain text from PDFs, clinical notes, lab reports, genetic reports). Extracts structured data including symptoms, diagnoses, medications, and lab values. Feed the output to the HPO mapper for phenotype standardization.',
  inputSchema: z.object({
    text: z.string().describe('Raw text content of the medical document'),
    documentType: z
      .enum([
        'medical-record',
        'lab-report',
        'genetic-report',
        'clinical-note',
        'referral',
        'unknown',
      ])
      .optional()
      .describe('Known document type (auto-detected if not specified)'),
  }),
  outputSchema: ParsedDocumentSchema,
  execute: async (inputData) => {
    const { text, documentType } = inputData;

    logger.info('Parsing medical document', { length: text.length, documentType });

    const detectedType = documentType ?? detectDocumentType(text);
    const sections = extractSections(text);
    const symptoms = extractPatterns(text, SYMPTOM_PATTERNS);
    const diagnoses = extractPatterns(text, DIAGNOSIS_PATTERNS);
    const medications = extractPatterns(text, MEDICATION_PATTERNS);
    const labValues = extractLabValues(text);
    const { age, sex } = extractDemographics(text);

    logger.info('Document parsing complete', {
      type: detectedType,
      sections: sections.length,
      symptoms: symptoms.length,
      diagnoses: diagnoses.length,
    });

    return {
      documentType: detectedType,
      patientAge: age,
      patientSex: sex,
      sections,
      rawText: text,
      symptoms,
      diagnoses,
      medications,
      labValues,
    };
  },
});

function detectDocumentType(
  text: string,
): 'medical-record' | 'lab-report' | 'genetic-report' | 'clinical-note' | 'referral' | 'unknown' {
  const lower = text.toLowerCase();
  if (
    lower.includes('genetic') ||
    lower.includes('variant') ||
    lower.includes('exome') ||
    lower.includes('genome')
  )
    return 'genetic-report';
  if (
    lower.includes('lab result') ||
    lower.includes('laboratory') ||
    lower.includes('cbc') ||
    lower.includes('metabolic panel')
  )
    return 'lab-report';
  if (
    lower.includes('referral') ||
    lower.includes('referred to') ||
    lower.includes('referring physician')
  )
    return 'referral';
  if (
    lower.includes('progress note') ||
    lower.includes('clinic visit') ||
    lower.includes('assessment and plan')
  )
    return 'clinical-note';
  if (
    lower.includes('medical record') ||
    lower.includes('discharge summary') ||
    lower.includes('history and physical')
  )
    return 'medical-record';
  return 'unknown';
}

function extractSections(text: string): Array<{
  title: string;
  content: string;
  type:
    | 'demographics'
    | 'symptoms'
    | 'diagnosis'
    | 'labs'
    | 'imaging'
    | 'genetics'
    | 'medications'
    | 'history'
    | 'notes'
    | 'other';
}> {
  const sectionHeaders = /^(?:#{1,3}\s+|[A-Z][A-Z\s/]+:?\s*$)/gm;
  const parts = text.split(sectionHeaders).filter((p) => p.trim());
  const headers = text.match(sectionHeaders) ?? [];

  return parts.map((content, i) => {
    const rawTitle =
      headers[i]
        ?.replace(/^#+\s*/, '')
        .replace(/:?\s*$/, '')
        .trim() ?? `Section ${i + 1}`;
    return {
      title: rawTitle,
      content: content.trim(),
      type: classifySection(rawTitle),
    };
  });
}

type SectionType =
  | 'demographics'
  | 'symptoms'
  | 'diagnosis'
  | 'labs'
  | 'imaging'
  | 'genetics'
  | 'medications'
  | 'history'
  | 'notes'
  | 'other';

const SECTION_KEYWORDS: Array<{ keywords: string[]; type: SectionType }> = [
  { keywords: ['demographic', 'patient info'], type: 'demographics' },
  { keywords: ['symptom', 'complaint', 'present illness'], type: 'symptoms' },
  { keywords: ['diagnos', 'assessment'], type: 'diagnosis' },
  { keywords: ['lab', 'result', 'blood'], type: 'labs' },
  { keywords: ['imaging', 'mri', 'ct', 'xray'], type: 'imaging' },
  { keywords: ['genetic', 'variant', 'mutation'], type: 'genetics' },
  { keywords: ['medication', 'drug', 'prescription'], type: 'medications' },
  { keywords: ['history', 'past medical', 'family'], type: 'history' },
  { keywords: ['note', 'plan', 'follow'], type: 'notes' },
];

function classifySection(title: string): SectionType {
  const lower = title.toLowerCase();
  const match = SECTION_KEYWORDS.find((entry) =>
    entry.keywords.some((keyword) => lower.includes(keyword)),
  );
  return match?.type ?? 'other';
}

const SYMPTOM_PATTERNS = [
  /(?:presents? with|complains? of|reports?|experiencing|symptoms? (?:include|of))\s+([^.;]+)/gi,
  /(?:chief complaint|cc):\s*([^.;\n]+)/gi,
];

const DIAGNOSIS_PATTERNS = [
  /(?:diagnos(?:is|ed)|dx|assessment):\s*([^.;\n]+)/gi,
  /(?:suspect(?:ed)?|probable|possible)\s+([^.;\n]+)/gi,
];

const MEDICATION_PATTERNS = [
  /(?:medications?|rx|prescribed|taking):\s*([^.;\n]+)/gi,
  /(?:started on|continues? on|maintained? on)\s+([^.;\n]+)/gi,
];

function extractPatterns(text: string, patterns: RegExp[]): string[] {
  const results = new Set<string>();
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match = regex.exec(text);
    while (match !== null) {
      const captured = match[1]?.trim();
      if (captured) results.add(captured);
      match = regex.exec(text);
    }
  }
  return [...results];
}

function extractLabValues(text: string): Array<{
  name: string;
  value: string;
  unit?: string;
  flag?: 'normal' | 'high' | 'low' | 'critical' | 'unknown';
}> {
  const labPattern = /([A-Za-z\s]+?):\s*([\d.]+)\s*([a-zA-Z/%]+)?\s*(?:\(([HLCN])\))?/g;
  const results: Array<{
    name: string;
    value: string;
    unit?: string;
    flag?: 'normal' | 'high' | 'low' | 'critical' | 'unknown';
  }> = [];

  let match = labPattern.exec(text);
  while (match !== null) {
    const name = match[1]?.trim();
    const value = match[2];
    if (name && value) {
      const unit = match[3] || undefined;
      const flag = mapLabFlag(match[4]);
      const entry: {
        name: string;
        value: string;
        unit?: string;
        flag?: 'normal' | 'high' | 'low' | 'critical' | 'unknown';
      } = { name, value };
      if (unit !== undefined) entry.unit = unit;
      if (flag !== undefined) entry.flag = flag;
      results.push(entry);
    }
    match = labPattern.exec(text);
  }

  return results;
}

function mapLabFlag(flag?: string): 'normal' | 'high' | 'low' | 'critical' | 'unknown' | undefined {
  if (!flag) return undefined;
  const upper = flag.toUpperCase();
  if (upper === 'N') return 'normal';
  if (upper === 'H') return 'high';
  if (upper === 'L') return 'low';
  if (upper === 'C') return 'critical';
  return 'unknown';
}

function extractDemographics(text: string): { age?: string; sex?: string } {
  const ageMatch = /(\d{1,3})\s*(?:year|yr|y\.?o\.?)\s*(?:old)?/i.exec(text);
  const sexMatch = /\b(male|female|M|F)\b/i.exec(text);

  const result: { age?: string; sex?: string } = {};
  if (ageMatch?.[1]) result.age = `${ageMatch[1]} years`;
  if (sexMatch?.[1]) result.sex = sexMatch[1].toLowerCase().startsWith('m') ? 'male' : 'female';
  return result;
}
