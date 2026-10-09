/**
 * 「Boss 登場」運鏡：小朋友 / 土狗 / 阿伯要靠近腳架時，
 * 鏡頭切到牠們身上 + 黑邊 + 大字幕，再拉到牠們身後看向腳架，最後回到玩家。
 * 之後畫面上方持續顯示危險警示，直到被攔下或撞到腳架。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';
import { audio } from './legacy';

export interface IntroOpts {
  subject: THREE.Object3D;
  target: THREE.Vector3;
  eye: number;          // 主角眼睛高度
  name: string;
  sub: string;
  tagline: string;
  camDir?: THREE.Vector3; // 鏡頭 A 從主角哪一側拍 (預設：腳架方向)
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function el(cls: string, html = ''): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  e.innerHTML = html;
  return e;
}

export function cineActive() { return document.body.classList.contains('cine-active'); }

/** 低沉的「登場」音效 */
function stinger() {
  const a = audio();
  if (!a || !a.enabled) return;
  if (!a.ctx) a.init();
  const c: AudioContext | undefined = a.ctx;
  if (!c) return;
  const t0 = c.currentTime;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.4);
  g.connect(c.destination);
  [55, 82.4, 110].forEach((f, i) => {
    const o = c.createOscillator();
    o.type = i === 0 ? 'sawtooth' : 'triangle';
    o.frequency.setValueAtTime(f * 1.06, t0);
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.5);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    o.connect(lp); lp.connect(g);
    o.start(t0); o.stop(t0 + 1.45);
  });
}

export function playBossIntro(app: GameApp, o: IntroOpts, onDone: () => void) {
  const p = app.player as AnyObj;
  const cam = app.sceneManager.camera;
  if (document.exitPointerLock) document.exitPointerLock();
  document.body.classList.add('cine-active');
  const prevCtl = p.externalControl;
  const prevFov = cam.fov;

  const C = o.subject.position.clone();
  const T = o.target.clone();
  const d = V(T.x - C.x, 0, T.z - C.z).normalize();
  const side = V(-d.z, 0, d.x);
  const look = C.clone().add(V(0, o.eye, 0));

  // 鏡頭 A：在主角正前方 (沿路面，避開高草)，慢慢推近 (登場)
  const fwd = (o.camDir || d).clone().normalize();
  const fside = V(-fwd.z, 0, fwd.x);
  const a0 = C.clone().addScaledVector(fwd, 3.2).addScaledVector(fside, 0.8).add(V(0, o.eye + 0.55, 0));
  const a1 = C.clone().addScaledVector(fwd, 2.0).addScaledVector(fside, 0.45).add(V(0, o.eye + 0.35, 0));
  // 鏡頭 B：主角身後高處，看向腳架 (目標鎖定)
  const b0 = C.clone().addScaledVector(d, -2.6).addScaledVector(side, 1.4).add(V(0, 2.4, 0));
  const b1 = C.clone().addScaledVector(d, -1.6).addScaledVector(side, 1.0).add(V(0, 1.9, 0));
  const mid = C.clone().lerp(T, 0.22).add(V(0, -0.1, 0));

  const root = el('cine');
  root.innerHTML = `
    <div class="cine-bar top"></div><div class="cine-bar bot"></div>
    <div class="cine-flash"></div>
    <div class="cine-title">
      <span class="cine-warn">WARNING</span>
      <strong class="cine-name">${o.name}</strong>
      <span class="cine-sub">${o.sub}</span>
    </div>
    <div class="cine-tag">${o.tagline}</div>
    <div class="cine-skip"><kbd class="cap cap-wide">Space</kbd> 略過</div>`;
  document.body.appendChild(root);
  stinger();

  const A = 1.9, B = 1.5;
  let t = 0;
  let done = false;
  const tmp = new THREE.PerspectiveCamera(); // 相機的 lookAt 是 -Z 朝向目標 (Object3D 是 +Z)
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', onKey, true);
    root.classList.add('out');
    setTimeout(() => root.remove(), 300);
    document.body.classList.remove('cine-active');
    p.externalControl = prevCtl;
    cam.fov = prevFov;
    cam.updateProjectionMatrix();
    cam.position.copy(p.position);
    cam.quaternion.setFromEuler(p.euler);
    try { (app.sceneManager.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需要使用者手勢 */ }
    onDone();
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape' || e.code === 'KeyE') { e.preventDefault(); finish(); }
  };
  window.addEventListener('keydown', onKey, true);
  root.addEventListener('pointerdown', (e) => { e.stopPropagation(); finish(); });
  root.querySelector('.cine-skip')!.innerHTML = (window as AnyObj).__mobile ? '點一下略過' : '<kbd class="cap cap-wide">Space</kbd> 略過';

  const start = performance.now();
  p.externalControl = () => {
    t = (performance.now() - start) / 1000 / ((window as AnyObj).__cineSlow || 1); // __cineSlow：測試用慢動作
    const shotB = t > A;
    root.classList.toggle('shot-b', shotB);
    if (!shotB) {
      const k = t / A;
      const e = 1 - Math.pow(1 - k, 2);
      cam.position.lerpVectors(a0, a1, e);
      tmp.position.copy(cam.position);
      tmp.lookAt(look);
      cam.quaternion.copy(tmp.quaternion);
      cam.fov = 48 - 8 * e;
    } else {
      const k = Math.min(1, (t - A) / B);
      const e = k * k * (3 - 2 * k);
      cam.position.lerpVectors(b0, b1, e);
      tmp.position.copy(cam.position);
      tmp.lookAt(mid);
      cam.quaternion.copy(tmp.quaternion);
      cam.fov = 55;
    }
    // 主角面向腳架、原地踏步
    o.subject.rotation.y = Math.atan2(-(T.z - C.z), T.x - C.x);
    cam.updateProjectionMatrix();
    if (t > A + B) finish();
  };
}

