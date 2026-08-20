// main.js
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { ThreeMFLoader } from "three/addons/loaders/3MFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";

import { CONFIG, THEMES } from "./config.js";
import { classifyHandPose, GestureEngine } from "./gestures.js";
import { HandInput } from "./hand_input.js";
import { HoloAudio } from "./audio.js";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const canvas = document.getElementById("scene");
const videoEl = document.getElementById("cam");
const startOverlay = document.getElementById("startOverlay");
const startBtn = document.getElementById("startBtn");
const calibrateOverlay = document.getElementById("calibrateOverlay");
const calibValue = document.getElementById("calibValue");
const calibDoneBtn = document.getElementById("calibDoneBtn");
const calibSkipBtn = document.getElementById("calibSkipBtn");
const helpOverlay = document.getElementById("helpOverlay");
const helpBtn = document.getElementById("helpBtn");
const helpCloseBtn = document.getElementById("helpCloseBtn");
const muteBtn = document.getElementById("muteBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const screenshotBtn = document.getElementById("screenshotBtn");
const camState = document.getElementById("camState");
const trackState = document.getElementById("trackState");
const handCountEl = document.getElementById("handCount");
const modeStateEl = document.getElementById("modeState");
const themeStateEl = document.getElementById("themeState");
const fpsStateEl = document.getElementById("fpsState");
const pinchDebugEl = document.getElementById("pinchDebug");
const telemetryEl = document.getElementById("telemetryText");
const toastContainer = document.getElementById("toastContainer");
const statusPanel = document.getElementById("statusPanel");
const legendPanel = document.querySelector(".legend");

function makeDot(className) {
  const el = document.createElement("div");
  el.className = className;
  document.getElementById("hud").appendChild(el);
  return el;
}
const reticles = [makeDot("reticle"), makeDot("reticle")];
const trackDots = [makeDot("trackdot"), makeDot("trackdot")];

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  toastContainer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 250);
  }, 1600);
}

