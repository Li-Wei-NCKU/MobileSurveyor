/**
 * 聲音：環境音 (風、蟬、鳥、遠處車聲)、主選單音樂、人物說話聲 (嘰哩咕嚕的音節)、狗叫。
 * 全部用 Web Audio 即時合成，不需要外部音檔。音效開關 (T) 關掉時一律靜音。
 */
import { audio } from './legacy';

// ------------------------------------------------------------------
// 音量設定 (存在瀏覽器裡，只是偏好設定，不是遊戲進度)
// ------------------------------------------------------------------
export interface AudioSettings { master: number; musicOn: boolean; music: number; sfxOn: boolean; sfx: number }
const SKEY = 'ks-audio-v1';
export const settings: AudioSettings = { master: 0.8, musicOn: true, music: 0.6, sfxOn: true, sfx: 0.9 };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch { /* 沒有就用預設 */ }
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch { /* */ } applyVolumes(); }

// 所有接到喇叭的聲音都改走「音效」或「音樂」匯流排 → 主音量 → 喇叭
interface Buses { master: GainNode; sfx: GainNode; music: GainNode }
const origConnect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => unknown;
function buses(c: BaseAudioContext): Buses {
  const any = c as unknown as { __buses?: Buses };
  if (any.__buses) return any.__buses;
  const master = c.createGain(), sfx = c.createGain(), music = c.createGain();
  origConnect.call(master, c.destination);
  origConnect.call(sfx, master);
  origConnect.call(music, master);
  any.__buses = { master, sfx, music };
  applyVolumes(c);
  return any.__buses;
}
(AudioNode.prototype as unknown as { connect: unknown }).connect = function (this: AudioNode & { __music?: boolean }, dest: unknown, ...rest: unknown[]) {
  if (dest === this.context.destination && this.context instanceof AudioContext) {
    const b = buses(this.context);
    if (this !== b.master) dest = this.__music ? b.music : b.sfx;
  }
  return origConnect.call(this, dest, ...rest);
};
export function applyVolumes(c?: BaseAudioContext) {
  const cc = c || (audio()?.ctx as AudioContext | undefined);
  if (!cc) return;
  const b = buses(cc);
  const all = audio()?.enabled === false ? 0 : 1;
  const t = cc.currentTime;
  b.master.gain.setTargetAtTime(settings.master * all, t, 0.05);
  b.sfx.gain.setTargetAtTime(settings.sfxOn ? settings.sfx : 0, t, 0.05);
  b.music.gain.setTargetAtTime(settings.musicOn ? settings.music : 0, t, 0.05);
}

function ctx(): AudioContext | null {
  const a = audio();
  if (!a) return null;
  if (!a.ctx) a.init();
  const c: AudioContext | undefined = a.ctx;
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  if (c) buses(c);
  return c || null;
}
function on(): boolean { const a = audio(); return !!a && a.enabled !== false && settings.sfxOn; }
function musicOn(): boolean { const a = audio(); return !!a && a.enabled !== false && settings.musicOn; }

function noiseBuffer(c: AudioContext, sec: number, brown = false): AudioBuffer {
  const len = Math.floor(c.sampleRate * sec);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}

// ------------------------------------------------------------------
// 環境音
// ------------------------------------------------------------------
export interface AmbientState {
  /** 'yard' 公司 / 'field' 野外 / 'off' */
  scene: 'yard' | 'field' | 'off';
  inTruck: boolean;
  /** 玩家到大馬路的距離 (m) */
  roadDist: number;
}

class Ambient {
  private master: GainNode | null = null;
  private wind: GainNode | null = null;
  private cicada: GainNode | null = null;
  private traffic: GainNode | null = null;
  private birdT = 4;
  private cicadaPhase = 0;
  private state: AmbientState = { scene: 'off', inTruck: false, roadDist: 99 };
  private t = 0;

