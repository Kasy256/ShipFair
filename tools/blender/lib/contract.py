"""The art contract: names, slots, clips and budgets, from `art/contract.json` (pure: no bpy).

The defaults below are transcribed from `docs/ART_PIPELINE.md`. Once the file exists it is the
single source; edit the JSON, not this module. 04b's `pnpm assets:build` reads the same file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .jsonfile import load_or_create, write_json

DEFAULT_CONTRACT: dict[str, Any] = {
    "version": 1,
    "lot": {"widthM": 10, "depthM": 8, "origin": "lot centre, ground level, front faces -Y in Blender (+Z in three.js)"},
    "materials": {
        "character": ["SKIN", "TOP", "BOTTOM", "SHOES", "EYES", "HAIR", "ACCENT"],
        "bodyRegions": ["SKIN", "TOP", "BOTTOM", "SHOES"],
        "palette": "PALETTE",
        "accent": "ACCENT",
        "glow": "GLOW",
    },
    "character": {
        "heightM": {"min": 1.6, "max": 2.1, "target": 1.78},
        "hairMax": 8,
        "hairNames": "hair_{n:02d}",
    },
    "clips": [
        "idle", "walk", "run", "jump_start", "jump_air", "jump_land", "sit_idle",
        "emote_wave", "emote_clap", "emote_dance", "emote_cheer", "emote_point", "emote_sit", "talk",
    ],
    "rootMotionFreeClips": [
        "idle", "walk", "run", "jump_start", "jump_air", "jump_land",
        "emote_wave", "emote_clap", "emote_dance", "emote_cheer", "emote_point", "emote_sit", "talk",
    ],
    "hipDriftMaxM": 0.02,
    "boothKit": {
        "parts": {
            "kit_floor": 200, "kit_wall_back": 300, "kit_wall_side": 200, "kit_counter": 400,
            "kit_screen": 300, "kit_sign": 200, "kit_ring": 400, "kit_roof": 400, "kit_stage": 600,
        },
        "tiers": ["tier_stall", "tier_booth", "tier_pavilion"],
        "slots": ["SLOT_logo", "SLOT_screen_0", "SLOT_screen_1", "SLOT_sign", "SLOT_spawn", "SLOT_maker"],
        "tierSlots": {
            "tier_stall": ["SLOT_logo", "SLOT_screen_0", "SLOT_sign", "SLOT_spawn", "SLOT_maker"],
            "tier_booth": ["SLOT_logo", "SLOT_screen_0", "SLOT_screen_1", "SLOT_sign", "SLOT_spawn", "SLOT_maker"],
            "tier_pavilion": ["SLOT_logo", "SLOT_screen_0", "SLOT_screen_1", "SLOT_sign", "SLOT_spawn", "SLOT_maker"],
        },
        "tierLots": {"tier_stall": 1, "tier_booth": 1, "tier_pavilion": 2},
    },
    "budgets": {
        "characterLod0": {"triangles": 15000, "materials": 7, "fileKB": 600, "deformBones": 70},
        "characterLod1": {"triangles": 4500, "materials": 7, "fileKB": 250, "deformBones": 70},
        "animationSet": {"fileKB": 1200},
        "boothKit": {"triangles": 4000, "fileKB": 400},
        "prop": {"triangles": 1500, "materials": 2, "fileKB": 80},
    },
    "notes": {
        "deformBones": "The Quaternius rig uses UE mannequin naming with ~65 bones including fingers, which emotes need.",
    },
}


def load_contract(art_dir: Path) -> tuple[dict[str, Any], list[str]]:
    """Load `art/contract.json`, creating it if missing and merging a legacy `art/budgets.json`.

    Returns the contract plus human-readable notes about what was created or merged.
    """
    notes: list[str] = []
    path = art_dir / "contract.json"
    contract, created = load_or_create(path, DEFAULT_CONTRACT)
    if created:
        notes.append(f"created {path.name} from ART_PIPELINE.md defaults")
    legacy = art_dir / "budgets.json"
    if legacy.exists():
        loaded, _ = load_or_create(legacy, {})
        budgets = loaded.get("budgets", loaded)
        contract.setdefault("budgets", {}).update(budgets)
        write_json(path, contract)
        notes.append("merged art/budgets.json into contract.json; point 04b at contract.json and delete budgets.json")
    return contract, notes
