# Infinite Forest

A real-time, procedurally-generated, infinitely-streaming forest rendered with
Three.js — volumetric godrays, alpha-clump grass, rolling terrain, four seasons,
a hands-off cinematic camera, and a built-in social-clip recorder.

Two screens, one engine:

- **Explore** (`index.html`) — pick a graphics tier and a mode (Demo flythrough /
  Walk / Inspect a tree), then roam the live scene. Desktop has a live tuning GUI.
- **Record** (`record.html`) — the same scene, with the capture settings exposed
  as a form (format, duration, music start, R-cut mode, bitrate). Records the
  canvas + audio to a `.webm` for socials.

Each page has a footer link to the other.

```bash
npm install
npm run dev      # http://localhost:5190  (Explore)  ·  /record.html  (Record)
npm run build    # multi-page build -> dist/index.html + dist/record.html
```

---

## Objective

Recreate — and then extend well past — the Codrops "Fractals to Forests" demo:
a believable 3D forest you can move through, built from a procedurally-generated
tree, a streamed background forest, GPU wind, volumetric sun, and a simple
atmospheric environment. The goal was always **"looks like a place," not "a
Three.js demo"**: coherent light, no pop-in, no black artifacts, runs on a phone
on Low and sings on a desktop GPU on High.

This repo is the consolidation of that work into a clean two-screen app plus a
purpose-built recorder for sharing clips.

---

## Where we learned from

- **Codrops — "Fractals to Forests: Creating Realistic 3D Trees with Three.js"**
  https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/
  The reference scene and the wind-shader / crossed-quad-leaves approach.
- **FluffyGrass (Codrops)** — the alpha-clump grass technique (crossed planes,
  in-shader instance placement via `gl_InstanceID`, world-noise wind).
- **ez-tree** (`@dgreenheck/ez-tree`) — the parametric tree generator we delegate
  trunk/branch/leaf geometry to. https://github.com/dgreenheck/ez-tree · https://eztree.dev/
- **three-good-godrays** — shadow-map-raymarched volumetric light shafts.
- **Three.js docs** — InstancedMesh, `Material.onBeforeCompile`, color management.
  https://threejs.org/docs/
- **L-systems** (background reading on recursive growth). https://en.wikipedia.org/wiki/L-system

---

## Technologies

| Area | Tech |
| --- | --- |
| Renderer / scene | **Three.js** r0.170 (WebGL2) |
| Build / dev | **Vite** 5 (multi-page: `index.html` + `record.html`) |
| Trees | **@dgreenheck/ez-tree** (geometry), normalized to realistic heights |
| Post-processing | **postprocessing** v6 (bloom, DoF, tone-mapping, vignette, SMAA) |
| Godrays | **three-good-godrays** v0.12 |
| Camera motion | **GSAP** (eased demoscene flythrough) |
| Live tuning GUI | **lil-gui** |
| Touch / mobile | **nipplejs** (joystick) + DeviceOrientation gyro |
| Audio + capture | Web Audio + `canvas.captureStream` + `MediaRecorder` |

No framework — vanilla JS modules. Plain JS (not TypeScript).

---

## Architecture

```
index.html  -- src/explore.js -+
record.html -- src/record.js  -+--> src/scene.js  (the shared engine)
                               |      |- environment.js  sky dome, sun, fog, ground+snow
                               |      |- terrain.js       shared JS+GLSL height field
                               |      |- world.js/chunk.js streamed InstancedMesh forest
                               |      |- grass.js         FluffyGrass alpha clumps
                               |      |- postprocessing.js HDR composer + godrays
                               |      |- demo.js / player.js / mobile-controls.js  cameras
                               |      |- seasons.js       palettes, leaf recolour, particles
                               |      \- debug-gui.js     live tuning + safe randomize + log
                               |- audio.js   ambient loop + music + sound/music buttons
                               \- recorder.js  canvas+audio -> webm
```

`scene.js` exposes a handle: `{ canvas, randomizeForest, ready, setRenderSize,
dispose, ... }`. Explore wires it to the splash menu; Record wires it to the form
and the recorder. Both share every engine module.

---

## Technical details

