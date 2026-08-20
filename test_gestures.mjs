// test_gestures.mjs
// Run: node test_gestures.mjs
// Feeds synthetic landmark sequences into classifyHandPose + GestureEngine
// and checks the emitted events, without needing a browser or camera.

import { classifyHandPose, GestureEngine, dist2D } from "./gestures.js";
import { CONFIG } from "./config.js";

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "OK  " : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// Builds a synthetic 21-point hand. index_ext/middle_ext/etc control whether
// that finger's tip sits far from the wrist (extended) or folds back (curled).
function makeHand({ wristX = 0.5, wristY = 0.9, indexExt = false, middleExt = false,
                     ringExt = false, pinkyExt = false, thumbExt = false, pinch = false } = {}) {
  const lm = new Array(21).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  lm[0] = { x: wristX, y: wristY, z: 0 };

  function setFinger(mcpI, pipI, tipI, extended, dx) {
    lm[mcpI] = { x: wristX + dx, y: wristY - 0.05, z: 0 };
    lm[pipI] = { x: wristX + dx, y: wristY - 0.09, z: 0 };
    lm[tipI] = { x: wristX + dx, y: wristY - (extended ? 0.22 : 0.04), z: 0 };
  }
  setFinger(5, 6, 8, indexExt, 0.02);
  setFinger(9, 10, 12, middleExt, 0.0);
  setFinger(13, 14, 16, ringExt, -0.02);
  setFinger(17, 18, 20, pinkyExt, -0.04);

  lm[3] = { x: wristX - 0.08, y: wristY - 0.03, z: 0 };
  lm[4] = pinch
    ? { x: lm[8].x, y: lm[8].y, z: 0 }
    : { x: wristX - (thumbExt ? 0.16 : 0.03), y: wristY - 0.03, z: 0 };

  return lm;
}

// ---------- pose classification ----------
const openPalmLm = makeHand({ indexExt: true, middleExt: true, ringExt: true, pinkyExt: true });
const fistLm = makeHand({});
const pinchLm = makeHand({ indexExt: true, pinch: true });

check("open palm classified", classifyHandPose(openPalmLm).openPalm === true);
check("fist classified", classifyHandPose(fistLm).fist === true);
check("pinch classified", classifyHandPose(pinchLm).pinching === true);
check("open palm is not a pinch", classifyHandPose(openPalmLm).pinching === false);

// ---------- single-hand rotate ----------
{
  const engine = new GestureEngine(CONFIG);
  let hand = makeHand({ indexExt: true, pinch: true, wristX: 0.4 });
  engine.update([classifyHandPose(hand)], 0.0);           // frame 1: establishes smoothed center, no delta yet
  hand = makeHand({ indexExt: true, pinch: true, wristX: 0.5 }); // moved right
  const ev = engine.update([classifyHandPose(hand)], 0.05);
  check("rotate fires on second pinched frame", ev.rotateDelta !== null);
  check("rotate dx is positive for rightward hand movement", ev.rotateDelta.dx > 0);
  check("mode is rotate", ev.mode === "rotate");
}

// ---------- two-hand scale ----------
{
  const engine = new GestureEngine(CONFIG);
  let left = makeHand({ indexExt: true, pinch: true, wristX: 0.3 });
  let right = makeHand({ indexExt: true, pinch: true, wristX: 0.7 });
  engine.update([classifyHandPose(left), classifyHandPose(right)], 0.0);
  // hands move apart -> should scale up
  left = makeHand({ indexExt: true, pinch: true, wristX: 0.2 });
  right = makeHand({ indexExt: true, pinch: true, wristX: 0.8 });
  const ev = engine.update([classifyHandPose(left), classifyHandPose(right)], 0.05);
  check("two-hand pinch produces a scale factor", ev.scale !== null);
  check("hands moving apart scales up (>1)", ev.scale > 1.0);
  check("mode is scale_pan", ev.mode === "scale_pan");
}

// ---------- two-hand pan ----------
{
  const engine = new GestureEngine(CONFIG);
  let left = makeHand({ indexExt: true, pinch: true, wristX: 0.3, wristY: 0.5 });
  let right = makeHand({ indexExt: true, pinch: true, wristX: 0.7, wristY: 0.5 });
  engine.update([classifyHandPose(left), classifyHandPose(right)], 0.0);
  left = makeHand({ indexExt: true, pinch: true, wristX: 0.35, wristY: 0.55 });
  right = makeHand({ indexExt: true, pinch: true, wristX: 0.75, wristY: 0.55 });
  const ev = engine.update([classifyHandPose(left), classifyHandPose(right)], 0.05);
  check("two-hand pinch produces a pan delta", ev.pan !== null);
  check("pan dx positive for rightward joint movement", ev.pan.dx > 0);
  check("pan dy positive for downward joint movement", ev.pan.dy > 0);
}

