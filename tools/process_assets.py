"""Slice parts, chroma-key, detect joint holes, write rig.json (hole-to-hole assembly)."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageOps
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BG_SRC = ROOT / "piyingxi_bg.png"
BG_OUT = ROOT / "assets" / "bg" / "piyingxi_bg.png"

CHARACTERS = {
    "wukong": {
        "src": ROOT / "sun_wukong_9_parts_greenscreen.png",
        "out_dir": ROOT / "assets" / "wukong",
        "asset_prefix": "assets/wukong",
        "name": "sun_wukong",
        "flip_x": False,
        "mirror_leg_l": False,
        "mirror_parts": ["thigh_l", "shin_l"],
        "player": True,
        "joint_overrides": {
            "torso": {
                "shoulder_l": [210, 339],
                "shoulder_r": [365, 339],
                "hip_l": [215, 640.7],
                "hip_r": [360, 642.1],
            },
        },
    },
}


def is_green(r: int, g: int, b: int) -> bool:
    return g > 140 and r < 130 and b < 130 and g > r + 25 and g > b + 25


def chroma_key(im: Image.Image) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if is_green(r, g, b) or is_green(r, max(0, g - 20), b):
                px[x, y] = (r, g, b, 0)
    return rgba


def find_joint_dots(rgba: Image.Image) -> list[tuple[float, float]]:
    """White pivot holes from Spine export."""
    arr = np.array(rgba)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    white = (
        (a > 180)
        & (r > 195)
        & (g > 195)
        & (b > 195)
        & (np.abs(r.astype(int) - g.astype(int)) < 35)
    )
    if not white.any():
        return []
    from scipy import ndimage

    labeled, n = ndimage.label(white)
    dots = []
    for i in range(1, n + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < 8 or len(xs) > 700:
            continue
        dots.append((float(xs.mean()), float(ys.mean())))
    return dots


def find_transparent_holes(rgba: Image.Image) -> list[tuple[float, float]]:
    """Detect green-screened internal puppet joint holes after chroma key."""
    from scipy import ndimage

    arr = np.array(rgba)
    opaque = arr[:, :, 3] > 20
    labeled, n = ndimage.label(~opaque)
    border = set(
        np.unique(
            np.concatenate(
                [labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]]
            )
        )
    )
    holes = []
    for i in range(1, n + 1):
        if i in border:
            continue
        ys, xs = np.where(labeled == i)
        if 10 <= len(xs) <= 2500:
            holes.append((float(xs.mean()), float(ys.mean())))
    return sorted(holes, key=lambda p: (p[1], p[0]))


def strip_joint_dots(rgba: Image.Image, radius: int = 16) -> Image.Image:
    arr = np.array(rgba.copy())
    dots = find_joint_dots(Image.fromarray(arr))
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    white = (
        (a > 160)
        & (r > 195)
        & (g > 195)
        & (b > 195)
        & (np.abs(r.astype(int) - g.astype(int)) < 35)
    )
    from scipy import ndimage

    labeled, _ = ndimage.label(white)
    for i in range(1, labeled.max() + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < 6 or len(xs) > 700:
            continue
        cx, cy = int(xs.mean()), int(ys.mean())
        y0, y1 = max(0, cy - radius), min(arr.shape[0], cy + radius + 1)
        x0, x1 = max(0, cx - radius), min(arr.shape[1], cx + radius + 1)
        patch_a = a[y0:y1, x0:x1]
        patch_m = labeled[y0:y1, x0:x1] == i
        patch_a[patch_m] = 0
    return Image.fromarray(arr)


def keep_largest_component(rgba: Image.Image) -> Image.Image:
    """去掉裁切残留的小碎块（如 arm_r 上脱落的铠甲片）。"""
    from scipy import ndimage

    arr = np.array(rgba)
    a = arr[:, :, 3] > 40
    labeled, n = ndimage.label(a)
    if n <= 1:
        return rgba

    sizes = [(i, int((labeled == i).sum())) for i in range(1, n + 1)]
    sizes.sort(key=lambda s: -s[1])
    main_id = sizes[0][0]
    out = arr.copy()
    for i, _sz in sizes[1:]:
        out[labeled == i, 3] = 0
    # 收紧包围盒
    ys, xs = np.where(out[:, :, 3] > 20)
    if len(xs) == 0:
        return Image.fromarray(out)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    return Image.fromarray(out[y0:y1, x0:x1])


def bbox_non_transparent(rgba: Image.Image, pad: int = 4) -> tuple[int, int, int, int]:
    arr = np.array(rgba)
    a = arr[:, :, 3]
    ys, xs = np.where(a > 20)
    if len(xs) == 0:
        return 0, 0, rgba.width, rgba.height
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(rgba.width, int(xs.max()) + pad + 1),
        min(rgba.height, int(ys.max()) + pad + 1),
    )


def connected_part_boxes(fg: np.ndarray, min_area: int = 8000) -> list:
    from scipy import ndimage

    labeled, n = ndimage.label(fg)
    parts = []
    for i in range(1, n + 1):
        ys, xs = np.where(labeled == i)
        if len(xs) < min_area:
            continue
        parts.append((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, len(xs), xs.mean(), ys.mean()))
    parts.sort(key=lambda p: -p[4])
    return parts


def classify_parts(parts: list) -> dict[str, tuple[int, int, int, int]]:
    if len(parts) >= 9:
        by_yx = sorted(parts[:9], key=lambda p: (p[6], p[5]))
        names = [
            "upper_arm_l",
            "upper_arm_r",
            "lower_arm_r",
            "torso",
            "lower_arm_l",
            "thigh_r",
            "thigh_l",
            "shin_l",
            "shin_r",
        ]
        return {
            name: tuple(int(v) for v in part[:4])
            for name, part in zip(names, by_yx)
        }

    top5 = parts[:5]
    by_y = sorted(top5, key=lambda p: p[6])
    legs = by_y[-2:]
    upper = by_y[:-2]
    torso = max(upper, key=lambda p: p[4])
    arms = [p for p in upper if p is not torso]
    arms.sort(key=lambda p: p[5])
    legs.sort(key=lambda p: p[5])
    return {
        "torso": tuple(int(v) for v in torso[:4]),
        "arm_l": tuple(int(v) for v in arms[0][:4]),
        "arm_r": tuple(int(v) for v in arms[1][:4]),
        "leg_l": tuple(int(v) for v in legs[0][:4]),
        "leg_r": tuple(int(v) for v in legs[1][:4]),
    }


def local_dots(dots_global: list, crop: tuple, tb: tuple) -> list[tuple[float, float]]:
    x0, y0 = crop[0] + tb[0], crop[1] + tb[1]
    x1 = x0 + (tb[2] - tb[0])
    y1 = y0 + (tb[3] - tb[1])
    return [(x - x0, y - y0) for x, y in dots_global if x0 <= x < x1 and y0 <= y < y1]


ATTACHMENT_LINKS = [
    ("shoulder_l", "arm_l", "shoulder"),
    ("shoulder_r", "arm_r", "shoulder"),
    ("hip_l", "leg_l", "hip"),
    ("hip_r", "leg_r", "hip"),
]


def _nearest_dot(
    dots: list[tuple[float, float]],
    origin: tuple[float, float],
    target: tuple[float, float],
) -> tuple[float, float]:
    ox, oy = origin
    tx, ty = target
    return min(dots, key=lambda d: (ox + d[0] - tx) ** 2 + (oy + d[1] - ty) ** 2)


def _attachment_targets(
    torso_box: tuple[int, int, int, int],
    child_box: tuple[int, int, int, int],
    child_name: str,
) -> tuple[tuple[float, float], tuple[float, float]]:
    """合图布局中，躯干孔与子部件孔在各自边缘上成对出现。"""
    tx0, ty0, tx1, ty1 = torso_box
    cx0, cy0, cx1, cy1 = child_box
    tw, th = tx1 - tx0, ty1 - ty0
    ch = cy1 - cy0

    if child_name == "arm_l":
        return (tx0 + tw * 0.15, ty0 + th * 0.13), (cx1 - 20, cy0 + ch * 0.12)
    if child_name == "arm_r":
        return (tx1 - tw * 0.15, ty0 + th * 0.13), (cx0 + 20, cy0 + ch * 0.12)
    if child_name == "leg_l":
        return (tx0 + tw * 0.12, ty1 - th * 0.08), (cx1 - 15, cy0 + 25)
    if child_name == "leg_r":
        return (tx1 - tw * 0.12, ty1 - th * 0.08), (cx0 + 15, cy0 + 25)
    raise ValueError(f"unknown child {child_name}")


def apply_layout_attachment_joints(
    meta: dict,
    parts_boxes: dict[str, tuple[int, int, int, int]],
    origins: dict[str, tuple[float, float]],
) -> None:
    """按合图相对位置，为每条 link 选取真正对齐的孔对孔坐标。"""
    for parent_joint, child_name, child_joint in ATTACHMENT_LINKS:
        t_target, c_target = _attachment_targets(
            parts_boxes["torso"], parts_boxes[child_name], child_name
        )
        t_dot = _nearest_dot(meta["torso"]["dots"], origins["torso"], t_target)
        c_dot = _nearest_dot(meta[child_name]["dots"], origins[child_name], c_target)
        meta["torso"]["joints"][parent_joint] = [round(t_dot[0], 1), round(t_dot[1], 1)]
        meta[child_name]["joints"][child_joint] = [round(c_dot[0], 1), round(c_dot[1], 1)]

    hl = meta["torso"]["joints"]["hip_l"]
    hr = meta["torso"]["joints"]["hip_r"]
    meta["torso"]["joints"]["root"] = [
        round((hl[0] + hr[0]) / 2, 1),
        round((hl[1] + hr[1]) / 2, 1),
    ]
    sl = meta["torso"]["joints"]["shoulder_l"]
    sr = meta["torso"]["joints"]["shoulder_r"]
    meta["torso"]["joints"]["head"] = [
        round((sl[0] + sr[0]) / 2, 1),
        round(min(sl[1], sr[1]) - 148, 1),
    ]

    for child_name in ("arm_l", "arm_r", "leg_l", "leg_r"):
        w = meta[child_name]["width"]
        h = meta[child_name]["height"]
        extra = pick_joints(child_name, meta[child_name]["dots"], w, h)
        attach_key = "shoulder" if child_name.startswith("arm") else "hip"
        for key, val in extra.items():
            if key == attach_key:
                continue
            meta[child_name]["joints"][key] = val


def apply_joint_overrides(meta: dict, cfg: dict) -> None:
    overrides = cfg.get("joint_overrides")
    if not overrides:
        return

    for part_name, joints in overrides.items():
        if part_name not in meta:
            continue
        part_joints = meta[part_name]["joints"]
        for joint_name, val in joints.items():
            part_joints[joint_name] = [round(float(val[0]), 1), round(float(val[1]), 1)]

    # 髋孔覆盖后重算 root；head 保留透明孔检测结果，避免提线锚点漂移
    torso = meta.get("torso", {}).get("joints", {})
    if all(k in torso for k in ("hip_l", "hip_r")):
        hl = torso["hip_l"]
        hr = torso["hip_r"]
        torso["root"] = [
            round((hl[0] + hr[0]) / 2, 1),
            round((hl[1] + hr[1]) / 2, 1),
        ]


def pick_joints(
    name: str,
    dots: list[tuple[float, float]],
    width: float = 0,
    height: float = 0,
) -> dict[str, list[float]]:
    """Map detected holes to named joints using part-relative regions."""
    if not dots:
        return {}

    if height <= 0:
        height = max(p[1] for p in dots) + 1
    if width <= 0:
        width = max(p[0] for p in dots) + 1

    by_y = sorted(dots, key=lambda p: (p[1], p[0]))

    if name == "torso":
        if len(dots) >= 5:
            head = by_y[0]
            shoulder_band = [
                p for p in dots if height * 0.44 <= p[1] <= height * 0.58
            ]
            # 腿挂点在最下方裙边孔，不是腰侧装饰孔
            hip_band = [p for p in dots if p[1] >= height * 0.86]
            if len(shoulder_band) >= 2 and len(hip_band) >= 2:
                sl = min(shoulder_band, key=lambda p: p[0])
                sr = max(shoulder_band, key=lambda p: p[0])
                hl = min(hip_band, key=lambda p: p[0])
                hr = max(hip_band, key=lambda p: p[0])
                return {
                    "head": [round(head[0], 1), round(head[1], 1)],
                    "neck": [round(head[0], 1), round(head[1] + 104, 1)],
                    "shoulder_l": [round(sl[0], 1), round(sl[1], 1)],
                    "shoulder_r": [round(sr[0], 1), round(sr[1], 1)],
                    "hip_l": [round(hl[0], 1), round(hl[1], 1)],
                    "hip_r": [round(hr[0], 1), round(hr[1], 1)],
                    "root": [
                        round((hl[0] + hr[0]) / 2, 1),
                        round((hl[1] + hr[1]) / 2, 1),
                    ],
                }

        upper = [p for p in dots if p[1] < height * 0.42]
        lower = [p for p in dots if p[1] > height * 0.68]
        joints = {}
        if len(upper) >= 2:
            joints["shoulder_l"] = [
                round(min(upper, key=lambda p: p[0])[0], 1),
                round(min(upper, key=lambda p: p[0])[1], 1),
            ]
            joints["shoulder_r"] = [
                round(max(upper, key=lambda p: p[0])[0], 1),
                round(max(upper, key=lambda p: p[0])[1], 1),
            ]
        if len(lower) >= 2:
            joints["hip_l"] = [
                round(min(lower, key=lambda p: p[0])[0], 1),
                round(min(lower, key=lambda p: p[0])[1], 1),
            ]
            joints["hip_r"] = [
                round(max(lower, key=lambda p: p[0])[0], 1),
                round(max(lower, key=lambda p: p[0])[1], 1),
            ]
        elif len(by_y) >= 2:
            # 兜底：用整体最左/最右下方的孔
            low = [p for p in dots if p[1] > height * 0.55] or by_y[-4:]
            joints["hip_l"] = [
                round(min(low, key=lambda p: p[0])[0], 1),
                round(min(low, key=lambda p: p[0])[1], 1),
            ]
            joints["hip_r"] = [
                round(max(low, key=lambda p: p[0])[0], 1),
                round(max(low, key=lambda p: p[0])[1], 1),
            ]
        if "hip_l" in joints:
            joints["root"] = [
                round((joints["hip_l"][0] + joints["hip_r"][0]) / 2, 1),
                round((joints["hip_l"][1] + joints["hip_r"][1]) / 2, 1),
            ]
        if "shoulder_l" in joints and "shoulder_r" in joints:
            joints["head"] = [
                round((joints["shoulder_l"][0] + joints["shoulder_r"][0]) / 2, 1),
                round(min(joints["shoulder_l"][1], joints["shoulder_r"][1]) - 148, 1),
            ]
        return joints

    if name in ("upper_arm_l", "upper_arm_r"):
        top = [p for p in dots if p[1] <= height * 0.22] or by_y[:1]
        bottom = [p for p in dots if p[1] >= height * 0.68] or by_y[-1:]
        if name == "upper_arm_l":
            shoulder = max(top, key=lambda p: p[0])
        else:
            shoulder = min(top, key=lambda p: p[0])
        elbow = bottom[0]
        return {
            "shoulder": [round(shoulder[0], 1), round(shoulder[1], 1)],
            "elbow": [round(elbow[0], 1), round(elbow[1], 1)],
        }

    if name in ("lower_arm_l", "lower_arm_r"):
        if name == "lower_arm_r":
            # 右小臂包含很长的金箍棒，棒身顶部也可能形成透明小孔；
            # 关节孔在手臂区域，排除上方棒身装饰孔。
            arm_holes = [p for p in by_y if p[1] > height * 0.32] or by_y
        else:
            arm_holes = by_y
        elbow = arm_holes[0]
        wrist = arm_holes[1] if len(arm_holes) > 1 else arm_holes[0]
        joints = {
            "elbow": [round(elbow[0], 1), round(elbow[1], 1)],
            "wrist": [round(wrist[0], 1), round(wrist[1], 1)],
        }
        if len(arm_holes) > 2:
            mid = arm_holes[2]
            joints["staff_mid"] = [round(mid[0], 1), round(mid[1], 1)]
        return joints

    if name in ("arm_l", "arm_r"):
        top_band = [p for p in dots if p[1] < height * 0.32]
        if not top_band:
            top_band = by_y[: max(3, len(by_y) // 4)]
        if name == "arm_l":
            shoulder = max(top_band, key=lambda p: p[0])
        else:
            shoulder = min(top_band, key=lambda p: p[0])
        rest = [p for p in dots if p[1] > shoulder[1] + height * 0.08]
        joints = {
            "shoulder": [round(shoulder[0], 1), round(shoulder[1], 1)],
        }
        if rest:
            elbow = sorted(rest, key=lambda p: p[1])[0]
            joints["elbow"] = [round(elbow[0], 1), round(elbow[1], 1)]
        elbow_y = joints.get("elbow", joints["shoulder"])[1]
        below_elbow = [p for p in dots if p[1] > elbow_y + height * 0.08]
        if below_elbow:
            if name == "arm_r":
                wrist = max(below_elbow, key=lambda p: p[0])
            else:
                wrist = min(below_elbow, key=lambda p: p[0])
            joints["wrist"] = [round(wrist[0], 1), round(wrist[1], 1)]
        return joints

    if name in ("thigh_l", "thigh_r"):
        top = [p for p in dots if p[1] <= height * 0.22] or by_y[:1]
        bottom = [p for p in dots if p[1] >= height * 0.55] or by_y[-1:]
        if name == "thigh_l":
            hip = max(top, key=lambda p: p[0])
        else:
            hip = min(top, key=lambda p: p[0])
        knee = bottom[0]
        return {
            "hip": [round(hip[0], 1), round(hip[1], 1)],
            "knee": [round(knee[0], 1), round(knee[1], 1)],
        }

    if name in ("shin_l", "shin_r"):
        knee = by_y[0]
        ankle = by_y[1] if len(by_y) > 1 else by_y[0]
        return {
            "knee": [round(knee[0], 1), round(knee[1], 1)],
            "ankle": [round(ankle[0], 1), round(ankle[1], 1)],
        }

    if name in ("leg_l", "leg_r"):
        hip = min(by_y, key=lambda p: p[1])
        below_hip = [p for p in dots if p[1] > hip[1] + height * 0.06]
        knee = sorted(below_hip, key=lambda p: p[1])[0] if below_hip else hip
        joints = {
            "hip": [round(hip[0], 1), round(hip[1], 1)],
            "knee": [round(knee[0], 1), round(knee[1], 1)],
        }
        ankle_candidates = [p for p in dots if p[1] > knee[1] + height * 0.12]
        if ankle_candidates:
            ankle = max(ankle_candidates, key=lambda p: p[1])
            joints["ankle"] = [round(ankle[0], 1), round(ankle[1], 1)]
        return joints

    return {}


def wukong_finger_bindings() -> list:
    return [
        {
            "id": "line_head",
            "label": "头部",
            "hand": "left",
            "finger": "middle",
            "part": "torso",
            "joint": "head",
            "rotateJoint": "head",
            "hangJoint": "root",
            "stringLengthStage": 88,
            "angleOffset": -90,
            "minRot": -28,
            "maxRot": 28,
        },
        {
            "id": "line_wrist_r",
            "label": "金箍棒",
            "hand": "left",
            "finger": "index",
            "part": "lower_arm_r",
            "joint": "wrist",
            "rotateJoint": "elbow",
            "stringLength": 175,
            "minRot": -55,
            "maxRot": 65,
        },
        {
            "id": "line_wrist_l",
            "label": "左手",
            "hand": "left",
            "finger": "ring",
            "part": "lower_arm_l",
            "joint": "wrist",
            "rotateJoint": "elbow",
            "stringLengthStage": 92,
            "minRot": -78,
            "maxRot": 78,
        },
        {
            "id": "line_leg_l",
            "label": "左脚",
            "hand": "left",
            "finger": "pinky",
            "part": "shin_l",
            "joint": "ankle",
            "rotateJoint": "knee",
            "stringLengthStage": 235,
            "minRot": -65,
            "maxRot": 65,
        },
        {
            "id": "line_leg_r",
            "label": "右脚",
            "hand": "left",
            "finger": "thumb",
            "part": "shin_r",
            "joint": "ankle",
            "rotateJoint": "knee",
            "stringLengthStage": 235,
            "minRot": -65,
            "maxRot": 65,
        },
    ]


def build_rig(meta: dict, cfg: dict) -> dict:
    if "upper_arm_l" in meta:
        prefix = cfg["asset_prefix"]
        order = [
            "torso",
            "upper_arm_l",
            "lower_arm_l",
            "upper_arm_r",
            "lower_arm_r",
            "thigh_l",
            "shin_l",
            "thigh_r",
            "shin_r",
        ]
        rotate = {
            "torso": "head",
            "upper_arm_l": "shoulder",
            "lower_arm_l": "elbow",
            "upper_arm_r": "shoulder",
            "lower_arm_r": "elbow",
            "thigh_l": "hip",
            "shin_l": "knee",
            "thigh_r": "hip",
            "shin_r": "knee",
        }
        z_index = {
            "thigh_l": 1,
            "shin_l": 1,
            "thigh_r": 1,
            "shin_r": 1,
            "torso": 2,
            "upper_arm_l": 4,
            "lower_arm_l": 4,
            "upper_arm_r": 4,
            "lower_arm_r": 4,
        }
        parts = {}
        for name in order:
            p = meta[name]
            parts[name] = {
                "path": f"{prefix}/{p['file']}",
                "width": p["width"],
                "height": p["height"],
                "joints": p["joints"],
                "rotateJoint": rotate[name],
                "zIndex": z_index[name],
            }

        rig = {
            "name": cfg["name"],
            "scale": 0.32,
            "flipX": cfg["flip_x"],
            "rootAnchor": meta["torso"]["joints"].get(
                "head", meta["torso"]["joints"].get("root", [220, 520])
            ),
            "drawOrder": [
                "thigh_l",
                "shin_l",
                "thigh_r",
                "shin_r",
                "torso",
                "upper_arm_l",
                "lower_arm_l",
                "upper_arm_r",
                "lower_arm_r",
            ],
            "parts": parts,
            "links": [
                {
                    "parent": "torso",
                    "parentJoint": "shoulder_l",
                    "child": "upper_arm_l",
                    "childJoint": "shoulder",
                },
                {
                    "parent": "upper_arm_l",
                    "parentJoint": "elbow",
                    "child": "lower_arm_l",
                    "childJoint": "elbow",
                },
                {
                    "parent": "torso",
                    "parentJoint": "shoulder_r",
                    "child": "upper_arm_r",
                    "childJoint": "shoulder",
                },
                {
                    "parent": "upper_arm_r",
                    "parentJoint": "elbow",
                    "child": "lower_arm_r",
                    "childJoint": "elbow",
                },
                {
                    "parent": "torso",
                    "parentJoint": "hip_l",
                    "child": "thigh_l",
                    "childJoint": "hip",
                },
                {
                    "parent": "thigh_l",
                    "parentJoint": "knee",
                    "child": "shin_l",
                    "childJoint": "knee",
                },
                {
                    "parent": "torso",
                    "parentJoint": "hip_r",
                    "child": "thigh_r",
                    "childJoint": "hip",
                },
                {
                    "parent": "thigh_r",
                    "parentJoint": "knee",
                    "child": "shin_r",
                    "childJoint": "knee",
                },
            ],
            "defaults": {name: {"rotation": 0} for name in order},
        }

        if cfg["player"]:
            rig["fingerBindings"] = wukong_finger_bindings()
        return rig

    t, al, ar, ll, lr = meta["torso"], meta["arm_l"], meta["arm_r"], meta["leg_l"], meta["leg_r"]
    prefix = cfg["asset_prefix"]

    rig = {
        "name": cfg["name"],
        "scale": 0.32,
        "flipX": cfg["flip_x"],
        "rootAnchor": t["joints"].get("head", t["joints"].get("root", [220, 520])),
        "drawOrder": ["leg_l", "leg_r", "torso", "arm_l", "arm_r"],
        "parts": {
            "torso": {
                "path": f"{prefix}/{t['file']}",
                "width": t["width"],
                "height": t["height"],
                "joints": t["joints"],
                "rotateJoint": "root",
            },
            "arm_l": {
                "path": f"{prefix}/{al['file']}",
                "width": al["width"],
                "height": al["height"],
                "joints": al["joints"],
                "rotateJoint": "shoulder",
            },
            "arm_r": {
                "path": f"{prefix}/{ar['file']}",
                "width": ar["width"],
                "height": ar["height"],
                "joints": ar["joints"],
                "rotateJoint": "shoulder",
            },
            "leg_l": {
                "path": f"{prefix}/{ll['file']}",
                "width": ll["width"],
                "height": ll["height"],
                "joints": ll["joints"],
                "rotateJoint": "hip",
            },
            "leg_r": {
                "path": f"{prefix}/{lr['file']}",
                "width": lr["width"],
                "height": lr["height"],
                "joints": lr["joints"],
                "rotateJoint": "hip",
            },
        },
        "links": [
            {
                "parent": "torso",
                "parentJoint": "hip_l",
                "child": "leg_l",
                "childJoint": "hip",
            },
            {
                "parent": "torso",
                "parentJoint": "hip_r",
                "child": "leg_r",
                "childJoint": "hip",
            },
            {
                "parent": "torso",
                "parentJoint": "shoulder_l",
                "child": "arm_l",
                "childJoint": "shoulder",
            },
            {
                "parent": "torso",
                "parentJoint": "shoulder_r",
                "child": "arm_r",
                "childJoint": "shoulder",
            },
        ],
        "defaults": {
            "torso": {"rotation": 0},
            "arm_l": {"rotation": 0},
            "arm_r": {"rotation": 0},
            "leg_l": {"rotation": 0},
            "leg_r": {"rotation": 0},
        },
    }

    if cfg["player"]:
        rig["fingerBindings"] = wukong_finger_bindings()
    return rig


def process_character(cfg: dict) -> None:
    src = cfg["src"]
    out_dir = cfg["out_dir"]
    out_dir.mkdir(parents=True, exist_ok=True)

    if not src.exists():
        raise FileNotFoundError(f"Missing source image: {src}")

    im = Image.open(src).convert("RGB")
    arr = np.array(im)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    green = (g > 140) & (r < 130) & (b < 130) & (g > r + 25) & (g > b + 25)
    white = (r > 200) & (g > 200) & (b > 200)
    fg_crop = (~green) & (~white)

    parts_boxes = classify_parts(connected_part_boxes(fg_crop))
    full_rgba = chroma_key(im)
    dots_global = find_joint_dots(full_rgba)

    meta = {}
    origins: dict[str, tuple[float, float]] = {}
    is_nine_part_wukong = "upper_arm_l" in parts_boxes
    for name, crop in parts_boxes.items():
        cropped = full_rgba.crop(crop)
        tb = bbox_non_transparent(cropped)
        pre_strip = cropped.crop(tb)
        origins[name] = (crop[0] + tb[0], crop[1] + tb[1])
        if is_nine_part_wukong:
            tight = keep_largest_component(pre_strip)
            dots = find_transparent_holes(tight)
            joints = pick_joints(name, dots, tight.width, tight.height)
        else:
            dots = [(float(x), float(y)) for x, y in find_joint_dots(pre_strip)]
            if len(dots) < 2:
                dots = local_dots(dots_global, crop, tb)
            if len(dots) < 2:
                dots = find_transparent_holes(pre_strip)
            joints = pick_joints(name, dots, pre_strip.width, pre_strip.height)
            tight = strip_joint_dots(pre_strip)
            tight = keep_largest_component(tight)

        # 后腿原图脚尖朝左，与侧身向右的身体不一致，水平镜像并同步关节 x
        if cfg.get("mirror_leg_l") and name == "leg_l":
            w = tight.width
            tight = ImageOps.mirror(tight)
            joints = {
                k: [round(w - v[0], 1), v[1]] for k, v in joints.items()
            }
        elif name in cfg.get("mirror_parts", []):
            w = tight.width
            tight = ImageOps.mirror(tight)
            joints = {
                k: [round(w - v[0], 1), v[1]] for k, v in joints.items()
            }

        meta[name] = {
            "file": f"{name}.png",
            "width": tight.width,
            "height": tight.height,
            "joints": joints,
            "dots": dots,
        }
        tight.save(out_dir / f"{name}.png")

    if cfg.get("layout_joints"):
        apply_layout_attachment_joints(meta, parts_boxes, origins)
    apply_joint_overrides(meta, cfg)

    for name in meta:
        meta[name]["dots"] = [[round(x, 1), round(y, 1)] for x, y in meta[name]["dots"]]
        print(cfg["name"], name, (meta[name]["width"], meta[name]["height"]), meta[name]["joints"])

    rig = build_rig(meta, cfg)
    with open(out_dir / "rig.json", "w", encoding="utf-8") as f:
        json.dump(rig, f, indent=2, ensure_ascii=False)
    print("Wrote", out_dir / "rig.json")


def main():
    parser = argparse.ArgumentParser(description="Process shadow puppet part sheets.")
    parser.add_argument(
        "--character",
        choices=["wukong", "all"],
        default="all",
        help="Which character sheet to process (default: all)",
    )
    args = parser.parse_args()

    (ROOT / "assets" / "bg").mkdir(parents=True, exist_ok=True)
    if BG_SRC.exists():
        Image.open(BG_SRC).save(BG_OUT)

    names = list(CHARACTERS.keys()) if args.character == "all" else [args.character]
    for name in names:
        process_character(CHARACTERS[name])


if __name__ == "__main__":
    main()
