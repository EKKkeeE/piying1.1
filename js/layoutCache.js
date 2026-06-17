/**
 * 缓存舞台/皮影的屏幕变换，避免每帧 getBoundingClientRect 造成卡顿。
 */
export class LayoutCache {
  /**
   * @param {HTMLElement} stageEl
   * @param {() => import('./puppetRig.js').PuppetRig | null} getRig
   * @param {HTMLElement | null} [mountEl] 皮影挂载层（固定中心，勿用 0×0 wrapper）
   */
  constructor(stageEl, getRig, mountEl = null) {
    this.stageEl = stageEl;
    this.mountEl = mountEl;
    this.getRig = getRig;
    this.stageRect = { left: 0, top: 0, width: 1, height: 1 };
    this.mountCx = 0;
    this.mountCy = 0;
    this.cx = 0;
    this.cy = 0;
    this.ax = 0;
    this.ay = 0;
    this.scale = 1;
    this._lastRefresh = 0;
  }

  /**
   * @param {boolean} [force]
   */
  refresh(force = false) {
    const now = performance.now();
    if (!force && now - this._lastRefresh < 120) return;
    this._lastRefresh = now;

    this.stageRect = this.stageEl.getBoundingClientRect();
    const rig = this.getRig();

    if (this.mountEl) {
      const mount = this.mountEl.getBoundingClientRect();
      this.mountCx = mount.left + mount.width / 2 - this.stageRect.left;
      this.mountCy = mount.top + mount.height / 2 - this.stageRect.top;
    } else {
      this.mountCx = this.stageRect.width / 2;
      this.mountCy = this.stageRect.height / 2;
    }

    if (!rig) return;

    const [ax, ay] = rig.rootAnchor;
    this.ax = ax;
    this.ay = ay;
    this.scale = rig.scale;
    this.cx = this.mountCx + rig.rootExtra.x;
    this.cy = this.mountCy + rig.rootExtra.y;
  }

  /**
   * @param {{ x: number, y: number }} asm
   * @param {number} [rootX]
   * @param {number} [rootY]
   */
  assemblyToStage(asm, rootX, rootY) {
    const rig = this.getRig();
    const rx = rootX ?? rig?.rootExtra?.x ?? 0;
    const ry = rootY ?? rig?.rootExtra?.y ?? 0;
    return {
      x: this.mountCx + rx + (asm.x - this.ax) * this.scale,
      y: this.mountCy + ry + (asm.y - this.ay) * this.scale,
    };
  }

  /** @param {{ x: number, y: number }} client 视口 client 坐标 */
  clientToStage(client) {
    return {
      x: client.x - this.stageRect.left,
      y: client.y - this.stageRect.top,
    };
  }

  /** @param {{ x: number, y: number }} client */
  clientToAssembly(client) {
    const rig = this.getRig();
    const rx = rig?.rootExtra?.x ?? 0;
    const ry = rig?.rootExtra?.y ?? 0;
    const cx = this.mountCx + rx;
    const cy = this.mountCy + ry;
    return {
      x: this.ax + (client.x - this.stageRect.left - cx) / this.scale,
      y: this.ay + (client.y - this.stageRect.top - cy) / this.scale,
    };
  }

  /**
   * @param {{ x: number, y: number }} stagePt
   * @param {number} [rootX] 与 fingerMarionette.root 同步，避免 step 内上一帧 root
   * @param {number} [rootY]
   */
  stageToAssembly(stagePt, rootX, rootY) {
    const rig = this.getRig();
    if (!rig) return { x: 0, y: 0 };
    const rx = rootX ?? rig.rootExtra.x;
    const ry = rootY ?? rig.rootExtra.y;
    const cx = this.mountCx + rx;
    const cy = this.mountCy + ry;
    const clientX = this.stageRect.left + stagePt.x;
    const clientY = this.stageRect.top + stagePt.y;
    return {
      x: this.ax + (clientX - this.stageRect.left - cx) / this.scale,
      y: this.ay + (clientY - this.stageRect.top - cy) / this.scale,
    };
  }
}
