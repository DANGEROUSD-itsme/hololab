// main.js
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";

import { CONFIG } from "./config.js";
import { classifyHandPose, GestureEngine } from "./gestures.js";
import { HandInput } from "./hand_input.js";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas = document.getElementById("scene");
const videoEl = document.getElementById("cam");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const camState = document.getElementById("camState");
const trackState = document.getElementById("trackState");
const handCountEl = document.getElementById("handCount");
const modeStateEl = document.getElementById("modeState");
const telemetryEl = document.getElementById("telemetryText");

const reticles = [makeDot("reticle"), makeDot("reticle")];
const trackDots = [makeDot("trackdot"), makeDot("trackdot")];
const pinchDebugEl = document.getElementById("pinchDebug");
function makeDot(className) {
  const el = document.createElement("div");
  el.className = className;
  document.getElementById("hud").appendChild(el);
  return el;
}

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const COLOR_CORE = 0x5fe1f2;
const COLOR_DIM = 0x163542;
const COLOR_VOID = 0x050a12;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(COLOR_VOID, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(COLOR_VOID, 0.045);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.6, 6);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(COLOR_CORE, 0.15));
const rim = new THREE.PointLight(COLOR_CORE, 2.0, 20);
rim.position.set(3, 3, 4);
scene.add(rim);

// -- floor grid --
const grid = new THREE.GridHelper(20, 40, COLOR_CORE, COLOR_DIM);
grid.position.y = -1.8;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

// -- bloom postprocessing --
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.9,   // strength
  0.6,   // radius
  0.15   // threshold
);
composer.addPass(bloomPass);

