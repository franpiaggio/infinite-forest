// Shared engine core. Builds the renderer, world, grass, post-processing and the
// chosen camera controller, runs the frame loop, and returns a handle the two
// pages (Explore / Record) drive. Everything page-specific (splash menu, audio,
// the record form) lives in those entry modules; this file is purely the scene.
//
// Lifted almost verbatim from the single-page boot() of the original sandbox
// (13-terrain), with the page glue parameterised out: `onExit`, `statsEl`,
// `backHintEl`, and `hud` / `gui` toggles.

import * as THREE from 'three';

import { buildEnvironment }      from './environment.js';
import { buildTemplates }        from './tree-templates.js';
import { buildWorld }            from './world.js';
import { setForestConfig }       from './chunk.js';
import { buildDemo }             from './demo.js';
import { buildPlayer }           from './player.js';
import { buildGrass }            from './grass.js';
import { buildPipeline }         from './postprocessing.js';
import { buildDust }             from './dust.js';
import { enableGyro }            from './gyro.js';
import { updateWind }            from './wind.js';
import { buildDebugGui }         from './debug-gui.js';
import { buildInspector }        from './inspector.js';
import { buildMobilePlayer, buildAutoMobileHud } from './mobile-controls.js';
import { applySeasonToLeaf, setSeason, buildSeasonParticles } from './seasons.js';

