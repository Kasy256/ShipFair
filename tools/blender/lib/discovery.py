"""Find pack files by discovery (via `art/reports/inspect.json`), never by hard-coded inner paths.

Pure: no bpy. Directory walks use os.scandir, so names with `[brackets]` or spaces are safe.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Iterator

from .jsonfile import load_or_create

MODEL_EXTS = (".gltf", ".glb", ".fbx", ".obj")
LICENSE_RX = re.compile(r"^(licen[cs]e|readme|credits?)\b", re.IGNORECASE)

DEFAULT_PACKS = {
    "note": "Packs expected under ART_PACKS_DIR (one folder per id). Optional packs only produce warnings when missing.",
    "packs": [
        {"id": "universal-base-characters", "title": "Universal Base Characters (Standard)", "author": "Quaternius", "license": "CC0", "url": "https://quaternius.com/packs/universalbasecharacters.html", "required": True},
        {"id": "universal-animation-library", "title": "Universal Animation Library (Standard)", "author": "Quaternius", "license": "CC0", "url": "https://quaternius.itch.io/", "required": True},
        {"id": "kenney-city-commercial", "title": "City Kit (Commercial)", "author": "Kenney", "license": "CC0", "url": "https://kenney.nl/assets/city-kit-commercial", "required": False},
        {"id": "kenney-city-roads", "title": "City Kit (Roads)", "author": "Kenney", "license": "CC0", "url": "https://kenney.nl/assets/city-kit-roads", "required": False},
        {"id": "kenney-city-suburban", "title": "City Kit (Suburban)", "author": "Kenney", "license": "CC0", "url": "https://kenney.nl/assets/city-kit-suburban", "required": False},
        {"id": "kenney-furniture", "title": "Furniture Kit", "author": "Kenney", "license": "CC0", "url": "https://kenney.nl/assets/furniture-kit", "required": False},
        {"id": "kenney-food", "title": "Food Kit", "author": "Kenney", "license": "CC0", "url": "https://kenney.nl/assets/food-kit", "required": False},
    ],
}


def load_packs_config(art_dir: Path) -> list[dict[str, Any]]:
    data, _ = load_or_create(art_dir / "config" / "packs.json", DEFAULT_PACKS)
    return list(data["packs"])


def walk_files(root: Path) -> Iterator[Path]:
    """Every file under `root`, depth first, sorted by name. No glob patterns involved."""
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = sorted(os.scandir(current), key=lambda e: e.name.lower())
        except OSError:
            continue
        dirs = []
        for entry in entries:
            if entry.is_dir(follow_symlinks=False):
                dirs.append(Path(entry.path))
            elif entry.is_file():
                yield Path(entry.path)
        stack.extend(reversed(dirs))


class Inventory:
    """Read-side view of `inspect.json` for later steps."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.packs_dir = Path(data["packsDir"])

    @classmethod
    def load(cls, reports_dir: Path) -> "Inventory":
        path = reports_dir / "inspect.json"
        if not path.exists():
            raise FileNotFoundError("art/reports/inspect.json is missing: run `pnpm art:inspect` first")
        raw = json.loads(path.read_text(encoding="utf-8"))
        return cls(raw["stats"])

    def has_pack(self, pack_id: str) -> bool:
        return bool(self.data["packs"].get(pack_id, {}).get("found"))

    def models(self, pack_id: str) -> list[Path]:
        pack = self.data["packs"].get(pack_id, {})
        return [self.packs_dir / pack_id / m["path"] for m in pack.get("models", [])]

    def find(
        self,
        pack_id: str,
        *,
        name: str | None = None,
        exts: tuple[str, ...] = (".glb", ".gltf"),
        path_contains: tuple[str, ...] = (),
    ) -> list[Path]:
        """Models in a pack filtered by name regex (on the stem), extension and path fragments."""
        rx = re.compile(name, re.IGNORECASE) if name else None
        out = []
        for p in self.models(pack_id):
            if p.suffix.lower() not in exts:
                continue
            if rx and not rx.search(p.stem):
                continue
            rel = str(p.relative_to(self.packs_dir / pack_id)).lower()
            if any(frag.lower() not in rel for frag in path_contains):
                continue
            out.append(p)
        return out

    def sample(self, rel_path: str) -> dict[str, Any] | None:
        for pack in self.data["packs"].values():
            for s in pack.get("samples", []):
                if s.get("path") == rel_path:
                    return s
        return None
