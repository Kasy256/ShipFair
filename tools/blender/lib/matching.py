"""Name matching for clips and bones (pure: no bpy)."""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field
from typing import Sequence


@dataclass(frozen=True)
class Pick:
    """The chosen name for one pattern list, plus other names that also matched."""

    chosen: str | None
    pattern: str | None
    alternatives: list[str] = field(default_factory=list)


def strip_suffix(name: str, suffix: str) -> str:
    """'Walk_Loop_Armature' -> 'Walk_Loop' for suffix '_Armature'."""
    return name[: -len(suffix)] if suffix and name.endswith(suffix) else name


def pick_name(patterns: Sequence[str], names: Sequence[str]) -> Pick:
    """First pattern (case-insensitive regex) with any match wins; the shortest match is chosen.

    Every other name that matched any pattern is returned as an alternative.
    """
    chosen: str | None = None
    chosen_pattern: str | None = None
    matched: list[str] = []
    for pattern in patterns:
        rx = re.compile(pattern, re.IGNORECASE)
        hits = sorted((n for n in names if rx.search(n)), key=lambda n: (len(n), n))
        for h in hits:
            if h not in matched:
                matched.append(h)
        if chosen is None and hits:
            chosen, chosen_pattern = hits[0], pattern
    return Pick(chosen, chosen_pattern, [m for m in matched if m != chosen])


def map_bones(source: Sequence[str], target: Sequence[str], cutoff: float = 0.75) -> dict[str, str]:
    """Map source bone names onto target names: exact, then case-insensitive, then similarity."""
    mapping: dict[str, str] = {}
    lower = {t.lower(): t for t in target}
    for s in source:
        if s in target:
            mapping[s] = s
        elif s.lower() in lower:
            mapping[s] = lower[s.lower()]
        else:
            close = difflib.get_close_matches(s, list(target), n=1, cutoff=cutoff)
            if close:
                mapping[s] = close[0]
    return mapping