// ---------------------------------------------------------------------------
// LocalStorage persistence (this is a locally-served page, not a sandboxed
// artifact, so storage persisting between sessions is expected/desired here)
// ---------------------------------------------------------------------------
const STORAGE_KEY = "hololab-prefs-v1";
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(patch) {
  try {
    const prefs = { ...loadPrefs(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable - not fatal */
  }
}
const prefs = loadPrefs();
if (typeof prefs.pinchThreshold === "number") {
  CONFIG.PINCH_THRESHOLD = prefs.pinchThreshold;
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------
const audio = new HoloAudio();
function updateMuteBtn() {
  muteBtn.textContent = audio.muted ? "🔇" : "🔊";
}
updateMuteBtn();

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
let fogRef = new THREE.FogExp2(0x050a12, 0.045);
scene.fog = fogRef;

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0.6, 6);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.15);
scene.add(ambientLight);
const rimLight = new THREE.PointLight(0xffffff, 2.0, 20);
rimLight.position.set(3, 3, 4);
scene.add(rimLight);
// extra lighting used only in "native materials" mode for dropped models
const keyLight = new THREE.DirectionalLight(0xffffff, 0.0);
keyLight.position.set(-3, 4, 5);
scene.add(keyLight);
const fillLight = new THREE.HemisphereLight(0xffffff, 0x222233, 0.0);
scene.add(fillLight);

let grid = null;
function rebuildGrid(colorHex, dimHex) {
  if (grid) { scene.remove(grid); grid.dispose?.(); }
  grid = new THREE.GridHelper(20, 40, colorHex, dimHex);
  grid.position.y = -1.8;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.9, 0.6, 0.15
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

let edgeMaterial = new THREE.LineBasicMaterial({ color: THEMES[0].core, transparent: true, opacity: 0.55 });

function triangleCount(geometry) {
  if (geometry.index) return geometry.index.count / 3;
  return (geometry.attributes.position?.count || 0) / 3;
}

// ---------------------------------------------------------------------------
// Theme system
// ---------------------------------------------------------------------------
let themeIndex = typeof prefs.themeIndex === "number" ? prefs.themeIndex % THEMES.length : 0;
let currentFresnelMaterials = []; // materials to recolor + pulse on grab
let nativeMode = false; // true when a dropped model keeps its own materials
// Materials as originally loaded from a dropped scene-graph model (glb/3mf/obj/fbx),
// kept so "native mode" can restore them. null for built-ins and geometry-only
// formats (stl/ply), which never had original materials to begin with.
// (declared early, before loadBuiltinModel(0) is called below, to avoid a
// temporal-dead-zone reference error)
let currentOriginalMaterials = null;

function applyThemeVisuals() {
  const t = THEMES[themeIndex];
  document.documentElement.style.setProperty("--cyan-core", `#${t.core.toString(16).padStart(6, "0")}`);
  document.documentElement.style.setProperty("--cyan-dim", `#${t.dim.toString(16).padStart(6, "0")}`);
  document.documentElement.style.setProperty("--cyan-glow", t.glow);

  currentFresnelMaterials.forEach((m) => m.uniforms.uColor.value.set(t.core));
  edgeMaterial.color.set(t.core);
  ringGroup.children.forEach((ring) => ring.material.color.set(t.core));
  rebuildGrid(t.core, t.dim);

  themeStateEl.textContent = nativeMode ? `${t.name} (native)` : t.name;
}

function cycleTheme(direction) {
  themeIndex = (themeIndex + (direction === "down" ? -1 : 1) + THEMES.length) % THEMES.length;
  applyThemeVisuals();
  savePrefs({ themeIndex });
  audio.chime();
  toast(`THEME: ${THEMES[themeIndex].name}`);
}

// ---------------------------------------------------------------------------
// Model set (cyclable) + the group gestures act on
// ---------------------------------------------------------------------------
const modelGroup = new THREE.Group();
scene.add(modelGroup);

function buildModelMesh(geometry) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(geometry, makeFresnelMaterial(THEMES[themeIndex].core));
  g.add(fill);
  if (triangleCount(geometry) <= CONFIG.MAX_EDGE_TRIANGLES) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), edgeMaterial);
    g.add(edges);
  }
  return g;
}

function helixGeometry() {
  const points = [];
  const turns = 4, pointsPerTurn = 24, radius = 0.9, height = 1.8;
  for (let i = 0; i <= turns * pointsPerTurn; i++) {
    const t = i / pointsPerTurn;
    const angle = t * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, (t / turns) * height - height / 2, Math.sin(angle) * radius));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, 200, 0.045, 8, false);
}

const MODEL_DEFS = [
  { name: "ARC LATTICE", build: () => buildModelMesh(new THREE.IcosahedronGeometry(1.15, 1)) },
  { name: "KNOT CORE", build: () => buildModelMesh(new THREE.TorusKnotGeometry(0.75, 0.24, 90, 12)) },
  { name: "DODEC FRAME", build: () => buildModelMesh(new THREE.DodecahedronGeometry(1.2, 0)) },
  { name: "HELIX COIL", build: () => buildModelMesh(helixGeometry()) },
  { name: "ORB", build: () => buildModelMesh(new THREE.IcosahedronGeometry(1.1, 3)) },
];
let modelIndex = 0;
let currentMesh = null;

function loadBuiltinModel(index) {
  if (currentMesh) modelGroup.remove(currentMesh);
  nativeMode = false;
  currentOriginalMaterials = null;
  keyLight.intensity = 0;
  fillLight.intensity = 0;
  ambientLight.intensity = 0.15;
  rimLight.intensity = 2.0;
  modelIndex = ((index % MODEL_DEFS.length) + MODEL_DEFS.length) % MODEL_DEFS.length;
  currentMesh = MODEL_DEFS[modelIndex].build();
  currentFresnelMaterials = [currentMesh.children[0].material];
  modelGroup.add(currentMesh);
  applyThemeVisuals();
  telemetryEl.textContent = `MODEL: ${MODEL_DEFS[modelIndex].name}`;
}

