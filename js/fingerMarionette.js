import {
  clamp,
  gravityHangDeg,
  smoothAngle,
  smoothAngleExp,
  smoothExp,
  smoothPointExp,
} from "./utils.js";
import { landmarkToStage } from "./stageCoords.js";
import {
  angleFromHoleWorld,
  defaultStringLength,
  holeAt,
  solveGravityHangAngle,
  solveReachChainStringAngles,
} from "./stringHangSolver.js";

/** 提线拴在子段时，父段（大臂/大腿）随子段联动 */
const CHAIN_PARENT = {
  lower_arm_l: "upper_arm_l",
  lower_arm_r: "upper_arm_r",
  shin_l: "thigh_l",
  shin_r: "thigh_r",
};
/** 提线拴在子段：肘/膝关节角对应部件 */
const CHAIN_CHILD_PARTS = new Set([
  "lower_arm_l",
  "lower_arm_r",
  "shin_l",
  "shin_r",
]);

const FINGER_ZONE = { xMin: 0.04, xMax: 0.96, yMin: 0.08, yMax: 0.92 };
const LINE_HEAD_ID = "line_head";
function mpDeltaToStage(dmx, dmy, stageRect, mirrorX = true) {
  const xSpan = (FINGER_ZONE.xMax - FINGER_ZONE.xMin) * stageRect.width;
  const ySpan = (FINGER_ZONE.yMax - FINGER_ZONE.yMin) * stageRect.height;
  return {
    x: (mirrorX ? -dmx : dmx) * xSpan,
    y: dmy * ySpan,
  };
}

function mpMoveToStagePx(dmp, stageRect) {
  return dmp * (FINGER_ZONE.xMax - FINGER_ZONE.xMin) * stageRect.width;
}

/**
 * 摩擦死区滤波：死区内完全锁住，超出死区时只移动超出的那部分距离。
 * 相比硬切死区（直接跳到 next），消除了"蓄积-突跳"效应：
 * 缓慢移动时坐标平滑蠕动，而非周期性阶跃；随机噪声因方向随机无法蓄积。
 */
function stabilizeStagePoint(prev, next, thresholdPx) {
  if (!prev) return { x: next.x, y: next.y };
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= thresholdPx) {
    return { x: prev.x, y: prev.y };
  }
  const ratio = (dist - thresholdPx) / dist;
  return {
    x: prev.x + dx * ratio,
    y: prev.y + dy * ratio,
  };
}

/**
 * 头部提线下垂长度（舞台像素）。
 * rig 里 stringLength 是装配坐标，再 ×scale(≈0.32) 后改数几乎看不出；
 * 头部请用 stringLengthStage，直接控制「中指→头孔」的可见距离。
 */
function headStringDropPx(layout, binding) {
  if (binding?.stringLengthStage != null) return binding.stringLengthStage;
  if (binding?.stringLength != null) return binding.stringLength * layout.scale;
  return 140;
}

/** 提线长度：优先舞台像素 stringLengthStage，否则装配 stringLength×scale */
function bindingStringLengthPx(layout, binding, limb, isHead = false) {
  if (isHead) return headStringDropPx(layout, binding);
  if (binding?.stringLengthStage != null) return binding.stringLengthStage;
  if (binding?.stringLength != null) return binding.stringLength * layout.scale;
  return (limb?.stringLength ?? 0) * layout.scale;
}

/** 装配空间线长（二连杆求解、松紧度） */
function bindingStringLengthAsm(layout, binding, limb) {
  const px = bindingStringLengthPx(layout, binding, limb, false);
  return px > 0 ? px / layout.scale : limb?.stringLength ?? 0;
}
/** 无提线时按舞台重力下垂的部件（父→子顺序） */
const GRAVITY_CHAIN = [
  "upper_arm_l",
  "upper_arm_r",
  "thigh_l",
  "thigh_r",
  "lower_arm_l",
  "lower_arm_r",
  "shin_l",
  "shin_r",
];
const GRAVITY_PART_SPECS = [
  { name: "upper_arm_l", pivot: "shoulder", distal: "elbow", min: -78, max: 78 },
  { name: "upper_arm_r", pivot: "shoulder", distal: "elbow", min: -78, max: 78 },
  { name: "lower_arm_l", pivot: "elbow", distal: "wrist", min: -78, max: 78 },
  { name: "lower_arm_r", pivot: "elbow", distal: "wrist", min: -55, max: 65 },
  { name: "thigh_l", pivot: "hip", distal: "knee", min: -72, max: 72 },
  { name: "thigh_r", pivot: "hip", distal: "knee", min: -72, max: 72 },
  { name: "shin_l", pivot: "knee", distal: "ankle", min: -65, max: 65 },
  { name: "shin_r", pivot: "knee", distal: "ankle", min: -65, max: 65 },
];
const STILL_MOVE_PX = 14;
const STILL_HOLD_MS = 160;
const ACTIVE_MOVE_PX = 22;
const BURST_MOVE_PX = 36;
const FINGER_NOISE_PX = 5;
/** 非提线指节（掌指关节等）显示 deadzone */
const SKELETON_JOINT_NOISE_PX = 4;
/** 平移停下后锁定四肢 IK 时长（ms） */
const SETTLE_HOLD_MS = 90;
/** 舞台 px/s：高于此视为正在平移 */
const TRANSLATE_VEL_ENTER = 120;
/** 低于此且曾在平移 → 进入 settle */
const TRANSLATE_VEL_EXIT = 40;
/** 四肢响应参数更快渐变，避免肘膝跟手迟滞 */
const LIMB_RESPONSE_BLEND_KEYS = new Set([
  "limbSpeed",
  "limbChildSpeed",
  "limbMaxDelta",
  "limbChildMaxDelta",
  "reachBoost",
  "chainContinuity",
  "chainSearchDeg",
  "chainChildContinuity",
]);

export const FINGERTIPS = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
};

