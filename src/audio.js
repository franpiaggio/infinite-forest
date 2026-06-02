// Ambient forest loop + an optional music track ("Pine Drift"), plus the little
// bottom-right 🔊 / 🎵 toggle buttons. Used by both pages. Browsers need a user
// gesture before audio can play, so startAmbient() is called from a click.

import forestAudioUrl from './assets/forest.mp3';
import musicUrl from './assets/pine-drift.mp3';

const AUDIO_BTN_CSS =
  'position:fixed;bottom:12px;z-index:2147483647;width:40px;height:40px;' +
  'border-radius:8px;background:rgba(28,35,42,0.82);color:#cfd5dc;' +
  'border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(4px);cursor:pointer;' +
  'font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;';

export function createAudio({ ambientVol = 0.5, musicVol = 0.6 } = {}) {
  const ambient = new Audio(forestAudioUrl);
  ambient.loop = true; ambient.preload = 'auto'; ambient.volume = 0;

  const music = new Audio(musicUrl);
  music.loop = true; music.preload = 'auto'; music.volume = musicVol;

  let ambientStarted = false, musicOn = false, buttonsAdded = false;
  let paintMus = () => {};   // re-bound once the music button exists

  // Start the music track from the top (call from a user gesture). Used for
  // autoplay on the first interaction.
  function startMusic() {
    if (musicOn) return;
    musicOn = true;
    music.currentTime = 0;
    music.play().catch(() => { musicOn = false; paintMus(); });
    paintMus();
  }

  function startAmbient() {
    if (ambientStarted) return;
    ambientStarted = true;
    ambient.play().then(() => {
      const t0 = performance.now();
      const fade = (now) => {
        const k = Math.min(1, (now - t0) / 1500);
        ambient.volume = ambientVol * k;
        if (k < 1) requestAnimationFrame(fade);
      };
      requestAnimationFrame(fade);
    }).catch(() => { /* autoplay blocked — the toggle resumes it */ });
  }

  function addButtons() {
    if (buttonsAdded) return;
    buttonsAdded = true;

    const snd = document.createElement('button');
    snd.type = 'button'; snd.classList.add('ui-toggleable');
    snd.style.cssText = AUDIO_BTN_CSS + 'right:12px;';
    const paintSnd = () => { snd.textContent = ambient.muted ? '🔇' : '🔊'; snd.title = ambient.muted ? 'Unmute ambience' : 'Mute ambience'; };
    snd.addEventListener('click', () => {
      ambient.muted = !ambient.muted;
      if (!ambient.muted && ambient.paused) ambient.play().catch(() => {});
      paintSnd();
    });
    paintSnd();
    document.body.appendChild(snd);

    const mus = document.createElement('button');
    mus.type = 'button'; mus.classList.add('ui-toggleable');
    mus.style.cssText = AUDIO_BTN_CSS + 'right:60px;';
    paintMus = () => { mus.textContent = '🎵'; mus.style.opacity = musicOn ? '1' : '0.45'; mus.title = musicOn ? 'Stop music' : 'Play music'; };
    mus.addEventListener('click', () => {
      musicOn = !musicOn;
      if (musicOn) { music.currentTime = 0; music.play().catch(() => { musicOn = false; paintMus(); }); }
      else { music.pause(); }
      paintMus();
    });
    paintMus();
    document.body.appendChild(mus);
  }

  return { ambient, music, startAmbient, addButtons, startMusic };
}
