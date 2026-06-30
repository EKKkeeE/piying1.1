/**
 * 阶段1巨型石板：石板底图 + 抠图凹槽叠层（皮影在更上层，不在此处理）
 */

const SLAB_IMG = "assets/bg/stone/slab.jpg?v=4";
const GROOVE_IMG = "assets/bg/stone/hand_groove.png";
const GROOVE_CUTOUT_IMG = "assets/bg/stone/hand_groove_cutout.png?v=16";
/** 凹槽相对 cover 尺寸的缩放（<1 缩小） */
const GROOVE_SCALE = 0.82;

export class StoneSlab {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.mount = mount;

    this.bgEl =
      mount.querySelector(".stone-slab-bg") ?? this._createImg("stone-slab-bg");
    this.grooveWrap =
      mount.querySelector(".stone-groove-wrap") ?? this._createGrooveWrap();
    this.grooveEl =
      this.grooveWrap.querySelector(".stone-groove-overlay") ??
      this._createGrooveImg();
    this.canvas =
      mount.querySelector(".stone-slab-composite") ??
      this._createCompositeCanvas();

    if (!this.bgEl.parentElement) mount.appendChild(this.bgEl);
    if (!this.grooveWrap.parentElement) mount.appendChild(this.grooveWrap);
    if (!this.grooveEl.parentElement) this.grooveWrap.appendChild(this.grooveEl);
    if (!this.canvas.parentElement) mount.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d");
    /** @type {HTMLImageElement | null} */
    this.slabImg = null;
    /** @type {HTMLImageElement | null} */
    this.grooveImg = null;
    /** @type {HTMLImageElement | null} */
    this.grooveCutout = null;

