"""Document pipeline (spec §9.1). Fetches from Supabase Storage, extracts native text with an OCR
fallback, finds PAN/GSTIN with page+bbox provenance, decodes QR codes, and classifies the document
type — all real now (Phase 1 walking skeleton + Phase 3 OCR/QR/classification)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from engine.common.auth import require_engine_token
from engine.common.errors import EngineError
from engine.common.storage import get_object_bytes
from engine.documents.pipeline import process_pdf_bytes

router = APIRouter(prefix="/documents", tags=["documents"], dependencies=[Depends(require_engine_token)])


class ProcessRequest(BaseModel):
    document_id: str
    storage_bucket: str
    storage_key: str
    declared_type: str | None = None


@router.post("/process")
async def process_document(payload: ProcessRequest) -> dict:
    try:
        data = get_object_bytes(payload.storage_bucket, payload.storage_key)
    except Exception as exc:
        raise EngineError("SOURCE_UNAVAILABLE", 502, f"Could not fetch the document from storage: {exc}", retryable=True) from exc

    result = process_pdf_bytes(data)

    return {
        "documentId": payload.document_id,
        "pageCount": result.page_count,
        "textLayer": result.text_layer,
        "failureCode": result.failure_code,
        "docType": result.doc_type,
        "docTypeConfidence": result.doc_type_confidence,
        "declaredTypeMismatch": bool(payload.declared_type and result.doc_type and payload.declared_type != result.doc_type),
        "pages": [{"pageNo": p.page_no, "textSource": p.text_source, "charCount": p.char_count, "ocrConfidence": p.ocr_confidence} for p in result.pages],
        "fields": [
            {
                "field": f.field,
                "valueRaw": f.value_raw,
                "pageNo": f.page_no,
                "bbox": {"x0": f.bbox.x0, "y0": f.bbox.y0, "x1": f.bbox.x1, "y1": f.bbox.y1} if f.bbox else None,
                "confidence": f.confidence,
                "method": f.method,
                "valid": f.valid,
                "flags": f.flags,
            }
            for f in result.fields
        ],
        "qrPayloads": [{"pageNo": q.page_no, "data": q.data, "symbology": q.symbology} for q in result.qr_payloads],
    }
