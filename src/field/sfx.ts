/** 外業系統音效 (Web Audio 合成) */
import { audio } from './legacy';

function ctx(): AudioContext | null {
  const a = audio();
  if (!a || !a.enabled) return null;
  if (!a.ctx) a.init();
  return a.ctx || null;
}

export function honk(dist = 10) {
  const c = ctx(); if (!c) return;
  const g = c.createGain();
  const vol = Math.max(0.05, Math.min(0.35, 4 / Math.max(4, dist)));
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.02);
  g.gain.setValueAtTime(vol, c.currentTime + 0.42);
  g.gain.linearRampToValueAtTime(0, c.currentTime + 0.5);
  g.connect(c.destination);
  [392, 494].forEach(f => {
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    o.connect(lp); lp.connect(g); o.start(); o.stop(c.currentTime + 0.52);
  });
}

export function thud() {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, c.currentTime);
  o.frequency.exponentialRampToValueAtTime(45, c.currentTime + 0.18);
  const g = c.createGain(); g.gain.setValueAtTime(0.4, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.26);
}

export function pickup() {
  const c = ctx(); if (!c) return;
  const o = c.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(320, c.currentTime); o.frequency.linearRampToValueAtTime(480, c.currentTime + 0.08);
  const g = c.createGain(); g.gain.setValueAtTime(0.12, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.12);
  o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.13);
}

export function error() {
  const c = ctx(); if (!c) return;
  [0, 0.12].forEach(t => {
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 180;
    const g = c.createGain(); g.gain.setValueAtTime(0.08, c.currentTime + t); g.gain.setValueAtTime(0, c.currentTime + t + 0.08);
    o.connect(g); g.connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.09);
  });
}

/** 手機鈴聲 (兩短聲) */
export function phoneRing() {
  const c = ctx(); if (!c) return;
  [0, 0.28].forEach(t => {
    [1320, 1660].forEach(f => {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, c.currentTime + t);
      g.gain.linearRampToValueAtTime(0.06, c.currentTime + t + 0.02);
      g.gain.setValueAtTime(0.06, c.currentTime + t + 0.18);
      g.gain.linearRampToValueAtTime(0, c.currentTime + t + 0.22);
      o.connect(g); g.connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.24);
    });
  });
}

/** 喝水聲 */
export function gulp() {
  const c = ctx(); if (!c) return;
  [0, 0.22, 0.44].forEach(t => {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(260, c.currentTime + t); o.frequency.exponentialRampToValueAtTime(120, c.currentTime + t + 0.12);
    const g = c.createGain(); g.gain.setValueAtTime(0.12, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.14);
    o.connect(g); g.connect(c.destination); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.15);
  });
}

// ------------------------------------------------------------------ 第三天：噴漆、敲釘
let sprayNodes: { src: AudioBufferSourceNode; g: GainNode } | null = null;
/** 噴漆的「嘶——」(按住時開、放開時關) */
export function spray(on: boolean) {
  const c = ctx(); if (!c) return;
  if (on && !sprayNodes) {
    const len = c.sampleRate * 1;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = b; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5200; hp.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = 0;
    g.gain.setTargetAtTime(0.16, c.currentTime, 0.03);
    src.connect(hp); hp.connect(g); g.connect(c.destination);
    src.start();
    sprayNodes = { src, g };
  } else if (!on && sprayNodes) {
    const { src, g } = sprayNodes;
    g.gain.setTargetAtTime(0, c.currentTime, 0.04);
    src.stop(c.currentTime + 0.25);
    sprayNodes = null;
  }
}

/** 搖噴漆罐 (喀啦喀啦) */
export function canShake() {
  const c = ctx(); if (!c) return;
  for (let i = 0; i < 6; i++) {
    const t = c.currentTime + i * 0.09;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = 2400 + Math.random() * 600;
    const g = c.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.04);
  }
}

/** 鐵鎚敲鋼釘：好的一擊清脆，偏掉的悶 */
export function clink(q: number) {
  const c = ctx(); if (!c) return;
  const t = c.currentTime;
  [1, 2.76, 5.4].forEach((m, i) => {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = (q > 0.5 ? 1500 : 900) * m;
    const g = c.createGain(); g.gain.setValueAtTime((0.22 / (i + 1)) * (0.4 + q * 0.6), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18 + q * 0.25);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.5);
  });
  thud();
}
