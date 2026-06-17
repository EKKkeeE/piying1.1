/**
 * 将摄像头手势坐标映射到皮影背景场景（非摄像头画面）内。
 */

/**
 * @param {DOMRect} stageRect
 * @param {{ x: number, y: number }} lm MediaPipe 归一化坐标
 * @param {boolean} mirrorX
 * @param {{ xMin?: number, xMax?: number, yMin?: number, yMax?: number }} [zone]
 */
export function landmarkToStage(stageRect, lm, mirrorX = true, zone = {}) {
  const xMin = zone.xMin ?? 0.08;
  const xMax = zone.xMax ?? 0.92;
  const yMin = zone.yMin ?? 0.05;
  const yMax = zone.yMax ?? 0.72;

  let nx = mirrorX ? 1 - lm.x : lm.x;
  nx = xMin + nx * (xMax - xMin);
  const ny = yMin + lm.y * (yMax - yMin);

  return {
    x: nx * stageRect.width,
    y: ny * stageRect.height,
  };
}

/**
 * @param {DOMRect} stageRect
 * @param {{ x: number, y: number }} stageLocal
 */
export function stageToClient(stageRect, stageLocal) {
  return {
    x: stageRect.left + stageLocal.x,
    y: stageRect.top + stageLocal.y,
  };
}

/**
 * @param {DOMRect} stageRect
 * @param {{ x: number, y: number }} client
 */
export function clientToStage(stageRect, client) {
  return {
    x: client.x - stageRect.left,
    y: client.y - stageRect.top,
  };
}
