// Mirrors backend/app/models.py Evaluation.model_dump()

export interface Evidence {
  quote: string;
  points: number;
  reason: string;
}

export interface CategoryScore {
  score: number;
  max: number;
  evidence: Evidence[];
}

export interface Scores {
  open_source: CategoryScore;
  self_projects: CategoryScore;
  production: CategoryScore;
  technical_skills: CategoryScore;
}

export interface Adjustment {
  total: number;
  items: Evidence[];
}

export interface QuickWin {
  fix: string;
  estimated_point_gain: number;
  affected_category: string;
  rationale?: string | null;
}

export interface Evaluation {
  candidate_name?: string | null;
  scores: Scores;
  bonus: Adjustment;
  deductions: Adjustment;
  key_strengths: string[];
  areas_for_improvement: string[];
  quick_wins: QuickWin[];
  total_score: number;
}

export interface EvaluateResponse {
  rubric_credit: string;
  evaluation: Evaluation;
  storage: { stored: boolean; backend: string | null };
}

export const CATEGORY_LABELS: Record<keyof Scores, string> = {
  open_source: "Open Source",
  self_projects: "Self Projects",
  production: "Production",
  technical_skills: "Technical Skills",
};

export const CATEGORY_ORDER: (keyof Scores)[] = [
  "open_source",
  "self_projects",
  "production",
  "technical_skills",
];

export const TOTAL_MAX = 120;
