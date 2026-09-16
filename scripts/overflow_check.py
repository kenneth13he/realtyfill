# scripts/overflow_check.py
# Reports text that is written correctly and still prints wrong, because it is
# wider than the box holding it.
#
#   python scripts/overflow_check.py .fill-audit/e2e/*.pdf
#   python scripts/overflow_check.py .fill-audit/pdf/*.pdf --all
#
# Every text widget on these templates carries a FIXED font size (9pt — none
# of them use the /DA "0 Tf" auto-shrink), so a value that is one character
# too long does not shrink to fit. Depending on the viewer it either runs past
# the ruled line into the next column or is silently clipped, and the realtor
# hands a client a form with a chopped-off brokerage name. /MaxLen does not
# protect against this: it counts characters, and the boxes are measured in
# points — a 40-character limit in a 100pt box overflows on any string longer
# than about 22 characters in Helvetica, or 18 in Courier-Bold, which several
# of these fields use.
#
# The widths come from the font actually named in each widget's /DA, resolved
# through the AcroForm /DR font dictionary, not from an assumed Helvetica.

import glob
import pathlib
import re
import sys

import pymupdf
from pypdf import PdfReader

# Rendered text is inset from the widget edge by the border width plus a small
# pad. 2pt total is what Acrobat uses and what these forms were drawn against.
PADDING = 2.0
# Report only meaningful overruns, not a hairline.
TOLERANCE = 1.02

BASE14 = {
    "Helvetica": "helv", "Helvetica-Bold": "hebo", "Helvetica-Oblique": "heit",
    "Times-Roman": "tiro", "Times-Bold": "tibo", "Courier": "cour",
    "Courier-Bold": "cobo", "Courier-Oblique": "coit", "ZapfDingbats": "zadb",
}


def font_map(reader: PdfReader) -> dict:
    """/DA font resource name -> a PyMuPDF base-14 name."""
    out = {}
    try:
        acro = reader.trailer["/Root"]["/AcroForm"].get_object()
        fonts = (acro.get("/DR") or {}).get("/Font")
    except Exception:
        return out
    if not fonts:
        return out
    for key, ref in fonts.items():
        try:
            base = str(ref.get_object().get("/BaseFont") or "").lstrip("/")
        except Exception:
            continue
        out[str(key).lstrip("/")] = BASE14.get(base, "helv")
    return out


def inherited(widget, key):
    node = widget
    while node is not None:
        if key in node:
            return node[key]
        parent = node.get("/Parent")
        node = parent.get_object() if parent else None
    return None


def full_name(widget) -> str:
    parts, node = [], widget
    while node is not None:
        t = node.get("/T")
        if t:
            parts.append(str(t))
        parent = node.get("/Parent")
        node = parent.get_object() if parent else None
    return ".".join(reversed(parts))


def check(path: str, show_all: bool):
    reader = PdfReader(path)
    fonts = font_map(reader)
    findings = []
    checked = 0

    for pno, page in enumerate(reader.pages, start=1):
        for a in page.get("/Annots") or []:
            w = a.get_object()
            if w.get("/Subtype") != "/Widget":
                continue
            if inherited(w, "/FT") != "/Tx":
                continue
            value = inherited(w, "/V")
            if value is None or not str(value).strip():
                continue
            text = str(value)

            da = str(inherited(w, "/DA") or "")
            m = re.search(r"/([^\s/]+)\s+([\d.]+)\s+Tf", da)
            size = float(m.group(2)) if m else 9.0
            if size == 0:
                continue  # auto-shrink: the viewer fits it, by definition
            font = fonts.get(m.group(1), "helv") if m else "helv"

            rect = [float(x) for x in w["/Rect"]]
            box_w = abs(rect[2] - rect[0]) - PADDING
            box_h = abs(rect[3] - rect[1])
            flags = int(inherited(w, "/Ff") or 0)
            multiline = bool(flags & 4096)
            comb = bool(flags & 16777216)
            checked += 1

            if comb:
                # A comb field distributes characters into fixed cells; the
                # only way to overflow it is to exceed /MaxLen, which the
                # writer already enforces.
                continue

            if multiline:
                # Wrapping makes width irrelevant; height is the constraint.
                per_line = max(1, int(box_w / (pymupdf.get_text_length("n", font, size) or 1)))
                lines = sum(max(1, -(-len(seg) // per_line)) for seg in text.split("\n"))
                needed = lines * size * 1.15
                if needed > box_h * TOLERANCE:
                    findings.append((pno, full_name(w), f"{lines} lines need {needed:.0f}pt, box is {box_h:.0f}pt", text))
                continue

            width = pymupdf.get_text_length(text, font, size)
            if width > box_w * TOLERANCE:
                over = width / box_w
                findings.append((pno, full_name(w), f"{width:.0f}pt of text in a {box_w:.0f}pt box ({over:.1f}x, {font} {size:g}pt)", text))

    return checked, findings


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show_all = "--all" in sys.argv
    files = []
    for a in args:
        files.extend(sorted(glob.glob(a)))
    if not files:
        print("usage: python scripts/overflow_check.py <pdf glob> [--all]")
        return 2

    total_checked = 0
    total_bad = 0
    for f in files:
        checked, findings = check(f, show_all)
        total_checked += checked
        total_bad += len(findings)
        if findings:
            print(f"\n{pathlib.Path(f).name}  ({len(findings)} of {checked} filled boxes overflow)")
            for pno, name, why, text in findings:
                shown = text if len(text) <= 60 else text[:57] + "..."
                print(f"   p{pno} {name:32} {why}")
                print(f"        {shown!r}")

    print(f"\n{total_checked} filled boxes measured across {len(files)} file(s); {total_bad} overflow.")
    return 1 if total_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