  private build(c: AudioContext) {
    if (this.master) return;
    // 舊版的單調風聲關掉，改由這裡負責
    const a = audio();
    if (a?.ambientGain) a.ambientGain.gain.value = 0;
    this.master = c.createGain(); this.master.gain.value = 0; this.master.connect(c.destination);
    const white = noiseBuffer(c, 3), brown = noiseBuffer(c, 3, true);
    // 風：低頻噪音，強弱慢慢變
    const w = c.createBufferSource(); w.buffer = brown; w.loop = true;
    const wl = c.createBiquadFilter(); wl.type = 'lowpass'; wl.frequency.value = 420;
    this.wind = c.createGain(); this.wind.gain.value = 0.05;
    w.connect(wl); wl.connect(this.wind); this.wind.connect(this.master); w.start();
    // 蟬：高頻帶通噪音 + 快速脈動
    const s = c.createBufferSource(); s.buffer = white; s.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 6;
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 38;
    const lfoAmt = c.createGain(); lfoAmt.gain.value = 0.5;
    lfo.connect(lfoAmt); lfoAmt.connect(am.gain); lfo.start();
    this.cicada = c.createGain(); this.cicada.gain.value = 0;
    s.connect(bp); bp.connect(am); am.connect(this.cicada); this.cicada.connect(this.master); s.start();
    // 遠處車流：很低的轟聲
    const tr = c.createBufferSource(); tr.buffer = brown; tr.loop = true; tr.playbackRate.value = 0.7;
    const tl = c.createBiquadFilter(); tl.type = 'lowpass'; tl.frequency.value = 180;
    this.traffic = c.createGain(); this.traffic.gain.value = 0;
    tr.connect(tl); tl.connect(this.traffic); this.traffic.connect(this.master); tr.start();
  }

  set(s: Partial<AmbientState>) { Object.assign(this.state, s); }

  private lastEnabled: boolean | null = null;
  update(dt: number) {
    this.t += dt;
    const en = audio()?.enabled !== false;
    if (en !== this.lastEnabled) { this.lastEnabled = en; applyVolumes(); }
    const st = this.state;
    if (st.scene === 'off' && !this.master) return;
    const c = ctx();
    if (!c) return;
    this.build(c);
    const now = c.currentTime;
    const vol = !on() || st.scene === 'off' ? 0 : st.inTruck ? 0.3 : 1;
    this.master!.gain.setTargetAtTime(vol, now, 0.4);
    if (!vol) return;
    // 風：每十幾秒一陣
    const gust = 0.035 + 0.025 * (0.5 + 0.5 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.11));
    this.wind!.gain.setTargetAtTime(gust, now, 0.5);
    // 蟬：野外才有，一陣一陣地叫
    this.cicadaPhase += dt;
    const swell = st.scene === 'field' ? Math.max(0, Math.sin(this.cicadaPhase * 0.35)) : 0;
    this.cicada!.gain.setTargetAtTime(0.022 * swell, now, 0.8);
    // 車流：靠近大馬路比較大聲
    const tv = Math.max(0, Math.min(1, 1 - (st.roadDist - 4) / 40));
    this.traffic!.gain.setTargetAtTime(0.06 * tv + 0.008, now, 0.6);
    // 鳥叫
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 3 + Math.random() * 7;
      this.bird(c, st.scene === 'yard' ? 0.5 : 1);
    }
  }

  private bird(c: AudioContext, k: number) {
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1400;
    const t0 = c.currentTime + 0.05;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(); o.type = 'sine';
      const g = c.createGain();
      const s = t0 + i * (0.11 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), s + 0.06);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, s + 0.09);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.025 * k, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.1);
      o.connect(g); g.connect(this.master!);
      o.start(s); o.stop(s + 0.12);
    }
  }
}
export const ambient = new Ambient();

// ------------------------------------------------------------------
// 主選單音樂：輕鬆的五聲音階撥弦 + 和弦鋪底
// ------------------------------------------------------------------
class MenuMusic {
  private want = false;
  private timer = 0;
  private bus: GainNode | null = null;
  private step = 0;
  private armed = false;

