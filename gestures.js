// gestures.js
// Pure landmark math + a stateful GestureEngine that turns per-frame hand
// poses into high-level interaction events. No Three.js or MediaPipe imports
// here on purpose - this file is testable in plain Node with synthetic
// landmark arrays.
//
// Accuracy notes:
// - Finger extension is judged by the JOINT BEND ANGLE (angle at the PIP
//   joint between the MCP and TIP), not by comparing distances from the
//   wrist. Angle is far less sensitive to how the hand is rotated/tilted
//   toward the camera, which was the main source of misclassified poses.
// - Pinch state uses hysteresis (a lower "engage" threshold and a higher
//   "release" threshold) so it doesn't flicker on/off when your fingers
//   hover right at the boundary distance.
// - Hold-to-fire gestures (fist, two-fist, peace) tolerate a couple of
//   single-frame misreads without resetting the hold timer, so one noisy
//   frame from the camera doesn't cancel a gesture you're still holding.

import { CONFIG } from "./config.js";

// MediaPipe hand landmark indices used
const WRIST = 0;
const THUMB_TIP = 4, THUMB_IP = 3;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_TIP = 20;

export function dist2D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function dist3D(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Angle in degrees at point b, between rays b->a and b->c. Uses 3D (z=0 if absent). */
function angleAtJoint(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z) || 1e-9;
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z) || 1e-9;
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function handScale(lm) {
  return Math.max(dist3D(lm[WRIST], lm[MIDDLE_MCP]), 1e-6);
}

/** A finger is "extended" when it's close to straight - bend angle near 180°. */
function fingerExtended(lm, mcpIdx, pipIdx, tipIdx, cfg) {
  return angleAtJoint(lm[mcpIdx], lm[pipIdx], lm[tipIdx]) > cfg.FINGER_STRAIGHT_ANGLE_DEG;
}

/** Thumb has no PIP, so we use WRIST-IP-TIP as the equivalent joint angle. */
function thumbExtendedCheck(lm, cfg) {
  return angleAtJoint(lm[WRIST], lm[THUMB_IP], lm[THUMB_TIP]) > cfg.THUMB_STRAIGHT_ANGLE_DEG;
}

