/**
 * NPC：路上的車流 (轎車、機車) 與路人阿伯
 */
import * as THREE from 'three';
import { SM } from './legacy';

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
  const bodyMat = new THREE.MeshStandardMaterial({ color: who?.body ?? 0xc62828, roughness: 0.35, metalness: 0.2 });
  g.add(sm.mk(sm.rbox(1.1, 0.3, 0.36, 0.08), bodyMat, -0.1, 0.55, 0));
  g.add(sm.mk(sm.rbox(0.5, 0.12, 0.3, 0.05), sm.M.black, -0.2, 0.76, 0));
  g.add(sm.rodBetween(new THREE.Vector3(0.5, 0.35, 0), new THREE.Vector3(0.38, 1.05, 0), 0.03, 0.03, sm.M.aluDark, 8));
  g.add(sm.mk(new THREE.BoxGeometry(0.05, 0.04, 0.6), sm.M.black, 0.38, 1.05, 0));
  g.add(sm.mk(sm.rbox(0.16, 0.5, 0.36, 0.06), bodyMat, 0.48, 0.65, 0));
  const tire = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 16).rotateX(Math.PI / 2);
  g.add(sm.mk(tire, sm.M.tire, 0.55, 0.22, 0));
  g.add(sm.mk(tire, sm.M.tire, -0.55, 0.22, 0));
  const rider = buildPerson({ shirt: who?.shirt ?? 0x1565c0, pants: who?.pants ?? 0x263238, hat: 'helmet', skin: who?.skin });
  // 屁股坐在座墊上 (座墊頂 ≈ 0.82，人物髖關節高 0.88)，腳往前踩踏板、手握龍頭
  rider.position.set(-0.24, -0.04, 0);
  rider.userData.legs.forEach((l: THREE.Object3D) => { l.rotation.z = 1.1; });
  rider.userData.arms.forEach((a: THREE.Object3D) => { a.rotation.z = 1.02; });
  g.add(rider);
  g.userData.rider = rider;
  return g;
}

/** 低多邊形人物；userData.legs/arms 供走路動畫 */
export function buildPerson(o: { shirt: number; pants: number; hat?: 'straw' | 'helmet' | 'cap' | 'police' | null; skin?: number }): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: o.skin ?? 0xc68a5e, roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: o.shirt, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: o.pants, roughness: 0.9 });
  const legs: THREE.Object3D[] = [], arms: THREE.Object3D[] = [];
  [-0.1, 0.1].forEach(z => {
    const hip = new THREE.Group(); hip.position.set(0, 0.88, z);
    hip.add(sm.mk(sm.rbox(0.14, 0.82, 0.14, 0.05), pants, 0, -0.41, 0));
    hip.add(sm.mk(sm.rbox(0.24, 0.08, 0.13, 0.03), sm.M.black, 0.04, -0.84, 0));
    g.add(hip); legs.push(hip);
  });
  g.add(sm.mk(sm.rbox(0.26, 0.6, 0.4, 0.09), shirt, 0, 1.18, 0));
  [-0.25, 0.25].forEach(z => {
    const sh = new THREE.Group(); sh.position.set(0, 1.42, z);
    sh.add(sm.mk(sm.rbox(0.11, 0.58, 0.11, 0.04), shirt, 0, -0.27, 0));
    sh.add(sm.mk(new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.6, 0));
    g.add(sh); arms.push(sh);
  });
  g.add(sm.mk(new THREE.CylinderGeometry(0.06, 0.07, 0.08, 10), skin, 0, 1.52, 0));
  g.add(sm.mk(new THREE.SphereGeometry(0.13, 16, 12), skin, 0, 1.66, 0));
  if (o.hat === 'straw') {
    // 斗笠
    g.add(sm.mk(new THREE.ConeGeometry(0.3, 0.16, 20), new THREE.MeshStandardMaterial({ color: 0xd8b56a, roughness: 0.9 }), 0, 1.8, 0));
  } else if (o.hat === 'helmet') {
    g.add(sm.mk(new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.8), new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.3 }), 0, 1.68, 0));
  } else if (o.hat === 'cap') {
    g.add(sm.mk(new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 }), 0, 1.7, 0));
    g.add(sm.mk(new THREE.BoxGeometry(0.14, 0.015, 0.2), new THREE.MeshStandardMaterial({ color: 0x2e7d32 }), 0.13, 1.72, 0));
  } else if (o.hat === 'police') {
    // 警帽：深藍帽身 + 黑帽簷 + 金色帽徽
    const navy = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.6 });
    g.add(sm.mk(new THREE.CylinderGeometry(0.16, 0.14, 0.1, 16), navy, 0, 1.79, 0));
    g.add(sm.mk(new THREE.CylinderGeometry(0.18, 0.17, 0.035, 16), navy, 0, 1.85, 0));
    g.add(sm.mk(new THREE.BoxGeometry(0.13, 0.015, 0.24), sm.M.black, 0.15, 1.75, 0));
    g.add(sm.mk(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.3 }), 0.16, 1.81, 0));
  }
  // 眼睛 (面向 +X)
  [-0.045, 0.045].forEach(z => g.add(sm.mk(new THREE.SphereGeometry(0.014, 6, 4), sm.M.black, 0.12, 1.69, z, true)));
  g.userData.legs = legs;
  g.userData.arms = arms;
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}

export function animateWalk(p: THREE.Group, t: number, speed: number) {
  const a = Math.sin(t * 7) * 0.5 * Math.min(1, speed);
  const legs = p.userData.legs as THREE.Object3D[], arms = p.userData.arms as THREE.Object3D[];
  legs[0].rotation.z = a; legs[1].rotation.z = -a;
  // 手上有東西時手不擺：pose = 'carryFront' 兩手捧在胸前；'carryShoulder' 右手扶肩上的東西、左手提東西；'carryHand' 左手提東西、右手照擺
  const pose = p.userData.pose as string | undefined;
  if (pose === 'carryFront') { arms[0].rotation.z = 1.15; arms[1].rotation.z = 1.15; arms[0].rotation.x = -0.2; arms[1].rotation.x = 0.2; return; }
  if (pose === 'carryShoulder') { arms[1].rotation.z = 2.1; arms[1].rotation.x = 0; arms[0].rotation.z = -a * 0.2; arms[0].rotation.x = 0; return; }
  if (pose === 'carryHand') { arms[0].rotation.z = -a * 0.15; arms[0].rotation.x = -0.12; arms[1].rotation.x = 0; arms[1].rotation.z = a * 0.8; return; }
  arms[0].rotation.x = 0; arms[1].rotation.x = 0;
  arms[0].rotation.z = -a * 0.8; arms[1].rotation.z = a * 0.8;
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
