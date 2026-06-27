/** 石板晃手 → 震碎：连贯地动山摇 / 天崩地裂音效（Web Audio procedural + 破碎采样） */

import { SHAKE_AUDIO_START_PX } from "./shakeDetect.js";

const SHAKE_INTENSITY_REF = 280;
const SHATTER_RUMBLE_S = 0.62;
const IMPACT_AUDIO_URL = "assets/audio/stone-shatter-impact.mp3";
const WUKONG_VOICE_URL = "assets/audio/sun-wukong-arrival.mp3";
/** 石板碎裂（impact）后多久播放孙悟空语音（秒） */
const WUKONG_VOICE_DELAY_S = 0.5;

function _makeBrownNoiseBuffer(ctx, seconds = 3) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.022 * white) / 1.022;
    out[i] = last * 5.4;
  }
  return buf;
}

function _makeCrackNoiseBuffer(ctx, seconds = 0.12) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t);
  }
  return buf;
}

export class StoneShatterAudio {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {'idle' | 'shake' | 'shatter'} */
    this._phase = "idle";
    this._rumbleGain = null;
    this._crackleGain = null;
    this._tremoloGain = null;
    this._tremoloLfo = null;
    this._impactPlayed = false;
    this._nodesStarted = false;
    /** @type {number} */
    this._smoothedDrive = 0;
    /** @type {number} */
    this._preImpactCracks = 0;
    /** @type {AudioBuffer | null} */
    this._impactBuffer = null;
    /** @type {Promise<AudioBuffer | null> | null} */
    this._impactLoadPromise = null;
    /** @type {AudioBufferSourceNode | null} */
    this._impactSource = null;
    /** @type {AudioBuffer | null} */
    this._wukongBuffer = null;
    /** @type {Promise<AudioBuffer | null> | null} */
    this._wukongLoadPromise = null;
    /** @type {AudioBufferSourceNode | null} */
    this._wukongSource = null;
    /** @type {number | null} */
    this._wukongScheduleTimer = null;
    this._wukongScheduled = false;
  }

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.58;
      this.master.connect(this.ctx.destination);
      this._initLayers();
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    void this._loadImpactBuffer();
    void this._loadWukongBuffer();
  }

  async _loadWukongBuffer() {
    if (this._wukongBuffer) return this._wukongBuffer;
    if (!this.ctx) return null;
    if (!this._wukongLoadPromise) {
      this._wukongLoadPromise = fetch(WUKONG_VOICE_URL)
        .then((res) => {
          if (!res.ok) throw new Error(`wukong voice HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((raw) => this.ctx.decodeAudioData(raw))
        .then((decoded) => {
          this._wukongBuffer = decoded;
          return decoded;
        })
        .catch((err) => {
          console.warn("[StoneShatterAudio] 孙悟空语音加载失败", err);
          return null;
        });
    }
    return this._wukongLoadPromise;
  }

  async _loadImpactBuffer() {
    if (this._impactBuffer) return this._impactBuffer;
    if (!this.ctx) return null;
    if (!this._impactLoadPromise) {
      this._impactLoadPromise = fetch(IMPACT_AUDIO_URL)
        .then((res) => {
          if (!res.ok) throw new Error(`impact audio HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((raw) => this.ctx.decodeAudioData(raw))
        .then((decoded) => {
          this._impactBuffer = decoded;
          return decoded;
        })
        .catch((err) => {
          console.warn("[StoneShatterAudio] 破碎音效加载失败", err);
          return null;
        });
    }
    return this._impactLoadPromise;
  }

  _initLayers() {
    const ctx = this.ctx;
    if (!ctx || !this.master || this._nodesStarted) return;

    const brown = ctx.createBufferSource();
    brown.buffer = _makeBrownNoiseBuffer(ctx, 4);
    brown.loop = true;

    const brownFilter = ctx.createBiquadFilter();
    brownFilter.type = "lowpass";
    brownFilter.frequency.value = 92;
    brownFilter.Q.value = 0.85;

    this._rumbleGain = ctx.createGain();
    this._rumbleGain.gain.value = 0.001;

    this._shakeTremolo = ctx.createGain();
    this._shakeTremolo.gain.value = 1;

    brown.connect(brownFilter);
    brownFilter.connect(this._rumbleGain);
    this._rumbleGain.connect(this._shakeTremolo);
    this._shakeTremolo.connect(this.master);

    const subA = ctx.createOscillator();
    subA.type = "sine";
    subA.frequency.value = 28;
    const subB = ctx.createOscillator();
    subB.type = "sine";
    subB.frequency.value = 46;
    const subC = ctx.createOscillator();
    subC.type = "sine";
    subC.frequency.value = 72;
    const subMix = ctx.createGain();
    subMix.gain.value = 0.78;
    subA.connect(subMix);
    subB.connect(subMix);
    subC.connect(subMix);
    subMix.connect(this._rumbleGain);

    this._tremoloLfo = ctx.createOscillator();
    this._tremoloLfo.type = "sine";
    this._tremoloLfo.frequency.value = 6.2;
    const tremoloOffset = ctx.createConstantSource();
    tremoloOffset.offset.value = 1;
    tremoloOffset.connect(this._shakeTremolo.gain);
    this._tremoloGain = ctx.createGain();
    this._tremoloGain.gain.value = 0.18;
    this._tremoloLfo.connect(this._tremoloGain);
    this._tremoloGain.connect(this._shakeTremolo.gain);

    const crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = _makeBrownNoiseBuffer(ctx, 2);
    crackleSrc.loop = true;
    const crackleBp = ctx.createBiquadFilter();
    crackleBp.type = "bandpass";
    crackleBp.frequency.value = 780;
    crackleBp.Q.value = 0.62;
    this._crackleGain = ctx.createGain();
    this._crackleGain.gain.value = 0.001;
    crackleSrc.connect(crackleBp);
    crackleBp.connect(this._crackleGain);
    this._crackleGain.connect(this.master);

    const now = ctx.currentTime;
    brown.start(now);
    crackleSrc.start(now);
    subA.start(now);
    subB.start(now);
    subC.start(now);
    this._tremoloLfo.start(now);
    tremoloOffset.start(now);
    this._nodesStarted = true;
  }

  /** 检测到左手开始晃动时启动（非进入提示阶段即播） */
  beginShakePrompt() {
    if (!this.ctx || !this._rumbleGain) return;
    this._phase = "shake";
    this._impactPlayed = false;
    this._preImpactCracks = 0;
    this._smoothedDrive = 0;
    const now = this.ctx.currentTime;
    this._rumbleGain.gain.cancelScheduledValues(now);
    this._rumbleGain.gain.setValueAtTime(0.001, now);
    this._rumbleGain.gain.linearRampToValueAtTime(0.06, now + 0.14);
    if (this._crackleGain) {
      this._crackleGain.gain.cancelScheduledValues(now);
      this._crackleGain.gain.setValueAtTime(0.001, now);
      this._crackleGain.gain.linearRampToValueAtTime(0.01, now + 0.22);
    }
    if (this._tremoloLfo) {
      this._tremoloLfo.frequency.cancelScheduledValues(now);
      this._tremoloLfo.frequency.setValueAtTime(6.2, now);
    }
  }

  /**
   * @param {number} intensity shakeDetector.lastIntensity
   * @param {number} sustain 0..1
   * @param {number} dt
   */
  updateShakePrompt(intensity, sustain, dt) {
    if (this._phase !== "shake" || !this.ctx || !this._rumbleGain) return;

    const shaking =
      intensity >= SHAKE_AUDIO_START_PX || sustain > 0.015;
    const targetDrive = shaking
      ? 0.06 +
        sustain * 0.34 +
        Math.min(intensity / SHAKE_INTENSITY_REF, 1.5) * 0.32
      : 0;
    const k = shaking ? 1 - Math.exp(-dt * 7.5) : 1 - Math.exp(-dt * 4.2);
    this._smoothedDrive += (targetDrive - this._smoothedDrive) * k;

    const now = this.ctx.currentTime;
    this._rumbleGain.gain.cancelScheduledValues(now);
    this._rumbleGain.gain.setValueAtTime(this._rumbleGain.gain.value, now);
    this._rumbleGain.gain.linearRampToValueAtTime(
      Math.min(0.52, this._smoothedDrive),
      now + 0.08
    );
    if (this._crackleGain) {
      const crack = shaking
        ? 0.01 + sustain * 0.045 + Math.min(intensity / 420, 1) * 0.055
        : Math.max(0.001, this._crackleGain.gain.value - dt * 0.04);
      this._crackleGain.gain.linearRampToValueAtTime(crack, now + 0.1);
    }
    if (this._tremoloGain) {
      const trem = shaking ? 0.14 + sustain * 0.26 : 0.06;
      this._tremoloGain.gain.linearRampToValueAtTime(trem, now + 0.08);
    }
  }

  /** 石板碎裂瞬间调用：延迟 0.5s 播放「俺老孙来也」 */
  scheduleWukongVoice() {
    if (this._wukongScheduled) return;
    this._wukongScheduled = true;
    void this._loadWukongBuffer();
    if (this._wukongScheduleTimer != null) {
      window.clearTimeout(this._wukongScheduleTimer);
    }
    this._wukongScheduleTimer = window.setTimeout(() => {
      this._wukongScheduleTimer = null;
      this._playWukongVoice();
    }, WUKONG_VOICE_DELAY_S * 1000);
  }

  _playWukongVoice() {
    if (!this.ctx || !this.master) return;

    const start = (buf) => {
      if (!this.ctx || !this.master || !buf) return;
      this._stopWukongSource();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.95;
      src.connect(gain);
      gain.connect(this.master);
      src.start();
      this._wukongSource = src;
    };

    if (this._wukongBuffer) {
      start(this._wukongBuffer);
      return;
    }
    void this._loadWukongBuffer().then((buf) => start(buf));
  }

  _stopWukongSource() {
    if (!this._wukongSource) return;
    try {
      this._wukongSource.stop();
    } catch {
      /* already stopped */
    }
    this._wukongSource = null;
  }

  _clearWukongSchedule() {
    if (this._wukongScheduleTimer != null) {
      window.clearTimeout(this._wukongScheduleTimer);
      this._wukongScheduleTimer = null;
    }
    this._wukongScheduled = false;
  }

  /** 晃手触发震碎：rumble 无缝抬升并在 impact 时爆发 */
  beginShatter() {
    if (!this.ctx || !this._rumbleGain) return;
    void this._loadImpactBuffer();
    void this._loadWukongBuffer();
    this._phase = "shatter";
    this._impactPlayed = false;
    this._preImpactCracks = 0;
    const now = this.ctx.currentTime;
    this._rumbleGain.gain.cancelScheduledValues(now);
    this._rumbleGain.gain.setValueAtTime(
      Math.max(0.1, this._rumbleGain.gain.value),
      now
    );
    this._rumbleGain.gain.linearRampToValueAtTime(0.98, now + SHATTER_RUMBLE_S);
    if (this._crackleGain) {
      this._crackleGain.gain.cancelScheduledValues(now);
      this._crackleGain.gain.setValueAtTime(this._crackleGain.gain.value, now);
      this._crackleGain.gain.linearRampToValueAtTime(0.14, now + SHATTER_RUMBLE_S * 0.9);
    }
    if (this._tremoloGain) {
      this._tremoloGain.gain.linearRampToValueAtTime(0.48, now + 0.12);
    }
    if (this._tremoloLfo) {
      this._tremoloLfo.frequency.linearRampToValueAtTime(11, now + SHATTER_RUMBLE_S);
    }
  }

  /**
   * @param {number} t ShatterEffect 已播放时间（秒）
   * @param {number} dt
   */
  updateShatter(t, dt) {
    if (this._phase !== "shatter" || !this.ctx || !this._rumbleGain) return;

    if (t < SHATTER_RUMBLE_S && !this._impactPlayed) {
      const p = t / SHATTER_RUMBLE_S;
      const now = this.ctx.currentTime;
      if (this._tremoloGain) {
        this._tremoloGain.gain.linearRampToValueAtTime(0.28 + p * 0.38, now + 0.04);
      }
      const crackStage = Math.floor(p * 4);
      if (crackStage > this._preImpactCracks) {
        this._preImpactCracks = crackStage;
        this._playPreImpactCrack(crackStage);
      }
    }

    if (!this._impactPlayed && t >= SHATTER_RUMBLE_S) {
      this._playImpact();
      this._impactPlayed = true;
    }

    if (t >= SHATTER_RUMBLE_S) {
      const tail = Math.max(0, 1 - (t - SHATTER_RUMBLE_S) / 1.6);
      const now = this.ctx.currentTime;
      const rumble = 0.2 + tail * 0.38;
      this._rumbleGain.gain.cancelScheduledValues(now);
      this._rumbleGain.gain.setValueAtTime(this._rumbleGain.gain.value, now);
      this._rumbleGain.gain.linearRampToValueAtTime(rumble * tail + 0.03, now + 0.1);
      if (this._crackleGain) {
        this._crackleGain.gain.linearRampToValueAtTime(0.02 + tail * 0.06, now + 0.1);
      }
      if (this._tremoloGain) {
        this._tremoloGain.gain.linearRampToValueAtTime(0.1 * tail, now + 0.1);
      }
    }

    void dt;
  }

  _playPreImpactCrack(stage) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const vol = 0.12 + stage * 0.08;

    const src = ctx.createBufferSource();
    src.buffer = _makeCrackNoiseBuffer(ctx, 0.06 + stage * 0.02);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 400 + stage * 280;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(now);
    src.stop(now + 0.14);
  }

  _playImpact() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;

    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.88, now + 0.012);
    master.gain.exponentialRampToValueAtTime(0.58, now + 1.6);

    if (this._impactBuffer) {
      this._playImpactSample(now);
      this._playImpactRumbleTail(now);
      return;
    }

    void this._loadImpactBuffer().then((buf) => {
      if (!buf) {
        this._playProceduralImpact(now);
        this._playImpactRumbleTail(now);
        return;
      }
      if (this._impactPlayed) {
        this._playImpactSample(ctx.currentTime);
        this._playImpactRumbleTail(ctx.currentTime);
      }
    });
  }

  /** @param {number} at */
  _playImpactSample(at) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this._impactBuffer) return;

    if (this._impactSource) {
      try {
        this._impactSource.stop();
      } catch {
        /* already stopped */
      }
      this._impactSource = null;
    }

    const src = ctx.createBufferSource();
    src.buffer = this._impactBuffer;

    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf";
    shelf.frequency.value = 160;
    shelf.gain.value = 3.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, at);
    gain.gain.linearRampToValueAtTime(1.18, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, at + this._impactBuffer.duration + 0.15);

    src.connect(shelf);
    shelf.connect(gain);
    gain.connect(master);
    src.start(at);
    src.stop(at + this._impactBuffer.duration + 0.2);
    this._impactSource = src;
  }

  /** 与采样同步的 rumble 抬升，强化震感 */
  _playImpactRumbleTail(at) {
    if (this._rumbleGain) {
      this._rumbleGain.gain.cancelScheduledValues(at);
      this._rumbleGain.gain.setValueAtTime(this._rumbleGain.gain.value, at);
      this._rumbleGain.gain.linearRampToValueAtTime(1.05, at + 0.02);
      this._rumbleGain.gain.exponentialRampToValueAtTime(0.2, at + 1.2);
    }
    if (this._crackleGain) {
      this._crackleGain.gain.cancelScheduledValues(at);
      this._crackleGain.gain.setValueAtTime(this._crackleGain.gain.value, at);
      this._crackleGain.gain.linearRampToValueAtTime(0.18, at + 0.02);
      this._crackleGain.gain.exponentialRampToValueAtTime(0.006, at + 1.0);
    }
    if (this._tremoloLfo) {
      this._tremoloLfo.frequency.setValueAtTime(13, at);
      this._tremoloLfo.frequency.exponentialRampToValueAtTime(4, at + 0.75);
    }
    if (this._tremoloGain) {
      this._tremoloGain.gain.setValueAtTime(0.42, at);
      this._tremoloGain.gain.exponentialRampToValueAtTime(0.001, at + 0.85);
    }
  }

  /** 采样未加载时的合成备用 */
  _playProceduralImpact(now) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const boom = ctx.createOscillator();
    boom.type = "sine";
    boom.frequency.setValueAtTime(92, now);
    boom.frequency.exponentialRampToValueAtTime(18, now + 0.75);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0.001, now);
    boomGain.gain.linearRampToValueAtTime(1.25, now + 0.012);
    boomGain.gain.exponentialRampToValueAtTime(0.001, now + 1.35);
    boom.connect(boomGain);
    boomGain.connect(master);
    boom.start(now);
    boom.stop(now + 1.4);

    const boom2 = ctx.createOscillator();
    boom2.type = "triangle";
    boom2.frequency.setValueAtTime(180, now);
    boom2.frequency.exponentialRampToValueAtTime(32, now + 0.45);
    const boom2Gain = ctx.createGain();
    boom2Gain.gain.setValueAtTime(0.001, now);
    boom2Gain.gain.linearRampToValueAtTime(0.52, now + 0.01);
    boom2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
    boom2.connect(boom2Gain);
    boom2Gain.connect(master);
    boom2.start(now);
    boom2.stop(now + 0.8);

    const subQuake = ctx.createOscillator();
    subQuake.type = "sine";
    subQuake.frequency.setValueAtTime(34, now);
    subQuake.frequency.exponentialRampToValueAtTime(12, now + 1.1);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.linearRampToValueAtTime(0.88, now + 0.02);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
    subQuake.connect(subGain);
    subGain.connect(master);
    subQuake.start(now);
    subQuake.stop(now + 1.55);

    for (let wave = 0; wave < 3; wave++) {
      const t0 = now + wave * 0.07;
      const afterBoom = ctx.createOscillator();
      afterBoom.type = "sine";
      afterBoom.frequency.setValueAtTime(58 - wave * 8, t0);
      afterBoom.frequency.exponentialRampToValueAtTime(22, t0 + 0.38);
      const ag = ctx.createGain();
      ag.gain.setValueAtTime(0.001, t0);
      ag.gain.linearRampToValueAtTime(0.55 - wave * 0.1, t0 + 0.008);
      ag.gain.exponentialRampToValueAtTime(0.001, t0 + 0.55);
      afterBoom.connect(ag);
      ag.connect(master);
      afterBoom.start(t0);
      afterBoom.stop(t0 + 0.6);
    }

    for (let i = 0; i < 14; i++) {
      const t0 = now + i * 0.022 + Math.random() * 0.025;
      const src = ctx.createBufferSource();
      src.buffer = _makeCrackNoiseBuffer(ctx, 0.07 + Math.random() * 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 480 + Math.random() * 2800;
      bp.Q.value = 0.75 + Math.random() * 0.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, t0);
      g.gain.linearRampToValueAtTime(0.28 + Math.random() * 0.22, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
      src.connect(bp);
      bp.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + 0.18);
    }

    const slam = ctx.createBufferSource();
    slam.buffer = _makeCrackNoiseBuffer(ctx, 0.38);
    const slamBp = ctx.createBiquadFilter();
    slamBp.type = "lowpass";
    slamBp.frequency.setValueAtTime(3200, now);
    slamBp.frequency.exponentialRampToValueAtTime(120, now + 0.55);
    const slamGain = ctx.createGain();
    slamGain.gain.setValueAtTime(0.001, now);
    slamGain.gain.linearRampToValueAtTime(0.82, now + 0.006);
    slamGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);
    slam.connect(slamBp);
    slamBp.connect(slamGain);
    slamGain.connect(master);
    slam.start(now);
    slam.stop(now + 0.65);

    const debris = ctx.createBufferSource();
    debris.buffer = _makeBrownNoiseBuffer(ctx, 0.5);
    const debrisBp = ctx.createBiquadFilter();
    debrisBp.type = "bandpass";
    debrisBp.frequency.value = 220;
    debrisBp.Q.value = 0.45;
    const debrisGain = ctx.createGain();
    debrisGain.gain.setValueAtTime(0.001, now + 0.04);
    debrisGain.gain.linearRampToValueAtTime(0.38, now + 0.06);
    debrisGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
    debris.connect(debrisBp);
    debrisBp.connect(debrisGain);
    debrisGain.connect(master);
    debris.start(now + 0.04);
    debris.stop(now + 1);

    if (this._rumbleGain) {
      this._rumbleGain.gain.cancelScheduledValues(now);
      this._rumbleGain.gain.setValueAtTime(this._rumbleGain.gain.value, now);
      this._rumbleGain.gain.linearRampToValueAtTime(1.12, now + 0.018);
      this._rumbleGain.gain.exponentialRampToValueAtTime(0.22, now + 1.15);
    }
    if (this._crackleGain) {
      this._crackleGain.gain.cancelScheduledValues(now);
      this._crackleGain.gain.setValueAtTime(this._crackleGain.gain.value, now);
      this._crackleGain.gain.linearRampToValueAtTime(0.24, now + 0.015);
      this._crackleGain.gain.exponentialRampToValueAtTime(0.006, now + 1.05);
    }
    if (this._tremoloLfo) {
      this._tremoloLfo.frequency.setValueAtTime(14, now);
      this._tremoloLfo.frequency.exponentialRampToValueAtTime(4, now + 0.8);
    }
    if (this._tremoloGain) {
      this._tremoloGain.gain.setValueAtTime(0.55, now);
      this._tremoloGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    }
  }

  stop() {
    this._clearWukongSchedule();
    this._stopWukongSource();
    if (this._impactSource) {
      try {
        this._impactSource.stop();
      } catch {
        /* already stopped */
      }
      this._impactSource = null;
    }
    if (!this.ctx || !this._rumbleGain) {
      this._phase = "idle";
      return;
    }
    const now = this.ctx.currentTime;
    this._rumbleGain.gain.cancelScheduledValues(now);
    this._rumbleGain.gain.setValueAtTime(this._rumbleGain.gain.value, now);
    this._rumbleGain.gain.linearRampToValueAtTime(0.001, now + 0.45);
    if (this._crackleGain) {
      this._crackleGain.gain.linearRampToValueAtTime(0.001, now + 0.4);
    }
    if (this._tremoloGain) {
      this._tremoloGain.gain.linearRampToValueAtTime(0.001, now + 0.35);
    }
    if (this.master) {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(0.58, now + 0.5);
    }
    this._phase = "idle";
    this._impactPlayed = false;
    this._preImpactCracks = 0;
    this._smoothedDrive = 0;
  }
}
