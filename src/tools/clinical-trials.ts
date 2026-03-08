import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { logger } from '../utils/logger.js';

const CT_API_BASE = 'https://clinicaltrials.gov/api/v2';

const ClinicalTrialSchema = z.object({
  nctId: z.string().describe('ClinicalTrials.gov identifier (e.g., NCT12345678)'),
  title: z.string().describe('Official study title'),
  briefTitle: z.string().describe('Brief/short study title'),
  status: z.string().describe('Overall recruitment status (e.g., Recruiting, Completed)'),
  phase: z.string().describe('Study phase (e.g., Phase 2, Phase 3, Not Applicable)'),
  studyType: z.string().describe('Study type (e.g., Interventional, Observational)'),
  conditions: z.array(z.string()).describe('Conditions/diseases studied'),
  interventions: z.array(z.string()).describe('Interventions/treatments being evaluated'),
  enrollment: z.number().optional().describe('Number of participants enrolled or planned'),
  startDate: z.string().optional().describe('Study start date'),
  completionDate: z.string().optional().describe('Estimated or actual completion date'),
  sponsor: z.string().describe('Lead sponsor organization'),
  locations: z.array(z.string()).optional().describe('Study locations (country or facility)'),
  summary: z.string().describe('Brief study summary'),
  url: z.string().describe('Link to ClinicalTrials.gov study page'),
});

export type ClinicalTrial = z.infer<typeof ClinicalTrialSchema>;

// --- API response type helpers ---

interface CtStudyModule {
  identificationModule?: {
    nctId?: string;
    orgStudyIdInfo?: { id?: string };
    officialTitle?: string;
    briefTitle?: string;
  };
  statusModule?: {
    overallStatus?: string;
    startDateStruct?: { date?: string };
    completionDateStruct?: { date?: string };
  };
  descriptionModule?: {
    briefSummary?: string;
  };
  designModule?: {
    studyType?: string;
    phases?: string[];
    enrollmentInfo?: { count?: number };
  };
  conditionsModule?: {
    conditions?: string[];
  };
  armsInterventionsModule?: {
    interventions?: Array<{
      type?: string;
      name?: string;
    }>;
  };
  sponsorCollaboratorsModule?: {
    leadSponsor?: {
      name?: string;
    };
  };
  contactsLocationsModule?: {
    locations?: Array<{
      facility?: string;
      city?: string;
      country?: string;
    }>;
  };
}

interface CtStudy {
  protocolSection?: CtStudyModule;
}

interface CtSearchResponse {
  studies?: CtStudy[];
  totalCount?: number;
  nextPageToken?: string;
}

function parseStudy(study: CtStudy): ClinicalTrial | undefined {
  const proto = study.protocolSection;
  if (!proto) return undefined;

  const id = proto.identificationModule;
  const status = proto.statusModule;
  const design = proto.designModule;
  const desc = proto.descriptionModule;
  const conditions = proto.conditionsModule;
  const arms = proto.armsInterventionsModule;
  const sponsor = proto.sponsorCollaboratorsModule;
  const contacts = proto.contactsLocationsModule;

  const nctId = id?.nctId ?? '';
  if (!nctId) return undefined;

  const interventionNames = (arms?.interventions ?? [])
    .map((i) => [i.type, i.name].filter(Boolean).join(': '))
    .filter(Boolean);

  const locationStrings = (contacts?.locations ?? [])
    .map((l) => [l.facility, l.city, l.country].filter(Boolean).join(', '))
    .filter(Boolean);

  return {
    nctId,
    title: id?.officialTitle ?? id?.briefTitle ?? 'Untitled',
    briefTitle: id?.briefTitle ?? 'Untitled',
    status: status?.overallStatus ?? 'Unknown',
    phase: design?.phases?.join(', ') || 'Not Applicable',
    studyType: design?.studyType ?? 'Unknown',
    conditions: conditions?.conditions ?? [],
    interventions: interventionNames,
    enrollment: design?.enrollmentInfo?.count,
    startDate: status?.startDateStruct?.date,
    completionDate: status?.completionDateStruct?.date,
    sponsor: sponsor?.leadSponsor?.name ?? 'Unknown',
    ...(locationStrings.length > 0 ? { locations: locationStrings } : {}),
    summary: desc?.briefSummary ?? 'No summary available',
    url: `https://clinicaltrials.gov/study/${nctId}`,
  };
}

// --- Extracted execute mode functions ---

export interface CtSearchResult {
  trials: ClinicalTrial[];
  totalCount: number;
  query: string;
}

