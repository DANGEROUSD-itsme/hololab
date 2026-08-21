# HOLOLAB — gesture-controlled hologram

Made by Dheera Jayachitra & Claude.

A Jarvis-style interface: a floating 3D hologram you rotate, scale, pan, and
recolor with your bare hands in the air, tracked live through your webcam.
Runs entirely in the browser — nothing to install beyond a local server to
serve the files (needed because camera access requires a "secure" origin,
which `http://localhost` counts as but a plain double-clicked file does not).

## Run it

```
# from inside this folder
python -m http.server 8000
```
or
```
npx serve .
```

Open **http://localhost:8000** in Chrome or Edge, click **ENGAGE**, allow
camera access, then **hold a pinch for ~2.5s when the calibration screen
appears** — this measures your actual pinch distance so gestures register
reliably instead of guessing at a threshold. It's saved locally, so you only
need to do this once.

## Controls

**Hand**
| Gesture | Effect |
|---|---|
| One hand, pinch thumb+index, move | Rotate the hologram (momentum on release) |
| Two hands, both pinched, spread apart/together | Scale up/down |
| Two hands, both pinched, move together | Pan (also has momentum) |
| Two hands, both pinched, one rises as the other falls | Tumble the model forward/backward — like turning a steering wheel |
| Quick double-pinch (pinch, release, pinch again fast) | Ping — particle burst |
| Open palm, fast horizontal swipe | Cycle to next/previous model |
| Open palm, fast vertical swipe | Show/hide the HUD panels |
| Peace sign ✌️ (index+middle), held ~0.6s | Toggle native materials / hologram skin |
| Rock sign 🤟 (index+pinky), tap | Toggle fullscreen |
| Shaka 🤙 (thumb+pinky), tap | Toggle mute |
| Three fingers (index+middle+ring), held ~0.6s | Save screenshot |
| Open palm, held still ~0.6s | Wear the hologram on your hand — switches to AR: camera fills the screen, model overlays your hand in the live video / take it off to return to the floating hologram view |
| Fist (either hand) | Instantly stops all rotation/pan — like grabbing the hologram to still it |
| Fist, held ~0.7s | Reset view (rotation/scale/pan) |
| Both hands as fists, held ~0.7s | Full reset — view, color, and model all back to default |

**Files** — drop any of these onto the page: `.glb`, `.gltf` (self-contained only), `.3mf`, `.obj`, `.fbx`, `.stl`, `.ply`

**Keyboard**
| Key | Action |
|---|---|
| `?` | Toggle the full controls reference |
| `S` | Save a screenshot |
| `F` | Toggle fullscreen |
| `M` | Toggle sound |
| `C` | Next color theme |
| `Shift+C` | Previous color theme |
| `R` | Reset view |
| `]` | Next model |
| `[` | Previous model |
| `V` | Enlarge/shrink the camera preview |

The toolbar top-right (🔊 ⛶ 🔍 📷 ?) does the same things with clicks.

## What's new in this pass

**Worn mode now tracks your hand's actual rotation, not just its position**
- Turn your wrist any direction — roll, tilt, twist — and the model turns with it, instead of just floating near your hand while facing a fixed direction. This estimates a full 3D orientation from your hand's landmarks (using the wrist and the index/middle/pinky knuckles as a rigid reference frame), not just a single tilt angle.
- Validated the math directly rather than trusting it blind: rotated a synthetic hand by a known amount around each of the three axes (roll, pitch, yaw) and confirmed the computed orientation rotates by that *exact* same amount every time — that's the actual property that matters ("the output tracks the input"), and it held on all three axes.
- Also tightened the responsiveness for fast movement — both position and rotation tracking are noticeably snappier now, closer to something actually strapped to your wrist than a laggy floating follower.

