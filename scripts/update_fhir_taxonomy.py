#!/usr/bin/env python3
"""
Update medical-records YAML frontmatter to FHIR R4 + LOINC Document Ontology alignment.

Changes:
1. document_type: abdominal → procedure (21 files)
2. asklepios_type → FHIR-aligned values (all 322 files)
3. Add fhir_resource_type, loinc_doc_code, diagnostic_service_section fields (all 322 files)

FHIR R4 mapping table:
  Source Type     → asklepios_type     | FHIR Resource       | LOINC Code | HL7 Section
  lab_result      → diagnostic-report  | DiagnosticReport     | 26436-6    | LAB
  imaging_report  → diagnostic-report  | DiagnosticReport     | 18748-4    | RAD
  procedure       → procedure-note     | Procedure            | 28570-0    | GE
  consultation    → clinical-note      | DocumentReference    | 11488-4    | OTH
  external        → clinical-note      | DocumentReference    | 11488-4    | OTH
  narrative       → patient-document   | DocumentReference    | 51855-5    | OTH
  other           → other              | DocumentReference    | 74264-3    | OTH
"""

import os
import re
import sys
import json
from pathlib import Path


RECORDS_DIR = Path("/Users/andrzej/Documents/GitHub/medical-records/records")

# FHIR mapping: source document_type → (asklepios_type, fhir_resource_type, loinc_doc_code, diagnostic_service_section)
FHIR_MAP = {
    "lab_result": ("diagnostic-report", "DiagnosticReport", "26436-6", "LAB"),
    "imaging_report": ("diagnostic-report", "DiagnosticReport", "18748-4", "RAD"),
    "procedure": ("procedure-note", "Procedure", "28570-0", "GE"),
    "consultation": ("clinical-note", "DocumentReference", "11488-4", "OTH"),
    "external": ("clinical-note", "DocumentReference", "11488-4", "OTH"),
    "narrative": ("patient-document", "DocumentReference", "51855-5", "OTH"),
    "other": ("other", "DocumentReference", "74264-3", "OTH"),
}

# Also map old 'abdominal' → 'procedure' (for files not yet renamed)
FHIR_MAP["abdominal"] = FHIR_MAP["procedure"]


def parse_frontmatter(content: str) -> tuple[dict[str, str], str, str]:
    """Parse YAML frontmatter from markdown content.
    Returns (fields_dict, frontmatter_text, body_text).
    fields_dict maps field names to their full line text.
    """
    match = re.match(r"^---\n(.*?)\n---\n?(.*)", content, re.DOTALL)
    if not match:
        return {}, "", content
    
    fm_text = match.group(1)
    body = match.group(2)
    
    fields = {}
    for line in fm_text.split("\n"):
        if ":" in line and not line.startswith(" ") and not line.startswith("-"):
            key = line.split(":", 1)[0].strip()
            fields[key] = line
    
    return fields, fm_text, body


def get_document_type(fields: dict[str, str]) -> str:
    """Extract document_type value from fields."""
    line = fields.get("document_type", "")
    if not line:
        return ""
    val = line.split(":", 1)[1].strip().strip("'\"")
    return val


