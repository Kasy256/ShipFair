"""Avatar palettes: skin tones, hair colours and clothing harmony groups (pure: no bpy).

`art/palette/skin.json` and `hair.json` are created with these defaults when missing; the owner may
edit them. Names are neutral: no ethnic labels on skin tones.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .colors import Rgb, hex_to_rgb
from .jsonfile import load_or_create, write_json

SKIN_HEX = ["#F6D9C6", "#EFC6A8", "#E3AE88", "#D4976C", "#C38158", "#AE6C45",
            "#965A38", "#80492D", "#6A3B25", "#55301E", "#422517", "#301B11"]

DEFAULT_SKIN: dict[str, Any] = {
    "note": "12 skin tones, lightest to deepest, evenly spaced. AvatarStyle.skin is an index into this list. Neutral ids and names only.",
    "colors": [{"id": f"tone_{i + 1:02d}", "name": f"Tone {i + 1}", "hex": h} for i, h in enumerate(SKIN_HEX)],
}

DEFAULT_HAIR: dict[str, Any] = {
    "note": "Hair, brow and facial hair colours. AvatarStyle.hair.color, brows.color and facial.color index this list.",
    "colors": [
        {"id": "black", "name": "Black", "hex": "#141110"},
        {"id": "dark_brown", "name": "Dark brown", "hex": "#2B1D16"},
        {"id": "brown", "name": "Brown", "hex": "#4A3022"},
        {"id": "auburn", "name": "Auburn", "hex": "#7A3B22"},
        {"id": "blonde", "name": "Blonde", "hex": "#C9A46A"},
        {"id": "platinum", "name": "Platinum", "hex": "#E6DCC8"},
        {"id": "grey", "name": "Grey", "hex": "#8C8C8C"},
        {"id": "white", "name": "White", "hex": "#EDEDED"},
        {"id": "violet", "name": "Violet", "hex": "#7C5CFF"},
        {"id": "teal", "name": "Teal", "hex": "#00BFA6"},
        {"id": "pink", "name": "Pink", "hex": "#FF5FA2"},
        {"id": "blue", "name": "Blue", "hex": "#3D7BFF"},
    ],
}

# Indices into palette.json's 16 colours. First colour = main garment, second = bottoms, third
# (optional) = shoes and trims. Glow colours are left out on purpose.
DEFAULT_HARMONY: list[dict[str, Any]] = [
    {"id": "classic", "colors": [1, 3, 1]},
    {"id": "slate_sky", "colors": [9, 2, 1]},
    {"id": "violet_night", "colors": [8, 3, 1]},
    {"id": "mint_slate", "colors": [10, 2, 1]},
    {"id": "sun_charcoal", "colors": [12, 3, 3]},
    {"id": "coral_sand", "colors": [13, 5, 1]},
    {"id": "forest", "colors": [11, 7, 3]},
    {"id": "khaki", "colors": [1, 6, 7]},
    {"id": "mono", "colors": [3, 3, 1]},
    {"id": "sky_white", "colors": [1, 9]},
    {"id": "earth", "colors": [6, 7, 1]},
    {"id": "violet_mint", "colors": [8, 2, 10]},
    {"id": "charcoal_sun", "colors": [3, 0, 12]},
    {"id": "coral_slate", "colors": [13, 2]},
]


@dataclass(frozen=True)
class Swatches:
    ids: list[str]
    names: list[str]
    hexes: list[str]

    @property
    def rgb(self) -> list[Rgb]:
        return [hex_to_rgb(h) for h in self.hexes]


def _swatches(data: dict[str, Any], expected: int, label: str) -> Swatches:
    colors = data["colors"]
    if len(colors) != expected:
        raise ValueError(f"{label} must list {expected} colours, found {len(colors)}")
    return Swatches([c["id"] for c in colors], [c["name"] for c in colors], [c["hex"] for c in colors])


def load_skin(art_dir: Path) -> Swatches:
    data, _ = load_or_create(art_dir / "palette" / "skin.json", DEFAULT_SKIN)
    return _swatches(data, 12, "skin.json")


def load_hair(art_dir: Path) -> Swatches:
    data, _ = load_or_create(art_dir / "palette" / "hair.json", DEFAULT_HAIR)
    return _swatches(data, len(data["colors"]), "hair.json")


def load_harmony(art_dir: Path) -> list[dict[str, Any]]:
    """`harmonyGroups` from palette.json, adding the defaults to the file when missing."""
    path = art_dir / "palette" / "palette.json"
    data, _ = load_or_create(path, {"colors": []})
    if "harmonyGroups" not in data:
        data["harmonyGroups"] = DEFAULT_HARMONY
        write_json(path, data)
    groups = data["harmonyGroups"]
    n = len(data.get("colors", [])) or 16
    for g in groups:
        if not 2 <= len(g["colors"]) <= 3 or any(not 0 <= c < n for c in g["colors"]):
            raise ValueError(f"palette.json harmony group {g.get('id')}: needs 2-3 indices in 0..{n - 1}")
    return groups