**Wearing it is now real AR, not a disconnected preview**
- Previously, "worn" mode floated the model in the abstract 3D scene while the actual camera feed stayed a tiny, unrelated corner thumbnail — there was no real spatial link between where your hand appeared on your screen and where the model showed up. Now, the moment you put it on, the camera feed becomes the full-screen background and the 3D scene renders transparently on top of it, so the model genuinely overlays your hand in the live video — the grid floor and ambient rings hide themselves too, since they'd look out of place over a real camera feed.
- Fixed the alignment math to go with it: your camera likely captures a different aspect ratio than your screen, so the visible video gets cropped to fill the screen (same as any `object-fit: cover` image). Hand tracking runs on the *full, uncropped* frame, so without correcting for that crop, the model would drift away from your actual hand anywhere but dead-center. The hand-to-screen mapping now accounts for this the same way the video's own cropping does — validated with worked-through numeric test cases (crop margins, the exact edges of the visible window, both landscape and portrait aspect combinations) since I can't test this against a real camera myself.
- Take it off (hold an open palm still again) and everything reverts — camera preview back to its normal size, grid and rings back, scene opaque again.

**Two-hand "steering wheel" tumble**
- Pinch with both hands, then move one up while the other moves down (like turning a big invisible steering wheel toward you). The model tumbles forward/backward to match. This works alongside scale and pan in the same two-hand-pinch gesture — spread/shift/steer are all independent and can be combined fluidly, like handling a real object with both hands.
- Fixed a subtlety this surfaced: MediaPipe doesn't guarantee which hand reports first when two hands are visible, and a direction-sensitive gesture like this would flip 180° if that order swapped between frames. The two pinch points are now ordered by hand identity (left/right) before computing the steering angle, so the rotation direction stays consistent regardless of detection order — tested by simulating the exact same physical motion with the array order swapped mid-gesture.

**Uploaded models persist across a page refresh**
- Drop in a model and it now survives a reload — restored automatically the moment the page comes back up. It clears when you actually close the tab (this uses the browser's session storage, which is built for exactly this: alive across refreshes, gone when the tab closes). Files over ~4MB skip persistence with a console note, to stay safely under the browser's storage quota — they'll still load fine for your current session, just need re-dropping after a refresh.

**Your own model, bundled in**
- Your webshooter model ships with the project now (`models/webshooter_V4.glb`) as a sixth built-in — cycle to it the same way as any other model, no need to drag-and-drop it back in every time.

**Easier model switching**
- `]` / `[` cycle to the next/previous model directly from the keyboard, alongside the existing swipe gesture.

**Wear it**
- Hold an open palm *still* for about half a second and the hologram attaches to your hand — it shrinks down and follows your hand's position in real time, like a worn holographic device. Hold an open palm still again to take it off and set it back down. (This is deliberately a *held-still* open palm, distinct from the *fast-moving* open palm that triggers a model swipe — tested that the two never trigger each other.)

**Bigger camera preview**
- Click the 🔍 button in the toolbar, or press `V`, to enlarge the camera preview — it was pretty small by default. Press again to shrink it back.

**Proactive debug pass (found by code audit, not yet a reported symptom)**
- **Hand-identity stability**: MediaPipe doesn't guarantee the same physical hand stays at the same array index frame-to-frame when two hands are visible — it can reorder them. Pinch hysteresis is now keyed by hand identity (handedness) instead of array position, so it can't leak state onto the wrong hand. Single-hand gestures (swipe, rock/shaka taps, peace/three-finger holds) now also require exactly one hand in frame, since a sudden hand reordering could otherwise look like a huge instantaneous position jump and falsely trigger a swipe, or cause a held gesture to flicker between hands.
- **Memory leaks fixed**: swapping models (cycling built-ins, or dropping a new file) never freed the outgoing model's GPU resources — geometries, materials, textures all leaked on every single swap. Also, the ambient grid's rebuild-on-theme-change was calling a `.dispose()` that silently didn't exist on that object type, so every color cycle leaked too. Both fixed — matters most exactly for what you're doing right now (testing lots of uploads back to back).
- **Audio failures no longer masquerade as camera failures**: if sound initialization ever threw for any reason, it was caught by the same error handler as camera permission failures, so you'd see "Camera access failed" even though the camera worked fine. Audio failures are now isolated — the app just continues without sound.

**Tracking accuracy — the "mis-understanding" fix**
- Finger extension used to be judged by comparing distances from the wrist, which is sensitive to how your hand is angled toward the camera — tilt your hand and a curled finger could read as extended. It's now judged by the actual joint bend angle (using the hand's full 3D landmark data), which stays accurate across a much wider range of hand orientations.
- Pinch detection now has hysteresis: a lower threshold to *start* a pinch and a higher one to *release* it, so it no longer flickers on/off when your fingers hover near the boundary distance.
- Hold-to-fire gestures (fist, two-fist, peace) now tolerate a couple of single-frame misreads without cancelling — one noisy camera frame won't reset a gesture you're still actively holding, while a genuinely broken hold still resets properly.
- Pinch/hand-scale math now uses full 3D distance (previously 2D-only), which is more robust when your hand isn't facing the camera dead-on.

