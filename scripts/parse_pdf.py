#!/usr/bin/env python3
"""Convert local or remote PDFs to Docling's structure-preserving Markdown.

The TypeScript ingestion process invokes this script as a subprocess so the
Next.js query runtime does not need Python, OCR models, or Docling installed.
Only JSON is emitted on stdout; conversion diagnostics stay on stderr.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import time
import unicodedata

# Windows can otherwise select a legacy console encoding (for example cp1252)
# even though the Node parent reads stdout as UTF-8. Markdown from technical
# PDFs regularly contains mathematical symbols outside that code page.
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert PDFs with one reusable Docling pipeline.")
    parser.add_argument("sources", nargs="+", help="Local PDF paths or PDF URLs")
    parser.add_argument("--page-range", help="Optional inclusive page range, for example 1-3")
    parser.add_argument("--output-dir", help="Persist Markdown, Docling JSON, and quality reports under this directory")
    arguments = parser.parse_args()

    try:
        from docling.document_converter import DocumentConverter
    except ImportError:
        print(
            "Docling is not installed. Run: python -m pip install -r scripts/requirements-docling.txt",
            file=sys.stderr,
        )
        return 3

    # One converter instance is intentionally shared by the entire batch. PDF
    # pipeline/model initialization is expensive, so spawning a new converter
    # for every file makes a corpus ingestion unnecessarily slow and opaque.
    print(f"[docling] initializing converter for {len(arguments.sources)} PDF(s)", file=sys.stderr, flush=True)
    converter = DocumentConverter()
    documents = []
    page_range = parse_page_range(arguments.page_range)

    for source in arguments.sources:
        started_at = time.monotonic()
        print(f"[docling] converting {source}", file=sys.stderr, flush=True)
        try:
            result = converter.convert(source, **({"page_range": page_range} if page_range else {}))
            document = result.document
            markdown = document.export_to_markdown()
            elapsed_ms = round((time.monotonic() - started_at) * 1000)
            quality = build_quality_report(document, markdown, source, elapsed_ms, page_range)
            normalized = build_normalized_document(document, source, quality)
            summary = {
                "source": source,
                "pageCount": len(document.pages),
                "elapsedMs": elapsed_ms,
                "qualityStatus": quality["status"],
                "qualityIssueCount": len(quality["issues"]),
            }

            if arguments.output_dir:
                summary["artifactDirectory"] = persist_artifacts(
                    Path(arguments.output_dir), source, document, markdown, quality, normalized
                )
            else:
                summary["markdown"] = markdown

            documents.append(summary)
            print(f"[docling] converted {source}", file=sys.stderr, flush=True)
        except Exception as error:  # Docling reports different conversion exceptions by backend.
            print(f"[docling] conversion error for {source}: {error}", file=sys.stderr, flush=True)
            return 1

    print(json.dumps({"documents": documents}, ensure_ascii=False))
    return 0


def persist_artifacts(
    output_root: Path, source: str, document, markdown: str, quality: dict, normalized: dict
) -> str:
    artifact_directory = output_root / artifact_id(source)
    artifact_directory.mkdir(parents=True, exist_ok=True)
    (artifact_directory / "document.md").write_text(markdown, encoding="utf-8")
    (artifact_directory / "document.docling.json").write_text(
        json.dumps(document.export_to_dict(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (artifact_directory / "quality.json").write_text(
        json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (artifact_directory / "normalized.json").write_text(
        json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return str(artifact_directory.resolve())


def build_quality_report(document, markdown: str, source: str, elapsed_ms: int, page_range) -> dict:
    page_metrics = {
        int(page_number): {
            "pageNumber": int(page_number),
            "elementCount": 0,
            "characterCount": 0,
            "wordCount": 0,
            "headingCount": 0,
            "tableCount": 0,
            "pictureCount": 0,
            "replacementCharacterCount": 0,
            "controlCharacterCount": 0,
            "symbolRatio": 0.0,
            "headings": [],
            "issues": [],
        }
        for page_number in document.pages
    }
    page_text = {page_number: [] for page_number in page_metrics}

    for item, _level in document.iterate_items():
        provenance = getattr(item, "prov", None) or []
        if not provenance:
            continue
        page_number = int(provenance[0].page_no)
        if page_number not in page_metrics:
            continue

        metrics = page_metrics[page_number]
        item_type = type(item).__name__
        text = extract_item_text(item, document)
        metrics["elementCount"] += 1
        if item_type == "SectionHeaderItem":
            metrics["headingCount"] += 1
            if text:
                metrics["headings"].append(text[:300])
        elif item_type == "TableItem":
            metrics["tableCount"] += 1
        elif item_type == "PictureItem":
            metrics["pictureCount"] += 1
        if text:
            page_text[page_number].append(text)

    issues = []
    for page_number, metrics in page_metrics.items():
        text = "\n".join(page_text[page_number])
        metrics["characterCount"] = len(text)
        metrics["wordCount"] = len(text.split())
        metrics["replacementCharacterCount"] = text.count("�")
        metrics["controlCharacterCount"] = sum(
            1 for character in text if unicodedata.category(character) == "Cc" and character not in "\n\r\t"
        )
        symbol_count = sum(1 for character in text if unicodedata.category(character).startswith("S"))
        metrics["symbolRatio"] = round(symbol_count / max(len(text), 1), 4)

        if not text.strip():
            metrics["issues"].append("empty_text")
        if metrics["replacementCharacterCount"]:
            metrics["issues"].append("replacement_characters")
        if metrics["controlCharacterCount"]:
            metrics["issues"].append("control_characters")
        if len(text) >= 40 and metrics["symbolRatio"] > 0.12:
            metrics["issues"].append("high_symbol_ratio")
        for issue in metrics["issues"]:
            issues.append({"pageNumber": page_number, "code": issue})

    return {
        "schemaVersion": 1,
        "source": source,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsedMs": elapsed_ms,
        "partial": page_range is not None,
        "pageRange": list(page_range) if page_range else None,
        "status": "review" if issues else "pass",
        "pageCount": len(page_metrics),
        "characterCount": len(markdown),
        "wordCount": len(markdown.split()),
        "headingCount": sum(page["headingCount"] for page in page_metrics.values()),
        "tableCount": len(document.tables),
        "pictureCount": len(document.pictures),
        "issues": issues,
        "pages": list(page_metrics.values()),
    }


def build_normalized_document(document, source: str, quality: dict) -> dict:
    sections = []
    current_heading = "Document"
    current_level = 1
    current_blocks = []
    current_pages = []

    def flush_section():
        if not current_blocks:
            return
        content = "\n\n".join(block for block in current_blocks if block).strip()
        if not content:
            return
        page_start = min(current_pages) if current_pages else None
        page_end = max(current_pages) if current_pages else None
        section_index = len(sections) + 1
        identifier = hashlib.sha1(
            f"{source}:{section_index}:{current_heading}:{page_start}:{page_end}".encode("utf-8")
        ).hexdigest()[:16]
        sections.append(
            {
                "id": identifier,
                "heading": current_heading,
                "headingLevel": current_level,
                "pageStart": page_start,
                "pageEnd": page_end,
                "content": content,
                "wordCount": len(content.split()),
                "characterCount": len(content),
            }
        )

    for item, level in document.iterate_items():
        provenance = getattr(item, "prov", None) or []
        page_number = int(provenance[0].page_no) if provenance else None
        item_type = type(item).__name__
        text = extract_item_text(item, document)
        if not text:
            continue

        if item_type == "SectionHeaderItem":
            flush_section()
            current_heading = text
            current_level = int(level or 1)
            current_blocks = [f"{'#' * min(max(current_level + 1, 2), 4)} {text}"]
            current_pages = [page_number] if page_number is not None else []
            continue

        current_blocks.append(text)
        if page_number is not None:
            current_pages.append(page_number)

    flush_section()
    return {
        "schemaVersion": 1,
        "source": source,
        "sourceType": "pdf",
        "generatedAt": quality["generatedAt"],
        "qualityStatus": quality["status"],
        "qualityIssues": quality["issues"],
        "partial": quality["partial"],
        "pageRange": quality["pageRange"],
        "pageCount": quality["pageCount"],
        "sections": sections,
    }


def extract_item_text(item, document) -> str:
    text = getattr(item, "text", "")
    if isinstance(text, str) and text.strip():
        return text.strip()

    exporter = getattr(item, "export_to_markdown", None)
    if callable(exporter):
        try:
            exported = exporter(doc=document)
            return exported.strip() if isinstance(exported, str) else ""
        except Exception:
            return ""
    return ""


def artifact_id(source: str) -> str:
    stem = Path(source.split("?", maxsplit=1)[0]).stem or "document"
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", stem).strip("-_").lower()


def parse_page_range(value: str | None):
    if not value:
        return None

    try:
        start, end = (int(part) for part in value.split("-", maxsplit=1))
    except ValueError as error:
        raise SystemExit("--page-range must use the inclusive format START-END, for example 1-3.") from error

    if start < 1 or end < start:
        raise SystemExit("--page-range must be positive and have END greater than or equal to START.")
    return (start, end)


if __name__ == "__main__":
    raise SystemExit(main())
