// Explore page: the splash menu (graphics tier + Demo / Walk / Inspect), then the
// live scene. No recording. A footer link leads to the Record page.

import './styles.css';
import { isMobile } from './gyro.js';
import { getPreset, detectDefaultTier } from './quality.js';
import { buildSettings } from './settings.js';
import { bootScene } from './scene.js';
import { createAudio } from './audio.js';

const audio = createAudio();

const overlay    = document.getElementById('overlay');
const btnFree    = document.getElementById('mode-free');
const btnDemo    = document.getElementById('mode-demo');
const btnInspect = document.getElementById('mode-inspect');
const btnSettings = document.getElementById('open-settings');
const tierBtns   = Array.from(document.querySelectorAll('.tier'));
const tierCaption = document.getElementById('tier-caption');
const splashHint = document.getElementById('splash-hint');
const backHint   = document.getElementById('back-hint');
const statsEl    = document.getElementById('stats');
const appEl      = document.getElementById('app');

const TIER_CAPTIONS = { low: 'phones · integrated GPU', medium: 'most devices', high: 'desktop · dedicated GPU' };
const MOBILE = isMobile();

let chosenSeed = (Math.random() * 0x7fffffff) | 0;
let chosenSeason = 'verano';
const settings = buildSettings({ onReseed: (s) => { chosenSeed = s; }, onSeason: (n) => { chosenSeason = n; } });
if (btnSettings) btnSettings.addEventListener('click', () => settings.show());

let selectedTier = detectDefaultTier();
syncTierUI();
function syncTierUI() {
  for (const b of tierBtns) b.classList.toggle('active', b.dataset.tier === selectedTier);
  if (tierCaption) tierCaption.textContent = TIER_CAPTIONS[selectedTier] ?? '';
}
for (const b of tierBtns) b.addEventListener('click', () => { selectedTier = b.dataset.tier; syncTierUI(); });

if (MOBILE && splashHint) splashHint.textContent = 'walk · joystick + drag to look';

let started = false;
let current = null;          // active scene handle

function revealWhenReady(readyPromise) {
  Promise.resolve(readyPromise).catch(() => {})
    .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    .then(() => overlay.classList.add('hidden'));
}

function returnToMenu() {
  current?.dispose();
  current = null;
  document.body.classList.remove('ui-hidden');
  overlay.classList.remove('hidden', 'loading');
  backHint.classList.remove('show');
  started = false;
  btnFree.disabled = btnDemo.disabled = false;
  if (btnInspect) btnInspect.disabled = false;
  if (statsEl) statsEl.textContent = 'initializing…';
}

function chooseMode(mode) {
  if (started) return;
  started = true;
  audio.startAmbient();          // the click is the gesture audio needs
  audio.addButtons();
  audio.startMusic();            // music autoplays from the first interaction
  btnFree.disabled = btnDemo.disabled = true;
  if (btnInspect) btnInspect.disabled = true;
  overlay.classList.add('loading');
  requestAnimationFrame(() => {
    current = bootScene({
      mount: appEl, statsEl, backHintEl: backHint,
      preset: getPreset(selectedTier), mode, seed: chosenSeed, season: chosenSeason,
      mobile: MOBILE, hud: true, gui: !MOBILE, onExit: returnToMenu,
    });
    revealWhenReady(current.ready);
  });
}

btnFree.addEventListener('click', () => chooseMode('free'));
btnDemo.addEventListener('click', () => chooseMode('demo'));
if (btnInspect) btnInspect.addEventListener('click', () => chooseMode('inspect'));
