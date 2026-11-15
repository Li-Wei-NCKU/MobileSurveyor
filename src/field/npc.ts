/**
 * NPC：路上的車流 (轎車、機車) 與路人阿伯
 */
import * as THREE from 'three';
import { SM } from './legacy';
import { buildPersonModel, type PersonLook } from './person';
import { mergeOutlines } from '../mobile/toon';

const ROAD_Z = 48;

/** 車窗玻璃 (所有車輛共用)：淺色、帶一點反光 */
let _glass: THREE.MeshStandardMaterial | null = null;
export function carGlass(): THREE.MeshStandardMaterial {
  if (!_glass) _glass = new THREE.MeshStandardMaterial({ color: 0xb4cfdd, roughness: 0.08, metalness: 0.3, envMapIntensity: 1.2, side: THREE.DoubleSide });
  return _glass;
}

export function buildSedan(color: number): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-2.2, 0.35); s.lineTo(-2.25, 0.85); s.quadraticCurveTo(-2.1, 0.95, -1.4, 0.98);
  s.lineTo(-0.9, 1.42); s.lineTo(0.55, 1.44); s.lineTo(1.15, 0.98); s.lineTo(2.1, 0.88);
  s.quadraticCurveTo(2.28, 0.8, 2.25, 0.35);
  s.lineTo(1.75, 0.35); s.absarc(1.35, 0.33, 0.4, 0, Math.PI, false);
  s.lineTo(-0.95, 0.35); s.absarc(-1.35, 0.33, 0.4, 0, Math.PI, false); s.lineTo(-2.2, 0.35);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 12 });
  geo.translate(0, 0, -0.81);
  g.add(sm.mk(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.4 })));
  const win = new THREE.Shape();
  win.moveTo(-1.25, 1.0); win.lineTo(-0.85, 1.36); win.lineTo(0.5, 1.38); win.lineTo(1.0, 1.0); win.lineTo(-1.25, 1.0);
  const wg = new THREE.ExtrudeGeometry(win, { depth: 1.76, bevelEnabled: false });
  wg.translate(0, 0, -0.88);
  g.add(sm.mk(wg, carGlass(), 0, 0, 0, true));
  // 前後擋風玻璃：沿車身斜面往外偏一點 (車身有 0.06 倒角)
  const wsMat = carGlass();
  const pane = (ax: number, ay: number, bx: number, by: number, out: 1 | -1) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    // 外側法線
    let nx = -dy / L, ny = dx / L;
    if (nx * out < 0) { nx = -nx; ny = -ny; }
    const off = 0.075, zw = 0.7;
    const p = (t: number) => [ax + dx * t + nx * off, ay + dy * t + ny * off];
    const [x0, y0] = p(0.06), [x1, y1] = p(0.94);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, -zw, x0, y0, zw, x1, y1, -zw, x1, y1, zw], 3));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    geo.computeVertexNormals();
    g.add(sm.mk(geo, wsMat, 0, 0, 0, true));
  };
  pane(0.55, 1.44, 1.15, 0.98, 1);    // 前擋風玻璃 (朝 +X 前上方)
  pane(-1.4, 0.98, -0.9, 1.42, -1);   // 後擋風玻璃
  const tire = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 20).rotateX(Math.PI / 2);
  [1.35, -1.35].forEach(x => [-0.78, 0.78].forEach(z => g.add(sm.mk(tire, sm.M.tire, x, 0.33, z))));
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.8 });
  [-0.6, 0.6].forEach(z => g.add(sm.mk(new THREE.BoxGeometry(0.06, 0.1, 0.32), lamp, 2.29, 0.72, z, true)));
  return g;
}