**Four new single-hand gestures**
- ✌️ Peace sign, held — toggle between the hologram skin and a dropped model's original materials (with proper 3-point lighting). Built-ins and geometry-only formats (STL/PLY) don't have "native" materials, so it'll tell you that instead of silently doing nothing.
- 🤟 Rock sign, tap — toggle fullscreen, one-handed.
- 🤙 Shaka, tap — toggle mute, one-handed.
- Three fingers, held — save a screenshot, one-handed.

**Color cycling moved to keyboard-only**
- The thumb up/down tap gesture for color cycling has been removed — it's now `C` (next) / `Shift+C` (previous) only. This also frees up the thumb-only pose so it can't be misread from an incidental hand position.

**Fist now brakes instantly**
- Making a fist used to do nothing until you'd held it for ~0.7s (the reset trigger). Now it acts as an instant grab-and-stop — the moment you fist, any spinning/panning momentum halts immediately, exactly like grabbing a spinning object to still it. Keep holding the fist and it still resets after ~0.7s, same as before — the instant stop and the delayed reset are two stages of the same gesture.**Held gestures now require actual stillness**
- Raising or moving your hand into frame could pass through a pose's shape for a moment — e.g. the peace sign, since middle and index often straighten before ring and pinky do — and with the hold timer's jitter tolerance, that was enough to accidentally fire reset/native-toggle/screenshot on a hand that was never actually held there on purpose. Reset, full reset, native-materials toggle, and screenshot now only accumulate hold-time while the hand's position is genuinely still; a hand in motion can't trigger them no matter what shape it passes through. (The instant fist-brake above is deliberately exempt from this — a grab-to-stop should work even while your hand is still settling into place.)

**Reliability & persistence (previous pass)**
- A calibration step now runs automatically on first launch — no more guessing at `PINCH_THRESHOLD`.
- Hand/face detection is throttled to a fixed rate independent of the render loop, so a slower machine's ML inference never stalls the 3D scene — the model keeps spinning smoothly even if gesture tracking updates a bit less often.
- Calibration and your last color theme are remembered locally between sessions.

**More gestures**
- Double-pinch "ping" (particle burst)
- Vertical swipe (HUD toggle)
- Thumb up/down tap (color cycling)
- Two-hand fist hold (full reset, distinct from the single-hand reset)

**Color & visuals**
- Five color themes (Cyan, Amber, Violet, Emerald, Crimson), cycled by gesture or keyboard, applied consistently across the hologram material, wireframe edges, orbiting rings, and the entire HUD.
- Eased reset animation instead of an instant snap.
- Pan now has momentum, matching rotation.
- The ambient rings speed up as you spin the hologram faster.
- A particle burst effect on double-pinch.
- Idle ambient auto-rotation when no hand has been visible for a couple of seconds, so the scene never feels static.

