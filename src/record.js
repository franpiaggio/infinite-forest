// Record page: a settings form (the values that used to be URL params), then it
// boots the demo scene and captures it. Downloads a .webm. A footer link leads
// back to Explore.

import './styles.css';
import { isMobile } from './gyro.js';
import { getPreset } from './quality.js';
import { bootScene } from './scene.js';
import { createAudio } from './audio.js';
import { recordCanvasWithAudio } from './recorder.js';

const audio = createAudio();
const MOBILE = isMobile();

const RES = {
  square:    { w: 1080, h: 1080, native: false },
  portrait:  { w: 1080, h: 1920, native: false },
  landscape: { w: 1920, h: 1080, native: false },
  native:    { native: true },
};

const overlay = document.getElementById('overlay');
const appEl   = document.getElementById('app');
const statsEl = document.getElementById('stats');
const startBtn = document.getElementById('start-rec');
const recHint = document.getElementById('rec-hint');
const rmodeSel = document.getElementById('f-rmode');
const autoRow = document.getElementById('auto-row');

const $ = (id) => document.getElementById(id);
const numv = (id, d) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };

rmodeSel.addEventListener('change', () => { autoRow.style.display = rmodeSel.value === 'auto' ? 'grid' : 'none'; });

let current = null, activeRecording = null, busy = false;

function readOpts() {
  return {
    tier: $('f-tier').value,
    res: RES[$('f-res').value] || RES.square,
    secs: Math.max(3, numv('f-secs', 30)),
    mbps: Math.max(4, numv('f-mbps', 24)),
    musicStart: Math.max(0, numv('f-music', 50)),
    auto: rmodeSel.value === 'auto',
    rint: Math.max(0.2, numv('f-rint', 1.5)),
    roffset: Math.max(0, numv('f-roffset', 0.5)),
  };
}

function reset() {
  current?.dispose();
  current = null;
  busy = false;
  document.body.classList.remove('recording');
  overlay.classList.remove('hidden', 'loading');
  startBtn.disabled = false;
}

function startRecording() {
  if (busy) return;
  busy = true;
  const o = readOpts();
  startBtn.disabled = true;

  audio.startAmbient();          // the click is the gesture audio needs
  const { ambient, music } = audio;

  overlay.classList.add('loading');
  requestAnimationFrame(() => {
    current = bootScene({
      mount: appEl, statsEl,
      preset: getPreset(o.tier), mode: 'demo',
      seed: (Math.random() * 0x7fffffff) | 0, season: 'verano',
      mobile: MOBILE, hud: false, gui: false, onExit: reset,
    });

    Promise.resolve(current.ready).catch(() => {})
      .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      .then(() => {
        overlay.classList.add('hidden');
        document.body.classList.add('recording');     // hides #hud + crosslink (not the canvas)

        if (!o.res.native) current.setRenderSize(o.res.w, o.res.h, false);

        // Music from its chosen mark at video second 0 (clamped to the track).
        ambient.muted = false; music.muted = false;
        const dur = Number.isFinite(music.duration) ? music.duration : null;
        const startAt = dur ? Math.min(o.musicStart, Math.max(0, dur - o.secs - 1)) : o.musicStart;
        try { music.currentTime = startAt; } catch (_) { /* metadata not ready */ }
        music.play().catch(() => {});

        // Auto R fires on a timer (delayed by roffset to land on the beat); manual
        // uses the R key, which bootScene already binds.
        let rInterval = null, rStart = null;
        if (o.auto) rStart = setTimeout(() => { rInterval = setInterval(current.randomizeForest, o.rint * 1000); }, o.roffset * 1000);

        // REC indicator + countdown — a DOM overlay, NOT in the captured canvas.
        const recDot = document.createElement('div');
        recDot.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
          'font:600 14px ui-monospace,Menlo,Consolas,monospace;color:#fff;background:rgba(180,30,30,0.85);' +
          'padding:6px 12px;border-radius:8px;letter-spacing:0.06em;pointer-events:none;';
        document.body.appendChild(recDot);
        let remain = Math.round(o.secs);
        const paint = () => { recDot.textContent = `● REC  ${remain}s${o.auto ? '' : '  ·  press R to the beat'}`; };
        paint();
        const dotTimer = setInterval(() => { remain = Math.max(0, remain - 1); paint(); }, 1000);

        activeRecording = recordCanvasWithAudio({
          canvas: current.canvas, fps: 60, mbps: o.mbps,
          audioElements: [ambient, music], durationMs: o.secs * 1000,
          onStop: () => {
            if (rStart) clearTimeout(rStart);
            if (rInterval) clearInterval(rInterval);
            clearInterval(dotTimer);
            recDot.remove();
            music.pause();
            console.log('[infinite-forest] recording saved (.webm)');
            reset();
          },
        });
      });
  });
}

startBtn.addEventListener('click', startRecording);
if (recHint) recHint.textContent = MOBILE ? 'Recording works best on desktop.' : 'Tip: maximize the window for native res.';
