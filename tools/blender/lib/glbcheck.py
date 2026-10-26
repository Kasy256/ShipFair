"""Re-import checks on exported GLBs, read straight from the file (pure: no bpy).

Confirms custom attributes survived export, skin weights are normalised with at most 4 influences,
and joint names resolve against the body skeleton.
"""

from __future__ import annotations

import struct
from pathlib import Path
from typing import Any, Sequence

from .glb import read_bin, read_glb

_COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_TYPE_LEN = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
_NORM_MAX = {5121: 255.0, 5123: 65535.0}


def read_accessor(doc: dict[str, Any], payload: bytes, index: int) -> list[tuple[float, ...]]:
    """Decode one accessor into tuples (normalised integer types become 0..1 floats)."""
    acc = doc["accessors"][index]
    fmt, size = _COMPONENT[acc["componentType"]]
    n = _TYPE_LEN[acc["type"]]
    view = doc["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", size * n)
    scale = _NORM_MAX.get(acc["componentType"]) if acc.get("normalized") else None
    out = []
    for i in range(acc["count"]):
        vals = struct.unpack_from(f"<{n}{fmt}", payload, start + i * stride)
        out.append(tuple(v / scale for v in vals) if scale else tuple(float(v) for v in vals))
    return out


def check_glb(path: Path, *, attributes: Sequence[str], skeleton: Sequence[str] | None = None,
              mesh_names: Sequence[str] | None = None, weight_tol: float = 0.01) -> dict[str, Any]:
    """Problems (empty when fine) plus facts about one GLB.

    `attributes` must exist on every primitive of the checked meshes (all meshes, or those named in
    `mesh_names`). `skeleton` is the body's bone list; every joint must be in it.
    """
    doc, rest = read_glb(path)
    payload = read_bin(rest)
    problems: list[str] = []
    seen: set[str] = set()
    worst_sum = 0.0
    influences = 0
    for mesh in doc.get("meshes", []):
        if mesh_names is not None and mesh.get("name") not in mesh_names:
            continue
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            seen.update(attrs)
            for a in attributes:
                if a not in attrs:
                    problems.append(f"{path.name}: mesh {mesh.get('name')} has no {a}")
            if "WEIGHTS_0" in attrs:
                if "WEIGHTS_1" in attrs:
                    problems.append(f"{path.name}: mesh {mesh.get('name')} has more than 4 influences")
                for w in read_accessor(doc, payload, attrs["WEIGHTS_0"]):
                    worst_sum = max(worst_sum, abs(sum(w) - 1.0))
                    influences = max(influences, sum(1 for x in w if x > 0))
    if worst_sum > weight_tol:
        problems.append(f"{path.name}: skin weights off by up to {worst_sum:.3f} from 1")
    joints: list[str] = []
    for skin in doc.get("skins", []):
        joints = [doc["nodes"][j].get("name", "") for j in skin["joints"]]
        if skeleton is not None:
            missing = [j for j in joints if j not in skeleton]
            if missing:
                problems.append(f"{path.name}: joints not in the body skeleton: {missing[:5]}")
    return {"problems": problems, "attributes": sorted(seen), "maxInfluences": influences,
            "weightSumError": round(worst_sum, 4), "joints": joints}