  start() {
    this.want = true;
    this.arm();
    this.kick();
  }
  stop() {
    this.want = false;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    const c = audio()?.ctx as AudioContext | undefined;
    if (this.bus && c) { const b = this.bus; b.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => b.disconnect(), 1500); }
    this.bus = null;
  }
  /** 瀏覽器規定要使用者先點一下才會出聲 */
  private arm() {
    if (this.armed) return;
    this.armed = true;
    const go = () => { if (this.want) this.kick(); };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }
  private kick() {
    if (!this.want || this.timer) return;
    const c = ctx();
    if (!c) return;
    // 第一次點擊時 AudioContext 還在「暫停」，等它真的開始再播
    if (c.state !== 'running') { c.resume().then(() => this.kick()).catch(() => {}); return; }
    this.bus = c.createGain(); this.bus.gain.value = 0; (this.bus as GainNode & { __music?: boolean }).__music = true; this.bus.connect(c.destination);
    this.bus.gain.setTargetAtTime(0.9, c.currentTime, 1.2);
    this.step = 0;
    const beat = 60 / 92 / 2; // 八分音符
    this.timer = window.setInterval(() => this.tick(c, beat), beat * 1000);
  }
  private tick(c: AudioContext, beat: number) {
    if (!this.bus) return;
    const g = this.bus;
    const mute = !musicOn();
    g.gain.setTargetAtTime(mute ? 0 : 0.9, c.currentTime, 0.2);
    if (mute) { this.step++; return; }
    // C 大調五聲：每 8 拍換一個和弦 (C - Am - F - G)
    const roots = [261.63, 220.0, 174.61, 196.0];
    const bar = Math.floor(this.step / 8) % 4;
    const root = roots[bar];
    const t = c.currentTime + 0.02;
    if (this.step % 8 === 0) {
      [1, 1.5, 2].forEach(r => this.pad(c, root * r / 2, t, beat * 8));
    }
    const scale = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2, 9 / 4];
    if (Math.random() < (this.step % 2 === 0 ? 0.85 : 0.45)) {
      const f = 261.63 * scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
      this.pluck(c, f, t);
    }
    this.step++;
  }
  private pluck(c: AudioContext, f: number, t: number) {
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.045, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    o.connect(lp); lp.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 1);
  }
  private pad(c: AudioContext, f: number, t: number, dur: number) {
    [-6, 6].forEach(det => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.012, t + 0.8); g.gain.setValueAtTime(0.012, t + dur - 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(lp); lp.connect(g); g.connect(this.bus!);
      o.start(t); o.stop(t + dur + 0.05);
    });
  }
}
export const menuMusic = new MenuMusic();

// ------------------------------------------------------------------
// 現場背景音樂：逗趣的「低音管 + 撥弦 + 木魚」小進行曲 (原創旋律)
// ------------------------------------------------------------------
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
// [音高 (MIDI，0 = 休止), 長度 (八分音符數)]
const F4 = 65, G4 = 67, A4 = 69, Bb4 = 70, B4 = 71, C5 = 72, D5 = 74, E5 = 76, F5 = 77, E4 = 64, D4 = 62, C4 = 60, Ab4 = 68, Gb4 = 66, Db5 = 73;
const MELODY: [number, number][] = [
  // A 段
  [C5, 1], [0, 1], [A4, 1], [F4, 1], [G4, 1], [A4, 1], [0, 2],
  [G4, 1], [0, 1], [E4, 1], [C4, 1], [D4, 1], [E4, 1], [0, 2],
  [F4, 1], [A4, 1], [C5, 1], [F5, 1], [E5, 1], [D5, 1], [C5, 2],
  [D5, 1], [Bb4, 1], [G4, 1], [Bb4, 1], [C5, 2], [0, 2],
  [C5, 1], [0, 1], [A4, 1], [F4, 1], [G4, 1], [A4, 1], [0, 2],
  [D5, 1], [0, 1], [A4, 1], [F4, 1], [E4, 1], [F4, 1], [0, 2],
  [G4, 1], [B4, 1], [D5, 1], [F5, 1], [E5, 1], [D5, 1], [B4, 2],
  [C5, 2], [G4, 1], [E4, 1], [C4, 2], [0, 2],
  // B 段：躡手躡腳的半音
  [A4, 1], [Ab4, 1], [A4, 1], [0, 1], [C5, 1], [0, 1], [A4, 2],
  [G4, 1], [Gb4, 1], [G4, 1], [0, 1], [Bb4, 1], [0, 1], [G4, 2],
  [F4, 1], [A4, 1], [C5, 1], [Db5, 1], [D5, 2], [0, 2],
  [C5, 1], [Bb4, 1], [A4, 1], [G4, 1], [F4, 2], [0, 2],
];
// 每小節 (8 個八分音符) 的和弦根音 (MIDI) 與大小調
const CHORDS: [number, 'M' | 'm' | '7'][] = [
  [41, 'M'], [36, '7'], [41, 'M'], [46, 'M'], [41, 'M'], [38, 'm'], [43, '7'], [36, '7'],
  [41, 'M'], [36, '7'], [46, 'M'], [41, 'M'],
];

