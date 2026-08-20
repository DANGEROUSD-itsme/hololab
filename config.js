// config.js
// Every tunable number for the hologram lab lives here.

export const CONFIG = {
  // Pose thresholds (normalized to hand size, so distance-from-camera doesn't matter)
  PINCH_THRESHOLD: 0.16,   // raise this if pinch still won't trigger, lower it if it fires too easily
  PINCH_ENGAGE_RATIO: 0.72, // pinch must close to (THRESHOLD * this) to START, but only needs to
                             // open back past the full THRESHOLD to RELEASE - this hysteresis band
                             // stops pinch flickering on/off when your fingers hover near the boundary
  FINGER_STRAIGHT_ANGLE_DEG: 150,  // joint-bend angle above which a finger counts as "extended" -
                                     // angle-based detection is far more robust to hand rotation
                                     // than the old wrist-distance heuristic
  THUMB_STRAIGHT_ANGLE_DEG: 140,
  HOLD_MISS_TOLERANCE: 2,   // consecutive off-frames a hold-to-fire gesture tolerates before resetting
  HOLD_STILLNESS_MAX_VELOCITY: 0.6, // normalized units/sec - hold-to-fire gestures (reset, native
                                      // toggle, screenshot) only accumulate while the hand is roughly
                                      // still, so passing through a pose's shape while raising/moving
                                      // your hand can't accidentally trigger them

  // Interaction sensitivity
  ROTATE_SENSITIVITY: 6.0,   // radians per full normalized-frame movement
  PAN_SENSITIVITY: 3.5,
  SCALE_MIN: 0.35,
  SCALE_MAX: 3.5,

  // Momentum after release (rotation, pan, and scale all use this)
  INERTIA_DAMPING: 0.94,     // per-frame multiplier, closer to 1 = spins longer
  INERTIA_MIN_VELOCITY: 0.0004,
  PAN_INERTIA_DAMPING: 0.90,
  PAN_INERTIA_MIN: 0.0005,

  // Swipe (model cycling + vertical HUD toggle)
  SWIPE_MIN_VELOCITY: 1.3,   // normalized-x per second
  SWIPE_HISTORY_FRAMES: 6,
  SWIPE_COOLDOWN: 0.8,

  // Fist-hold reset / two-fist full reset / peace-hold native toggle / three-finger-hold screenshot
  RESET_HOLD_DURATION: 0.7,
  PEACE_HOLD_DURATION: 0.6,
  THREE_FINGER_HOLD_DURATION: 0.6,

  // Thumb tick (color cycling) + general gesture debounce
  GESTURE_COOLDOWN: 0.5,

  // Double-pinch "ping" - a pinch that starts within this many seconds of
  // the previous pinch releasing counts as a double-pinch
  DOUBLE_PINCH_WINDOW: 0.45,

  // Smoothing on raw landmark centers (reduces webcam jitter)
  LANDMARK_SMOOTHING: 0.4,

  // ---- Calibration ----
  CALIBRATION_DURATION: 2.5,       // seconds to sample a held pinch
  CALIBRATION_MARGIN: 1.5,         // multiplier applied to the closest observed pinch
  CALIBRATION_MIN_THRESHOLD: 0.05,
  CALIBRATION_MAX_THRESHOLD: 0.35,

  // ---- Performance ----
  // Hand/face detection is throttled independently of the render loop so a
  // slow inference pass never stalls the 3D scene's frame rate.
  DETECTION_INTERVAL_MS: 33,       // ~30fps detection cap; rendering still runs at full rate
  MAX_EDGE_TRIANGLES: 60000,       // above this, skip edge-wireframe overlay on dropped models (perf safeguard)

  // ---- Idle ----
  IDLE_AUTO_ROTATE_SPEED: 0.0025,  // slow ambient spin when no hand has been seen for a moment
  IDLE_AUTO_ROTATE_DELAY: 2.0,     // seconds of no-hand before idle spin kicks in

  // ---- Audio ----
  AUDIO_ENABLED_DEFAULT: true,
  AUDIO_HUM_VOLUME: 0.05,
  AUDIO_SFX_VOLUME: 0.18,
};

// Color themes cycled with a thumbs-up/down tap. Each drives both the CSS
// HUD variables and the Three.js hologram materials.
export const THEMES = [
  { name: "CYAN",    core: 0x5fe1f2, dim: 0x163542, glow: "rgba(95, 225, 242, 0.35)" },
  { name: "AMBER",   core: 0xffb454, dim: 0x4a2f10, glow: "rgba(255, 180, 84, 0.35)" },
  { name: "VIOLET",  core: 0xb98bff, dim: 0x2a1b47, glow: "rgba(185, 139, 255, 0.35)" },
  { name: "EMERALD", core: 0x6cffa8, dim: 0x0f3d24, glow: "rgba(108, 255, 168, 0.35)" },
  { name: "CRIMSON", core: 0xff6b81, dim: 0x4a1420, glow: "rgba(255, 107, 129, 0.35)" },
];
