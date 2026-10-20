---
name: threejs-3d
description: "Build 3D web scenes with three.js: importmap setup with a pinned CDN version, scene/camera/renderer, lights, PBR materials, loading GLTF/GLB models, OrbitControls, the animation loop, responsive resize, performance, plus product viewer and animated hero background patterns. Use when the user asks for 3D, three.js, WebGL, a 3D model viewer, rotating product, 3D hero or interactive 3D scene."
---

# three.js 3D

A three.js page needs: renderer, scene, camera, lights, objects, a loop, and resize handling. Get those
right first, then add the content.

## 1. Setup (no build step): pin one exact version for core and addons
```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
} }
</script>
<script type="module" src="main.js"></script>
```
Core and addons must be the same version. With a bundler: `npm i three` and import
`three/addons/controls/OrbitControls.js`. ES modules need a server, not `file://`: run_app `npx serve .`.

## 2. Base scene
```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const container = document.getElementById('viewer');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;   // realistic reflections

const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(3, 2, 5);

const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(5, 8, 5); scene.add(key);
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.minDistance = 2; controls.maxDistance = 10;

const timer = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = timer.getDelta();
  controls.update();
  renderer.render(scene, camera);
});

new ResizeObserver(() => {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}).observe(container);
```
The container needs a CSS size (`#viewer{width:100%;height:70vh}`), or the canvas is 0px tall.

## 3. Materials and lighting
- `MeshStandardMaterial` (roughness/metalness) for most things; `MeshPhysicalMaterial` for glass,
  clearcoat car paint. Metals: metalness 1, roughness 0.2–0.4. Plastics: metalness 0, roughness 0.4–0.7.
- An environment map (above, or an HDR via `RGBELoader`) makes PBR look real; lights alone look flat.
- Shadows only if needed: `renderer.shadowMap.enabled = true`, `light.castShadow = true`,
  `mesh.castShadow/receiveShadow`, keep the shadow camera tight. A soft fake shadow (a blurred
  radial-gradient plane under the object) is cheaper.

## 4. Loading GLTF/GLB
```js
new GLTFLoader().load('models/chair.glb', (gltf) => {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);           // center and scale to fit
  const size = box.getSize(new THREE.Vector3()).length();
  model.position.sub(box.getCenter(new THREE.Vector3()));
  model.scale.setScalar(3 / size);
  scene.add(model);
}, undefined, (err) => console.error('Model failed to load', err));
```
- Use GLB (binary) files. Compressed models (Draco/Meshopt) need `DRACOLoader`/`MeshoptDecoder` set on the loader.
- Show a loading indicator until loaded; show an error message if it fails.
- Test model: `https://threejs.org/examples/models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf`.

## 5. Patterns
- **Product viewer:** model centered, OrbitControls with damping, `controls.autoRotate = true`
  (speed 1–2) stopping on interaction, limits on zoom and `maxPolarAngle = Math.PI / 2`, neutral studio
  environment, color/material swatches that change `material.color.set('#c2410c')`.
- **Hero background:** canvas `position:fixed; inset:0; z-index:-1`, `alpha: true`, a few meshes or a
  `Points` particle field animated slowly with elapsed time, subtle mouse parallax on the camera,
  no controls, `pointer-events:none`. Pause when off-screen (IntersectionObserver) and keep it static
  under `prefers-reduced-motion`.

## 6. Performance
- Pixel ratio capped at 2; fewer than ~100 draw calls; reuse geometries and materials;
  `InstancedMesh` for many copies.
- Textures power-of-two, 1–2K max, compressed (KTX2) for large scenes; models under ~5MB.
- Stop the loop when hidden (`renderer.setAnimationLoop(null)`); dispose geometries, materials and
  textures when removing objects.
- Check mobile: if FPS drops, disable shadows and antialias, lower pixel ratio to 1.5.

## Check before you finish
1. Serve over HTTP (run_app `npx serve .`) and inspect_preview: no console errors (404 on model/addon
   paths and version mismatches are the usual ones), canvas visible and not 0px tall.
2. Resize the window: no stretching; controls work with mouse and touch.
3. Model is centered, lit, and in frame at load; loading and error states work.
4. Reduced-motion and hidden-tab behavior for background scenes.

## Common mistakes
- Opening via `file://` (modules and models fail); mismatched three and addons versions.
- Forgetting `camera.updateProjectionMatrix()` on resize; black model (no lights/environment).
- Huge unoptimized models; pixel ratio 3 on phones.
- Importing from `three/examples/jsm/...` paths that do not match the importmap.
