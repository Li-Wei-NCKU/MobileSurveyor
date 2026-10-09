/**
 * 小特效：狗衝刺的塵土、阿伯拿手機拍照 (閃光燈 + 快門聲)
 */
import * as THREE from 'three';
import { audio } from './legacy';

// ------------------------------------------------------------------
// 塵土
// ------------------------------------------------------------------
interface Puff { s: THREE.Sprite; age: number; life: number; vx: number; vy: number; vz: number; grow: number }

class Dust {
  private scene: THREE.Scene | null = null;
  private pool: Puff[] = [];
  private live: Puff[] = [];
  private tex: THREE.CanvasTexture | null = null;
  private acc = new Map<THREE.Object3D, number>();

  init(scene: THREE.Scene) {
    this.scene = scene;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, 'rgba(222,200,160,1)');
    g.addColorStop(0.5, 'rgba(206,180,138,0.7)');
    g.addColorStop(1, 'rgba(196,170,128,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.tex.colorSpace = THREE.SRGBColorSpace;
  }

  /** 跑步中的角色每幀呼叫：依距離吐出塵土 */
  trail(obj: THREE.Object3D, dt: number, rate = 34) {
    const a = (this.acc.get(obj) || 0) + dt * rate;
    let n = Math.floor(a);
    this.acc.set(obj, a - n);
    const back = new THREE.Vector3(-Math.cos(obj.rotation.y), 0, Math.sin(obj.rotation.y));
    while (n-- > 0) {
      const p = obj.position.clone().addScaledVector(back, 0.25 + Math.random() * 0.15);
      p.x += (Math.random() - 0.5) * 0.3; p.z += (Math.random() - 0.5) * 0.3; p.y += 0.25 + Math.random() * 0.15;
      this.puff(p, back);
    }
  }

  private puff(p: THREE.Vector3, back: THREE.Vector3) {
    if (!this.scene || !this.tex) return;
    let f = this.pool.pop();
    if (!f) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0.8 }));
      f = { s, age: 0, life: 1, vx: 0, vy: 0, vz: 0, grow: 1 };
    }
    f.s.position.copy(p);
    f.s.scale.setScalar(0.45 + Math.random() * 0.3);
    f.age = 0;
    f.life = 0.7 + Math.random() * 0.5;
    f.vx = back.x * (0.4 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.5;
    f.vz = back.z * (0.4 + Math.random() * 0.5) + (Math.random() - 0.5) * 0.5;
    f.vy = 0.6 + Math.random() * 0.6;
    f.grow = 2.2 + Math.random() * 1.6;
    (f.s.material as THREE.SpriteMaterial).opacity = 0.9;
    this.scene.add(f.s);
    this.live.push(f);
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) { this.scene?.remove(f.s); this.live.splice(i, 1); this.pool.push(f); continue; }
      f.s.position.x += f.vx * dt; f.s.position.y += f.vy * dt; f.s.position.z += f.vz * dt;
      f.vy *= 0.96;
      f.s.scale.addScalar(f.grow * dt * 0.5);
      (f.s.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - k) * (1 - k);
    }
  }
}
export const dust = new Dust();

// ------------------------------------------------------------------
// 阿伯拿手機拍照
// ------------------------------------------------------------------
function shutterSound() {
  const a = audio();
  if (!a || !a.enabled) return;
  if (!a.ctx) a.init();
  const c: AudioContext | undefined = a.ctx;
  if (!c) return;
  // 「咔—嚓」：兩段短噪音 + 機械 click
  [0, 0.09].forEach((t0, i) => {
    const len = 0.05;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * Math.pow(1 - k / d.length, 3);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = i ? 2600 : 4200; bp.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = i ? 0.35 : 0.28;
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(c.currentTime + t0);
  });
}

