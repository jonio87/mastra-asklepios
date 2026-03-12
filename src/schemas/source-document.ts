import { z } from 'zod';
import { evidenceProvenanceFields } from './clinical-record.js';

/**
 * Source Document Schema — Layer 0 of the inverted pyramid.
 *
 * Maps directly to the YAML frontmatter in ~/Documents/GitHub/medical-records.
 * Every field here exists in the extraction pipeline's output. This schema
 * bridges the external filesystem (extracted markdown + YAML) with the
 * Asklepios database, making Layer 0 queryable.
 *
 * "How many imaging reports do we have?" becomes SQL instead of file counting.
 */

// ─── Document Categories (from medical-records repo) ────────────────────

export const sourceDocCategoryValues = [
  'lab_result',
  'consultation',
  'imaging_report',
  'abdominal',
  'narrative',
  'external',
  'other',
] as const;

export const sourceDocCategoryEnum = z.enum(sourceDocCategoryValues);
export type SourceDocCategory = z.infer<typeof sourceDocCategoryEnum>;

// ─── Extraction Methods ─────────────────────────────────────────────────

export const extractionMethodValues = [
  'claude_read', // Claude vision API (native PDFs, avg confidence 0.96)
  'tesseract_ocr', // Tesseract OCR (scanned docs, confidence ~0.85)
  'pymupdf', // PyMuPDF structured extraction
  'python_docx', // python-docx DOCX extraction
  'manual', // Manual transcription
  'other',
] as const;

export const extractionMethodEnum = z.enum(extractionMethodValues);
export type ExtractionMethod = z.infer<typeof extractionMethodEnum>;

// ─── Source Document Schema ─────────────────────────────────────────────

export const sourceDocumentSchema = z.object({
  id: z.string(), // document_id from YAML frontmatter
  patientId: z.string(),
  // Original file metadata
  originalFilename: z.string(), // source_file from manifest
  originalFileHash: z.string(), // SHA-256 of source PDF/scan
  originalFileSizeBytes: z.number().int().nonnegative(),
  originalPageCount: z.number().int().nonnegative().optional(),
  mimeType: z.string().optional(), // 'application/pdf', 'image/jpeg', etc.
  // Extraction metadata
  extractionMethod: extractionMethodEnum,
  extractionConfidence: z.number().min(0).max(1), // 0.0-1.0
  extractionDate: z.string(), // ISO 8601
  extractionTool: z.string(), // 'claude-sonnet-4', 'tesseract-5.x+pol+eng'
  extractionWave: z.number().int().min(1).optional(), // Extraction batch number (1-5)
  extractedMarkdownPath: z.string(), // Path to extracted markdown file
  // Pre/post processing
  preProcessing: z.string().optional(), // 'grayscale,300dpi', 'none'
  postProcessing: z.string().optional(), // 'yaml-frontmatter-generation', etc.
  pipelineVersion: z.string().optional(), // '1.0.0'
  // Clinical metadata
  category: sourceDocCategoryEnum,
  subcategory: z.string().optional(), // 'mri', 'blood', 'urine', etc.
  date: z.string().optional(), // ISO 8601 — document date
  facility: z.string().optional(), // 'NZOZ Skanmex Diagnostyka'
  physician: z.string().optional(), // 'Lek. Paweł Szewczyk'
  language: z.string().optional(), // 'pl', 'en', 'de'
  tags: z.array(z.string()).optional(),
  // Evidence provenance
  ...evidenceProvenanceFields,
});

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

// ─── Source Document Query ──────────────────────────────────────────────

export const sourceDocumentQuerySchema = z.object({
  patientId: z.string(),
  category: sourceDocCategoryEnum.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  facility: z.string().optional(),
  extractionMethod: extractionMethodEnum.optional(),
  limit: z.number().int().positive().optional(),
});

export type SourceDocumentQuery = z.infer<typeof sourceDocumentQuerySchema>;
