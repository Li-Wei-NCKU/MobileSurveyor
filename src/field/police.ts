/**
 * 警車：白底藍條、車頂紅藍警示燈、警笛聲。
 * 沿著路徑開到現場 (產業道路)，停好後讓警察下車；處理完再倒車回大路開走。
 */
import * as THREE from 'three';
import { SM, audio } from './legacy';
import { buildSedan } from './npc';

function label(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#123a8c';
  x.font = 'bold 40px "Noto Sans TC","Microsoft JhengHei",sans-serif';
  x.textBaseline = 'middle';
  x.fillText('警察', 12, 34);
  x.font = 'bold 30px Arial,sans-serif';
  x.fillText('POLICE', 112, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildPoliceCar(): THREE.Group {
  const sm = SM();
  const g = buildSedan(0xf4f6f8);
  const blue = new THREE.MeshStandardMaterial({ color: 0x1f4fbf, roughness: 0.4, metalness: 0.2 });
  // 車身藍色腰線 + 門上「警察 POLICE」
  const tex = label();
  [-1, 1].forEach(side => {
    g.add(sm.mk(new THREE.BoxGeometry(4.3, 0.12, 0.02), blue, 0, 0.62, side * 0.885, true));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.37), new THREE.MeshBasicMaterial({ map: tex }));
    plate.position.set(-0.15, 0.82, side * 0.89);
    if (side < 0) plate.rotation.y = Math.PI;
    g.add(plate);
  });
  // 車頂警示燈
  g.add(sm.mk(new THREE.BoxGeometry(0.34, 0.06, 1.25), sm.M.black, -0.2, 1.47, 0));
  const red = new THREE.MeshStandardMaterial({ color: 0x661010, emissive: 0xff1a1a, emissiveIntensity: 0.2 });
  const blu = new THREE.MeshStandardMaterial({ color: 0x0d1f66, emissive: 0x1a5cff, emissiveIntensity: 0.2 });
  g.add(sm.mk(new THREE.BoxGeometry(0.28, 0.12, 0.55), red, -0.2, 1.56, -0.32, true));
  g.add(sm.mk(new THREE.BoxGeometry(0.28, 0.12, 0.55), blu, -0.2, 1.56, 0.32, true));
  const lr = new THREE.PointLight(0xff2020, 0, 16, 1.5); lr.position.set(-0.2, 1.9, -0.5); g.add(lr);
  const lb = new THREE.PointLight(0x2a6bff, 0, 16, 1.5); lb.position.set(-0.2, 1.9, 0.5); g.add(lb);
  g.userData.flash = (t: number) => {
    // 紅藍交替，每邊快閃兩下
    const ph = (t * 2.2) % 1;
    const on = (a: number) => (ph > a && ph < a + 0.09) || (ph > a + 0.16 && ph < a + 0.25);
    const r = on(0), b = on(0.5);
    red.emissiveIntensity = r ? 3 : 0.2; blu.emissiveIntensity = b ? 3 : 0.2;
    lr.intensity = r ? 30 : 0; lb.intensity = b ? 30 : 0;
  };
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}

/** 警笛 (台灣警車的「嗚咿嗚咿」)：音量依距離調整 */
export class Siren {
  private nodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode } | null = null;
  start() {
    if (this.nodes) return;
    const a = audio();
    if (!a || !a.enabled) return;
    if (!a.ctx) a.init();
    const c: AudioContext | undefined = a.ctx;
    if (!c) return;
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 1000;
    const lfo = c.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 1.7;
    const depth = c.createGain(); depth.gain.value = 380;
    lfo.connect(depth); depth.connect(osc.frequency);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
    const gain = c.createGain(); gain.gain.value = 0;
    osc.connect(lp); lp.connect(gain); gain.connect(c.destination);
    osc.start(); lfo.start();
    this.nodes = { osc, lfo, gain };
  }
  setDistance(d: number) {
    if (!this.nodes) return;
    const v = Math.max(0.006, Math.min(0.09, 1.6 / Math.max(6, d)));
    this.nodes.gain.gain.setTargetAtTime(v, this.nodes.gain.context.currentTime, 0.1);
  }
  stop(fade = 0.6) {
    if (!this.nodes) return;
    const { osc, lfo, gain } = this.nodes;
    const t = gain.context.currentTime;
    gain.gain.setTargetAtTime(0, t, fade / 4);
    osc.stop(t + fade + 0.1); lfo.stop(t + fade + 0.1);
    this.nodes = null;
  }
}

export type CarStage = 'come' | 'parked' | 'leave' | 'gone';

/** 從大路開進產業道路 (第一天現場)；路徑最後一點就是停車位置 */
export const POLICE_IN: [number, number][] = [[150, 46.3], [8, 46.3], [-5.5, 46.0], [-8.6, 42.5], [-9.2, 34], [-9.1, 23.5]];
/** 倒車回大路 (車頭仍朝產業道路)，再往 -X 開走 */
export const POLICE_BACK: [number, number][] = [[-9.2, 32], [-8.7, 41.5], [-6.5, 45.2]];
export const POLICE_OUT: [number, number][] = [[-20, 46.3], [-170, 46.3]];

export interface PoliceRoute {
  path: [number, number][];
  /** 從第幾個路徑點開始慢下來 */
  slowFrom: number;
  siren: boolean;
  /** true = 開過去就消失 (巡邏經過)；false = 開到終點停車 */
  pass: boolean;
}
const DAY1: PoliceRoute = { path: POLICE_IN, slowFrom: 3, siren: true, pass: false };