// Boots a scene. Returns a handle: { renderer, canvas, camera, env, post, grass,
// world, randomizeForest, ready, isAuto, setRenderSize, dispose }.
export function bootScene({
  mount, statsEl = null, backHintEl = null,
  preset, mode = 'demo', seed = 0, season = 'verano',
  mobile = false, hud = true, gui = true, onExit = null,
}) {
  const cleanups = [];
  const cleanup = (fn) => cleanups.push(fn);
  function dispose() {
    for (const fn of cleanups) { try { fn(); } catch (_) { /* keep tearing down */ } }
    cleanups.length = 0;
  }
  const requestExit = () => onExit?.();

  if (backHintEl) {
    if (mobile) {
      backHintEl.innerHTML = mode === 'free'
        ? 'joystick to move · drag to look · ✕ Exit to leave'
        : 'tilt phone to look · 🧭 toggles gyro · ✕ Exit to leave';
    } else if (mode === 'free') {
      backHintEl.innerHTML = 'WASD move · Shift run · arrows look · <kbd>Esc</kbd> for menu';
    } else {
      backHintEl.innerHTML = '<kbd>Esc</kbd> or ✕ Exit to return';
    }
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: false, powerPreference: 'high-performance', stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = preset.shadowsEnabled !== false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  mount.appendChild(renderer.domElement);

  // Teardown step one: stop the loop and drop the WebGL context so repeated
  // sessions don't leak contexts (browsers cap them at ~16).
  cleanup(() => {
    renderer.setAnimationLoop(null);
    try { renderer.dispose(); renderer.forceContextLoss(); } catch (_) { /* ignore */ }
    renderer.domElement.remove();
  });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 250);
  camera.position.set(0, 1.7, 0);
  camera.lookAt(0, 1.7, -1);

  // ── Inspector mode: one centred tree + orbit camera, no world/grass/post ──
  if (mode === 'inspect') {
    const insp = buildInspector(renderer, scene, camera, preset, { onReturnToMenu: requestExit });
    if (insp?.dispose) cleanup(insp.dispose);
    return { renderer, canvas: renderer.domElement, camera, scene, ready: Promise.resolve(), dispose, isAuto: false };
  }

  const env = buildEnvironment(scene, renderer, preset);
  const templates = buildTemplates({
    lowPoly: true,
    leavesCountMult: preset.leavesCountMult,
    includeIds: preset.treePresets,
    geomMult: preset.geomMult ?? 1.0,
  });
  const world = buildWorld(scene, templates, {
    worldSeed: seed,
    viewChunks: preset.viewChunks,
    treeCastShadow: preset.treeCastShadow,
    renderDistance: preset.renderDistance,
  });

  const grass = buildGrass(scene, {
    gridSide: preset.grassGridSide, cellSize: preset.grassCellSize,
    clumpHeight: 0.55, clumpWidth: 0.55, planes: preset.grassPlanes, segments: 4,
    windAmp: 0.08, baseColor: '#2f3f1e', tipColor1: '#a6cf7e', tipColor2: '#46662b',
    edgeFadeStart: preset.grassEdgeFade,
  });

  const post = buildPipeline(renderer, scene, camera, preset, env.sun);
  const dust = buildDust(scene, { count: preset.dustCount });

  // ── Seasons ──
  for (const t of templates) applySeasonToLeaf(t.leafMat, t.id.startsWith('pine'));
  const seasonFx = buildSeasonParticles(scene, { count: preset.dustCount > 0 ? 450 : 250 });
  setSeason(season, { grass, env, particles: seasonFx });

  // ── Godrays directional falloff (the lib has no phase function) ──
  const grControl = { baseDensity: preset.godraysDensity ?? 0.013, directional: true, floor: 0.12 };
  const _camFwd = new THREE.Vector3();
  const grDensityU = post.godrays?.illumPass?.material?.uniforms?.density ?? null;

  function rollGodrays() {
    if (!post.godrays) return;
    const A = {
      baseDensity: preset.godraysDensity ?? 0.013, maxDensity: preset.godraysMaxDensity ?? 0.5,
      distanceAttenuation: preset.godraysDistanceAtten ?? 1.0, color: preset.godraysColor ?? 0xffe6bf,
      directional: true, floor: 0.12,
    };
    const B = { baseDensity: 0.0345, maxDensity: 0.21, distanceAttenuation: 0.0, color: 0xcdf1d8, directional: true, floor: 0.4 };
    const gp = Math.random() < 0.5 ? A : B;
    grControl.baseDensity = gp.baseDensity; grControl.directional = gp.directional; grControl.floor = gp.floor;
    post.godrays.setParams({
      density: gp.baseDensity, maxDensity: gp.maxDensity, distanceAttenuation: gp.distanceAttenuation,
      color: new THREE.Color(gp.color), raymarchSteps: preset.godraysRaymarchSteps ?? 60,
      blur: preset.godraysBlur ?? true, gammaCorrection: false,
    });
  }
  rollGodrays();

  // ── Randomize: re-roll forest + season + godrays + (desktop) graphics ──
  let dbgGui = null;
  const _rnd = (mn, mx, st) => mn + Math.floor(Math.random() * ((mx - mn) / st + 1)) * st;
  const SEASON_KEYS = ['otono', 'invierno', 'primavera', 'verano'];
  function randomizeForest() {
    setForestConfig({
      densityMin: _rnd(0, 20, 1), densityMax: _rnd(5, 40, 1), densityZone: _rnd(30, 250, 5),
      groveZone: _rnd(20, 200, 5), offSpecies: _rnd(0, 0.6, 0.01), bushChance: _rnd(0, 0.6, 0.01),
      giantChance: _rnd(0, 0.1, 0.005),
      speciesWeight: { oak: _rnd(0, 4, 0.1), ash: _rnd(0, 4, 0.1), aspen: _rnd(0, 4, 0.1), pine: _rnd(0, 4, 0.1) },
    });
    setSeason(SEASON_KEYS[Math.floor(Math.random() * SEASON_KEYS.length)], { grass, env, particles: seasonFx });
    rollGodrays();
    dbgGui?.randomizeGraphics?.();
    world.setSeed((Math.random() * 0x7fffffff) | 0);
  }

  // ── In-game HUD shared style ──
  const hudBtnCss =
    'pointer-events:auto;padding:9px 13px;border-radius:8px;background:rgba(28,35,42,0.82);' +
    'color:#cfd5dc;border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(4px);cursor:pointer;' +
    'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;font-weight:600;';
  const makeHudBtn = (text, onClick) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text; b.style.cssText = hudBtnCss;
    b.addEventListener('click', onClick);
    return b;
  };

  if (hud && mobile) {
    const rb = makeHudBtn('Random', randomizeForest);
    rb.style.cssText += 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:42;';
    document.body.appendChild(rb);
    cleanup(() => rb.remove());
  }

  // ── Camera controller for the chosen mode ──
  let explorer, mobileHud = null;
  if (mode === 'free' && mobile) {
    explorer = buildMobilePlayer(camera, scene, { onExit: requestExit });
  } else if (mode === 'free') {
    explorer = buildPlayer(camera, renderer.domElement, scene);
    requestAnimationFrame(() => { try { explorer.controls.lock(); } catch (_) { /* race */ } });
    renderer.domElement.addEventListener('click', () => {
      if (!explorer.controls.isLocked) { try { explorer.controls.lock(); } catch (_) { /* ignore */ } }
    });
  } else {
    explorer = buildDemo(camera, scene, env.sunDir);
    if (mobile) {
      enableGyro();
      mobileHud = buildAutoMobileHud({ onExit: requestExit, gyroOn: true });
    }
  }
  if (explorer?.dispose) cleanup(() => explorer.dispose());
  if (mobileHud?.dispose) cleanup(() => mobileHud.dispose());
  if (post?.composer?.dispose) cleanup(() => { try { post.composer.dispose(); } catch (_) { /* ignore */ } });

  if (backHintEl) {
    backHintEl.classList.add('show');
    setTimeout(() => backHintEl.classList.remove('show'), 3500);
  }

  // Esc returns from demo mode; 'R' re-rolls everything.
  const onEscMenu = (e) => { if (e.code === 'Escape' && mode === 'demo') requestExit(); };
  window.addEventListener('keydown', onEscMenu);
  cleanup(() => window.removeEventListener('keydown', onEscMenu));
  const onKeyR = (e) => { if (e.code === 'KeyR') randomizeForest(); };
  window.addEventListener('keydown', onKeyR);
  cleanup(() => window.removeEventListener('keydown', onKeyR));

  if (post.setFocusTarget) post.setFocusTarget(explorer.isAuto ? 9 : 6);

  // ── In-game HUD buttons + debug GUI (desktop) ──
  if (hud && gui && !mobile) {
    dbgGui = buildDebugGui({ post, env, grass, scene, world, preset, grControl, onReturnToMenu: requestExit });
    if (dbgGui?.destroy) cleanup(() => dbgGui.destroy());
    if (dbgGui?.domElement) dbgGui.domElement.classList.add('dbg-gui');

    const style = document.createElement('style');
    style.textContent =
      'body.ui-hidden .ui-toggleable, body.ui-hidden #hud, body.ui-hidden .dbg-gui { display:none !important; }' +
      '.ui-restore { display:none; }' +
      'body.ui-hidden .ui-restore { display:flex !important; }';
    document.head.appendChild(style);
    cleanup(() => style.remove());

    const btnBar = document.createElement('div');
    btnBar.classList.add('ui-toggleable');
    btnBar.style.cssText = 'position:fixed;top:12px;left:12px;z-index:2147483647;display:flex;gap:8px;';
    document.body.appendChild(btnBar);
    cleanup(() => btnBar.remove());
    const placeBtn = (text, onClick) => { const b = makeHudBtn(text, onClick); btnBar.appendChild(b); return b; };
    placeBtn('Exit', requestExit);
    placeBtn('Randomize', randomizeForest);
    placeBtn('Hide UI', () => document.body.classList.add('ui-hidden'));

    const restore = makeHudBtn('', () => document.body.classList.remove('ui-hidden'));
    restore.className = 'ui-restore';
    restore.title = 'Show UI (O)';
    restore.innerHTML = '<span style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-radius:2px;"></span>';
    restore.style.cssText += 'position:fixed;top:12px;left:12px;z-index:2147483647;align-items:center;justify-content:center;';
    document.body.appendChild(restore);
    cleanup(() => restore.remove());

    const onKeyO = (e) => { if (e.code === 'KeyO') document.body.classList.toggle('ui-hidden'); };
    window.addEventListener('keydown', onKeyO);
    cleanup(() => window.removeEventListener('keydown', onKeyO));
  }

  // ── Resize ──
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    post.resize();
  };
  window.addEventListener('resize', onResize);
  cleanup(() => window.removeEventListener('resize', onResize));

  // ── Frame loop ──
  const clock = new THREE.Clock();
  let frameCount = 0, lastStatTime = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    explorer.update(dt, world);
    const counts = world.update(camera);
    grass.update(camera);
    grass.setTime(t);
    dust.update(camera, t);
    seasonFx.update(camera, t, world);
    env.updateSun(camera.position);
    updateWind(t);

    if (grDensityU) {
      let factor = 1;
      if (grControl.directional) {
        camera.getWorldDirection(_camFwd);
        const facing = _camFwd.dot(env.sunDir);
        const f = THREE.MathUtils.smoothstep(facing, -0.15, 0.55);
        factor = grControl.floor + (1 - grControl.floor) * f;
      }
      grDensityU.value = grControl.baseDensity * factor;
    }

    post.composer.render();
    frameCount++;

    if (statsEl && t - lastStatTime > 0.5) {
      const fps = Math.round(frameCount / (t - lastStatTime));
      statsEl.textContent =
        `${mode}  ·  ${preset.label}  ·  fps ${fps}  ·  trees ${counts.totalVisible}/${counts.totalInRange}/${counts.totalActive}` +
        `  ·  calls ${renderer.info.render.calls}`;
      frameCount = 0;
      lastStatTime = t;
    }
  });

  renderer.compile(scene, camera);

  // Lock the drawing buffer to a fixed capture size (CSS untouched). Pass native
  // = true to keep the live window resolution.
  function setRenderSize(w, h, native = false) {
    if (native) return;
    renderer.setSize(w, h, false);
    post.composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return {
    renderer, canvas: renderer.domElement, camera, scene,
    env, post, grass, world,
    randomizeForest, ready: grass.ready, isAuto: explorer.isAuto,
    setRenderSize, dispose,
  };
}
