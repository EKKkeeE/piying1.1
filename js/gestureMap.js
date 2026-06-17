import {
  angleBetween,
  clamp,
  gravityHangDeg,
  smoothPoint,
} from "./utils.js";

/** MediaPipe hand landmark indices */
export const LM = {
  WRIST: 0,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
};

/**
 * Maps left-hand landmarks to puppet pose targets.
 */
export class GestureMapper {
  constructor() {
    this.mirrorX = true;
    this.hasHand = false;
    this.lostFrames = 0;
    this.maxLostFrames = 18;
    this.smoothWrist = { x: 0.5, y: 0.55 };
    this.smoothRot = 0;
    this.prevWrist = { x: 0.5, y: 0.55 };
    this.velocityX = 0;
    this.idlePhase = 0;
    /** @type {{ hasHand: boolean, root: object, bones: Record<string, number> } | null} */
    this.lastHoldPose = null;
    /** @type {Record<string, number>} */
    this.gravityPose = {
      arm_l: -28,
      arm_r: 38,
      leg_l: 42,
      leg_r: 41,
    };
  }

  /**
   * @param {object} rigData
   */
  setGravityFromRig(rigData) {
    const p = rigData?.parts;
    if (!p) return;

    if (p.arm_l?.joints?.shoulder && p.arm_l?.joints?.elbow) {
      const [sx, sy] = p.arm_l.joints.shoulder;
      const [ex, ey] = p.arm_l.joints.elbow;
      this.gravityPose.arm_l = gravityHangDeg(sx, sy, ex, ey, 88);
    }
    if (p.arm_r?.joints?.shoulder && p.arm_r?.joints?.elbow) {
      const [sx, sy] = p.arm_r.joints.shoulder;
      const [ex, ey] = p.arm_r.joints.elbow;
      this.gravityPose.arm_r = gravityHangDeg(sx, sy, ex, ey, 92) + 6;
    }
    if (p.leg_l?.joints?.hip && p.leg_l?.joints?.knee) {
      const [hx, hy] = p.leg_l.joints.hip;
      const [kx, ky] = p.leg_l.joints.knee;
      this.gravityPose.leg_l = gravityHangDeg(hx, hy, kx, ky, 90);
    }
    if (p.leg_r?.joints?.hip && p.leg_r?.joints?.knee) {
      const [hx, hy] = p.leg_r.joints.hip;
      const [kx, ky] = p.leg_r.joints.knee;
      this.gravityPose.leg_r = gravityHangDeg(hx, hy, kx, ky, 90);
    }

    if (rigData.idlePose) {
      Object.assign(this.gravityPose, rigData.idlePose);
    }
  }

  /**
   * @param {{ hasHand: boolean, root: object, bones: Record<string, number> }} pose
   */
  _rememberPose(pose) {
    this.lastHoldPose = {
      hasHand: true,
      root: { ...pose.root },
      bones: { ...pose.bones },
    };
  }

  /**
   * @param {Array<{ x: number, y: number }>} landmarks
   * @param {{ width: number, height: number }} stageSize
   */
  mapLeftHand(landmarks, stageSize) {
    if (!landmarks || landmarks.length < 13) {
      this.lostFrames += 1;
      if (this.lostFrames > this.maxLostFrames) this.hasHand = false;
      return this.getHoldPose();
    }

    this.lostFrames = 0;
    this.hasHand = true;

    const wrist = landmarks[LM.WRIST];
    const indexMcp = landmarks[LM.INDEX_MCP];
    const indexTip = landmarks[LM.INDEX_TIP];
    const middleMcp = landmarks[LM.MIDDLE_MCP];

    let nx = wrist.x;
    let ny = wrist.y;
    if (this.mirrorX) nx = 1 - nx;

    const stageMinX = 0.12;
    const stageMaxX = 0.88;
    const stageMinY = 0.38;
    const stageMaxY = 0.82;

    const targetNx = clamp((nx - stageMinX) / (stageMaxX - stageMinX), 0, 1);
    const targetNy = clamp((ny - stageMinY) / (stageMaxY - stageMinY), 0, 1);

    this.smoothWrist = smoothPoint(this.smoothWrist, { x: targetNx, y: targetNy }, 0.22);
    this.velocityX = (this.smoothWrist.x - this.prevWrist.x) * 60;
    this.prevWrist = { ...this.smoothWrist };

    const rootX = (this.smoothWrist.x - 0.5) * stageSize.width * 0.95;
    const rootY = (this.smoothWrist.y - 0.5) * stageSize.height * 0.55 + 40;

    const palmAngle = angleBetween(
      { x: middleMcp.x, y: middleMcp.y },
      { x: wrist.x, y: wrist.y },
    );

    let rootRot = clamp((palmAngle - 90) * 0.35, -28, 28);
    if (this.mirrorX) rootRot = -rootRot;
    this.smoothRot += (rootRot - this.smoothRot) * 0.2;

    const armSwing = clamp((wrist.y - 0.45) * 80, -35, 35);
    const staffSwing = clamp((wrist.x - 0.5) * -90, -40, 40);
    const legSwing = clamp(this.velocityX * 100, -10, 10);

    const pose = {
      hasHand: true,
      root: { x: rootX, y: rootY, rotation: this.smoothRot },
      bones: {
        torso: this.smoothRot * 0.2,
        arm_l: armSwing * 0.6,
        arm_r: staffSwing,
        leg_l: legSwing,
        leg_r: -legSwing,
      },
    };

    this._rememberPose(pose);
    return pose;
  }

  /** 首次启动、尚未识别过手时的默认下垂站姿 */
  getInitialPose() {
    const g = this.gravityPose;
    return {
      hasHand: false,
      root: { x: 0, y: 0, rotation: 0 },
      bones: {
        torso: 0,
        arm_l: g.arm_l,
        arm_r: g.arm_r,
        leg_l: g.leg_l,
        leg_r: g.leg_r,
      },
    };
  }

  /**
   * 无手时保持最后一次识别到的姿态，不回到屏幕中心。
   */
  getHoldPose() {
    if (this.lastHoldPose) {
      return {
        hasHand: false,
        root: { ...this.lastHoldPose.root },
        bones: { ...this.lastHoldPose.bones },
      };
    }
    return this.getInitialPose();
  }

  processHandResult(result, stageSize) {
    if (!result.landmarks?.length) {
      return this.mapLeftHand(null, stageSize);
    }

    let leftIdx = 0;
    if (result.handedness?.length) {
      for (let i = 0; i < result.handedness.length; i++) {
        const label = result.handedness[i]?.[0]?.categoryName ?? "";
        if (label === "Right") {
          leftIdx = i;
          break;
        }
      }
    }

    return this.mapLeftHand(result.landmarks[leftIdx], stageSize);
  }
}