def update_file(filepath: Path, dry_run: bool = False) -> dict:
    """Update a single file's frontmatter for FHIR alignment.
    Returns dict with changes made.
    """
    content = filepath.read_text(encoding="utf-8")
    fields, fm_text, body = parse_frontmatter(content)
    
    if not fm_text:
        return {"file": str(filepath), "error": "no frontmatter"}
    
    doc_type = get_document_type(fields)
    if not doc_type:
        return {"file": str(filepath), "error": "no document_type"}
    
    changes = []
    new_fm = fm_text
    
    # 1. Rename document_type: abdominal → procedure
    if doc_type == "abdominal":
        old_line = fields["document_type"]
        new_line = old_line.replace("abdominal", "procedure")
        new_fm = new_fm.replace(old_line, new_line)
        changes.append("document_type: abdominal → procedure")
        doc_type = "procedure"  # update for subsequent lookups
    
    # Get FHIR mapping
    mapping = FHIR_MAP.get(doc_type)
    if not mapping:
        return {"file": str(filepath), "error": f"unknown document_type: {doc_type}"}
    
    asklepios_type, fhir_resource, loinc_code, diag_section = mapping
    
    # 2. Update asklepios_type
    if "asklepios_type" in fields:
        old_line = fields["asklepios_type"]
        old_val = old_line.split(":", 1)[1].strip().strip("'\"")
        if old_val != asklepios_type:
            new_line = f"asklepios_type: {asklepios_type}"
            new_fm = new_fm.replace(old_line, new_line)
            changes.append(f"asklepios_type: {old_val} → {asklepios_type}")
    
    # 3. Add FHIR fields (after evidence_tier or after asklepios_type)
    has_fhir = "fhir_resource_type" in fields
    if not has_fhir:
        # Find insertion point — after asklepios_type line
        insert_after = fields.get("asklepios_type", fields.get("evidence_tier", ""))
        if insert_after:
            fhir_block = (
                f"\nfhir_resource_type: {fhir_resource}"
                f"\nloinc_doc_code: \"{loinc_code}\""
                f"\ndiagnostic_service_section: {diag_section}"
            )
            new_fm = new_fm.replace(insert_after, insert_after + fhir_block)
            changes.append(f"added fhir_resource_type: {fhir_resource}")
            changes.append(f"added loinc_doc_code: {loinc_code}")
            changes.append(f"added diagnostic_service_section: {diag_section}")
    else:
        # Update existing FHIR fields if values differ
        old_fhir = fields["fhir_resource_type"].split(":", 1)[1].strip()
        if old_fhir != fhir_resource:
            new_fm = new_fm.replace(
                fields["fhir_resource_type"],
                f"fhir_resource_type: {fhir_resource}"
            )
            changes.append(f"fhir_resource_type: {old_fhir} → {fhir_resource}")
        
        if "loinc_doc_code" in fields:
            old_loinc = fields["loinc_doc_code"].split(":", 1)[1].strip().strip("'\"")
            if old_loinc != loinc_code:
                new_fm = new_fm.replace(
                    fields["loinc_doc_code"],
                    f"loinc_doc_code: \"{loinc_code}\""
                )
                changes.append(f"loinc_doc_code: {old_loinc} → {loinc_code}")
        
        if "diagnostic_service_section" in fields:
            old_diag = fields["diagnostic_service_section"].split(":", 1)[1].strip()
            if old_diag != diag_section:
                new_fm = new_fm.replace(
                    fields["diagnostic_service_section"],
                    f"diagnostic_service_section: {diag_section}"
                )
                changes.append(f"diagnostic_service_section: {old_diag} → {diag_section}")
    
    if not changes:
        return {"file": filepath.name, "changes": [], "status": "unchanged"}
    
    if not dry_run:
        new_content = f"---\n{new_fm}\n---\n{body}"
        filepath.write_text(new_content, encoding="utf-8")
    
    return {"file": filepath.name, "changes": changes, "status": "updated"}


def main():
    dry_run = "--dry-run" in sys.argv
    
    if dry_run:
        print("=== DRY RUN MODE (no files modified) ===\n")
    
    # Find all markdown files (skip .archive)
    md_files = []
    for root, dirs, files in os.walk(RECORDS_DIR):
        # Skip archive directories
        dirs[:] = [d for d in dirs if d != ".archive"]
        for f in files:
            if f.endswith(".md"):
                md_files.append(Path(root) / f)
    
    md_files.sort()
    print(f"Found {len(md_files)} markdown files\n")
    
    stats = {"updated": 0, "unchanged": 0, "errors": 0}
    all_changes = []
    
    for fp in md_files:
        result = update_file(fp, dry_run=dry_run)
        
        if "error" in result:
            stats["errors"] += 1
            print(f"  ERROR {result['file']}: {result['error']}")
        elif result["status"] == "updated":
            stats["updated"] += 1
            if len(result["changes"]) > 0:
                print(f"  UPDATE {result['file']}: {', '.join(result['changes'])}")
            all_changes.append(result)
        else:
            stats["unchanged"] += 1
    
    print(f"\n{'DRY RUN ' if dry_run else ''}Summary:")
    print(f"  Updated:   {stats['updated']}")
    print(f"  Unchanged: {stats['unchanged']}")
    print(f"  Errors:    {stats['errors']}")
    print(f"  Total:     {sum(stats.values())}")
    
    # Count specific changes
    doc_type_renames = sum(1 for r in all_changes if any("document_type: abdominal" in c for c in r["changes"]))
    asklepios_updates = sum(1 for r in all_changes if any("asklepios_type:" in c for c in r["changes"]))
    fhir_additions = sum(1 for r in all_changes if any("added fhir_resource_type" in c for c in r["changes"]))
    
    print(f"\n  document_type renames:  {doc_type_renames}")
    print(f"  asklepios_type updates: {asklepios_updates}")
    print(f"  FHIR field additions:   {fhir_additions}")


if __name__ == "__main__":
    main()
