/** 挑战成功演出音效：opening + 逐字鼓点采样 + 鼓声结束后 BGM */

const OPENING_URL = "assets/audio/opening.mp3";
const DRUM_URL = "assets/audio/rescue-drum.mp3";
const BGM_URL = "assets/audio/bgm.mp3";
/** 最后一鼓播完后等待多久再播 BGM（秒） */
const BGM_AFTER_DRUMS_S = 1;
const DRUM_FALLBACK_DURATION_S = 1.2;

/** 四字鼓点音量递进 */
const DRUM_VOLUMES = [1.0, 1.08, 1.16, 1.28];

export class RescueSuccessAudio {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {AudioBuffer | null} */
    this._openingBuffer = null;
    /** @type {Promise<AudioBuffer | null> | null} */
    this._openingLoadPromise = null;
    /** @type {AudioBuffer | null} */
    this._drumBuffer = null;
    /** @type {Promise<AudioBuffer | null> | null} */
    this._drumLoadPromise = null;
    /** @type {AudioBufferSourceNode | null} */
    this._openingSource = null;
    /** @type {HTMLAudioElement | null} */
    this._bgm = null;
    /** @type {number | null} */
    this._bgmFadeTimer = null;
    /** @type {number | null} */
    this._bgmScheduleTimer = null;
    this._openingStarted = false;
    this._bgmStarted = false;
    this._bgmScheduled = false;
  }

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.88;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
    void this._loadOpening();
    void this._loadDrum();
    if (!this._bgm) {
      this._bgm = new Audio(BGM_URL);
      this._bgm.loop = true;
      this._bgm.preload = "auto";
    }
  }

  async _loadOpening() {
    if (this._openingBuffer) return this._openingBuffer;
    if (!this.ctx) return null;
    if (!this._openingLoadPromise) {
      this._openingLoadPromise = this._fetchAudio(OPENING_URL).then((decoded) => {
        this._openingBuffer = decoded;
        return decoded;
      });
    }
    return this._openingLoadPromise;
  }

  async _loadDrum() {
    if (this._drumBuffer) return this._drumBuffer;
    if (!this.ctx) return null;
    if (!this._drumLoadPromise) {
      this._drumLoadPromise = this._fetchAudio(DRUM_URL).then((decoded) => {
        this._drumBuffer = decoded;
        return decoded;
      });
    }
    return this._drumLoadPromise;
  }

  /** @param {string} url */
  async _fetchAudio(url) {
    if (!this.ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
      const raw = await res.arrayBuffer();
      return await this.ctx.decodeAudioData(raw);
    } catch (err) {
      console.warn("[RescueSuccessAudio] 音频加载失败", url, err);
      return null;
    }
  }

  /** 第一字弹出时播放 opening */
  playOpening() {
    if (this._openingStarted) return;
    this._openingStarted = true;
    if (!this.ctx || !this.master) return;

    const start = (buf) => {
      if (!this.ctx || !this.master || !buf) return;
      this._stopOpeningSource();
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.92;
      src.connect(gain);
      gain.connect(this.master);
      src.start();
      this._openingSource = src;
    };

    if (this._openingBuffer) {
      start(this._openingBuffer);
      return;
    }
    void this._loadOpening().then((buf) => start(buf));
  }

  /**
   * 逐字鼓点
   * @param {number} index 0..3
   */
  playDrum(index) {
    if (!this.ctx || !this.master) return;
    const vol = DRUM_VOLUMES[index] ?? DRUM_VOLUMES[0];

    const start = (buf) => {
      if (!this.ctx || !this.master || !buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.004);
      src.connect(gain);
      gain.connect(this.master);
      src.start();
      if (index === 3) {
        this._scheduleBgmAfterLastDrum(buf.duration);
      }
    };

    if (this._drumBuffer) {
      start(this._drumBuffer);
      return;
    }
    void this._loadDrum().then((buf) => {
      if (buf) {
        start(buf);
      } else if (index === 3) {
        this._scheduleBgmAfterLastDrum(DRUM_FALLBACK_DURATION_S);
      }
    });
  }

  /** @param {number} drumDurationSec */
  _scheduleBgmAfterLastDrum(drumDurationSec) {
    if (this._bgmScheduled) return;
    this._bgmScheduled = true;
    if (this._bgmScheduleTimer != null) {
      window.clearTimeout(this._bgmScheduleTimer);
    }
    const delayMs = (drumDurationSec + BGM_AFTER_DRUMS_S) * 1000;
    this._bgmScheduleTimer = window.setTimeout(() => {
      this._bgmScheduleTimer = null;
      this.playBgm();
    }, delayMs);
  }

  /** 最后一鼓结束 + 等待后立刻播放 BGM */
  playBgm() {
    if (this._bgmStarted) return;
    this._bgmStarted = true;
    this._fadeOutOpening(0.25);
    if (!this._bgm) {
      this._bgm = new Audio(BGM_URL);
      this._bgm.loop = true;
      this._bgm.preload = "auto";
    }
    if (this._bgmFadeTimer != null) {
      window.clearInterval(this._bgmFadeTimer);
      this._bgmFadeTimer = null;
    }
    this._bgm.volume = 0.58;
    const playPromise = this._bgm.play();
    if (playPromise) {
      void playPromise.catch((err) => {
        console.warn("[RescueSuccessAudio] BGM 播放失败", err);
      });
    }
  }

  /** @param {number} sec */
  _fadeOutOpening(sec) {
    if (!this.ctx || !this._openingSource) return;
    const src = this._openingSource;
    const now = this.ctx.currentTime;
    try {
      src.stop(now + sec);
    } catch {
      /* already stopped */
    }
    this._openingSource = null;
  }

  _stopOpeningSource() {
    if (!this._openingSource) return;
    try {
      this._openingSource.stop();
    } catch {
      /* already stopped */
    }
    this._openingSource = null;
  }

  stop() {
    this._stopOpeningSource();
    this._openingStarted = false;
    this._bgmStarted = false;
    this._bgmScheduled = false;
    if (this._bgmScheduleTimer != null) {
      window.clearTimeout(this._bgmScheduleTimer);
      this._bgmScheduleTimer = null;
    }
    if (this._bgmFadeTimer != null) {
      window.clearInterval(this._bgmFadeTimer);
      this._bgmFadeTimer = null;
    }
    if (this._bgm) {
      this._bgm.pause();
      this._bgm.currentTime = 0;
      this._bgm.volume = 0;
    }
  }
}