export function buildScooter(who?: { shirt: number; pants: number; skin?: number; body?: number }): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  // 車身是一整片側面輪廓擠出來的 (前擋板 → 踏板 → 座墊下的後車身)，邊緣倒圓，零件越少越好
  const bodyMat = new THREE.MeshStandardMaterial({ color: who?.body ?? 0xc62828, roughness: 0.35, metalness: 0.15 });
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0.22);
  s.lineTo(0.36, 0.22);
  s.quadraticCurveTo(0.5, 0.22, 0.53, 0.34);
  s.quadraticCurveTo(0.68, 0.4, 0.7, 0.56);
  s.quadraticCurveTo(0.71, 0.96, 0.58, 1.0);
  s.lineTo(0.52, 0.99);
  s.quadraticCurveTo(0.45, 0.97, 0.45, 0.86);
  s.lineTo(0.42, 0.4);
  s.quadraticCurveTo(0.41, 0.3, 0.33, 0.3);
  s.lineTo(0.08, 0.3);
  s.quadraticCurveTo(0.01, 0.3, 0.0, 0.4);
  s.lineTo(-0.02, 0.6);
  s.quadraticCurveTo(-0.03, 0.68, -0.12, 0.68);
  s.lineTo(-0.6, 0.69);
  s.quadraticCurveTo(-0.84, 0.69, -0.86, 0.55);
  s.quadraticCurveTo(-0.86, 0.45, -0.74, 0.45);
  s.lineTo(-0.42, 0.45);
  s.quadraticCurveTo(-0.3, 0.45, -0.3, 0.22);
  const W = 0.3, bev = 0.06;
  const bg = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 4, curveSegments: 10 });
  bg.translate(0, 0, -W / 2);
  g.add(sm.mk(bg, bodyMat));
  // 座墊
  g.add(sm.mk(sm.rbox(0.6, 0.08, 0.34, 0.04), sm.M.black, -0.4, 0.73, 0));
  // 車頭：龍頭 (一根橫桿＋兩個握把) 和大燈罩
  const dark = sm.M.aluDark;
  g.add(sm.rodBetween(new THREE.Vector3(0.5, 0.93, 0), new THREE.Vector3(0.3, 1.03, 0), 0.03, 0.03, dark, 8));
  g.add(sm.mk(new THREE.CylinderGeometry(0.016, 0.016, 0.6, 8).rotateX(Math.PI / 2), dark, 0.26, 1.04, 0));
  [-1, 1].forEach(sd => g.add(sm.mk(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 10).rotateX(Math.PI / 2), sm.M.black, 0.26, 1.04, sd * 0.27)));
  g.add(sm.mk(sm.rbox(0.16, 0.11, 0.26, 0.05), bodyMat, 0.33, 1.07, 0));
  // 前叉、輪子 (輪子只有胎和輪圈)
  g.add(sm.rodBetween(new THREE.Vector3(0.63, 0.21, 0), new THREE.Vector3(0.6, 0.5, 0), 0.025, 0.025, dark, 8));
  const tire = new THREE.CylinderGeometry(0.21, 0.21, 0.1, 22).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.1, 0.1, 0.105, 14).rotateX(Math.PI / 2);
  [0.63, -0.58].forEach(x => { g.add(sm.mk(tire, sm.M.tire, x, 0.21, 0)); g.add(sm.mk(hub, sm.M.alu, x, 0.21, 0, true)); });
  // 尾燈
  g.add(sm.mk(sm.rbox(0.04, 0.06, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.3, emissive: 0x440000 }), -0.88, 0.58, 0, true));
  const rider = buildPerson({ shirt: who?.shirt ?? 0x1565c0, pants: who?.pants ?? 0x263238, hat: 'helmet', skin: who?.skin });
  // 坐姿：屁股坐在座墊上，大腿往前平放，小腿垂直、腳踩在踏板上；兩手往前握住龍頭
  rider.position.set(-0.18, -0.01, 0);
  rider.userData.legs.forEach((l: THREE.Object3D) => { l.rotation.z = 1.3; });
  (rider.userData.knees as THREE.Object3D[]).forEach(k => { k.rotation.z = -1.3; });
  (rider.userData.arms as THREE.Object3D[]).forEach((a, i) => { a.rotation.z = 0.99; a.rotation.x = i === 1 ? -0.17 : 0.17; });
  (rider.userData.elbows as THREE.Object3D[]).forEach(e => { e.rotation.z = 0.05; });
  g.add(rider);
  g.userData.rider = rider;
  mergeOutlines(g);
  return g;
}

