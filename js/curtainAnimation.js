const FRAME_COUNT = 6;
const FRAME_MS = 180;

/**
 * 开场幕布拉幕动画：Canvas 绘制预解码帧序列，避免 CSS background 切换闪烁。
 */
export class CurtainAnimation {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.mount = mount;
    this.audio = new Audio("assets/audio/opening.mp3");
    this.audio.preload = "auto";
    /** @type {HTMLCanvasElement} */
    this.canvas = document.createElement("canvas");
    this.canvas.className = "curtain-canvas";
    this.canvas.hidden = true;
    this.ctx = this.canvas.getContext("2d");
    this.mount.appendChild(this.canvas);
    /** @type {HTMLImageElement[]} */
    this.frames = [];
    this.loaded = false;
    this.playing = false;
    this.lastFrameIndex = -1;
    /** @type {Promise<void> | null} */
    this._preloadPromise = null;
    /** @type {Promise<void> | null} */
    this._playPromise = null;
  }

  resize() {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.lastFrameIndex >= 0 && this.frames[this.lastFrameIndex]) {
      this.drawFrame(this.frames[this.lastFrameIndex]);
    }
  }

  /** @param {HTMLImageElement} img */
  drawFrame(img) {
    const w = this.mount.clientWidth;
    const h = this.mount.clientHeight;
    if (w <= 0 || h <= 0) return;
    if (this.canvas.width <= 0 || this.canvas.height <= 0) {
      this.resize();
      if (this.canvas.width <= 0 || this.canvas.height <= 0) return;
    }

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const dx = (w - dw) / 2;
    const dy = 0;

    this.ctx.clearRect(0, 0, w, h);
    this.ctx.drawImage(img, dx, dy, dw, dh);
  }

  async preload() {
    if (this.loaded) return;
    if (this._preloadPromise) return this._preloadPromise;

    this._preloadPromise = (async () => {
      const tasks = [];
      const frames = [];
      for (let i = 1; i <= FRAME_COUNT; i += 1) {
        const img = new Image();
        img.decoding = "async";
        img.src = `assets/bg/curtain/frame-${String(i).padStart(2, "0")}.png`;
        frames.push(img);
        tasks.push(
          (async () => {
            await new Promise((resolve, reject) => {
              img.onload = () => resolve(undefined);
              img.onerror = () => reject(new Error(`无法加载幕布帧 ${i}`));
            });
            if (img.decode) {
              await img.decode().catch(() => {});
            }
          })()
        );
      }
      await Promise.all(tasks);
      this.frames = frames;
      this.loaded = true;
    })();

    try {
      await this._preloadPromise;
    } finally {
      this._preloadPromise = null;
    }
  }

  /** 等待 mount 获得有效尺寸，避免 Canvas 无法绘制 */
  async _waitLayout() {
    for (let i = 0; i < 120; i += 1) {
      if (this.mount.clientWidth > 0 && this.mount.clientHeight > 0) {
        return;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  /** 确保 Canvas 已按当前布局完成缩放并绘制指定帧 */
  _prepareFrame(img) {
    this.resize();
    if (!img || this.canvas.width <= 0 || this.canvas.height <= 0) {
      return false;
    }
    this.drawFrame(img);
    return true;
  }

  /** @returns {Promise<void>} */
  play() {
    if (this._playPromise) return this._playPromise;
    this._playPromise = this._play().finally(() => {
      this._playPromise = null;
    });
    return this._playPromise;
  }

  async _play() {
    await this.preload();

    this.playing = true;
    try {
      this.mount.hidden = false;
      this.mount.setAttribute("aria-hidden", "false");
      this.mount.classList.remove("curtain-done");
      this.mount.classList.add("curtain-playing");
      this.canvas.hidden = false;
      this.lastFrameIndex = -1;

      await this._waitLayout();
      if (this.frames[0]) {
        this.lastFrameIndex = 0;
        if (!this._prepareFrame(this.frames[0])) {
          await this._waitLayout();
          this._prepareFrame(this.frames[0]);
        }
      }

      this.audio.currentTime = 0;
      const audioPromise = this.audio.play().catch(() => {});
      const totalMs = FRAME_COUNT * FRAME_MS;
      const start = performance.now();

      await new Promise((resolve) => {
        const tick = (now) => {
          const elapsed = now - start;
          const index = Math.min(
            Math.floor(elapsed / FRAME_MS),
            FRAME_COUNT - 1
          );
          if (index !== this.lastFrameIndex) {
            this.lastFrameIndex = index;
            this.drawFrame(this.frames[index]);
          }
          if (elapsed < totalMs) {
            requestAnimationFrame(tick);
          } else {
            resolve(undefined);
          }
        };
        requestAnimationFrame(tick);
      });

      await audioPromise;

      this.mount.classList.remove("curtain-playing");
      this.mount.classList.add("curtain-done");
      if (this.frames.length) {
        this.lastFrameIndex = this.frames.length - 1;
        this.drawFrame(this.frames[this.frames.length - 1]);
      }
    } finally {
      this.playing = false;
    }
  }

  /** 落幕：与开场相反的帧序（最后一帧 → 第一帧） */
  playClose() {
    if (this.playing) {
      return new Promise((resolve) => {
        const wait = () => {
          if (!this.playing) {
            this._playClose().then(resolve);
          } else {
            requestAnimationFrame(wait);
          }
        };
        wait();
      });
    }
    return this._playClose();
  }

  async _playClose() {
    await this.preload();

    this.playing = true;
    try {
      this.mount.hidden = false;
      this.mount.setAttribute("aria-hidden", "false");
      this.mount.classList.remove("curtain-done");
      this.mount.classList.add("curtain-playing");
      this.canvas.hidden = false;
      this.lastFrameIndex = -1;

      await this._waitLayout();
      const firstClose = this.frames[FRAME_COUNT - 1];
      if (firstClose) {
        this.lastFrameIndex = FRAME_COUNT - 1;
        if (!this._prepareFrame(firstClose)) {
          await this._waitLayout();
          this._prepareFrame(firstClose);
        }
      }

      const totalMs = FRAME_COUNT * FRAME_MS;
      const start = performance.now();

      await new Promise((resolve) => {
        const tick = (now) => {
          const elapsed = now - start;
          const forwardIndex = Math.min(
            Math.floor(elapsed / FRAME_MS),
            FRAME_COUNT - 1
          );
          const index = FRAME_COUNT - 1 - forwardIndex;
          if (index !== this.lastFrameIndex) {
            this.lastFrameIndex = index;
            this.drawFrame(this.frames[index]);
          }
          if (elapsed < totalMs) {
            requestAnimationFrame(tick);
          } else {
            resolve(undefined);
          }
        };
        requestAnimationFrame(tick);
      });

      this.mount.classList.remove("curtain-playing");
    } finally {
      this.playing = false;
    }
  }

  /** 再来一局时恢复开场结束后的展开帷幕装饰帧 */
  snapOpen() {
    if (this.playing || !this.loaded || !this.frames.length) return;
    const last = this.frames[this.frames.length - 1];
    this.mount.hidden = false;
    this.mount.setAttribute("aria-hidden", "false");
    this.canvas.hidden = false;
    this.resize();
    this.lastFrameIndex = this.frames.length - 1;
    this.drawFrame(last);
    this.mount.classList.add("curtain-done");
  }
}
