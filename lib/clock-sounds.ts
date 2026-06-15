// Browser-only sound engine for the public projector clock. Each clock event
// (see ClockSoundEvent) maps to a short sound. Sounds are synthesised with the
// Web Audio API so they work offline with zero bundled assets, but any event can
// be overridden by dropping an audio file in /public/sounds (see the filenames
// in OVERRIDE_FILES and public/sounds/README.md) — handy for, e.g., a real
// "Fatality" sting on a bustout.
//
// Browsers block audio until a user gesture, so nothing plays until unlock() is
// called from a click/tap (the clock page's sound toggle).
import type { ClockSoundEvent } from "@/lib/clock-sound-events";

/** Optional drop-in override files, served from /public/sounds. */
const OVERRIDE_FILES: Record<ClockSoundEvent, string> = {
  levelStart: "/sounds/gong.mp3",
  breakStart: "/sounds/buzzer.mp3",
  oneMinuteWarning: "/sounds/chime.mp3",
  bust: "/sounds/fatality.mp3",
};

/** Cap (seconds) on how much of an override file plays for an event. */
const OVERRIDE_MAX_SECONDS: Partial<Record<ClockSoundEvent, number>> = {
  levelStart: 5, // the gong clip is long; only the opening swell is wanted
};

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

export class ClockSoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  /** url → decoded buffer, or null once we know the override file is absent. */
  private overrides = new Map<string, AudioBuffer | null>();

  get ready(): boolean {
    return this.unlocked;
  }

  /** Create/resume the AudioContext from a user gesture, then preload overrides. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
    this.unlocked = true;
    void this.preloadOverrides();
  }

  /** Best-effort decode of any present override files; absent ones are cached as null. */
  private async preloadOverrides(): Promise<void> {
    if (!this.ctx) return;
    const urls = Array.from(new Set(Object.values(OVERRIDE_FILES)));
    await Promise.all(urls.map(async url => {
      if (this.overrides.has(url)) return;
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) { this.overrides.set(url, null); return; }
        const buf = await res.arrayBuffer();
        const decoded = await this.ctx!.decodeAudioData(buf);
        this.overrides.set(url, decoded);
      } catch {
        this.overrides.set(url, null);
      }
    }));
  }

  /** Play the sound for an event. No-op until unlocked. */
  play(event: ClockSoundEvent): void {
    if (!this.unlocked || !this.ctx || !this.master) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();

    const override = this.overrides.get(OVERRIDE_FILES[event]);
    if (override) { this.playBuffer(override, OVERRIDE_MAX_SECONDS[event]); return; }

    switch (event) {
      case "levelStart": this.gong(); break;
      case "breakStart": this.buzzer(); break;
      case "oneMinuteWarning": this.chime(); break;
      case "bust": this.fatality(); break;
    }
  }

  close(): void {
    try { void this.ctx?.close(); } catch { /* ignore */ }
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
  }

  // --- synthesis helpers ----------------------------------------------------

  private playBuffer(buffer: AudioBuffer, maxSeconds?: number): void {
    const ctx = this.ctx!, t0 = ctx.currentTime, src = ctx.createBufferSource();
    src.buffer = buffer;
    // Cap overly long clips, fading out the last 150ms so the cut isn't a click.
    if (maxSeconds && maxSeconds > 0 && buffer.duration > maxSeconds) {
      const g = ctx.createGain();
      const fade = Math.min(0.15, maxSeconds / 2);
      g.gain.setValueAtTime(1, t0);
      g.gain.setValueAtTime(1, t0 + maxSeconds - fade);
      g.gain.linearRampToValueAtTime(0.0001, t0 + maxSeconds);
      src.connect(g); g.connect(this.master!);
      src.start(t0, 0, maxSeconds);
    } else {
      src.connect(this.master!);
      src.start();
    }
  }

  /** A partial sine voice with an exponential decay envelope. */
  private voice(freq: number, gain: number, attack: number, decay: number, type: OscillatorType = "sine", detune = 0): void {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    osc.connect(g); g.connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + attack + decay + 0.05);
  }

  /** Deep, resonant gong: an inharmonic stack of partials with a long decay. */
  private gong(): void {
    const base = 90;
    const partials: [number, number][] = [[1, 0.5], [2.0, 0.28], [2.76, 0.2], [3.9, 0.13], [5.4, 0.08]];
    for (const [ratio, gain] of partials) {
      this.voice(base * ratio, gain, 0.01, 2.8 + Math.random() * 0.4, "sine", (Math.random() - 0.5) * 8);
    }
  }

  /** Harsh hockey-style buzzer: detuned saws through a lowpass with a hard gate. */
  private buzzer(): void {
    const ctx = this.ctx!, t0 = ctx.currentTime, dur = 1.2;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.03);
    g.gain.setValueAtTime(0.5, t0 + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const f of [196, 197.5, 294]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.connect(g);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    g.connect(lp); lp.connect(this.master!);
  }

  /** Bright two-tone bell "cling" with a quick decay. */
  private chime(): void {
    this.voice(1568, 0.35, 0.005, 0.7, "sine");   // G6
    this.voice(2349, 0.18, 0.005, 0.55, "sine");  // ~D7
    this.voice(3136, 0.08, 0.005, 0.4, "sine");   // G7 shimmer
  }

  /**
   * Bustout sting: an ominous low sweep + impact, with a spoken "Fatality" when
   * the browser supports speech synthesis. Drop /public/sounds/fatality.mp3 to
   * replace it with a real clip.
   */
  private fatality(): void {
    const ctx = this.ctx!, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(160, t0);
    osc.frequency.exponentialRampToValueAtTime(45, t0 + 1.6);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
    osc.connect(g); g.connect(this.master!);
    osc.start(t0); osc.stop(t0 + 1.85);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        const u = new SpeechSynthesisUtterance("Fatality");
        u.rate = 0.75; u.pitch = 0.1; u.volume = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch { /* ignore */ }
    }
  }
}