class GameMusic {
  private want = false;
  private timer = 0;
  private bus: GainNode | null = null;
  private next = 0;     // 下一個音的時間 (AudioContext 秒)
  private mi = 0;       // 旋律位置
  private beat = 0;     // 八分音符計數 (伴奏)
  private beatT = 0;
  private duckTo = 1;
  private readonly e8 = 60 / 116 / 2;

  start() { this.want = true; this.arm(); this.kick(); }
  stop() {
    this.want = false;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
    const c = audio()?.ctx as AudioContext | undefined;
    if (this.bus && c) { const b = this.bus; b.gain.setTargetAtTime(0, c.currentTime, 0.4); setTimeout(() => b.disconnect(), 2000); }
    this.bus = null;
  }
  /** 開車聽收音機時壓低 */
  duck(on: boolean) { this.duckTo = on ? 0.12 : 1; }
  private armed = false;
  private arm() {
    if (this.armed) return;
    this.armed = true;
    const go = () => { if (this.want) this.kick(); };
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
  }
  private kick() {
    if (!this.want || this.timer) return;
    const c = ctx();
    if (!c) return;
    if (c.state !== 'running') { c.resume().then(() => this.kick()).catch(() => {}); return; }
    this.bus = c.createGain(); this.bus.gain.value = 0; (this.bus as GainNode & { __music?: boolean }).__music = true; this.bus.connect(c.destination);
    this.next = this.beatT = c.currentTime + 0.1;
    this.mi = 0; this.beat = 0;
    this.timer = window.setInterval(() => this.schedule(c), 60);
  }
  private schedule(c: AudioContext) {
    if (!this.bus) return;
    const vol = musicOn() ? 0.5 * this.duckTo : 0;
    this.bus.gain.setTargetAtTime(vol, c.currentTime, 0.3);
    const ahead = c.currentTime + 0.25;
    while (this.next < ahead) {
      const [n, len] = MELODY[this.mi % MELODY.length];
      if (n) this.bassoon(c, midi(n), this.next, len * this.e8);
      this.next += len * this.e8;
      this.mi++;
    }
    while (this.beatT < ahead) {
      const bar = Math.floor(this.beat / 8) % CHORDS.length;
      const [root, q] = CHORDS[bar];
      const pos = this.beat % 8;
      if (pos === 0 || pos === 4) this.tuba(c, midi(pos === 0 ? root : root + 7), this.beatT);
      if (pos === 2 || pos === 6) {
        const third = q === 'm' ? 3 : 4;
        [12, 12 + third, 19].forEach(iv => this.pizz(c, midi(root + iv + 12), this.beatT));
        this.block(c, this.beatT, pos === 6 ? 1.25 : 1);
      }
      this.beatT += this.e8;
      this.beat++;
    }
  }
  /** 低音管：鋸齒波 + 鼻音的共振峰，短促斷奏，帶一點抖音 */
  private bassoon(c: AudioContext, f: number, t: number, dur: number) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f / 2;
    const vib = c.createOscillator(); vib.frequency.value = 5.5;
    const vg = c.createGain(); vg.gain.value = 6; vib.connect(vg); vg.connect(o.detune);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 1.2;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
    const g = c.createGain();
    const len = Math.min(dur * 0.72, 0.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.setValueAtTime(0.16, t + len * 0.7); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.bus!);
    o.start(t); vib.start(t); o.stop(t + len + 0.03); vib.stop(t + len + 0.03);
  }
  /** 低音號：嗡—帕 的嗡 */
  private tuba(c: AudioContext, f: number, t: number) {
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.015); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(lp); lp.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 0.3);
  }
  /** 撥弦：帕 */
  private pizz(c: AudioContext, f: number, t: number) {
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
    o.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 0.18);
  }
  /** 木魚 */
  private block(c: AudioContext, t: number, k: number) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 900 * k;
    const g = c.createGain();
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    o.connect(g); g.connect(this.bus!);
    o.start(t); o.stop(t + 0.08);
  }
}
export const gameMusic = new GameMusic();

