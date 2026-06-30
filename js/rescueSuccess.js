/** 解救成功：三幕通关演出（冲击 → 苏醒 → 归来 → 余韵） */

const FLASH_MS = 550;
const TITLE_DELAY_MS = 2000;
const CHAR_STAGGER_MS = 420;
const CHAR_IN_MS = 580;
const HOLD_MS = 1500;
const FADE_OUT_MS = 3200;
const CHAR_COUNT = 4;

/** 原图「挑战成功」排版：四字错落、横向叠压（相对合成框 1466×590） */
const GLYPH_LAYOUT = [
  { x: 0, y: 0, w: 34.31, h: 86.78 },
  { x: 31.58, y: 2.2, w: 28.65, h: 93.73 },
  { x: 53.82, y: 7.97, w: 24.49, h: 74.41 },
  { x: 68.01, y: 5.59, w: 31.99, h: 94.58 },
];

export class RescueSuccessOverlay {
  /**
   * @param {HTMLElement | null} root
   * @param {HTMLElement | null} stageEl
   * @param {HTMLElement | null} titleEl
   * @param {{ onFlash?: () => void, onCharStamp?: (i: number) => void, onClimax?: () => void, onFinish?: () => void }} [hooks]
   */
  constructor(root, stageEl, titleEl, hooks = {}) {
    this.root = root;
    this.stageEl = stageEl;
    this.titleEl = titleEl;
    this.hooks = hooks;
    this.raysEl = root?.querySelector(".rescue-success-rays") ?? null;
    this.flashCoreEl = root?.querySelector(".rescue-success-flash-core") ?? null;
    this.flashEl = root?.querySelector(".rescue-success-flash") ?? null;
    this.climaxEl = root?.querySelector(".rescue-success-climax") ?? null;
    this.charEls = [...(this.titleEl?.querySelectorAll(".rescue-char") ?? [])];
    this._applyGlyphLayout();
    this.state = "idle";
    this._elapsed = 0;
    this._titleShown = false;
    this._fadeStarted = false;
    this._finished = false;
    this._charStamped = new Array(CHAR_COUNT).fill(false);
  }

  _applyGlyphLayout() {
    this.charEls.forEach((el, i) => {
      const box = GLYPH_LAYOUT[i];
      if (!box) return;
      el.style.left = `${box.x}%`;
      el.style.top = `${box.y}%`;
      el.style.width = `${box.w}%`;
      el.style.height = `${box.h}%`;
      el.style.zIndex = "";
      el.style.objectPosition = "center center";
    });
  }

  reset() {
    this.state = "idle";
    this._elapsed = 0;
    this._titleShown = false;
    this._fadeStarted = false;
    this._finished = false;
    this._charStamped.fill(false);

    if (this.root) {
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.classList.remove(
        "rescue-success-active",
        "rescue-rays-on",
        "rescue-overlay-fade"
      );
    }
    if (this.titleEl) {
      this.titleEl.hidden = true;
      this.titleEl.setAttribute("aria-hidden", "true");
    }
    this.flashCoreEl?.classList.remove("rescue-flash-core-on");
    this.flashEl?.classList.remove("rescue-flash-on");
    this.raysEl?.classList.remove("rescue-rays-on");
    this.climaxEl?.classList.remove("rescue-climax-on");
    this.titleEl?.classList.remove("rescue-title-in", "rescue-title-out");
    for (const el of this.charEls) {
      el.classList.remove("rescue-char-in", "rescue-char-out");
    }
    this.stageEl?.classList.remove(
      "stage-success-ambient",
      "stage-success-ambient-pulse"
    );
  }

  /** @param {() => void} [onFlash] */
  triggerAtImpact(onFlash) {
    if (!this.root || this.state !== "idle") return;
    this.state = "active";
    this._elapsed = 0;
    this._titleShown = false;
    this._fadeStarted = false;
    this._finished = false;
    this._charStamped.fill(false);

    this.root.hidden = false;
    this.root.setAttribute("aria-hidden", "false");
    this.root.classList.add("rescue-success-active");
    this.root.classList.remove("rescue-overlay-fade");
    if (this.titleEl) {
      this.titleEl.hidden = false;
      this.titleEl.setAttribute("aria-hidden", "false");
    }
    this.raysEl?.classList.add("rescue-rays-on");
    this.flashCoreEl?.classList.add("rescue-flash-core-on");
    this.flashEl?.classList.add("rescue-flash-on");

    // sfx hook: 碎裂冲击
    onFlash?.();
    this.hooks.onFlash?.();
  }

  /** @param {number} dt 秒 */
  update(dt) {
    if (this.state !== "active") return;
    this._elapsed += dt * 1000;

    if (this._elapsed >= FLASH_MS) {
      this.flashCoreEl?.classList.remove("rescue-flash-core-on");
      this.flashEl?.classList.remove("rescue-flash-on");
    }

    const titleAt = TITLE_DELAY_MS;
    if (this._elapsed >= titleAt) {
      if (!this._titleShown) {
        this._titleShown = true;
        this.titleEl?.classList.add("rescue-title-in");
      }
      for (let i = 0; i < this.charEls.length; i++) {
        if (this._elapsed >= titleAt + i * CHAR_STAGGER_MS) {
          if (!this._charStamped[i]) {
            this._charStamped[i] = true;
            this.charEls[i].classList.add("rescue-char-in");
            // sfx hook: 逐字盖章
            this.hooks.onCharStamp?.(i);
            if (i === CHAR_COUNT - 1) {
              this.climaxEl?.classList.add("rescue-climax-on");
              // sfx hook: 第四字高潮
              this.hooks.onClimax?.();
            }
          }
        }
      }
    }

    const allCharsInAt =
      titleAt + (CHAR_COUNT - 1) * CHAR_STAGGER_MS + CHAR_IN_MS;

    const fadeAt = allCharsInAt + HOLD_MS;
    if (!this._fadeStarted && this._elapsed >= fadeAt) {
      this._fadeStarted = true;
      this.root?.classList.add("rescue-overlay-fade");
      this.raysEl?.classList.remove("rescue-rays-on");
      this.titleEl?.classList.remove("rescue-title-in");
      this.titleEl?.classList.add("rescue-title-out");
    }

    const endAt = fadeAt + FADE_OUT_MS;
    if (!this._finished && this._elapsed >= endAt) {
      this._finishToAmbient();
    }
  }

  enterAmbient() {
    if (this.state === "ambient") return;
    if (this.state === "idle") {
      this.stageEl?.classList.add("stage-success-ambient");
    }
  }

  _finishToAmbient() {
    this._finished = true;
    this.state = "ambient";
    if (this.root) {
      this.root.hidden = true;
      this.root.setAttribute("aria-hidden", "true");
      this.root.classList.remove(
        "rescue-success-active",
        "rescue-rays-on",
        "rescue-overlay-fade"
      );
    }
    if (this.titleEl) {
      this.titleEl.hidden = true;
      this.titleEl.setAttribute("aria-hidden", "true");
    }
    this.climaxEl?.classList.remove("rescue-climax-on");
    this.titleEl?.classList.remove("rescue-title-in", "rescue-title-out");
    for (const el of this.charEls) {
      el.classList.remove("rescue-char-in", "rescue-char-out");
    }
    this.stageEl?.classList.add("stage-success-ambient");
    this.hooks.onFinish?.();
  }
}