// ------------------------------------------------------------------
// 持續警示：畫面上方紅色橫條 + 主角頭上的驚嘆號
// ------------------------------------------------------------------
let bar: HTMLDivElement | null = null;
const marks = new Map<THREE.Object3D, HTMLDivElement>();

export function setThreat(app: GameApp, list: { obj: THREE.Object3D; h: number; who: string; dist: number; target?: string }[]) {
  if (!list.length || cineActive()) {
    bar?.remove(); bar = null;
    marks.forEach(m => m.remove()); marks.clear();
    document.body.classList.remove('threat');
    return;
  }
  document.body.classList.add('threat');
  if (!bar) {
    bar = el('threat-bar');
    document.body.appendChild(bar);
  }
  const near = list.reduce((a, b) => (a.dist < b.dist ? a : b));
  const tg = near.target || '腳架';
  const how = /狗|阿黃/.test(near.who) ? `跑到${tg}前的<b class="tb-ring">黃圈</b>裡擋住牠`
    : near.who === '小朋友' ? '跑過去擋在他們前面'
      : '回去對他按 <kbd class="cap cap-accent">E</kbd>';
  bar.innerHTML = `<span class="tb-icon">!</span><span class="tb-text"><strong>${near.who}正衝向${tg}</strong>　距離${tg} ${Math.max(0, Math.round(near.dist))} m　${how}</span>`;

  const cam = app.sceneManager.camera;
  const v = V();
  const alive = new Set(list.map(l => l.obj));
  marks.forEach((m, o) => { if (!alive.has(o)) { m.remove(); marks.delete(o); } });
  list.forEach(l => {
    let m = marks.get(l.obj);
    if (!m) { m = el('threat-mark', '!'); document.body.appendChild(m); marks.set(l.obj, m); }
    v.copy(l.obj.position); v.y += l.h;
    v.project(cam);
    const behind = v.z > 1;
    // 畫面外就貼在邊緣，指出方向
    let x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    if (behind) { x = innerWidth - x; y = innerHeight - 40; }
    const off = behind || x < 30 || x > innerWidth - 30 || y < 80 || y > innerHeight - 30;
    x = Math.min(innerWidth - 30, Math.max(30, x));
    y = Math.min(innerHeight - 30, Math.max(80, y));
    m.classList.toggle('edge', off);
    m.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  });
}
