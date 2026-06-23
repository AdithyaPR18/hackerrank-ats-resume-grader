"""CLI: grade a resume PDF end-to-end and print an auditable breakdown.

    python -m app.cli path/to/resume.pdf [--redact] [--no-quick-wins] [--json]
"""
from __future__ import annotations

import argparse
import json
import sys

from .models import CATEGORY_LABELS, Evaluation, TOTAL_MAX
from .pdf_parser import extract_text_from_path

try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text

    _RICH = True
except ImportError:  # rich is optional; degrade to plain text
    _RICH = False


CREDIT = (
    "Scored against HackerRank's open-sourced hiring-agent rubric "
    "(interviewstreet/hiring-agent, MIT license) — this reflects how that specific "
    "system evaluates resumes, not a universal ATS standard."
)


def _bar(score: int, maximum: int, width: int = 24) -> str:
    filled = int(round((score / maximum) * width)) if maximum else 0
    return "█" * filled + "░" * (width - filled)


def _render_plain(ev: Evaluation) -> None:
    print(f"\n{'='*70}\nRESUME GRADE: {ev.total_score} / {TOTAL_MAX}\n{'='*70}")
    print(CREDIT + "\n")
    if ev.candidate_name:
        print(f"Candidate: {ev.candidate_name}\n")
    for key, cat in ev.scores.items():
        print(f"{CATEGORY_LABELS[key]:<18} {cat.score:>3}/{cat.max:<3} {_bar(cat.score, cat.max)}")
        for e in cat.evidence:
            sign = f"{e.points:+d}"
            q = f'"{e.quote}" ' if e.quote else ""
            print(f"    [{sign:>4}] {q}-> {e.reason}")
    print(f"\nBonus:      +{ev.bonus.total}")
    for e in ev.bonus.items:
        print(f"    [{e.points:+d}] {e.reason}")
    print(f"Deductions: -{ev.deductions.total}")
    for e in ev.deductions.items:
        print(f"    [-{abs(e.points)}] {e.reason}")
    print(f"\nCategory subtotal {ev.category_subtotal} + bonus {ev.bonus.total} "
          f"- deductions {ev.deductions.total} = {ev.total_score}/{TOTAL_MAX}")

    print("\nKey strengths:")
    for s in ev.key_strengths:
        print(f"  • {s}")
    print("Areas for improvement:")
    for a in ev.areas_for_improvement:
        print(f"  • {a}")
    if ev.quick_wins:
        print("\nQUICK WINS (biggest honest point gain first):")
        for w in ev.quick_wins:
            print(f"  +{w.estimated_point_gain} pts [{w.affected_category}] {w.fix}")
            if w.rationale:
                print(f"        {w.rationale}")
    print()


def _render_rich(ev: Evaluation) -> None:
    console = Console()
    color = "green" if ev.total_score >= 80 else "yellow" if ev.total_score >= 50 else "red"
    header = Text(f"{ev.total_score} / {TOTAL_MAX}", style=f"bold {color}")
    if ev.candidate_name:
        header.append(f"\n{ev.candidate_name}", style="dim")
    console.print(Panel(header, title="Resume Grade", subtitle=CREDIT, expand=False))

    for key, cat in ev.scores.items():
        t = Table(show_header=False, box=None, padding=(0, 1))
        t.add_row(
            Text(CATEGORY_LABELS[key], style="bold"),
            f"{cat.score}/{cat.max}",
            _bar(cat.score, cat.max),
        )
        console.print(t)
        for e in cat.evidence:
            style = "green" if e.points > 0 else "red" if e.points < 0 else "dim"
            q = f'[italic]"{e.quote}"[/italic] ' if e.quote else ""
            console.print(f"   [{style}]{e.points:+d}[/{style}]  {q}→ {e.reason}", highlight=False)

    console.print(f"\n[bold green]Bonus +{ev.bonus.total}[/bold green]")
    for e in ev.bonus.items:
        console.print(f"   [green]{e.points:+d}[/green]  {e.reason}", highlight=False)
    console.print(f"[bold red]Deductions -{ev.deductions.total}[/bold red]")
    for e in ev.deductions.items:
        console.print(f"   [red]-{abs(e.points)}[/red]  {e.reason}", highlight=False)

    console.print(
        f"\n[dim]Category subtotal {ev.category_subtotal} + bonus {ev.bonus.total} "
        f"- deductions {ev.deductions.total} = [/dim][bold]{ev.total_score}/{TOTAL_MAX}[/bold]"
    )

    if ev.key_strengths:
        console.print("\n[bold]Key strengths[/bold]")
        for s in ev.key_strengths:
            console.print(f"  • {s}")
    if ev.areas_for_improvement:
        console.print("[bold]Areas for improvement[/bold]")
        for a in ev.areas_for_improvement:
            console.print(f"  • {a}")

    if ev.quick_wins:
        console.print("\n[bold underline]Quick wins[/bold underline] [dim](biggest honest gain first)[/dim]")
        for w in ev.quick_wins:
            console.print(
                f"  [bold cyan]+{w.estimated_point_gain}[/bold cyan] "
                f"[dim]({w.affected_category})[/dim] {w.fix}",
                highlight=False,
            )
            if w.rationale:
                console.print(f"        [dim]{w.rationale}[/dim]", highlight=False)
    console.print()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Grade a resume PDF against HackerRank's rubric.")
    parser.add_argument("pdf", help="Path to the resume PDF")
    parser.add_argument("--redact", action="store_true", help="Strip phone/email before sending to the LLM")
    parser.add_argument("--no-quick-wins", action="store_true", help="Skip the quick-wins pass")
    parser.add_argument("--json", action="store_true", help="Print raw JSON instead of a formatted report")
    args = parser.parse_args(argv)

    # Import here so --help works without an API key / SDK installed.
    from .evaluator import (
        evaluate_resume,
        extract_resume,
        generate_quick_wins,
        score_resume,
    )
    from .pdf_parser import redact_pii, restore_pii

    try:
        text = extract_text_from_path(args.pdf)
    except FileNotFoundError:
        print(f"File not found: {args.pdf}", file=sys.stderr)
        return 2
    if not text.strip():
        print("No extractable text in the PDF (scanned image?).", file=sys.stderr)
        return 2

    pii_map = {}
    if args.redact:
        text, pii_map = redact_pii(text)

    try:
        structured = extract_resume(text)
        ev = score_resume(structured, text)
        if not args.no_quick_wins:
            ev.quick_wins = generate_quick_wins(structured, ev)
        ev.recompute()
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1

    if args.redact and pii_map:
        ev = Evaluation.model_validate(restore_pii(ev.model_dump(), pii_map))

    if args.json:
        print(json.dumps(ev.model_dump(), indent=2, ensure_ascii=False))
    elif _RICH:
        _render_rich(ev)
    else:
        _render_plain(ev)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
