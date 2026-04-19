---
name: docling
description: Parse PDFs, DOCX, PPTX, HTML, and scanned images with layout, tables, and OCR preserved. Use for credit applications, bank statements, financial statements, court documents — anything where structure matters.
---

# docling — Structured Document Parsing

Wraps IBM's Docling library as the `docling-parse` CLI inside agent containers.
Outputs Markdown (with real tables) or full DoclingDocument JSON.

## When to use

- PDFs with **tables** (bank statements, financial statements, rates notices)
- PDFs with **forms** (credit applications, ID docs)
- **Scanned** PDFs or **images** (JPG/PNG of docs) — uses OCR
- **Multi-column** layouts (court filings, legal notices)
- Any doc where `pdftotext` gives you a mangled wall of text

## When NOT to use

- Simple text-only PDFs where speed matters — use `pdf-reader extract` instead
  (instant vs ~seconds/page with docling)
- Documents you've already parsed — check MemPalace first

## Usage

```bash
docling-parse invoice.pdf                   # Markdown with tables
docling-parse statement.pdf --format json   # Full structure tree
docling-parse scanned.jpg --ocr on          # Force OCR on image
docling-parse https://example.com/doc.pdf   # Works with URLs too
```

Run `docling-parse help` for full options.

## Output format

**Markdown (default)**: headings, paragraphs, and tables rendered as
GitHub-flavored Markdown tables. Ideal for feeding back into the agent
context or storing in MemPalace drawers.

**JSON** (`--format json`): the full `DoclingDocument` tree with bounding
boxes, reading order, and element types. Use when you need to reference
specific regions of the source document or build a knowledge graph.

## Performance

First call on a fresh container downloads ML models (~500MB) — but the
container image has them pre-baked, so cold-start is only ~1–2s per call
(model load), plus ~1–3s per page of actual parsing.