// -- ambient orbiting rings, the "Jarvis" signature element --
// (declared before the first loadBuiltinModel call below, since
// applyThemeVisuals() reads ringGroup to recolor them)
const ringGroup = new THREE.Group();
[1.7, 2.05, 2.35].forEach((radius, i) => {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.006, 8, 96),
    new THREE.MeshBasicMaterial({ color: THEMES[themeIndex].core, transparent: true, opacity: 0.22 - i * 0.04 })
  );
  ring.rotation.x = Math.PI / 2 + i * 0.6;
  ring.rotation.y = i * 0.9;
  ring.userData.baseSpin = 0.08 + i * 0.05;
  ringGroup.add(ring);
});
scene.add(ringGroup);

loadBuiltinModel(0);

// ---------------------------------------------------------------------------
// Particle burst ("ping")
// ---------------------------------------------------------------------------
const MAX_PARTICLES = 120;
const particleGeo = new THREE.BufferGeometry();
const particlePositions = new Float32Array(MAX_PARTICLES * 3);
particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particleMat = new THREE.PointsMaterial({ color: THEMES[themeIndex].core, size: 0.05, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const particlePoints = new THREE.Points(particleGeo, particleMat);
scene.add(particlePoints);

let particles = []; // {pos: Vector3, vel: Vector3, born: number}
function spawnPingBurst() {
  const count = 40;
  const origin = modelGroup.position.clone();
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
    const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    particles.push({
      pos: origin.clone(),
      vel: dir.multiplyScalar(1.2 + Math.random() * 1.2),
      born: performance.now() / 1000,
    });
  }
}
function updateParticles(now) {
  const LIFE = 0.9;
  particles = particles.filter((p) => now - p.born < LIFE);
  particleMat.color.set(THEMES[themeIndex].core);
  particleMat.opacity = particles.length > 0 ? 0.9 : 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (i < particles.length) {
      const p = particles[i];
      p.pos.addScaledVector(p.vel, 0.016);
      particlePositions[i * 3] = p.pos.x;
      particlePositions[i * 3 + 1] = p.pos.y;
      particlePositions[i * 3 + 2] = p.pos.z;
    } else {
      particlePositions[i * 3] = 9999;
      particlePositions[i * 3 + 1] = 9999;
      particlePositions[i * 3 + 2] = 9999;
    }
  }
  particleGeo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// GLTF / 3MF / OBJ / FBX / STL / PLY drag-and-drop loading
// ---------------------------------------------------------------------------
const gltfLoader = new GLTFLoader();
// Many real-world .glb/.gltf files ship with Draco or Meshopt mesh
// compression (common export optimizations) - without decoders wired up,
// GLTFLoader just throws and refuses to load, which was very likely the
// actual cause of "uploads not working."
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/");
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const threeMFLoader = new ThreeMFLoader();
const objLoader = new OBJLoader();
const fbxLoader = new FBXLoader();
const stlLoader = new STLLoader();
const plyLoader = new PLYLoader();

function stripEdgeChildren(root) {
  if (!root) return;
  root.traverse((child) => {
    const toRemove = child.children.filter((c) => c.isLineSegments);
    toRemove.forEach((c) => { child.remove(c); c.geometry.dispose(); });
  });
}

function applyHologramSkin(root) {
  let totalTris = 0;
  root.traverse((child) => { if (child.isMesh && child.geometry) totalTris += triangleCount(child.geometry); });
  const addEdges = totalTris <= CONFIG.MAX_EDGE_TRIANGLES;

  const material = makeFresnelMaterial(THEMES[themeIndex].core);
  const skinned = [];
  root.traverse((child) => {
    if (child.isMesh) {
      child.material = material;
      skinned.push(child);
      if (addEdges && child.geometry) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry, 20), edgeMaterial);
        child.add(edges);
      }
    }
  });
  return { materials: [material], addedEdges: addEdges, meshCount: skinned.length, totalTris };
}

// Materials as originally loaded from a dropped scene-graph model - see
// declaration near the top of the file (kept there to avoid a TDZ bug with
// the loadBuiltinModel(0) call that runs before this point in the file).

