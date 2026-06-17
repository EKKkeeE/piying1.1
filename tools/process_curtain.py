"""抠除幕布动画帧黑色背景，输出透明 PNG 序列。"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = Path(
    r"C:\Users\hetao\.cursor\projects\d-coding-shoushipiying\assets"
)
OUT_DIR = ROOT / "assets" / "bg" / "curtain"
AUDIO_SRC = Path(r"C:\Users\hetao\开场.mp3")
AUDIO_OUT = ROOT / "assets" / "audio" / "opening.mp3"
BGM_SRC = Path(r"C:\Users\hetao\bgm.mp3")
BGM_OUT = ROOT / "assets" / "audio" / "bgm.mp3"

FRAMES = [
    "c__Users_hetao_AppData_Roaming_Cursor_User_workspaceStorage_9c3c9108b9438bbb9f097d3271ecc383_images_image-deb08bed-5913-4aea-bd9b-f4cab765a0cc.png",
    "c__Users_hetao_AppData_Roaming_Cursor_User_workspaceStorage_9c3c9108b9438bbb9f097d3271ecc383_images_image-635d721f-d4e4-41a4-853b-87d9e0ef0f67.png",
    "c__Users_hetao_AppData_Roaming_Cursor_User_workspaceStorage_9c3c9108b9438bbb9f097d3271ecc383_images_image-278359aa-8fb6-4d77-b8cf-1cd3b1c363da.png",
    "c__Users_hetao_AppData_Roaming_Cursor_User_workspaceStorage_9c3c9108b9438bbb9f097d3271ecc383_images_image-cc257f1b-6324-4d97-beb5-0678f9afd5b1.png",
    "c__Users_hetao_AppData_Roaming_Cursor_User_workspaceStorage_9c3c9108b9438bbb9f097d3271ecc383_images_image-d1496d1d-049a-431e-ab01-5d2110f9da7b.png",
    "c__Users_hetao_AppData_Roaming_Cursor_User_workspaceStorage_9c3c9108b9438bbb9f097d3271ecc383_images_image-c9ac29a1-7b8b-4411-b9f2-18e17f4c2db6.png",
]


def remove_black(im: Image.Image, threshold: int = 28) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r <= threshold and g <= threshold and b <= threshold:
                px[x, y] = (0, 0, 0, 0)
    return rgba


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_OUT.parent.mkdir(parents=True, exist_ok=True)

    for i, name in enumerate(FRAMES, start=1):
        src = SRC_DIR / name
        if not src.exists():
            raise FileNotFoundError(f"缺少源图：{src}")
        out = OUT_DIR / f"frame-{i:02d}.png"
        remove_black(Image.open(src)).save(out, optimize=True)
        print(f" wrote {out.name} ({out.stat().st_size // 1024} KB)")

    final = OUT_DIR / "frame-06.png"
    shutil.copy2(final, ROOT / "assets" / "bg" / "curtain.png")

    if AUDIO_SRC.exists():
        shutil.copy2(AUDIO_SRC, AUDIO_OUT)
        print(f" copied audio -> {AUDIO_OUT.relative_to(ROOT)}")
    else:
        print(f" warning: audio not found at {AUDIO_SRC}")

    if BGM_SRC.exists():
        shutil.copy2(BGM_SRC, BGM_OUT)
        print(f" copied bgm -> {BGM_OUT.relative_to(ROOT)}")
    else:
        print(f" warning: bgm not found at {BGM_SRC}")

    print("done")


if __name__ == "__main__":
    main()
