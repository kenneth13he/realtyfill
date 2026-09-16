# scripts/caption_check.py
# Reads the caption the form itself prints beside each box we fill, and lines
# it up against the intake question feeding it.
#
#   python scripts/caption_check.py                 # flagged only
#   python scripts/caption_check.py --all           # every mapping
#   python scripts/caption_check.py --form form_101
#
# Why this exists: a field id is not evidence of what a box means. Form 101
# names its Unit Number box txtbuildnum and its Building No. box txtp_apartno,
# the other way round. Form 291 names its DIRECTIONS box txtcrossstrts while
# the cross-streets box is txtmaincs. Form 410's From/To date boxes were being
# filled with an address. Every one of those generated cleanly.
#
# The caption is the one thing on the page that says what a box is for, so
# this pulls it out of the PDF and puts it next to the question we aim at it.
# The score is a word-overlap hint for sorting, nothing more — the output is
# meant to be read, and a low score is a prompt to look, not a verdict.

import argparse
import json
import pathlib
import re

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Words that carry no meaning for matching a question to a caption.
STOP = {
    "the", "a", "an", "of", "for", "to", "and", "or", "in", "on", "at", "by",
    "no", "not", "this", "that", "if", "any", "all", "is", "are", "be", "s",
    "name", "names", "full", "legal", "please", "print", "check", "one",
    "characters", "tel", "fax", "number", "no.", "date", "yes",
}


def words(text: str) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if w not in STOP and len(w) > 1}


def template_for(form_id: str) -> pathlib.Path:
    base = ROOT / "forms" / "blank_templates"
    hits = list(base.rglob(f"{form_id}_blank.pdf"))
    if not hits:
        raise FileNotFoundError(form_id)
    return hits[0]


def caption_near(page, rect) -> str:
    """The printed text most likely to be this box's label.

    These forms use three conventions and all three appear on the same page:
    OREA puts the caption to the LEFT on the same line ("Unit Number ......"),
    or BELOW in small italics ("(Full legal names of all Buyers)"); PropTx's
    data forms put it ABOVE in a coloured banner. Candidates from all three
    are scored by distance and the nearest wins.
    """
    H = page.rect.height
    x0, y0, x1, y1 = rect
    top, bottom = H - y1, H - y0          # PDF origin is bottom-left, PyMuPDF's is top-left
    mid = (top + bottom) / 2
    height = max(bottom - top, 8)

    best, best_cost = "", 1e9
    for wx0, wy0, wx1, wy1, text, *_ in page.get_text("words"):
        wmid = (wy0 + wy1) / 2
        if wx1 <= x0 + 1 and abs(wmid - mid) < height * 0.8:
            cost = (x0 - wx1) * 0.5                      # left, same line
        elif wy0 >= bottom - 1 and wy0 - bottom < height * 1.6 and wx0 < x1 and wx1 > x0:
            cost = (wy0 - bottom) + 4                    # just below
        elif wy1 <= top + 1 and top - wy1 < height * 1.6 and wx0 < x1 and wx1 > x0:
            cost = (top - wy1) + 2                       # just above (PropTx banner)
        else:
            continue
        if cost < best_cost:
            best_cost, best = cost, (wx0, wy0, wx1, wy1)

    if not best:
        return ""
    # Take the whole run of words on that line near the winner, not one word.
    bx0, by0, bx1, by1 = best
    line = [w for w in page.get_text("words")
            if abs((w[1] + w[3]) / 2 - (by0 + by1) / 2) < 4 and w[0] >= bx0 - 170 and w[2] <= bx1 + 190]
    line.sort(key=lambda w: w[0])
    return " ".join(w[4] for w in line)[:90]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--form")
    ap.add_argument("--threshold", type=float, default=0.01)
    args = ap.parse_args()

    schema = json.loads((ROOT / "forms/schemas/intake_form_schema.json").read_text(encoding="utf-8"))
    labels, targets = {}, {}
    for g in schema["groups"]:
        for f in g["fields"]:
            labels[f["key"]] = f.get("label") or ""
            for form, ids in f["targets"].items():
                for i in ids:
                    targets.setdefault(form, []).append((i, f["key"]))

    flagged = 0
    for form in sorted(targets):
        if args.form and form != args.form:
            continue
        raw = {f["field_id"]: f for f in json.loads(
            (ROOT / f"forms/schemas/{form}_raw.json").read_text(encoding="utf-8"))}
        doc = pymupdf.open(template_for(form))
        rows = []
        for field_id, key in targets[form]:
            info = raw.get(field_id)
            if not info or not info.get("rect"):
                continue
            cap = caption_near(doc[info["page"] - 1], info["rect"])
            label = labels[key]
            lw, cw = words(label), words(cap)
            score = len(lw & cw) / len(lw) if lw else 1.0
            # A derived part has an empty label by design; judge it by its key.
            if not lw:
                score = 1.0 if words(key.replace("_", " ")) & cw else 0.0
            rows.append((score, field_id, key, label, cap, info["page"]))
        doc.close()

        show = [r for r in rows if args.all or r[0] <= args.threshold]
        if show:
            print(f"\n=== {form}  ({len(show)} of {len(rows)} shown)")
            for score, field_id, key, label, cap, page in sorted(show):
                print(f"  p{page} {field_id:26} <- {key}")
                print(f"       question: {label or '(derived)'}")
                print(f"       form says: {cap or '(no caption found)'}")
            flagged += len(show)

    print(f"\n{flagged} mapping(s) shown.")


if __name__ == "__main__":
    main()
