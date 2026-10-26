"""Procedural booth-kit parts (bmesh). Sizes in metres; each part's origin is its base centre
unless noted. The booth front faces -Y in Blender (+Z in three.js)."""

from __future__ import annotations

import math
from typing import Callable

from lib.shapes import PartBuilder, face_towards, rounded_rect

BEVEL = 0.03
FLOOR_W, FLOOR_D, FLOOR_TOP = 9.8, 7.8, 0.18
WALL_H, WALL_T = 3.0, 0.16
SIDE_D, SIDE_H, SIDE_T = 3.2, 2.6, 0.12
SCREEN_IN = (1.92, 1.08)  # 16:9
SCREEN_FRAME, SCREEN_T = 0.05, 0.06
SIGN_IN = (3.12, 0.52)
SIGN_FRAME, SIGN_T = 0.09, 0.08
ROOF_D, ROOF_RISE, ROOF_T = 3.4, 0.25, 0.1
RING_R, RING_r, RING_DROP = 1.1, 0.05, 0.4
STAGE_W, STAGE_D, STAGE_H = 12.0, 3.2, 0.35


def _platform(b: PartBuilder, w: float, d: float) -> None:
    """Floating platform: dark recessed plinth, bevelled slab with a raised edge lip, glow strip."""
    inset = 0.25
    b.box((-w / 2 + inset, -d / 2 + inset, 0), (w / 2 - inset, d / 2 - inset, 0.045), "charcoal")
    b.box((-w / 2, -d / 2, 0.04), (w / 2, d / 2, FLOOR_TOP), "wall", bevel=BEVEL, bevel_key="wall")
    top = face_towards(list(b.bm.faces), (0, 0, 1))
    b.inset(top, thickness=0.1, depth=-0.015, rim_key="wall", inner_key="ground")
    y = -d / 2 + inset - 0.012
    b.box((-w / 2 + inset + 0.1, y - 0.012, 0.008), (w / 2 - inset - 0.1, y, 0.03), "GLOW")


def kit_floor(b: PartBuilder) -> None:
    _platform(b, FLOOR_W, FLOOR_D)


def kit_stage(b: PartBuilder) -> None:
    """Two-lot platform with a rounded-front raised stage at the back and a front step."""
    _platform(b, 2 * FLOOR_W + 0.2, FLOOR_D)
    y0 = FLOOR_D / 2 - 0.3 - STAGE_D / 2
    prof = [(x, y + y0) for x, y in rounded_rect(STAGE_W, STAGE_D, 1.2, 4)]
    b.prism(prof, FLOOR_TOP, FLOOR_TOP + STAGE_H, "Z", "wall", "ground")
    sy = y0 - STAGE_D / 2
    b.box((-1.5, sy - 0.4, FLOOR_TOP), (1.5, sy + 0.02, FLOOR_TOP + STAGE_H / 2), "wall", bevel=0.02)
    b.box((-STAGE_W / 2 + 1.2, sy - 0.01, FLOOR_TOP + STAGE_H - 0.06),
          (STAGE_W / 2 - 1.2, sy + 0.005, FLOOR_TOP + STAGE_H - 0.03), "GLOW")


def kit_wall_back(b: PartBuilder) -> None:
    """Back wall panel in a slim aluminium frame, glow strip along the top. Origin: base centre."""
    b.box((-FLOOR_W / 2, -WALL_T / 2, 0), (FLOOR_W / 2, WALL_T / 2, WALL_H), "frame", bevel=0.02)
    front = face_towards(list(b.bm.faces), (0, -1, 0))
    b.inset(front, thickness=0.05, depth=-0.012, rim_key="frame", inner_key="wall")
    b.box((-FLOOR_W / 2 + 0.1, -WALL_T / 2 - 0.03, WALL_H - 0.08),
          (FLOOR_W / 2 - 0.1, -WALL_T / 2 - 0.005, WALL_H - 0.05), "GLOW")


def kit_wall_side(b: PartBuilder) -> None:
    """Short side fin, rounded front edge, ACCENT faces, glow edge strip. Origin: base centre."""
    r = SIDE_T / 2
    prof = [(-r, SIDE_D / 2), (-r, -SIDE_D / 2 + r)]
    prof += [(r * math.cos(a), -SIDE_D / 2 + r + r * math.sin(a))
             for a in (math.pi + math.pi * i / 4 for i in range(1, 4))]
    prof += [(r, -SIDE_D / 2 + r), (r, SIDE_D / 2)]
    b.prism(prof, 0, SIDE_H, "Z", "ACCENT", "frame")
    b.box((-0.012, -SIDE_D / 2 - 0.006, 0.15), (0.012, -SIDE_D / 2 + 0.018, SIDE_H - 0.15), "GLOW")


