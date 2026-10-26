"""A body from `art/export/characters/` as the rig every wardrobe and hair item is built on.

Items are built in the body's rest pose, take weights from the nearest body face, are bound to the
body's own armature, and are exported with that armature so their joint order matches the body.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.interpolate import poly_3d_calc

from .attributes import bone_heads
from .avatar import Vec
from .export import export_glb
from .matching import strip_suffix
from .palette import flat_material
from .glbimport import import_with_attributes
from .scene import armatures, delete_objects, import_model, meshes

ITEM_MATERIAL = "AVATAR"


@dataclass
class BodyRig:
    bid: str
    sex: str
    arm: bpy.types.Object
    body: bpy.types.Object
    eyes: bpy.types.Object | None
    brows: bpy.types.Object | None
    heads: dict[str, Vec]
    face_mask: list[int]
    bvh: BVHTree
    joints: list[str]

    def bone(self, name: str) -> Vector:
        for k, v in self.heads.items():
            if k.lower() == name.lower():
                return Vector(v)
        raise KeyError(name)


def _point_attr(obj: bpy.types.Object, name: str) -> list[float]:
    attr = obj.data.attributes.get(name)
    if attr is None:
        raise RuntimeError(f"{obj.name} has no {name}; re-run pnpm art:characters")
    vals = [0.0] * len(attr.data)
    attr.data.foreach_get("value", vals)
    return vals


def load_body(path: Path, avatar: Mapping[str, Any]) -> BodyRig:
    """Import one body GLB (into the current scene), drop its legacy hairs, index its faces."""
    objs = import_with_attributes(path)
    arm = armatures(objs)[0]
    legacy = [o for o in meshes(objs) if o.name.startswith("hair_")]
    ms = [o for o in meshes(objs) if not o.name.startswith("hair_")]
    delete_objects(legacy)
    body = next(o for o in ms if o.name.startswith("body"))
    eyes = next((o for o in ms if o.name.startswith("eyes")), None)
    brows = next((o for o in ms if o.name.startswith("eyebrows")), None)
    vmask = _point_attr(body, avatar["attributes"]["mask"])
    face_mask = [int(round(vmask[p.vertices[0]])) for p in body.data.polygons]
    mw = body.matrix_world
    verts = [mw @ v.co for v in body.data.vertices]
    bvh = BVHTree.FromPolygons(verts, [list(p.vertices) for p in body.data.polygons])
    stem = path.stem
    joints = [b.name for b in arm.data.bones if b.use_deform]
    return BodyRig(stem, stem.rsplit("_", 1)[-1], arm, body, eyes, brows, bone_heads(arm), face_mask, bvh, joints)


def body_vertex_weights(rig: BodyRig) -> list[dict[str, float]]:
    names = {g.index: g.name for g in rig.body.vertex_groups}
    return [{names[g.group]: g.weight for g in v.groups if g.weight > 0} for v in rig.body.data.vertices]


def transfer_weights(obj: bpy.types.Object, rig: BodyRig, weights: list[dict[str, float]] | None = None,
                     limit: int = 4) -> None:
    """Skin `obj` from the nearest body face (interpolated), keep the top `limit`, normalise."""
    weights = weights or body_vertex_weights(rig)
    body = rig.body
    mw = body.matrix_world
    bverts = [mw @ v.co for v in body.data.vertices]
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups: dict[str, bpy.types.VertexGroup] = {}
    omw = obj.matrix_world
    for v in obj.data.vertices:
        loc, _n, idx, _d = rig.bvh.find_nearest(omw @ v.co)
        poly = body.data.polygons[idx]
        ids = list(poly.vertices)
        bary = poly_3d_calc([bverts[i] for i in ids], loc)
        acc: dict[str, float] = {}
        for i, b in zip(ids, bary):
            for name, w in weights[i].items():
                acc[name] = acc.get(name, 0.0) + w * b
        assign(obj, groups, v.index, acc, limit)


def assign(obj: bpy.types.Object, groups: dict[str, bpy.types.VertexGroup], index: int,
           acc: Mapping[str, float], limit: int = 4) -> None:
    top = sorted(((w, n) for n, w in acc.items() if w > 1e-4), reverse=True)[:limit]
    total = sum(w for w, _ in top) or 1.0
    for w, n in top:
        g = groups.get(n) or obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n)
        groups[n] = g
        g.add([index], w / total, "REPLACE")


def bind(obj: bpy.types.Object, rig: BodyRig) -> None:
    """Parent to the body armature with an Armature modifier and give it the item material."""
    obj.parent = rig.arm
    obj.matrix_parent_inverse = rig.arm.matrix_world.inverted()
    mod = next((m for m in obj.modifiers if m.type == "ARMATURE"), None) or obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig.arm
    obj.data.materials.clear()
    obj.data.materials.append(flat_material(ITEM_MATERIAL))


def export_item(path: Path, obj: bpy.types.Object, rig: BodyRig) -> None:
    obj.data.name = obj.name
    export_glb(path, [rig.arm, obj], animations=False, attributes=True)


def load_clips(path: Path) -> dict[str, bpy.types.Action]:
    """Import the clip set once; return its actions by contract clip name (objects removed)."""
    if not path.exists():
        return {}
    before = set(bpy.data.actions)
    objs = import_model(path)
    suffix = f"_{armatures(objs)[0].name}" if armatures(objs) else ""
    actions = {strip_suffix(a.name, suffix): a for a in bpy.data.actions if a not in before}
    for a in actions.values():
        a.use_fake_user = True
    delete_objects(objs)
    return actions


def pose(rig: BodyRig, action: bpy.types.Action | None, at: float) -> None:
    """Put the rig in `action` at fraction `at` of its range (None = rest pose)."""
    rig.arm.animation_data_create()
    rig.arm.animation_data.action = action
    if action is None:
        for pb in rig.arm.pose.bones:
            pb.matrix_basis.identity()
        bpy.context.scene.frame_set(0)
    else:
        s, e = action.frame_range
        bpy.context.scene.frame_set(int(round(s + (e - s) * at)))
    bpy.context.view_layer.update()


def posed(obj: bpy.types.Object) -> tuple[list[Vector], list[Vector], list[list[int]]]:
    """World coordinates, vertex normals and polygons of `obj` after its modifiers (the pose)."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    mw = obj.matrix_world
    rot = mw.to_3x3()
    cos = [mw @ v.co for v in me.vertices]
    nos = [(rot @ v.normal).normalized() for v in me.vertices]
    polys = [list(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    return cos, nos, polys
