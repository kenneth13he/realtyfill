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
    json.dump(values(sys.argv[1]), sys.stdout, ensure_ascii=False)
