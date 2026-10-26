"""Write `_REGION` / `_MASK` face attributes and the `_UV_PRINT` corner attribute; read body zones."""

from __future__ import annotations

from typing import Any, Mapping, Sequence

import bpy
from mathutils import Vector

from .avatar import Vec, compile_mask_rules, compile_splits, face_zone
from .regions import dominant_bone


def set_face_attr(obj: bpy.types.Object, name: str, values: Sequence[float]) -> None:
    me = obj.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    attr = me.attributes.new(name, "FLOAT", "FACE")
    if len(values) != len(me.polygons):
        raise ValueError(f"{obj.name}: {len(values)} values for {len(me.polygons)} faces")
    attr.data.foreach_set("value", [float(v) for v in values])


def fill_face_attr(obj: bpy.types.Object, name: str, value: float) -> None:
    set_face_attr(obj, name, [value] * len(obj.data.polygons))


def face_attr(obj: bpy.types.Object, name: str) -> list[float]:
    attr = obj.data.attributes.get(name)
    if attr is None:
        return [0.0] * len(obj.data.polygons)
    out = [0.0] * len(attr.data)
    attr.data.foreach_get("value", out)
    return out


def set_corner_uv(obj: bpy.types.Object, name: str, uvs: Sequence[tuple[float, float]]) -> None:
    me = obj.data
    if name in me.attributes:
        me.attributes.remove(me.attributes[name])
    attr = me.attributes.new(name, "FLOAT2", "CORNER")
    flat = [c for uv in uvs for c in uv]
    attr.data.foreach_set("vector", flat)


def bone_heads(arm: bpy.types.Object) -> dict[str, Vec]:
    """World-space head of every bone, as plain tuples for `lib.avatar`."""
    mw = arm.matrix_world
    return {b.name: tuple(mw @ b.head_local) for b in arm.data.bones}  # type: ignore[misc]


def vertex_weights(obj: bpy.types.Object, deform: set[str]) -> list[dict[str, float]]:
    names = {g.index: g.name for g in obj.vertex_groups}
    out: list[dict[str, float]] = []
    for v in obj.data.vertices:
        w: dict[str, float] = {}
        for g in v.groups:
            n = names.get(g.group)
            if n in deform and g.weight > 0:
                w[n] = g.weight
        out.append(w)
    return out


def body_zones(body: bpy.types.Object, arm: bpy.types.Object, cfg: Mapping[str, Any]) -> list[str]:
    """Mask zone per body face: dominant deform bone, refined by the contract's split planes."""
    deform = {b.name for b in arm.data.bones if b.use_deform}
    weights = vertex_weights(body, deform)
    rules = compile_mask_rules(cfg)
    splits = compile_splits(cfg, bone_heads(arm))
    mw = body.matrix_world
    out = []
    for p in body.data.polygons:
        centre = tuple(mw @ p.center)
        out.append(face_zone(dominant_bone(list(p.vertices), weights), centre, rules, splits))  # type: ignore[arg-type]
    return out


def write_body_mask(body: bpy.types.Object, arm: bpy.types.Object, cfg: Mapping[str, Any]) -> dict[str, int]:
    """Set `_MASK` (zone bit) and `_REGION` = SKIN on every body face; returns faces per zone."""
    zones = body_zones(body, arm, cfg)
    bits = cfg["bodyMask"]
    set_face_attr(body, cfg["attributes"]["mask"], [bits[z] for z in zones])
    fill_face_attr(body, cfg["attributes"]["region"], cfg["regions"]["SKIN"])
    counts: dict[str, int] = {z: 0 for z in bits}
    for z in zones:
        counts[z] += 1
    return counts


def label_mesh(obj: bpy.types.Object, cfg: Mapping[str, Any], region: str, mask: int = 0) -> None:
    """One region and mask value for every face (eyes, brows, legacy hairs)."""
    fill_face_attr(obj, cfg["attributes"]["region"], cfg["regions"][region])
    fill_face_attr(obj, cfg["attributes"]["mask"], mask)


def world_centroid(obj: bpy.types.Object) -> Vector:
    mw = obj.matrix_world
    vs = obj.data.vertices
    return sum((mw @ v.co for v in vs), Vector()) / max(1, len(vs))
