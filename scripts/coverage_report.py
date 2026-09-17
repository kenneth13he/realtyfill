# scripts/coverage_report.py
# After a full fill, lists every box on every form that is STILL blank, and
# sorts each one by why.
#
#   npx tsx scripts/e2e_fill_check.ts          # fill everything, real app
#   python scripts/coverage_report.py          # then read what's left
#   python scripts/coverage_report.py --form form_101 --all
#
# Every other check here asks "did the boxes we map get the right value?".
# This asks the opposite: with every question answered, which boxes on the
# page did nothing reach — and is that fine, or a question we never asked?
#
# A blank is only acceptable for a reason, and the reason is printed:
#   signature   signatures, initials, witnesses, seals — never filled, by rule
#   extra slot  a second/third party line when the first is filled
#               (tenant 3 of 5 when there are two tenants)
#   not chosen  an option in a pick-one list where a sibling was picked
#   internal    WEBForms bookkeeping that never prints
# Anything else is reported as a gap: an unanswered pick-one list, or a text
# box with no question behind it, with the caption the form prints beside it.

import argparse
import glob
import json
import pathlib
import re
import sys
from collections import defaultdict

import pymupdf
from pypdf import PdfReader

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from caption_check import caption_near  # noqa: E402

SIGNATURE = re.compile(r"sig(?!n?ed\b)|signature|initial|witness|seal", re.I)
SIGNATURE_CAPTION = re.compile(r"\((signature|seal|witness|initials?)|signature of|initials of", re.I)
INTERNAL = re.compile(r"^hid(DynamicPage|p_upload|inc_add|band|sand)", re.I)


def stem(field_id: str) -> tuple[str, int | None]:
    """txtbuyer2 -> ("txtbuyer", 2); chkOpt_ShowRequire3 -> ("chkOpt_ShowRequire", 3).

    The slot number is not always last: 2229E numbers its tenant boxes
    txtbuyer3LName and txtTenant5FName, so the number is taken from wherever
    the single digit run sits and removed from the stem around it.
    """
    m = re.match(r"^(.*?)(\d+)$", field_id) or re.match(r"^(.*?[a-zA-Z])(\d)([A-Z][A-Za-z]*)$", field_id)
    if not m:
        return (field_id, None)
    return (m.group(1) + (m.group(3) if m.lastindex == 3 else ""), int(m.group(2)))


def values_of(pdf: pathlib.Path) -> dict:
    out = {}
    for name, f in (PdfReader(str(pdf)).get_fields() or {}).items():
        v = f.get("/V")
        out[str(name)] = None if v is None or str(v) in ("", "/Off") else str(v)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(ROOT / ".fill-audit" / "e2e"))
    ap.add_argument("--form")
    ap.add_argument("--all", action="store_true", help="list acceptable blanks too")
    ap.add_argument("--json")
    args = ap.parse_args()

    templates = {p.name.replace("_blank.pdf", ""): p for p in (ROOT / "forms" / "blank_templates").rglob("*_blank.pdf")}
    report = {}

    for pdf in sorted(pathlib.Path(args.dir).glob("*__*.pdf")):
        set_id, form_id = pdf.stem.split("__")
        if args.form and form_id != args.form:
            continue
        raw = json.loads((ROOT / "forms" / "schemas" / f"{form_id}_raw.json").read_text(encoding="utf-8"))
        vals = values_of(pdf)
        doc = pymupdf.open(templates[form_id])

        filled_stems = defaultdict(set)
        for f in raw:
            if vals.get(f["field_id"]):
                s, n = stem(f["field_id"])
                filled_stems[s].add(n)

        rows = defaultdict(list)
        total = 0
        for f in raw:
            fid, ftype = f["field_id"], f["type"]
            total += 1
            if vals.get(fid):
                rows["filled"].append((fid, ""))
                continue

            rect = f.get("rect") or (f.get("radio_options") or [{}])[0].get("rect")
            page = doc[f["page"] - 1] if f.get("page") else None
            cap = caption_near(page, rect) if (page is not None and rect) else ""
            s, n = stem(fid)

            if SIGNATURE.search(fid) or SIGNATURE_CAPTION.search(cap or ""):
                rows["signature"].append((fid, cap))
            elif INTERNAL.search(fid) or (rect and (abs(rect[2] - rect[0]) < 2 or abs(rect[3] - rect[1]) < 2)):
                rows["internal"].append((fid, cap))
            elif ftype == "checkbox" and filled_stems.get(s):
                rows["not chosen"].append((fid, cap))
            elif n is not None and n >= 2 and (1 in filled_stems.get(s, set()) or None in filled_stems.get(s, set())):
                rows["extra slot"].append((fid, cap))
            elif ftype in ("radio_group", "checkbox", "choice"):
                rows["GAP: unanswered choice"].append((fid, cap))
            else:
                rows["GAP: no question"].append((fid, cap))
        doc.close()
        report[f"{set_id}/{form_id}"] = {k: v for k, v in rows.items()} | {"_total": total}

    order = ["filled", "signature", "extra slot", "not chosen", "internal", "GAP: unanswered choice", "GAP: no question"]
    print(f"{'form':28}{'boxes':>6}{'filled':>7}{'sign':>6}{'extra':>6}{'notch':>6}{'intern':>7}{'GAP ch':>7}{'GAP txt':>8}")
    for key, r in report.items():
        c = [len(r.get(k, [])) for k in order]
        print(f"{key:28}{r['_total']:>6}" + "".join(f"{x:>{w}}" for x, w in zip(c, (7, 6, 6, 6, 7, 7, 8))))

    for key, r in report.items():
        cats = order[1:] if args.all else order[-2:]
        shown = [(k, r.get(k, [])) for k in cats if r.get(k)]
        if not shown:
            continue
        print(f"\n=== {key}")
        for k, items in shown:
            print(f"  {k} ({len(items)})")
            for fid, cap in items:
                print(f"     {fid:30} {cap[:70]!r}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
