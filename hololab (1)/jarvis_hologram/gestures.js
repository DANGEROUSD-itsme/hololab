// gestures.js
// Pure landmark math + a stateful GestureEngine that turns per-frame hand
// poses into high-level interaction events (rotate, scale, pan, swipe, reset).
// No Three.js or MediaPipe imports here on purpose - this file is testable
// in plain Node with synthetic landmark arrays.

import { CONFIG } from "./config.js";

// MediaPipe hand landmark indices used
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8, INDEX_PIP = 6;
const MIDDLE_TIP = 12, MIDDLE_PIP = 10, MIDDLE_MCP = 9;
const RING_TIP = 16, RING_PIP = 14;
const PINKY_TIP = 20, PINKY_PIP = 18;

export function dist2D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function handScale(lm) {
  return Math.max(dist2D(lm[WRIST], lm[MIDDLE_MCP]), 1e-6);
}

function fingerExtended(lm, tipIdx, pipIdx, ratio) {
  return dist2D(lm[tipIdx], lm[WRIST]) > dist2D(lm[pipIdx], lm[WRIST]) * ratio;
}

/**
 * Classifies a single hand's landmarks into the pose data the engine needs.
 * lm: array of 21 {x, y, z} normalized points (MediaPipe order).
 */
export function classifyHandPose(lm, cfg = CONFIG) {
  const scale = handScale(lm);
  const pinchDist = dist2D(lm[THUMB_TIP], lm[INDEX_TIP]) / scale;
  const pinching = pinchDist < cfg.PINCH_THRESHOLD;

  const indexExt = fingerExtended(lm, INDEX_TIP, INDEX_PIP, cfg.FINGER_EXTEND_RATIO);
  const middleExt = fingerExtended(lm, MIDDLE_TIP, MIDDLE_PIP, cfg.FINGER_EXTEND_RATIO);
  const ringExt = fingerExtended(lm, RING_TIP, RING_PIP, cfg.FINGER_EXTEND_RATIO);
  const pinkyExt = fingerExtended(lm, PINKY_TIP, PINKY_PIP, cfg.FINGER_EXTEND_RATIO);
  const extendedCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

  const INDEX_MCP = 5;
  const center = {
    x: (lm[WRIST].x + lm[INDEX_MCP].x + lm[MIDDLE_MCP].x) / 3,
    y: (lm[WRIST].y + lm[INDEX_MCP].y + lm[MIDDLE_MCP].y) / 3,
  };
  const pinchPoint = {
    x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
    y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
  };

  return {
    pinching,
    pinchDist,   // raw normalized thumb-index distance, useful for tuning PINCH_THRESHOLD
    openPalm: extendedCount >= 3 && !pinching,
    fist: extendedCount === 0 && !pinching,
    center,
    pinchPoint,
    scale, // depth proxy: bigger = hand closer to camera
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Stateful engine: feed it the array of this-frame hand poses (0, 1, or 2),
 * get back the interaction events for this frame.
 */
export class GestureEngine {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this._smoothedSingle = null;   // smoothed center for single-hand rotate
    this._prevTwoHandDist = null;
    this._prevTwoHandCenter = null;
    this._swipeHistory = [];       // {t, x} using first hand's center
    this._lastSwipeTime = -Infinity;
    this._fistHoldStart = null;
  }

  reset() {
    this._smoothedSingle = null;
    this._prevTwoHandDist = null;
    this._prevTwoHandCenter = null;
    this._swipeHistory = [];
    this._fistHoldStart = null;
  }

  /**
   * @param {Array} poses - 0-2 objects from classifyHandPose
   * @param {number} now - seconds
   */
  update(poses, now) {
    const cfg = this.cfg;
    const events = { rotateDelta: null, scale: null, pan: null, swipe: null, reset: false, mode: "idle" };

    const pinchingHands = poses.filter(p => p.pinching);

    // ---- swipe + fist-hold use the first tracked hand (if any) ----
    const primary = poses[0] || null;
    if (primary) {
      this._swipeHistory.push({ t: now, x: primary.center.x });
      while (this._swipeHistory.length > cfg.SWIPE_HISTORY_FRAMES) this._swipeHistory.shift();

      if (primary.openPalm && this._swipeHistory.length >= 2) {
        const first = this._swipeHistory[0];
        const dt = now - first.t;
        if (dt > 0.05) {
          const vel = (primary.center.x - first.x) / dt;
          if (Math.abs(vel) > cfg.SWIPE_MIN_VELOCITY && now - this._lastSwipeTime > cfg.SWIPE_COOLDOWN) {
            events.swipe = vel > 0 ? "right" : "left";
            this._lastSwipeTime = now;
            this._swipeHistory = [];
          }
        }
      }

      if (primary.fist) {
        if (this._fistHoldStart === null) this._fistHoldStart = now;
        else if (now - this._fistHoldStart >= cfg.RESET_HOLD_DURATION) {
          events.reset = true;
          this._fistHoldStart = now + 999; // avoid immediate refire
        }
      } else {
        this._fistHoldStart = null;
      }
    } else {
      this._swipeHistory = [];
      this._fistHoldStart = null;
    }

    // ---- two-hand pinch: scale + pan ----
    if (pinchingHands.length === 2) {
      const [a, b] = pinchingHands;
      const currDist = dist2D(a.pinchPoint, b.pinchPoint);
      const currCenter = {
        x: (a.pinchPoint.x + b.pinchPoint.x) / 2,
        y: (a.pinchPoint.y + b.pinchPoint.y) / 2,
      };

      if (this._prevTwoHandDist !== null) {
        const ratio = currDist / Math.max(this._prevTwoHandDist, 1e-6);
        events.scale = ratio;
      }
      if (this._prevTwoHandCenter !== null) {
        events.pan = {
          dx: (currCenter.x - this._prevTwoHandCenter.x) * cfg.PAN_SENSITIVITY,
          dy: (currCenter.y - this._prevTwoHandCenter.y) * cfg.PAN_SENSITIVITY,
        };
      }
      this._prevTwoHandDist = currDist;
      this._prevTwoHandCenter = currCenter;
      this._smoothedSingle = null;
      events.mode = "scale_pan";
    } else {
      this._prevTwoHandDist = null;
      this._prevTwoHandCenter = null;

      // ---- single-hand pinch: rotate ----
      if (pinchingHands.length === 1) {
        const c = pinchingHands[0].center;
        if (this._smoothedSingle === null) {
          this._smoothedSingle = { x: c.x, y: c.y };
        } else {
          const prev = { ...this._smoothedSingle };
          this._smoothedSingle.x = lerp(this._smoothedSingle.x, c.x, 1 - cfg.LANDMARK_SMOOTHING);
          this._smoothedSingle.y = lerp(this._smoothedSingle.y, c.y, 1 - cfg.LANDMARK_SMOOTHING);
          events.rotateDelta = {
            dx: (this._smoothedSingle.x - prev.x) * cfg.ROTATE_SENSITIVITY,
            dy: (this._smoothedSingle.y - prev.y) * cfg.ROTATE_SENSITIVITY,
          };
        }
        events.mode = "rotate";
      } else {
        this._smoothedSingle = null;
      }
    }

    return events;
  }
}
