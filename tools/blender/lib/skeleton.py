"""Canonical joint frames shared by every body and the clip set.

The base bodies and the animation library use the same bone names but slightly different rest
orientations (up to ~13°). three.js plays clips by writing local rotations straight onto bones, so
every skeleton must share the clip skeleton's joint frames. We take the frames from the animation
library and re-orient each body's rest bones to them (heads stay put, so skinning is unchanged).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import bpy
from mathutils import Quaternion

from .discovery import Inventory
from .quat import angle_deg
from .scene import armatures, import_model, reset_scene, select_only

ANIM_PACK = "universal-animation-library"


def _source_file(inv: Inventory) -> Path | None:
    files = inv.find(ANIM_PACK, name="^UAL")
    preferred = [p for p in files if not re.search("_RM$", p.stem, re.I)]
    return (preferred or files or [None])[0]


def canonical_rest(inv: Inventory, cache_dir: Path) -> dict[str, list[float]] | None:
    """Rest rotation (armature space, w x y z) per bone from the animation library, cached."""
    if not inv.has_pack(ANIM_PACK):
        return None
    src = _source_file(inv)
    if src is None:
        return None
    cache = cache_dir / "skeleton.json"
    stamp = f"{src}|{src.stat().st_mtime_ns}"
    if cache.exists():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("stamp") == stamp:
            return data["bones"]
    reset_scene()
    arm = armatures(import_model(src))[0]
    bones = {b.name: list(b.matrix_local.to_quaternion()) for b in arm.data.bones}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"stamp": stamp, "source": src.name, "bones": bones}), encoding="utf-8")
    return bones


def rest_rotations(arm: bpy.types.Object) -> dict[str, list[float]]:
    return {b.name: list(b.matrix_local.to_quaternion()) for b in arm.data.bones}


def max_rest_diff(a: dict[str, list[float]], b: dict[str, list[float]]) -> tuple[float, str]:
    worst = (0.0, "")
    for name, q in a.items():
        if name in b:
            d = angle_deg(q, b[name])
            if d > worst[0]:
                worst = (d, name)
    return round(worst[0], 3), worst[1]


def reorient(arm: bpy.types.Object, canonical: dict[str, list[float]]) -> tuple[float, str]:
    """Give every bone the canonical rest orientation, keeping heads and lengths.

    Returns the largest change (degrees) and the bone it happened on.
    """
    before = rest_rotations(arm)
    select_only([arm])
    bpy.ops.object.mode_set(mode="EDIT")
    ebs = arm.data.edit_bones
    for eb in ebs:
        eb.use_connect = False
    for eb in ebs:
        q = canonical.get(eb.name)
        if q is None:
            continue
        head, length = eb.head.copy(), eb.length
        m = Quaternion(q).to_matrix().to_4x4()
        m.translation = head
        eb.matrix = m
        eb.length = length
    bpy.ops.object.mode_set(mode="OBJECT")
    return max_rest_diff(before, canonical)