// ---------- swipe ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = null;
  for (let i = 0; i < 6; i++) {
    const hand = makeHand({ indexExt: true, middleExt: true, ringExt: true, pinkyExt: true, wristX: 0.2 + i * 0.15 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.03); // fast: 0.15 per 0.03s = 5.0/s > threshold
    if (ev.swipe) fired = ev.swipe;
  }
  check("fast open-palm sweep fires a swipe event", fired === "right");
}

// ---------- fist hold reset ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    const hand = makeHand({});
    const ev = engine.update([classifyHandPose(hand)], i * 0.1); // 2s total, hold duration is 0.7s
    if (ev.reset) fired = true;
  }
  check("held fist eventually fires reset", fired === true);
}

// ---------- no false reset on a brief fist ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 3; i++) {
    const hand = makeHand({});
    const ev = engine.update([classifyHandPose(hand)], i * 0.1); // only 0.2s, below hold duration
    if (ev.reset) fired = true;
  }
  check("brief fist does not fire reset", fired === false);
}

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);

// ---------- double-pinch "ping" ----------
{
  const engine = new GestureEngine(CONFIG);
  const pinchHand = makeHand({ indexExt: true, pinch: true, wristX: 0.5 });
  const openHand = makeHand({ indexExt: true, middleExt: true, ringExt: true, pinkyExt: true, wristX: 0.5 });

  engine.update([classifyHandPose(pinchHand)], 0.0);   // pinch starts
  engine.update([classifyHandPose(openHand)], 0.1);    // release
  const ev = engine.update([classifyHandPose(pinchHand)], 0.2); // re-pinch quickly -> ping
  check("quick double-pinch fires ping", ev.ping === true);
}
{
  const engine = new GestureEngine(CONFIG);
  const pinchHand = makeHand({ indexExt: true, pinch: true, wristX: 0.5 });
  const openHand = makeHand({ indexExt: true, middleExt: true, ringExt: true, pinkyExt: true, wristX: 0.5 });

  engine.update([classifyHandPose(pinchHand)], 0.0);
  engine.update([classifyHandPose(openHand)], 0.1);
  // wait past the double-pinch window before re-pinching
  const ev = engine.update([classifyHandPose(pinchHand)], 2.0);
  check("slow re-pinch does NOT fire ping", ev.ping === false);
}

// ---------- two-hand fist -> full reset ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    const left = makeHand({ wristX: 0.3 });
    const right = makeHand({ wristX: 0.7 });
    const ev = engine.update([classifyHandPose(left), classifyHandPose(right)], i * 0.1);
    if (ev.fullReset) fired = true;
  }
  check("held two-hand fist fires fullReset", fired === true);
}
{
  // single-hand fist should still fire the regular (non-full) reset, not fullReset
  const engine = new GestureEngine(CONFIG);
  let reset = false, fullReset = false;
  for (let i = 0; i < 20; i++) {
    const hand = makeHand({ wristX: 0.5 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.reset) reset = true;
    if (ev.fullReset) fullReset = true;
  }
  check("single-hand fist fires reset but not fullReset", reset === true && fullReset === false);
}

// ---------- vertical swipe ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = null;
  for (let i = 0; i < 6; i++) {
    const hand = makeHand({ indexExt: true, middleExt: true, ringExt: true, pinkyExt: true, wristX: 0.5, wristY: 0.2 + i * 0.15 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.03);
    if (ev.swipeVertical) fired = ev.swipeVertical;
  }
  check("fast vertical open-palm sweep fires swipeVertical", fired === "down");
}

console.log(failures === 0 ? "\nALL TESTS PASSED (extended)" : `\n${failures} TEST(S) FAILED (extended)`);

// ---------- new single-hand poses: peace / rock / shaka / three-finger ----------
{
  const peaceLm = makeHand({ indexExt: true, middleExt: true });
  const p = classifyHandPose(peaceLm);
  check("peace pose classified", p.peace === true);
  check("peace is not openPalm", p.openPalm === false);
}
{
  const rockLm = makeHand({ indexExt: true, pinkyExt: true });
  const p = classifyHandPose(rockLm);
  check("rock pose classified", p.rock === true);
  check("rock is not peace", p.peace === false);
}
{
  const shakaLm = makeHand({ thumbExt: true, pinkyExt: true });
  const p = classifyHandPose(shakaLm);
  check("shaka pose classified", p.shaka === true);
  check("shaka is a distinct pose from rock", p.shaka === true && p.rock === false);
}
{
  const threeLm = makeHand({ indexExt: true, middleExt: true, ringExt: true });
  const p = classifyHandPose(threeLm);
  check("threeFinger pose classified", p.threeFinger === true);
  check("threeFinger is not openPalm (mutually exclusive)", p.openPalm === false);
}

// ---------- peace hold -> native toggle ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    const hand = makeHand({ indexExt: true, middleExt: true, wristX: 0.5 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.nativeToggle) fired = true;
  }
  check("held peace sign fires nativeToggle", fired === true);
}

