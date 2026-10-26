"""One glTF export function with the ART_PIPELINE.md settings, checked against the operator."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

import bpy

from .scene import select_only


def _operator_params() -> set[str]:
    return {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}


def export_glb(
    path: Path,
    objects: Iterable[bpy.types.Object],
    *,
    animations: bool,
    colors: bool = False,
    animation_mode: str = "ACTIONS",
    attributes: bool = False,
) -> None:
    """Export the given objects to a GLB.

    GLB, +Y up, modifiers applied, no compression, deform bones only, extras on. `attributes` exports
    custom attributes whose names start with `_` (`_REGION`, `_MASK`, `_UV_PRINT`). Parameter names
    are checked against the running Blender's `export_scene.gltf` so a renamed option fails loudly.
    """
    params: dict[str, Any] = {
        "filepath": str(path),
        "check_existing": False,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": True,
        "export_draco_mesh_compression_enable": False,
        "export_def_bones": True,
        "export_extras": True,
        "export_animations": animations,
        "export_colors": colors,
        "export_texcoords": True,
        "export_normals": True,
        "export_materials": "EXPORT",
        "export_cameras": False,
        "export_lights": False,
    }
    if animations:
        params["export_animation_mode"] = animation_mode
    if attributes:
        params["export_attributes"] = True
    known = _operator_params()
    unknown = sorted(k for k in params if k not in known)
    if unknown:
        raise RuntimeError(f"export_scene.gltf in Blender {bpy.app.version_string} lacks: {unknown}")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    select_only(objects)
    bpy.ops.export_scene.gltf(**params)
    if not path.exists():
        raise RuntimeError(f"export produced no file: {path}")
