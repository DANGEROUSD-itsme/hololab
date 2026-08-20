// audio.js
// Ambient hologram hum + short interaction cues, via the WebAudio API.
// Everything routes through a master gain node so mute is a single call.
// AudioContext creation is deferred to init(), which must be called from a
// user gesture (e.g. the ENGAGE click) to satisfy browser autoplay policies.

import { CONFIG } from "./config.js";

export class HoloAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.humGain = null;
    this.muted = !CONFIG.AUDIO_ENABLED_DEFAULT;
    this._humOscillators = [];
  }

  init() {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioCtx();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);

    this._startHum();
  }

  _startHum() {
    const ctx = this.ctx;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = CONFIG.AUDIO_HUM_VOLUME;
    this.humGain.connect(this.master);

    // two slightly detuned low sines = a soft electrical "presence" hum
    [58, 58.6].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g);
      g.connect(this.humGain);
      osc.start();
      this._humOscillators.push(osc);
    });
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) {
      this.master.gain.linearRampToValueAtTime(muted ? 0 : 1, this.ctx.currentTime + 0.15);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Short rising blip - used when a grab/pinch starts. */
  blip() {
    this._tone({ freq: 620, duration: 0.06, type: "sine", slideTo: 900 });
  }

  /** Confirm chime - model switch, color cycle. */
  chime() {
    this._tone({ freq: 720, duration: 0.09, type: "triangle", slideTo: 1080 });
  }

  /** Deeper thud - reset. */
  thud() {
    this._tone({ freq: 160, duration: 0.18, type: "sine", slideTo: 70 });
  }

  /** Bright ping - double-pinch flourish. */
  ping() {
    this._tone({ freq: 1200, duration: 0.12, type: "sine", slideTo: 1800 });
  }

  /** Soft error buzz - failed file load. */
  error() {
    this._tone({ freq: 140, duration: 0.15, type: "sawtooth", slideTo: 100 });
  }

  _tone({ freq, duration, type, slideTo }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);

    const g = ctx.createGain();
    g.gain.setValueAtTime(CONFIG.AUDIO_SFX_VOLUME, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }
}
