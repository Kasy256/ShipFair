"""Mixamo -> our UE-mannequin rig: bone names, file picking and resample timing. Pure (no bpy)."""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from pathlib import Path

PREFIX = re.compile(r"^mixamorig\d*:", re.I)

_BODY = {
    "Hips": "pelvis",
    "Spine": "spine_01",
    "Spine1": "spine_02",
    "Spine2": "spine_03",
    "Neck": "neck_01",
    "Head": "head",
}
_SIDED = {
    "Shoulder": "clavicle",
    "Arm": "upperarm",
    "ForeArm": "lowerarm",
    "Hand": "hand",
    "UpLeg": "thigh",
    "Leg": "calf",
    "Foot": "foot",
    "ToeBase": "ball",
}
_FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")
_SIDED_RE = re.compile(r"^(Left|Right)(.+)$")
_FINGER_RE = re.compile(r"^Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$")


def target_name(mixamo_bone: str) -> str | None:
    """`mixamorig:LeftForeArm` -> `lowerarm_l`. End bones (HeadTop_End, *4, ToeEnd) map to None."""
    name = PREFIX.sub("", mixamo_bone)
    if name in _BODY:
        return _BODY[name]
    m = _SIDED_RE.match(name)
    if not m:
        return None
    side = "l" if m.group(1) == "Left" else "r"
    rest = m.group(2)
    if rest in _SIDED:
        return f"{_SIDED[rest]}_{side}"
    f = _FINGER_RE.match(rest)
    if f and f.group(2) in ("1", "2", "3"):
        return f"{f.group(1).lower()}_0{f.group(2)}_{side}"
    return None


def bone_map(source: Iterable[str], target: Sequence[str]) -> dict[str, str]:
    """Source bone -> target bone, matched case-insensitively (our head joint is `Head`)."""
    by_lower = {t.lower(): t for t in target}
    out: dict[str, str] = {}
    for s in source:
        t = target_name(s)
        if t is not None and t.lower() in by_lower:
            out[s] = by_lower[t.lower()]
    return out


def pick_file(patterns: Sequence[str], files: Sequence[Path]) -> Path | None:
    """First file (by pattern order, then name) whose stem matches a pattern, case-insensitive."""
    for pattern in patterns:
        hits = sorted((f for f in files if re.search(pattern, f.stem, re.I)), key=lambda f: f.name.lower())
        if hits:
            return hits[0]
    return None


def resample_times(start: float, end: float, src_fps: float, dst_fps: float) -> list[float]:
    """Source frames to sample so a clip keeps its duration at `dst_fps` (first and last included)."""
    duration = (end - start) / src_fps
    count = max(1, round(duration * dst_fps)) + 1
    return [min(end, start + i * src_fps / dst_fps) for i in range(count)]
