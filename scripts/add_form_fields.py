"""Add fillable AcroForm text fields to a flat (non-fillable) OREA PDF.

Why this exists
---------------
The lease-tenant templates came from WEBForms and already carry proper
AcroForm fields (`txtS_streetnum`, `hidband`, ...). The templates for the
other three form sets were downloaded as OREA's public copies, which are
flat: zero fillable fields, so `fill_fillable_fields.py` has nothing to
write into. This script synthesizes fields over the blanks so those forms
can be filled by the same pipeline.

How it finds the blanks
-----------------------
OREA forms lay out every blank as a run of dot leaders following a label:

    TENANT: ..................................................., and
    dated the ......... day of ......................., 20.........

So: extract every text chunk with its position, group chunks into lines by
baseline, and treat each predominantly-dot chunk as one blank. A field's
width comes from the dot run's own measured width (dot advance x count),
clamped so it never runs past the next chunk on the line or the right
margin — that keeps mid-sentence blanks ("day of ...") from overlapping the
words after them.

Field names come from the nearest preceding text on the line, slugified,
which makes them self-documenting when mapping intake answers later
(`p1_tenant_1` rather than an opaque index).

VERIFY BEFORE TRUSTING
----------------------
These coordinates are inferred, not authoritative. A field nudged onto the
wrong line puts the wrong value on a legal document. Always run with
--verify to produce a PDF with each box filled with its own field name, and
eyeball it against the blank form before mapping anything to it.
"""

import argparse
import json
import re
import sys
from collections import defaultdict

import pymupdf  # build-time only: detection. Not used by the fill pipeline.
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

# Shortest dot run treated as a blank. Three keeps real blanks while
# ignoring ellipses in prose.
MIN_DOTS = 3
# Fallback dot advance when a font has no usable /Widths ('.' = 308/1000 em
# in the FuturaStd faces these forms embed).
DOT_ADVANCE = 0.308
# Field box, relative to the text baseline the dots sit on.
BOX_BELOW, BOX_ABOVE = 3.0, 9.0
MIN_WIDTH = 8.0


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"^_+|_+$", "", text)[:40]


def find_blanks_mupdf(mu_page, page_number):
    """Locate every dot-leader blank on one page as a field spec.

    Uses PyMuPDF's per-character boxes rather than computing advances from
    font metrics. An earlier version did the latter and mispositioned any
    blank on a line with a wide internal gap: OREA builds those gaps with
    kerning adjustments inside a single text-showing operation, so walking
    characters and summing widths drifts from where the glyphs actually
    land. On Form 101 that put the purchase-price field several inches left
    of the purchase-price blank. Per-character boxes come straight from the
    rendered layout, so there is nothing to drift.

    Coordinates are converted to PDF space (origin bottom-left) because that
    is what widget /Rect uses; PyMuPDF reports top-left origin.
    """
    height = mu_page.rect.height
    blanks = []

    for block in mu_page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            chars = [c for span in line.get("spans", []) for c in span.get("chars", [])]
            if not chars:
                continue
            size = max((s.get("size", 8.0) for s in line.get("spans", [])), default=8.0)

            i = 0
            while i < len(chars):
                if chars[i]["c"] != ".":
                    i += 1
                    continue
                start = i
                while i < len(chars) and chars[i]["c"] == ".":
                    i += 1
                if i - start < MIN_DOTS:
                    continue

                run = chars[start:i]
                x_start = min(c["bbox"][0] for c in run)
                x_end = max(c["bbox"][2] for c in run)
                baseline = height - run[0]["origin"][1]
                if x_end - x_start < MIN_WIDTH:
                    continue

                label = "".join(c["c"] for c in chars[:start]).strip().strip(".,:")
                blanks.append(
                    {
                        "page": page_number,
                        "label_hint": label[-60:],
                        "slug": slugify(label.split("  ")[-1][-40:]) or "cont",
                        "rect": [
                            round(x_start, 1),
                            round(baseline - BOX_BELOW, 1),
                            round(x_end, 1),
                            round(baseline + BOX_ABOVE, 1),
                        ],
                        "size": round(size, 1),
                        "_sort": (-round(baseline, 1), round(x_start, 1)),
                    }
                )

    blanks.sort(key=lambda b: b["_sort"])
    for b in blanks:
        del b["_sort"]
    return blanks