function setNativeMode(enabled) {
  if (!currentMesh) return;
  if (enabled && !currentOriginalMaterials) {
    toast("NO NATIVE MATERIALS — hologram-only model");
    return;
  }
  nativeMode = enabled;
  stripEdgeChildren(currentMesh);

  if (enabled) {
    currentOriginalMaterials.forEach((mat, mesh) => { mesh.material = mat; });
    currentFresnelMaterials = [];
    keyLight.intensity = 1.4;
    fillLight.intensity = 0.7;
    ambientLight.intensity = 0.5;
    rimLight.intensity = 1.0;
  } else {
    const skin = applyHologramSkin(currentMesh);
    currentFresnelMaterials = skin.materials;
    keyLight.intensity = 0;
    fillLight.intensity = 0;
    ambientLight.intensity = 0.15;
    rimLight.intensity = 2.0;
  }
  applyThemeVisuals();
  toast(enabled ? "NATIVE MATERIALS" : "HOLOGRAM SKIN");
  audio.chime();
}

function placeCustomModel(objectOrGeometry, label, { isGeometry = false } = {}) {
  if (currentMesh) modelGroup.remove(currentMesh);
  keyLight.intensity = 0;
  fillLight.intensity = 0;
  ambientLight.intensity = 0.15;
  rimLight.intensity = 2.0;
  nativeMode = false;
  currentOriginalMaterials = null;

  let obj;
  if (isGeometry) {
    if (!objectOrGeometry.attributes.normal) objectOrGeometry.computeVertexNormals();
    obj = buildModelMesh(objectOrGeometry);
    currentFresnelMaterials = [obj.children[0].material];
  } else {
    obj = objectOrGeometry;
    // capture original materials BEFORE the hologram skin overwrites them,
    // so peace-hold can toggle back to them later
    currentOriginalMaterials = new Map();
    obj.traverse((child) => { if (child.isMesh) currentOriginalMaterials.set(child, child.material); });

    const skin = applyHologramSkin(obj);
    currentFresnelMaterials = skin.materials;
    if (!skin.addedEdges) {
      toast(`${label}: high detail — wireframe skipped for performance`);
    }
  }

  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  const rawMax = Math.max(size.x, size.y, size.z);
  if (!isFinite(rawMax) || rawMax <= 0) {
    toast(`${label}: loaded but appears to contain no visible geometry`);
  }
  const maxDim = isFinite(rawMax) && rawMax > 0 ? rawMax : 1;
  const scale = 2.2 / maxDim;
  obj.scale.setScalar(scale);
  const center = new THREE.Vector3();
  box.getCenter(center);
  if (isFinite(center.x) && isFinite(center.y) && isFinite(center.z)) {
    obj.position.sub(center.multiplyScalar(scale));
  }

  currentMesh = obj;
  modelGroup.add(currentMesh);
  applyThemeVisuals();
  telemetryEl.textContent = `MODEL: ${label}`;
  audio.chime();
  toast(`LOADED: ${label}`);
}

function reportLoadError(label, err) {
  const reason = (err && (err.message || err.toString?.())) || "unknown error";
  const shortReason = reason.length > 60 ? reason.slice(0, 60) + "…" : reason;
  telemetryEl.textContent = `FAILED TO LOAD ${label}: ${shortReason}`;
  toast(`FAILED: ${shortReason}`);
  audio.error();
  console.error(`[HOLOLAB] Failed to load ${label}:`, err);
}

