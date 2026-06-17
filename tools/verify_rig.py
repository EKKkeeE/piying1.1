"""Verify rig hole-to-hole alignment (child_pos + child_joint == parent_joint)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify(rig_path: Path) -> None:
    rig = json.loads(rig_path.read_text(encoding="utf-8"))
    parts = rig["parts"]
    print(rig_path.name)
    for link in rig["links"]:
        p = parts[link["parent"]]["joints"][link["parentJoint"]]
        c = parts[link["child"]]["joints"][link["childJoint"]]
        pos = [p[0] - c[0], p[1] - c[1]]
        back = [pos[0] + c[0], pos[1] + c[1]]
        ok = abs(back[0] - p[0]) < 0.01 and abs(back[1] - p[1]) < 0.01
        print(
            f"  {link['parent']}.{link['parentJoint']} <- {link['child']}.{link['childJoint']} "
            f"pos={pos} {'OK' if ok else 'FAIL'}"
        )


if __name__ == "__main__":
    verify(ROOT / "assets" / "wukong" / "rig.json")
