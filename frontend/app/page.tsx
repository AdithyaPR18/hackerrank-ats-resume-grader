"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CATEGORY_ORDER, Evidence, EvaluateResponse, Scores, TOTAL_MAX } from "@/lib/types";
import { SAMPLE } from "@/lib/sample";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const RUBRIC_CREDIT =
  "Scored against HackerRank's open-sourced hiring-agent rubric (interviewstreet/hiring-agent, MIT license) — this reflects how that specific system evaluates resumes, not a universal ATS standard.";
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

type Accent = "violet" | "sky" | "amber" | "emerald";
const ACCENT: Record<Accent, { hex: string; text: string; bar: string; dot: string; soft: string; chip: string }> = {
  violet: { hex: "#a78bfa", text: "text-violet-300", bar: "bg-violet-400", dot: "bg-violet-400", soft: "bg-violet-400/10", chip: "bg-violet-400/15 text-violet-200" },
  sky: { hex: "#38bdf8", text: "text-sky-300", bar: "bg-sky-400", dot: "bg-sky-400", soft: "bg-sky-400/10", chip: "bg-sky-400/15 text-sky-200" },
  amber: { hex: "#fbbf24", text: "text-amber-300", bar: "bg-amber-400", dot: "bg-amber-400", soft: "bg-amber-400/10", chip: "bg-amber-400/15 text-amber-200" },
  emerald: { hex: "#34d399", text: "text-emerald-300", bar: "bg-emerald-400", dot: "bg-emerald-400", soft: "bg-emerald-400/10", chip: "bg-emerald-400/15 text-emerald-200" },
};

const META: Record<keyof Scores, { label: string; accent: Accent; range: string; blurb: string }> = {
  open_source: { label: "Open Source", accent: "violet", range: "0–35", blurb: "Contributions to other people's projects. GSoC and PRs to popular repos score highest — personal repos alone cap low." },
  self_projects: { label: "Self Projects", accent: "sky", range: "0–30", blurb: "Complexity and real-world impact. Live demos earn a bonus; tutorial-tier todo / weather apps score low." },
  production: { label: "Production", accent: "amber", range: "0–25", blurb: "Work, internship & volunteer experience. Founder or early-employee roles get extra weight." },
  technical_skills: { label: "Technical Skills", accent: "emerald", range: "0–10", blurb: "Breadth across languages and tools, plus evidence of problem-solving." },
};

type Slide = { tag: string; title: string; range: string; body: string; text: string; soft: string; chip: string };
const TUTORIAL: Slide[] = [
  { tag: "How it works", title: "Scored out of 120", range: "", body: "Four weighted dimensions, plus bonuses and deductions. Every point is tied to an exact line on your resume — no vague advice.", text: "text-indigo-300", soft: "bg-indigo-400/10", chip: "bg-indigo-400/15 text-indigo-200" },
  ...CATEGORY_ORDER.map((k) => {
    const m = META[k];
    const a = ACCENT[m.accent];
    return { tag: "Dimension", title: m.label, range: m.range, body: m.blurb, text: a.text, soft: a.soft, chip: a.chip };
  }),
  { tag: "Adjustments", title: "Bonus & deductions", range: "±", body: "Up to +20 bonus for things like GSoC, founder roles, or a portfolio — minus points for generic names or projects with no working link.", text: "text-rose-300", soft: "bg-rose-400/10", chip: "bg-rose-400/15 text-rose-200" },
];

const overallStroke = (r: number) => (r >= 0.75 ? "#34d399" : r >= 0.5 ? "#fbbf24" : "#fb7185");
const gradeLabel = (r: number) => (r >= 0.85 ? "Exceptional" : r >= 0.7 ? "Strong" : r >= 0.5 ? "Solid" : r >= 0.3 ? "Developing" : "Early");
const gradePill = (r: number) => (r >= 0.7 ? "bg-emerald-400/15 text-emerald-300" : r >= 0.5 ? "bg-amber-400/15 text-amber-300" : "bg-rose-400/15 text-rose-300");

