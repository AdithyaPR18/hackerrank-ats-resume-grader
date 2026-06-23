"""Persist a copy of every uploaded resume (+ its evaluation) to the cloud.

Primary backend is Supabase Storage; if it isn't configured we fall back to a
local ./uploads directory so dev still works. Storage failures are swallowed and
logged — saving a copy must NEVER break the user's evaluation.

Required env for Supabase (see .env.example):
    SUPABASE_URL=https://<project>.supabase.co
    SUPABASE_SERVICE_KEY=<service_role key>
    SUPABASE_BUCKET=resumes        # optional, defaults to "resumes"
"""
from __future__ import annotations

import datetime
import json
import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

log = logging.getLogger("resume_grader.storage")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "resumes")
LOCAL_DIR = Path(os.environ.get("RESUME_GRADER_LOCAL_STORE", "uploads"))


def _safe_stem(name: str) -> str:
    stem = Path(name or "resume").stem
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")
    return (stem or "resume")[:40]


def _object_key(original_name: str) -> str:
    ts = datetime.datetime.utcnow().strftime("%Y/%m/%d/%H%M%S")
    return f"{ts}-{uuid.uuid4().hex[:8]}-{_safe_stem(original_name)}"


def _supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_KEY)


def _supabase_put(path: str, data: bytes, content_type: str) -> str:
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{path}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "apikey": SUPABASE_SERVICE_KEY,
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    resp = httpx.post(url, content=data, headers=headers, timeout=30.0)
    if resp.status_code >= 400:
        raise RuntimeError(f"Supabase {resp.status_code}: {resp.text[:300]}")
    return f"{SUPABASE_BUCKET}/{path}"


def _local_put(path: str, data: bytes) -> str:
    dest = LOCAL_DIR / path
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return str(dest)


def save_resume(
    pdf_bytes: bytes,
    original_name: str,
    evaluation: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Save the PDF (and the evaluation JSON, if given). Never raises."""
    key = _object_key(original_name)
    result: Dict[str, Any] = {"stored": False, "backend": None, "pdf_path": None, "json_path": None}
    try:
        if _supabase_configured():
            result["backend"] = "supabase"
            result["pdf_path"] = _supabase_put(f"{key}.pdf", pdf_bytes, "application/pdf")
            if evaluation is not None:
                blob = json.dumps(evaluation, ensure_ascii=False, indent=2).encode("utf-8")
                result["json_path"] = _supabase_put(f"{key}.json", blob, "application/json")
        else:
            result["backend"] = "local"
            result["pdf_path"] = _local_put(f"{key}.pdf", pdf_bytes)
            if evaluation is not None:
                blob = json.dumps(evaluation, ensure_ascii=False, indent=2).encode("utf-8")
                result["json_path"] = _local_put(f"{key}.json", blob)
        result["stored"] = True
    except Exception as e:  # storage must never break the evaluation
        log.warning("Resume storage failed (%s): %s", result["backend"], e)
        result["error"] = str(e)
    return result