def name_blanks(blanks):
    """Assign unique field ids: p<page>_<slug>[_<n>]."""
    counts = defaultdict(int)
    for b in blanks:
        base = f"p{b['page']}_{b['slug']}"
        counts[base] += 1
        b["field_id"] = base if counts[base] == 1 else f"{base}_{counts[base]}"
    return blanks


def build_widget(blank, page_ref):
    w = DictionaryObject()
    w.update(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject("/Tx"),
            NameObject("/T"): TextStringObject(blank["field_id"]),
            NameObject("/V"): TextStringObject(""),
            NameObject("/Ff"): NumberObject(0),
            NameObject("/F"): NumberObject(4),  # printable
            NameObject("/Rect"): ArrayObject([FloatObject(v) for v in blank["rect"]]),
            NameObject("/DA"): TextStringObject(f"/Helv {min(blank['size'], 9.0)} Tf 0 g"),
            NameObject("/P"): page_ref,
        }
    )
    return w


def add_fields(input_pdf, output_pdf, verify_pdf=None):
    reader = PdfReader(input_pdf)
    if reader.get_fields():
        sys.exit(f"{input_pdf} already has form fields — refusing to touch it.")

    mu_doc = pymupdf.open(input_pdf)
    blanks = []
    for i, mu_page in enumerate(mu_doc, start=1):
        blanks.extend(find_blanks_mupdf(mu_page, i))
    mu_doc.close()
    name_blanks(blanks)
    if not blanks:
        sys.exit(f"No dot-leader blanks found in {input_pdf}.")

    writer = PdfWriter(clone_from=reader)
    field_refs = ArrayObject()
    for blank in blanks:
        page = writer.pages[blank["page"] - 1]
        widget = build_widget(blank, page.indirect_reference)
        ref = writer._add_object(widget)
        page.setdefault(NameObject("/Annots"), ArrayObject()).append(ref)
        field_refs.append(ref)

    # Helv in /DR so viewers have a font to render values with; NeedAppearances
    # so they generate the appearance streams themselves (same assumption
    # fill_fillable_fields.py already relies on).
    helv = DictionaryObject()
    helv.update(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
            NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
        }
    )
    fonts = DictionaryObject({NameObject("/Helv"): writer._add_object(helv)})
    acro = DictionaryObject()
    acro.update(
        {
            NameObject("/Fields"): field_refs,
            NameObject("/DR"): DictionaryObject({NameObject("/Font"): fonts}),
            NameObject("/DA"): TextStringObject("/Helv 9 Tf 0 g"),
            NameObject("/NeedAppearances"): NameObject("/true"),
        }
    )
    writer._root_object[NameObject("/AcroForm")] = writer._add_object(acro)

    with open(output_pdf, "wb") as f:
        writer.write(f)

    if verify_pdf:
        vr = PdfReader(output_pdf)
        vw = PdfWriter(clone_from=vr)
        by_page = defaultdict(dict)
        for b in blanks:
            by_page[b["page"]][b["field_id"]] = b["field_id"]
        for page_no, values in by_page.items():
            vw.update_page_form_field_values(vw.pages[page_no - 1], values, auto_regenerate=False)
        vw.set_need_appearances_writer(True)
        with open(verify_pdf, "wb") as f:
            vw.write(f)

    return blanks


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input_pdf")
    ap.add_argument("output_pdf")
    ap.add_argument("--verify", help="also write a copy with each box filled with its field name")
    ap.add_argument("--json", help="write the detected field list here")
    args = ap.parse_args()

    blanks = add_fields(args.input_pdf, args.output_pdf, args.verify)
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(
                [{"field_id": b["field_id"], "type": "text", "page": b["page"], "rect": b["rect"],
                  "label_hint": b["label_hint"]} for b in blanks],
                f,
                indent=2,
            )
    print(f"{args.input_pdf}: added {len(blanks)} fields across {blanks[-1]['page']} page(s)")
    for b in blanks[:200]:
        print(f"  p{b['page']:>2}  {b['field_id']:<44} {b['rect']}  <- {b['label_hint']!r}")


if __name__ == "__main__":
    main()