function ScoreRing({ score, max }: { score: number; max: number }) {
  const r = 80;
  const c = 2 * Math.PI * r;
  const ratio = max ? Math.min(1, score / max) : 0;
  return (
    <svg viewBox="0 0 200 200" className="h-52 w-52">
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="13" />
      <circle cx="100" cy="100" r={r} fill="none" stroke={overallStroke(ratio)} strokeWidth="13" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} transform="rotate(-90 100 100)"
        style={{ transition: "stroke-dashoffset 1000ms cubic-bezier(0.22,1,0.36,1)" }} />
      <text x="100" y="96" textAnchor="middle" className="fill-current text-white" fontSize="50" fontWeight="800">{score}</text>
      <text x="100" y="121" textAnchor="middle" className="fill-current text-slate-500" fontSize="15" fontWeight="500">out of {max}</text>
    </svg>
  );
}

function EvidenceRow({ e, i }: { e: Evidence; i: number }) {
  const sign = e.points > 0 ? "+" : "";
  const chip = e.points > 0 ? "text-emerald-300 bg-emerald-400/15" : e.points < 0 ? "text-rose-300 bg-rose-400/15" : "text-slate-400 bg-white/10";
  return (
    <motion.li initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex gap-3 py-2.5">
      <span className={`mt-0.5 h-fit shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${chip}`}>{sign}{e.points}</span>
      <span className="text-sm leading-relaxed text-slate-300">
        {e.quote ? <span className="italic text-slate-500">&ldquo;{e.quote}&rdquo; </span> : null}
        {e.reason}
      </span>
    </motion.li>
  );
}

function CountdownRing({ remaining, estimate }: { remaining: number; estimate: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const ratio = estimate ? Math.max(0, Math.min(1, remaining / estimate)) : 0;
  return (
    <div className="absolute right-5 top-5">
      <div className="relative h-12 w-12">
        <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
          <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3.5" />
          <circle cx="24" cy="24" r={r} fill="none" stroke="#818cf8" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} style={{ transition: "stroke-dashoffset 300ms linear" }} />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums text-slate-200">{remaining > 0 ? remaining : "·"}</span>
      </div>
    </div>
  );
}

