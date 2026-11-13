/**
 * 手機的動作感測器 (deviceorientation)：
 *  - 扶標尺：手機立直，螢幕上的圓水準器跟著手機歪
 *  - RTK 對中桿：手機放平
 *  - 拍點位照片：手機轉到哪裡，遊戲裡的鏡頭就看到哪裡 (像 AR)
 * 沒有感測器、或使用者不給權限時 tiltLive() 會是 false，呼叫端要退回原本的手指操作。
 */
import * as THREE from 'three';

const st = { a: 0, b: 0, g: 0, t: -1e9, state: 'idle' as 'idle' | 'on' };
let asked = false;

function onEv(e: DeviceOrientationEvent) {
  if (e.beta == null || e.gamma == null) return;   // 桌機會丟一筆全 null 的事件
  st.a = e.alpha || 0; st.b = e.beta; st.g = e.gamma; st.t = performance.now();
}

/** 要在使用者點擊的當下呼叫 (iOS 要先問權限) */
export function tiltEnable() {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (!D) return;
  // 監聽一定掛上：不給權限的話頂多收不到事件 (tiltLive 就是 false，呼叫端自己退回手指操作)
  if (st.state === 'idle') { window.addEventListener('deviceorientation', onEv); st.state = 'on'; }
  if (typeof D.requestPermission === 'function' && !asked) {
    asked = true;
    try { D.requestPermission().then(r => { if (r !== 'granted') asked = false; }).catch(() => { asked = false; }); } catch { asked = false; }
  }
}

/** 最近 0.8 秒內有收到感測器資料 */
export function tiltLive() { return performance.now() - st.t < 800; }

const D2R = Math.PI / 180;
function screenAngle(): number {
  const a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle
    : Number((window as unknown as { orientation?: number }).orientation || 0);
  return a * D2R;
}

/** 「正上方」在螢幕坐標裡的方向 (x 右、y 螢幕上緣、z 朝使用者)。平放 = (0,0,1)，立直 = (0,1,0) */
export function tiltUp(): { x: number; y: number; z: number } {
  const b = st.b * D2R, g = st.g * D2R;
  const xd = -Math.cos(b) * Math.sin(g), yd = Math.sin(b), zd = Math.cos(b) * Math.cos(g);
  const th = screenAngle(), c = Math.cos(th), s = Math.sin(th);
  return { x: xd * c - yd * s, y: xd * s + yd * c, z: zd };
}

/** 滿刻度：手機歪這麼多度，氣泡就頂到邊 */
const FULL = Math.sin(7 * D2R);

export type TiltMode = 'flat' | 'upright';

/** 手機歪斜換成氣泡位置 (−1~1；氣泡往高的那一邊跑)。不含擾動。 */
export function tiltBubble(mode: TiltMode): { x: number; y: number } {
  const u = tiltUp();
  let x: number, y: number;
  if (mode === 'flat') { x = u.x / FULL; y = -u.y / FULL; }
  else { x = u.x / FULL; y = u.z / FULL; }
  if (mode === 'upright' && u.y < 0) { x = x >= 0 ? 9 : -9; }   // 拿倒了
  const r = Math.hypot(x, y);
  if (r > 1.6) { x *= 1.6 / r; y *= 1.6 / r; }
  return { x, y };
}

/** 手機離「該有的姿勢」差幾度 (提示用) */
export function tiltOff(mode: TiltMode): number {
  const u = tiltUp();
  const c = mode === 'flat' ? u.z : u.y;
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}

export interface BubbleState { bx: number; by: number; p1?: number; p2?: number; p3?: number; p4?: number; jx?: number; jy?: number }

/**
 * 感測器模式的氣泡：手機姿勢 ＋ 一點擾動。
 * 擾動是一股慢慢轉向的推力 (風／手痠，約 12 秒繞一圈) 加上一點小晃動：
 * 手機擺在桌上、靠在牆上不動，氣泡會被推到圈外；跟著慢慢修就留得住。
 * bias：推力大小 (氣泡座標，圈的半徑是 0.38)
 */
export function tiltBubbleStep(h: BubbleState, mode: TiltMode, time: number, dt: number, bias: number) {
  if (h.p1 === undefined) { h.p1 = Math.random() * 6.28; h.p2 = Math.random() * 6.28; h.p3 = Math.random() < 0.5 ? -1 : 1; h.p4 = Math.random() * 6.28; h.jx = 0; h.jy = 0; }
  h.jx = (h.jx! + (Math.random() - 0.5) * 1.2 * dt) * Math.pow(0.4, dt);
  h.jy = (h.jy! + (Math.random() - 0.5) * 1.2 * dt) * Math.pow(0.4, dt);
  const ph = h.p1! + time * 0.5 * h.p3!;
  const dx = bias * Math.cos(ph) + 0.1 * Math.sin(time * 1.7 + h.p2!) + h.jx!;
  const dy = bias * Math.sin(ph) + 0.1 * Math.sin(time * 1.4 + h.p4!) + h.jy!;
  const t = tiltBubble(mode);
  const k = 1 - Math.exp(-dt * 9);
  h.bx += (t.x + dx - h.bx) * k;
  h.by += (t.y + dy - h.by) * k;
  const r = Math.hypot(h.bx, h.by);
  if (r > 1) { h.bx /= r; h.by /= r; }
}

const _e = new THREE.Euler();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // 繞 X 轉 −90°
const _q0 = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

/** 手機姿勢 → 相機四元數 (手機背面的鏡頭看出去的方向) */
export function tiltQuat(out: THREE.Quaternion): THREE.Quaternion {
  _e.set(st.b * D2R, st.a * D2R, -st.g * D2R, 'YXZ');
  out.setFromEuler(_e);
  out.multiply(_q1);
  out.multiply(_q0.setFromAxisAngle(_z, -screenAngle()));
  return out;
}

// ---------------------------------------------------------------- 測試用：鍵盤假裝感測器
let fake: { stop: () => void } | null = null;
export function tiltFakeOn() { return !!fake; }
/** F9 測試工具：用方向鍵假裝手機在歪 (I/K 前後、J/L 左右、U/O 轉向；P 切換立直／放平) */
export function tiltFake(on: boolean) {
  if (!on) { fake?.stop(); fake = null; return; }
  if (fake) return;
  const keys = new Set<string>();
  let a = 0, b = 90, g = 0;
  const kd = (e: KeyboardEvent) => { keys.add(e.code); if (e.code === 'KeyP') { b = b > 45 ? 0 : 90; g = 0; } };
  const ku = (e: KeyboardEvent) => { keys.delete(e.code); };
  window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
  const id = window.setInterval(() => {
    const v = 0.9;
    if (keys.has('KeyI')) b -= v; if (keys.has('KeyK')) b += v;
    if (keys.has('KeyJ')) g -= v; if (keys.has('KeyL')) g += v;
    if (keys.has('KeyU')) a += v * 1.5; if (keys.has('KeyO')) a -= v * 1.5;
    st.a = (a + 360) % 360; st.b = b; st.g = Math.max(-89, Math.min(89, g)); st.t = performance.now();
  }, 33);
  fake = { stop: () => { clearInterval(id); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); st.t = -1e9; } };
}
(window as unknown as Record<string, unknown>).__tilt = { live: tiltLive, up: tiltUp, bubble: tiltBubble, fake: tiltFake, st };
