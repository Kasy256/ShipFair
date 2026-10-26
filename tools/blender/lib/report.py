"""Structured step results, written as JSON for the Node runner to read."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


class Report:
    """Collects warnings, errors and stats for one step. `ok` is true when there are no errors."""

    def __init__(self, step: str) -> None:
        self.step = step
        self.warnings: list[str] = []
        self.errors: list[str] = []
        self.stats: dict[str, Any] = {}
        self.skipped = False
        self._t0 = time.perf_counter()

    def warn(self, message: str) -> None:
        print(f"[{self.step}] WARN {message}", flush=True)
        self.warnings.append(message)

    def error(self, message: str) -> None:
        print(f"[{self.step}] ERROR {message}", flush=True)
        self.errors.append(message)

    def info(self, message: str) -> None:
        print(f"[{self.step}] {message}", flush=True)

    def skip(self, reason: str) -> None:
        """Mark the step as skipped (e.g. a missing pack). Skips are warnings, not errors."""
        self.skipped = True
        self.warn(f"skipped: {reason}")

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "step": self.step,
            "ok": self.ok,
            "skipped": self.skipped,
            "seconds": round(time.perf_counter() - self._t0, 2),
            "warnings": self.warnings,
            "errors": self.errors,
            "stats": self.stats,
        }

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2) + "\n", encoding="utf-8")