**More file format support**
- Added `.obj`, `.fbx`, `.stl`, `.ply` on top of the existing `.glb`/`.3mf` support.
- Every dropped model gets the same hologram treatment (fresnel glow + wireframe edges) regardless of format, so nothing looks out of place next to the built-in shapes.
- High-poly drops automatically skip the wireframe overlay (with a toast telling you why) to protect frame rate — the fresnel fill still renders.
- Two more built-in shapes (Helix Coil, Orb) alongside the original three.

**Audio**
- A soft ambient hum plus short cues for grabbing, releasing, switching models, cycling color, ping, and reset — all mutable with one click/key.

**Quality of life**
- Toast notifications confirm every gesture-triggered action.
- FPS counter and live pinch-distance readout in the status panel, for tuning.
- Screenshot and fullscreen support.
- Full in-app help reference (`?`).
- Visual highlight on the canvas edge while dragging a file over the page.

## Tuning

`config.js` holds every sensitivity number, all commented:
- `ROTATE_SENSITIVITY` / `PAN_SENSITIVITY` / `SCALE_MIN` / `SCALE_MAX`
- `TWO_HAND_ROTATE_SENSITIVITY` — how much model tumble per radian of hand-angle change in the two-hand steering gesture.
- `PINCH_THRESHOLD` — set automatically by calibration; only hand-edit to fine-tune afterward.
- `PINCH_ENGAGE_RATIO` — the hysteresis band. Lower = pinch needs to close tighter before it registers, but once registered it stays held more loosely.
- `FINGER_STRAIGHT_ANGLE_DEG` / `THUMB_STRAIGHT_ANGLE_DEG` — the joint-bend angle a finger needs to exceed to count as extended. Raise if fingers register as extended too easily; lower if genuinely straight fingers aren't registering.
- `HOLD_MISS_TOLERANCE` — how many consecutive off-frames a held gesture (fist, peace, etc.) tolerates before the hold timer resets.
- `HOLD_STILLNESS_MAX_VELOCITY` — how much hand movement is tolerated while accumulating a hold (reset/native-toggle/screenshot). Raise it if deliberate holds aren't registering because your hand naturally drifts a little; lower it if a moving hand is still accidentally triggering them.
- `INERTIA_DAMPING` / `PAN_INERTIA_DAMPING` — closer to 1.0 = spins/pans longer after release.
- `DETECTION_INTERVAL_MS` — lower = more responsive tracking but more CPU/GPU load; raise if you need more headroom on a slower machine.
- `MAX_EDGE_TRIANGLES` — the high-poly safeguard threshold for dropped models.
- `DOUBLE_PINCH_WINDOW` — how fast a pinch-release-pinch needs to be to count as a ping.

`config.js` also exports `THEMES` — add your own `{ name, core, dim, glow }` entries to extend the color cycle.

## Architecture

- `gestures.js` — pure gesture math and the `GestureEngine` state machine (every pose classification and event: rotate, scale, pan, swipe (both axes), reset, full reset, color cycle, ping). No Three.js or MediaPipe imports, so it's fully unit-testable.
- `test_gestures.mjs` — Node test suite, 58 checks across every gesture, pose classification, hysteresis, jitter-tolerance, stillness-gating, hand-identity stability, and orientation tracking. Run with `node test_gestures.mjs`.
- `hand_input.js` — thin wrapper around MediaPipe Tasks Vision (`HandLandmarker`) and `getUserMedia`.
- `audio.js` — `HoloAudio` class: ambient hum + short WebAudio-synthesized cues, single mute switch.
- `main.js` — Three.js scene (holographic fresnel material, bloom, ambient rings, particle system), the six file-format loaders, the color theme system, calibration/help/toolbar wiring, and the per-frame loop that ties gesture events to the 3D transform.
- `config.js` — every tunable number and the color theme list, in one place.