function vSub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }; }
function vCross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function vNorm(v) {
  const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1e-9;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

/**
 * Estimates the hand's 3D orientation as an orthonormal basis (right/up/forward
 * unit vectors), from landmarks that stay reasonably rigid relative to each
 * other regardless of which fingers are curled: the wrist and the
 * index/middle/pinky knuckles. Y is flipped since image coordinates are
 * y-down but a normal 3D basis is y-up. This is a rough visual estimate
 * (MediaPipe's z is noisy, not true depth), good enough for "does the worn
 * model look attached as your hand turns," not precision AR tracking.
 */
function computeHandOrientation(lm) {
  const toV = (p) => ({ x: p.x, y: -p.y, z: p.z || 0 });
  const wristV = toV(lm[WRIST]);
  const indexV = toV(lm[INDEX_MCP]);
  const middleV = toV(lm[MIDDLE_MCP]);
  const pinkyV = toV(lm[PINKY_MCP]);

  const up = vNorm(vSub(middleV, wristV));              // wrist -> middle knuckle: "along the hand"
  const across = vSub(pinkyV, indexV);                  // index knuckle -> pinky knuckle: "across the palm"
  let forward = vNorm(vCross(across, up));              // palm-facing normal
  let right = vNorm(vCross(up, forward));
  forward = vNorm(vCross(right, up));                   // re-orthogonalize after rounding

  return { right, up, forward };
}

/**
 * Classifies a single hand's landmarks into the pose data the engine needs.
 * lm: array of 21 {x, y, z} normalized points (MediaPipe order).
 * NOTE: `pinching` here is the raw per-frame reading (no hysteresis) - the
 * GestureEngine applies hysteresis on top of this when it processes a frame.
 */
export function classifyHandPose(lm, cfg = CONFIG) {
  const scale = handScale(lm);
  const pinchDist = dist3D(lm[THUMB_TIP], lm[INDEX_TIP]) / scale;
  const pinching = pinchDist < cfg.PINCH_THRESHOLD;

  const thumbExt = thumbExtendedCheck(lm, cfg);
  const indexExt = fingerExtended(lm, INDEX_MCP, INDEX_PIP, INDEX_TIP, cfg);
  const middleExt = fingerExtended(lm, MIDDLE_MCP, MIDDLE_PIP, MIDDLE_TIP, cfg);
  const ringExt = fingerExtended(lm, RING_MCP, RING_PIP, RING_TIP, cfg);
  const pinkyExt = fingerExtended(lm, PINKY_MCP, PINKY_PIP, PINKY_TIP, cfg);
  const extendedCount = [indexExt, middleExt, ringExt, pinkyExt].filter(Boolean).length;

  const center = {
    x: (lm[WRIST].x + lm[INDEX_MCP].x + lm[MIDDLE_MCP].x) / 3,
    y: (lm[WRIST].y + lm[INDEX_MCP].y + lm[MIDDLE_MCP].y) / 3,
  };
  const pinchPoint = {
    x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
    y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
  };

  // Specific multi-finger combos, each checked as its own mutually-exclusive
  // shape so two gestures can never fire from the same hand pose at once.
  const peace = indexExt && middleExt && !ringExt && !pinkyExt && !pinching;
  const rock = indexExt && pinkyExt && !middleExt && !ringExt && !pinching;
  const shaka = thumbExt && pinkyExt && !indexExt && !middleExt && !ringExt && !pinching;
  const threeFinger = indexExt && middleExt && ringExt && !pinkyExt && !pinching;
  const openPalm = extendedCount >= 3 && !pinching && !threeFinger;
  const fist = extendedCount === 0 && !pinching && !thumbExt;

  return {
    pinching,
    pinchDist,
    openPalm,
    fist,
    peace,
    rock,
    shaka,
    threeFinger,
    center,
    pinchPoint,
    scale,
    orientation: computeHandOrientation(lm),
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
    this._pinchState = new Map(); // per hand-identity hysteresis state (keyed by handedness, falls back to array slot if unavailable)
    this._lastHandPos = null;
    this._lastHandTime = null;
    this._smoothedSingle = null;
    this._prevTwoHandDist = null;
    this._prevTwoHandCenter = null;
    this._prevTwoHandAngle = null;
    this._swipeHistory = [];
    this._lastSwipeTime = -Infinity;
    this._lastRockTapTime = -Infinity;
    this._lastShakaTapTime = -Infinity;
    this._lastPinchReleaseTime = -Infinity;
    this._wasPinchingSingle = false;
  }

  reset() {
    this._pinchState = new Map();
    this._lastHandPos = null;
    this._lastHandTime = null;
    this._smoothedSingle = null;
    this._prevTwoHandDist = null;
    this._prevTwoHandCenter = null;
    this._prevTwoHandAngle = null;
    this._swipeHistory = [];
    this._wasPinchingSingle = false;
  }

  /** Generic jitter-tolerant hold-to-fire timer, keyed by name. */
  _hold(key, isActive, now, duration) {
    const startKey = `_${key}Start`;
    const missKey = `_${key}Miss`;
    if (isActive) {
      this[missKey] = 0;
      if (this[startKey] == null) { this[startKey] = now; return false; }
      if (now - this[startKey] >= duration) { this[startKey] = now + 999; return true; }
      return false;
    }
    this[missKey] = (this[missKey] || 0) + 1;
    if (this[missKey] > this.cfg.HOLD_MISS_TOLERANCE) this[startKey] = null;
    return false;
  }

  /** Tracks how fast the primary hand's center is moving, in normalized units/sec. */
  _updateHandVelocity(primary, now) {
    let vel = 0;
    if (primary) {
      if (this._lastHandPos && this._lastHandTime !== null) {
        const dt = now - this._lastHandTime;
        if (dt > 0.001) vel = dist2D(primary.center, this._lastHandPos) / dt;
      }
      this._lastHandPos = { x: primary.center.x, y: primary.center.y };
      this._lastHandTime = now;
    } else {
      this._lastHandPos = null;
      this._lastHandTime = null;
    }
    return vel;
  }

  /** Orders two pinching hands as [Left, Right] by handedness when available,
   * so direction-sensitive math (the two-hand rotate angle) stays consistent
   * across frames even if MediaPipe's array order swaps. Falls back to raw
   * array order when handedness isn't present (e.g. in tests, or if only
   * one hand reports it). */
  _orderHandsStable(twoHands) {
    const [p, q] = twoHands;
    if (p.handedness && q.handedness && p.handedness !== q.handedness) {
      return p.handedness === "Left" ? [p, q] : [q, p];
    }
    return twoHands;
  }

  /**
   * Smooths pinch state per hand-IDENTITY (not array position) with a
   * two-threshold hysteresis band. Keying by handedness (when available)
   * means a hand's pinch state stays correctly attached to that physical
   * hand even if MediaPipe reorders the detection array between frames -
   * keying by array index instead would let hysteresis state leak onto
   * the wrong hand whenever two hands are visible and get reordered.
   * Falls back to array-index keying when handedness isn't provided
   * (e.g. in tests, or a single tracked hand).
   */
  _applyPinchHysteresis(poses) {
    const cfg = this.cfg;
    const engageThreshold = cfg.PINCH_THRESHOLD * cfg.PINCH_ENGAGE_RATIO;
    const seenKeys = new Set();
    poses.forEach((p, i) => {
      const key = p.handedness || `slot${i}`;
      seenKeys.add(key);
      const was = this._pinchState.get(key) || false;
      const nowPinching = was ? p.pinchDist < cfg.PINCH_THRESHOLD : p.pinchDist < engageThreshold;
      this._pinchState.set(key, nowPinching);
      p.pinching = nowPinching;
    });
    // drop stale entries for hands no longer present, so state doesn't
    // grow unboundedly or linger stale across a hand leaving and returning
    for (const key of this._pinchState.keys()) {
      if (!seenKeys.has(key)) this._pinchState.delete(key);
    }
  }

  /**
   * @param {Array} poses - 0-2 objects from classifyHandPose
   * @param {number} now - seconds
   */
  update(poses, now) {
    const cfg = this.cfg;
    this._applyPinchHysteresis(poses);

    const events = {
      rotateDelta: null, scale: null, pan: null, twoHandRotateDelta: null, swipe: null, swipeVertical: null,
      reset: false, fullReset: false, ping: false, brake: false,
      nativeToggle: false, fullscreenToggle: false, muteToggle: false, screenshot: false, wearToggle: false,
      mode: "idle",
    };

    const pinchingHands = poses.filter((p) => p.pinching);
    const primary = poses[0] || null;
    // Single-hand-only gestures (swipe, taps, most holds) require EXACTLY one
    // tracked hand. This isn't just a style choice: MediaPipe doesn't guarantee
    // stable hand identity/ordering frame-to-frame when two hands are visible -
    // "poses[0]" can silently become a different physical hand between frames.
    // With two hands in frame, that reordering could look like a huge sudden
    // jump in position (falsely triggering a swipe) or a gesture flickering
    // between hands. Restricting to exactly one visible hand sidesteps the
    // whole class of bugs - it only pauses these gestures while your other
    // hand is also in frame, which is a small, predictable trade-off.
    const onlyOneHand = poses.length === 1;

    // ---- swipe (both axes), tap gestures: single hand only, see above ----
    if (primary && onlyOneHand) {
      this._swipeHistory.push({ t: now, x: primary.center.x, y: primary.center.y });
      while (this._swipeHistory.length > cfg.SWIPE_HISTORY_FRAMES) this._swipeHistory.shift();

      if (primary.openPalm && this._swipeHistory.length >= 2) {
        const first = this._swipeHistory[0];
        const dt = now - first.t;
        if (dt > 0.05 && now - this._lastSwipeTime > cfg.SWIPE_COOLDOWN) {
          const velX = (primary.center.x - first.x) / dt;
          const velY = (primary.center.y - first.y) / dt;
          if (Math.abs(velX) > cfg.SWIPE_MIN_VELOCITY && Math.abs(velX) >= Math.abs(velY)) {
            events.swipe = velX > 0 ? "right" : "left";
            this._lastSwipeTime = now;
            this._swipeHistory = [];
          } else if (Math.abs(velY) > cfg.SWIPE_MIN_VELOCITY) {
            events.swipeVertical = velY > 0 ? "down" : "up";
            this._lastSwipeTime = now;
            this._swipeHistory = [];
          }
        }
      }

      if (primary.rock && now - this._lastRockTapTime > cfg.GESTURE_COOLDOWN) {
        events.fullscreenToggle = true;
        this._lastRockTapTime = now;
      }
      if (primary.shaka && now - this._lastShakaTapTime > cfg.GESTURE_COOLDOWN) {
        events.muteToggle = true;
        this._lastShakaTapTime = now;
      }
    } else {
      this._swipeHistory = [];
    }

    // ---- hold-to-fire gestures (jitter-tolerant) ----
    const singleFist = !!(primary && primary.fist && onlyOneHand);
    const twoFist = poses.length === 2 && poses.every((p) => p.fist);
    events.brake = singleFist || twoFist; // instant: true every frame a fist is held, no delay - deliberately NOT stillness-gated, since a grab-to-stop should work even while the hand is still settling into place

    // Hold-to-fire commitments (reset, full reset, native toggle, screenshot)
    // additionally require the hand to be roughly STILL. Without this, simply
    // raising or moving your hand into frame can pass through a pose's shape
    // for a moment (e.g. middle+index often straighten before ring+pinky do)
    // and, combined with the jitter-tolerant hold timer, accidentally fire a
    // gesture you never meant to hold.
    const handVel = this._updateHandVelocity(primary, now);
    const isStill = handVel < cfg.HOLD_STILLNESS_MAX_VELOCITY;

    events.reset = this._hold("fist", singleFist && isStill, now, cfg.RESET_HOLD_DURATION);
    events.fullReset = this._hold("twoFist", twoFist && isStill, now, cfg.RESET_HOLD_DURATION);
    events.nativeToggle = this._hold("peace", !!(primary && primary.peace) && onlyOneHand && isStill, now, cfg.PEACE_HOLD_DURATION);
    events.screenshot = this._hold("threeFinger", !!(primary && primary.threeFinger) && onlyOneHand && isStill, now, cfg.THREE_FINGER_HOLD_DURATION);
    // open palm HELD STILL (as opposed to the fast-moving open palm that
    // triggers swipe) toggles "wearing" the hologram on your hand - it
    // then follows your hand's position every frame until toggled off.
    events.wearToggle = this._hold("wear", !!(primary && primary.openPalm) && onlyOneHand && isStill, now, cfg.WEAR_HOLD_DURATION);

    // ---- two-hand pinch: scale + pan + "steering wheel" rotate ----
    if (pinchingHands.length === 2) {
      // Scale and pan are symmetric (distance, average) so hand order doesn't
      // matter for them - but the ANGLE between the two pinch points (used for
      // rotate below) flips 180° if the array order swaps between frames,
      // which MediaPipe doesn't guarantee against. Order by handedness first
      // so the angle's direction stays consistent across frames; falls back
      // to raw array order when handedness isn't available (e.g. in tests).
      const [a, b] = this._orderHandsStable(pinchingHands);
      const currDist = dist2D(a.pinchPoint, b.pinchPoint);
      const currCenter = {
        x: (a.pinchPoint.x + b.pinchPoint.x) / 2,
        y: (a.pinchPoint.y + b.pinchPoint.y) / 2,
      };
      const currAngle = Math.atan2(b.pinchPoint.y - a.pinchPoint.y, b.pinchPoint.x - a.pinchPoint.x);

      if (this._prevTwoHandDist !== null) {
        events.scale = currDist / Math.max(this._prevTwoHandDist, 1e-6);
      }
      if (this._prevTwoHandCenter !== null) {
        events.pan = {
          dx: (currCenter.x - this._prevTwoHandCenter.x) * cfg.PAN_SENSITIVITY,
          dy: (currCenter.y - this._prevTwoHandCenter.y) * cfg.PAN_SENSITIVITY,
        };
      }
      if (this._prevTwoHandAngle !== null) {
        // one hand rising while the other falls (a "steering wheel" turn)
        // changes this angle - map that change directly to a forward/backward
        // tumble of the model, same pitch axis single-hand rotate also drives.
        let deltaAngle = currAngle - this._prevTwoHandAngle;
        if (deltaAngle > Math.PI) deltaAngle -= Math.PI * 2;
        if (deltaAngle < -Math.PI) deltaAngle += Math.PI * 2;
        events.twoHandRotateDelta = deltaAngle * cfg.TWO_HAND_ROTATE_SENSITIVITY;
      }
      this._prevTwoHandDist = currDist;
      this._prevTwoHandCenter = currCenter;
      this._prevTwoHandAngle = currAngle;
      this._smoothedSingle = null;
      events.mode = "scale_pan";
    } else {
      this._prevTwoHandDist = null;
      this._prevTwoHandCenter = null;
      this._prevTwoHandAngle = null;

      // ---- single-hand pinch: rotate (+ double-pinch "ping" detection) ----
      if (pinchingHands.length === 1) {
        if (!this._wasPinchingSingle && now - this._lastPinchReleaseTime < cfg.DOUBLE_PINCH_WINDOW) {
          events.ping = true;
        }
        this._wasPinchingSingle = true;

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
        if (this._wasPinchingSingle) this._lastPinchReleaseTime = now;
        this._wasPinchingSingle = false;
        this._smoothedSingle = null;
      }
    }

    return events;
  }
}
