# CLI wrapper around the fill logic in ../pdf-service/fill_fillable_fields.py.
#
# There is exactly one copy of the fill/validation logic, and it lives in
# pdf-service/ rather than here. That direction is forced by Vercel: that
# service is deployed with `root: pdf-service/` (see ../vercel.json), so it
# can only import files inside its own directory — it cannot reach up into
# scripts/. This file can reach down, so this is the only arrangement where
# the logic isn't duplicated.
#
# This wrapper exists because lib/pdfFill.ts's subprocess mode (local
# `npm run dev`, and the Render/Docker path) invokes a CLI taking file paths,
# while the service needs bytes in / bytes out. Only the I/O shape differs.

import json
import sys
from pathlib import Path

# pdf-service/ is a sibling directory, not a package — it is deployed as its
# own root, so it has no __init__.py and can't be imported as one.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pdf-service"))

from fill_fillable_fields import (  # noqa: E402
    FillValidationError,
    fill_pdf_bytes,
    get_field_info,
    monkeypatch_pypdf_method,
    validation_error_for_field_value,
)

# Re-exported so the names stay importable from this module, which is where
# they used to live.
__all__ = [
    "FillValidationError",
    "fill_pdf_bytes",
    "fill_pdf_fields",
    "get_field_info",
    "monkeypatch_pypdf_method",
    "validation_error_for_field_value",
]


def fill_pdf_fields(input_pdf_path: str, fields_json_path: str, output_pdf_path: str):
    # encoding="utf-8" is not optional here. lib/pdfFill.ts writes this file
    # with Node's fs.writeFile, which is UTF-8; Python's open() without an
    # encoding uses the platform default, which on Windows is cp1252. Every
    # accented character therefore came back double-encoded, and a tenant
    # named Côté was printed on the lease as CÃ´tÃ©. The value in Postgres was
    # correct the whole time, so nothing upstream could see it — it only
    # existed in the local-dev and Docker fill paths, because Vercel's service
    # mode hands FastAPI a string that is already decoded.
    with open(fields_json_path, encoding="utf-8") as f:
        fields = json.load(f)

    pdf_bytes = Path(input_pdf_path).read_bytes()
    filled = fill_pdf_bytes(pdf_bytes, fields)
    Path(output_pdf_path).write_bytes(filled)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: fill_fillable_fields.py [input pdf] [field_values.json] [output pdf]")
        sys.exit(1)
    try:
        fill_pdf_fields(sys.argv[1], sys.argv[2], sys.argv[3])
    except FillValidationError as e:
        # stderr, not stdout: lib/pdfFill.ts's subprocess mode surfaces only
        # stderr in the error it raises, so printing these to stdout (as this
        # script used to) meant a validation failure reached the API as a bare
        # "Command failed" with no indication of which field was wrong.
        for err in e.errors:
            print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)
