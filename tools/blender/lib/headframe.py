"""Head landmarks measured from a body rig: hairline, ear line, cap band, face opening.

Every hair, facial hair, headwear and head accessory generator places itself relative to these, so
the same config fits both bodies. Heads face -Y; `u` runs 0 at the face to 1 at the back of the head.
"""

from __future__ import annotations

from dataclasses import dataclass

from mathutils import Vector

from .rig import BodyRig


def _lerp_table(table: list[tuple[float, float]], x: float) -> float:
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return table[-1][1]


@dataclass(frozen=True)
class HeadFrame:
    top_z: float
    eye_z: float
    eye_front_y: float
    eye_half_x: float
    chin_z: float
    front_y: float
    back_y: float
    half_w: float
    head_bone: Vector
    neck_bone: Vector

    @property
    def centre(self) -> Vector:
        return Vector((0.0, (self.front_y + self.back_y) / 2, self.eye_z + 0.012))

    @property
    def size(self) -> float:
        """Top-of-head height above the eyes; scales offsets between bodies."""
        return self.top_z - self.eye_z

    @property
    def hairline_front_z(self) -> float:
        return self.eye_z + 0.55 * self.size

    @property
    def ear_top_z(self) -> float:
        return self.eye_z + 0.008

    @property
    def mouth_z(self) -> float:
        return self.chin_z + 0.42 * (self.eye_z - self.chin_z)

    @property
    def nape_z(self) -> float:
        return self.chin_z + 0.025

    def u(self, p: Vector) -> float:
        return (p.y - self.front_y) / max(1e-6, self.back_y - self.front_y)

    def hairline_z(self, p: Vector, raise_m: float = 0.0) -> float:
        """Natural hairline: forehead, temples, above the ears, down to the nape."""
        table = [(0.0, self.hairline_front_z), (0.22, self.hairline_front_z - 0.004),
                 (0.36, self.eye_z + 0.028), (0.46, self.ear_top_z + 0.012), (0.62, self.ear_top_z + 0.010),
                 (0.76, self.eye_z - 0.03), (0.92, self.nape_z), (1.2, self.nape_z)]
        return _lerp_table(table, self.u(p)) + raise_m

    def band_z(self, p: Vector) -> float:
        """Cap band: across the forehead, tilting down to above the ears and the back."""
        return _lerp_table([(0.0, self.hairline_front_z + 0.004), (0.5, self.ear_top_z + 0.03),
                            (1.0, self.eye_z + 0.012)], self.u(p))

    def face_open(self, p: Vector, margin: float = 0.0) -> bool:
        """True where the face is: in front of the ears and below the hairline."""
        return self.u(p) < 0.42 - margin and p.z < self.hairline_front_z + 0.01 + margin


def measure(rig: BodyRig, head_bit: int) -> HeadFrame:
    body = rig.body
    mw = body.matrix_world
    head_faces = [p for p in body.data.polygons if rig.face_mask[p.index] & head_bit]
    ids = {i for p in head_faces for i in p.vertices}
    pts = [mw @ body.data.vertices[i].co for i in ids]
    if rig.eyes is not None:
        ev = [rig.eyes.matrix_world @ v.co for v in rig.eyes.data.vertices]
    else:  # pragma: no cover - every Quaternius body has eyes
        ev = [Vector((0, min(p.y for p in pts), sum(p.z for p in pts) / len(pts)))]
    eye_z = sum(v.z for v in ev) / len(ev)
    eye_front = min(v.y for v in ev)
    top = max(p.z for p in pts)
    back = max(p.y for p in pts if p.z > eye_z - 0.02)
    skull = [abs(p.x) for p in pts if eye_z + 0.01 < p.z < eye_z + 0.06]
    front_face = [p.z for p in pts if p.y < eye_front + 0.035 and abs(p.x) < 0.03]
    return HeadFrame(top_z=top, eye_z=eye_z, eye_front_y=eye_front, eye_half_x=max(abs(v.x) for v in ev),
                     chin_z=min(front_face) if front_face else eye_z - 0.12, front_y=eye_front - 0.01, back_y=back,
                     half_w=max(skull) if skull else 0.09, head_bone=rig.bone("Head"), neck_bone=rig.bone("neck_01"))
