// hand_input.js
// Wraps MediaPipe Tasks Vision (HandLandmarker) + webcam access.
// Emits plain {x,y,z} landmark arrays per hand - no browser/three.js
// specifics leak into gestures.js.

import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandInput {
  constructor({ videoElement, maxHands = 2 } = {}) {
    this.video = videoElement;
    this.maxHands = maxHands;
    this.landmarker = null;
    this._lastVideoTime = -1;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: this.maxHands,
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((resolve) => {
      this.video.onloadedmetadata = () => {
        this.video.play();
        resolve();
      };
    });
  }

  /**
   * Call once per animation frame. Returns an array of hands, each an
   * array of 21 {x, y, z} normalized points, in image (mirrored) space.
   * Returns [] if no hands detected or video isn't ready yet.
   */
  detect() {
    if (!this.landmarker || this.video.readyState < 2) return [];
    if (this.video.currentTime === this._lastVideoTime) return this._lastResult || [];
    this._lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this._lastResult = (result.landmarks || []).map((hand) =>
      hand.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    );
    return this._lastResult;
  }
}
