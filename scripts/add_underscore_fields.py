# scripts/add_underscore_fields.py
# Add AcroForm text fields over UNDERSCORE blanks — "Schedule ______".
#
# The third blank-detection shape, after add_form_fields.py (OREA's dot
# leaders) and add_box_fields.py (RECO's filled rectangles). Each of the three
# schedule forms prints its heading as "Schedule ______", which is a run of
# literal underscore characters rather than dots or a drawn box, so neither
# existing detector saw it. The result was a schedule that generated with a
# nameless heading — the realtor has to write "A" or "B" in by hand, on a
# document whose whole purpose is being attached to and identified by another
# agreement.
#
# Unlike the other two, this one runs on PDFs that ALREADY have fields: 401,
# 203 and 303 got their dot-leader fields from add_form_fields.py in an
# earlier pass, so this has to add to an existing /AcroForm rather than
# create one. That is the only structural difference.
#
#   python scripts/add_underscore_fields.py in.pdf out.pdf
#   python scripts/add_underscore_fields.py in.pdf out.pdf --verify
#
# Positions are INFERRED, like the other two. --verify fills each new field
# with its own name so the placement can be read off a render.

import argparse
import sys
from collections import defaultdict

import pymupdf  # build-time only: detection. Not used by the fill pipeline.
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    BooleanObject,
    DictionaryObject,
    FloatObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

# Two underscores could be punctuation; three or more is a blank someone is
# meant to write in.
MIN_RUN = 3


def slugify(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40] or "blank"


def find_underscore_blanks(page, page_number: int):
    """@returns [{field_id, page, rect}] for each underscore run on the page."""
    height = page.rect.height
    found = []
    counts = defaultdict(int)

    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            chars = [c for span in line.get("spans", []) for c in span.get("chars", [])]
            if not chars:
                continue

            i = 0
            while i < len(chars):
                if chars[i]["c"] != "_":
                    i += 1
                    continue
                start = i
                while i < len(chars) and chars[i]["c"] == "_":
                    i += 1
                run = chars[start:i]
                if len(run) < MIN_RUN:
                    continue

                # Name from the text before the run, which is the caption:
                # "Schedule ______" -> p1_schedule.
                label = "".join(c["c"] for c in chars[:start]).strip().strip(".,:_")
                base = f"p{page_number}_{slugify(label)}"
                counts[base] += 1
                name = base if counts[base] == 1 else f"{base}_{counts[base]}"

                x0 = min(c["bbox"][0] for c in run)
                x1 = max(c["bbox"][2] for c in run)
                top = min(c["bbox"][1] for c in run)
                bottom = max(c["bbox"][3] for c in run)

                found.append({
                    "field_id": name,
                    "page": page_number,
                    "label": label,
                    # PyMuPDF is top-left origin, AcroForm /Rect is bottom-left.
                    # Sit the box just above the underscore rule so typed text
                    # rests on the line rather than striking through it.
                    "rect": [round(x0, 2), round(height - bottom - 1, 2),
                             round(x1, 2), round(height - top + 3, 2)],
                })
    return found


def add_fields(input_pdf: str, output_pdf: str, verify: bool = False):
    reader = PdfReader(input_pdf)
    existing = reader.get_fields() or {}

    doc = pymupdf.open(input_pdf)
    blanks = []
    for i, page in enumerate(doc, start=1):
        blanks.extend(find_underscore_blanks(page, i))
    doc.close()

    # Adding a field that already exists would produce two widgets with one
    # name, which fill silently in lockstep and are miserable to debug.
    blanks = [b for b in blanks if b["field_id"] not in existing]
    if not blanks:
        sys.exit(f"No new underscore blanks found in {input_pdf}.")

    writer = PdfWriter(clone_from=reader)
    new_refs = []

    for field in blanks:
        widget = DictionaryObject()
        widget.update({
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Widget"),
            NameObject("/FT"): NameObject("/Tx"),
            NameObject("/T"): TextStringObject(field["field_id"]),
            NameObject("/V"): TextStringObject(field["field_id"] if verify else ""),
            NameObject("/Ff"): NumberObject(0),
            NameObject("/DA"): TextStringObject("/Helv 11 Tf 0 g"),
            NameObject("/Rect"): ArrayObject([FloatObject(v) for v in field["rect"]]),
            NameObject("/F"): NumberObject(4),
        })
        ref = writer._add_object(widget)
        page_obj = writer.pages[field["page"] - 1]
        widget[NameObject("/P")] = page_obj.indirect_reference
        page_obj[NameObject("/Annots")] = ArrayObject(list(page_obj.get("/Annots") or []) + [ref])
        new_refs.append(ref)

    # Append to the existing /AcroForm rather than replacing it — these PDFs
    # already carry fields from add_form_fields.py.
    # get_object(): /AcroForm is stored as an indirect reference, and the
    # reference itself isn't subscriptable — only the object it points at is.
    acro = writer._root_object.get("/AcroForm")
    if acro is not None:
        acro = acro.get_object()
    if acro is None:
        acro = DictionaryObject()
        acro.update({NameObject("/Fields"): ArrayObject(), NameObject("/DR"): DictionaryObject()})
        writer._root_object[NameObject("/AcroForm")] = writer._add_object(acro)
        acro = writer._root_object["/AcroForm"].get_object()
    acro[NameObject("/Fields")] = ArrayObject(list(acro.get("/Fields") or []) + new_refs)
    acro[NameObject("/NeedAppearances")] = BooleanObject(True)
    writer.set_need_appearances_writer(True)

    with open(output_pdf, "wb") as f:
        writer.write(f)
    return blanks


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input_pdf")
    ap.add_argument("output_pdf")
    ap.add_argument("--verify", action="store_true", help="prefill each new field with its own name")
    args = ap.parse_args()

    added = add_fields(args.input_pdf, args.output_pdf, verify=args.verify)
    print(f"Added {len(added)} field(s) to {args.output_pdf}")
    for f in added:
        print(f"  {f['field_id']:32} page {f['page']}  rect {f['rect']}")


if __name__ == "__main__":
    main()