def kit_counter(b: PartBuilder) -> None:
    """Rounded-front counter: dark plinth, white body with an ACCENT stripe, overhanging top."""
    w, d, h = 2.4, 0.7, 1.05
    segs = 4
    plinth = rounded_rect(w - 0.08, d - 0.08, 0.26, segs)
    body = rounded_rect(w, d, 0.3, segs)
    top = rounded_rect(w + 0.06, d + 0.06, 0.33, segs)
    b.prism(plinth, 0, 0.08, "Z", "charcoal", "charcoal")
    b.prism(body, 0.08, 0.72, "Z", "wall", "wall")
    b.prism(body, 0.72, 0.84, "Z", "ACCENT", "wall")
    b.prism(body, 0.84, h - 0.05, "Z", "wall", "wall")
    b.prism(top, h - 0.05, h, "Z", "frame", "ground")


def _framed_panel(b: PartBuilder, inner: tuple[float, float], frame: float, thick: float,
                  inner_key: str) -> None:
    """Frame around a recessed panel facing -Y. Origin: panel centre."""
    w, h = inner[0] + 2 * frame, inner[1] + 2 * frame
    b.box((-w / 2, -thick / 2, -h / 2), (w / 2, thick / 2, h / 2), "frame", bevel=0.012)
    front = face_towards(list(b.bm.faces), (0, -1, 0))
    b.inset(front, thickness=frame - 0.012, depth=-0.008, rim_key="frame", inner_key=inner_key)


def kit_screen(b: PartBuilder) -> None:
    _framed_panel(b, SCREEN_IN, SCREEN_FRAME, SCREEN_T, "charcoal")


def kit_sign(b: PartBuilder) -> None:
    _framed_panel(b, SIGN_IN, SIGN_FRAME, SIGN_T, "charcoal")
    w = SIGN_IN[0] + 2 * SIGN_FRAME
    zb = -(SIGN_IN[1] / 2 + SIGN_FRAME)
    b.box((-w / 2 + 0.1, -SIGN_T / 2 - 0.02, zb - 0.025), (w / 2 - 0.1, -SIGN_T / 2 + 0.01, zb), "GLOW")


def kit_ring(b: PartBuilder) -> None:
    """Glowing torus hung on three thin cables. Origin: ring centre."""
    b.torus((0, 0, 0), RING_R, RING_r, 24, 6, "GLOW")
    for i in range(3):
        a = 2 * math.pi * i / 3 + math.pi / 2
        b.cylinder((RING_R * math.cos(a), RING_R * math.sin(a), RING_r * 0.5), RING_DROP, 0.008, 6, "charcoal")


def kit_roof(b: PartBuilder) -> None:
    """Canopy curving gently up toward the front. Origin: back edge, underside, centre."""
    n = 8
    top, bottom = [], []
    for i in range(n + 1):
        t = i / n
        y = -ROOF_D * t
        z = ROOF_RISE * t * t
        bottom.append((y, z))
        top.append((y, z + ROOF_T))
    prof = bottom + list(reversed(top))  # (y, z), runs forward along the underside then back on top
    keys = ["ground"] * n + ["ACCENT"] + ["wall"] * n + ["frame"]
    b.prism(prof, -FLOOR_W / 2, FLOOR_W / 2, "X", keys, "frame")
    yf, zf = -ROOF_D, ROOF_RISE
    b.box((-FLOOR_W / 2 + 0.1, yf + 0.02, zf - 0.03), (FLOOR_W / 2 - 0.1, yf + 0.06, zf), "GLOW")


PARTS: dict[str, Callable[[PartBuilder], None]] = {
    "kit_floor": kit_floor,
    "kit_wall_back": kit_wall_back,
    "kit_wall_side": kit_wall_side,
    "kit_counter": kit_counter,
    "kit_screen": kit_screen,
    "kit_sign": kit_sign,
    "kit_ring": kit_ring,
    "kit_roof": kit_roof,
    "kit_stage": kit_stage,
}
