/**
 * 在皮影背景场景上绘制五指结点与绷紧提线（指尖→孔位直线，与示意图一致）
 */

/** 提线控制的指尖 MediaPipe 编号 */
const CONTROL_TIP_INDICES = new Set([4, 8, 12, 16, 20]);

export class StringLines {
  constructor(canvas, stageLayer) {
    this.canvas = canvas;
    this.stageLayer = stageLayer;
    this.ctx = canvas.getContext("2d");
  }

  resize() {
    const rect = this.stageLayer.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  }

  draw(payload) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this._w, this._h);

    const strings = payload.strings ?? [];
    const handSkeleton = payload.handSkeleton ?? { landmarks: [], connections: [] };

    this._drawHandSkeleton(ctx, handSkeleton);

    for (const s of strings) {
      const finger = s.fingerPt ?? s.finger;
      if (!finger || !s.joint) continue;

      ctx.beginPath();
      ctx.moveTo(finger.x, finger.y);
      ctx.lineTo(s.joint.x, s.joint.y);
      ctx.strokeStyle = "rgba(24, 20, 14, 0.82)";
      ctx.lineWidth = 2.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(finger.x, finger.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(35, 190, 90, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(15, 95, 44, 0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
      if (s.tipIndex != null) {
        ctx.fillStyle = "rgba(35, 190, 90, 0.95)";
        ctx.font = "bold 16px Segoe UI";
        ctx.fillText(String(s.tipIndex), finger.x + 5, finger.y - 6);
      }
    }

    for (const s of strings) {
      if (!s.joint) continue;
      ctx.beginPath();
      ctx.arc(s.joint.x, s.joint.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
      ctx.fill();
    }
  }

  clear() {
    this.ctx?.clearRect(0, 0, this._w, this._h);
  }

  _drawHandSkeleton(ctx, handSkeleton) {
    const landmarks = handSkeleton.landmarks ?? [];
    const connections = handSkeleton.connections ?? [];
    if (!landmarks.length) return;

    const byIndex = new Map(landmarks.map((lm) => [lm.index, lm]));

    ctx.strokeStyle = "rgba(98, 106, 118, 0.88)";
    ctx.lineWidth = 4.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [a, b] of connections) {
      const p0 = byIndex.get(a);
      const p1 = byIndex.get(b);
      if (!p0 || !p1) continue;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }

    for (const lm of landmarks) {
      if (CONTROL_TIP_INDICES.has(lm.index)) continue;
      ctx.beginPath();
      ctx.arc(lm.x, lm.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(35, 190, 90, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(15, 95, 44, 0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "rgba(35, 190, 90, 0.95)";
      ctx.font = "bold 16px Segoe UI";
      ctx.fillText(String(lm.index), lm.x + 5, lm.y - 6);
    }

    const wrist = byIndex.get(0);
    if (wrist) {
      ctx.fillStyle = "rgba(35, 190, 90, 0.95)";
      ctx.font = "bold 38px Segoe UI";
      ctx.fillText(handSkeleton.handLabel ?? "Left", wrist.x + 24, wrist.y + 28);
    }
  }
}
