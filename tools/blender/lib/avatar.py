"""Avatar contract maths: colour slots, mask zones, bone cut planes, family coverage (pure: no bpy).

Values come from `art/contract.json` → `avatar`; `AVATAR_DEFAULTS` is what a missing block is
filled with. Vectors are plain (x, y, z) tuples so this module runs and tests without Blender.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

Vec = tuple[float, float, float]

AVATAR_DEFAULTS: dict[str, Any] = {
    "attributes": {"region": "_REGION", "mask": "_MASK", "uvPrint": "_UV_PRINT",
                   "note": "FACE-domain float attributes (corner for _UV_PRINT); the exporter splits vertices where they change, so every triangle has one region and one mask. three.js GLTFLoader names them _region, _mask and _uv_print."},
    "regions": {"SKIN": 0, "TOP": 1, "TOP2": 2, "BOTTOM": 3, "BOTTOM2": 4, "SHOES": 5, "SHOES2": 6,
                "HAIR": 7, "BROWS": 8, "EYES": 9, "ACCENT": 10, "ACCENT2": 11, "ACCESSORY": 12},
    "regionsNote": "13-15 reserved. ACCESSORY (12) keeps the accessory colour separate from headwear (ACCENT/ACCENT2), so a cap and headphones can differ.",
    "colorSlots": 16,
    "bodyMask": {"torso": 1, "upperarm": 2, "forearm": 4, "hand": 8, "hips": 16, "thigh": 32, "calf": 64,
                 "foot": 128, "neck": 256, "head": 512, "upperarm_lo": 1024, "knee": 2048, "calf_lo": 4096,
                 "shoulder": 8192},
    "maskRules": [
        {"zone": "head", "patterns": ["^head$"]},
        {"zone": "neck", "patterns": ["^neck_\\d+$"]},
        {"zone": "hand", "patterns": ["^hand_[lr]$", "^(thumb|index|middle|ring|pinky)_\\d+(_leaf)?_[lr]$"]},
        {"zone": "forearm", "patterns": ["^lowerarm_[lr]$"]},
        {"zone": "upperarm", "patterns": ["^upperarm_[lr]$"]},
        {"zone": "torso", "patterns": ["^spine_\\d+$", "^clavicle_[lr]$"]},
        {"zone": "hips", "patterns": ["^pelvis$", "^root$"]},
        {"zone": "thigh", "patterns": ["^thigh_[lr]$"]},
        {"zone": "calf", "patterns": ["^calf_[lr]$"]},
        {"zone": "foot", "patterns": ["^foot_[lr]$", "^ball(_leaf)?_[lr]$"]},
    ],
    "maskSplits": [
        {"zone": "upperarm_lo", "from": "upperarm", "plane": {"from": "upperarm_{s}", "to": "lowerarm_{s}", "t": 0.5},
         "why": "short sleeves end halfway down the upper arm"},
        {"zone": "knee", "from": "thigh", "plane": {"from": "thigh_{s}", "to": "calf_{s}", "t": 0.55},
         "why": "shorts end above the knee"},
        {"zone": "calf_lo", "from": "calf", "plane": {"from": "calf_{s}", "to": "foot_{s}", "fromEndM": 0.12},
         "why": "boots cover the lowest 12 cm of the calf"},
        {"zone": "shoulder", "from": "torso", "plane": {"from": "clavicle_{s}", "to": "upperarm_{s}", "t": 0.6, "radiusM": 0.15},
         "why": "a tank top's arm holes reach under the arm"},
    ],
    "hairMask": {"crown": 1, "sides": 2, "back": 4, "length": 8},
    "budgets": {"garment": 2500, "hair": 2500, "hairLong": 3000, "facial": 800, "headwear": 1500,
                "accessory": 600, "avatarLod0": 26000, "avatarLod1": 7500, "bodyDecimatedTris": 11000},
    "poseTest": {"clips": [["idle", 0.3], ["walk", 0.25], ["run", 0.3], ["jump_air", 0.5],
                           ["emote_wave", 0.5], ["emote_dance", 0.4]],
                 "substitutes": {"emote_wave": "sit_idle"}, "maxPenetrationCm": 1.0},
    "print": {"bone": "spine_03", "offsetM": [0.0, 0.0, 0.05], "sizeM": 0.26},
    "families": {"required": ["straight", "wavy", "curly", "coily", "protective"], "minStyles": 5},
}


def mask_bit(cfg: Mapping[str, Any], zone: str) -> int:
    return int(cfg["bodyMask"][zone])


def bits(cfg_mask: Mapping[str, int], zones: Iterable[str]) -> int:
    """OR of the named zone bits; unknown names raise so config typos fail loudly."""
    out = 0
    for z in zones:
        if z not in cfg_mask:
            raise KeyError(f"unknown mask zone {z!r}; known: {sorted(cfg_mask)}")
        out |= int(cfg_mask[z])
    return out


def zone_names(cfg_mask: Mapping[str, int], value: int) -> list[str]:
    return [name for name, bit in cfg_mask.items() if value & int(bit)]


@dataclass(frozen=True)
class ZoneRule:
    zone: str
    pattern: re.Pattern[str]


def compile_mask_rules(cfg: Mapping[str, Any]) -> list[ZoneRule]:
    return [ZoneRule(str(r["zone"]), re.compile(p, re.IGNORECASE)) for r in cfg["maskRules"] for p in r["patterns"]]


def zone_for_bone(bone: str | None, rules: Sequence[ZoneRule], default: str = "torso") -> str:
    if bone is None:
        return default
    for r in rules:
        if r.pattern.search(bone):
            return r.zone
    return default


# -- planes --------------------------------------------------------------------------------------


def _sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mul(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a: Vec) -> Vec:
    n = math.sqrt(dot(a, a))
    if n == 0:
        raise ValueError("zero-length direction")
    return _mul(a, 1 / n)


@dataclass(frozen=True)
class Plane:
    """`point` on the plane, unit `normal` pointing to the side that gets cut away (or split off).

    A plane may be limited to points within `radius` of an axis line (`axis_point`, `axis_dir`),
    e.g. a collar cut that must not touch the shoulders.
    """

    point: Vec
    normal: Vec
    side: str = ""  # "l", "r" or "" (both halves)
    radius: float = 0.0
    axis_point: Vec = (0.0, 0.0, 0.0)
    axis_dir: Vec = (0.0, 0.0, 1.0)
    span: tuple[float, float] = (-math.inf, math.inf)

    def distance(self, p: Vec) -> float:
        return dot(_sub(p, self.point), self.normal)

    def applies(self, p: Vec) -> bool:
        """Side-specific planes only act on their own half (x > 0 is the character's left)."""
        if self.side == "l" and p[0] <= 0:
            return False
        if self.side == "r" and p[0] >= 0:
            return False
        if self.radius > 0:
            d = _sub(p, self.axis_point)
            along = dot(d, self.axis_dir)
            if not self.span[0] <= along <= self.span[1]:
                return False
            off = _sub(d, _mul(self.axis_dir, along))
            if dot(off, off) > self.radius * self.radius:
                return False
        return True

    def outside(self, p: Vec) -> bool:
        return self.applies(p) and self.distance(p) > 0


def expand_sides(spec: Mapping[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """A spec with `{s}` in a bone name becomes a left and a right copy."""
    text = repr(spec)
    if "{s}" not in text:
        return [("", dict(spec))]
    out = []
    for s in ("l", "r"):
        out.append((s, {k: (v.replace("{s}", s) if isinstance(v, str) else v) for k, v in spec.items()}))
    return out


def resolve_bone(heads: Mapping[str, Vec], name: str) -> Vec:
    if name in heads:
        return heads[name]
    lower = {k.lower(): v for k, v in heads.items()}
    if name.lower() in lower:
        return lower[name.lower()]
    raise KeyError(f"bone {name!r} not in skeleton")


def plane_from_spec(spec: Mapping[str, Any], heads: Mapping[str, Vec], side: str = "") -> Plane:
    """Build a cut/split plane from bone heads.

    Two forms:
    - along a bone: `{"from": "upperarm_l", "to": "lowerarm_l", "t": 0.5, "shiftM": 0.02}`. The plane
      sits at `t` of the way from one bone head to the next (or `fromEndM` metres before `to`), moved
      `shiftM` further along; its normal points towards `to`, so the `to` side is cut away.
    - a level: `{"level": "pelvis", "shiftM": -0.05, "keep": "above"}`. A horizontal plane at the
      bone head's height plus `shiftM`; `keep` says which side stays.
    """
    shift = float(spec.get("shiftM", 0.0))
    if "level" in spec:
        p = resolve_bone(heads, str(spec["level"]))
        z = p[2] + shift
        keep = spec.get("keep", "below")
        if keep not in ("above", "below"):
            raise ValueError(f"level keep must be above or below, got {keep!r}")
        n: Vec = (0.0, 0.0, 1.0) if keep == "below" else (0.0, 0.0, -1.0)
        return Plane((0.0, 0.0, z), n, side, float(spec.get("radiusM", 0.0)), p, (0.0, 0.0, 1.0))
    a = resolve_bone(heads, str(spec["from"]))
    b = resolve_bone(heads, str(spec["to"]))
    d = _sub(b, a)
    length = math.sqrt(dot(d, d))
    n = norm(d)
    if "fromEndM" in spec:
        point = _sub(b, _mul(n, float(spec["fromEndM"])))
    else:
        point = _add(a, _mul(d, float(spec.get("t", 0.5))))
    point = _add(point, _mul(n, shift))
    axis = n
    if spec.get("keep") == "to":
        n = _mul(n, -1)
    if length == 0:
        raise ValueError(f"bones {spec['from']} and {spec['to']} share a head")
    return Plane(point, n, side, float(spec.get("radiusM", 0.0)), a, axis)


def planes_from_specs(specs: Iterable[Mapping[str, Any]], heads: Mapping[str, Vec]) -> list[Plane]:
    out: list[Plane] = []
    for spec in specs:
        for side, s in expand_sides(spec):
            out.append(plane_from_spec(s, heads, side))
    return out


def face_zone(dominant: str | None, centre: Vec, rules: Sequence[ZoneRule], splits: Sequence[tuple[str, str, Plane]]) -> str:
    """Zone of one body face: its dominant bone's zone, then any split plane it lies beyond."""
    zone = zone_for_bone(dominant, rules)
    for src, new, plane in splits:
        if zone == src and plane.outside(centre):
            zone = new
    return zone


def compile_splits(cfg: Mapping[str, Any], heads: Mapping[str, Vec]) -> list[tuple[str, str, Plane]]:
    out = []
    for s in cfg.get("maskSplits", []):
        for side, spec in expand_sides(s["plane"]):
            out.append((str(s["from"]), str(s["zone"]), plane_from_spec(spec, heads, side)))
    return out


# -- hair mask -----------------------------------------------------------------------------------


def hair_zone(p: Vec, band_z: float, ear_z: float, centre_y: float, centre_x_half: float) -> str:
    """crown above the band, length below the ear line, otherwise sides (|x| wide) or back."""
    if p[2] >= band_z:
        return "crown"
    if p[2] < ear_z:
        return "length"
    if p[1] > centre_y and abs(p[0]) < centre_x_half:
        return "back"
    return "sides"


# -- catalogue rules -----------------------------------------------------------------------------


def family_coverage(styles: Sequence[Mapping[str, Any]], required: Sequence[str], minimum: int) -> list[str]:
    """Problems with the catalogue's spread. Empty list = coverage rule met.

    Each required family needs `minimum` styles, at least one short (buzz/short) and one long
    (medium/long, or a large-volume style for coily).
    """
    problems = []
    for fam in required:
        group = [s for s in styles if s.get("family") == fam]
        if len(group) < minimum:
            problems.append(f"{fam}: {len(group)} styles (need {minimum})")
        if not any(s.get("length") in ("buzz", "short") for s in group):
            problems.append(f"{fam}: no short style")
        longish = [s for s in group if s.get("length") in ("medium", "long") or (fam == "coily" and s.get("capIncompatible"))]
        if not longish:
            problems.append(f"{fam}: no long or large-volume style")
    return problems


def budget_for(kind: str, item: Mapping[str, Any], budgets: Mapping[str, int]) -> int:
    """Triangle budget for one item: its own `budget_tris`, capped by the contract budget."""
    key = {"top": "garment", "bottom": "garment", "shoes": "garment", "accessory": "accessory",
           "hair": "hair", "facial": "facial", "headwear": "headwear"}[kind]
    cap = int(budgets[key])
    if kind == "hair" and item.get("longBudget"):
        cap = int(budgets["hairLong"])
    own = item.get("budget_tris")
    return min(int(own), cap) if own else cap


def worst_case(parts: Mapping[str, Sequence[int]]) -> tuple[int, dict[str, int]]:
    """Sum of the largest triangle count per slot (`{"body": [..], "top": [..], ...}`)."""
    picks = {k: max(v) if v else 0 for k, v in parts.items()}
    return sum(picks.values()), picks