/** 人物；userData.legs/arms/knees/elbows 供走路動畫 (模型在 person.ts) */
export function buildPerson(o: PersonLook): THREE.Group {
  return buildPersonModel(o);
}

(window as unknown as Record<string, unknown>).__person = { build: buildPerson, walk: (p: THREE.Group, t: number, v: number) => animateWalk(p, t, v), scooter: (w?: AnyLook) => buildScooter(w), sedan: (c: number) => buildSedan(c) };
type AnyLook = Parameters<typeof buildScooter>[0];

/**
 * 拿東西的位置 (人物座標：面向 +X，右手在 +Z)。姿勢和放東西的地方都用這組數字，手才會剛好碰到東西。
 *  shoulder：右肩頂 (扛腳架、標尺)；front：兩手掌心上方 (捧箱子)
 */
export const CARRY = {
  shoulder: new THREE.Vector3(0, 1.36, 0.23),
  front: new THREE.Vector3(0.33, 1.13, 0),
};
const _v = new THREE.Vector3();
/**
 * 把東西擺到掛點上 (先設好 rotation/scale 再呼叫)：
 *  shoulder = 底面貼在肩上、後段長一點；front = 底面放在兩手上；hang = 頂面 (提把) 握在拳頭裡
 */
export function fitCarry(h: THREE.Object3D, mode: 'shoulder' | 'front' | 'hang', back = 0.1) {
  h.position.set(0, 0, 0);
  const par = h.parent; if (par) par.remove(h);
  h.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(h), c = bb.getCenter(new THREE.Vector3());
  if (mode === 'shoulder') h.position.set(-c.x - back, -bb.min.y, -c.z);
  else if (mode === 'front') h.position.set(-c.x, -bb.min.y, -c.z);
  else h.position.set(-c.x, -bb.max.y + 0.035, -c.z);
  if (par) par.add(h);
}
/** 手 (拳頭中心) 在人物座標的位置 */
export function handLocal(p: THREE.Object3D, i: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
  const arm = (p.userData.arms as THREE.Object3D[])[i], el = (p.userData.elbows as THREE.Object3D[] | undefined)?.[i];
  out.set(0, -0.27, 0);
  if (el) { el.updateMatrix(); out.applyMatrix4(el.matrix); } else out.y -= 0.25;
  arm.updateMatrix(); return out.applyMatrix4(arm.matrix);
}

/** 一隻手臂的姿勢：z = 往前抬 (弧度)，x = 往外張，e = 手肘彎 */
function setArm(p: THREE.Object3D, i: 0 | 1, z: number, x: number, e: number) {
  const arm = (p.userData.arms as THREE.Object3D[])[i];
  arm.rotation.z = z; arm.rotation.x = i === 1 ? -x : x;     // 右手 (+Z) 往外張是負的
  const el = (p.userData.elbows as THREE.Object3D[] | undefined)?.[i];
  if (el) el.rotation.z = e;
}