// ---------------------------------------------------------------------------
// Holographic material
// ---------------------------------------------------------------------------
function makeFresnelMaterial(colorHex) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: 1.0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.2);
        float alpha = clamp(fresnel * uIntensity, 0.0, 1.0);
        gl_FragColor = vec4(uColor * (0.6 + fresnel * 0.8), alpha * 0.85);
      }
    `,
  });
}

const edgeMaterial = new THREE.LineBasicMaterial({ color: COLOR_CORE, transparent: true, opacity: 0.55 });

// ---------------------------------------------------------------------------
// Model set (cyclable) + the group gestures act on
// ---------------------------------------------------------------------------
const modelGroup = new THREE.Group();
scene.add(modelGroup);

function buildModelMesh(geometry) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(geometry, makeFresnelMaterial(COLOR_CORE));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), edgeMaterial);
  g.add(fill, edges);
  return g;
}

const MODEL_DEFS = [
  { name: "ARC LATTICE", build: () => buildModelMesh(new THREE.IcosahedronGeometry(1.15, 1)) },
  { name: "KNOT CORE", build: () => buildModelMesh(new THREE.TorusKnotGeometry(0.75, 0.24, 90, 12)) },
  { name: "DODEC FRAME", build: () => buildModelMesh(new THREE.DodecahedronGeometry(1.2, 0)) },
];
let modelIndex = 0;
let currentMesh = null;
let customModelLoaded = false;

function loadBuiltinModel(index) {
  if (currentMesh) modelGroup.remove(currentMesh);
  customModelLoaded = false;
  modelIndex = ((index % MODEL_DEFS.length) + MODEL_DEFS.length) % MODEL_DEFS.length;
  currentMesh = MODEL_DEFS[modelIndex].build();
  modelGroup.add(currentMesh);
  telemetryEl.textContent = `MODEL: ${MODEL_DEFS[modelIndex].name}`;
}
loadBuiltinModel(0);

// -- ambient orbiting rings, the "Jarvis" signature element --
const ringGroup = new THREE.Group();
[1.7, 2.05, 2.35].forEach((radius, i) => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.006, 8, 96),
    new THREE.MeshBasicMaterial({ color: COLOR_CORE, transparent: true, opacity: 0.22 - i * 0.04 })
  );
  ring.rotation.x = Math.PI / 2 + i * 0.6;
  ring.rotation.y = i * 0.9;
  ring.userData.spin = 0.08 + i * 0.05;
  ringGroup.add(ring);
});
scene.add(ringGroup);

// ---------------------------------------------------------------------------
// Drag-and-drop model loading (.glb and .3mf)
// ---------------------------------------------------------------------------
const gltfLoader = new GLTFLoader();
const threeMFLoader = new ThreeMFLoader();

function placeLoadedObject(obj, label) {
  if (currentMesh) modelGroup.remove(currentMesh);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = 2.2 / maxDim;
  obj.scale.setScalar(scale);
  const center = new THREE.Vector3();
  box.getCenter(center);
  obj.position.sub(center.multiplyScalar(scale));
  currentMesh = obj;
  customModelLoaded = true;
  modelGroup.add(currentMesh);
  telemetryEl.textContent = `MODEL: ${label}`;
}

window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  const name = file ? file.name.toLowerCase() : "";
  if (!file || (!name.endsWith(".glb") && !name.endsWith(".3mf"))) {
    telemetryEl.textContent = "DROP FAILED: only .glb or .3mf files are supported";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (name.endsWith(".glb")) {
        gltfLoader.parse(reader.result, "", (gltf) => {
          placeLoadedObject(gltf.scene, file.name);
        }, (err) => {
          telemetryEl.textContent = "FAILED TO LOAD .glb — check console";
          console.error(err);
        });
      } else {
        // ThreeMFLoader.parse is synchronous and returns a Group directly
        const obj = threeMFLoader.parse(reader.result);
        placeLoadedObject(obj, file.name);
      }
    } catch (err) {
      telemetryEl.textContent = `FAILED TO LOAD ${name.endsWith(".3mf") ? ".3mf" : ".glb"} — check console`;
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
});

// ---------------------------------------------------------------------------
// Transform state driven by gestures
// ---------------------------------------------------------------------------
let angularVel = { x: 0, y: 0 };
let modelScale = 1.0;
let modelPos = { x: 0, y: 0 };
let resetCooldownUntil = 0;

function applyReset() {
  angularVel = { x: 0, y: 0 };
  modelScale = 1.0;
  modelPos = { x: 0, y: 0 };
  modelGroup.rotation.set(0, 0, 0);
}

// ---------------------------------------------------------------------------
// Gesture engine + hand input
// ---------------------------------------------------------------------------
const gestureEngine = new GestureEngine(CONFIG);
const handInput = new HandInput({ videoElement: videoEl, maxHands: 2 });

async function engage() {
  startBtn.disabled = true;
  startBtn.textContent = "CONNECTING…";
  try {
    camState.textContent = "REQUESTING";
    camState.className = "val val--pending";
    await handInput.init();
    camState.textContent = "ONLINE";
    camState.className = "val val--good";
    trackState.textContent = "ACTIVE";
    trackState.className = "val val--good";
    startOverlay.classList.add("hidden");
    telemetryEl.textContent = "TRACKING ACTIVE — pinch to grab the hologram";
  } catch (err) {
    console.error(err);
    camState.textContent = "DENIED";
    camState.className = "val val--warn";
    startBtn.disabled = false;
    startBtn.textContent = "RETRY";
    let msg = document.querySelector(".start-box .error");
    if (!msg) {
      msg = document.createElement("div");
      msg.className = "error";
      document.querySelector(".start-box").appendChild(msg);
    }
    msg.textContent = "Camera access failed. Check browser permissions and that you're on http://localhost or https://.";
  }
}
startBtn.addEventListener("click", engage);

// ---------------------------------------------------------------------------
// Per-frame loop
// ---------------------------------------------------------------------------
function mirrorLandmarks(hand) {
  return hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

function updateReticles(poses) {
  // track dot: shown for every currently-tracked hand, pinching or not,
  // so you can confirm hand tracking is alive even before a pinch registers.
  trackDots.forEach((el, i) => {
    const p = poses[i];
    if (!p) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = `${p.pinchPoint.x * window.innerWidth}px`;
    el.style.top = `${p.pinchPoint.y * window.innerHeight}px`;
  });

  // bright reticle: only for hands that have actually crossed the pinch threshold
  const pinching = poses.filter((p) => p.pinching);
  reticles.forEach((el, i) => {
    const p = pinching[i];
    if (!p) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = `${p.pinchPoint.x * window.innerWidth}px`;
    el.style.top = `${p.pinchPoint.y * window.innerHeight}px`;
  });

  // live numeric readout so the threshold can be tuned from real numbers
  if (poses.length > 0) {
    const readings = poses.map((p) => p.pinchDist.toFixed(3)).join(" / ");
    pinchDebugEl.textContent = `${readings} (need < ${CONFIG.PINCH_THRESHOLD})`;
    pinchDebugEl.className = poses.some((p) => p.pinching) ? "val val--good" : "val";
  } else {
    pinchDebugEl.textContent = "—";
    pinchDebugEl.className = "val val--pending";
  }
}

let lastTelemetryMode = "";

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now() / 1000;

  // ambient ring spin (always running, independent of gestures)
  ringGroup.children.forEach((ring) => { ring.rotation.z += 0.0025 * ring.userData.spin; });
  ringGroup.rotation.y += 0.0015;

  let poses = [];
  if (handInput.landmarker) {
    const hands = handInput.detect().map(mirrorLandmarks);
    poses = hands.map((lm) => classifyHandPose(lm, CONFIG));

    handCountEl.textContent = String(hands.length);
    updateReticles(poses);

    const events = gestureEngine.update(poses, now);

    if (events.rotateDelta) {
      angularVel = { x: events.rotateDelta.dy, y: events.rotateDelta.dx };
    }
    if (events.scale !== null) {
      modelScale = Math.min(CONFIG.SCALE_MAX, Math.max(CONFIG.SCALE_MIN, modelScale * events.scale));
    }
    if (events.pan) {
      modelPos.x = Math.max(-2.5, Math.min(2.5, modelPos.x + events.pan.dx));
      modelPos.y = Math.max(-1.5, Math.min(1.5, modelPos.y - events.pan.dy));
    }
    if (events.swipe) {
      loadBuiltinModel(modelIndex + (events.swipe === "right" ? 1 : -1));
    }
    if (events.reset && now > resetCooldownUntil) {
      applyReset();
      resetCooldownUntil = now + 1.0;
      telemetryEl.textContent = "VIEW RESET";
    }

    if (events.mode !== lastTelemetryMode) {
      modeStateEl.textContent = events.mode.toUpperCase();
      lastTelemetryMode = events.mode;
      if (events.mode === "rotate") telemetryEl.textContent = "ROTATING HOLOGRAM";
      else if (events.mode === "scale_pan") telemetryEl.textContent = "SCALE / PAN";
      else telemetryEl.textContent = "TRACKING ACTIVE — pinch to grab the hologram";
    }

    // pulse intensity on the fresnel material while any hand is pinching
    const anyPinch = poses.some((p) => p.pinching);
    if (currentMesh && !customModelLoaded) {
      currentMesh.children[0].material.uniforms.uIntensity.value = anyPinch ? 1.6 : 1.0;
    }
  } else {
    reticles.forEach((el) => (el.style.display = "none"));
  }

  // apply rotation (active or inertial)
  modelGroup.rotation.y += angularVel.y;
  modelGroup.rotation.x += angularVel.x;
  if (!poses.some((p) => p.pinching)) {
    angularVel.x *= CONFIG.INERTIA_DAMPING;
    angularVel.y *= CONFIG.INERTIA_DAMPING;
    if (Math.hypot(angularVel.x, angularVel.y) < CONFIG.INERTIA_MIN_VELOCITY) angularVel = { x: 0, y: 0 };
  }

  modelGroup.scale.setScalar(modelScale);
  modelGroup.position.x += (modelPos.x - modelGroup.position.x) * 0.25;
  modelGroup.position.y += (modelPos.y - modelGroup.position.y) * 0.25;

  composer.render();
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
