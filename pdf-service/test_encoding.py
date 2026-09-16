# pdf-service/test_encoding.py
# A tenant named Côté must be printed on the lease as Côté.
#
# This is a whole test file because the bug it guards had no symptom anywhere
# a normal check would look. lib/pdfFill.ts's subprocess mode writes the field
# list with Node's fs.writeFile (UTF-8) and scripts/fill_fillable_fields.py
# read it back with a bare open(), which uses the platform default — cp1252 on
# Windows. The value in Postgres stayed correct, the fill reported success, the
# PDF's own /V round-tripped against itself, and the only place the damage was
# visible was the rendered page: "MarÃ­a CÃ´tÃ©".
#
# Ontario names carry accents constantly — Côté, Müller, Nguyễn, Étienne,
# O'Brien — so this is not an edge case, it is most of a working day.
#
# Run: python -m unittest discover -s pdf-service -p "test_*.py"

import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from pypdf import PdfReader

from fill_fillable_fields import fill_pdf_bytes

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "forms" / "blank_templates" / "purchase_buyer_condo" / "form_303_blank.pdf"
FIELD = "txts_broker"

# Accents, a ligature-prone diacritic, an apostrophe and a combining form.
NAMES = ["María Côté", "Jean-Luc Björnsson", "Nguyễn Rajagopalan", "O'Brien & Fitzgerald-Ng"]


def value_of(pdf_bytes: bytes, field: str):
    return (PdfReader(io.BytesIO(pdf_bytes)).get_fields() or {}).get(field, {}).get("/V")


class InMemoryFillTest(unittest.TestCase):
    def test_accented_names_survive_the_fill(self):
        blank = TEMPLATE.read_bytes()
        for name in NAMES:
            with self.subTest(name=name):
                out = fill_pdf_bytes(blank, [{"field_id": FIELD, "page": 1, "value": name}])
                self.assertEqual(value_of(out, FIELD), name)


class SubprocessFillTest(unittest.TestCase):
    """The CLI path lib/pdfFill.ts uses for local dev and the Docker image.

    Goes through a real JSON file on disk, which is where the encoding was
    lost — asserting on fill_pdf_bytes alone would never have caught it.
    """

    def test_accented_names_survive_the_json_file_handoff(self):
        script = ROOT / "scripts" / "fill_fillable_fields.py"
        for name in NAMES:
            with self.subTest(name=name):
                with tempfile.TemporaryDirectory() as d:
                    fields = pathlib.Path(d) / "fields.json"
                    out = pathlib.Path(d) / "out.pdf"
                    # ensure_ascii=False matters as much as the encode does.
                    # JavaScript's JSON.stringify writes "Côté" as literal
                    # UTF-8 bytes, while Python's json.dumps defaults to
                    # escaping it as "Côté" — which is pure ASCII
                    # and survives any encoding, so a fixture built the Python
                    # way reproduces nothing. The first version of this test
                    # passed against the unfixed code for exactly that reason.
                    fields.write_bytes(
                        json.dumps(
                            [{"field_id": FIELD, "page": 1, "value": name}], ensure_ascii=False
                        ).encode("utf-8")
                    )
                    r = subprocess.run(
                        [sys.executable, str(script), str(TEMPLATE), str(fields), str(out)],
                        capture_output=True, text=True,
                    )
                    self.assertEqual(r.returncode, 0, r.stderr)
                    self.assertEqual(value_of(out.read_bytes(), FIELD), name)


if __name__ == "__main__":
    unittest.main()
