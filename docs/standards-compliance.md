# Standards Compliance — FHIR R4, LOINC, USCDI v3

Asklepios document taxonomy aligns with three interoperability standards to ensure
clinical data is portable, auditable, and ready for health information exchange.

## Standards Stack

| Standard | Version | Role in Asklepios |
|----------|---------|-------------------|
| **HL7 FHIR** | R4 (4.0.1) | Resource type model for document classification |
| **LOINC Document Ontology** | 2.77+ | 5-axis document type codes |
| **USCDI** | v3 (Jan 2026) | Clinical Notes baseline for data exchange |
| **HL7 v2-0074** | 2.9 | Diagnostic service section codes |
| **W3C PROV** | PROV-DM | Provenance audit trail (Entity/Activity/Agent/Relation) |

---

## Document Type Mapping

### Source → FHIR → LOINC → USCDI → Chunking

| Source Type | FHIR Resource | LOINC Code | LOINC Name | USCDI Note Type | HL7 v2-0074 | Chunking |
|-------------|---------------|------------|------------|-----------------|-------------|----------|
| `lab_result` | DiagnosticReport | 26436-6 | Laboratory studies | — | LAB | recursive |
| `imaging_report` | DiagnosticReport | 18748-4 | Diagnostic imaging study | — | RAD | recursive |
| `procedure` | Procedure | 28570-0 | Procedure note | Procedure Note | GE | markdown |
| `consultation` | DocumentReference | 11488-4 | Consultation note | Consultation Note | OTH/NRS | markdown |
| `external` | DocumentReference | 11488-4 | Consultation note | Consultation Note | OTH | markdown |
| `narrative` | DocumentReference | 51855-5 | Patient note | — | OTH | markdown |
| `other` | — | — | — | — | OTH | recursive |

### Asklepios DocumentType (Layer 3)

| DocumentType | Maps From | FHIR Resource |
|--------------|-----------|---------------|
| `diagnostic-report` | lab_result, imaging_report | DiagnosticReport |
| `procedure-note` | procedure | Procedure |
| `clinical-note` | consultation, external | DocumentReference |
| `patient-document` | narrative | DocumentReference |
| `research-paper` | (ingested literature) | — |
| `other` | other | — |

---

## FHIR R4 Resource Mapping Rationale

### DiagnosticReport (labs + imaging)

FHIR R4 states DiagnosticReport represents "the findings and interpretation of
diagnostic tests performed on patients." Both laboratory results and imaging
reports are diagnostic tests — they share the same FHIR resource type but are
distinguished by HL7 v2-0074 diagnostic service section codes (LAB vs RAD).

### Procedure (gastroscopy, colonoscopy, SIBO)

Endoscopy procedures, breath tests, and other interventional diagnostics map to
FHIR Procedure. These are distinct from passive diagnostic reports because they
involve an intervention performed on the patient. LOINC 28570-0 (Procedure note)
covers the documentation of these procedures.

### DocumentReference (consultations, narratives)

Clinical consultations and patient-authored narratives map to FHIR
DocumentReference — a general-purpose resource for clinical documents that don't
fit the structured DiagnosticReport or Procedure patterns. LOINC 11488-4
(Consultation note) and 51855-5 (Patient note) provide the document type codes.

---

## LOINC Document Ontology

LOINC Document Ontology classifies clinical documents along 5 axes:

| Axis | Description | Example |
|------|-------------|---------|
| **Subject Matter Domain** | Clinical specialty | Neurology, Gastroenterology |
| **Kind of Document** | Document purpose | Note, Report, Study |
| **Type of Service** | Healthcare activity | Consultation, Procedure |
| **Setting** | Care environment | Hospital, Outpatient |
| **Role** | Author's role | Physician, Patient |

### LOINC Codes Used

| Code | Component | System | Asklepios Usage |
|------|-----------|--------|-----------------|
| 26436-6 | Laboratory studies | LOINC | Lab results (Diagnostyka, Mayo Clinic) |
| 18748-4 | Diagnostic imaging study | LOINC | MRI, CT, X-ray, ultrasound reports |
| 28570-0 | Procedure note | LOINC | Gastroscopy, colonoscopy, SIBO |
| 11488-4 | Consultation note | LOINC | Specialist consultations |
| 51855-5 | Patient note | LOINC | Patient-authored narratives |
| 74264-3 | HIV summary report | LOINC | Other/general documents |