export class PoliceCar {
  g = buildPoliceCar();
  stage: CarStage = 'come';
  private path: [number, number][];
  private i = 1;
  private speed = 13;
  private reverse = false;
  private out: [number, number][] | null = null;
  heading = Math.PI; // 朝 -X
  t = 0;
  siren = new Siren();
  lights = true;

  constructor(private scene: THREE.Scene, private heightAt: (x: number, z: number) => number, private route: PoliceRoute = DAY1) {
    this.path = route.path;
    const [x, z] = route.path[0], [x1, z1] = route.path[1];
    this.place(x, z, dirHeading(x1 - x, z1 - z));
    scene.add(this.g);
  }

  get x() { return this.g.position.x; }
  get z() { return this.g.position.z; }

  place(x: number, z: number, heading = this.heading) {
    this.heading = heading;
    this.g.position.set(x, this.heightAt(x, z), z);
    this.g.rotation.y = heading;
  }

  /** 讀檔用：直接停在終點 */
  parkNow() {
    const [x, z] = POLICE_IN[POLICE_IN.length - 1];
    this.place(x, z, dirHeading(0, -1)); // 車頭朝 -Z (往現場)
    this.stage = 'parked';
  }

  /** 離開：預設倒車回大路再開走 (第一天)；給 forward 就直接往前開 */
  leave(forward?: [number, number][]) {
    if (this.stage === 'leave' || this.stage === 'gone') return;
    this.stage = 'leave';
    this.i = 1;
    this.speed = 0;
    if (forward) { this.path = [[this.x, this.z], ...forward]; this.reverse = false; this.out = forward; return; }
    this.path = [[this.x, this.z], ...POLICE_BACK];
    this.reverse = true;
  }

  /** blockAt：前方擋路的位置 (作業車)，太近就提早停 */
  update(dt: number, playerDist: number, blockAt?: { x: number; z: number } | null) {
    this.t += dt;
    if (this.lights) (this.g.userData.flash as (t: number) => void)(this.t);
    if (this.stage === 'come' && this.route.siren) { this.siren.start(); this.siren.setDistance(playerDist); }
    if (this.stage === 'parked' || this.stage === 'gone') return;

    const [tx, tz] = this.path[this.i];
    const dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
    const last = this.i === this.path.length - 1;
    // 速度：最後一段減速
    const leaving = this.path === POLICE_OUT || this.stage === 'leave';
    let want = this.reverse ? 2.6 : leaving ? 12 : (this.i >= this.route.slowFrom ? 4.5 : 13);
    if (this.stage === 'come' && this.route.pass && this.i > this.route.slowFrom) want = 12; // 巡邏：經過之後加速離開
    if (last && !this.reverse && !leaving && !this.route.pass) want = Math.min(want, Math.max(0.6, d * 0.9));
    if (this.stage === 'come' && blockAt) {
      const fx = Math.cos(this.heading), fz = -Math.sin(this.heading);
      const ahead = (blockAt.x - this.x) * fx + (blockAt.z - this.z) * fz;
      const side = Math.abs((blockAt.x - this.x) * fz - (blockAt.z - this.z) * fx);
      if (ahead > 0 && ahead < 8 && side < 2.6) { this.arrive(); return; }
    }
    this.speed += Math.max(-8 * dt, Math.min(5 * dt, want - this.speed));
    const st = Math.min(d, this.speed * dt);
    const nx = this.x + dx / (d || 1) * st, nz = this.z + dz / (d || 1) * st;
    // 車頭方向：前進時朝移動方向，倒車時朝反方向；平滑轉向
    let hd = dirHeading(dx, dz);
    if (this.reverse) hd += Math.PI;
    let dh = hd - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.place(nx, nz, this.heading + dh * Math.min(1, dt * (this.reverse ? 2.2 : 4)));
    if (d < 0.4) {
      if (!last) { this.i++; return; }
      if (this.stage === 'come' && !this.route.pass) { this.arrive(); return; }
      if (this.reverse) { this.reverse = false; this.path = [[this.x, this.z], ...POLICE_OUT]; this.i = 1; this.speed = 1; return; }
      void this.out;
      // 開出視野
      this.stage = 'gone';
      this.dispose();
    }
  }

  private arrive() {
    this.stage = 'parked';
    this.speed = 0;
    setTimeout(() => this.siren.stop(1.2), 1500);
  }

  /** 駕駛座車門 (左側) 外的位置 */
  doorPos(): THREE.Vector3 {
    this.g.updateMatrixWorld();
    const v = this.g.localToWorld(new THREE.Vector3(0.35, 0, -1.4));
    v.y = this.heightAt(v.x, v.z);
    return v;
  }

  /** 車頭左前方 (下車後先走到這裡，才不會穿過車身) */
  frontPos(): THREE.Vector3 {
    this.g.updateMatrixWorld();
    const v = this.g.localToWorld(new THREE.Vector3(3.0, 0, -1.3));
    v.y = this.heightAt(v.x, v.z);
    return v;
  }

  dispose() {
    this.siren.stop(0.2);
    this.scene.remove(this.g);
  }
}

/** 面向 (dx,dz) 時的 rotation.y (模型朝 +X) */
export function dirHeading(dx: number, dz: number) { return Math.atan2(-dz, dx); }
