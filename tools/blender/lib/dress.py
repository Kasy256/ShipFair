"""Assemble a full avatar from an AvatarStyle-v2-like dict for preview renders.

Follows the runtime rules: body zones in the worn items' `hides` are removed, `hidesHair` headwear
drops the hair, partial headwear (cap, beanie, kufi) removes the hair faces in its mask, and a
`capIncompatible` hair under partial headwear resolves to no headwear.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import bpy
from mathutils import Vector

from .avatar_render import assign, colour_table, hide_body_zones, import_item, region_material, strip_faces
from .rig import BodyRig, load_body

SLOTS = ("top", "bottom", "shoes", "accessory")
EYES_HEX = "#1b1b1b"


@dataclass
class Catalogue:
    export: Path
    wardrobe: dict[str, dict[str, Any]]
    hair: dict[str, dict[str, Any]]
    facial: dict[str, dict[str, Any]]
    headwear: dict[str, dict[str, Any]]
    skin: list[str]
    hair_colours: list[str]
    palette: list[str]

    @classmethod
    def load(cls, art: Path, export: Path) -> "Catalogue":
        def man(kind: str) -> dict[str, dict[str, Any]]:
            p = export / kind / "manifest.json"
            if not p.exists():
                return {}
            return {i["id"]: i for i in json.loads(p.read_text(encoding="utf-8"))["items"]}

        def hexes(name: str) -> list[str]:
            return [c["hex"] for c in json.loads((art / "palette" / name).read_text(encoding="utf-8"))["colors"]]

        return cls(export, man("wardrobe"), man("hair"), man("facial"), man("headwear"),
                   hexes("skin.json"), hexes("hair.json"), hexes("palette.json"))

    def ids(self, slot: str) -> list[str]:
        if slot in ("hair", "facial", "headwear"):
            return list(getattr(self, slot))
        return [i for i, e in self.wardrobe.items() if e["slot"] == slot]


@dataclass
class Dressed:
    rig: BodyRig
    objects: list[bpy.types.Object]

    def remove(self) -> None:
        for o in [*self.objects, self.rig.arm]:
            if o.name in bpy.data.objects:
                bpy.data.objects.remove(o, do_unlink=True)


def resolve_headwear(cat: Catalogue, style: Mapping[str, Any]) -> str:
    hw = style.get("headwear", {}).get("item", "none")
    entry = cat.headwear.get(hw)
    hair = cat.hair.get(style.get("hair", {}).get("item", ""), {})
    if entry and not entry.get("hidesHair") and entry.get("hidesHairMask") and hair.get("capIncompatible"):
        return "none"
    return hw


def colours(cat: Catalogue, avatar: Mapping[str, Any], style: Mapping[str, Any]) -> list[str]:
    """The 16-entry colour table (uColors) for one style."""
    pal = cat.palette

    def c(slot: str, key: str = "color") -> str:
        v = style.get(slot, {}).get(key)
        return pal[v] if v is not None else "#9a9a9a"

    hair_i = style.get("hair", {}).get("color", 1)
    return colour_table(avatar["regions"], {
        "SKIN": cat.skin[style.get("skin", 5)], "EYES": EYES_HEX,
        "HAIR": cat.hair_colours[hair_i],
        "BROWS": cat.hair_colours[style.get("brows", {}).get("color", hair_i)],
        "TOP": c("top"), "TOP2": c("top", "color2"), "BOTTOM": c("bottom"), "BOTTOM2": c("bottom", "color2"),
        "SHOES": c("shoes"), "SHOES2": c("shoes", "color2"), "ACCENT": c("headwear"),
        "ACCENT2": c("headwear", "color2"), "ACCESSORY": c("accessory"),
    })


def dress(cat: Catalogue, avatar: Mapping[str, Any], style: Mapping[str, Any], at: Vector = Vector()) -> Dressed:
    """Import body + items for `style` (body 'm'|'f'), hide covered zones, apply one region material."""
    sex = style.get("body", "m")
    rig = load_body(cat.export / "characters" / f"body_superhero_{sex}.glb", avatar)
    objs: list[bpy.types.Object] = [o for o in (rig.body, rig.eyes, rig.brows) if o is not None]
    hidden = 0
    for slot in SLOTS:
        item = style.get(slot, {}).get("item", "none")
        entry = cat.wardrobe.get(item)
        if entry is None:
            continue
        hidden |= int(entry.get("hides", 0))
        objs += import_item(cat.export / entry["files"][rig.bid], rig.arm)
    hw = resolve_headwear(cat, style)
    hw_entry = cat.headwear.get(hw)
    hair_entry = cat.hair.get(style.get("hair", {}).get("item", ""))
    if hair_entry and hair_entry["files"].get(rig.bid) and not (hw_entry and hw_entry.get("hidesHair")):
        hair = import_item(cat.export / hair_entry["files"][rig.bid], rig.arm)
        cut = int(hw_entry.get("hidesHairMask", 0)) if hw_entry else 0
        for h in hair:
            if cut and "_MASK" in h.data.attributes:
                vals = [0.0] * len(h.data.vertices)
                h.data.attributes["_MASK"].data.foreach_get("value", vals)
                strip_faces(h, [not (int(round(vals[p.vertices[0]])) & cut) for p in h.data.polygons])
        objs += hair
    facial = cat.facial.get(style.get("facial", {}).get("item", ""))
    if facial and facial["files"].get(rig.bid):
        objs += import_item(cat.export / facial["files"][rig.bid], rig.arm)
    if hw_entry and hw_entry["files"].get(rig.bid):
        objs += import_item(cat.export / hw_entry["files"][rig.bid], rig.arm)
    hide_body_zones(rig.body, rig.face_mask, hidden)
    assign(objs, region_material(f"__av{len(bpy.data.materials)}", colours(cat, avatar, style)))
    rig.arm.location = at
    return Dressed(rig, objs)
