/** 开场延时后循环播放，整场演出背景音乐。 */
export class BgmPlayer {
  constructor(src = "assets/audio/bgm.mp3") {
    this.audio = new Audio(src);
    this.audio.loop = true;
    this.audio.preload = "auto";
    /** @type {number} */
    this.delayTimer = 0;
    this.playing = false;
  }

  /** @param {number} delayMs 相对调用时刻的延时（默认开场后 3 秒） */
  scheduleStart(delayMs = 3000) {
    this.cancelSchedule();
    this.delayTimer = window.setTimeout(() => this.start(), delayMs);
  }

  cancelSchedule() {
    if (this.delayTimer) {
      clearTimeout(this.delayTimer);
      this.delayTimer = 0;
    }
  }

  start() {
    if (this.playing) return;
    this.playing = true;
    this.audio.currentTime = 0;
    this.audio.play().catch(() => {});
  }

  stop() {
    this.cancelSchedule();
    if (!this.playing) return;
    this.playing = false;
    this.audio.pause();
    this.audio.currentTime = 0;
  }
}
