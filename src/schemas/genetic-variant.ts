import { z } from 'zod';

/**
 * Genetic Variant Schema — Layer 2C of the three-layer architecture.
 *
 * Stores raw genotype data from direct-to-consumer sequencing (23andMe, AncestryDNA)
 * or clinical whole-genome/exome sequencing. Designed for high-volume storage
 * (600K+ SNPs per patient) with efficient chromosome/position queries.
 *
 * Separate from research_findings because:
 * - Raw genotype data has different column semantics (rsid, chromosome, position, genotype)
 * - 638K rows per patient would overwhelm the research_findings table
 * - Query patterns differ: genotype queries filter by chromosome + position range
 * - Dedup is by (patient_id, rsid), not by external_id_type
 */

export const chromosomeValues = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  'X',
  'Y',
  'MT',
] as const;

export const chromosomeEnum = z.enum(chromosomeValues);
export type Chromosome = z.infer<typeof chromosomeEnum>;

export const geneticVariantSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  rsid: z.string(), // "rs548049170" or internal "i713426"
  chromosome: chromosomeEnum,
  position: z.number().int().nonnegative(),
  genotype: z.string(), // "TT", "AG", "--", "A", "II", "DD", "DI"
  source: z.string(), // "23andMe", "AncestryDNA", "clinical-wgs"
  sourceVersion: z.string().optional(), // "v5"
  referenceGenome: z.string(), // "GRCh37", "GRCh38"
  importDate: z.string(), // ISO 8601
  rawLine: z.string().optional(), // original TSV line for audit
});

export type GeneticVariant = z.infer<typeof geneticVariantSchema>;

export const geneticVariantQuerySchema = z.object({
  patientId: z.string(),
  chromosome: chromosomeEnum.optional(),
  rsid: z.string().optional(),
  rsids: z.array(z.string()).optional(), // batch lookup
  positionFrom: z.number().int().optional(),
  positionTo: z.number().int().optional(),
  genotype: z.string().optional(), // filter by specific genotype
  excludeNoCalls: z.boolean().optional(), // exclude "--" genotypes
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export type GeneticVariantQuery = z.infer<typeof geneticVariantQuerySchema>;
