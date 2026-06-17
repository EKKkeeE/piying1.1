/** 大招释放时的全屏金光闪烁特效 */
export class UltimateFlash {
  /**
   * @param {HTMLElement | null} el
   */
  constructor(el) {
    this.el = el;
    this._timer = 0;
  }

  /**
   * @param {{ x: number, y: number }} center 舞台内坐标
   * @param {DOMRect} stageRect
   */
  play(center, stageRect) {
    if (!this.el || !stageRect.width) return;

    clearTimeout(this._timer);

    const xPct = (center.x / stageRect.width) * 100;
    const yPct = (center.y / stageRect.height) * 100;
    this.el.style.setProperty("--flash-x", `${xPct}%`);
    this.el.style.setProperty("--flash-y", `${yPct}%`);

    this.el.classList.remove("ultimate-flash-active");
    void this.el.offsetWidth;
    this.el.classList.add("ultimate-flash-active");

    this._timer = setTimeout(() => {
      this.el?.classList.remove("ultimate-flash-active");
    }, 1050);
  }
}
