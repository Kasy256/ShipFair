"""The shared 16-colour palette: `art/palette/palette.json` -> `palette.png` + a PALETTE material."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import bpy

from .colors import Rgb, hex_to_rgb, square_centre_uv
from .jsonfile import load_or_create

GRID = 4
SIZE_PX = 256

DEFAULT_PALETTE = {
    "note": "16 colours, 4x4 squares left-to-right, top-to-bottom. Edit hex values here only; palette.png is generated.",
    "colors": [
        {"name": "ground", "hex": "#d9d6cf", "group": "neutral"},
        {"name": "wall", "hex": "#f2f0eb", "group": "neutral"},
        {"name": "frame", "hex": "#5b6170", "group": "neutral"},
        {"name": "charcoal", "hex": "#2d3039", "group": "neutral"},
        {"name": "skin_1", "hex": "#f3d2b8", "group": "skin"},
        {"name": "skin_2", "hex": "#d9a37e", "group": "skin"},
        {"name": "skin_3", "hex": "#a86f4c", "group": "skin"},
        {"name": "skin_4", "hex": "#6b432c", "group": "skin"},
        {"name": "violet", "hex": "#7c5cff", "group": "accent"},
        {"name": "sky", "hex": "#3fa7f5", "group": "accent"},
        {"name": "mint", "hex": "#3ccf9a", "group": "accent"},
        {"name": "leaf", "hex": "#7bbf4a", "group": "accent"},
        {"name": "sun", "hex": "#ffb23f", "group": "accent"},
        {"name": "coral", "hex": "#ff6b6b", "group": "accent"},
        {"name": "glow_warm", "hex": "#fff1c9", "group": "glow"},
        {"name": "glow_cool", "hex": "#c9f2ff", "group": "glow"},
    ],
}


@dataclass(frozen=True)
class Palette:
    names: list[str]
    hexes: list[str]
    rgb: list[Rgb]
    groups: list[str]
    png: Path

    def index(self, name: str) -> int:
        return self.names.index(name)

    def uv(self, name_or_index: str | int) -> tuple[float, float]:
        i = name_or_index if isinstance(name_or_index, int) else self.index(name_or_index)
        return square_centre_uv(i, GRID)


def load_palette(art_dir: Path) -> Palette:
    """Load (or create) palette.json and regenerate palette.png from it."""
    data, _ = load_or_create(art_dir / "palette" / "palette.json", DEFAULT_PALETTE)
    colors = data["colors"]
    if len(colors) != GRID * GRID:
        raise ValueError(f"palette.json must list exactly {GRID * GRID} colours, found {len(colors)}")
    pal = Palette(
        names=[c["name"] for c in colors],
        hexes=[c["hex"] for c in colors],
        rgb=[hex_to_rgb(c["hex"]) for c in colors],
        groups=[c.get("group", "") for c in colors],
        png=art_dir / "palette" / "palette.png",
    )
    write_palette_png(pal)
    return pal


def write_palette_png(pal: Palette) -> None:
    """Write the 4x4 grid of flat squares as a 256x256 PNG."""
    import numpy as np

    cell = SIZE_PX // GRID
    px = np.ones((SIZE_PX, SIZE_PX, 4), dtype=np.float32)
    for i, (r, g, b) in enumerate(pal.rgb):
        col, row = i % GRID, i // GRID
        y0 = SIZE_PX - (row + 1) * cell  # Blender pixel rows start at the bottom
        px[y0 : y0 + cell, col * cell : (col + 1) * cell, :3] = (r, g, b)
    name = "__palette_png"
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, SIZE_PX, SIZE_PX, alpha=False)
    img.pixels.foreach_set(px.ravel())
    pal.png.parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(pal.png)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def palette_material(pal: Palette, name: str = "PALETTE") -> bpy.types.Material:
    """Principled material sampling palette.png with nearest filtering (no colour bleed)."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.8
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(pal.png), check_existing=True)
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def flat_material(name: str, rgb: Rgb = (1.0, 1.0, 1.0), emissive: bool = False) -> bpy.types.Material:
    """Plain Principled material (white by default); `emissive` makes it glow with its colour."""
    from .colors import srgb_to_linear

    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    lin = (*(srgb_to_linear(c) for c in rgb), 1.0)
    bsdf.inputs["Base Color"].default_value = lin
    bsdf.inputs["Roughness"].default_value = 0.8
    bsdf.inputs["Metallic"].default_value = 0.0
    if emissive:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = lin
        bsdf.inputs["Emission Strength"].default_value = 2.0
    return mat