export function animateWalk(p: THREE.Group, t: number, speed: number) {
  const s = Math.min(1, speed);
  const a = Math.sin(t * 7) * 0.5 * s;
  const legs = p.userData.legs as THREE.Object3D[];
  legs[0].rotation.z = a; legs[1].rotation.z = -a;
  // 膝蓋：腳往前擺的那一段會彎
  const knees = p.userData.knees as THREE.Object3D[] | undefined;
  if (knees) { const c = Math.cos(t * 7) * s; knees[0].rotation.z = -Math.max(0, c) * 0.75; knees[1].rotation.z = -Math.max(0, -c) * 0.75; }
  const free = 0.12 + 0.3 * s;          // 空手走路時手肘微彎
  // 兩手各自的姿勢 (0 = 左手、1 = 右手)
  //   swing：空手擺動；side：提著東西 (手往外張一點，東西才不會撞到腳)；shoulder：右手往上扶住肩上的東西；front：兩手在身前托住箱子
  type Arm = 'swing' | 'side' | 'shoulder' | 'front' | 'clip';
  const pose = p.userData.pose as string | undefined;
  const L: Arm = pose === 'carryFront' ? 'front' : pose === 'carryHand' ? 'clip' : (pose === 'carrySideBoth' || pose === 'carryShoulderBoth' || pose === 'carryLeft') ? 'side' : 'swing';
  const R: Arm = pose === 'carryFront' ? 'front' : (pose === 'carryShoulder' || pose === 'carryShoulderBoth') ? 'shoulder' : (pose === 'carrySide' || pose === 'carrySideBoth') ? 'side' : 'swing';
  for (const [i, m] of [[0, L], [1, R]] as [0 | 1, Arm][]) {
    const sw = i === 0 ? -a : a;
    if (m === 'swing') setArm(p, i, sw * 0.8, 0, free);
    else if (m === 'side') setArm(p, i, sw * 0.12, 0.25, 0.06);
    else if (m === 'clip') setArm(p, i, sw * 0.15, -0.12, 0.06);
    // 肩上的東西：上臂幾乎垂下、前臂往上折，手托在肩上東西的前段下面
    else if (m === 'shoulder') setArm(p, i, 0.24, 0.07, 2.27);
    // 捧箱子：上臂垂下、前臂水平往前，兩手掌心朝上
    else setArm(p, i, 0.2, -0.02, 1.34);
  }
  // 手上掛東西的點跟著手走 (只移動，不轉，提著的東西才會一直垂直)
  const hs = p.userData.handAnchors as (THREE.Object3D | undefined)[] | undefined;
  if (hs) for (const i of [0, 1] as const) if (hs[i]) hs[i]!.position.copy(handLocal(p, i, _v));
}

export interface Blocker { x: number; z: number; r: number }

/** 路上車流：沿道路單向循環行駛，前方被擋會停車按喇叭 */
export class TrafficVehicle {
  group: THREE.Group;
  x: number;
  speed = 0;
  blockedTime = 0;
  honkCooldown = 0;
  constructor(public kind: 'car' | 'scooter', public dir: 1 | -1, public cruise: number, startX: number, private heightAt: (x: number, z: number) => number, color = 0x37474f) {
    this.group = kind === 'car' ? buildSedan(color) : buildScooter();
    this.x = startX;
    this.speed = cruise;
    this.group.rotation.y = dir > 0 ? 0 : Math.PI;
  }
  get z() { return ROAD_Z + (this.dir > 0 ? 1.7 : -1.7); }

  /** 回傳 true 表示這一幀按了喇叭 */
  update(dt: number, truck: { x: number; z: number } | null, playerInRoad: { x: number; z: number } | null): boolean {
    let target = this.cruise;
    let blocked = false;
    for (const b of [truck, playerInRoad]) {
      if (!b) continue;
      const ahead = (b.x - this.x) * this.dir;
      if (Math.abs(b.z - this.z) < (b === truck ? 2.4 : 1.2) && ahead > 0 && ahead < 26) {
        blocked = true;
        target = ahead < 9 ? 0 : Math.min(target, (ahead - 9) * 0.8);
      }
    }
    this.speed += Math.max(-9 * dt, Math.min(4 * dt, target - this.speed));
    this.x += this.dir * this.speed * dt;
    if (this.x > 370) this.x = -370;
    if (this.x < -370) this.x = 370;
    this.group.position.set(this.x, this.heightAt(this.x, this.z), this.z);

    let honk = false;
    this.honkCooldown -= dt;
    if (blocked && this.speed < 0.5) {
      this.blockedTime += dt;
      if (this.blockedTime > 1.2 && this.honkCooldown <= 0) { honk = true; this.honkCooldown = 2.2; }
    } else {
      this.blockedTime = 0;
    }
    return honk;
  }
}

export { ROAD_Z };