// ------------------------------------------------------------------
// 聲音設定面板 (M 鍵、右上角按鈕、主選單)
// ------------------------------------------------------------------
export function openAudioPanel() {
  if (document.getElementById('audio-panel')) { closeAudioPanel(); return; }
  if (document.exitPointerLock) document.exitPointerLock();
  const bd = document.createElement('div');
  bd.id = 'audio-panel';
  bd.className = 'modal-backdrop show field-modal audio-backdrop';
  const pct = (v: number) => Math.round(v * 100);
  bd.innerHTML = `
    <div class="paper audio-card">
      <div class="paper-head"><h2>聲音設定</h2></div>
      <div class="au-row"><span class="au-name">主音量</span><span></span><input type="range" min="0" max="100" data-k="master" value="${pct(settings.master)}"><b>${pct(settings.master)}</b></div>
      <div class="au-row"><span class="au-name">背景音樂</span><button class="au-tog" data-t="musicOn"></button><input type="range" min="0" max="100" data-k="music" value="${pct(settings.music)}"><b>${pct(settings.music)}</b></div>
      <div class="au-row"><span class="au-name">音效<small>環境音、說話聲、狗叫、儀器</small></span><button class="au-tog" data-t="sfxOn"></button><input type="range" min="0" max="100" data-k="sfx" value="${pct(settings.sfx)}"><b>${pct(settings.sfx)}</b></div>
      <p class="au-note">收音機的音量另外由車上的收音機控制。</p>
      <div class="paper-actions"><button class="btn-paper au-close"><kbd class="cap">M</kbd> 關閉</button></div>
    </div>`;
  document.body.appendChild(bd);
  const tog = (b: HTMLButtonElement) => { const k = b.dataset.t as 'musicOn' | 'sfxOn'; b.textContent = settings[k] ? '開' : '關'; b.classList.toggle('off', !settings[k]); };
  bd.querySelectorAll<HTMLButtonElement>('.au-tog').forEach(b => {
    tog(b);
    b.onclick = () => { const k = b.dataset.t as 'musicOn' | 'sfxOn'; settings[k] = !settings[k]; tog(b); saveSettings(); };
  });
  bd.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(r => {
    r.oninput = () => {
      const k = r.dataset.k as 'master' | 'music' | 'sfx';
      settings[k] = Number(r.value) / 100;
      (r.nextElementSibling as HTMLElement).textContent = r.value;
      saveSettings();
    };
  });
  (bd.querySelector('.au-close') as HTMLButtonElement).onclick = closeAudioPanel;
  bd.addEventListener('click', e => { if (e.target === bd) closeAudioPanel(); });
  ctx();
}
export function closeAudioPanel() { document.getElementById('audio-panel')?.remove(); }

// ------------------------------------------------------------------
// 人物說話聲：依角色決定音高與音色，按字數發出一串音節
// ------------------------------------------------------------------
interface Voice { f: number; type: OscillatorType; formant: number; speed: number; radio?: boolean; phone?: boolean }

function voiceFor(speaker: string): Voice {
  const s = speaker;
  const v: Voice = { f: 200, type: 'square', formant: 1100, speed: 0.07 };
  if (/小朋友/.test(s)) Object.assign(v, { f: 430, type: 'triangle', formant: 1800, speed: 0.06 });
  else if (/阿伯|地主|田的主人/.test(s)) Object.assign(v, { f: 115, type: 'sawtooth', formant: 750, speed: 0.085 });
  else if (/阿姨/.test(s)) Object.assign(v, { f: 280, type: 'triangle', formant: 1400, speed: 0.065 });
  else if (/警/.test(s)) Object.assign(v, { f: 150, type: 'square', formant: 900, speed: 0.075 });
  else if (/里長/.test(s)) Object.assign(v, { f: 135, type: 'sawtooth', formant: 850, speed: 0.08 });
  else if (/騎士/.test(s)) Object.assign(v, { f: 170, type: 'square', formant: 1000, speed: 0.07 });
  else if (/學弟/.test(s)) Object.assign(v, { f: 210, type: 'square', formant: 1250, speed: 0.065 });
  else if (/組長/.test(s)) Object.assign(v, { f: 140, type: 'square', formant: 900, speed: 0.08 });
  if (/對講機/.test(s)) v.radio = true;
  if (/來電|電話/.test(s)) v.phone = true;
  return v;
}