function loadDroppedFile(file) {
  const name = file.name.toLowerCase();
  const ext = name.split(".").pop();
  const SUPPORTED = ["glb", "gltf", "3mf", "obj", "fbx", "stl", "ply"];
  if (!SUPPORTED.includes(ext)) {
    telemetryEl.textContent = `DROP FAILED: unsupported format .${ext || "?"}`;
    toast(`UNSUPPORTED: .${ext || "?"}`);
    audio.error();
    return;
  }

  toast(`LOADING ${file.name}…`);
  telemetryEl.textContent = `LOADING ${file.name}…`;
  const reader = new FileReader();
  reader.onerror = (err) => reportLoadError(file.name, err);

  if (ext === "obj" || ext === "gltf") {
    reader.onload = () => {
      // defer the actual (synchronous, potentially slow) parse to the next
      // tick so the "LOADING…" state has a chance to actually paint first,
      // instead of the parse blocking the main thread immediately
      setTimeout(() => {
        try {
          if (ext === "obj") {
            placeCustomModel(objLoader.parse(reader.result), file.name);
          } else {
            // .gltf (JSON) only works here if it's self-contained (buffers/images
            // embedded as data URIs) - a .gltf split across a separate .bin and
            // texture files can't be resolved from a single dropped file.
            gltfLoader.parse(reader.result, "", (gltf) => placeCustomModel(gltf.scene, file.name),
              (err) => reportLoadError(file.name, err));
          }
        } catch (err) {
          reportLoadError(file.name, err);
        }
      }, 0);
    };
    reader.readAsText(file);
    return;
  }

  reader.onload = () => {
    setTimeout(() => {
      try {
        if (ext === "glb") {
          gltfLoader.parse(reader.result, "", (gltf) => placeCustomModel(gltf.scene, file.name),
            (err) => reportLoadError(file.name, err));
        } else if (ext === "3mf") {
          placeCustomModel(threeMFLoader.parse(reader.result), file.name);
        } else if (ext === "fbx") {
          placeCustomModel(fbxLoader.parse(reader.result, ""), file.name);
        } else if (ext === "stl") {
          placeCustomModel(stlLoader.parse(reader.result), file.name, { isGeometry: true });
        } else if (ext === "ply") {
          placeCustomModel(plyLoader.parse(reader.result), file.name, { isGeometry: true });
        }
      } catch (err) {
        if (ext === "3mf") {
          console.warn("[HOLOLAB] 3MF parse failed. If this is a slicer PROJECT file (multi-plate, "
            + "with embedded print settings) rather than a plain model export, try re-exporting just "
            + "the model/mesh as .3mf, or as .obj/.stl instead.");
        }
        reportLoadError(file.name, err);
      }
    }, 0);
  };
  reader.readAsArrayBuffer(file);
}

let dragDepth = 0;
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; document.body.classList.add("drag-active"); });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) document.body.classList.remove("drag-active"); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("drag-active");
  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;
  if (files.length > 1) {
    toast(`Using ${files[0].name} — only one file at a time is supported`);
  }
  loadDroppedFile(files[0]);
});

// ---------------------------------------------------------------------------
// Transform state driven by gestures (with inertia + eased reset)
// ---------------------------------------------------------------------------
let angularVel = { x: 0, y: 0 };
let panVel = { x: 0, y: 0 };
let modelScale = 1.0;
let modelPos = { x: 0, y: 0 };
let resetCooldownUntil = 0;

