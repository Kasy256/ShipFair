"""Fit a Quaternius hair model onto a body's head and skin it to the head bone."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector

from .scene import armatures, delete_objects, find_bone, import_model, meshes, triangle_count, world_bounds


def strip_extras(obj: bpy.types.Object) -> None:
    """Drop extra UV maps and colour attributes the tint-only materials never read."""
    me = obj.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[-1])
    while len(me.color_attributes):  # 3.6 invalidates references after each remove; refetch
        me.color_attributes.remove(me.color_attributes[0])


def set_single_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0


def fit_hair(path: Path, arm: bpy.types.Object, head_pos: Vector, cfg: dict[str, Any],
             hair_mat: bpy.types.Material) -> tuple[bpy.types.Object | None, dict[str, Any]]:
    """Import one hairstyle, move it onto this body's head and skin it to the head bone."""
    objs = import_model(path)
    hair_arms = armatures(objs)
    hair_meshes = meshes(objs)
    if not hair_meshes:
        delete_objects(objs)
        return None, {"file": path.name, "rejected": "no mesh"}
    hair = max(hair_meshes, key=triangle_count)
    delete_objects([m for m in hair_meshes if m is not hair])
    info: dict[str, Any] = {"file": path.name}
    if hair_arms:
        src_head = find_bone(hair_arms[0], "head")
        src = hair_arms[0].matrix_world @ src_head.head_local if src_head else head_pos
        offset = head_pos - src
        info["fit"] = "authored offset" if offset.length < 0.01 else f"moved {tuple(round(c, 3) for c in offset)} m to this head"
        hair.data.transform(hair.matrix_world)
        hair.matrix_world = Matrix.Identity(4)
        hair.data.transform(Matrix.Translation(offset))
        delete_objects(hair_arms)
    else:
        hair.data.transform(hair.matrix_world)
        hair.matrix_world = Matrix.Identity(4)
        lo, hi = world_bounds([hair])
        bottom = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        target = head_pos + Vector(cfg["hairFallbackOffsetM"])
        hair.data.transform(Matrix.Translation(target - bottom))
        info["fit"] = "bottom centre aligned to head bone"
        hair.vertex_groups.clear()
    head_bone = find_bone(arm, "head")
    head_name = head_bone.name if head_bone else "Head"
    if head_name not in hair.vertex_groups:
        for g in list(hair.vertex_groups):
            hair.vertex_groups.remove(g)
        vg = hair.vertex_groups.new(name=head_name)
        vg.add(list(range(len(hair.data.vertices))), 1.0, "REPLACE")
    hair.parent = arm
    hair.matrix_parent_inverse = Matrix.Identity(4)
    mods = [m for m in hair.modifiers if m.type == "ARMATURE"]
    mod = mods[0] if mods else hair.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    set_single_material(hair, hair_mat)
    strip_extras(hair)
    lo, hi = world_bounds([hair])
    fit = cfg["hairFit"]
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2))
    problems = []
    if (centre - head_pos.xy).length > fit["maxCentreOffsetM"]:
        problems.append("off-centre")
    if lo.z < head_pos.z - fit["minBelowHeadM"] or hi.z > head_pos.z + fit["maxAboveHeadM"]:
        problems.append("wrong height")
    if max(hi.x - lo.x, hi.y - lo.y) > fit["maxWidthM"]:
        problems.append("too wide")
    if problems:
        delete_objects([hair])
        return None, {**info, "rejected": ", ".join(problems)}
    info["triangles"] = triangle_count(hair)
    return hair, info
