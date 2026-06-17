/** 手部检测：低分辨率画布 + 与主循环对齐的 60fps 推理 */

export const DETECT_WIDTH = 320;
export const DETECT_HEIGHT = 240;
export const TARGET_DETECT_FPS = 60;
/** @deprecated 与 TARGET_DETECT_FPS 相同，保留兼容 import */
export const DEFAULT_DETECT_FPS = TARGET_DETECT_FPS;
/** @deprecated 与 TARGET_DETECT_FPS 相同，保留兼容 import */
export const GPU_DETECT_FPS = TARGET_DETECT_FPS;

/**
 * @param {HTMLVideoElement} video
 * @param {{ detectFps?: number }} [opts]
 */
export function createHandDetector(video, opts = {}) {
  const detectFps = opts.detectFps ?? DEFAULT_DETECT_FPS;
  const detectIntervalMs = 1000 / detectFps;

  const canvas = document.createElement("canvas");
  canvas.width = DETECT_WIDTH;
  canvas.height = DETECT_HEIGHT;
  const ctx = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
    willReadFrequently: false,
  });

  let lastDetectAt = 0;
  /** @type {import('@mediapipe/tasks-vision').HandLandmarkerResult | null} */
  let cachedResult = null;

  return {
    canvas,
    detectFps,
    getCached: () => cachedResult,
    /**
     * @param {import('@mediapipe/tasks-vision').HandLandmarker} landmarker
     * @param {number} now
     */
    tick(landmarker, now) {
      if (now - lastDetectAt < detectIntervalMs) {
        return cachedResult ? { result: cachedResult, fresh: false } : null;
      }
      if (video.readyState < 2 || !video.videoWidth) {
        return cachedResult ? { result: cachedResult, fresh: false } : null;
      }

      lastDetectAt = now;
      ctx.drawImage(video, 0, 0, DETECT_WIDTH, DETECT_HEIGHT);
      cachedResult = landmarker.detectForVideo(canvas, now);
      return { result: cachedResult, fresh: true };
    },
    reset() {
      cachedResult = null;
      lastDetectAt = 0;
    },
  };
}
