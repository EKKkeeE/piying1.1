import { landmarkToStage, BINDING_ZONE } from "./stageCoords.js";
import { ShakeDetector } from "./shakeDetect.js";
import { BindingSfx } from "./bindingSfx.js";

const TIP_BY_FINGER = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  pinky: 20,
};

const FINGER_ORDER = ["middle", "index", "ring", "pinky", "thumb"];

/** @type {Array<{ id: string, finger: string, tipIndex: number, parts: string[], label: string }>} */
export const BINDING_SEQUENCE = [
  {
    id: "line_head",
    finger: "middle",
    tipIndex: 12,
    parts: ["torso"],
    label: "头部",
  },
  {
    id: "line_wrist_r",
    finger: "index",
    tipIndex: 8,
    parts: ["lower_arm_r", "upper_arm_r"],
    label: "金箍棒",
  },
  {
    id: "line_wrist_l",
    finger: "ring",
    tipIndex: 16,
    parts: ["lower_arm_l", "upper_arm_l"],
    label: "左手",
  },
  {
    id: "line_leg_l",
    finger: "pinky",
    tipIndex: 20,
    parts: ["shin_l", "thigh_l"],
    label: "左脚",
  },
  {
    id: "line_leg_r",
    finger: "thumb",
    tipIndex: 4,
    parts: ["shin_r", "thigh_r"],
    label: "右脚",
  },
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

const HOLD_MS = 500;
const BIND_MS = 520;

function findLeftHandIndex(handedness, landmarks) {
  for (let i = 0; i < handedness.length; i++) {
    const label =
      handedness[i]?.[0]?.categoryName ?? handedness[i]?.categoryName ?? "";
    if (label === "Right") return i;
  }
  return landmarks?.length ? 0 : -1;
}

export class BindingPhase {
  /**
   * @param {{
   *   getGrooveBounds: (w: number, h: number) => object,
   *   getGrooveAnchors: (w: number, h: number) => Record<string, {x:number,y:number}>,
   *   onRestoreParts: (parts: string[]) => void,
   *   onRevertParts: (parts: string[]) => void,
   *   onShatterStart: () => void
   * }} opts
   */
  constructor(opts) {
    this.getGrooveBounds = opts.getGrooveBounds;
    this.getGrooveAnchors = opts.getGrooveAnchors;
    this.onRestoreParts = opts.onRestoreParts;
    this.onRevertParts = opts.onRevertParts;
    this.onShatterStart = opts.onShatterStart;
    this.shakeDetector = new ShakeDetector();
    this.sfx = new BindingSfx();
    this.state = "waitHand";
    this.holdMs = 0;
    this.bindIndex = 0;
    this.bindProgress = 0;
    /** @type {Set<string>} */
    this.boundIds = new Set();
    this._fitRadiusPx = 52;
    this._fitInCount = 0;
    this.debugDistances = {};
    this.shatterTriggered = false;
    /** @type {Record<string, {x:number,y:number}> | null} */
    this._lastTips = null;
    /** @type {{ x: number, y: number } | null} */
    this._lastWrist = null;
    /** @type {{ landmarks: Array, connections: Array } | null} */
    this._lastHandSkeleton = null;
  }

  reset() {
    this.state = "waitHand";
    this.holdMs = 0;
    this.bindIndex = 0;
    this.bindProgress = 0;
    this.boundIds.clear();
    this.shakeDetector.reset();
    this.shatterTriggered = false;
    this._lastTips = null;
    this._lastWrist = null;
    this._lastHandSkeleton = null;
    this._fitInCount = 0;
  }

  /**
   * @param {import('@mediapipe/tasks-vision').HandLandmarkerResult | null} result
   * @param {DOMRect} stageRect
   */
  _collectFingertips(result, stageRect) {
    if (!result?.landmarks?.length) return null;
    const landmarks = result.landmarks;
    const idx = findLeftHandIndex(result.handedness ?? [], landmarks);
    if (idx < 0) return null;
    const hand = landmarks[idx];
    const tips = {};
    for (const finger of FINGER_ORDER) {
      const ti = TIP_BY_FINGER[finger];
      const lm = hand[ti];
      if (!lm) continue;
      tips[finger] = landmarkToStage(stageRect, lm, true, BINDING_ZONE);
    }
    return {
      hand,
      tips,
      wrist: landmarkToStage(stageRect, hand[0], true, BINDING_ZONE),
    };
  }

  _buildHandSkeleton(handLm, stageRect) {
    const landmarks = [];
    for (let i = 0; i < handLm.length; i++) {
      const lm = handLm[i];
      if (!lm) continue;
      const pt = landmarkToStage(stageRect, lm, true, BINDING_ZONE);
      landmarks.push({
        index: i,
        x: pt.x,
        y: pt.y,
        isTip: [4, 8, 12, 16, 20].includes(i),
      });
    }
    return { landmarks, connections: HAND_CONNECTIONS };
  }

  /**
   * 判定手是否落入凹槽区域：五指在凹槽包围盒内 + 张开幅度合理
   * （不再依赖与 PNG 指尖锚点的逐点距离，避免美术与锚点偏移导致永远无法绑定）
   */
  _checkFit(tips, wrist, stageRect) {
    const w = stageRect.width;
    const h = stageRect.height;
    const bounds = this.getGrooveBounds(w, h);
    const anchors = this.getGrooveAnchors(w, h);
    const margin = Math.min(bounds.dw, bounds.dh) * 0.14;
    const x0 = bounds.x0 - margin;
    const y0 = bounds.y0 - margin;
    const x1 = bounds.x1 + margin;
    const y1 = bounds.y1 + margin;

    this._fitRadiusPx = margin;
    const distances = {};
    let inCount = 0;

    for (const finger of FINGER_ORDER) {
      const tip = tips[finger];
      const anchor = anchors[finger];
      if (!tip || !anchor) {
        distances[finger] = Infinity;
        continue;
      }
      const inside =
        tip.x >= x0 && tip.x <= x1 && tip.y >= y0 && tip.y <= y1;
      distances[finger] = Math.hypot(tip.x - anchor.x, tip.y - anchor.y);
      if (inside) inCount += 1;
    }

    this._fitInCount = inCount;
    this.debugDistances = distances;

    if (inCount < 5) return false;

    const span = Math.hypot(
      tips.thumb.x - tips.pinky.x,
      tips.thumb.y - tips.pinky.y
    );
    const spreadOk = span > bounds.dw * 0.32 && span < bounds.dw * 1.2;
    if (!spreadOk) return false;

    if (wrist) {
      const wristIn =
        wrist.x >= x0 &&
        wrist.x <= x1 &&
        wrist.y >= y0 - margin &&
        wrist.y <= y1 + margin;
      if (!wristIn) return false;
    }

    return true;
  }

  _buildBindingStrings(rig, stageRect, tips) {
    const strings = [];
    for (let i = 0; i < BINDING_SEQUENCE.length; i++) {
      if (i > this.bindIndex) break;
      const spec = BINDING_SEQUENCE[i];
      const joint = this._resolveJoint(rig, stageRect, spec);
      const fingerPt = tips[spec.finger];
      if (!joint || !fingerPt) continue;
      const grow = i < this.bindIndex ? 1 : Math.min(1, this.bindProgress);
      strings.push({
        id: spec.id,
        finger: spec.finger,
        tipIndex: spec.tipIndex,
        fingerPt,
        joint,
        grow,
        flash: i === this.bindIndex && this.bindProgress < 0.2,
      });
    }
    return strings;
  }

  _resolveJoint(rig, stageRect, spec) {
    const part = spec.parts[0];
    const jointKey =
      spec.id === "line_head" ? "head" : part.includes("arm") ? "wrist" : "ankle";
    return rig.getJointStage(part, jointKey, stageRect);
  }

  /** 仅根据当前帧手部数据判定是否在凹槽内（不用缓存指尖） */
  _isInGroove(handData, stageRect) {
    if (!handData?.tips || Object.keys(handData.tips).length < 5) return false;
    return this._checkFit(handData.tips, handData.wrist, stageRect);
  }

  _getRestoredPartNames() {
    const names = new Set();
    for (const spec of BINDING_SEQUENCE) {
      if (!this.boundIds.has(spec.id)) continue;
      for (const part of spec.parts) names.add(part);
    }
    return [...names];
  }

  /** 手离开凹槽：牵线断裂、已绑定部件回灰、进度清零（仅绑定未完成时） */
  _breakBinding(hasHand) {
    const hadProgress =
      this.boundIds.size > 0 ||
      this.state === "binding" ||
      this.bindProgress > 0.02;
    const parts = this._getRestoredPartNames();
    if (parts.length) {
      this.onRevertParts?.(parts);
    }
    if (hadProgress) {
      this.sfx.playStringBreak();
    }
    this.boundIds.clear();
    this.bindIndex = 0;
    this.bindProgress = 0;
    this.holdMs = 0;
    this.shakeDetector.reset();
    this.state = hasHand ? "aligning" : "waitHand";
    return hadProgress;
  }

  update(dt, handResult, stageRect, rig) {
    const handData = this._collectFingertips(handResult, stageRect);
    if (handData?.tips) this._lastTips = handData.tips;
    if (handData?.wrist) this._lastWrist = handData.wrist;
    const inGroove = this._isInGroove(handData, stageRect);
    const handSkeleton = handData
      ? this._buildHandSkeleton(handData.hand, stageRect)
      : this._lastHandSkeleton ?? { landmarks: [], connections: HAND_CONNECTIONS };
    if (handData) this._lastHandSkeleton = handSkeleton;

    let hintText = "将左手放入凹槽，绑定皮影";
    let glowEdge = false;
    let pulseShake = false;
    let strings = [];

    if (this.state === "shattering") {
      const bindTips = handData?.tips ?? this._lastTips;
      if (bindTips && rig) {
        strings = this._buildAllStrings(rig, stageRect, bindTips);
      }
      return this._packResult({
        state: this.state,
        hintText: "",
        glowEdge: false,
        grooveBreathe: false,
        pulseShake: true,
        strings,
        handSkeleton,
        stageRect,
      });
    }

    if (this.state === "done") {
      return this._packResult({
        state: this.state,
        hintText: "",
        glowEdge: false,
        grooveBreathe: false,
        pulseShake: false,
        strings: [],
        handSkeleton,
        stageRect,
      });
    }

    const mustStayInGroove =
      this.state === "holding" || this.state === "binding";

    if (mustStayInGroove && !inGroove) {
      if (
        this.state === "binding" ||
        this.boundIds.size > 0 ||
        this.bindProgress > 0.02
      ) {
        this._breakBinding(!!handData);
        hintText = handData
          ? "手已离开凹槽，绑定中断，请重新对准"
          : "将左手放入凹槽，绑定皮影";
      } else {
        this.state = handData ? "aligning" : "waitHand";
        this.holdMs = 0;
        hintText = handData
          ? `对准指槽，张开五指（${this._fitInCount}/5）`
          : "将左手放入凹槽，绑定皮影";
      }
    } else if (!handData || Object.keys(handData.tips ?? {}).length < 5) {
      if (
        this.state === "waitHand" ||
        this.state === "aligning" ||
        this.state === "holding"
      ) {
        this.state = "waitHand";
        this.holdMs = 0;
      }
    } else if (
      this.state === "waitHand" ||
      this.state === "aligning" ||
      this.state === "holding"
    ) {
      hintText = `对准指槽，张开五指（${this._fitInCount}/5）`;
      if (!inGroove) {
        this.state = "aligning";
        this.holdMs = 0;
      } else {
        if (this.state !== "holding") {
          this.state = "holding";
          this.holdMs = 0;
        }
        this.holdMs += dt * 1000;
        hintText = "保持不动…";
        if (this.holdMs >= HOLD_MS) {
          this.state = "binding";
          this.bindIndex = 0;
          this.bindProgress = 0;
        }
      }
    }

    if (this.state === "binding" && inGroove && handData?.tips) {
      this.bindProgress += dt / (BIND_MS / 1000);
      const spec = BINDING_SEQUENCE[this.bindIndex];
      hintText = `${spec.label}牵线绑定中…`;

      if (this.bindProgress >= 1) {
        this.boundIds.add(spec.id);
        this.onRestoreParts(spec.parts);
        this.sfx.playBindFlash();
        this.sfx.playDustShake();
        this.bindIndex += 1;
        this.bindProgress = 0;
        if (this.bindIndex >= BINDING_SEQUENCE.length) {
          this.state = "shakePrompt";
          this.shakeDetector.reset();
        }
      }
      strings = this._buildBindingStrings(rig, stageRect, handData.tips);
    }

    if (this.state === "shakePrompt") {
      pulseShake = true;
      glowEdge = true;
      hintText = "剧烈晃动左手，拯救孙悟空！";
      const bindTips = handData?.tips ?? this._lastTips;
      if (bindTips && rig) {
        strings = this._buildAllStrings(rig, stageRect, bindTips);
      }

      if (handData?.tips) {
        const shakePts = [
          handData.wrist,
          ...FINGER_ORDER.map((f) => handData.tips[f]),
        ].filter(Boolean);
        if (this.shakeDetector.feed(shakePts, performance.now())) {
          this.state = "shattering";
          this.shatterTriggered = true;
          this.onShatterStart();
          this.sfx.playShatter();
        }
      }
    }

    const grooveBreathe =
      this.state === "waitHand" || this.state === "aligning";

    return this._packResult({
      state: this.state,
      hintText,
      glowEdge,
      grooveBreathe,
      pulseShake,
      strings,
      handSkeleton,
      stageRect,
    });
  }

  _packResult(partial) {
    return {
      ...partial,
      boundIds: this.boundIds,
      debugDistances: this.debugDistances,
      fitRadius: this._fitRadiusPx,
      fitInCount: this._fitInCount,
      shakeIntensity: this.shakeDetector.lastIntensity,
      shakeSustain: this.shakeDetector.sustainProgress,
      shatterTriggered: this.shatterTriggered,
    };
  }

  _buildAllStrings(rig, stageRect, tips) {
    const strings = [];
    for (const spec of BINDING_SEQUENCE) {
      const joint = this._resolveJoint(rig, stageRect, spec);
      const fingerPt = tips[spec.finger];
      if (!joint || !fingerPt) continue;
      strings.push({
        id: spec.id,
        finger: spec.finger,
        tipIndex: spec.tipIndex,
        fingerPt,
        joint,
        grow: 1,
      });
    }
    return strings;
  }

  markDone() {
    this.state = "done";
  }
}