## Extending it

- **Add a gesture**: extend `classifyHandPose()` or `GestureEngine.update()` in `gestures.js`, add a test case in `test_gestures.mjs`, then wire the new event in `main.js`'s `animate()`.
- **Add a built-in model**: add an entry to `MODEL_DEFS` in `main.js` — any Three.js `BufferGeometry` works.
- **Add a color theme**: add an entry to the `THEMES` array in `config.js`.
- **Add a file format**: three.js ships loaders for most formats under `three/addons/loaders/` — follow the pattern of the existing six in `loadDroppedFile()`.

## Troubleshooting

- **Worn model doesn't quite sit on your hand, or rotation feels laggy**: `WEAR_FOLLOW_LERP` and `WEAR_ROTATE_SLERP` near the top of `main.js` control how quickly position and rotation catch up to your hand — raise either for snappier tracking. If it's consistently offset in one direction rather than lagging, that's more likely a camera resolution/aspect mismatch than a lerp issue — check what resolution `hand_input.js` requests (`640x480` by default) against your actual webcam and screen.
- **Worn model's rotation looks wrong/flipped**: the orientation estimate is built from the wrist and index/middle/pinky knuckles, and assumes those are visible and roughly in their normal relative positions — a fist or a hand mostly out of frame won't give it much to work with. This is a visual approximation (MediaPipe's depth data is noisy), not precision tracking, so some jitter or imperfect alignment at extreme angles is expected.

- **Things trigger just from raising/moving my hand**: lower `HOLD_STILLNESS_MAX_VELOCITY` in `config.js` — your hand may be moving slower than the default threshold expects during the motion you're doing.

- **"Camera access failed"**: you're probably opening the file directly (`file://`) instead of via `http://localhost`.
- **Pinch/rotate won't trigger**: re-run calibration — hold a genuine pinch the whole time the calibration screen is up. Watch the "PINCH DIST" readout in the status panel; it should drop well below the threshold shown when you actually pinch.
- **Choppy tracking**: `HandLandmarker` uses `delegate: "GPU"` in `hand_input.js` — try `"CPU"` if your browser/GPU combo struggles. Also try raising `DETECTION_INTERVAL_MS` in `config.js`.
- **Low FPS on a dropped model**: check the toast — if it says the wireframe was skipped, the model is just very high-poly; that's expected behavior to protect frame rate, not a bug.
- **Dropped file doesn't load**: check the toast and the status line at the bottom — the actual parser error message now shows directly there instead of just "check console." For `.gltf`, only self-contained files work (buffers/images embedded as data URIs) — a `.gltf` split across a separate `.bin`/texture files can't be resolved from a single dropped file; use `.glb` instead if you have the option when exporting.
- **`.glb` file fails to parse**: as of this build, Draco and Meshopt mesh compression are both supported (common export optimizations that previously weren't wired up and would cause an otherwise-valid `.glb` to fail outright).
- **`.3mf` file fails or seems stuck**: large 3MF files (common from 3D-printing slicers, which often embed thumbnails and per-object metadata) can take a few seconds to unzip and parse — the status line will read "LOADING…" the whole time, so give it a moment before assuming it's failed. If it does fail, check whether the file is a full slicer *project* file (multi-plate, with embedded print settings) rather than a plain model export — those sometimes use extensions the base 3MF loader doesn't expect. Re-exporting just the mesh as `.3mf`, or as `.obj`/`.stl` instead, usually resolves it.
- **Multiple files dropped at once**: only the first file is used — a toast tells you which one. This matters for formats split across multiple files (e.g. `.obj` + `.mtl` + textures), which aren't supported as a set; only self-contained single-file formats work via drag-and-drop here.
- **No sound**: click 🔊/press `M` to check mute state; some browsers also require a page click before any audio plays at all (browser autoplay policy) — the ENGAGE button click satisfies this.
