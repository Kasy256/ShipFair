"""Entry-point plumbing shared by every step script: args, paths, result file."""

from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .report import Report


@dataclass(frozen=True)
class Ctx:
    """Paths passed in by `tools/blender/run.ts` as one JSON argument after `--`."""

    step: str
    repo: Path
    art: Path
    packs: Path
    export: Path
    reports: Path
    previews: Path
    result: Path


def parse_ctx(argv: list[str]) -> Ctx:
    """Read the JSON object after `--` in Blender's argv."""
    if "--" not in argv:
        raise SystemExit("expected `-- <json-args>` after the script path (use pnpm art:*)")
    raw = json.loads(argv[argv.index("--") + 1])
    repo = Path(raw["repoRoot"])
    return Ctx(
        step=str(raw["step"]),
        repo=repo,
        art=repo / "art",
        packs=Path(raw["packsDir"]),
        export=Path(raw["exportDir"]),
        reports=Path(raw["reportsDir"]),
        previews=Path(raw["previewsDir"]),
        result=Path(raw["resultPath"]),
    )


def run_step(main: Callable[[Ctx, Report], None]) -> None:
    """Run `main`, always write the result JSON, and exit non-zero on errors."""
    ctx = parse_ctx(sys.argv)
    report = Report(ctx.step)
    try:
        main(ctx, report)
    except Exception as exc:  # noqa: BLE001 - every failure must reach the result file
        traceback.print_exc()
        report.error(f"{type(exc).__name__}: {exc}")
    report.write(ctx.result)
    print(f"[{ctx.step}] result -> {ctx.result}", flush=True)
    if not report.ok:
        sys.exit(1)