function LoadingTutorial({ progress, elapsed, estimate }: { progress: number; elapsed: number; estimate: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % TUTORIAL.length), 3200);
    return () => clearInterval(id);
  }, []);
  const s = TUTORIAL[i];
  const remaining = Math.max(0, Math.ceil(estimate - elapsed));
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="card relative p-7 sm:p-9">
      <CountdownRing remaining={remaining} estimate={estimate} />
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">While we read your resume</p>
      <div className="mt-4 min-h-[156px]">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.32 }}>
            <div className={`rounded-2xl border border-white/10 p-5 ${s.soft}`}>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-base font-bold ${s.text}`}>{s.title}</span>
                {s.range && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${s.chip}`}>{s.range} pts</span>}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{s.body}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div className="bar-fill h-full rounded-full bg-indigo-400" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex gap-1.5">
          {TUTORIAL.map((_, d) => (
            <span key={d} className={`h-1.5 rounded-full transition-all ${d === i ? "w-4 bg-indigo-400" : "w-1.5 bg-white/20"}`} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [redact, setRedact] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [estimate, setEstimate] = useState(28);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluateResponse | null>(null);
  const [dragging, setDragging] = useState(false);
  const [shownScore, setShownScore] = useState(0);
  const [selected, setSelected] = useState<keyof Scores>("open_source");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sampleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ev = result?.evaluation;

  useEffect(() => {
    if (!ev) { setShownScore(0); return; }
    const target = ev.total_score;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 1000);
      setShownScore(Math.round(easeOutCubic(p) * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ev]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (sampleRef.current) clearTimeout(sampleRef.current);
  }, []);

  // Wake the (free-tier) backend on load so it's warm by the time someone uploads.
  useEffect(() => {
    fetch(`${API}/health`).catch(() => {});
  }, []);

  const pickFile = (f: File | null) => {
    setError(null);
    if (f && f.type !== "application/pdf") { setError("Please upload a PDF file."); return; }
    setFile(f);
  };
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pickFile(e.dataTransfer.files?.[0] ?? null);
  }, []);

  const startTimer = (est: number) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(4);
    setElapsed(0);
    setEstimate(est);
    const start = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
      setProgress((p) => Math.min(95, p + (95 - p) * 0.05));
    }, 100);
  };
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); };

  const submit = async () => {
    if (!file) return;
    startTimer(45); // allows headroom for a cold start + the scoring pipeline
    const buildFd = () => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("redact", String(redact));
      fd.append("include_quick_wins", "true");
      return fd;
    };
    try {
      // Retry through cold starts: a sleeping free-tier instance can fail the
      // first hit (network error, or a CORS-less 404/502/503 from the edge).
      let res: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const r = await fetch(`${API}/evaluate`, { method: "POST", body: buildFd() });
          if (r.status === 404 || r.status === 502 || r.status === 503) {
            // origin not ready yet — wake it and retry
          } else {
            res = r;
            break;
          }
        } catch {
          // network / CORS failure ("failed to fetch") — likely still waking
        }
        await fetch(`${API}/health`).catch(() => {});
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!res) throw new Error("The server is waking up (free tier). Give it a few seconds and try again.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`);
      }
      setProgress(100);
      setResult(await res.json());
      setSelected("open_source");
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      stopTimer();
      setLoading(false);
    }
  };

  const runSample = () => {
    startTimer(8);
    sampleRef.current = setTimeout(() => {
      stopTimer();
      setProgress(100);
      setResult(SAMPLE);
      setSelected("open_source");
      setLoading(false);
    }, 8000);
  };

  const reset = () => { setResult(null); setFile(null); setError(null); setProgress(0); };

  const downloadJSON = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.evaluation, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-grade.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const ratio = ev ? ev.total_score / TOTAL_MAX : 0;
  const subtotal = ev ? CATEGORY_ORDER.reduce((s, k) => s + ev.scores[k].score, 0) : 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-9 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-300">
          <span className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-violet-400" />
            <span className="h-2 w-2 rounded-full bg-sky-400" />
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          120-point evidence-based scoring
        </span>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Grade your resume, <span className="text-indigo-300">line by line.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-slate-400">
          Scored against{" "}
          <a href="https://github.com/interviewstreet/hiring-agent" className="font-medium text-slate-200 underline decoration-white/30 underline-offset-2 hover:decoration-white/70" target="_blank" rel="noreferrer">
            HackerRank&apos;s open-sourced hiring rubric
          </a>
          . Every point is traced to the exact line that earned or lost it.
        </p>
      </motion.header>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" exit={{ opacity: 0 }}>
            <LoadingTutorial progress={progress} elapsed={elapsed} estimate={estimate} />
          </motion.div>
        ) : ev ? (
          <motion.section key="results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            {/* Hero */}
            <div className="card p-8 text-center print-full">
              <div className="flex flex-col items-center">
                <ScoreRing score={shownScore} max={TOTAL_MAX} />
                <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className={`mt-2 rounded-full px-3.5 py-1 text-sm font-bold ${gradePill(ratio)}`}>{gradeLabel(ratio)}</motion.span>
                {ev.candidate_name && <p className="mt-2 text-sm font-medium text-slate-400">{ev.candidate_name}</p>}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
                  <span className="rounded-lg bg-white/5 px-2.5 py-1 text-slate-300">Categories {subtotal}</span>
                  <span className="rounded-lg bg-emerald-400/15 px-2.5 py-1 text-emerald-300">Bonus +{ev.bonus.total}</span>
                  <span className="rounded-lg bg-rose-400/15 px-2.5 py-1 text-rose-300">Deductions −{ev.deductions.total}</span>
                </div>
              </div>
            </div>

            {/* Navigable category breakdown */}
            <div>
              <h2 className="mb-2.5 px-1 text-xs font-bold uppercase tracking-widest text-slate-500">Breakdown · tap a category</h2>
              <div className="grid grid-cols-2 gap-3">
                {CATEGORY_ORDER.map((k) => {
                  const m = META[k];
                  const a = ACCENT[m.accent];
                  const cat = ev.scores[k];
                  const r = cat.max ? cat.score / cat.max : 0;
                  const sel = selected === k;
                  return (
                    <button key={k} onClick={() => setSelected(k)} className="relative rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:bg-white/[0.06]">
                      {sel && <motion.span layoutId="tilesel" className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: `inset 0 0 0 2px ${a.hex}` }} transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                        <span className={`h-2.5 w-2.5 rounded-full ${a.dot}`} />
                        {m.label}
                      </span>
                      <div className="mt-2 flex items-end gap-1">
                        <span className="text-2xl font-extrabold tabular-nums text-white">{cat.score}</span>
                        <span className="mb-0.5 text-sm font-medium text-slate-500">/ {cat.max}</span>
                      </div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                        <motion.div className={`h-full rounded-full ${a.bar}`} initial={{ width: 0 }} animate={{ width: `${r * 100}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
                      </div>
                    </button>
                  );
                })}
              </div>

              <AnimatePresence mode="wait">
                {(() => {
                  const m = META[selected];
                  const a = ACCENT[m.accent];
                  const cat = ev.scores[selected];
                  return (
                    <motion.div key={selected} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }} className="card mt-3 p-5 print-full">
                      <div className="flex items-center justify-between">
                        <span className={`flex items-center gap-2 font-bold ${a.text}`}><span className={`h-3 w-3 rounded-full ${a.dot}`} />{m.label}</span>
                        <span className="tabular-nums text-sm font-semibold text-slate-200">{cat.score}<span className="font-normal text-slate-500">/{cat.max}</span></span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{m.blurb}</p>
                      <ul className="mt-2 divide-y divide-white/5">
                        {cat.evidence.length ? cat.evidence.map((e, i) => <EvidenceRow key={i} e={e} i={i} />) : <li className="py-2 text-sm text-slate-500">No evidence cited.</li>}
                      </ul>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </div>

            {/* Quick wins */}
            {ev.quick_wins.length > 0 && (
              <div className="card p-6 print-full">
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-indigo-500 text-xs text-white">★</span>
                  Quick wins
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">Biggest gain first — concrete actions, never wording tricks.</p>
                <motion.ol className="mt-4 space-y-3" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
                  {ev.quick_wins.map((w, i) => (
                    <motion.li key={i} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} className="flex gap-3.5 rounded-2xl border border-white/5 bg-white/[0.03] p-3.5">
                      <span className="grid h-10 w-12 shrink-0 place-items-center rounded-xl bg-indigo-500 text-sm font-bold tabular-nums text-white">+{w.estimated_point_gain}</span>
                      <div>
                        <p className="text-sm font-medium leading-relaxed text-slate-100">{w.fix} <span className="text-xs font-normal text-slate-500">· {w.affected_category}</span></p>
                        {w.rationale && <p className="mt-1 text-xs leading-relaxed text-slate-400">{w.rationale}</p>}
                      </div>
                    </motion.li>
                  ))}
                </motion.ol>
              </div>
            )}

            {/* Collapsible summary */}
            <details className="group card p-5 print-full">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-bold text-slate-200">
                Bonus, deductions &amp; summary
                <svg className="h-4 w-4 text-slate-500 transition group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <h3 className="text-sm font-semibold text-emerald-300">Bonus +{ev.bonus.total}</h3>
                  <ul className="mt-1.5 space-y-1 text-sm text-emerald-100/90">
                    {ev.bonus.items.map((e, i) => <li key={i}><span className="font-bold">+{e.points}</span> {e.reason}</li>)}
                    {!ev.bonus.items.length && <li className="text-emerald-300/50">None.</li>}
                  </ul>
                </div>
                <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-4">
                  <h3 className="text-sm font-semibold text-rose-300">Deductions −{ev.deductions.total}</h3>
                  <ul className="mt-1.5 space-y-1 text-sm text-rose-100/90">
                    {ev.deductions.items.map((e, i) => <li key={i}><span className="font-bold">−{Math.abs(e.points)}</span> {e.reason}</li>)}
                    {!ev.deductions.items.length && <li className="text-rose-300/50">None.</li>}
                  </ul>
                </div>
                {ev.key_strengths.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <h3 className="text-sm font-semibold text-slate-200">Key strengths</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-400">{ev.key_strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
                {ev.areas_for_improvement.length > 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <h3 className="text-sm font-semibold text-slate-200">Areas to improve</h3>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-400">{ev.areas_for_improvement.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </div>
                )}
              </div>
            </details>

            <p className="text-center text-[11px] leading-relaxed text-slate-500 print-full">{result!.rubric_credit || RUBRIC_CREDIT}</p>

            <div className="no-print flex flex-wrap gap-3">
              <button onClick={() => window.print()} className="flex-1 rounded-xl bg-white px-4 py-3 font-semibold text-slate-900 transition hover:bg-slate-100 active:scale-[0.99]">Download report (PDF)</button>
              <button onClick={downloadJSON} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-medium text-slate-200 transition hover:bg-white/10">Download JSON</button>
              <button onClick={reset} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 font-medium text-slate-200 transition hover:bg-white/10">Grade another</button>
            </div>
          </motion.section>
        ) : (
          <motion.section key="upload" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="no-print card p-6 sm:p-8">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition ${
                dragging ? "scale-[1.01] border-indigo-400 bg-indigo-400/10" : file ? "border-emerald-400/70 bg-emerald-400/10" : "border-white/15 hover:border-indigo-400/70 hover:bg-white/[0.03]"
              }`}
            >
              <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              <motion.div whileHover={{ scale: 1.05 }} className={`mb-4 grid h-14 w-14 place-items-center rounded-2xl ${file ? "bg-emerald-400/20" : "bg-white/5"}`}>
                {file ? (
                  <svg className="h-7 w-7 text-emerald-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ) : (
                  <svg className="h-7 w-7 text-indigo-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                )}
              </motion.div>
              {file ? (
                <><p className="font-semibold text-white">{file.name}</p><p className="mt-0.5 text-sm text-slate-400">Click to choose a different file</p></>
              ) : (
                <><p className="font-semibold text-white">Drop your resume PDF here</p><p className="mt-0.5 text-sm text-slate-400">or click to browse</p></>
              )}
            </div>

            <label className="mt-5 flex items-center gap-2.5 text-sm text-slate-300">
              <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} className="h-4 w-4 rounded border-white/20 bg-transparent text-indigo-500 focus:ring-indigo-500" />
              Strip my phone &amp; email before sending to the model
            </label>

            {error && <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm text-rose-300">{error}</p>}

            <motion.button whileTap={{ scale: 0.99 }} onClick={submit} disabled={!file}
              className="mt-6 w-full rounded-xl bg-indigo-500 px-4 py-3.5 font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-500 disabled:shadow-none">
              Grade my resume
            </motion.button>

            <div className="mt-3 text-center">
              <button onClick={runSample} className="text-sm font-medium text-slate-400 underline decoration-white/20 underline-offset-4 transition hover:text-slate-200">
                or see a sample report →
              </button>
            </div>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">A copy of each upload is stored to run and improve this tool. {RUBRIC_CREDIT}</p>
          </motion.section>
        )}
      </AnimatePresence>

      <footer className="mt-12 text-center text-xs text-slate-600">Not affiliated with HackerRank. Rubric used under its MIT license.</footer>
    </main>
  );
}
