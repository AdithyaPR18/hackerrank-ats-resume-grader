"""PDF -> text, plus optional PII redaction.

Redaction is reversible: we swap phone/email for stable placeholders before the
text ever reaches the LLM, and restore them in the returned JSON afterward.
"""
from __future__ import annotations

import re
from typing import Dict, Tuple

import fitz  # PyMuPDF

# Email and phone patterns. Deliberately conservative to avoid eating real
# resume content (e.g. years, version numbers).
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{1,4}\)[\s.\-]?)?\d{3}[\s.\-]?\d{3,4}[\s.\-]?\d{0,4}(?!\d)"
)


def extract_text(pdf_bytes: bytes) -> str:
    """Extract plain text from a PDF given as bytes."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages = [page.get_text("text") for page in doc]
    finally:
        doc.close()
    text = "\n".join(pages)
    # Collapse runs of blank lines; keep single newlines (layout signal).
    text = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)
    return text.strip()


def extract_text_from_path(path: str) -> str:
    with open(path, "rb") as f:
        return extract_text(f.read())


def redact_pii(text: str) -> Tuple[str, Dict[str, str]]:
    """Replace emails/phones with placeholders.

    Returns (redacted_text, mapping) where mapping[placeholder] = original, so
    callers can restore the originals in the final output.
    """
    mapping: Dict[str, str] = {}
    counters = {"EMAIL": 0, "PHONE": 0}

    def _swap(kind: str, value: str) -> str:
        # Reuse the same placeholder for repeated identical values.
        for ph, orig in mapping.items():
            if orig == value:
                return ph
        counters[kind] += 1
        ph = f"[REDACTED_{kind}_{counters[kind]}]"
        mapping[ph] = value
        return ph

    def _swap_phone(m: "re.Match") -> str:
        # Guard against date ranges / IDs: a real phone has >= 10 digits, or an
        # explicit international/area-code marker.
        candidate = m.group(0)
        digits = sum(c.isdigit() for c in candidate)
        if digits < 10 and not candidate.lstrip().startswith(("+", "(")):
            return candidate
        return _swap("PHONE", candidate)

    # Emails first (a phone-looking substring can live inside an email).
    text = EMAIL_RE.sub(lambda m: _swap("EMAIL", m.group(0)), text)
    text = PHONE_RE.sub(_swap_phone, text)
    return text, mapping


def restore_pii(obj, mapping: Dict[str, str]):
    """Recursively restore redacted placeholders in any str within a JSON-like obj."""
    if not mapping:
        return obj
    if isinstance(obj, str):
        for ph, orig in mapping.items():
            obj = obj.replace(ph, orig)
        return obj
    if isinstance(obj, list):
        return [restore_pii(x, mapping) for x in obj]
    if isinstance(obj, dict):
        return {k: restore_pii(v, mapping) for k, v in obj.items()}
    return obj
