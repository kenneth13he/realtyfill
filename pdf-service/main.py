# pdf-service/main.py
# Vercel Service (see /vercel.json's `services.pdf-service`) — the PDF-fill
# pipeline as an internal HTTP endpoint instead of a local subprocess, for
# the Vercel deployment path where lib/pdfFill.ts can't just execFile a
# local Python interpreter the way it does in `npm run dev` or on the
# Render/Docker path (see Dockerfile). Not publicly routable — see
# vercel.json's rewrites, which only expose the "frontend" service; the
# Next.js app reaches this one via the PDF_SERVICE_URL binding.
#
# ## Why the PDF moves as raw bytes, not base64 JSON
#
# It used to be `{blank_pdf_base64, fields}` in and `{filled_pdf_base64}` out.
# Base64 inflates by 33%, and Vercel caps a function's request and response
# bodies at 4.5 MB. The RECO Information Guide is 3.43 MB of photography —
# fine on its own, 4.57 MB once encoded — so attaching it to every form set
# broke generation for ALL FOUR sets with a 500, in production only. The
# local dev path shells out to Python directly and never makes this request,
# which is why it passed every local test.
#
# Multipart in, application/pdf out: the bytes travel as bytes, and the
# largest template now sits ~1 MB under the limit instead of 70 KB over it.

import json

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from fill_fillable_fields import FillValidationError, fill_pdf_bytes

app = FastAPI()


@app.post("/fill")
async def fill(pdf: UploadFile = File(...), fields: str = Form(...)):
    """@param fields: JSON array of {field_id, page, value}."""
    try:
        parsed = json.loads(fields)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=[f"fields is not valid JSON: {e}"])
    if not isinstance(parsed, list):
        raise HTTPException(status_code=400, detail=["fields must be a JSON array"])

    pdf_bytes = await pdf.read()
    try:
        filled = fill_pdf_bytes(pdf_bytes, parsed)
    except FillValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors)

    return Response(content=filled, media_type="application/pdf")


@app.get("/health")
def health():
    return {"ok": True}