/** 低多邊形土狗；userData.legs 供跑步動畫 (面向 +X) */
export function buildDog(): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.9 });
  const light = new THREE.MeshStandardMaterial({ color: 0xe8d3b0, roughness: 0.9 });
  g.add(sm.mk(sm.rbox(0.62, 0.26, 0.24, 0.1), fur, 0, 0.46, 0));
  g.add(sm.mk(sm.rbox(0.3, 0.12, 0.2, 0.05), light, 0.08, 0.36, 0));
  const head = new THREE.Group();
  head.position.set(0.36, 0.62, 0);
  head.add(sm.mk(sm.rbox(0.22, 0.2, 0.2, 0.07), fur, 0, 0, 0));
  head.add(sm.mk(sm.rbox(0.14, 0.1, 0.12, 0.04), light, 0.13, -0.04, 0));
  head.add(sm.mk(new THREE.SphereGeometry(0.022, 8, 6), sm.M.black, 0.21, -0.02, 0, true));
  [-0.06, 0.06].forEach(z => {
    head.add(sm.mk(new THREE.ConeGeometry(0.045, 0.1, 4), fur, -0.02, 0.13, z));
    head.add(sm.mk(new THREE.SphereGeometry(0.016, 6, 4), sm.M.black, 0.09, 0.04, z * 0.9, true));
  });
  g.add(head);
  const tail = sm.rodBetween(new THREE.Vector3(-0.3, 0.52, 0), new THREE.Vector3(-0.46, 0.7, 0), 0.03, 0.018, fur, 6);
  g.add(tail);
  const legs: THREE.Object3D[] = [];
  [[0.22, -0.08], [0.22, 0.08], [-0.22, -0.08], [-0.22, 0.08]].forEach(([x, z]) => {
    const hip = new THREE.Group(); hip.position.set(x, 0.38, z);
    hip.add(sm.mk(sm.rbox(0.07, 0.36, 0.07, 0.03), fur, 0, -0.18, 0));
    g.add(hip); legs.push(hip);
  });
  g.userData.legs = legs;
  g.userData.arms = [];
  g.userData.dog = true;
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}

export function animateDog(d: THREE.Group, t: number, speed: number) {
  const a = Math.sin(t * 14) * 0.6 * Math.min(1, speed);
  const legs = d.userData.legs as THREE.Object3D[];
  legs[0].rotation.z = a; legs[3].rotation.z = a; legs[1].rotation.z = -a; legs[2].rotation.z = -a;
}

/** 大貨車 (面向 +X)：車頭 + 貨斗，六輪 */
export function buildLorry(): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.4, metalness: 0.3 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.7 });
  // 車架
  g.add(sm.mk(new THREE.BoxGeometry(7.6, 0.25, 1.9), sm.M.black, -0.3, 0.75, 0));
  // 車頭
  g.add(sm.mk(sm.rbox(1.9, 2.0, 2.3, 0.12), cabMat, 2.6, 1.85, 0));
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.85), carGlass());
  ws.position.set(3.56, 2.3, 0); ws.rotation.y = Math.PI / 2;
  g.add(ws);
  [-1, 1].forEach(s => {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), carGlass());
    side.position.set(2.85, 2.3, s * 1.16); if (s < 0) side.rotation.y = Math.PI;
    g.add(side);
  });
  g.add(sm.mk(new THREE.BoxGeometry(0.1, 0.35, 2.2), sm.M.darkGrey ?? sm.M.black, 3.58, 1.15, 0));
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.8 });
  [-0.85, 0.85].forEach(z => g.add(sm.mk(new THREE.BoxGeometry(0.06, 0.16, 0.34), lamp, 3.6, 1.15, z, true)));
  // 貨斗
  g.add(sm.mk(new THREE.BoxGeometry(5.2, 2.5, 2.4), boxMat, -1.25, 2.15, 0));
  g.add(sm.mk(new THREE.BoxGeometry(5.22, 0.18, 2.42), cabMat, -1.25, 1.0, 0, true));
  // 輪子
  const tire = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 20).rotateX(Math.PI / 2);
  [2.5, -1.9, -3.1].forEach(x => [-1.0, 1.0].forEach(z => g.add(sm.mk(tire, sm.M.tire, x, 0.5, z))));
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}
