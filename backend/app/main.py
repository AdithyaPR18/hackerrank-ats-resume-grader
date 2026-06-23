"""FastAPI surface.

  GET  /health      -> {"status": "ok"}
  POST /evaluate    -> multipart PDF upload, returns the full JSON evaluation

A light in-memory rate limit guards against cost blowups if deployed publicly.
"""
from __future__ import annotations

import os
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .evaluator import evaluate_resume
from .storage import save_resume

app = FastAPI(title="Resume Grader", version="0.1.0")

# Lock CORS to your site in production via ALLOWED_ORIGINS (comma-separated).
# Defaults to "*" for local dev.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

MAX_PDF_BYTES = 5 * 1024 * 1024  # 5 MB
RATE_LIMIT = 10  # requests
RATE_WINDOW = 60  # seconds
_hits: Dict[str, Deque[float]] = defaultdict(deque)

CREDIT = (
    "Scored against HackerRank's open-sourced hiring-agent rubric "
    "(interviewstreet/hiring-agent, MIT license) — this reflects how that specific "
    "system evaluates resumes, not a universal ATS standard."
)


def _rate_limit(ip: str) -> None:
    now = time.time()
    q = _hits[ip]
    while q and q[0] < now - RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again shortly.")
    q.append(now)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/evaluate")
async def evaluate(
    request: Request,
    file: UploadFile = File(...),
    redact: bool = Form(False),
    include_quick_wins: bool = Form(True),
) -> dict:
    _rate_limit(request.client.host if request.client else "unknown")

    if file.content_type not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Upload a PDF file.")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF too large (max 5 MB).")

    try:
        evaluation = evaluate_resume(data, redact=redact, include_quick_wins=include_quick_wins)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    ev_dict = evaluation.model_dump()
    # Save a copy of every uploaded resume + its evaluation. Never blocks the result.
    storage = save_resume(data, file.filename or "resume.pdf", ev_dict)

    return {"rubric_credit": CREDIT, "evaluation": ev_dict, "storage": storage}
