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
| Quick double-pinch (pinch, release, pinch again fast) | Ping — particle burst |
| Open palm, fast horizontal swipe | Cycle to next/previous model |
| Open palm, fast vertical swipe | Show/hide the HUD panels |
| Thumb up, tap | Next color theme |
| Thumb down, tap | Previous color theme |
| Fist, held ~0.7s | Reset view (rotation/scale/pan) |
| Both hands as fists, held ~0.7s | Full reset — view, color, and model all back to default |

**Files** — drop any of these onto the page: `.glb`, `.3mf`, `.obj`, `.fbx`, `.stl`, `.ply`

**Keyboard**
| Key | Action |
|---|---|
| `?` | Toggle the full controls reference |
| `S` | Save a screenshot |
| `F` | Toggle fullscreen |
| `M` | Toggle sound |
| `C` | Cycle color theme |
| `R` | Reset view |

The toolbar top-right (🔊 ⛶ 📷 ?) does the same things with clicks.

## What's new in this pass

**Reliability**
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
- `PINCH_THRESHOLD` — set automatically by calibration; only hand-edit to fine-tune afterward.
- `INERTIA_DAMPING` / `PAN_INERTIA_DAMPING` — closer to 1.0 = spins/pans longer after release.
- `DETECTION_INTERVAL_MS` — lower = more responsive tracking but more CPU/GPU load; raise if you need more headroom on a slower machine.
- `MAX_EDGE_TRIANGLES` — the high-poly safeguard threshold for dropped models.
- `DOUBLE_PINCH_WINDOW` — how fast a pinch-release-pinch needs to be to count as a ping.

`config.js` also exports `THEMES` — add your own `{ name, core, dim, glow }` entries to extend the color cycle.

## Architecture

- `gestures.js` — pure gesture math and the `GestureEngine` state machine (every pose classification and event: rotate, scale, pan, swipe (both axes), reset, full reset, color cycle, ping). No Three.js or MediaPipe imports, so it's fully unit-testable.
- `test_gestures.mjs` — Node test suite, 24 checks across every gesture. Run with `node test_gestures.mjs`.
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

- **"Camera access failed"**: you're probably opening the file directly (`file://`) instead of via `http://localhost`.
- **Pinch/rotate won't trigger**: re-run calibration — hold a genuine pinch the whole time the calibration screen is up. Watch the "PINCH DIST" readout in the status panel; it should drop well below the threshold shown when you actually pinch.
- **Choppy tracking**: `HandLandmarker` uses `delegate: "GPU"` in `hand_input.js` — try `"CPU"` if your browser/GPU combo struggles. Also try raising `DETECTION_INTERVAL_MS` in `config.js`.
- **Low FPS on a dropped model**: check the toast — if it says the wireframe was skipped, the model is just very high-poly; that's expected behavior to protect frame rate, not a bug.
- **Dropped file doesn't load**: only binary glTF (`.glb`) is supported for glTF, not a loose `.gltf` + textures folder. Check the browser console (F12) for the specific parser error.
- **No sound**: click 🔊/press `M` to check mute state; some browsers also require a page click before any audio plays at all (browser autoplay policy) — the ENGAGE button click satisfies this.
