"""Evaluation pipeline.

Three passes, each a single forced-tool-use call so we get strict JSON without
relying on assistant prefill (not supported by the model):

  1. extract_resume   raw text  -> StructuredResume
  2. score_resume     resume    -> Evaluation (line-by-line evidence)
  3. generate_quick_wins        -> prioritized, honesty-constrained fixes

PII redaction (optional) happens before any text reaches the model and is
restored in the final object.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import anthropic

# Load backend/.env (if present) so ANTHROPIC_API_KEY can live in a gitignored
# file instead of the shell environment. No-op if python-dotenv isn't installed.
try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from .models import (
    CATEGORY_MAX,
    Evaluation,
    QuickWin,
    StructuredResume,
)
from .pdf_parser import extract_text, redact_pii, restore_pii
from .rubric import (
    HACKERRANK_SYSTEM_MESSAGE,
    build_scoring_system_prompt,
)

MODEL = os.environ.get("RESUME_GRADER_MODEL", "claude-sonnet-4-6")
MAX_TOKENS = 8000


def _client() -> anthropic.Anthropic:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. Export it (or put it in backend/.env) "
            "before running the evaluator."
        )
    return anthropic.Anthropic()


def _force_tool_json(
    *,
    system: str,
    user_text: str,
    tool_name: str,
    tool_description: str,
    input_schema: Dict[str, Any],
    client: Optional[anthropic.Anthropic] = None,
) -> Dict[str, Any]:
    """One API call that forces the model to return JSON via a single tool."""
    client = client or _client()
    resp = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system,
        tools=[
            {
                "name": tool_name,
                "description": tool_description,
                "input_schema": input_schema,
            }
        ],
        tool_choice={"type": "tool", "name": tool_name},
        messages=[{"role": "user", "content": user_text}],
    )
    for block in resp.content:
        if block.type == "tool_use" and block.name == tool_name:
            return block.input  # already a parsed dict
    raise RuntimeError(f"Model did not return the expected tool call '{tool_name}'.")


# --------------------------------------------------------------------------- #
# JSON schemas for the three tools
# --------------------------------------------------------------------------- #
_EVIDENCE_SCHEMA = {
    "type": "object",
    "properties": {
        "quote": {
            "type": "string",
            "description": "Short verbatim snippet copied from the resume. May be empty for a global point.",
        },
        "points": {
            "type": "integer",
            "description": "Signed point impact of this specific line on the category score.",
        },
        "reason": {
            "type": "string",
            "description": "One sentence citing the rubric rule that earned/cost the points.",
        },
    },
    "required": ["quote", "points", "reason"],
}

_CATEGORY_SCHEMA = {
    "type": "object",
    "properties": {
        "score": {"type": "integer"},
        "max": {"type": "integer"},
        "evidence": {"type": "array", "items": _EVIDENCE_SCHEMA},
    },
    "required": ["score", "max", "evidence"],
}

_ADJUSTMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "total": {"type": "integer"},
        "items": {"type": "array", "items": _EVIDENCE_SCHEMA},
    },
    "required": ["total", "items"],
}

_EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "basics": {
            "type": "object",
            "description": "name, email, phone, url, location, profiles[] (network/url/username)",
            "properties": {
                "name": {"type": "string"},
                "email": {"type": "string"},
                "phone": {"type": "string"},
                "url": {"type": "string"},
                "summary": {"type": "string"},
                "location": {"type": "object"},
                "profiles": {"type": "array", "items": {"type": "object"}},
            },
        },
        "work": {"type": "array", "items": {"type": "object"}},
        "volunteer": {"type": "array", "items": {"type": "object"}},
        "projects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"},
                    "url": {"type": "string"},
                    "technologies": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
        "skills": {"type": "array", "items": {"type": "object"}},
        "education": {"type": "array", "items": {"type": "object"}},
        "awards": {"type": "array", "items": {"type": "object"}},
    },
    "required": ["basics", "work", "projects", "skills", "education"],
}

_SCORING_SCHEMA = {
    "type": "object",
    "properties": {
        "candidate_name": {"type": "string"},
        "scores": {
            "type": "object",
            "properties": {
                "open_source": _CATEGORY_SCHEMA,
                "self_projects": _CATEGORY_SCHEMA,
                "production": _CATEGORY_SCHEMA,
                "technical_skills": _CATEGORY_SCHEMA,
            },
            "required": ["open_source", "self_projects", "production", "technical_skills"],
        },
        "bonus": _ADJUSTMENT_SCHEMA,
        "deductions": _ADJUSTMENT_SCHEMA,
        "key_strengths": {"type": "array", "items": {"type": "string"}},
        "areas_for_improvement": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["scores", "bonus", "deductions", "key_strengths", "areas_for_improvement"],
}

_QUICK_WINS_SCHEMA = {
    "type": "object",
    "properties": {
        "quick_wins": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "fix": {"type": "string"},
                    "estimated_point_gain": {"type": "integer"},
                    "affected_category": {"type": "string"},
                    "rationale": {"type": "string"},
                },
                "required": ["fix", "estimated_point_gain", "affected_category"],
            },
        }
    },
    "required": ["quick_wins"],
}

# The hard line: fixes must make the resume genuinely stronger, never just sound stronger.
_QUICK_WINS_SYSTEM = """You generate prioritized, HONEST resume improvements for a resume scored against \
HackerRank's open-sourced hiring-agent rubric.

