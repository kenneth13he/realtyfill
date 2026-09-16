# scripts/fill_audit.py
# Half two of the offline fill audit. Reads what scripts/fill_audit.ts mapped,
# fills every form in every set for real, then reads each box back out of the
# produced PDF and checks the value that landed there is the one the intake
# key claiming that box was answered with.
#
# The point is the read-back. Every existing check stops at "the fill call
# didn't raise": mapIntakeToFormFields silently skips a target it can't place,
# pypdf silently truncates a value past the field's /MaxLen, and two intake
# keys pointing at one box silently fight. None of those raise. All of them
# produce a form that is wrong in a way only opening the PDF reveals.
#
# Runs entirely offline — no model call, no network, nothing billable.
#
#   python scripts/fill_audit.py [auditDir]

import io
import json
import pathlib
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "pdf-service"))

from pypdf import PdfReader

from fill_fillable_fields import FillValidationError, fill_pdf_bytes

ROOT = pathlib.Path(__file__).resolve().parent.parent
AUDIT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".fill-audit"


def template_path(template_dir: str, form_id: str) -> pathlib.Path:
    """Mirrors blankTemplateDir in lib/formTypes.ts.

    lease_tenant's templateDir is "", so its templates sit at the root of
    blank_templates rather than in a set folder.
    """
    p = ROOT / "forms" / "blank_templates" / template_dir / f"{form_id}_blank.pdf"
    if not p.exists():
        raise FileNotFoundError(f"no blank template at {p}")
    return p


def read_values(pdf_bytes: bytes) -> dict:
    fields = PdfReader(io.BytesIO(pdf_bytes)).get_fields() or {}
    out = {}
    for name, f in fields.items():
        v = f.get("/V")
        if v is None:
            continue
        out[name] = str(v)
    return out


