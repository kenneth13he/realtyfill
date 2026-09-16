# Adapted from ../scripts/fill_fillable_fields.py for in-memory (bytes in,
# bytes out) use inside a Vercel Service instead of a CLI reading/writing
# local file paths — the actual fill/validation logic (including the
# pypdf Opt-field monkeypatch, needed for correct radio-group values) is
# unchanged. Keep both files in sync if the fill logic itself ever changes;
# scripts/fill_fillable_fields.py is still what a local `npm run dev`
# (lib/pdfFill.ts, subprocess mode) uses.

import io

from pypdf import PdfReader, PdfWriter

from extract_form_field_info import get_field_info


class FillValidationError(Exception):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def fill_pdf_bytes(pdf_bytes: bytes, fields: list[dict]) -> bytes:
    fields_by_page: dict[int, dict[str, str]] = {}
    for field in fields:
        if "value" in field:
            fields_by_page.setdefault(field["page"], {})[field["field_id"]] = field["value"]

    reader = PdfReader(io.BytesIO(pdf_bytes))

    errors: list[str] = []
    field_info = get_field_info(reader)
    fields_by_ids = {f["field_id"]: f for f in field_info}
    for field in fields:
        existing_field = fields_by_ids.get(field["field_id"])
        if not existing_field:
            errors.append(f"`{field['field_id']}` is not a valid field ID")
        elif field["page"] != existing_field["page"]:
            errors.append(
                f"Incorrect page number for `{field['field_id']}` (got {field['page']}, expected {existing_field['page']})"
            )
        elif "value" in field:
            err = validation_error_for_field_value(existing_field, field["value"])
            if err:
                errors.append(err)
    if errors:
        raise FillValidationError(errors)

    # Nothing to write: return the document unchanged rather than round-
    # tripping it through the writer. This is the blank-only path (291/292),
    # where "filling" means handing the realtor the blank sheet.
    if not fields_by_page:
        return pdf_bytes

    writer = PdfWriter(clone_from=reader)
    for page, field_values in fields_by_page.items():
        writer.update_page_form_field_values(writer.pages[page - 1], field_values, auto_regenerate=False)

    writer.set_need_appearances_writer(True)

    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def validation_error_for_field_value(field_info, field_value):
    field_type = field_info["type"]
    field_id = field_info["field_id"]
    if field_type == "checkbox":
        checked_val = field_info["checked_value"]
        unchecked_val = field_info["unchecked_value"]
        if field_value != checked_val and field_value != unchecked_val:
            return f'Invalid value "{field_value}" for checkbox field "{field_id}". The checked value is "{checked_val}" and the unchecked value is "{unchecked_val}"'
    elif field_type == "radio_group":
        option_values = [opt["value"] for opt in field_info["radio_options"]]
        if field_value not in option_values:
            return f'Invalid value "{field_value}" for radio group field "{field_id}". Valid values are: {option_values}'
    elif field_type == "choice":
        choice_values = [opt["value"] for opt in field_info["choice_options"]]
        if field_value not in choice_values:
            return f'Invalid value "{field_value}" for choice field "{field_id}". Valid values are: {choice_values}'
    return None


def monkeypatch_pypdf_method():
    from pypdf.generic import DictionaryObject
    from pypdf.constants import FieldDictionaryAttributes

    original_get_inherited = DictionaryObject.get_inherited

    def patched_get_inherited(self, key: str, default=None):
        result = original_get_inherited(self, key, default)
        if key == FieldDictionaryAttributes.Opt:
            if isinstance(result, list) and all(isinstance(v, list) and len(v) == 2 for v in result):
                result = [r[0] for r in result]
        return result

    DictionaryObject.get_inherited = patched_get_inherited


monkeypatch_pypdf_method()
