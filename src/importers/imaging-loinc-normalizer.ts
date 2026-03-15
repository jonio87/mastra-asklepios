/**
 * Imaging Study LOINC Code Normalizer
 *
 * Maps imaging modality + body region combinations to LOINC study codes
 * for FHIR R4 DiagnosticReport.code field.
 *
 * Codes from LOINC Document Ontology for diagnostic imaging.
 * System URI: http://loinc.org
 */

const IMAGING_LOINC_MAP: Record<string, Record<string, string>> = {
  MRI: {
    head: '36801-9', // MRI Brain
    cervical_spine: '36095-8', // MRI Cervical spine
    thoracic_spine: '36105-5', // MRI Thoracic spine
    lumbar_spine: '36107-1', // MRI Lumbar spine
    spine: '36109-7', // MRI Spine
    full_spine: '36109-7', // MRI Spine
    shoulder: '36125-3', // MRI Shoulder
    pelvis: '36113-9', // MRI Pelvis
    hip: '36099-0', // MRI Hip
    knee: '36103-0', // MRI Knee
    ankle: '36087-5', // MRI Ankle
    dental: '36801-9', // MRI Head (dental uses head protocol)
  },
  CT: {
    head: '36067-7', // CT Head
    cervical_spine: '36067-7', // CT Cervical spine
    lumbar_spine: '36075-0', // CT Lumbar spine
    abdomen: '24531-6', // CT Abdomen
    pelvis: '36079-2', // CT Pelvis
    chest: '36071-9', // CT Chest
    paranasal_sinuses: '30636-1', // CT Sinuses
  },
  'X-ray': {
    cervical_spine: '36331-7', // XR Cervical spine 4 Views
    lumbar_spine: '36337-4', // XR Lumbar spine
    chest: '36643-5', // XR Chest
    head: '36589-0', // XR Head
    full_spine: '36590-8', // XR Spine
    spine: '36590-8', // XR Spine
    pelvis: '36397-8', // XR Pelvis
    hip: '36374-7', // XR Hip
    knee: '36381-2', // XR Knee
    ankle: '36340-8', // XR Ankle
    shoulder: '36394-4', // XR Shoulder
  },
  ultrasound: {
    abdomen: '24557-1', // US Abdomen
    pelvis: '24561-3', // US Pelvis
    thyroid: '24595-1', // US Thyroid
    carotid: '24509-2', // US Carotid
    upper_extremity: '24530-8', // US Upper extremity veins
    lower_extremity: '24570-4', // US Lower extremity veins
    shoulder: '24522-5', // US Shoulder
    hip: '24519-1', // US Hip
    kidney: '24539-9', // US Kidney
  },
  scintigraphy: {
    cervical_spine: '39638-2', // NM Bone
    head: '39638-2', // NM Bone
    full_spine: '39638-2', // NM Bone whole body
  },
};

/** Look up LOINC study code for a modality + body region combination */
export function getImagingLoincCode(
  modality: string,
  bodyRegion: string,
): string | undefined {
  return IMAGING_LOINC_MAP[modality]?.[bodyRegion];
}

// ─── SNOMED CT Body Site Codes ──────────────────────────────────────────────
// Maps normalized body region strings to SNOMED CT anatomical structure codes.
// System URI: http://snomed.info/sct

const BODY_REGION_SNOMED_MAP: Record<string, string> = {
  // ── Existing regions (10) ──
  head: '69536005', // Head structure
  cervical_spine: '122494005', // Cervical spine structure
  thoracic_spine: '122495006', // Thoracic spine structure
  spine: '421060004', // Vertebral column structure
  full_spine: '421060004', // Vertebral column structure
  shoulder: '16982005', // Shoulder region structure
  chest: '51185008', // Thorax structure
  abdomen: '818983003', // Abdomen structure
  paranasal_sinuses: '2095001', // Paranasal sinus structure
  dental: '38199008', // Tooth structure

  // ── New regions (12+) ──
  lumbar_spine: '122497005', // Lumbar spine structure
  lumbosacral: '182024006', // Lumbosacral structure
  sacroiliac: '39723000', // Sacroiliac joint structure
  pelvis: '12921003', // Pelvis structure
  hip: '24136001', // Hip joint structure
  knee: '72696002', // Knee region structure
  ankle: '70258002', // Ankle joint structure
  upper_extremity: '53120007', // Upper extremity structure
  lower_extremity: '61685007', // Lower extremity structure
  thyroid: '69748006', // Thyroid structure
  carotid: '69105007', // Carotid artery structure
  kidney: '64033007', // Kidney structure
  wrist: '8205005', // Wrist region structure
  elbow: '76248009', // Elbow region structure
  foot: '56459004', // Foot structure
};

/** Look up SNOMED CT body site code for a body region */
export function getBodySiteSnomedCode(bodyRegion: string): string | undefined {
  return BODY_REGION_SNOMED_MAP[bodyRegion];
}