ABSOLUTE CONSTRAINT — every fix MUST be an action the person can actually go do:
- deploy a live demo, add a working GitHub/live link, quantify a REAL metric,
  make a genuine open-source contribution to someone else's repo, write a real
  technical blog post, ship a more complex project, etc.

NEVER suggest a phrasing trick that makes an untrue claim sound true. Specifically:
- Never suggest describing a class assignment as a "production system".
- Never suggest implying founder/early-employee scope on a role that wasn't.
- Never suggest inserting GSoC/founder/Hacktoberfest-shaped wording the person didn't earn.
If a category scores low because the underlying work simply isn't there yet, say
that plainly as the fix (e.g. "Make a real contribution to an active open-source
project — there is currently none to point to") rather than wording around it.

Sort quick_wins by estimated_point_gain (largest first). Ground each estimate in
the rubric's point structure. Return ONLY the tool call."""


# --------------------------------------------------------------------------- #
# Pipeline steps
# --------------------------------------------------------------------------- #
def extract_resume(
    text: str, client: Optional[anthropic.Anthropic] = None
) -> StructuredResume:
    raw = _force_tool_json(
        system=(
            "You are an expert resume parser. Extract the resume into the given "
            "structure. Only extract URLs that are EXPLICITLY present in the text — "
            "never invent github.com/linkedin.com links. Return ONLY the tool call."
        ),
        user_text=f"Resume text:\n\n{text}",
        tool_name="emit_structured_resume",
        tool_description="Emit the structured resume data extracted from the text.",
        input_schema=_EXTRACTION_SCHEMA,
        client=client,
    )
    return StructuredResume.model_validate(raw)


def score_resume(
    structured: StructuredResume,
    raw_text: str,
    client: Optional[anthropic.Anthropic] = None,
) -> Evaluation:
    system = HACKERRANK_SYSTEM_MESSAGE + "\n\n" + build_scoring_system_prompt()
    user_text = (
        "Score this resume. Use the structured data and the raw text below. "
        "Quotes in your evidence MUST be copied verbatim from the raw resume text.\n\n"
        "=== STRUCTURED RESUME (JSON) ===\n"
        + json.dumps(structured.model_dump(), indent=2, ensure_ascii=False)
        + "\n\n=== RAW RESUME TEXT ===\n"
        + raw_text
    )
    raw = _force_tool_json(
        system=system,
        user_text=user_text,
        tool_name="submit_evaluation",
        tool_description="Submit the evidence-based scoring evaluation.",
        input_schema=_SCORING_SCHEMA,
        client=client,
    )
    # Enforce the rubric caps in code regardless of what the model returned.
    for key, cat in raw.get("scores", {}).items():
        if isinstance(cat, dict):
            cat["max"] = CATEGORY_MAX.get(key, cat.get("max", 0))
    return Evaluation.model_validate(raw)


def generate_quick_wins(
    structured: StructuredResume,
    evaluation: Evaluation,
    client: Optional[anthropic.Anthropic] = None,
) -> List[QuickWin]:
    user_text = (
        "Resume (structured JSON):\n"
        + json.dumps(structured.model_dump(), indent=2, ensure_ascii=False)
        + "\n\nCurrent evaluation (scores + evidence):\n"
        + json.dumps(evaluation.model_dump(), indent=2, ensure_ascii=False)
        + "\n\nProduce the prioritized, honest quick wins."
    )
    raw = _force_tool_json(
        system=_QUICK_WINS_SYSTEM,
        user_text=user_text,
        tool_name="emit_quick_wins",
        tool_description="Emit prioritized, honesty-constrained resume fixes.",
        input_schema=_QUICK_WINS_SCHEMA,
        client=client,
    )
    wins = [QuickWin.model_validate(w) for w in raw.get("quick_wins", [])]
    wins.sort(key=lambda w: w.estimated_point_gain, reverse=True)
    return wins


def evaluate_resume(
    pdf_bytes: bytes,
    *,
    redact: bool = False,
    include_quick_wins: bool = True,
) -> Evaluation:
    """Full end-to-end evaluation from raw PDF bytes."""
    text = extract_text(pdf_bytes)
    if not text.strip():
        raise ValueError("No extractable text found in the PDF (is it a scanned image?).")

    pii_map: Dict[str, str] = {}
    if redact:
        text, pii_map = redact_pii(text)

    client = _client()
    structured = extract_resume(text, client=client)
    evaluation = score_resume(structured, text, client=client)
    if include_quick_wins:
        evaluation.quick_wins = generate_quick_wins(structured, evaluation, client=client)
    evaluation.recompute()

    if redact and pii_map:
        restored = restore_pii(evaluation.model_dump(), pii_map)
        evaluation = Evaluation.model_validate(restored)

    return evaluation
