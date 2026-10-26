"""Render-side avatar assembly for previews: the runtime shader, approximated with Cycles nodes.

One material per avatar reads `_REGION` and maps it through a constant colour ramp (the uColors[16]
uniform); body faces in hidden zones are removed from a copy of the body (the uHiddenMask discard).
"""

from __future__ import annotations

from pathlib import Path
from typing import Mapping, Sequence

import bmesh
import bpy

from .colors import hex_to_rgb, srgb_to_linear
from .glbimport import import_with_attributes
from .scene import meshes

SLOTS = 16


def region_material(name: str, colours: Sequence[str], attr: str = "_REGION",
                    print_image: bpy.types.Image | None = None, print_attr: str = "_UV_PRINT",
                    top_slot: int = 1) -> bpy.types.Material:
    """Principled material coloured by region index; `colours[i]` is slot i as '#rrggbb'."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.78
    src = nt.nodes.new("ShaderNodeAttribute")
    src.attribute_type = "GEOMETRY"
    src.attribute_name = attr
    scale = nt.nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY_ADD"
    scale.inputs[1].default_value = 1 / SLOTS
    scale.inputs[2].default_value = 0.5 / SLOTS
    nt.links.new(src.outputs["Fac"], scale.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    while len(els) < SLOTS:
        els.new(0.5)
    for i, e in enumerate(els):
        e.position = i / SLOTS
        hexv = colours[i] if i < len(colours) and colours[i] else "#ff00ff"
        e.color = (*(srgb_to_linear(c) for c in hex_to_rgb(hexv)), 1.0)
    nt.links.new(scale.outputs[0], ramp.inputs["Fac"])
    colour_out = ramp.outputs["Color"]
    if print_image is not None:
        uv = nt.nodes.new("ShaderNodeAttribute")
        uv.attribute_type = "GEOMETRY"
        uv.attribute_name = print_attr
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = print_image
        tex.extension = "CLIP"
        nt.links.new(uv.outputs["Vector"], tex.inputs["Vector"])
        is_top = nt.nodes.new("ShaderNodeMath")
        is_top.operation = "COMPARE"
        is_top.inputs[1].default_value = float(top_slot)
        is_top.inputs[2].default_value = 0.1
        nt.links.new(src.outputs["Fac"], is_top.inputs[0])
        fac = nt.nodes.new("ShaderNodeMath")
        fac.operation = "MULTIPLY"
        nt.links.new(is_top.outputs[0], fac.inputs[0])
        nt.links.new(tex.outputs["Alpha"], fac.inputs[1])
        mix = nt.nodes.new("ShaderNodeMixRGB")
        nt.links.new(fac.outputs[0], mix.inputs["Fac"])
        nt.links.new(colour_out, mix.inputs["Color1"])
        nt.links.new(tex.outputs["Color"], mix.inputs["Color2"])
        colour_out = mix.outputs["Color"]
    nt.links.new(colour_out, bsdf.inputs["Base Color"])
    return mat


def strip_faces(obj: bpy.types.Object, keep: Sequence[bool]) -> None:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def hide_body_zones(body: bpy.types.Object, face_mask: Sequence[int], hidden: int) -> None:
    """Delete body faces whose zone bit is in `hidden` (the shader's discard, baked for a render)."""
    if hidden:
        strip_faces(body, [not (m & hidden) for m in face_mask])


def import_item(path: Path, arm: bpy.types.Object) -> list[bpy.types.Object]:
    """Import an item GLB and re-bind its meshes to `arm` (the body's armature); drop its own armature."""
    objs = import_with_attributes(path)
    items = meshes(objs)
    for o in items:
        o.parent = arm
        o.matrix_parent_inverse.identity()
        for m in o.modifiers:
            if m.type == "ARMATURE":
                m.object = arm
    for o in objs:
        if o.type == "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    return items


def assign(objs: Sequence[bpy.types.Object], mat: bpy.types.Material) -> None:
    for o in objs:
        if o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(mat)


def colour_table(regions: Mapping[str, int], values: Mapping[str, str]) -> list[str]:
    table = ["#808080"] * SLOTS
    for name, hexv in values.items():
        if name in regions:
            table[regions[name]] = hexv
    return table
