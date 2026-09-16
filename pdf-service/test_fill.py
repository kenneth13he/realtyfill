# pdf-service/test_fill.py
# Covers the one copy of the fill logic (both deployment modes share it —
# see ../lib/pdfFill.ts). Plain unittest so there's no pytest dependency to
# install in the service image.
#
# Run: python -m unittest discover -s pdf-service -p "test_*.py"

import io
import json
import pathlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pypdf import PdfReader

from fill_fillable_fields import FillValidationError, fill_pdf_bytes

TEMPLATE = Path(__file__).resolve().parent.parent / "forms" / "blank_templates" / "purchase_buyer_condo" / "form_303_blank.pdf"


def values_in(pdf_bytes: bytes) -> dict:
    fields = PdfReader(io.BytesIO(pdf_bytes)).get_fields() or {}
    return {k: v.get("/V") for k, v in fields.items() if v.get("/V")}


class FillPdfBytesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blank = TEMPLATE.read_bytes()

    def test_writes_the_value_into_the_named_field(self):
        out = fill_pdf_bytes(self.blank, [{"field_id": "p1_brokerage", "page": 1, "value": "Acme Realty"}])
        self.assertEqual(values_in(out).get("p1_brokerage"), "Acme Realty")

    def test_leaves_untargeted_fields_empty(self):
        out = fill_pdf_bytes(self.blank, [{"field_id": "p1_brokerage", "page": 1, "value": "Acme Realty"}])
        self.assertEqual(list(values_in(out)), ["p1_brokerage"])

    def test_rejects_an_unknown_field_id(self):
        with self.assertRaises(FillValidationError) as ctx:
            fill_pdf_bytes(self.blank, [{"field_id": "no_such_field", "page": 1, "value": "x"}])
        self.assertIn("no_such_field", str(ctx.exception))

    def test_rejects_a_wrong_page_number(self):
        # A field id that exists but is claimed to be on the wrong page means
        # the caller's schema is out of step with the template.
        with self.assertRaises(FillValidationError) as ctx:
            fill_pdf_bytes(self.blank, [{"field_id": "p1_brokerage", "page": 99, "value": "x"}])
        self.assertIn("page", str(ctx.exception).lower())

    def test_reports_every_bad_field_not_just_the_first(self):
        with self.assertRaises(FillValidationError) as ctx:
            fill_pdf_bytes(self.blank, [
                {"field_id": "bogus_one", "page": 1, "value": "x"},
                {"field_id": "bogus_two", "page": 1, "value": "y"},
            ])
        self.assertEqual(len(ctx.exception.errors), 2)

    def test_output_is_a_readable_pdf(self):
        out = fill_pdf_bytes(self.blank, [{"field_id": "p1_brokerage", "page": 1, "value": "Acme"}])
        self.assertTrue(out.startswith(b"%PDF"))
        self.assertGreater(len(PdfReader(io.BytesIO(out)).pages), 0)


class ServiceEndpointTest(unittest.TestCase):
    """The HTTP shape lib/pdfFill.ts depends on in the Vercel deployment.

    Multipart in, application/pdf out. The previous base64-JSON shape broke
    generation for every form set in production once the 3.43 MB RECO guide
    was attached: encoded it came to 4.57 MB, over Vercel's 4.5 MB body cap.
    These assert the bytes stay bytes in both directions.
    """

    @classmethod
    def setUpClass(cls):
        try:
            from fastapi.testclient import TestClient
        except Exception as e:  # pragma: no cover - only when fastapi is absent
            raise unittest.SkipTest(f"fastapi not available: {e}")
        from main import app

        cls.client = TestClient(app)
        cls.blank = TEMPLATE.read_bytes()

    def post(self, fields, pdf=None):
        return self.client.post(
            "/fill",
            files={"pdf": ("blank.pdf", pdf if pdf is not None else self.blank, "application/pdf")},
            data={"fields": json.dumps(fields)},
        )

    def test_health(self):
        self.assertEqual(self.client.get("/health").json(), {"ok": True})

    def test_fill_returns_raw_pdf_not_base64(self):
        r = self.post([{"field_id": "p1_brokerage", "page": 1, "value": "Acme Realty"}])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "application/pdf")
        self.assertTrue(r.content.startswith(b"%PDF"))
        self.assertEqual(values_in(r.content).get("p1_brokerage"), "Acme Realty")

    def test_validation_error_is_422_with_details(self):
        r = self.post([{"field_id": "nope", "page": 1, "value": "x"}])
        self.assertEqual(r.status_code, 422)
        # lib/pdfFill.ts joins this list into its thrown error message.
        self.assertIsInstance(r.json()["detail"], list)

    def test_malformed_fields_is_400(self):
        r = self.client.post(
            "/fill",
            files={"pdf": ("blank.pdf", self.blank, "application/pdf")},
            data={"fields": "not json"},
        )
        self.assertEqual(r.status_code, 400)

    def test_the_largest_template_stays_under_vercels_body_cap(self):
        # The regression that caused the outage. RECO is the biggest template
        # attached to every set; raw it fits, base64 it does not.
        reco = pathlib.Path(__file__).resolve().parent.parent / "forms" / "blank_templates" / "shared" / "form_reco_blank.pdf"
        raw = reco.stat().st_size
        self.assertLess(raw, 4_500_000, "RECO no longer fits in a Vercel request body even raw")
        self.assertGreater(raw * 4 / 3, 4_500_000, "base64 would now fit — this guard can be revisited")

        r = self.post([{"field_id": "p13_real_estate_agent_name", "page": 13, "value": "Chris Luo"}],
                      pdf=reco.read_bytes())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(values_in(r.content).get("p13_real_estate_agent_name"), "Chris Luo")


class BlankOnlyFormTest(unittest.TestCase):
    """PropTx 291/292 have no AcroForm at all — they are delivered as blanks.

    Without handling, reader.get_fields() returns None (not {}) and the whole
    generate request for the sale-seller and lease-landlord sets died on
    `None.items()`. Caught by generating a real bundle, not by any unit test
    that existed at the time.
    """

    BLANKS = [
        pathlib.Path(__file__).resolve().parent.parent / "forms" / "blank_templates" / "sale_seller_condo" / "form_291_blank.pdf",
        pathlib.Path(__file__).resolve().parent.parent / "forms" / "blank_templates" / "lease_landlord_condo" / "form_292_blank.pdf",
    ]

    def test_a_field_less_pdf_passes_through_unchanged(self):
        for path in self.BLANKS:
            with self.subTest(form=path.name):
                original = path.read_bytes()
                self.assertEqual(fill_pdf_bytes(original, []), original)

    def test_a_field_less_pdf_rejects_a_field_it_does_not_have(self):
        for path in self.BLANKS:
            with self.subTest(form=path.name):
                with self.assertRaises(FillValidationError):
                    fill_pdf_bytes(path.read_bytes(), [{"field_id": "anything", "page": 1, "value": "x"}])


if __name__ == "__main__":
    unittest.main()