/** 阿伯舉起手機拍 shots 張 (每張閃光 + 快門聲)，結束後收手機並呼叫 onDone */
export function phonePhoto(scene: THREE.Scene, person: THREE.Group, shots: number, onDone: () => void) {
  const arms = person.userData.arms as THREE.Object3D[] | undefined;
  const arm = arms?.[1];
  if (!arm) { onDone(); return; }
  // 手機 (背面有鏡頭和閃光燈，朝 +X 也就是阿伯面對的方向)
  const phone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.15, 0.075), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.3 }));
  phone.add(body);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.138), new THREE.MeshBasicMaterial({ color: 0x86b7ff }));
  screen.rotation.y = -Math.PI / 2; screen.position.x = -0.007;
  phone.add(screen);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.008, 12), new THREE.MeshBasicMaterial({ color: 0x0b0b0b }));
  lens.rotation.y = Math.PI / 2; lens.position.set(0.0065, 0.05, 0.02);
  phone.add(lens);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.005, 10), ledMat);
  led.rotation.y = Math.PI / 2; led.position.set(0.0066, 0.05, -0.002);
  phone.add(led);
  phone.position.set(0.56, 1.66, 0.06);
  phone.visible = false;
  person.add(phone);
  const light = new THREE.PointLight(0xffffff, 0, 9, 1.6);
  light.position.set(0.62, 1.7, 0.05);
  person.add(light);
  const flashEl = document.createElement('div');
  flashEl.className = 'photo-flash';
  document.body.appendChild(flashEl);

  const t0 = performance.now();
  const raise = 0.45, gap = 0.75, start = 0.9;
  const end = start + shots * gap + 0.4;
  const fired = new Set<number>();
  const step = () => {
    const t = (performance.now() - t0) / 1000 / ((window as unknown as { __fxSlow?: number }).__fxSlow || 1); // __fxSlow：測試用慢動作
    // 舉手 / 放手
    const up = t < end ? Math.min(1, t / raise) : Math.max(0, 1 - (t - end) / raise);
    arm.rotation.z = 1.85 * up;   // 手往前舉到臉的高度
    arm.rotation.y = 0.34 * up;   // 往身體中線收
    phone.visible = up > 0.6;
    for (let i = 0; i < shots; i++) {
      const ts = start + i * gap;
      if (t >= ts && !fired.has(i)) {
        fired.add(i);
        shutterSound();
        flashEl.classList.remove('on'); void flashEl.offsetWidth; flashEl.classList.add('on');
      }
      const k = t - ts;
      if (k >= 0 && k < 0.18) { light.intensity = 60 * (1 - k / 0.18); ledMat.color.setHex(0xffffff); }
    }
    if (![...Array(shots).keys()].some(i => { const k = t - (start + i * gap); return k >= 0 && k < 0.18; })) { light.intensity = 0; ledMat.color.setHex(0x555555); }
    if (t < end + raise) { requestAnimationFrame(step); return; }
    person.remove(phone); person.remove(light); flashEl.remove();
    arm.rotation.set(0, 0, 0);
    void scene;
    onDone();
  };
  step();
}

// ------------------------------------------------------------------
// 地上的提示圈 (站位、架站建議位置、轉點)
// ------------------------------------------------------------------
export class GroundRing {
  g = new THREE.Group();
  private ring: THREE.Mesh;
  private disc: THREE.Mesh;
  private label: THREE.Sprite;
  private labelText = '';
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  x = 0; z = 0;
  constructor(private scene: THREE.Scene, private heightAt: (x: number, z: number) => number, color: number, public r = 0.9) {
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.14, r, 48), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(r - 0.14, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    this.disc.rotation.x = -Math.PI / 2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    beam.position.y = 2.5;
    this.canvas.width = 512; this.canvas.height = 96;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false }));
    this.label.scale.set(2.4, 0.45, 1);
    this.label.position.y = 2.3;
    this.label.renderOrder = 10;
    this.g.add(this.ring, this.disc, beam, this.label);
    this.g.visible = false;
    this.g.renderOrder = 5;
    scene.add(this.g);
  }
  private draw(text: string, color: string) {
    if (text === this.labelText) return;
    this.labelText = text;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 512, 96);
    c.font = 'bold 44px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    const w = Math.min(500, c.measureText(text).width + 40);
    c.fillStyle = 'rgba(20,24,32,0.82)';
    c.beginPath(); (c as AnyCtx).roundRect?.((512 - w) / 2, 10, w, 76, 16); c.fill();
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 256, 50);
    this.tex.needsUpdate = true;
  }
  show(x: number, z: number, text: string, color = '#ffe08a') {
    this.x = x; this.z = z;
    this.g.position.set(x, this.heightAt(x, z) + 0.06, z);
    this.draw(text, color);
    this.g.visible = true;
  }
  hide() { this.g.visible = false; }
  get visible() { return this.g.visible; }
  contains(x: number, z: number, extra = 0) { return Math.hypot(x - this.x, z - this.z) <= this.r + extra; }
  /** 每幀呼叫：呼吸閃爍；ok = 玩家在圈內 */
  update(t: number, ok = false) {
    if (!this.g.visible) return;
    const k = 1 + Math.sin(t * 6) * 0.06;
    this.ring.scale.setScalar(ok ? 1 : k);
    (this.disc.material as THREE.MeshBasicMaterial).opacity = ok ? 0.5 : 0.18 + 0.1 * Math.sin(t * 6);
  }
  dispose() { this.scene.remove(this.g); }
}
type AnyCtx = CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };

// ------------------------------------------------------------------
// 大車經過的低頻轟隆聲 (音量依距離)
// ------------------------------------------------------------------
export class Rumble {
  private n: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  start() {
    if (this.n) return;
    const a = audio();
    if (!a || !a.enabled) return;
    if (!a.ctx) a.init();
    const c: AudioContext | undefined = a.ctx;
    if (!c) return;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // 棕色噪音
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const gain = c.createGain(); gain.gain.value = 0;
    src.connect(lp); lp.connect(gain); gain.connect(c.destination);
    src.start();
    this.n = { src, gain };
  }
  setDistance(dist: number) {
    if (!this.n) return;
    const v = Math.max(0, Math.min(0.5, 6 / Math.max(6, dist) - 0.04));
    this.n.gain.gain.setTargetAtTime(v, this.n.gain.context.currentTime, 0.15);
  }
  stop() {
    if (!this.n) return;
    const { src, gain } = this.n;
    gain.gain.setTargetAtTime(0, gain.context.currentTime, 0.2);
    src.stop(gain.context.currentTime + 1);
    this.n = null;
  }
}
