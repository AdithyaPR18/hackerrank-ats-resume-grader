"""Pydantic schemas for structured resume extraction and the scoring output.

Caps are enforced here so a hallucinated over-cap score from the LLM is clamped
rather than trusted. The total is always recomputed in code (see Evaluation.recompute).
"""
from __future__ import annotations

from typing import List, Optional, Dict, Any

from pydantic import BaseModel, Field, field_validator, model_validator

# Hard limits, straight from HackerRank's rubric.
CATEGORY_MAX: Dict[str, int] = {
    "open_source": 35,
    "self_projects": 30,
    "production": 25,
    "technical_skills": 10,
}
BONUS_MAX = 20
TOTAL_MAX = 120

CATEGORY_LABELS = {
    "open_source": "Open Source",
    "self_projects": "Self Projects",
    "production": "Production",
    "technical_skills": "Technical Skills",
}


# --------------------------------------------------------------------------- #
# Structured resume (extraction step). Kept loose/robust on purpose.
# --------------------------------------------------------------------------- #
class StructuredResume(BaseModel):
    basics: Dict[str, Any] = Field(default_factory=dict)
    work: List[Dict[str, Any]] = Field(default_factory=list)
    volunteer: List[Dict[str, Any]] = Field(default_factory=list)
    projects: List[Dict[str, Any]] = Field(default_factory=list)
    skills: List[Dict[str, Any]] = Field(default_factory=list)
    education: List[Dict[str, Any]] = Field(default_factory=list)
    awards: List[Dict[str, Any]] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Scoring output
# --------------------------------------------------------------------------- #
class Evidence(BaseModel):
    quote: str = Field("", description="Verbatim snippet from the resume this point is based on")
    points: int = Field(..., description="Signed point impact of this specific line")
    reason: str = Field(..., min_length=1)


class CategoryScore(BaseModel):
    score: int = Field(..., ge=0)
    max: int = Field(..., gt=0)
    evidence: List[Evidence] = Field(default_factory=list)

    @model_validator(mode="after")
    def _clamp(self) -> "CategoryScore":
        if self.score > self.max:
            self.score = self.max
        if self.score < 0:
            self.score = 0
        return self


class Scores(BaseModel):
    open_source: CategoryScore
    self_projects: CategoryScore
    production: CategoryScore
    technical_skills: CategoryScore

    def items(self):
        return [
            ("open_source", self.open_source),
            ("self_projects", self.self_projects),
            ("production", self.production),
            ("technical_skills", self.technical_skills),
        ]


class AdjustmentBlock(BaseModel):
    total: int = Field(0, ge=0)
    items: List[Evidence] = Field(default_factory=list)


class QuickWin(BaseModel):
    fix: str = Field(..., min_length=1)
    estimated_point_gain: int = Field(..., ge=0)
    affected_category: str
    rationale: Optional[str] = None


class Evaluation(BaseModel):
    candidate_name: Optional[str] = None
    scores: Scores
    bonus: AdjustmentBlock = Field(default_factory=AdjustmentBlock)
    deductions: AdjustmentBlock = Field(default_factory=AdjustmentBlock)
    key_strengths: List[str] = Field(default_factory=list, max_length=5)
    areas_for_improvement: List[str] = Field(default_factory=list, max_length=3)
    quick_wins: List[QuickWin] = Field(default_factory=list)
    total_score: int = 0

    @model_validator(mode="after")
    def _recompute(self) -> "Evaluation":
        self.recompute()
        return self

    def recompute(self) -> "Evaluation":
        """Recompute totals from parts in code. Never trust the model's arithmetic."""
        category_sum = sum(c.score for _, c in self.scores.items())
        bonus = min(self.bonus.total, BONUS_MAX)
        self.bonus.total = bonus
        total = category_sum + bonus - self.deductions.total
        self.total_score = max(0, min(total, TOTAL_MAX))
        return self

    @property
    def category_subtotal(self) -> int:
        return sum(c.score for _, c in self.scores.items())