def max_lengths(pdf_bytes: bytes) -> dict:
    """/MaxLen per field — pypdf truncates past it without raising."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    out = {}
    for page in reader.pages:
        for a in page.get("/Annots") or []:
            o = a.get_object()
            name = o.get("/T")
            ml = o.get("/MaxLen")
            if name and ml is not None:
                out[str(name)] = int(ml)
    return out


def main() -> int:
    data = json.loads((AUDIT / "targets.json").read_text(encoding="utf-8"))
    problems = defaultdict(list)
    stats = []

    for set_id, s in data["sets"].items():
        for form_id, f in s["forms"].items():
            targets = f["targets"]
            owner = f["owner"]
            types = f["types"]
            tdir = "shared" if form_id in data["sharedFormIds"] else s["templateDir"]
            tpl = template_path(tdir, form_id)
            blank = tpl.read_bytes()

            try:
                out = fill_pdf_bytes(blank, targets)
            except FillValidationError as e:
                for err in e.errors:
                    problems[f"{set_id}/{form_id}"].append(f"REJECTED: {err}")
                continue

            values = read_values(out)
            caps = max_lengths(blank)
            wrote = miss = trunc = 0

            # A value longer than the box's /MaxLen is stored intact by pypdf
            # and clipped by the reader, so the read-back below sees nothing
            # wrong. This is the only place it shows up. It is what printed
            # "On" in nine province boxes for as long as they had a default.
            for t in targets:
                cap = caps.get(t["field_id"])
                if cap is not None and len(t["value"]) > cap:
                    problems[f"{set_id}/{form_id}"].append(
                        f"CLIPPED: {t['field_id']} (from {owner.get(t['field_id'], '?')}) holds "
                        f"{cap} chars, got {len(t['value'])} — prints {t['value'][:cap]!r}"
                    )

            for t in targets:
                fid, expected = t["field_id"], t["value"]
                actual = values.get(fid)
                if actual is None or actual == "":
                    if expected != "":
                        problems[f"{set_id}/{form_id}"].append(
                            f"EMPTY: {fid} (from {owner.get(fid, '?')}) was filled with "
                            f"{expected!r} but reads back blank"
                        )
                        miss += 1
                    continue
                if actual != expected:
                    cap = caps.get(fid)
                    if cap is not None and len(expected) > cap and actual == expected[:cap]:
                        problems[f"{set_id}/{form_id}"].append(
                            f"TRUNCATED: {fid} (from {owner.get(fid, '?')}) holds {cap} chars, "
                            f"got {len(expected)} — {expected!r} -> {actual!r}"
                        )
                        trunc += 1
                    else:
                        problems[f"{set_id}/{form_id}"].append(
                            f"WRONG: {fid} (from {owner.get(fid, '?')}) expected {expected!r}, read {actual!r}"
                        )
                        miss += 1
                    continue
                wrote += 1

            # Two intake keys aimed at one box: the second silently wins.
            seen = defaultdict(list)
            for t in targets:
                seen[t["field_id"]].append(t["value"])
            for fid, vals in seen.items():
                if len(vals) > 1 and len(set(vals)) > 1:
                    problems[f"{set_id}/{form_id}"].append(
                        f"COLLISION: {fid} written twice with different values {vals}"
                    )

            # A radio/checkbox target whose code isn't a state the widget has
            # would have been rejected above; this catches the opposite — a
            # tick that reads back as Off.
            for t in targets:
                if types.get(t["field_id"]) in ("radio_group", "checkbox"):
                    if values.get(t["field_id"]) in (None, "/Off", ""):
                        problems[f"{set_id}/{form_id}"].append(
                            f"UNTICKED: {t['field_id']} set to {t['value']!r} reads back "
                            f"{values.get(t['field_id'])!r}"
                        )

            stats.append((set_id, form_id, len(targets), wrote, miss, trunc, f["rawFieldCount"]))
            (AUDIT / "pdf").mkdir(exist_ok=True)
            (AUDIT / "pdf" / f"{set_id}__{form_id}.pdf").write_bytes(out)

    # ---- extraction side, same pass -------------------------------------
    #
    # "Reaches a box" is indirect for two legitimate shapes, and both have to
    # be modelled or the check screams about fields that are fine:
    #   - an aliased key: the model answers `heat_included`, the answer is
    #     stored as `heat_responsibility`, and that is what owns the box;
    #   - a date: the parent key holds no targets at all, its computed
    #     _day / _month_num / _year_full parts do.
    aliases = data["answerKeyOverrides"]          # tool key -> stored key
    derived_parents = data["derivedParents"]      # stored key -> parent key

    # Answerable on purpose with nowhere to print. condo_apt_unit_no is a
    # decoy: without it the model puts a suite number into condo_unit_number,
    # which is the condominium legal-description line, and the Agreement of
    # Purchase and Sale then describes the wrong unit. See lib/claude.ts and
    # scripts/extraction_eval.ts. Add to this list only with a reason.
    NO_BOX_BY_DESIGN = {"condo_apt_unit_no"}

    for set_id, s in data["sets"].items():
        direct = set()
        for f in s["forms"].values():
            direct.update(f["owner"].values())
        reachable = set(direct)
        for stored in direct:
            parent = derived_parents.get(stored)
            if parent:
                reachable.add(parent)

        for key in s["toolKeys"]:
            spec = s["toolSchema"][key]
            if "enum" in spec and not spec["enum"]:
                problems[f"{set_id}/extraction"].append(f"{key}: empty enum, model cannot answer")
            if not spec.get("type"):
                problems[f"{set_id}/extraction"].append(f"{key}: no type")
            # A field the model can fill that reaches no box on any form in
            # this set is a question we ask, pay to extract, and throw away.
            if key in NO_BOX_BY_DESIGN:
                continue
            if aliases.get(key, key) not in reachable:
                problems[f"{set_id}/asks-for-nothing"].append(key)

    print(f"{'set':16}{'form':11}{'boxes':>7}{'ok':>6}{'bad':>5}{'trunc':>7}{'of':>8}")
    for set_id, form_id, n, ok, bad, tr, total in stats:
        print(f"{set_id:16}{form_id:11}{n:>7}{ok:>6}{bad:>5}{tr:>7}{total:>8}")

    print()
    if not problems:
        print("No problems. Every mapped box filled and read back with the value its intake key supplied.")
        return 0
    total = sum(len(v) for v in problems.values())
    print(f"{total} problem(s):\n")
    for where in sorted(problems):
        items = problems[where]
        print(f"  {where}  ({len(items)})")
        if where.endswith("/asks-for-nothing"):
            print(f"     {', '.join(sorted(items))}")
        else:
            for p in items:
                print(f"     {p}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
