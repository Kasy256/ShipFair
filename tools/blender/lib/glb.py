"""Read and patch a GLB's JSON chunk (pure: no bpy). Used for name fixes and contract checks."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path
from typing import Any, Callable

MAGIC = 0x46546C67  # 'glTF'
JSON_CHUNK = 0x4E4F534A
SUFFIX_RX = re.compile(r"\.\d{3}$")


def read_glb(path: Path) -> tuple[dict[str, Any], bytes]:
    """Return (json, rest-of-file-after-the-JSON-chunk)."""
    data = path.read_bytes()
    magic, _version, _length = struct.unpack_from("<III", data, 0)
    if magic != MAGIC:
        raise ValueError(f"{path.name} is not a GLB")
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != JSON_CHUNK:
        raise ValueError(f"{path.name}: first chunk is not JSON")
    doc = json.loads(data[20 : 20 + chunk_len].decode("utf-8"))
    return doc, data[20 + chunk_len :]


def write_glb(path: Path, doc: dict[str, Any], rest: bytes) -> None:
    raw = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    body = struct.pack("<II", len(raw), JSON_CHUNK) + raw + rest
    path.write_bytes(struct.pack("<III", MAGIC, 2, 12 + len(body)) + body)


BIN_CHUNK = 0x004E4942


def read_bin(rest: bytes) -> bytes:
    """The BIN chunk payload from the bytes after the JSON chunk (empty if there is none)."""
    if len(rest) < 8:
        return b""
    length, kind = struct.unpack_from("<II", rest, 0)
    if kind != BIN_CHUNK:
        raise ValueError("second chunk is not BIN")
    return rest[8 : 8 + length]


def pack_bin(payload: bytes) -> bytes:
    payload += b"\0" * ((4 - len(payload) % 4) % 4)
    return struct.pack("<II", len(payload), BIN_CHUNK) + payload


def compact(doc: dict[str, Any], payload: bytes) -> bytes:
    """Drop accessors and buffer views nothing references; return the rebuilt BIN payload."""
    used: list[int] = []

    def use(i: int | None) -> None:
        if i is not None and i not in used:
            used.append(i)

    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            for i in prim["attributes"].values():
                use(i)
            use(prim.get("indices"))
            for target in prim.get("targets", []):
                for i in target.values():
                    use(i)
    for skin in doc.get("skins", []):
        use(skin.get("inverseBindMatrices"))
    for anim in doc.get("animations", []):
        for s in anim["samplers"]:
            use(s["input"])
            use(s["output"])
    acc_map = {old: new for new, old in enumerate(sorted(used))}
    accessors = [doc["accessors"][old] for old in sorted(used)]
    views_used = sorted({a["bufferView"] for a in accessors if "bufferView" in a}
                        | {img["bufferView"] for img in doc.get("images", []) if "bufferView" in img})
    view_map: dict[int, int] = {}
    views = []
    out = bytearray()
    for new, old in enumerate(views_used):
        view = dict(doc["bufferViews"][old])
        start = view.get("byteOffset", 0)
        chunk = payload[start : start + view["byteLength"]]
        out += b"\0" * ((4 - len(out) % 4) % 4)
        view["byteOffset"] = len(out)
        out += chunk
        views.append(view)
        view_map[old] = new
    for a in accessors:
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
    for img in doc.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = view_map[img["bufferView"]]
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: acc_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
            prim["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in prim.get("targets", [])] or None
            if prim["targets"] is None:
                del prim["targets"]
    for skin in doc.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = acc_map[skin["inverseBindMatrices"]]
    for anim in doc.get("animations", []):
        for s in anim["samplers"]:
            s["input"], s["output"] = acc_map[s["input"]], acc_map[s["output"]]
    doc["accessors"], doc["bufferViews"] = accessors, views
    doc["buffers"] = [{"byteLength": len(out)}]
    return bytes(out)


def keep_animation_channels(path: Path, keep: Callable[[str, str], bool]) -> tuple[int, int]:
    """Remove animation channels where `keep(node_name, path)` is false, then compact the file.

    Returns (channels kept, channels removed).
    """
    doc, rest = read_glb(path)
    payload = read_bin(rest)
    names = {i: n.get("name", "") for i, n in enumerate(doc.get("nodes", []))}
    kept = removed = 0
    for anim in doc.get("animations", []):
        channels = []
        for ch in anim["channels"]:
            if keep(names.get(ch["target"].get("node", -1), ""), ch["target"]["path"]):
                channels.append(ch)
            else:
                removed += 1
        used = sorted({ch["sampler"] for ch in channels})
        remap = {old: new for new, old in enumerate(used)}
        anim["samplers"] = [anim["samplers"][i] for i in used]
        for ch in channels:
            ch["sampler"] = remap[ch["sampler"]]
        anim["channels"] = channels
        kept += len(channels)
    payload = compact(doc, payload)
    write_glb(path, doc, pack_bin(payload))
    return kept, removed


def strip_name_suffixes(path: Path, prefixes: tuple[str, ...]) -> int:
    """Drop Blender's '.001' suffixes from node names starting with any of `prefixes`."""
    doc, rest = read_glb(path)
    changed = 0
    for node in doc.get("nodes", []):
        name = node.get("name", "")
        if name.startswith(prefixes) and SUFFIX_RX.search(name):
            node["name"] = SUFFIX_RX.sub("", name)
            changed += 1
    if changed:
        write_glb(path, doc, rest)
    return changed


def children_by_name(doc: dict[str, Any], node_name: str) -> list[dict[str, Any]]:
    """Child nodes of the first node called `node_name`."""
    nodes = doc.get("nodes", [])
    parent = next((n for n in nodes if n.get("name") == node_name), None)
    if parent is None:
        return []
    return [nodes[i] for i in parent.get("children", [])]
