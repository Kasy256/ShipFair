"""Random coherent outfits from the palette's harmony groups (pure: no bpy).

Mirrors `randomAvatarStyle` in `packages/shared/src/schemas/avatar.ts`; previews use this one.
Every clothing colour in a result comes from one harmony group.
"""

from __future__ import annotations

import random
from typing import Any, Mapping, Sequence


def outfit_colours(group: Sequence[int]) -> dict[str, int]:
    """Spread a 2- or 3-colour group over the garment colour slots."""
    main, second = group[0], group[1]
    third = group[2] if len(group) > 2 else group[0]
    return {"top": main, "top2": third, "bottom": second, "bottom2": main,
            "shoes": third, "shoes2": second, "accessory": third, "headwear": second, "headwear2": main}


def random_outfit(rng: random.Random, groups: Sequence[Mapping[str, Any]],
                  catalogue: Mapping[str, Sequence[str]], skin_count: int, hair_count: int) -> dict[str, Any]:
    """A full avatar style: item ids from `catalogue` (slot -> ids), colours from one harmony group.

    `catalogue` needs keys top, bottom, shoes, accessory, hair, facial, headwear and may include
    `none` entries. Headwear is `none` half of the time so most looks show the hair.
    """
    group = rng.choice(list(groups))
    c = outfit_colours(group["colors"])
    hair_colour = rng.randrange(min(hair_count, 8))  # natural shades more often than fantasy ones
    headwear = rng.choice(list(catalogue["headwear"])) if rng.random() < 0.3 else "none"
    facial = rng.choice(list(catalogue["facial"])) if rng.random() < 0.35 else "none"
    accessory = rng.choice(list(catalogue["accessory"])) if rng.random() < 0.5 else "none"
    return {
        "harmony": group["id"],
        "skin": rng.randrange(skin_count),
        "hair": {"item": rng.choice(list(catalogue["hair"])), "color": hair_colour},
        "facial": {"item": facial, "color": hair_colour},
        "headwear": {"item": headwear, "color": c["headwear"], "color2": c["headwear2"]},
        "top": {"item": rng.choice(list(catalogue["top"])), "color": c["top"], "color2": c["top2"]},
        "bottom": {"item": rng.choice(list(catalogue["bottom"])), "color": c["bottom"], "color2": c["bottom2"]},
        "shoes": {"item": rng.choice(list(catalogue["shoes"])), "color": c["shoes"], "color2": c["shoes2"]},
        "accessory": {"item": accessory, "color": c["accessory"]},
    }


def clothing_colours(style: Mapping[str, Any]) -> set[int]:
    out: set[int] = set()
    for slot in ("top", "bottom", "shoes", "accessory", "headwear"):
        for key in ("color", "color2"):
            if key in style[slot]:
                out.add(int(style[slot][key]))
    return out
