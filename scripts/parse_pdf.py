#!/usr/bin/env python3
"""Convert one local or remote PDF to Docling's structure-preserving Markdown.

The TypeScript ingestion process invokes this script as a subprocess so the
Next.js query runtime does not need Python, OCR models, or Docling installed.
Only JSON is emitted on stdout; conversion diagnostics stay on stderr.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: parse_pdf.py <local-path-or-url>", file=sys.stderr)
        return 2

    try:
        from docling.document_converter import DocumentConverter
    except ImportError:
        print(
            "Docling is not installed. Run: python -m pip install -r scripts/requirements-docling.txt",
            file=sys.stderr,
        )
        return 3

    try:
        result = DocumentConverter().convert(sys.argv[1])
        markdown = result.document.export_to_markdown()
        print(json.dumps({"markdown": markdown}, ensure_ascii=False))
        return 0
    except Exception as error:  # Docling reports different conversion exceptions by backend.
        print(f"Docling conversion error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