let talkEnd = 0;
/** 說話聲整體音量 */
const VOICE_GAIN = 2.0;
/** 說一句話：text 只用來決定長度 (標點符號會停頓) */
export function speak(speaker: string, text: string) {
  if (!on()) return;
  const c = ctx();
  if (!c) return;
  const v = voiceFor(speaker);
  const plain = text.replace(/<[^>]+>/g, '').replace(/（[^）]*）/g, '');
  const chars = [...plain].slice(0, 26);
  let t = Math.max(c.currentTime + 0.03, talkEnd);
  // 說話聲音量 (約為 v2.4 的 5 倍)，後面接壓縮器避免破音
  const out = c.createGain(); out.gain.value = VOICE_GAIN;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
  let tail: AudioNode = out;
  if (v.radio || v.phone) {
    // 對講機 / 電話：窄頻
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = v.radio ? 600 : 400;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = v.radio ? 2600 : 3200;
    out.connect(hp); hp.connect(lp); tail = lp;
    if (v.radio) { // 開頭一聲「咔」
      const n = c.createBufferSource(); n.buffer = noiseBuffer(c, 0.04);
      const g = c.createGain(); g.gain.value = 0.05; n.connect(g); g.connect(c.destination); n.start(t);
      t += 0.05;
    }
  }
  tail.connect(comp); comp.connect(c.destination);
  for (const ch of chars) {
    if (/[，。！？…、,.!?\s「」]/.test(ch)) { t += v.speed * 1.6; continue; }
    const o = c.createOscillator(); o.type = v.type;
    const f = v.f * (0.88 + Math.random() * 0.3);
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (0.9 + Math.random() * 0.2), t + v.speed);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = v.formant * (0.85 + Math.random() * 0.3); bp.Q.value = 1.4;
    const g = c.createGain();
    const len = v.speed * 0.85;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.012); g.gain.setValueAtTime(0.16, t + len * 0.6); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(bp); bp.connect(g); g.connect(out);
    o.start(t); o.stop(t + len + 0.02);
    t += v.speed;
  }
  talkEnd = t;
  setTimeout(() => { try { out.disconnect(); comp.disconnect(); } catch { /* */ } }, (t - c.currentTime + 1) * 1000);
}
/** 換說話對象時，打斷還沒講完的 */
export function hush() { talkEnd = 0; }

// ------------------------------------------------------------------
// 狗叫：汪汪 (距離越遠越小聲)；happy = 撒嬌的嗚嗚聲
// ------------------------------------------------------------------
export function bark(dist = 6, n = 2, happy = false) {
  if (!on()) return;
  const c = ctx();
  if (!c) return;
  const vol = Math.max(0.03, Math.min(0.32, 4 / Math.max(3, dist)));
  let t = c.currentTime + 0.02;
  for (let i = 0; i < n; i++) {
    const o = c.createOscillator(); o.type = 'sawtooth';
    const f0 = happy ? 900 : 520 + Math.random() * 120;
    const len = happy ? 0.35 : 0.13;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(happy ? f0 * 1.3 : f0 * 0.45, t + len);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = happy ? 1400 : 900; bp.Q.value = 2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * (happy ? 0.5 : 1), t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
    o.connect(bp); bp.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + len + 0.02);
    // 喉音的雜訊
    if (!happy) {
      const nz = c.createBufferSource(); nz.buffer = noiseBuffer(c, 0.1);
      const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 1;
      const ng = c.createGain(); ng.gain.setValueAtTime(vol * 0.6, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      nz.connect(nf); nf.connect(ng); ng.connect(c.destination); nz.start(t);
    }
    t += happy ? 0.45 : 0.2 + Math.random() * 0.06;
  }
}