---

## HL7 v2-0074 Diagnostic Service Section Codes

| Code | Name | Asklepios Usage |
|------|------|-----------------|
| LAB | Laboratory | Blood work, urinalysis, CSF analysis |
| RAD | Radiology | MRI, CT, X-ray, scintigraphy |
| GE | Gastroenterology | Endoscopy, colonoscopy, SIBO testing |
| NRS | Neurology/Neurosurgery | Neurology and cardiology consultations |
| OTH | Other | General consultations, narratives, external docs |

---

## USCDI v3 Clinical Notes Alignment

USCDI v3 (effective January 1, 2026) mandates exchange of these Clinical Note
types. Asklepios maps to the applicable types:

| USCDI v3 Clinical Note | Asklepios Mapping |
|------------------------|-------------------|
| Consultation Note | `consultation` → `clinical-note` |
| Discharge Summary Note | (not present in current dataset) |
| History & Physical Note | (not present in current dataset) |
| Procedure Note | `procedure` → `procedure-note` |
| Progress Note | `consultation` → `clinical-note` |

---

## W3C PROV Provenance Model

Asklepios implements W3C PROV-DM for full audit trails across all 6 data layers.

### Provenance Entity Types

| Entity Type | Layer | Description |
|-------------|-------|-------------|
| `source-doc` | L0 | Original PDF/scan extraction metadata |
| `document-chunk` | L1 | Embedded vector chunk in knowledge base |
| `lab-result` | L2A | Structured lab value |
| `imaging-report` | L2A | Imaging report text blob |
| `imaging-finding` | L2A | Structured per-finding row |
| `diagnosis` | L2A | Explicit diagnosis registry entry |
| `progression` | L2A | Temporal chain link |
| `consultation` | L2A | Consultation record |
| `treatment-trial` | L2A | Treatment trial record |
| `procedure-report` | L2A | Procedure report (FHIR Procedure) |
| `research-finding` | L3 | Literature/PGx/trial finding |
| `research-query` | L3 | Search query audit |
| `hypothesis` | L4 | Diagnostic hypothesis |
| `evidence-link` | L4 | Hypothesis↔evidence connection |
| `report-section` | L5 | Section of a deliverable |
| `report-version` | L5 | Versioned deliverable snapshot |

### Provenance Relations (W3C PROV)

| Relation | Meaning |
|----------|---------|
| `wasGeneratedBy` | Entity was produced by an activity |
| `wasDerivedFrom` | Entity was derived from another entity |
| `wasAttributedTo` | Entity is attributed to an agent |
| `used` | Activity used an entity as input |
| `wasInvalidatedBy` | Entity was invalidated by an activity |
| `wasInformedBy` | Activity was informed by another activity |
| `hadMember` | Collection membership |

### Change Signal System

Change signals propagate through the layer dependency graph:

```
L0 (source docs) → L2 (structured) → L3 (embeddings) → L4 (research) → L5 (reports)
```

| Signal | Priority Levels | Meaning |
|--------|----------------|---------|
| `new` | low/medium/high/critical | New entity created |
| `updated` | low/medium/high/critical | Existing entity modified |
| `deleted` | low/medium/high/critical | Entity removed |
| `invalidated` | low/medium/high/critical | Entity marked unreliable |

---

## References

- **HL7 FHIR R4**: https://hl7.org/fhir/R4/
- **FHIR DiagnosticReport**: https://hl7.org/fhir/R4/diagnosticreport.html
- **FHIR Procedure**: https://hl7.org/fhir/R4/procedure.html
- **FHIR DocumentReference**: https://hl7.org/fhir/R4/documentreference.html
- **LOINC Document Ontology**: https://loinc.org/document-ontology/
- **HL7 v2-0074 Table**: https://terminology.hl7.org/ValueSet-v2-0074.html
- **USCDI v3**: https://www.healthit.gov/isa/united-states-core-data-interoperability-uscdi
- **W3C PROV-DM**: https://www.w3.org/TR/prov-dm/
- **HTI-1 Final Rule**: https://www.healthit.gov/topic/laws-regulation-and-policy/health-data-technology-and-interoperability-certification-program