const TIP_NAMES = ["thumb", "index", "middle", "ring", "pinky"];
const TIP_INDICES = [4, 8, 12, 16, 20];
const DEFAULT_RESPONSE_GAIN = { tight: 1.85, slack: 1.45 };
const BINDING_RESPONSE_GAIN = {
  line_head: { tight: 2.35, slack: 0.95 },
  line_wrist_r: { tight: 2.55, slack: 1.05 },
  line_wrist_l: { tight: 2.2, slack: 1.05 },
  line_leg_l: { tight: 2.65, slack: 0.9 },
  line_leg_r: { tight: 2.65, slack: 0.9 },
};
/** 示意图：躯干可被四肢拉斜，求解范围略大于 rig 配置 */
const TORSO_SOLVE_MIN = -52;
const TORSO_SOLVE_MAX = 52;
const TORSO_GRAVITY_BIAS = 0.28;
const TORSO_TORQUE_GAIN = 0.055;
const TORSO_TORQUE_GAIN_MOVE = 0.092;
/** 提线拴在子段时，对应躯干上的受力枢轴（肩/髋） */
const CHAIN_TORSO_MOUNT = {
  lower_arm_l: "shoulder_l",
  lower_arm_r: "shoulder_r",
  shin_l: "hip_l",
  shin_r: "hip_r",
};
/** 肩/肘/髋额外响应倍率（仅在快速运动时放大） */
const JOINT_SENSITIVITY = {
  upper_arm_l: { speed: 1.45, maxDelta: 1.35 },
  upper_arm_r: { speed: 1.45, maxDelta: 1.35 },
  lower_arm_l: { speed: 1.35, maxDelta: 1.3 },
  lower_arm_r: { speed: 1.35, maxDelta: 1.3 },
  thigh_l: { speed: 1.45, maxDelta: 1.35 },
  thigh_r: { speed: 1.45, maxDelta: 1.35 },
};
const JOINT_SENSITIVITY_BURST = {
  upper_arm_l: { speed: 2.1, maxDelta: 1.85 },
  upper_arm_r: { speed: 2.1, maxDelta: 1.85 },
  lower_arm_l: { speed: 1.9, maxDelta: 1.75 },
  lower_arm_r: { speed: 1.9, maxDelta: 1.75 },
  thigh_l: { speed: 2.1, maxDelta: 1.85 },
  thigh_r: { speed: 2.1, maxDelta: 1.85 },
};
/** 二连杆 IK：父段（肩/髋）连续性权重，越低越灵敏 */
const PARENT_CHAIN_CONTINUITY = 0.32;
/** 手臂子段（肘）连续性权重；腿部子段（膝）保持原值 */
const ELBOW_CHAIN_CONTINUITY_SCALE = 0.38;
function shortestAngleDelta(a, b) {
  let d = ((a - b + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

/** MediaPipe 手部骨架连线（21 结点） */
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

/**
 * 提线木偶：几何悬吊求解 + 层级骨骼孔对孔
 */
export class FingerMarionette {
  constructor(rigData) {
    this.bindings = [...(rigData.fingerBindings ?? [])].sort((a, b) => {
      if (a.id === LINE_HEAD_ID) return -1;
      if (b.id === LINE_HEAD_ID) return 1;
      return 0;
    });
    this.mirrorX = true;
    this.lastFingerNodes = [];
    this.lastHandSkeleton = { landmarks: [], connections: HAND_CONNECTIONS };
    this.lastStrings = [];
    this.hasAnyFinger = false;
    this.physicsActive = false;
    /** @type {Map<string, { angle: number, holeOffset: object, minRot: number, maxRot: number, restAngle: number, tightness: number, slackness: number, tightnessEff: number, slacknessEff: number }>} */
    this.limbs = new Map();
    this._fingerAssembly = new Map();
    this.root = { x: 0, y: 0, rotation: 0 };
    this.handStill = false;
    this._wasHandStill = false;
    this._stillMs = 0;
    /** @type {{ x: number, y: number } | null} 上一帧检测到的原始中指 MP 坐标 */
    this._prevRawMiddleMp = null;
    /** @type {Map<string, { x: number, y: number }>} 上一帧原始相对中指偏移（MP） */
    this._prevRawRelMp = new Map();
    /** @type {Map<string, { x: number, y: number }>} 上一帧检测目标（舞台像素） */
    this._prevTargetStage = new Map();
    /** @type {{ x: number, y: number } | null} */
    this._prevPalmStage = null;
    /** @type {{ x: number, y: number } | null} */
    this._palmStage = null;
    /** @type {Map<number, { x: number, y: number }>} 稳定后的骨架结点（舞台像素） */
    this._skeletonStage = new Map();
    /** @type {Map<string, { x: number, y: number }>} 60fps 显示插值指尖（唯一平滑层） */
    this._displayFingers = new Map();
    /** @type {number} 平滑后的掌心平移速度（舞台 px/s） */
    this._smoothPalmVel = 0;
    /** @type {boolean} 是否处于整手平移段 */
    this._translating = false;
    /** @type {number} settle 结束时间戳 */
    this._settleUntil = 0;
    /** @type {Map<string, { x: number, y: number }>} 停下瞬间锁定的四肢 IK 目标 */
    this._lockedLimbIkAsm = new Map();
    this._lastDetectAt = 0;
    /** @type {Record<string, number> | null} 运动响应参数渐变 */
    this._blendedResponse = null;
    /** @type {boolean} 本帧直跟（仅 burst） */
    this._moveDirect = false;
    this._initLimbs(rigData);
    this._initGravityLimbs(rigData);
  }

  _initGravityLimbs(rigData) {
    const p = rigData.parts ?? {};
    for (const spec of GRAVITY_PART_SPECS) {
      if (this.limbs.has(spec.name)) continue;
      const part = p[spec.name];
      const pivot = part?.joints?.[spec.pivot];
      const distal = part?.joints?.[spec.distal];
      if (!part || !pivot || !distal) continue;

      const holeOffset = {
        x: distal[0] - pivot[0],
        y: distal[1] - pivot[1],
      };
      const hang = solveGravityHangAngle(holeOffset, spec.min, spec.max);
      this.limbs.set(spec.name, {
        angle: hang,
        restAngle: hang,
        holeOffset,
        pivotKey: spec.pivot,
        distalKey: spec.distal,
        stringLength: 0,
        tightness: 0,
        slackness: 0,
        tightnessEff: 0,
        slacknessEff: 0,
        minRot: spec.min,
        maxRot: spec.max,
      });
    }
  }

  _controlledParts() {
    const out = new Set();
    if (!this.physicsActive) return out;
    for (const binding of this.bindings) {
      if (!this._fingerAssembly.has(binding.id)) continue;
      out.add(binding.part);
      const parent = CHAIN_PARENT[binding.part];
      if (parent) out.add(parent);
    }
    return out;
  }

  /**
   * 小臂/小腿提线：联合求解父段 + 子段转角，使末端孔尽量靠近指尖（绷紧直线）。
   */
  _solveChainBinding(
    rig,
    layout,
    binding,
    fingerAsm,
    parentName,
    parentLimb,
    childLimb,
    response
  ) {
    const childName = binding.part;
    const jointKey = binding.joint;
    const prevP = rig.displayRotations[parentName] ?? parentLimb.angle;
    const prevC = rig.displayRotations[childName] ?? childLimb.angle;
    const hangP = solveGravityHangAngle(
      parentLimb.holeOffset,
      parentLimb.minRot,
      parentLimb.maxRot
    );
    const hangC = solveGravityHangAngle(
      childLimb.holeOffset,
      childLimb.minRot,
      childLimb.maxRot
    );

    const endAt = (pa, ca) => {
      rig.displayRotations[parentName] = pa;
      rig.displayRotations[childName] = ca;
      return rig.getJointAssemblyByKey(childName, jointKey);
    };

    const baseLen = bindingStringLengthAsm(layout, binding, childLimb);
    const reachBoost = response?.reachBoost ?? 0;
    const stringLen = baseLen * Math.max(0.42, 1 - reachBoost);
    const isArm = childName.startsWith("lower_arm");
    const chainOpts = {
      continuityWeight: response?.chainContinuity,
      localSearchDeg: (response?.chainSearchDeg ?? 36) * 1.45,
      childContinuityScale: isArm
        ? (response?.chainChildContinuity ?? 0.2) * ELBOW_CHAIN_CONTINUITY_SCALE
        : response?.chainChildContinuity,
      parentContinuityScale: PARENT_CHAIN_CONTINUITY,
    };

    const solved = solveReachChainStringAngles(
      fingerAsm,
      {
        minRot: parentLimb.minRot,
        maxRot: parentLimb.maxRot,
        hangAngle: hangP,
        prevAngle: prevP,
      },
      {
        minRot: childLimb.minRot,
        maxRot: childLimb.maxRot,
        hangAngle: hangC,
        prevAngle: prevC,
      },
      endAt,
      stringLen,
      chainOpts
    );

    rig.displayRotations[parentName] = prevP;
    rig.displayRotations[childName] = prevC;
    return solved;
  }

  /** 舞台竖直向下：远端关节 y 最大 */
  _solvePartHangStage(rig, layout, partName, limb) {
    const distalKey = limb.distalKey;
    if (!distalKey) {
      return solveGravityHangAngle(
        limb.holeOffset,
        limb.minRot,
        limb.maxRot
      );
    }
    const prev = rig.displayRotations[partName] ?? limb.angle;
    const rootX = this.root.x;
    const rootY = this.root.y;
    let best = prev;
    let bestY = -Infinity;
    const yEps = 0.35;
    for (let a = limb.minRot; a <= limb.maxRot; a += 0.5) {
      rig.displayRotations[partName] = a;
      const pt = rig.getJointAssemblyByKey(partName, distalKey);
      if (!pt) continue;
      const st = layout.assemblyToStage(pt, rootX, rootY);
      if (st.y > bestY + yEps) {
        bestY = st.y;
        best = a;
      } else if (Math.abs(st.y - bestY) <= yEps) {
        if (
          Math.abs(shortestAngleDelta(a, prev)) <
          Math.abs(shortestAngleDelta(best, prev))
        ) {
          best = a;
        }
      }
    }
    rig.displayRotations[partName] = prev;
    return clamp(best, limb.minRot, limb.maxRot);
  }

  _applyGravityChain(rig, layout, bonesOut, active) {
    const controlled = this._controlledParts();
    layout.refresh(true);
    const alpha = active ? 0.42 : 0.28;
    const maxDelta = active ? 28 : 18;

    for (const partName of GRAVITY_CHAIN) {
      if (controlled.has(partName)) continue;
      const limb = this.limbs.get(partName);
      if (!limb) continue;
      const hang = this._solvePartHangStage(rig, layout, partName, limb);
      limb.angle = smoothAngle(limb.angle, hang, alpha, maxDelta);
      bonesOut[partName] = limb.angle;
      rig.displayRotations[partName] = limb.angle;
    }
  }

  _initLimbs(rigData) {
    const p = rigData.parts ?? {};
    const rest = this._restAngles(p);

    for (const binding of this.bindings) {
      const part = p[binding.part];
      if (!part) continue;
      const pivotKey = binding.rotateJoint ?? part.rotateJoint;
      const holeKey = binding.joint;
      const pivot = part.joints[pivotKey];
      const hole = part.joints[holeKey];
      if (!pivot || !hole) continue;

      let holeOffset = { x: hole[0] - pivot[0], y: hole[1] - pivot[1] };
      const hangKey = binding.hangJoint;
      if (hangKey && part.joints[hangKey]) {
        const hangPt = part.joints[hangKey];
        holeOffset = {
          x: hangPt[0] - pivot[0],
          y: hangPt[1] - pivot[1],
        };
      }
      const restAngle = rest[binding.part] ?? 0;

      const hangAngle = solveGravityHangAngle(
        holeOffset,
        binding.minRot ?? -88,
        binding.maxRot ?? 88
      );

      const rigScale = rigData.scale ?? 0.32;
      const stringLength =
        binding.stringLengthStage != null
          ? binding.stringLengthStage / rigScale
          : defaultStringLength(binding, holeOffset);
      const nominal = this._nominalStringLength(binding.part, holeOffset);
      const tightness = Math.max(0, Math.min(1, (nominal - stringLength) / nominal));
      const gain = BINDING_RESPONSE_GAIN[binding.id] ?? DEFAULT_RESPONSE_GAIN;
      const tightnessEff = Math.min(1, Math.sqrt(tightness) * gain.tight);

      const initAngle = hangAngle;

      this.limbs.set(binding.part, {
        angle: initAngle,
        restAngle,
        holeOffset,
        stringLength,
        tightness,
        slackness: 0,
        tightnessEff,
        slacknessEff: 0,
        minRot: binding.minRot ?? -88,
        maxRot: binding.maxRot ?? 88,
      });
    }
  }

  _nominalStringLength(part, holeOffset) {
    const r = Math.hypot(holeOffset.x, holeOffset.y);
    if (part === "torso") return r * 0.72 + 95;
    if (part === "arm_l" || part === "arm_r") return r * 1.12 + 72;
    return r * 1.18 + 78;
  }

  _restAngles(p) {
    const out = {
      arm_l: 0,
      arm_r: 0,
      leg_l: 0,
      leg_r: 0,
      torso: 0,
    };
    if (p.arm_l?.joints?.shoulder && p.arm_l?.joints?.elbow) {
      const [sx, sy] = p.arm_l.joints.shoulder;
      const [ex, ey] = p.arm_l.joints.elbow;
      out.arm_l = gravityHangDeg(sx, sy, ex, ey, 88);
    }
    if (p.arm_r?.joints?.shoulder && p.arm_r?.joints?.elbow) {
      const [sx, sy] = p.arm_r.joints.shoulder;
      const [ex, ey] = p.arm_r.joints.elbow;
      out.arm_r = gravityHangDeg(sx, sy, ex, ey, 92) + 6;
    }
    if (p.leg_l?.joints?.hip && p.leg_l?.joints?.knee) {
      const [hx, hy] = p.leg_l.joints.hip;
      const [kx, ky] = p.leg_l.joints.knee;
      out.leg_l = gravityHangDeg(hx, hy, kx, ky, 90);
    }
    if (p.leg_r?.joints?.hip && p.leg_r?.joints?.knee) {
      const [hx, hy] = p.leg_r.joints.hip;
      const [kx, ky] = p.leg_r.joints.knee;
      out.leg_r = gravityHangDeg(hx, hy, kx, ky, 90);
    }
    return out;
  }

  _maxFingerMotion() {
    let max = 0;
    for (const fd of this._fingerAssembly.values()) {
      max = Math.max(max, fd.movePx ?? 0);
    }
    return max;
  }

  _isSettling(now = performance.now()) {
    return now < this._settleUntil;
  }

  _shouldMoveDirect(motion, palmVel, settling) {
    if (settling) return false;
    return palmVel > 180 || motion > BURST_MOVE_PX;
  }

  /** 运动响应参数渐变，避免 default↔active↔burst 硬切 */
  _blendMotionResponse(target, dt) {
    if (!this._blendedResponse) {
      this._blendedResponse = { ...target };
      return this._blendedResponse;
    }
    const out = this._blendedResponse;
    for (const key of Object.keys(target)) {
      const rate = LIMB_RESPONSE_BLEND_KEYS.has(key) ? 34 : 18;
      const k = 1 - Math.exp(-rate * Math.max(0, dt));
      out[key] = out[key] + (target[key] - out[key]) * k;
    }
    return out;
  }

  /** @param {string} partName */
  _jointGain(partName, palmVel, maxMovePx) {
    const burst = palmVel > 180 || maxMovePx > BURST_MOVE_PX;
    const table = burst ? JOINT_SENSITIVITY_BURST : JOINT_SENSITIVITY;
    return table[partName] ?? { speed: 1, maxDelta: 1 };
  }

  _displayStage(bindingId) {
    return (
      this._displayFingers.get(bindingId) ??
      this._fingerAssembly.get(bindingId)?.fingerStage ??
      null
    );
  }

  /** 由舞台指尖/中指坐标算装配 IK 目标（与 display 无关） */
  _fingerAsmFromStages(fingerStage, middleStage, layout, headBinding) {
    const drop = headBinding ? headStringDropPx(layout, headBinding) : 0;
    return {
      x: layout.ax + (fingerStage.x - middleStage.x) / layout.scale,
      y: layout.ay + (fingerStage.y - middleStage.y - drop) / layout.scale,
    };
  }

  _snapshotLimbIkFromTargets(layout, headBinding) {
    const middle = this._displayStage(LINE_HEAD_ID);
    if (!middle || !headBinding) return;
    this._lockedLimbIkAsm.clear();
    for (const binding of this.bindings) {
      if (binding.id === LINE_HEAD_ID) continue;
      const fdStage = this._displayStage(binding.id);
      if (!fdStage) continue;
      this._lockedLimbIkAsm.set(
        binding.id,
        this._fingerAsmFromStages(fdStage, middle, layout, headBinding)
      );
    }
  }

  _updateTranslateSettle(now, palmMove, since, layout) {
    const headBinding = this.bindings.find((b) => b.id === LINE_HEAD_ID);
    const dtSec = Math.max(0.001, since / 1000);
    const palmVel = palmMove / dtSec;
    this._smoothPalmVel = smoothExp(this._smoothPalmVel, palmVel, 7, dtSec);

    if (this._smoothPalmVel > TRANSLATE_VEL_ENTER) {
      this._settleUntil = 0;
      this._translating = true;
      return;
    }

    if (this._translating && this._smoothPalmVel < TRANSLATE_VEL_EXIT) {
      this._translating = false;
      this._settleUntil = now + SETTLE_HOLD_MS;
      this._snapshotLimbIkFromTargets(layout, headBinding);
    }
  }

  /** 移动越快响应越快；settle 时锁 IK、统一 display 收敛 */
  _motionResponse(maxMovePx, settling = false, palmVel = 0) {
    if (settling) {
      return {
        rootSpeed: 14,
        torsoSpeed: 8,
        limbSpeed: 10,
        limbChildSpeed: 14,
        fingerSpeed: 22,
        limbFingerSpeed: 22,
        torsoMaxDelta: 10,
        limbMaxDelta: 14,
        limbChildMaxDelta: 18,
        reachBoost: 0,
        slackScale: 1,
        chainContinuity: 0.22,
        chainSearchDeg: 28,
        chainChildContinuity: 0.45,
      };
    }
    const burst =
      palmVel > 220 || maxMovePx > BURST_MOVE_PX;
    const active =
      palmVel > 55 || maxMovePx > ACTIVE_MOVE_PX;
    if (burst) {
      return {
        rootSpeed: 30,
        torsoSpeed: 24,
        limbSpeed: 42,
        limbChildSpeed: 68,
        fingerSpeed: 42,
        limbFingerSpeed: 42,
        torsoMaxDelta: 38,
        limbMaxDelta: 88,
        limbChildMaxDelta: 140,
        reachBoost: 0.48,
        slackScale: 0.3,
        chainContinuity: 0.06,
        chainSearchDeg: 52,
        chainChildContinuity: 0.1,
      };
    }
    if (active) {
      return {
        rootSpeed: 16,
        torsoSpeed: 14,
        limbSpeed: 26,
        limbChildSpeed: 38,
        fingerSpeed: 24,
        limbFingerSpeed: 24,
        torsoMaxDelta: 22,
        limbMaxDelta: 46,
        limbChildMaxDelta: 74,
        reachBoost: 0.3,
        slackScale: 0.55,
        chainContinuity: 0.14,
        chainSearchDeg: 38,
        chainChildContinuity: 0.2,
      };
    }
    return {
      rootSpeed: 10,
      torsoSpeed: 10,
      limbSpeed: 20,
      limbChildSpeed: 30,
      fingerSpeed: 18,
      limbFingerSpeed: 20,
      torsoMaxDelta: 14,
      limbMaxDelta: 28,
      limbChildMaxDelta: 44,
      reachBoost: 0.12,
      slackScale: 0.2,
      chainContinuity: 0.2,
      chainSearchDeg: 30,
      chainChildContinuity: 0.28,
    };
  }

  /** 检测帧目标 → 显示帧插值（唯一空间平滑层） */
  _tickDisplayFingers(dt, response, moveDirect = false) {
    for (const binding of this.bindings) {
      const target = this._fingerAssembly.get(binding.id);
      if (!target) continue;
      const tgt = target.fingerStage;
      let next;
      if (moveDirect) {
        next = { x: tgt.x, y: tgt.y };
      } else {
        const prev = this._displayFingers.get(binding.id) ?? tgt;
        const speed =
          binding.id === LINE_HEAD_ID
            ? response.fingerSpeed
            : response.limbFingerSpeed;
        next = smoothPointExp(prev, tgt, speed, dt);
        // 注意：此处不再用 FINGER_NOISE_PX（5px）做 snap-to-target。
        // 原来的 snap 逻辑：只要 |prev-tgt|*(1-k) < 5px，即 |prev-tgt| < 10.6px 时就直接
        // 跳到 tgt，完全绕过 smoothPointExp 的平滑效果——手静止时始终满足此条件，
        // 导致 displayFinger ≡ fingerStage，任何噪声原样传入 IK，造成剧烈抖动。
        // 改为 0.5px（亚像素）门限：仅在浮点收敛的最后阶段 snap，平滑全程有效。
        if (Math.hypot(next.x - tgt.x, next.y - tgt.y) < 0.5) {
          next = { x: tgt.x, y: tgt.y };
        }
      }
      this._displayFingers.set(binding.id, next);
    }
  }

  _getSolveFinger(bindingId) {
    const target = this._fingerAssembly.get(bindingId);
    if (!target) return null;
    if (this._moveDirect) return target;
    const display = this._displayFingers.get(bindingId);
    if (!display) return target;
    return { ...target, fingerStage: display };
  }

  _displayFingerNodes() {
    const nodes = [];
    for (const binding of this.bindings) {
      const display = this._displayFingers.get(binding.id);
      const target = this._fingerAssembly.get(binding.id);
      if (!display || !target) continue;
      nodes.push({
        x: display.x,
        y: display.y,
        finger: binding.finger,
        hand: "left",
      });
    }
    return nodes.length ? nodes : this.lastFingerNodes;
  }

  /**
   * 四肢 IK 用手局部坐标（相对中指），平移整手不改变装配目标。
   * 避免 root 与指尖双滤波造成的虚假相对位移。
   */
  _fingerAsmForIk(layout, bindingId, headBinding) {
    if (
      bindingId !== LINE_HEAD_ID &&
      this._isSettling() &&
      this._lockedLimbIkAsm.has(bindingId)
    ) {
      return this._lockedLimbIkAsm.get(bindingId);
    }

    const midStage = this._displayStage(LINE_HEAD_ID);
    const fdStage = this._displayStage(bindingId);
    if (midStage && fdStage && bindingId !== LINE_HEAD_ID) {
      return this._fingerAsmFromStages(fdStage, midStage, layout, headBinding);
    }

    if (fdStage) {
      return layout.stageToAssembly(fdStage, this.root.x, this.root.y);
    }
    return { x: layout.ax, y: layout.ay };
  }

  _syncRootToRig(rig) {
    rig.setRootTransform(this.root.x, this.root.y, 0);
  }

  _findHandIndex(userHand, handedness) {
    const want = userHand === "left" ? "Right" : "Left";
    for (let i = 0; i < handedness.length; i++) {
      const label =
        handedness[i]?.[0]?.categoryName ?? handedness[i]?.categoryName ?? "";
      if (label === want) return i;
    }
    return userHand === "left" ? 0 : handedness.length > 1 ? 1 : -1;
  }

  collectFingerNodes(result, stageRect) {
    const nodes = [];
    const handedness = result.handedness ?? [];
    const landmarks = result.landmarks ?? [];
    const controlIdx = this._findHandIndex("left", handedness);
    if (controlIdx < 0 || !landmarks[controlIdx]) return nodes;

    const handLm = landmarks[controlIdx];
    const activeFingers = new Set(this.bindings.map((b) => b.finger));
    for (let ti = 0; ti < TIP_INDICES.length; ti++) {
      const fingerName = TIP_NAMES[ti];
      if (!activeFingers.has(fingerName)) continue;
      const tip = handLm[TIP_INDICES[ti]];
      if (!tip) continue;
      const pt = landmarkToStage(stageRect, tip, this.mirrorX, FINGER_ZONE);
      nodes.push({ x: pt.x, y: pt.y, finger: fingerName, hand: "left" });
    }
    return nodes;
  }

  collectHandSkeleton(result, stageRect) {
    const handedness = result.handedness ?? [];
    const landmarks = result.landmarks ?? [];
    const controlIdx = this._findHandIndex("left", handedness);
    if (controlIdx < 0 || !landmarks[controlIdx]) {
      return { landmarks: [], connections: HAND_CONNECTIONS };
    }
    return this._buildStableHandSkeleton(landmarks[controlIdx], stageRect);
  }

  /** 21 点骨架：检测帧 deadzone，避免静止时指节结点抖动 */
  _buildStableHandSkeleton(handLm, stageRect) {
    const out = [];
    for (let i = 0; i < handLm.length; i++) {
      const lm = handLm[i];
      if (!lm) continue;
      const raw = landmarkToStage(stageRect, lm, this.mirrorX, FINGER_ZONE);
      const prev = this._skeletonStage.get(i);
      const threshold = TIP_INDICES.includes(i)
        ? FINGER_NOISE_PX
        : SKELETON_JOINT_NOISE_PX;
      const stable = stabilizeStagePoint(prev, raw, threshold);
      this._skeletonStage.set(i, stable);
      out.push({
        index: i,
        x: stable.x,
        y: stable.y,
        isTip: TIP_INDICES.includes(i),
      });
    }
    return { landmarks: out, connections: HAND_CONNECTIONS };
  }

  /**
   * 仅在 fresh 检测帧调用：写入原始目标坐标与运动状态，不做空间平滑。
   */
  updateFromHand(result, layout) {
    layout.refresh(true);
    const stageRect = layout.stageRect;
    const fingerNodes = this.collectFingerNodes(result, stageRect);
    this.hasAnyFinger = fingerNodes.length > 0;
    this.physicsActive = this.hasAnyFinger;

    const handedness = result.handedness ?? [];
    const landmarks = result.landmarks ?? [];
    this._fingerAssembly.clear();

    let maxFingerMove = 0;
    let palmMove = 0;
    const now = performance.now();
    const detectDt = this._lastDetectAt
      ? Math.max(0.012, (now - this._lastDetectAt) / 1000)
      : 1 / 24;
    this._lastDetectAt = now;

    const controlIdx = this._findHandIndex("left", handedness);
    let handLm = null;
    let midLm = null;
    let headStageRaw = null;

    if (controlIdx >= 0 && landmarks[controlIdx]) {
      handLm = landmarks[controlIdx];
      midLm = handLm[12] ?? handLm[9] ?? null;

      const palm = this._palmLandmark(handLm);
      const palmLm = palm ?? handLm[9] ?? handLm[0];
      if (palmLm) {
        const palmStage = landmarkToStage(
          stageRect,
          palmLm,
          this.mirrorX,
          FINGER_ZONE
        );
        if (this._prevPalmStage) {
          palmMove = Math.hypot(
            palmStage.x - this._prevPalmStage.x,
            palmStage.y - this._prevPalmStage.y
          );
        }
        this._prevPalmStage = { x: palmStage.x, y: palmStage.y };
        this._palmStage = { x: palmStage.x, y: palmStage.y };
      }

      if (midLm) {
        const prevRawMid = this._prevRawMiddleMp;
        if (prevRawMid) {
          const midMoveMp = Math.hypot(
            midLm.x - prevRawMid.x,
            midLm.y - prevRawMid.y
          );
          maxFingerMove = Math.max(
            maxFingerMove,
            mpMoveToStagePx(midMoveMp, stageRect)
          );
        }
        this._prevRawMiddleMp = { x: midLm.x, y: midLm.y };
        headStageRaw = landmarkToStage(
          stageRect,
          midLm,
          this.mirrorX,
          FINGER_ZONE
        );
        headStageRaw = stabilizeStagePoint(
          this._prevTargetStage.get(LINE_HEAD_ID),
          headStageRaw,
          FINGER_NOISE_PX
        );
      }
    } else {
      this._palmStage = null;
    }

    if (handLm && midLm && headStageRaw) {
      for (const binding of this.bindings) {
        const hi = this._findHandIndex(binding.hand, handedness);
        if (hi < 0 || !landmarks[hi]) continue;

        const tipIdx = FINGERTIPS[binding.finger] ?? 8;
        const tipLm = handLm[tipIdx];
        if (!tipLm) continue;

        let rawStage;
        if (binding.id === LINE_HEAD_ID) {
          rawStage = { x: headStageRaw.x, y: headStageRaw.y };
        } else {
          const rawRelMp = {
            x: tipLm.x - midLm.x,
            y: tipLm.y - midLm.y,
          };
          const prevRawRel = this._prevRawRelMp.get(binding.id);
          if (prevRawRel) {
            const localMoveMp = Math.hypot(
              rawRelMp.x - prevRawRel.x,
              rawRelMp.y - prevRawRel.y
            );
            maxFingerMove = Math.max(
              maxFingerMove,
              mpMoveToStagePx(localMoveMp, stageRect)
            );
          }
          this._prevRawRelMp.set(binding.id, {
            x: rawRelMp.x,
            y: rawRelMp.y,
          });
          const offset = mpDeltaToStage(
            rawRelMp.x,
            rawRelMp.y,
            stageRect,
            this.mirrorX
          );
          rawStage = {
            x: headStageRaw.x + offset.x,
            y: headStageRaw.y + offset.y,
          };
        }

        const prevTarget = this._prevTargetStage.get(binding.id);
        const rawMovePx = prevTarget
          ? Math.hypot(rawStage.x - prevTarget.x, rawStage.y - prevTarget.y)
          : 0;
        const fingerStage = stabilizeStagePoint(
          prevTarget,
          rawStage,
          FINGER_NOISE_PX
        );
        const movePx =
          rawMovePx <= FINGER_NOISE_PX && prevTarget ? 0 : rawMovePx;
        this._prevTargetStage.set(binding.id, {
          x: fingerStage.x,
          y: fingerStage.y,
        });
        this._fingerAssembly.set(binding.id, { fingerStage, movePx });

        if (!this._displayFingers.has(binding.id)) {
          this._displayFingers.set(binding.id, {
            x: fingerStage.x,
            y: fingerStage.y,
          });
        }
      }
    }

    const moved =
      maxFingerMove > STILL_MOVE_PX || palmMove > STILL_MOVE_PX;

    this._updateTranslateSettle(now, palmMove, detectDt * 1000, layout);

    if (this.handStill) {
      if (maxFingerMove > ACTIVE_MOVE_PX || palmMove > ACTIVE_MOVE_PX) {
        this.handStill = false;
        this._stillMs = 0;
      }
    } else if (moved) {
      this._stillMs = 0;
    } else if (this.hasAnyFinger) {
      this._stillMs += detectDt * 1000;
      this.handStill = this._stillMs >= STILL_HOLD_MS;
    }

    if (this.handStill) {
      const justEnteredStill = !this._wasHandStill;
      for (const [id, fd] of this._fingerAssembly.entries()) {
        fd.movePx = 0;
        if (justEnteredStill) {
          // 仅在第一次进入静止状态时锁定一次，之后不再覆写。
          // 持续覆写会把 fingerStage 的噪声跳变直接传入 IK，造成抖动。
          this._displayFingers.set(id, {
            x: fd.fingerStage.x,
            y: fd.fingerStage.y,
          });
        }
      }
    }
    this._wasHandStill = this.handStill;

    if (this.hasAnyFinger) {
      this.lastFingerNodes = fingerNodes;
      this.lastHandSkeleton = this.collectHandSkeleton(result, stageRect);
    } else {
      this._resetHandTracking();
    }
  }

  _resetHandTracking() {
    this._prevTargetStage.clear();
    this._prevRawRelMp.clear();
    this._prevRawMiddleMp = null;
    this._prevPalmStage = null;
    this._palmStage = null;
    this._displayFingers.clear();
    this._skeletonStage.clear();
    this._smoothPalmVel = 0;
    this._translating = false;
    this._settleUntil = 0;
    this._lockedLimbIkAsm.clear();
    this._lastDetectAt = 0;
    this._blendedResponse = null;
    this._moveDirect = false;
    this._stillMs = 0;
    this.handStill = false;
    this._wasHandStill = false;
  }

  _palmLandmark(handLm) {
    const wrist = handLm[0];
    const mid = handLm[9];
    if (!wrist || !mid) return wrist ?? mid ?? null;
    return {
      x: wrist.x * 0.35 + mid.x * 0.65,
      y: wrist.y * 0.35 + mid.y * 0.65,
    };
  }

  /**
   * rootAnchor 在头孔：挂载层中心 + rootExtra = 头孔；勿读 0×0 wrapper（会反馈抖动）。
   * @param {number} dropStagePx 中指→头孔，舞台像素（见 stringLengthStage）
   */
  _placeRootFromFinger(
    layout,
    fingerStage,
    dropStagePx,
    rootSpeed,
    dt,
    direct = false
  ) {
    const targetX = fingerStage.x - layout.mountCx;
    const targetY = fingerStage.y + dropStagePx - layout.mountCy;
    if (direct) {
      this.root.x = targetX;
      this.root.y = targetY;
    } else {
      this.root.x = smoothExp(this.root.x, targetX, rootSpeed, dt);
      this.root.y = smoothExp(this.root.y, targetY, rootSpeed, dt);
    }
  }

  _torsoHangAngle(torsoLimb) {
    return solveGravityHangAngle(
      torsoLimb.holeOffset,
      torsoLimb.minRot,
      torsoLimb.maxRot
    );
  }

  /**
   * 轻量躯干倾斜：汇总四肢提线对肩/髋的扭矩，不再做网格搜索。
   * 上一版 _solveTorsoAndLimbs 每帧约 45×4 次链式求解，导致主线程卡死。
   */
  _computeTorsoPullTarget(rig, layout, torsoLimb, torsoPart, headBinding) {
    const head = torsoPart?.joints?.head;
    if (!head) return this._torsoHangAngle(torsoLimb);

    const saved = { ...rig.displayRotations };
    rig.displayRotations.torso = torsoLimb.angle;
    let torque = 0;

    for (const binding of this.bindings) {
      if (binding.id === LINE_HEAD_ID) continue;
      const fingerData = this._getSolveFinger(binding.id);
      if (!fingerData) continue;
      const limb = this.limbs.get(binding.part);
      if (!limb) continue;

      const fingerAsm = this._fingerAsmForIk(layout, binding.id, headBinding);
      const mountKey = CHAIN_TORSO_MOUNT[binding.part];
      if (!mountKey) continue;
      const mount = rig.getJointAssemblyByKey("torso", mountKey);
      if (!mount) continue;

      const stringLen = bindingStringLengthAsm(layout, binding, limb);
      const dx = fingerAsm.x - mount.x;
      const dy = fingerAsm.y - mount.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.001) continue;

      const over = Math.max(0, dist - stringLen - 0.8);
      const pullMag =
        over > 0
          ? over * 1.55
          : Math.max(0, stringLen - dist) * 0.5;
      const pullX = (dx / dist) * pullMag;
      const pullY = (dy / dist) * pullMag;

      const rx = mount.x - head[0];
      const ry = mount.y - head[1];
      torque += rx * pullY - ry * pullX;
    }

    Object.assign(rig.displayRotations, saved);

    const hang = this._torsoHangAngle(torsoLimb);
    const torqueGain = this._translating
      ? TORSO_TORQUE_GAIN_MOVE
      : TORSO_TORQUE_GAIN;
    const pullDeg = clamp(torque * torqueGain, -42, 42);
    return clamp(
      hang * TORSO_GRAVITY_BIAS + pullDeg,
      TORSO_SOLVE_MIN,
      TORSO_SOLVE_MAX
    );
  }

  _solveLimbBindings(rig, layout, bonesOut, dt, response, headBinding) {
    /** @type {Record<string, number>} */
    const targets = {};

    for (const binding of this.bindings) {
      if (binding.id === LINE_HEAD_ID) continue;
      const limb = this.limbs.get(binding.part);
      const fingerData = this._getSolveFinger(binding.id);
      if (!limb || !fingerData) continue;

      const fingerAsm = this._fingerAsmForIk(layout, binding.id, headBinding);
      const parentName = CHAIN_PARENT[binding.part];
      const parentLimb = parentName ? this.limbs.get(parentName) : null;

      if (parentName && parentLimb) {
        const { parent, child } = this._solveChainBinding(
          rig,
          layout,
          binding,
          fingerAsm,
          parentName,
          parentLimb,
          limb,
          response
        );
        targets[parentName] = parent;
        targets[binding.part] = child;
        continue;
      }

      const pivotKey =
        binding.rotateJoint ?? rig.parts[binding.part]?.rotateJoint;
      const pivot = rig.getJointAssemblyByKey(binding.part, pivotKey);
      if (!pivot) continue;

      const direct = angleFromHoleWorld(pivot, limb.holeOffset, fingerAsm);
      targets[binding.part] = clamp(direct, limb.minRot, limb.maxRot);
    }

    this._applyLimbSolveTargets(bonesOut, response, dt, targets);
  }

  /** 舞台竖直方向：髋在头下方；优先接近上一帧角度，避免来回翻 */
  _solveTorsoHangStage(layout, torsoPart, limb, binding) {
    const head = torsoPart.joints?.head;
    const hangKey = binding.hangJoint ?? "root";
    const mass = torsoPart.joints?.[hangKey];
    if (!head || !mass) {
      return solveGravityHangAngle(limb.holeOffset, limb.minRot, limb.maxRot);
    }
    const pivot = { x: head[0], y: head[1] };
    const off = { x: mass[0] - head[0], y: mass[1] - head[1] };
    const rootX = this.root.x;
    const rootY = this.root.y;
    let best = limb.angle;
    let bestY = -Infinity;
    const yEps = 0.35;
    for (let a = limb.minRot; a <= limb.maxRot; a += 0.5) {
      const asm = holeAt(pivot, off, a);
      const st = layout.assemblyToStage(asm, rootX, rootY);
      if (st.y > bestY + yEps) {
        bestY = st.y;
        best = a;
      } else if (Math.abs(st.y - bestY) <= yEps) {
        if (Math.abs(shortestAngleDelta(a, limb.angle)) <
            Math.abs(shortestAngleDelta(best, limb.angle))) {
          best = a;
        }
      }
    }
    return clamp(best, limb.minRot, limb.maxRot);
  }

  _applyLimbSolveTargets(bonesOut, response, dt, targets) {
    const maxMove = this._maxFingerMotion();
    for (const [name, target] of Object.entries(targets)) {
      const limb = this.limbs.get(name);
      if (!limb) continue;
      const isChild = CHAIN_CHILD_PARTS.has(name);
      if (this._moveDirect && (isChild || JOINT_SENSITIVITY[name])) {
        limb.angle = target;
        bonesOut[name] = limb.angle;
        continue;
      }
      const speed = isChild
        ? (response.limbChildSpeed ?? response.limbSpeed * 1.45)
        : response.limbSpeed;
      const maxDelta = isChild
        ? (response.limbChildMaxDelta ?? response.limbMaxDelta * 1.35)
        : response.limbMaxDelta;
      const jointGain = this._jointGain(name, this._smoothPalmVel, maxMove);
      const effSpeed = speed * jointGain.speed;
      const effMaxDelta = maxDelta * jointGain.maxDelta;
      limb.angle = smoothAngleExp(
        limb.angle,
        target,
        effSpeed,
        dt,
        effMaxDelta
      );
      bonesOut[name] = limb.angle;
    }
  }

  step(dt, rig, layout) {
    const bonesOut = {};
    const headBinding = this.bindings.find((b) => b.id === LINE_HEAD_ID);
    const headFinger = this._fingerAssembly.get(LINE_HEAD_ID);
    const torsoLimb = this.limbs.get("torso");
    const torsoPart = rig.parts?.torso;

    if (headFinger && torsoLimb && torsoPart && headBinding && this.physicsActive) {
      const motion = this._maxFingerMotion();
      const settling = this._isSettling();
      const moveDirect = this._shouldMoveDirect(
        motion,
        this._smoothPalmVel,
        settling
      );
      this._moveDirect = moveDirect;
      const response = this._blendMotionResponse(
        this._motionResponse(motion, settling, this._smoothPalmVel),
        dt
      );

      this._tickDisplayFingers(dt, response, moveDirect);

      const headStage =
        this._displayFingers.get(LINE_HEAD_ID) ?? headFinger.fingerStage;
      if (headStage) {
        this._placeRootFromFinger(
          layout,
          headStage,
          headStringDropPx(layout, headBinding),
          response.rootSpeed,
          dt,
          moveDirect
        );
      }

      this._syncRootToRig(rig);
      layout.refresh(true);

      const torsoTarget = this._computeTorsoPullTarget(
        rig,
        layout,
        torsoLimb,
        torsoPart,
        headBinding
      );

      torsoLimb.angle = smoothAngleExp(
        torsoLimb.angle,
        torsoTarget,
        response.torsoSpeed,
        dt,
        response.torsoMaxDelta
      );
      bonesOut.torso = torsoLimb.angle;
      rig.displayRotations.torso = torsoLimb.angle;

      this._solveLimbBindings(
        rig,
        layout,
        bonesOut,
        dt,
        response,
        headBinding
      );
    } else {
      this._moveDirect = false;
      for (const binding of this.bindings) {
        if (binding.id === LINE_HEAD_ID) continue;
        const limb = this.limbs.get(binding.part);
        if (!limb) continue;
        const parentName = CHAIN_PARENT[binding.part];
        const parentLimb = parentName ? this.limbs.get(parentName) : null;
        bonesOut[binding.part] = limb.angle;
        if (parentName && parentLimb) {
          bonesOut[parentName] = parentLimb.angle;
        }

        if (parentName && parentLimb) {
          const hangP = solveGravityHangAngle(
            parentLimb.holeOffset,
            parentLimb.minRot,
            parentLimb.maxRot
          );
          const idleP =
            Math.abs(parentLimb.restAngle) > 0.5
              ? parentLimb.restAngle
              : hangP;
          parentLimb.angle = smoothAngle(parentLimb.angle, idleP, 0.32, 36);
          bonesOut[parentName] = parentLimb.angle;
        }
        const hang = solveGravityHangAngle(
          limb.holeOffset,
          limb.minRot,
          limb.maxRot
        );
        const idleTarget =
          Math.abs(limb.restAngle) > 0.5 ? limb.restAngle : hang;
        limb.angle = smoothAngle(limb.angle, idleTarget, 0.32, 36);
        bonesOut[binding.part] = limb.angle;
      }

      if (torsoLimb && torsoPart) {
        const hang = this._solveTorsoHangStage(
          layout,
          torsoPart,
          torsoLimb,
          headBinding ?? { hangJoint: "root" }
        );
        torsoLimb.angle = smoothAngle(torsoLimb.angle, hang, 0.32, 18);
        bonesOut.torso = torsoLimb.angle;
        rig.displayRotations.torso = torsoLimb.angle;
      }
    }

    this._applyGravityChain(rig, layout, bonesOut, this.physicsActive);

    rig.syncDisplayRotations(bonesOut);

    const debugSingleLine = this.bindings.length === 1;
    const fingerNodes = this.physicsActive
      ? this._displayFingerNodes()
      : this.lastFingerNodes;
    return {
      hasHand: this.physicsActive,
      root: { x: this.root.x, y: this.root.y, rotation: 0 },
      bones: bonesOut,
      strings: this.lastStrings,
      fingerNodes,
      handSkeleton: debugSingleLine
        ? { landmarks: [], connections: [] }
        : this.lastHandSkeleton,
    };
  }

  /**
   * 在 rig.update 之后调用：提线终点对齐 DOM 上的真实孔位
   * @param {import('./puppetRig.js').PuppetRig} rig
   * @param {import('./layoutCache.js').LayoutCache} layout
   */
  buildStringsFromDom(rig, layout) {
    layout.refresh(true);
    const stageRect = layout.stageRect;
    const strings = [];

    for (const binding of this.bindings) {
      const fingerData = this._getSolveFinger(binding.id);
      if (!fingerData) continue;

      let jointStage = rig.getJointStage(
        binding.part,
        binding.joint,
        stageRect
      );
      if (!jointStage) continue;

      strings.push({
        id: binding.id,
        finger: binding.finger,
        tipIndex: FINGERTIPS[binding.finger] ?? 8,
        fingerPt: fingerData.fingerStage,
        joint: jointStage,
        label: binding.label,
        slack: 0,
      });
    }

    if (strings.length) this.lastStrings = strings;
    return strings;
  }

  /**
   * 提线端点与骨架指尖共用一个坐标（以 display 插值后的提线点为准）
   * @param {{ landmarks: Array, connections: Array, handLabel?: string }} skeleton
   * @param {Array<{ finger?: string, tipIndex?: number, fingerPt: { x: number, y: number } }>} strings
   */
  syncHandSkeletonWithStrings(skeleton, strings) {
    if (!skeleton?.landmarks?.length || !strings?.length) return skeleton;
    const byIndex = new Map(
      skeleton.landmarks.map((lm) => [lm.index, { ...lm }])
    );
    for (const s of strings) {
      if (s.tipIndex == null || !s.fingerPt) continue;
      const lm = byIndex.get(s.tipIndex);
      if (!lm) continue;
      lm.x = s.fingerPt.x;
      lm.y = s.fingerPt.y;
    }
    return {
      ...skeleton,
      landmarks: [...byIndex.values()].sort((a, b) => a.index - b.index),
    };
  }

  getInitialPose() {
    const bones = {};
    for (const [name, limb] of this.limbs) bones[name] = limb.angle;
    return {
      hasHand: false,
      root: { ...this.root, rotation: 0 },
      bones,
      strings: [],
      fingerNodes: [],
      handSkeleton: { landmarks: [], connections: HAND_CONNECTIONS },
    };
  }

  getHoldPose() {
    const bones = {};
    for (const [name, limb] of this.limbs) bones[name] = limb.angle;
    return {
      hasHand: false,
      root: { ...this.root, rotation: 0 },
      bones,
      strings: [...this.lastStrings],
      fingerNodes: [...this.lastFingerNodes],
      handSkeleton: {
        landmarks: [...(this.lastHandSkeleton?.landmarks ?? [])],
        connections: HAND_CONNECTIONS,
      },
    };
  }
}
