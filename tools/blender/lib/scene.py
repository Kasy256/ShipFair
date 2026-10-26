"""Scene helpers: reset, import by extension, transforms, triangles, bounds, bones."""

from __future__ import annotations

from pathlib import Path
from typing import Iterable

import bpy
from mathutils import Vector


def reset_scene() -> None:
    """Start from an empty factory scene (no default cube, camera or light)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(path: Path) -> list[bpy.types.Object]:
    """Import glTF/GLB/FBX/OBJ by extension and return the new objects."""
    before = set(bpy.data.objects)
    ext = path.suffix.lower()
    fp = str(path)
    if ext in (".gltf", ".glb"):
        bpy.ops.import_scene.gltf(filepath=fp)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=fp)
    elif ext == ".obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=fp)
        else:  # pragma: no cover - pre-3.2 fallback
            bpy.ops.import_scene.obj(filepath=fp)
    else:
        raise ValueError(f"unsupported model type: {path.name}")
    return [o for o in bpy.data.objects if o not in before]


def select_only(objs: Iterable[bpy.types.Object]) -> None:
    """Deselect everything, then select `objs` and make the first one active."""
    objs = list(objs)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_transforms(objs: Iterable[bpy.types.Object]) -> None:
    """Apply location, rotation and scale to the given objects."""
    objs = list(objs)
    if not objs:
        return
    select_only(objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def triangle_count(obj: bpy.types.Object) -> int:
    """Triangles in a mesh object's base mesh (n-gons count as n-2)."""
    if obj.type != "MESH":
        return 0
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def world_bounds(objs: Iterable[bpy.types.Object]) -> tuple[Vector, Vector]:
    """World-space min/max corners over every mesh vertex in `objs`."""
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    found = False
    for o in objs:
        if o.type != "MESH":
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
            found = True
    if not found:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return lo, hi


def armatures(objs: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    return [o for o in objs if o.type == "ARMATURE"]


def meshes(objs: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    return [o for o in objs if o.type == "MESH"]


def bone_names(arm: bpy.types.Object) -> list[str]:
    return [b.name for b in arm.data.bones]


def deform_bone_count(arm: bpy.types.Object) -> int:
    return sum(1 for b in arm.data.bones if b.use_deform)


def find_bone(arm: bpy.types.Object, name: str) -> bpy.types.Bone | None:
    """Bone by exact name, else case-insensitive (UE rigs use `Head` or `head`)."""
    bone = arm.data.bones.get(name)
    if bone is not None:
        return bone
    lower = name.lower()
    return next((b for b in arm.data.bones if b.name.lower() == lower), None)


def purge_orphans() -> None:
    """Remove unused materials, images, meshes, armatures and actions."""
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def delete_objects(objs: Iterable[bpy.types.Object]) -> None:
    for o in list(objs):
        bpy.data.objects.remove(o, do_unlink=True)
