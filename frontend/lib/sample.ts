import { EvaluateResponse } from "./types";

// A realistic example report, used by the "See a sample" walkthrough so visitors
// (and tests) can see the full flow without spending an API call.
export const SAMPLE: EvaluateResponse = {
  rubric_credit:
    "Scored against HackerRank's open-sourced hiring-agent rubric (interviewstreet/hiring-agent, MIT license) — this reflects how that specific system evaluates resumes, not a universal ATS standard.",
  storage: { stored: false, backend: null },
  evaluation: {
    candidate_name: "Priya Raman",
    total_score: 59,
    scores: {
      open_source: {
        score: 18,
        max: 35,
        evidence: [
          { quote: "Contributed a bug fix to the pandas library (merged PR #54321)", points: 15, reason: "A merged PR to pandas — a 40k+ star project — is a genuine contribution to someone else's codebase." },
          { quote: "Hacktoberfest 2024 participant", points: 3, reason: "Hacktoberfest participation alone, with no specific merged PRs shown, is capped at 3–5 points." },
        ],
      },
      self_projects: {
        score: 16,
        max: 30,
        evidence: [
          { quote: "Distro-KV — A distributed key-value store with Raft consensus and a live demo", points: 18, reason: "A distributed system with consensus and a working live demo is complex, high-impact work." },
          { quote: "Todo App", points: -1, reason: "Tutorial-tier project with a generic name; has a repo but no live demo." },
          { quote: "Weather App", points: -1, reason: "Public-API weather app is explicitly a low-complexity project in the rubric." },
        ],
      },
      production: {
        score: 18,
        max: 25,
        evidence: [
          { quote: "Acme Robotics — Software Engineering Intern", points: 10, reason: "A real software engineering internship demonstrates production experience." },
          { quote: "Built an internal telemetry dashboard used by 40 engineers", points: 4, reason: "Shipped a tool with concrete internal adoption." },
          { quote: "Reduced data ingestion latency by 35% by rewriting the parser in Go", points: 4, reason: "Quantified performance impact in a production system." },
        ],
      },
      technical_skills: {
        score: 9,
        max: 10,
        evidence: [
          { quote: "Python, Go, TypeScript, C++", points: 5, reason: "Four languages spanning systems and web — strong breadth." },
          { quote: "Docker, Kubernetes, PostgreSQL, Redis", points: 3, reason: "Modern infrastructure and data tooling." },
          { quote: "rewriting the parser in Go", points: 1, reason: "Applied a skill to solve a real production problem." },
        ],
      },
    },
    bonus: {
      total: 3,
      items: [
        { quote: "linkedin.com/in/priyaraman", points: 1, reason: "LinkedIn profile present." },
        { quote: "github.com/priyaraman", points: 2, reason: "GitHub profile / portfolio link present." },
      ],
    },
    deductions: {
      total: 5,
      items: [
        { quote: "Todo App", points: -2, reason: "Tutorial-tier project." },
        { quote: "Weather App", points: -2, reason: "Low-complexity public-API project." },
        { quote: "Weather App", points: -1, reason: "No GitHub or live-demo link." },
      ],
    },
    key_strengths: [
      "A genuinely complex flagship project (distributed KV store with Raft) backed by a live demo",
      "Quantified production impact at an internship (35% latency cut, dashboard used by 40 engineers)",
      "Broad, modern technical stack across systems and web",
    ],
    areas_for_improvement: [
      "Open-source footprint is thin beyond a single merged PR — depth here is the biggest lever",
      "Two tutorial-tier projects dilute the project section and trigger deductions",
    ],
    quick_wins: [
      { fix: "Make 2–3 more substantive contributions to active open-source projects you already use", estimated_point_gain: 12, affected_category: "open_source", rationale: "Open Source is the lowest category (18/35). Sustained, merged contributions to well-known repos move it toward the upper band far more than a single bug fix." },
      { fix: "Replace the Todo and Weather apps with one genuinely complex project, deployed with a live demo", estimated_point_gain: 8, affected_category: "self_projects", rationale: "Removing two tutorial projects clears the deductions, and one strong project earns real positive score." },
      { fix: "Add a live-demo link (or remove the entry) for the Weather App", estimated_point_gain: 2, affected_category: "self_projects", rationale: "The unlinked project is costing deduction points for no upside — deploy it in an hour or cut it." },
      { fix: "Write a short technical post on how you implemented Raft in Distro-KV and link it", estimated_point_gain: 3, affected_category: "self_projects", rationale: "Documenting your strongest project signals communication depth the rubric rewards." },
    ],
  },
};
