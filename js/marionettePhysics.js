import { clamp, degToRad, radToDeg } from "./utils.js";

/**
 * 单根提线吊着的活动部件：静止时重力下垂，移动时指尖拉孔。
 */
export class MarionetteBone {
  /**
   * @param {object} opts
   * @param {number} opts.restAngle 自然下垂角（度，与 CSS rotate 一致）
   * @param {{ x: number, y: number }} opts.holeOffset 孔相对枢轴的局部偏移（未旋转时）
   * @param {{ x: number, y: number }} [opts.comOffset]
   * @param {number} [opts.inertia]
   * @param {number} [opts.damping]
   * @param {number} [opts.gravity]
   * @param {number} [opts.stringK] 活跃拉线强度
   * @param {number} [opts.hangSpring] 静止时回垂弹簧
   * @param {number} [opts.minRot]
   * @param {number} [opts.maxRot]
   */
  constructor(opts) {
    this.restAngle = opts.restAngle ?? 0;
    this.angle = this.restAngle;
    this.angularVelocity = 0;
    this.holeOffset = opts.holeOffset;
    this.comOffset =
      opts.comOffset ??
      {
        x: opts.holeOffset.x * 0.55,
        y: opts.holeOffset.y * 0.65 + 12,
      };
    this.inertia = opts.inertia ?? 1.1;
    this.damping = opts.damping ?? 4.8;
    this.gravity = opts.gravity ?? 820;
    this.stringK = opts.stringK ?? 58;
    this.hangSpring = opts.hangSpring ?? 110;
    this.minRot = opts.minRot ?? -88;
    this.maxRot = opts.maxRot ?? 88;
    /** @type {{ x: number, y: number } | null} */
    this.fingerTarget = null;
    /** 仅受重力下垂（手静止） */
    this.gravityHang = true;
    this.pivot = { x: 0, y: 0 };
  }

  setPivot(pivot) {
    this.pivot = pivot;
  }

  /**
   * @param {{ x: number, y: number } | null} target
   * @param {boolean} [gravityHang] true=只下垂不拉向指尖
   */
  setFingerTarget(target, gravityHang = false) {
    this.fingerTarget = target;
    this.gravityHang = gravityHang || !target;
  }

  freeze() {
    this.angularVelocity = 0;
  }

  _angleError() {
    let err = this.restAngle - this.angle;
    while (err > 180) err -= 360;
    while (err < -180) err += 360;
    return err;
  }

  step(dt) {
    const dtClamped = clamp(dt, 0.001, 0.05);
    const rad = degToRad(this.angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const hx =
      this.pivot.x + this.holeOffset.x * cos - this.holeOffset.y * sin;
    const hy =
      this.pivot.y + this.holeOffset.x * sin + this.holeOffset.y * cos;
    const cx =
      this.pivot.x + this.comOffset.x * cos - this.comOffset.y * sin;
    const cy =
      this.pivot.y + this.comOffset.x * sin + this.comOffset.y * cos;

    let torque = (cx - this.pivot.x) * this.gravity;

    const err = this._angleError();
    if (this.gravityHang) {
      torque += err * this.hangSpring;
    }

    if (this.fingerTarget && !this.gravityHang) {
      const dx = this.fingerTarget.x - hx;
      const dy = this.fingerTarget.y - hy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.8) {
        const pull = this.stringK * Math.min(dist, 280);
        const fx = (dx / dist) * pull;
        const fy = (dy / dist) * pull;
        torque += (hx - this.pivot.x) * fy - (hy - this.pivot.y) * fx;
      }
    }

    this.angularVelocity += (torque / this.inertia) * dtClamped;
    this.angularVelocity *= Math.exp(-this.damping * dtClamped);
    this.angle += radToDeg(this.angularVelocity) * dtClamped;
    this.angle = clamp(this.angle, this.minRot, this.maxRot);
  }

  getHoleAssembly() {
    const rad = degToRad(this.angle);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: this.pivot.x + this.holeOffset.x * cos - this.holeOffset.y * sin,
      y: this.pivot.y + this.holeOffset.x * sin + this.holeOffset.y * cos,
    };
  }
}
