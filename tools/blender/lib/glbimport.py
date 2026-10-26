"""Import GLBs with their custom `_` attributes intact.

Blender 3.6's glTF importer collects custom attributes into a list in one order and reads them back
by iterating a `set`, so two attributes can swap names and a VEC2 next to a SCALAR crashes the import.
We import a copy with the custom attributes renamed (the importer then ignores them) and re-attach
each one from the file in the importer's own vertex order: per primitive, the sorted unique indices.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import bpy

from .glb import read_bin, read_glb, write_glb
from .glbcheck import read_accessor
from .scene import import_model

HIDE_PREFIX = "XSF"


def _ordered_values(doc: dict, payload: bytes, mesh: dict, name: str) -> list[tuple[float, ...]] | None:
    out: list[tuple[float, ...]] = []
    for prim in mesh["primitives"]:
        attrs = prim["attributes"]
        if "POSITION" not in attrs:
            continue
        if name not in attrs:
            return None
        values = read_accessor(doc, payload, attrs[name])
        if "indices" in prim:
            used = sorted({int(i[0]) for i in read_accessor(doc, payload, prim["indices"])})
        else:
            used = list(range(len(values)))
        out.extend(values[i] for i in used)
    return out


def import_with_attributes(path: Path) -> list[bpy.types.Object]:
    """Import `path`; every mesh gets its `_*` attributes back as POINT attributes."""
    doc, rest = read_glb(path)
    payload = read_bin(rest)
    custom: dict[int, list[str]] = {}
    for mi, mesh in enumerate(doc.get("meshes", [])):
        names: list[str] = []
        for prim in mesh["primitives"]:
            for key in list(prim["attributes"]):
                if key.startswith("_"):
                    prim["attributes"][HIDE_PREFIX + key] = prim["attributes"].pop(key)
                    if key not in names:
                        names.append(key)
        custom[mi] = names
    if not any(custom.values()):
        return import_model(path)
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / path.name
        write_glb(copy, doc, rest)
        objs = import_model(copy)
    mesh_by_name = {m.get("name"): i for i, m in enumerate(doc.get("meshes", []))}
    for o in objs:
        if o.type != "MESH":
            continue
        mi = mesh_by_name.get(o.data.name.split(".")[0])
        if mi is None:
            continue
        for name in custom[mi]:
            values = _ordered_values(doc, payload, doc["meshes"][mi], HIDE_PREFIX + name)
            if values is None or len(values) != len(o.data.vertices):
                continue
            me = o.data
            if name in me.attributes:
                me.attributes.remove(me.attributes[name])
            if len(values[0]) == 1:
                attr = me.attributes.new(name, "FLOAT", "POINT")
                attr.data.foreach_set("value", [v[0] for v in values])
            else:
                attr = me.attributes.new(name, "FLOAT2", "POINT")
                attr.data.foreach_set("vector", [c for v in values for c in v[:2]])
    return objs
