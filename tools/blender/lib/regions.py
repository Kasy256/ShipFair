"""Clothing regions from bone weights (pure: no bpy)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Mapping, Sequence


@dataclass(frozen=True)
class RegionRule:
    region: str
    pattern: re.Pattern[str]


def compile_region_map(config: Mapping[str, object]) -> tuple[list[RegionRule], str]:
    """Turn `art/config/region-map.json` into ordered rules plus the default region.

    Shape: `{"default": "TOP", "rules": [{"region": "SKIN", "patterns": ["^Head$", ...]}, ...]}`.
    Rules are tried in order; the first matching pattern wins.
    """
    rules: list[RegionRule] = []
    raw_rules = config.get("rules", [])
    if not isinstance(raw_rules, list):
        raise ValueError("region-map.json: 'rules' must be a list")
    for entry in raw_rules:
        if not isinstance(entry, dict):
            raise ValueError("region-map.json: each rule must be an object")
        region = str(entry["region"])
        for pattern in entry["patterns"]:
            rules.append(RegionRule(region, re.compile(str(pattern), re.IGNORECASE)))
    return rules, str(config.get("default", "TOP"))


def region_for_bone(bone: str, rules: Sequence[RegionRule], default: str) -> str:
    """Region of the first rule whose pattern matches `bone`, else `default`."""
    for rule in rules:
        if rule.pattern.search(bone):
            return rule.region
    return default


def dominant_bone(
    face_vertices: Sequence[int], vertex_weights: Sequence[Mapping[str, float]]
) -> str | None:
    """Bone with the largest summed weight over a face's vertices (ties: alphabetical)."""
    totals: dict[str, float] = {}
    for v in face_vertices:
        for bone, w in vertex_weights[v].items():
            totals[bone] = totals.get(bone, 0.0) + w
    if not totals:
        return None
    return max(sorted(totals), key=lambda b: totals[b])


def face_regions(
    faces: Sequence[Sequence[int]],
    vertex_weights: Sequence[Mapping[str, float]],
    rules: Sequence[RegionRule],
    default: str,
) -> list[str]:
    """Region per face, from each face's dominant deform bone."""
    out: list[str] = []
    for verts in faces:
        bone = dominant_bone(verts, vertex_weights)
        out.append(default if bone is None else region_for_bone(bone, rules, default))
    return out
