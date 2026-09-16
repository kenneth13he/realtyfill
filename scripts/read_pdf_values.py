# scripts/read_pdf_values.py
# Print one PDF's filled AcroForm values as JSON, for scripts that live on the
# TypeScript side and have no PDF reader of their own (scripts/e2e_fill_check.ts).
#
#   python scripts/read_pdf_values.py filled.pdf

import json
import sys

from pypdf import PdfReader


def values(path: str) -> dict:
    fields = PdfReader(path).get_fields() or {}
    out = {}
    for name, f in fields.items():
        v = f.get("/V")
        if v is None:
            continue
        out[str(name)] = str(v)
    return out


if __name__ == "__main__":
    # Escaped ASCII, written as bytes. sys.stdout on Windows is cp1252 unless
    # PYTHONIOENCODING says otherwise, and mojibake happens to be entirely
    # representable in cp1252 — so a corrupted value would round-trip through
    # this script without raising, and the caller comparing it would never see
    # the corruption it exists to detect.
    sys.stdout.buffer.write(json.dumps(values(sys.argv[1])).encode("utf-8"))
