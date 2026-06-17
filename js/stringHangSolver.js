import { clamp, degToRad, radToDeg } from "./utils.js";

/**
 * 孔在装配空间的位置（绕枢轴旋转）
 */
export function holeAt(pivot, holeOffset, angleDeg) {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: pivot.x + holeOffset.x * cos - holeOffset.y * sin,
    y: pivot.y + holeOffset.x * sin + holeOffset.y * cos,
  };
}

/** 二连杆搜索步长 */
const CHAIN_SOLVE_STEP = 0.5;
/** 同分候选里优先接近上一帧的解（越低越灵敏） */
const CONTINUITY_WEIGHT = 0.18;
/** score 接近最优时仍视为同一档，在此档内选 continuity 最小 */
const SCORE_TIE_EPS = 2.5;
/** 先在上一帧角度附近搜索，避免全范围跳解 */
const LOCAL_SEARCH_DEG = 36;

function shortestAngleDelta(a, b) {
  let d = ((a - b + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

function clampRange(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** 在 score 最优档内选 continuity 最小的候选 */
function pickSticky(candidates) {
  if (!candidates.length) return null;
  let minScore = Infinity;
  for (const c of candidates) {
    if (c.score < minScore) minScore = c.score;
  }
  let best = null;
  let bestCont = Infinity;
  for (const c of candidates) {
    if (c.score > minScore + SCORE_TIE_EPS) continue;
    if (c.cont < bestCont || (c.cont === bestCont && c.score < (best?.score ?? Infinity))) {
      bestCont = c.cont;
      best = c;
    }
  }
  return best;
}

function reachScore(dist, stringLen, cont, useLen, EPS, continuityWeight) {
  const cw = continuityWeight ?? CONTINUITY_WEIGHT;
  if (useLen) {
    const under = Math.max(0, stringLen - dist);
    const over = Math.max(0, dist - stringLen - EPS);
    return under * 1.35 + over * 14 + cont * cw;
  }
  return dist + cont * cw;
}

function searchReachWindow(
  finger,
  parent,
  child,
  endAt,
  stringLen,
  paMin,
  paMax,
  caMin,
  caMax,
  continuityWeight = CONTINUITY_WEIGHT,
  childContinuityScale = 1,
  parentContinuityScale = 1
) {
  const useLen = stringLen > 0;
  const EPS = 0.8;
  const candidates = [];
  const childCont = Math.max(0, childContinuityScale);
  const parentCont = Math.max(0, parentContinuityScale);

  for (
    let pa = paMin;
    pa <= paMax;
    pa += CHAIN_SOLVE_STEP
  ) {
    for (
      let ca = caMin;
      ca <= caMax;
      ca += CHAIN_SOLVE_STEP
    ) {
      const end = endAt(pa, ca);
      if (!end) continue;
      const dist = Math.hypot(end.x - finger.x, end.y - finger.y);
      const cont =
        Math.abs(shortestAngleDelta(pa, parent.prevAngle)) * parentCont +
        Math.abs(shortestAngleDelta(ca, child.prevAngle)) * childCont;
      candidates.push({
        parent: pa,
        child: ca,
        score: reachScore(dist, stringLen, cont, useLen, EPS, continuityWeight),
        cont,
      });
    }
  }
  return pickSticky(candidates);
}

/**
 * 已知孔世界坐标，反解旋转角（与 CSS rotate 一致）
 */
export function angleFromHoleWorld(pivot, holeOffset, targetH) {
  const lx = targetH.x - pivot.x;
  const ly = targetH.y - pivot.y;
  const cross = holeOffset.x * ly - holeOffset.y * lx;
  const dot = holeOffset.x * lx + holeOffset.y * ly;
  return radToDeg(Math.atan2(cross, dot));
}

/**
 * 固定长度提线：|孔 - 指尖| = stringLen，求关节角
 * @param {{ x: number, y: number }} pivot
 * @param {{ x: number, y: number }} finger 装配空间指尖
 * @param {{ x: number, y: number }} holeOffset
 * @param {number} stringLen 固定线长（装配空间，不随动作改变）
 * @param {number} minRot
 * @param {number} maxRot
 * @param {number} [prevAngle]
 */
export function solveFixedStringAngle(
  pivot,
  finger,
  holeOffset,
  stringLen,
  minRot,
  maxRot,
  prevAngle = 0
) {
  const EPS = 0.8;
  const hang = solveGravityHangAngle(holeOffset, minRot, maxRot);
  let bestFeasible = null;
  let bestInfeasible = null;

  // 2D 同平面单边约束：
  // - 绳不可伸长：|finger-hole| <= stringLen
  // - 绳只能拉不能推：满足约束时，关节仅受重力，取最低势能姿态
  // - 若所有角都违约（手把线拉得过紧），取最小超长量的姿态
  for (let a = minRot; a <= maxRot; a += CHAIN_SOLVE_STEP) {
    const h = holeAt(pivot, holeOffset, a);
    const dist = Math.hypot(h.x - finger.x, h.y - finger.y);
    const continuity = Math.abs(shortestAngleDelta(a, prevAngle));

    if (dist <= stringLen + EPS) {
      const gravityPenalty = Math.abs(shortestAngleDelta(a, hang));
      const score = gravityPenalty * 1.0 + continuity * CONTINUITY_WEIGHT;
      if (!bestFeasible || score < bestFeasible.score) {
        bestFeasible = { a, score };
      }
      continue;
    }

    const overstretch = dist - stringLen;
    const gravityPenalty = Math.abs(shortestAngleDelta(a, hang));
    const score = overstretch * 14 + gravityPenalty * 0.12 + continuity * CONTINUITY_WEIGHT * 0.35;
    if (!bestInfeasible || score < bestInfeasible.score) {
      bestInfeasible = { a, score };
    }
  }

  if (bestFeasible) return clamp(bestFeasible.a, minRot, maxRot);
  if (bestInfeasible) return clamp(bestInfeasible.a, minRot, maxRot);
  return clamp(hang, minRot, maxRot);
}

/**
 * 二连杆提线：|末端孔 - 指尖| <= stringLen，同时求 parent/child 关节角。
 * 用于「小臂/小腿提线带动大臂/大腿」。
 * @param {{ x: number, y: number }} finger
 * @param {number} stringLen
 * @param {{ minRot: number, maxRot: number, hangAngle: number, prevAngle: number }} parent
 * @param {{ minRot: number, maxRot: number, hangAngle: number, prevAngle: number }} child
 * @param {(parentDeg: number, childDeg: number) => { x: number, y: number } | null} endAt
 */
export function solveChainStringAngles(
  finger,
  stringLen,
  parent,
  child,
  endAt
) {
  const EPS = 0.8;
  let bestFeasible = null;
  let bestInfeasible = null;

  for (let pa = parent.minRot; pa <= parent.maxRot; pa += CHAIN_SOLVE_STEP) {
    for (let ca = child.minRot; ca <= child.maxRot; ca += CHAIN_SOLVE_STEP) {
      const end = endAt(pa, ca);
      if (!end) continue;
      const dist = Math.hypot(end.x - finger.x, end.y - finger.y);
      const cont =
        Math.abs(shortestAngleDelta(pa, parent.prevAngle)) +
        Math.abs(shortestAngleDelta(ca, child.prevAngle));
      const grav =
        Math.abs(shortestAngleDelta(pa, parent.hangAngle)) +
        Math.abs(shortestAngleDelta(ca, child.hangAngle));

      if (dist <= stringLen + EPS) {
        const score = grav * 1.0 + cont * CONTINUITY_WEIGHT;
        if (!bestFeasible || score < bestFeasible.score) {
          bestFeasible = { parent: pa, child: ca, score };
        }
      } else {
        const overstretch = dist - stringLen;
        const score = overstretch * 14 + grav * 0.1 + cont * CONTINUITY_WEIGHT * 0.35;
        if (!bestInfeasible || score < bestInfeasible.score) {
          bestInfeasible = { parent: pa, child: ca, score };
        }
      }
    }
  }

  const pick = bestFeasible ?? bestInfeasible;
  if (pick) {
    return {
      parent: clamp(pick.parent, parent.minRot, parent.maxRot),
      child: clamp(pick.child, child.minRot, child.maxRot),
    };
  }
  return {
    parent: clamp(parent.hangAngle, parent.minRot, parent.maxRot),
    child: clamp(child.hangAngle, child.minRot, child.maxRot),
  };
}

/**
 * 绷紧提线：末端孔朝指尖靠拢；若给定 stringLen，则尽量保持该线长（更长 = 孔位离指尖更远）。
 * @param {number} [stringLen] 装配空间目标线长，0 表示尽量贴近指尖
 * @param {{ continuityWeight?: number, localSearchDeg?: number, childContinuityScale?: number, parentContinuityScale?: number }} [opts]
 */
export function solveReachChainStringAngles(
  finger,
  parent,
  child,
  endAt,
  stringLen = 0,
  opts = {}
) {
  const continuityWeight = opts.continuityWeight ?? CONTINUITY_WEIGHT;
  const localSearchDeg = opts.localSearchDeg ?? LOCAL_SEARCH_DEG;
  const childContinuityScale = opts.childContinuityScale ?? 1;
  const parentContinuityScale = opts.parentContinuityScale ?? 1;

  const local = searchReachWindow(
    finger,
    parent,
    child,
    endAt,
    stringLen,
    clampRange(parent.prevAngle - localSearchDeg, parent.minRot, parent.maxRot),
    clampRange(parent.prevAngle + localSearchDeg, parent.minRot, parent.maxRot),
    clampRange(child.prevAngle - localSearchDeg, child.minRot, child.maxRot),
    clampRange(child.prevAngle + localSearchDeg, child.minRot, child.maxRot),
    continuityWeight,
    childContinuityScale,
    parentContinuityScale
  );
  if (local) {
    return {
      parent: clamp(local.parent, parent.minRot, parent.maxRot),
      child: clamp(local.child, child.minRot, child.maxRot),
    };
  }

  const full = searchReachWindow(
    finger,
    parent,
    child,
    endAt,
    stringLen,
    parent.minRot,
    parent.maxRot,
    child.minRot,
    child.maxRot,
    continuityWeight,
    childContinuityScale,
    parentContinuityScale
  );
  if (full) {
    return {
      parent: clamp(full.parent, parent.minRot, parent.maxRot),
      child: clamp(full.child, child.minRot, child.maxRot),
    };
  }
  return {
    parent: clamp(parent.hangAngle, parent.minRot, parent.maxRot),
    child: clamp(child.hangAngle, child.minRot, child.maxRot),
  };
}

/** 默认固定线长（装配坐标；偏短才容易“拉紧”并跟手） */
export function defaultStringLength(binding, holeOffset) {
  if (binding.stringLength != null) return binding.stringLength;
  const r = Math.hypot(holeOffset.x, holeOffset.y);
  if (binding.part === "torso") return r * 0.72 + 95;
  if (binding.part === "arm_l" || binding.part === "arm_r") {
    return r * 1.12 + 72;
  }
  return r * 1.18 + 78;
}

export function solveGravityHangAngle(holeOffset, minRot, maxRot) {
  const { x: vx, y: vy } = holeOffset;
  let best = minRot;
  let bestY = -Infinity;
  for (let a = minRot; a <= maxRot; a += 1) {
    const rad = degToRad(a);
    const hy = vx * Math.sin(rad) + vy * Math.cos(rad);
    if (hy > bestY) {
      bestY = hy;
      best = a;
    }
  }
  return best;
}
