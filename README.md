# Resume Grader

Upload a resume and get it scored against HackerRank's open-sourced hiring-agent
rubric ([interviewstreet/hiring-agent](https://github.com/interviewstreet/hiring-agent),
MIT licensed), with **every point traced to the specific resume line** that earned
or lost it — plus a prioritized list of fixes ranked by point impact.

The score is out of **120** and reflects how that one rubric evaluates resumes. It
is not a universal ATS standard and does not predict how any other company's ATS
or a human recruiter will judge a resume.

## How scoring works

The rubric's four categories and caps are preserved exactly:

| Category | Max | What it rewards |
|---|---|---|
| Open Source | 35 | contributions to *other* people's repos (personal repos cap at 10) |
| Self Projects | 30 | complexity, real-world impact, working live demos |
| Production | 25 | work/internship experience; extra weight for founder / early-employee roles |
| Technical Skills | 10 | breadth and evidence of problem-solving |

Plus bonus points (≤20) and deductions (generic project names, missing links,
tutorial-only project sets). Scores never depend on name, school, GPA, or location.

The fixes it suggests are always things you can actually go do — deploy a live
demo, link a real repo, quantify a real metric, make a genuine open-source
contribution. It will not suggest wording a class project as a "production system"
or implying scope you didn't have.

The category caps and the running total are enforced and recomputed server-side,
so the final number is always internally consistent.

## Layout

```
resume-grader/
  backend/          # FastAPI + the scoring pipeline
    app/
      rubric.py        # the scoring criteria + output contract
      models.py        # schemas; enforces caps and recomputes the total
      pdf_parser.py    # PDF text extraction + reversible PII redaction
      evaluator.py     # extract -> score -> quick wins
      cli.py           # python -m app.cli resume.pdf
      main.py          # POST /evaluate, GET /health
      storage.py       # saves each uploaded resume (Supabase, local fallback)
    requirements.txt
    .env.example
  frontend/         # Next.js + Tailwind dashboard
    app/page.tsx       # upload + interactive results
    lib/types.ts
    .env.local.example
```

## Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # add your ANTHROPIC_API_KEY (and Supabase keys)
```

CLI:

```bash
python -m app.cli samples/sample_resume.pdf            # formatted report
python -m app.cli samples/sample_resume.pdf --redact   # strip PII before scoring
python -m app.cli samples/sample_resume.pdf --json     # raw JSON
```

API:

```bash
uvicorn app.main:app --reload
```

- `GET /health` → `{"status": "ok"}`
- `POST /evaluate` → multipart upload (`file`, optional `redact`,
  `include_quick_wins`) → `{rubric_credit, evaluation, storage}`. Rate limited to
  10 requests / 60s / IP; 5 MB max upload.

## Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local       # point NEXT_PUBLIC_API_URL at the backend
npm run dev                             # http://localhost:3000
```

A single page: drag in a PDF, get an animated total score, per-category bars with
expandable line-by-line evidence, bonus/deductions, and a ranked list of fixes.
Results download as a PDF report (print-to-PDF) or raw JSON. No accounts.

## Storage (Supabase)

Each uploaded resume and its evaluation are saved to Supabase Storage:

1. Create a project at [supabase.com](https://supabase.com).
2. **Storage → New bucket** → name it `resumes`.
3. **Settings → API** → copy the **Project URL** and the **`service_role` key**.
4. Add them to `backend/.env`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   SUPABASE_BUCKET=resumes
   ```

If these are blank, copies fall back to a local `./uploads/` folder. Because
uploads contain personal data, the upload page includes a consent notice.

## Deploy

Frontend → Vercel, backend → Render or Fly.io. Set the same environment variables
on the backend host and point `NEXT_PUBLIC_API_URL` at its public URL.

## Credit

Scoring rubric from HackerRank's [interviewstreet/hiring-agent](https://github.com/interviewstreet/hiring-agent),
used under its MIT license. Not affiliated with or endorsed by HackerRank.