async function lookupByNctId(nctId: string): Promise<CtSearchResult> {
  logger.info('ClinicalTrials.gov NCT lookup', { nctId });
  const url = `${CT_API_BASE}/studies/${encodeURIComponent(nctId)}`;

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      logger.warn('ClinicalTrials.gov NCT lookup failed', { nctId, status: response.status });
      return { trials: [], totalCount: 0, query: `NCT:${nctId}` };
    }

    const study = (await response.json()) as CtStudy;
    const trial = parseStudy(study);

    return {
      trials: trial ? [trial] : [],
      totalCount: trial ? 1 : 0,
      query: `NCT:${nctId}`,
    };
  } catch (error) {
    logger.error('ClinicalTrials.gov NCT lookup error', { error: String(error) });
    return { trials: [], totalCount: 0, query: `NCT:${nctId}` };
  }
}

async function searchTrials(params: {
  query?: string | undefined;
  condition?: string | undefined;
  intervention?: string | undefined;
  phase?: string | undefined;
  status?: string | undefined;
  locationCountry?: string | undefined;
  maxResults: number;
}): Promise<CtSearchResult> {
  const urlParams = new URLSearchParams();
  urlParams.set('format', 'json');
  urlParams.set('pageSize', String(params.maxResults));

  // Build query.cond, query.intr, query.term filters
  if (params.condition) urlParams.set('query.cond', params.condition);
  if (params.intervention) urlParams.set('query.intr', params.intervention);
  if (params.query) urlParams.set('query.term', params.query);

  // Filters
  if (params.phase) urlParams.set('filter.phase', params.phase);
  if (params.status) urlParams.set('filter.overallStatus', params.status);
  if (params.locationCountry) urlParams.set('query.locn', params.locationCountry);

  const searchQuery = [params.query, params.condition, params.intervention]
    .filter(Boolean)
    .join(' | ');
  logger.info('Searching ClinicalTrials.gov', {
    searchQuery,
    phase: params.phase,
    status: params.status,
    locationCountry: params.locationCountry,
  });

  const url = `${CT_API_BASE}/studies?${urlParams.toString()}`;

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    });

    if (!response.ok) {
      logger.error('ClinicalTrials.gov search failed', { status: response.status });
      return { trials: [], totalCount: 0, query: searchQuery };
    }

    const data = (await response.json()) as CtSearchResponse;
    const studies = data.studies ?? [];
    const totalCount = data.totalCount ?? studies.length;

    const trials = studies.map(parseStudy).filter((t): t is ClinicalTrial => t !== undefined);

    logger.info('ClinicalTrials.gov search complete', {
      query: searchQuery,
      resultCount: trials.length,
      totalCount,
    });

    return { trials, totalCount, query: searchQuery };
  } catch (error) {
    logger.error('ClinicalTrials.gov search error', { error: String(error) });
    return { trials: [], totalCount: 0, query: searchQuery };
  }
}

export const clinicalTrialsTool = createTool({
  id: 'clinical-trials-search',
  description:
    'Search ClinicalTrials.gov for clinical studies. Find active trials by condition, intervention, phase, or status. Look up specific trials by NCT ID. Filter by location (country) to find trials accessible to patients.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Free-text search query (condition, intervention, keywords)'),
    nctId: z.string().optional().describe('Specific NCT ID to look up (e.g., NCT12345678)'),
    condition: z.string().optional().describe('Filter by condition/disease name'),
    intervention: z.string().optional().describe('Filter by intervention/treatment name'),
    phase: z
      .enum(['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'NA'])
      .optional()
      .describe('Filter by study phase'),
    status: z
      .enum([
        'RECRUITING',
        'NOT_YET_RECRUITING',
        'ACTIVE_NOT_RECRUITING',
        'COMPLETED',
        'TERMINATED',
        'WITHDRAWN',
        'SUSPENDED',
      ])
      .optional()
      .describe('Filter by overall recruitment status'),
    locationCountry: z
      .string()
      .optional()
      .describe('Filter by country (e.g., "Poland", "United States")'),
    maxResults: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of results (default: 10)'),
  }),
  outputSchema: z.object({
    trials: z.array(ClinicalTrialSchema).describe('List of matching clinical trials'),
    totalCount: z.number().describe('Total number of matching trials'),
    query: z.string().describe('The search query that was executed'),
  }),
  execute: async (inputData) => {
    const {
      query,
      nctId,
      condition,
      intervention,
      phase,
      status,
      locationCountry,
      maxResults = 10,
    } = inputData;

    if (nctId) return lookupByNctId(nctId);
    return searchTrials({
      query,
      condition,
      intervention,
      phase,
      status,
      locationCountry,
      maxResults,
    });
  },
});
