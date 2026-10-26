"""Load, resize and tile PNGs with bpy images + numpy (no PIL in Blender's Python)."""

from __future__ import annotations

from pathlib import Path
from typing import Sequence

import bpy
import numpy as np


def load_rgba(path: Path, size: tuple[int, int] | None = None) -> np.ndarray:
    """(H, W, 4) float array, bottom row first (Blender order), optionally resized."""
    img = bpy.data.images.load(str(path), check_existing=False)
    try:
        if size is not None and tuple(img.size) != size:
            img.scale(size[0], size[1])
        w, h = img.size
        arr = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(arr)
        return arr.reshape(h, w, 4)
    finally:
        bpy.data.images.remove(img)


def save_rgba(arr: np.ndarray, path: Path) -> None:
    h, w = arr.shape[:2]
    img = bpy.data.images.new("__out", w, h, alpha=True)
    try:
        img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
        path.parent.mkdir(parents=True, exist_ok=True)
        img.filepath_raw = str(path)
        img.file_format = "PNG"
        img.save()
    finally:
        bpy.data.images.remove(img)


def grid(paths: Sequence[Path | None], cols: int, tile: tuple[int, int], out: Path,
         gap: int = 4, bg: float = 0.12) -> None:
    """Tile images left-to-right, top-to-bottom. `None` leaves an empty cell."""
    rows = (len(paths) + cols - 1) // cols
    tw, th = tile
    W, H = cols * tw + (cols + 1) * gap, rows * th + (rows + 1) * gap
    canvas = np.full((H, W, 4), bg, dtype=np.float32)
    canvas[..., 3] = 1.0
    for i, p in enumerate(paths):
        if p is None or not p.exists():
            continue
        r, c = i // cols, i % cols
        x = gap + c * (tw + gap)
        y = H - (gap + (r + 1) * th + r * gap)  # bottom-up rows
        canvas[y : y + th, x : x + tw] = load_rgba(p, (tw, th))
    save_rgba(canvas, out)
