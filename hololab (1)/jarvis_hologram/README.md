# HOLOLAB — gesture-controlled hologram

A Jarvis-style interface: a floating 3D hologram you rotate, scale, and pan
with pinched fingers in the air, tracked live through your webcam. Runs
entirely in the browser — nothing to install beyond a local server to serve
the files (needed because camera access requires a "secure" origin, which
`http://localhost` counts as but a plain double-clicked file does not).

## Run it

You need Python (already required for the air_control project) or Node —
either works, just to serve static files:

```
# from inside this folder
python -m http.server 8000
```
or
```
npx serve .
```

Then open **http://localhost:8000** in Chrome or Edge (best WebGL + MediaPipe
support) and click **ENGAGE**. Allow camera access when prompted.

## Controls

| Gesture | Effect |
|---|---|
| One hand, pinch thumb+index, move | Rotate the hologram (spins on release, with momentum) |
| Two hands, both pinched, spread apart/together | Scale up/down |
| Two hands, both pinched, move together | Pan the hologram in space |
| Open palm, fast horizontal swipe | Cycle to the next model |
| Fist, held ~0.7s | Snap back to the default view |
| Drop a `.glb` or `.3mf` file onto the page | Load your own model in place of the built-in ones |

The small camera preview bottom-right is just for your own reference — hand
tracking runs on the full feed regardless of whether you can see yourself.

## Tuning

`config.js` holds every sensitivity number:
- `ROTATE_SENSITIVITY` / `PAN_SENSITIVITY` / `SCALE_MIN` / `SCALE_MAX` — how far a given hand movement goes.
- `PINCH_THRESHOLD` — how close thumb+index need to get to register as a pinch. Lower = stricter.
- `INERTIA_DAMPING` — closer to 1.0 makes the hologram spin longer after you let go.
- `SWIPE_MIN_VELOCITY` — how fast an open-palm swipe needs to be to register.

## Architecture

- `gestures.js` — pure gesture math and the `GestureEngine` state machine (pinch/pose classification, rotate/scale/pan/swipe/reset event detection). No Three.js or MediaPipe imports, so it's testable on its own.
- `test_gestures.mjs` — Node test suite for the above, using synthetic hand landmark data. Run with `node test_gestures.mjs`.
- `hand_input.js` — thin wrapper around MediaPipe Tasks Vision (`HandLandmarker`) and `getUserMedia`. Only file that talks to the camera/ML model.
- `main.js` — Three.js scene: holographic fresnel-shader material, bloom postprocessing, the ambient orbiting rings, GLTF drag-and-drop loading, and the per-frame loop that wires gesture events to the 3D transform.
- `config.js` — every tunable number in one place.

## Extending it

- **Add a gesture**: extend `classifyHandPose()` or `GestureEngine.update()` in `gestures.js`, add a test case in `test_gestures.mjs`, then wire the new event in `main.js`'s `animate()`.
- **Add a built-in model**: add an entry to `MODEL_DEFS` in `main.js` — any Three.js `BufferGeometry` works with the existing fresnel + edge-wireframe look.
- **Swap the aesthetic**: colors are all defined once in `style.css` (`:root` variables) and as `COLOR_*` constants at the top of `main.js` — no need to hunt through the rest of the file.

## Troubleshooting

- **"Camera access failed"**: you're probably opening the file directly (`file://`) instead of via `http://localhost` — browsers block camera access on file URLs. Use the local server step above.
- **Choppy tracking**: `HandLandmarker` is set to `delegate: "GPU"` — if your browser/GPU combo doesn't support that well, try changing it to `"CPU"` in `hand_input.js` (slower but more compatible).
- **Rotation feels backwards/too fast**: tweak `ROTATE_SENSITIVITY` in `config.js`, or flip its sign if the mirroring feels unintuitive for your setup.
- **Dropped `.glb`/`.3mf` doesn't load**: for `.glb`, only binary glTF (single file) is supported — a `.gltf` + separate texture files needs a small change to load as a file set instead of one buffer. For `.3mf`, models often carry their own materials/colors rather than the holographic fresnel look — that's expected, since it's rendered with whatever material the file specifies.
