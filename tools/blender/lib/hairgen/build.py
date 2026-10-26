"""Turn one catalogue entry (`art/config/hair.json`) into a bound, weighted, attributed object."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import bmesh
import bpy

from ..attributes import set_face_attr
from ..avatar import hair_zone
from ..garment import decimate
from ..hairfit import fit_hair
from ..palette import flat_material
from ..rig import assign, bind
from ..scene import delete_objects, triangle_count
from .base import HairCtx, Piece
from .clumps import clumps
from .scalp import scalp
from .strands import strands
from .volume import bun, volume
from .wrap import band, brim, pleats, wraps

BLOCKS = {"scalp": scalp, "volume": volume, "bun": bun, "strands": strands, "clumps": clumps, "brim": brim,
          "pleats": pleats}


def add_quaternius(ctx: HairCtx, piece: Piece, path: Path, fit_cfg: Mapping[str, Any], region: str) -> list[Any]:
    """Re-fit a pack hair to this head and copy its mesh into the piece."""
    obj, info = fit_hair(path, ctx.rig.arm, ctx.hf.head_bone, dict(fit_cfg), flat_material("HAIR"))
    if obj is None:
        raise RuntimeError(f"{path.name} did not fit: {info.get('rejected')}")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    for layer in list(bm.verts.layers.deform):
        bm.verts.layers.deform.remove(layer)
    faces = piece.merge(bm, region)
    bm.free()
    delete_objects([obj])
    return faces


def build_piece(ctx: HairCtx, style: Mapping[str, Any], pack_files: Mapping[str, Path], fit_cfg: Mapping[str, Any]) -> Piece:
    piece = Piece()
    for part in style.get("parts", []):
        kind = part["block"]
        region = part.get("region", style.get("region", "HAIR"))
        if kind == "quaternius":
            if part["name"] not in pack_files:
                raise RuntimeError(f"Quaternius hair {part['name']} not found in the pack")
            faces = add_quaternius(ctx, piece, pack_files[part["name"]], fit_cfg, region)
        elif kind == "wraps":
            faces = wraps(ctx, piece, part)
        else:
            faces = BLOCKS[kind](ctx, piece, part, region)
        if part.get("band"):
            band(ctx, piece, faces, part["band"])
    return piece


def z_weights(ctx: HairCtx, z: float, mode: str) -> dict[str, float]:
    """Short styles follow the head; long ones blend head -> neck_01 -> spine_03 down their length."""
    rig = ctx.rig
    head = next(b for b in rig.joints if b.lower() == "head")
    if mode == "head":
        return {head: 1.0}
    zh, zn, zs = ctx.hf.head_bone.z, ctx.hf.neck_bone.z, rig.bone("spine_03").z + 0.08
    if z >= zh:
        return {head: 1.0}
    if z >= zn:
        t = (z - zn) / max(1e-6, zh - zn)
        return {head: t, "neck_01": 1 - t}
    if z >= zs:
        t = (z - zs) / max(1e-6, zn - zs)
        return {"neck_01": t, "spine_03": 1 - t}
    return {"spine_03": 1.0}


def to_object(ctx: HairCtx, piece: Piece, name: str, kind: str, style: Mapping[str, Any], budget: int) -> bpy.types.Object:
    avatar = ctx.avatar
    bmesh.ops.remove_doubles(piece.bm, verts=piece.bm.verts, dist=1e-6)
    me = bpy.data.meshes.new(name)
    piece.bm.to_mesh(me)
    names = list(piece.names)
    piece.bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = True
    decimate(obj, budget)
    me = obj.data
    raw = me.attributes["region"]
    idx = [0] * len(raw.data)
    raw.data.foreach_get("value", idx)
    set_face_attr(obj, avatar["attributes"]["region"], [avatar["regions"][names[i]] for i in idx])
    me.attributes.remove(me.attributes["region"])
    hf = ctx.hf
    masks = []
    for p in me.polygons:
        c = obj.matrix_world @ p.center
        if kind == "hair":
            zone = hair_zone(tuple(c), hf.band_z(c), hf.ear_top_z - 0.01, hf.centre.y, hf.half_w * 0.6)
            masks.append(avatar["hairMask"][zone])
        else:
            masks.append(0)
    set_face_attr(obj, avatar["attributes"]["mask"], masks)
    mode = style.get("weights", "head")
    groups: dict[str, bpy.types.VertexGroup] = {}
    for v in me.vertices:
        assign(obj, groups, v.index, z_weights(ctx, (obj.matrix_world @ v.co).z, mode))
    bind(obj, ctx.rig)
    return obj


def build_style(ctx: HairCtx, style: Mapping[str, Any], kind: str, budget: int, pack_files: Mapping[str, Path],
                fit_cfg: Mapping[str, Any]) -> bpy.types.Object:
    piece = build_piece(ctx, style, pack_files, fit_cfg)
    obj = to_object(ctx, piece, style["id"], kind, style, budget)
    if triangle_count(obj) > budget:
        decimate(obj, int(budget * 0.97))
    return obj
