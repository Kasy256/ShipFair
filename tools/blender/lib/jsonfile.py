"""Read-or-create JSON config files (pure: no bpy)."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any


def load_or_create(path: Path, default: Any) -> tuple[Any, bool]:
    """Return the file's JSON, writing `default` first if the file is missing.

    The second value is true when the file was created.
    """
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")), False
    write_json(path, default)
    return copy.deepcopy(default), True


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