let resetTween = null; // {start, duration, fromRot:{x,y}, fromScale, fromPos:{x,y}}
function startResetTween(full) {
  resetTween = {
    start: performance.now() / 1000,
    duration: 0.5,
    fromRot: { x: modelGroup.rotation.x, y: modelGroup.rotation.y },
    fromScale: modelScale,
    fromPos: { x: modelPos.x, y: modelPos.y },
  };
  angularVel = { x: 0, y: 0 };
  panVel = { x: 0, y: 0 };
  if (full) {
    themeIndex = 0;
    loadBuiltinModel(0);
    savePrefs({ themeIndex });
  }
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// ---------------------------------------------------------------------------
// Gesture engine + hand input (with throttled detection for smooth render)
// ---------------------------------------------------------------------------
const gestureEngine = new GestureEngine(CONFIG);
const handInput = new HandInput({ videoElement: videoEl, maxHands: 2 });

let appState = "init"; // init -> calibrating -> active
let calibMin = Infinity;
let calibStart = 0;

async function engage() {
  startBtn.disabled = true;
  startBtn.textContent = "CONNECTING…";
  try {
    camState.textContent = "REQUESTING";
    camState.className = "val val--pending";
    await handInput.init();
    audio.init();
    camState.textContent = "ONLINE";
    camState.className = "val val--good";
    trackState.textContent = "ACTIVE";
    trackState.className = "val val--good";
    startOverlay.classList.add("hidden");

    calibrateOverlay.classList.remove("hidden");
    appState = "calibrating";
    calibMin = Infinity;
    calibStart = performance.now() / 1000;
    telemetryEl.textContent = "CALIBRATING — hold a pinch";
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

function finishCalibration(apply) {
  if (apply && calibMin < Infinity) {
    const t = Math.max(CONFIG.CALIBRATION_MIN_THRESHOLD, Math.min(CONFIG.CALIBRATION_MAX_THRESHOLD, calibMin * CONFIG.CALIBRATION_MARGIN));
    CONFIG.PINCH_THRESHOLD = t;
    savePrefs({ pinchThreshold: t });
    toast(`CALIBRATED: ${t.toFixed(3)}`);
  }
  calibrateOverlay.classList.add("hidden");
  appState = "active";
  telemetryEl.textContent = "TRACKING ACTIVE — pinch to grab the hologram";
}
calibDoneBtn.addEventListener("click", () => finishCalibration(true));
calibSkipBtn.addEventListener("click", () => finishCalibration(false));

// ---------------------------------------------------------------------------
// Toolbar: mute, fullscreen, screenshot, help
// ---------------------------------------------------------------------------
muteBtn.addEventListener("click", () => { audio.toggleMuted(); updateMuteBtn(); });

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
}
fullscreenBtn.addEventListener("click", toggleFullscreen);

function takeScreenshot() {
  composer.render(); // ensure the buffer reflects the latest frame
  const url = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `hololab-${Date.now()}.png`;
  a.click();
  toast("SCREENSHOT SAVED");
}
screenshotBtn.addEventListener("click", takeScreenshot);

function toggleHelp() { helpOverlay.classList.toggle("hidden"); }
helpBtn.addEventListener("click", toggleHelp);
helpCloseBtn.addEventListener("click", toggleHelp);

let hudVisible = true;
function toggleHud() {
  hudVisible = !hudVisible;
  [statusPanel, legendPanel].forEach((p) => { if (p) p.style.opacity = hudVisible ? "1" : "0"; });
  toast(hudVisible ? "HUD SHOWN" : "HUD HIDDEN");
}

window.addEventListener("keydown", (e) => {
  if (e.key === "?") toggleHelp();
  else if (e.key === "s" || e.key === "S") takeScreenshot();
  else if (e.key === "f" || e.key === "F") toggleFullscreen();
  else if (e.key === "m" || e.key === "M") { audio.toggleMuted(); updateMuteBtn(); }
  else if (e.key === "c" || e.key === "C") cycleTheme(e.shiftKey ? "down" : "up");
  else if (e.key === "r" || e.key === "R") { startResetTween(false); toast("RESET"); audio.thud(); }
});

// ---------------------------------------------------------------------------
// Per-frame loop
// ---------------------------------------------------------------------------
function mirrorLandmarks(hand) {
  return hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

function updateReticles(poses) {
  trackDots.forEach((el, i) => {
    const p = poses[i];
    if (!p) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = `${p.pinchPoint.x * window.innerWidth}px`;
    el.style.top = `${p.pinchPoint.y * window.innerHeight}px`;
  });
  const pinching = poses.filter((p) => p.pinching);
  reticles.forEach((el, i) => {
    const p = pinching[i];
    if (!p) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = `${p.pinchPoint.x * window.innerWidth}px`;
    el.style.top = `${p.pinchPoint.y * window.innerHeight}px`;
  });
  if (poses.length > 0) {
    pinchDebugEl.textContent = `${poses.map((p) => p.pinchDist.toFixed(3)).join(" / ")} (need < ${CONFIG.PINCH_THRESHOLD.toFixed(3)})`;
    pinchDebugEl.className = poses.some((p) => p.pinching) ? "val val--good" : "val";
  } else {
    pinchDebugEl.textContent = "—";
    pinchDebugEl.className = "val val--pending";
  }
}

let lastTelemetryMode = "";
let lastHandSeenAt = performance.now() / 1000;
let cachedPoses = [];
let lastDetectAt = 0;
let wasPinchingAny = false;
let wasBraking = false;

// FPS tracking
let fpsFrames = 0;
let fpsWindowStart = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const nowMs = performance.now();
  const now = nowMs / 1000;

  // ---- FPS ----
  fpsFrames++;
  if (nowMs - fpsWindowStart > 500) {
    const fps = Math.round((fpsFrames * 1000) / (nowMs - fpsWindowStart));
    fpsStateEl.textContent = String(fps);
    fpsStateEl.className = fps >= 45 ? "val val--good" : fps >= 25 ? "val" : "val val--warn";
    fpsFrames = 0;
    fpsWindowStart = nowMs;
  }

  // ---- ambient ring spin (speeds up with rotation velocity) ----
  const spinBoost = 1 + Math.min(4, (Math.abs(angularVel.x) + Math.abs(angularVel.y)) * 40);
  ringGroup.children.forEach((ring) => { ring.rotation.z += 0.0025 * ring.userData.baseSpin * spinBoost; });
  ringGroup.rotation.y += 0.0015;

  let poses = cachedPoses;

  if (appState === "calibrating") {
    const hands = handInput.landmarker ? handInput.detect().map(mirrorLandmarks) : [];
    if (hands.length > 0) {
      const d = classifyHandPose(hands[0], CONFIG).pinchDist;
      calibMin = Math.min(calibMin, d);
      calibValue.textContent = calibMin.toFixed(3);
    }
    if (now - calibStart > CONFIG.CALIBRATION_DURATION) finishCalibration(true);
    composer.render();
    return;
  }

  if (appState === "active" && handInput.landmarker) {
    // throttle expensive ML inference independent of render rate ("no lag")
    if (nowMs - lastDetectAt >= CONFIG.DETECTION_INTERVAL_MS) {
      lastDetectAt = nowMs;
      const hands = handInput.detect().map(mirrorLandmarks);
      cachedPoses = hands.map((lm) => classifyHandPose(lm, CONFIG));
      poses = cachedPoses;
    }

    handCountEl.textContent = String(poses.length);
    updateReticles(poses);
    if (poses.length > 0) lastHandSeenAt = now;

    const events = gestureEngine.update(poses, now);

    if (events.brake) {
      // instant stop the moment a fist forms - "grabbing" the hologram halts
      // it immediately, rather than waiting out the momentum decay
      angularVel = { x: 0, y: 0 };
      panVel = { x: 0, y: 0 };
      if (!wasBraking) {
        toast("GRABBED — HELD STILL");
        audio.blip();
      }
    }
    wasBraking = events.brake;

    if (events.rotateDelta) {
      angularVel = { x: events.rotateDelta.dy, y: events.rotateDelta.dx };
    }
    if (events.scale !== null) {
      modelScale = Math.min(CONFIG.SCALE_MAX, Math.max(CONFIG.SCALE_MIN, modelScale * events.scale));
    }
    if (events.pan) {
      panVel = { x: events.pan.dx * 0.4, y: -events.pan.dy * 0.4 };
      modelPos.x = Math.max(-2.5, Math.min(2.5, modelPos.x + events.pan.dx));
      modelPos.y = Math.max(-1.5, Math.min(1.5, modelPos.y - events.pan.dy));
    }
    if (events.swipe) {
      loadBuiltinModel(modelIndex + (events.swipe === "right" ? 1 : -1));
      audio.chime();
      toast(`MODEL: ${MODEL_DEFS[modelIndex].name}`);
    }
    if (events.swipeVertical) {
      toggleHud();
    }
    if (events.ping) {
      spawnPingBurst();
      audio.ping();
      toast("PING");
    }
    if (events.reset && now > resetCooldownUntil) {
      startResetTween(false);
      resetCooldownUntil = now + 1.0;
      audio.thud();
      toast("RESET");
    }
    if (events.fullReset && now > resetCooldownUntil) {
      startResetTween(true);
      resetCooldownUntil = now + 1.0;
      audio.thud();
      toast("FULL RESET");
    }
    if (events.nativeToggle) {
      setNativeMode(!nativeMode);
    }
    if (events.fullscreenToggle) {
      toggleFullscreen();
      toast(document.fullscreenElement ? "FULLSCREEN" : "WINDOWED");
    }
    if (events.muteToggle) {
      audio.toggleMuted();
      updateMuteBtn();
      toast(audio.muted ? "MUTED" : "SOUND ON");
    }
    if (events.screenshot) {
      takeScreenshot();
    }

    if (events.mode !== lastTelemetryMode) {
      modeStateEl.textContent = events.mode.toUpperCase();
      lastTelemetryMode = events.mode;
      if (events.mode === "rotate") telemetryEl.textContent = "ROTATING HOLOGRAM";
      else if (events.mode === "scale_pan") telemetryEl.textContent = "SCALE / PAN";
      else telemetryEl.textContent = "TRACKING ACTIVE — pinch to grab the hologram";
    }

    const anyPinch = poses.some((p) => p.pinching);
    if (anyPinch && !wasPinchingAny) audio.blip();
    wasPinchingAny = anyPinch;
    currentFresnelMaterials.forEach((m) => { m.uniforms.uIntensity.value = anyPinch ? 1.6 : 1.0; });
  } else if (appState !== "active") {
    reticles.forEach((el) => (el.style.display = "none"));
    trackDots.forEach((el) => (el.style.display = "none"));
  }

  // ---- reset tween (overrides direct transform while active) ----
  if (resetTween) {
    const t = Math.min(1, (now - resetTween.start) / resetTween.duration);
    const e = easeOutCubic(t);
    modelGroup.rotation.x = resetTween.fromRot.x * (1 - e);
    modelGroup.rotation.y = resetTween.fromRot.y * (1 - e);
    modelScale = resetTween.fromScale + (1.0 - resetTween.fromScale) * e;
    modelPos.x = resetTween.fromPos.x * (1 - e);
    modelPos.y = resetTween.fromPos.y * (1 - e);
    if (t >= 1) resetTween = null;
  } else {
    // active/inertial rotation
    modelGroup.rotation.y += angularVel.y;
    modelGroup.rotation.x += angularVel.x;

    const isRotating = appState === "active" && poses.some((p) => p.pinching) && poses.length === 1;
    const isPanning = appState === "active" && poses.filter((p) => p.pinching).length === 2;

    if (!isRotating) {
      angularVel.x *= CONFIG.INERTIA_DAMPING;
      angularVel.y *= CONFIG.INERTIA_DAMPING;
      if (Math.hypot(angularVel.x, angularVel.y) < CONFIG.INERTIA_MIN_VELOCITY) angularVel = { x: 0, y: 0 };

      // idle ambient auto-rotate once no hand has been seen for a while
      if (appState === "active" && now - lastHandSeenAt > CONFIG.IDLE_AUTO_ROTATE_DELAY && Math.hypot(angularVel.x, angularVel.y) < CONFIG.INERTIA_MIN_VELOCITY * 2) {
        modelGroup.rotation.y += CONFIG.IDLE_AUTO_ROTATE_SPEED;
      }
    }

    if (!isPanning) {
      modelPos.x += panVel.x;
      modelPos.y += panVel.y;
      panVel.x *= CONFIG.PAN_INERTIA_DAMPING;
      panVel.y *= CONFIG.PAN_INERTIA_DAMPING;
      if (Math.hypot(panVel.x, panVel.y) < CONFIG.PAN_INERTIA_MIN) panVel = { x: 0, y: 0 };
    }
  }

  modelGroup.scale.setScalar(modelScale);
  modelGroup.position.x += (modelPos.x - modelGroup.position.x) * 0.25;
  modelGroup.position.y += (modelPos.y - modelGroup.position.y) * 0.25;

  updateParticles(now);

  composer.render();
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
