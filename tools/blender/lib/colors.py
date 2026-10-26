"""Colour maths for palette remapping (pure: no bpy)."""

from __future__ import annotations

from typing import Sequence

Rgb = tuple[float, float, float]


def hex_to_rgb(value: str) -> Rgb:
    """'#RRGGBB' -> sRGB floats in 0..1."""
    s = value.lstrip("#")
    if len(s) != 6:
        raise ValueError(f"not a #RRGGBB colour: {value!r}")
    return (int(s[0:2], 16) / 255, int(s[2:4], 16) / 255, int(s[4:6], 16) / 255)


def rgb_to_hex(rgb: Sequence[float]) -> str:
    """sRGB floats in 0..1 -> '#rrggbb'."""
    return "#" + "".join(f"{round(max(0.0, min(1.0, c)) * 255):02x}" for c in rgb[:3])


def linear_to_srgb(c: float) -> float:
    """One linear channel -> sRGB-encoded channel."""
    if c <= 0.0031308:
        return max(0.0, c * 12.92)
    return 1.055 * (c ** (1 / 2.4)) - 0.055


def srgb_to_linear(c: float) -> float:
    """One sRGB-encoded channel -> linear channel."""
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def srgb_to_lab(rgb: Rgb) -> tuple[float, float, float]:
    """sRGB (0..1) -> CIE L*a*b* (D65)."""
    r, g, b = (srgb_to_linear(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def nearest_index(rgb: Rgb, palette: Sequence[Rgb]) -> int:
    """Index of the perceptually nearest palette colour (CIE76 distance in Lab)."""
    if not palette:
        raise ValueError("empty palette")
    target = srgb_to_lab(rgb)
    best, best_d = 0, float("inf")
    for i, p in enumerate(palette):
        lab = srgb_to_lab(p)
        d = sum((a - b) ** 2 for a, b in zip(target, lab))
        if d < best_d:
            best, best_d = i, d
    return best


def square_centre_uv(index: int, grid: int = 4) -> tuple[float, float]:
    """UV (Blender convention, v up) of the centre of palette square `index`.

    Squares run left to right, top to bottom. Pointing at centres keeps mipmaps from bleeding.
    """
    if not 0 <= index < grid * grid:
        raise ValueError(f"palette index out of range: {index}")
    col, row = index % grid, index // grid
    return ((col + 0.5) / grid, 1.0 - (row + 0.5) / grid)