### Terrain relief (`terrain.js`)
One **shared height field** lives in both JS and GLSL (identical sine-octave
formula). The ground is a camera-following grid mesh displaced in the vertex
shader with finite-difference normals; its texture is world-anchored so it
doesn't swim. Trees, grass clumps and the player/camera are all raised by
`terrainHeight(x,z)` in JS, so every system sits on the same hills. Winter swaps
the ground texture for procedural snow via a `uSnow` shader mix.

### Streamed forest (`world.js`, `chunk.js`)
The world is generated per chunk around the camera (coherent-noise density ->
clearings vs. thickets, plus species groves and rare "giant" trees). Each tree
template is one `InstancedMesh` pair (branches + leaves); per frame we distance-
cull by the tree's **near edge** (fade-in through fog, no pop), frustum-cull
against a terrain-aware bounding sphere, and write the visible instances. Target:
a forest in a handful of draw calls.

### Grass (`grass.js`)
FluffyGrass-style crossed alpha planes. Clumps are placed **in the vertex shader**
from `gl_InstanceID` around the player (a fixed world grid that follows the
camera), sit on the terrain, and wave with world-space noise wind. Colour gets a
low-frequency drift within the green gamut so the field isn't one flat tone.

### Light & atmosphere (`environment.js`, `postprocessing.js`)
A gradient sky **dome** (horizon->zenith + a warm sun halo) that follows the
camera, distance fog matched to the horizon colour (seamless tree fade-out), a
low directional sun, and a HemisphereLight. The HDR composer runs godrays
(raymarching the sun's shadow map) before bloom / DoF / ACES tone-mapping /
vignette / SMAA. Godrays have no phase function, so we fade density as the camera
turns away from the sun.

### Demo camera (`demo.js`)
A hands-off **demoscene** flythrough: no collisions, GSAP-eased motion
(meandering heading, breathing speed, buoyant height with occasional crane-up
reveals, an independently-panning gaze). Travel is biased into a cone aimed at
the sun so the godrays stay in frame. The horizon is kept dead level.

### Seasons (`seasons.js`)
Per-leaf recolour in the shader (luminance-preserving, per-instance variation;
pines stay evergreen), a palette per season for grass/sky/fog/sun, and falling
particles — autumn leaves shed only from **nearby tree canopies** (anchored in
the particle shader, falling to the local terrain height), winter snow and spring
petals as world-space dots.

### Recording (`recorder.js`, `record.js`)
`canvas.captureStream(fps)` for video + a Web Audio graph mixing the ambient loop
and the music track into a `MediaStreamAudioDestinationNode` for audio, muxed by
`MediaRecorder` (VP9/Opus -> `.webm`). The form exposes format (square / portrait
/ landscape / native), duration, music start offset, R-cut mode (manual: press R
to the beat / auto on a timer with a beat offset), bitrate, and tier. A DOM REC
indicator/countdown is shown to the operator but is **not** in the capture (only
the canvas is). Gotcha handled: the audio graph nodes are retained so GC doesn't
silence the recording mid-clip.

> `.webm` -> `.mp4` (H.264/AAC) for X / Instagram / LinkedIn:
> `ffmpeg -i clip.webm -c:v libx264 -crf 17 -preset slow -c:a aac -b:a 192k clip.mp4`

### Performance principles
InstancedMesh for everything repeated; GPU wind only (never mutate verts in JS);
capped pixel ratio; alpha-test (not transparency) leaves so they stay in the
opaque pass; tight directional-shadow frustum; background trees don't cast
shadows; lower geometry with distance; fog hides the streaming edge for free;
`setAnimationLoop` (pauses on hidden tab); never regenerate a tree per frame;
shadow-acne bias; sRGB albedo / linear data textures. Three tiers (Low / Medium /
High) scale shadow-map size, view distance, grass density, godray steps and which
post-effects run — Low drops shadows/godrays/bloom/SMAA to run on weak phones.

---

## Credits

The music track (`src/assets/pine-drift.mp3`) was made specifically for this
project. The ambient loop (`src/assets/forest.mp3`) and the tree/leaf/grass
textures are third-party assets — verify usage rights before publishing clips.
Tree generation by ez-tree; grass and tree techniques after the Codrops articles
cited above.
