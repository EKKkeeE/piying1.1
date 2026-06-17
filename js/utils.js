/** @typedef {{ x: number, y: number }} Point */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {number} deg
 */
export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * @param {number} rad
 */
export function radToDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * @param {Point} a
 * @param {Point} b
 */
export function angleBetween(a, b) {
  return radToDeg(Math.atan2(b.y - a.y, b.x - a.x));
}

/**
 * @param {Point} a
 * @param {Point} b
 */
export function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/**
 * Exponential smoothing.
 * @param {number} current
 * @param {number} target
 * @param {number} alpha 0..1, higher = snappier
 */
export function smooth(current, target, alpha) {
  return current + (target - current) * alpha;
}

/**
 * @param {Point} current
 * @param {Point} target
 * @param {number} alpha
 */
export function smoothPoint(current, target, alpha) {
  return {
    x: smooth(current.x, target.x, alpha),
    y: smooth(current.y, target.y, alpha),
  };
}

/**
 * Two-bone IK in 2D. Returns [upperDeg, lowerDeg] relative to parent rotation.
 * @param {number} len1
 * @param {number} len2
 * @param {number} targetX local x
 * @param {number} targetY local y
 */
export function solveTwoBoneIK(len1, len2, targetX, targetY) {
  const d = Math.hypot(targetX, targetY);
  const maxReach = len1 + len2 - 1;
  const minReach = Math.abs(len1 - len2) + 1;
  const dist = clamp(d, minReach, maxReach);
  const base = Math.atan2(targetY, targetX);
  const cos2 =
    (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist || 1);
  const a1 = base + Math.acos(clamp(cos2, -1, 1));
  const a2 =
    Math.atan2(targetY - Math.sin(a1) * len1, targetX - Math.cos(a1) * len1) - a1;
  return [radToDeg(a1), radToDeg(a2)];
}

/**
 * @param {number} current
 * @param {number} target
 * @param {number} maxDelta
 */
export function smoothAngle(current, target, alpha, maxDelta = 25) {
  let diff = ((target - current + 180) % 360) - 180;
  if (diff > maxDelta) diff = maxDelta;
  if (diff < -maxDelta) diff = -maxDelta;
  return current + diff * alpha;
}

/**
 * @param {DOMRect} stageRect
 * @param {number} nx 0..1 normalized (already mirrored if needed)
 * @param {number} ny 0..1 normalized
 */
export function normToStage(stageRect, nx, ny) {
  return {
    x: stageRect.left + nx * stageRect.width,
    y: stageRect.top + ny * stageRect.height,
  };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 帧率无关指数平滑：speed 越大越跟手 */
export function smoothExp(current, target, speed, dt) {
  const t = 1 - Math.exp(-Math.max(0, speed) * Math.max(0, dt));
  return current + (target - current) * t;
}

/**
 * @param {Point} current
 * @param {Point} target
 * @param {number} speed
 * @param {number} dt
 */
export function smoothPointExp(current, target, speed, dt) {
  return {
    x: smoothExp(current.x, target.x, speed, dt),
    y: smoothExp(current.y, target.y, speed, dt),
  };
}

/**
 * @param {number} current
 * @param {number} target
 * @param {number} speed
 * @param {number} dt
 * @param {number} [maxDelta]
 */
export function smoothAngleExp(current, target, speed, dt, maxDelta = 999) {
  let diff = ((target - current + 180) % 360) - 180;
  if (diff > maxDelta) diff = maxDelta;
  if (diff < -maxDelta) diff = -maxDelta;
  const t = 1 - Math.exp(-Math.max(0, speed) * Math.max(0, dt));
  return current + diff * t;
}

/**
 * 计算 limb 从当前姿态转到自然下垂（指向图像下方）所需的旋转角。
 * @param {number} jx 关节 x
 * @param {number} jy 关节 y
 * @param {number} ex 远端参考点 x（肘/膝）
 * @param {number} ey 远端参考点 y
 * @param {number} hangDeg 下垂方向角，图像坐标系向下为 90°
 */
export function gravityHangDeg(jx, jy, ex, ey, hangDeg = 90) {
  const rest = radToDeg(Math.atan2(ey - jy, ex - jx));
  let delta = hangDeg - rest;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}