// ---------- three-finger hold -> screenshot ----------
{
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    const hand = makeHand({ indexExt: true, middleExt: true, ringExt: true, wristX: 0.5 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.screenshot) fired = true;
  }
  check("held three-finger fires screenshot", fired === true);
}

// ---------- rock tap -> fullscreen toggle (with cooldown) ----------
{
  const engine = new GestureEngine(CONFIG);
  const rockLm = makeHand({ indexExt: true, pinkyExt: true, wristX: 0.5 });
  const ev1 = engine.update([classifyHandPose(rockLm)], 0.0);
  const ev2 = engine.update([classifyHandPose(rockLm)], 0.05); // too soon - cooldown
  check("rock tap fires fullscreenToggle once", ev1.fullscreenToggle === true);
  check("rock tap respects cooldown", ev2.fullscreenToggle === false);
}

// ---------- shaka tap -> mute toggle ----------
{
  const engine = new GestureEngine(CONFIG);
  const shakaLm = makeHand({ thumbExt: true, pinkyExt: true, wristX: 0.5 });
  const ev = engine.update([classifyHandPose(shakaLm)], 0.0);
  check("shaka tap fires muteToggle", ev.muteToggle === true);
}

// ---------- pinch hysteresis ----------
{
  // A pinch distance between the engage and release thresholds should NOT
  // start a fresh pinch, but SHOULD keep an already-active pinch going.
  const engine = new GestureEngine(CONFIG);
  const engageDist = CONFIG.PINCH_THRESHOLD * CONFIG.PINCH_ENGAGE_RATIO;
  const midBand = (engageDist + CONFIG.PINCH_THRESHOLD) / 2; // between engage and release

  const fakePoseAt = (dist) => ({
    pinching: dist < CONFIG.PINCH_THRESHOLD, // raw value, hysteresis overrides this
    pinchDist: dist,
    openPalm: false, fist: false,
    peace: false, rock: false, shaka: false, threeFinger: false,
    center: { x: 0.5, y: 0.5 }, pinchPoint: { x: 0.5, y: 0.5 }, scale: 0.15,
  });

  const midBandResult = engine.update([fakePoseAt(midBand)], 0.0);
  check("mid-band distance does NOT start a fresh pinch", midBandResult.rotateDelta === null && midBandResult.mode !== "rotate");

  // now genuinely engage
  engine.update([fakePoseAt(engageDist * 0.5)], 0.05);
  // move back out to the mid-band - should STILL count as pinching (hysteresis holds it)
  const stillHeld = engine.update([fakePoseAt(midBand)], 0.1);
  check("mid-band distance keeps an active pinch held", stillHeld.mode === "rotate");
}

console.log(failures === 0 ? "\nALL TESTS PASSED (v2)" : `\n${failures} TEST(S) FAILED (v2)`);

// ---------- hold jitter tolerance ----------
{
  // A held fist with ONE single-frame misclassification blip partway through
  // should still fire reset - that blip should not cancel the hold.
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    // frame 5 is a noisy misread (not a fist) - everything else is a solid fist
    const isBlip = i === 5;
    const hand = isBlip
      ? makeHand({ indexExt: true, wristX: 0.5 }) // briefly reads as "point" instead of fist
      : makeHand({ wristX: 0.5 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.reset) fired = true;
  }
  check("a single-frame blip does not cancel an in-progress fist hold", fired === true);
}
{
  // But a SUSTAINED break (more than HOLD_MISS_TOLERANCE frames) should
  // genuinely cancel it - jitter tolerance isn't infinite.
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 10; i++) {
    const hand = makeHand({ wristX: 0.5 }); // solid fist
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.reset) fired = true;
  }
  // now break the fist for a long stretch, then try again from scratch (short)
  for (let i = 10; i < 15; i++) {
    const hand = makeHand({ indexExt: true, wristX: 0.5 }); // sustained non-fist
    engine.update([classifyHandPose(hand)], i * 0.1);
  }
  let refired = false;
  for (let i = 15; i < 17; i++) {
    const hand = makeHand({ wristX: 0.5 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.reset) refired = true;
  }
  check("a sustained break genuinely resets the hold (not fired again immediately)", refired === false);
}