    this._w = 0;
    this._h = 0;
    this._pulseT = 0;
    this._loadPromise = this._loadImages();
  }

  _createGrooveWrap() {
    const wrap = document.createElement("div");
    wrap.className = "stone-groove-wrap";
    wrap.setAttribute("aria-hidden", "true");
    return wrap;
  }

  _createGrooveImg() {
    const img = document.createElement("img");
    img.className = "stone-groove-overlay";
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    return img;
  }

  /** @param {string} className */
  _createImg(className) {
    const img = document.createElement("img");
    img.className = className;
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    return img;
  }

  _createCompositeCanvas() {
    const canvas = document.createElement("canvas");
    canvas.className = "stone-slab-composite";
    canvas.setAttribute("hidden", "");
    canvas.setAttribute("aria-hidden", "true");
    return canvas;
  }

  /** @param {string} src */
  _loadDomImage(el, src) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve(el.naturalWidth > 0 ? el : null);
      };
      el.addEventListener("load", done, { once: true });
      el.addEventListener("error", done, { once: true });
      el.src = src;
      if (el.complete) done();
    });
  }

  async _loadImages() {
    const loadMeta = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`image load failed: ${src}`));
        img.src = src;
      });

    const [slabEl, cutoutEl, metaResult] = await Promise.all([
      this._loadDomImage(this.bgEl, SLAB_IMG),
      this._loadDomImage(this.grooveEl, GROOVE_CUTOUT_IMG),
      Promise.allSettled([loadMeta(GROOVE_IMG)]).then(([r]) => r),
    ]);

    this.slabImg = slabEl;
    if (!this.slabImg) console.warn("[StoneSlab] 石板图加载失败", SLAB_IMG);

    this.grooveCutout = cutoutEl;
    if (!this.grooveCutout) {
      console.warn("[StoneSlab] 凹槽抠图加载失败", GROOVE_CUTOUT_IMG);
      this.grooveWrap.hidden = true;
    } else {
      this.grooveWrap.hidden = false;
    }

    if (metaResult.status === "fulfilled") {
      this.grooveImg = metaResult.value;
    } else {
      this.grooveImg = this.grooveCutout;
      console.warn("[StoneSlab] 凹槽定位图加载失败，改用抠图尺寸", metaResult.reason);
    }

    this._applyGrooveLayout();
  }

  resize() {
    const rect = this.mount.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this._w = rect.width;
    this._h = rect.height;
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._applyGrooveLayout();
  }

  /** @param {HTMLImageElement} img */
  _coverRect(img, w = this._w, h = this._h) {
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    return {
      dx: (w - dw) / 2,
      dy: (h - dh) / 2,
      dw,
      dh,
    };
  }

  /** 与背景同 cover 基准，再按 GROOVE_SCALE 居中缩小 */
  _grooveRect(img, w = this._w, h = this._h) {
    const cover = this._coverRect(img, w, h);
    const dw = cover.dw * GROOVE_SCALE;
    const dh = cover.dh * GROOVE_SCALE;
    return {
      dx: cover.dx + (cover.dw - dw) / 2,
      dy: cover.dy + (cover.dh - dh) / 2,
      dw,
      dh,
    };
  }

  _applyGrooveLayout() {
    const ref = this.grooveImg ?? this.grooveCutout;
    if (!ref || !this.grooveCutout || this._w <= 0) return;

    const gr = this._grooveRect(ref);
    const wrap = this.grooveWrap;
    wrap.style.left = `${gr.dx}px`;
    wrap.style.top = `${gr.dy}px`;
    wrap.style.width = `${gr.dw}px`;
    wrap.style.height = `${gr.dh}px`;
    wrap.dataset.layoutReady = "true";
  }

  /**
   * @param {number} [stageW]
   * @param {number} [stageH]
   */
  getGrooveBounds(stageW = this._w, stageH = this._h) {
    const ref = this.grooveImg ?? this.grooveCutout;
    if (ref && stageW > 0 && stageH > 0) {
      const gr = this._grooveRect(ref, stageW, stageH);
      return {
        x0: gr.dx,
        y0: gr.dy,
        x1: gr.dx + gr.dw,
        y1: gr.dy + gr.dh,
        cx: gr.dx + gr.dw / 2,
        cy: gr.dy + gr.dh / 2,
        dw: gr.dw,
        dh: gr.dh,
      };
    }
    const cx = stageW * 0.5;
    const cy = stageH * 0.48;
    const r = Math.min(stageW, stageH) * 0.24;
    return {
      x0: cx - r,
      y0: cy - r,
      x1: cx + r,
      y1: cy + r,
      cx,
      cy,
      dw: r * 2,
      dh: r * 2,
    };
  }

  /** @returns {{ cx: number, cy: number, r: number }} */
  _grooveGeometry(w = this._w, h = this._h) {
    const ref = this.grooveImg ?? this.grooveCutout;
    if (ref && w > 0 && h > 0) {
      const gr = this._grooveRect(ref, w, h);
      return {
        cx: gr.dx + gr.dw / 2,
        cy: gr.dy + gr.dh / 2,
        r: Math.min(gr.dw, gr.dh) * 0.36,
      };
    }
    return {
      cx: w * 0.5,
      cy: h * 0.48,
      r: Math.min(w, h) * 0.24,
    };
  }

  /** @param {CanvasRenderingContext2D} ctx @param {HTMLImageElement} img */
  _drawSlabOnCanvas(ctx, img) {
    const { dx, dy, dw, dh } = this._coverRect(img);
    ctx.save();
    ctx.filter = "brightness(1.14) contrast(1.06) saturate(1.05)";
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  /** @param {CanvasRenderingContext2D} ctx */
  _drawGrooveOnCanvas(ctx) {
    const ref = this.grooveImg ?? this.grooveCutout;
    const cutout = this.grooveCutout;
    if (!ref || !cutout) return;

    const { dx, dy, dw, dh } = this._grooveRect(ref);
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(cutout, 0, 0, dw, dh);
    ctx.restore();
  }

  /** 震碎前合成石板+凹槽到离屏 canvas */
  buildShatterSnapshot() {
    if (!this.ctx || this._w <= 0) return;
    this.ctx.clearRect(0, 0, this._w, this._h);
    if (this.slabImg) this._drawSlabOnCanvas(this.ctx, this.slabImg);
    this._drawGrooveOnCanvas(this.ctx);
  }

  /**
   * 更新凹槽动效（CSS），不重绘全屏 canvas
   * @param {{ glowEdge?: boolean, grooveBreathe?: boolean, pulseShake?: boolean, edgeAlpha?: number, dt?: number, includeSlab?: boolean }} opts
   */
  draw(opts = {}) {
    const {
      glowEdge = false,
      grooveBreathe = false,
      pulseShake = false,
      includeSlab = false,
    } = opts;

    if (grooveBreathe || pulseShake) this._pulseT += opts.dt ?? 0;

    if (includeSlab) this.buildShatterSnapshot();

    this._applyGrooveLayout();

    const el = this.grooveEl;
    const wrap = this.grooveWrap;
    if (!el || wrap.hidden) return;

    el.classList.toggle("groove-edge-glow", glowEdge || pulseShake);
    wrap.classList.toggle("groove-edge-glow", glowEdge || pulseShake);
    wrap.classList.toggle("groove-breathe", grooveBreathe);
    wrap.classList.toggle("groove-pulse-shake", pulseShake);
  }

  getGrooveAnchors(stageW = this._w, stageH = this._h) {
    const { cx, cy, r } = this._grooveGeometry(stageW, stageH);
    return {
      thumb: { x: cx + r * 0.75, y: cy + r * 0.55 },
      index: { x: cx + r * 0.55, y: cy - r * 0.85 },
      middle: { x: cx, y: cy - r * 1.05 },
      ring: { x: cx - r * 0.55, y: cy - r * 0.85 },
      pinky: { x: cx - r * 0.75, y: cy + r * 0.55 },
    };
  }

  getPuppetCenter(stageW = this._w, stageH = this._h) {
    const { cx, cy } = this._grooveGeometry(stageW, stageH);
    return { x: cx, y: cy };
  }

  async ready() {
    return this._loadPromise;
  }

  hideSlab() {
    this.bgEl.style.visibility = "hidden";
    this.grooveWrap.style.visibility = "hidden";
  }

  showSlab() {
    this.bgEl.style.visibility = "";
    this.grooveWrap.style.visibility = "";
    if (this.grooveCutout) this.grooveWrap.hidden = false;
  }

  hide() {
    this.hideSlab();
    this.mount.classList.add("stone-hidden");
  }

  show() {
    this.showSlab();
    this.mount.classList.remove("stone-hidden");
  }
}
