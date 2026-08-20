// config.js
// Every tunable number for the hologram lab lives here.

export const CONFIG = {
  // Pose thresholds (normalized to hand size, so distance-from-camera doesn't matter)
  PINCH_THRESHOLD: 0.16,   // raise this if pinch still won't trigger, lower it if it fires too easily
  FINGER_EXTEND_RATIO: 1.15,

  // Interaction sensitivity
  ROTATE_SENSITIVITY: 6.0,   // radians per full normalized-frame movement
  PAN_SENSITIVITY: 3.5,
  SCALE_MIN: 0.35,
  SCALE_MAX: 3.5,

  // Momentum after release
  INERTIA_DAMPING: 0.94,     // per-frame multiplier, closer to 1 = spins longer
  INERTIA_MIN_VELOCITY: 0.0004,

  // Swipe (model cycling)
  SWIPE_MIN_VELOCITY: 1.3,   // normalized-x per second
  SWIPE_HISTORY_FRAMES: 6,
  SWIPE_COOLDOWN: 0.8,

  // Fist-hold reset
  RESET_HOLD_DURATION: 0.7,

  // Smoothing on raw landmark centers (reduces webcam jitter)
  LANDMARK_SMOOTHING: 0.4,
};