console.log(failures === 0 ? "\nALL TESTS PASSED (v3)" : `\n${failures} TEST(S) FAILED (v3)`);

// ---------- fist brake (instant, no hold delay) ----------
{
  const engine = new GestureEngine(CONFIG);
  const fistHand = makeHand({ wristX: 0.5 });
  const ev = engine.update([classifyHandPose(fistHand)], 0.0);
  check("single fist fires brake on the very first frame (no hold delay)", ev.brake === true);
}
{
  const engine = new GestureEngine(CONFIG);
  const left = makeHand({ wristX: 0.3 });
  const right = makeHand({ wristX: 0.7 });
  const ev = engine.update([classifyHandPose(left), classifyHandPose(right)], 0.0);
  check("two-hand fist fires brake immediately too", ev.brake === true);
}
{
  const engine = new GestureEngine(CONFIG);
  const openHand = makeHand({ indexExt: true, middleExt: true, ringExt: true, pinkyExt: true, wristX: 0.5 });
  const ev = engine.update([classifyHandPose(openHand)], 0.0);
  check("open palm does not fire brake", ev.brake === false);
}
{
  const engine = new GestureEngine(CONFIG);
  const pinchHand = makeHand({ indexExt: true, pinch: true, wristX: 0.5 });
  const ev = engine.update([classifyHandPose(pinchHand)], 0.0);
  check("pinch does not fire brake", ev.brake === false);
}
{
  // one hand fisted, the other actively pinch-rotating: brake should NOT
  // fire, so it can't fight an in-progress single-hand rotate from the
  // other hand.
  const engine = new GestureEngine(CONFIG);
  const fistHand = makeHand({ wristX: 0.3 });
  const pinchHand = makeHand({ indexExt: true, pinch: true, wristX: 0.7 });
  const ev = engine.update([classifyHandPose(fistHand), classifyHandPose(pinchHand)], 0.0);
  check("a fist alongside an actively-pinching other hand does not brake", ev.brake === false);
}

console.log(failures === 0 ? "\nALL TESTS PASSED (v4)" : `\n${failures} TEST(S) FAILED (v4)`);

// ---------- stillness gate: moving hand must not trigger holds ----------
{
  // Simulates raising a hand into frame: the peace shape appears each frame,
  // but the hand center keeps moving fast (as it would while being raised) -
  // this must NOT accumulate enough hold-time to fire nativeToggle.
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    const hand = makeHand({ indexExt: true, middleExt: true, wristX: 0.2 + i * 0.1, wristY: 0.9 - i * 0.08 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.nativeToggle) fired = true;
  }
  check("a moving hand passing through 'peace' does NOT fire nativeToggle", fired === false);
}
{
  // Same idea for fist - moving hand should not fire reset either.
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  for (let i = 0; i < 20; i++) {
    const hand = makeHand({ wristX: 0.2 + i * 0.1, wristY: 0.9 - i * 0.08 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.reset) fired = true;
  }
  check("a moving fist does NOT fire reset", fired === false);
}
{
  // But brake (the instant stop) should STILL fire immediately even while
  // the hand is moving - that's deliberately exempt from the stillness gate.
  const engine = new GestureEngine(CONFIG);
  const movingFist = makeHand({ wristX: 0.4, wristY: 0.85 });
  const ev = engine.update([classifyHandPose(movingFist)], 0.0);
  check("brake still fires instantly regardless of motion", ev.brake === true);
}
{
  // A hand that moves into position and THEN holds still should still fire
  // normally once it settles - the gate only blocks while actually moving.
  const engine = new GestureEngine(CONFIG);
  let fired = false;
  // first, move into a fist over a few frames
  for (let i = 0; i < 5; i++) {
    const hand = makeHand({ wristX: 0.3 + i * 0.04, wristY: 0.9 });
    engine.update([classifyHandPose(hand)], i * 0.1);
  }
  // now hold perfectly still at the final position for the full duration
  for (let i = 5; i < 15; i++) {
    const hand = makeHand({ wristX: 0.46, wristY: 0.9 });
    const ev = engine.update([classifyHandPose(hand)], i * 0.1);
    if (ev.reset) fired = true;
  }
  check("settling into place then holding still still fires reset", fired === true);
}

console.log(failures === 0 ? "\nALL TESTS PASSED (v5)" : `\n${failures} TEST(S) FAILED (v5)`);
process.exit(failures === 0 ? 0 : 1);
