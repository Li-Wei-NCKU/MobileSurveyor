/**
 * 人物模型 (卡通畫風)。原則：輪廓圓順、色塊少、整體和諧；不堆小零件。
 *  - 軀幹是一整個旋轉體 (臀→腰→胸→肩→頸一條線)，不是幾塊拼起來
 *  - 臉只有兩個眼睛；沒有鼻子、嘴、耳朵、眉毛
 *  - 描邊只描整個人的外輪廓 (userData.softOutline)，身體各部位之間不畫線
 * 面向 +X；髖關節 y=0.88、肩關節 y=1.335、頭心 y=1.63 —— 跟舊版一樣，手上拿東西、騎機車的姿勢都不用改。
 *   userData.legs / knees / arms / elbows：走路動畫用的關節
 */
import * as THREE from 'three';
import { mergeOutlines } from '../mobile/toon';

export type Hat = 'straw' | 'helmet' | 'cap' | 'police' | 'hardhat' | null;
export interface PersonLook {
  shirt: number; pants: number; hat?: Hat; skin?: number;
  /** 反光背心的顏色 (測量隊員) */
  vest?: number;
  hatColor?: number;
  hair?: number;
  /** 長袖 (預設短袖) */
  longSleeve?: boolean;
}

const mats = new Map<string, THREE.MeshStandardMaterial>();
function M(color: number, rough = 0.85, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial {
  const k = `${color}_${rough}_${side}`;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side }); mats.set(k, m); }
  return m;
}
const geos = new Map<string, THREE.BufferGeometry>();
function G<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geos.get(key) as T | undefined;
  if (!g) { g = make(); geos.set(key, g); }
  return g;
}
/** 從原點往下長 len 的圓頭棒 (關節在上端)；r2 是下端半徑 (略收) */
const limb = (r: number, len: number, r2 = r) => G(`limb${r}_${len}_${r2}`, () => {
  const p: THREE.Vector2[] = [], n = 8;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; p.push(new THREE.Vector2(Math.sin(a) * r2, -len + r2 - Math.cos(a) * r2)); }   // 下端半球
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; p.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); }                   // 上端半球 (圓心在關節)
  return new THREE.LatheGeometry(p, 16);
});
/** 旋轉體：用平滑曲線通過各點，輪廓才圓順 */
const lathe = (key: string, pts: [number, number][], seg = 28) => G(key, () => {
  const curve = new THREE.SplineCurve(pts.map(p => new THREE.Vector2(p[0], p[1])));
  return new THREE.LatheGeometry(curve.getPoints(40).map(p => new THREE.Vector2(Math.max(0, p.x), p.y)), seg);
});
const sph = (r: number, ws = 24, hs = 18) => G(`sp${r}_${ws}_${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const cyl = (r1: number, r2: number, h: number, n = 24) => G(`cy${r1}_${r2}_${h}_${n}`, () => new THREE.CylinderGeometry(r1, r2, h, n));

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true;
  m.userData.softOutline = true;      // 只描整個人的外輪廓
  parent.add(m); return m;
}

/** 軀幹的截面是橢圓：前後 (x) 薄、左右 (z) 寬 */
const BODY_X = 0.64, BODY_Z = 1.1;

/** 低畫質 (關掉即時陰影) 時，腳下放一圈淡淡的影子，人才不會看起來浮在地上 */
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, visible: false });
const blobGeo = new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2);
export function setBlobShadows(on: boolean) { blobMat.visible = on; }

export function buildPersonModel(o: PersonLook): THREE.Group {
  const g = new THREE.Group();
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.position.y = 0.03; blob.renderOrder = -1; blob.raycast = () => {};
  blob.userData.noOutline = true;
  g.add(blob);
  const skin = M(o.skin ?? 0xc68a5e, 0.75), shirt = M(o.shirt), pants = M(o.pants, 0.9), shoe = M(0x2a2420, 0.85);
  const hair = M(o.hair ?? (o.hat === 'straw' ? 0x55504a : 0x241a14), 0.95);

  // ---- 腿＋鞋
  const legs: THREE.Object3D[] = [], knees: THREE.Object3D[] = [];
  for (const z of [-0.095, 0.095]) {
    const hip = new THREE.Group(); hip.position.set(0, 0.88, z);
    add(hip, limb(0.09, 0.45, 0.078), pants);
    const knee = new THREE.Group(); knee.position.set(0, -0.4, 0); hip.add(knee);
    add(knee, limb(0.078, 0.42, 0.066), pants);
    const sh = add(knee, sph(0.075, 18, 12), shoe, 0.05, -0.41, 0); sh.scale.set(1.75, 0.7, 0.95);
    g.add(hip); legs.push(hip); knees.push(knee);
  }
  // ---- 軀幹：下半 (褲子) 和上半 (衣服) 各是一個旋轉體，接在腰上
  const hipG = lathe('hips', [[0, 0.78], [0.09, 0.785], [0.145, 0.83], [0.158, 0.92], [0.148, 1.02], [0.137, 1.05]]);
  const torsoG = lathe('torso', [[0.136, 1.0], [0.137, 1.06], [0.148, 1.17], [0.156, 1.28], [0.158, 1.35], [0.15, 1.385], [0.125, 1.41], [0.09, 1.432], [0.062, 1.447], [0, 1.45]]);
  const body = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const m = add(g, geo, mat); m.scale.set(BODY_X, 1, BODY_Z); return m; };
  body(hipG, pants);
  body(torsoG, shirt);
  if (o.vest !== undefined) {
    // 反光背心：罩在衣服外面的一層，加兩條橫的反光條
    body(lathe('vest', [[0.144, 1.0], [0.145, 1.06], [0.156, 1.17], [0.164, 1.28], [0.166, 1.35], [0.158, 1.387], [0.133, 1.413], [0.1, 1.433]]), M(o.vest, 0.8, THREE.DoubleSide));
    const refl = M(0xf1f3f4, 0.6, THREE.DoubleSide);
    body(lathe('band1', [[0.1485, 1.075], [0.1505, 1.095], [0.1525, 1.115]]), refl).userData.inner = true;
    body(lathe('band2', [[0.1605, 1.2], [0.1625, 1.22], [0.164, 1.24]]), refl).userData.inner = true;
  }
  if (o.hat === 'police') {
    // 警察：黑色勤務腰帶＋皮帶扣
    body(lathe('belt', [[0.146, 0.985], [0.147, 1.01], [0.146, 1.035]]), M(0x17181c, 0.6, THREE.DoubleSide)).userData.inner = true;
    const bk = add(g, G('buckle', () => new THREE.BoxGeometry(0.014, 0.05, 0.062)), M(0xd4af37, 0.4), 0.147 * BODY_X + 0.004, 1.01, 0);
    bk.userData.inner = true;
  }
  // ---- 手臂：上臂 (袖子)＋前臂＋手
  const arms: THREE.Object3D[] = [], elbows: THREE.Object3D[] = [];
  for (const z of [-0.193, 0.193]) {
    // 肩關節放在肩線下面：手臂頂端的圓頭藏在軀幹的斜肩裡，從脖子到手臂是一條順的線，不會在肩上鼓一包
    const sh = new THREE.Group(); sh.position.set(0, 1.335, z);
    add(sh, limb(0.058, 0.23, 0.054), shirt, 0, -0.025, 0);
    const el = new THREE.Group(); el.position.set(0, -0.25, 0); el.rotation.z = 0.1; sh.add(el);
    add(el, limb(0.052, 0.27, 0.044), o.longSleeve ? shirt : skin);
    add(el, sph(0.052, 14, 10), skin, 0, -0.27, 0);
    g.add(sh); arms.push(sh); elbows.push(el);
  }
  // ---- 脖子、頭、頭髮、眼睛
  add(g, cyl(0.055, 0.064, 0.1, 18), skin, 0, 1.455, 0).userData.inner = true;
  const head = new THREE.Group(); head.position.set(0, 1.63, 0); g.add(head);
  const skull = add(head, sph(0.152, 28, 22), skin); skull.scale.set(0.96, 1.0, 0.95);
  const hairCap = add(head, G('hairCap', () => new THREE.SphereGeometry(0.158, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.5)), hair, -0.008, 0.006, 0);
  hairCap.scale.set(0.98, 1.0, 0.97); hairCap.rotation.z = 0.38;
  const eye = M(0x1b1b1f, 0.5);
  for (const z of [-0.055, 0.055]) { const e = add(head, sph(0.019, 12, 10), eye, 0.137, 0.0, z); e.scale.set(0.45, 1.25, 0.95); e.userData.inner = true; }

  // ---- 帽子 (都只有帽身＋帽簷)
  const hc = o.hatColor;
  const dome = (r: number, key: string) => G(key, () => new THREE.SphereGeometry(r, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.5));
  if (o.hat === 'straw') {
    add(head, G('straw', () => new THREE.ConeGeometry(0.36, 0.17, 28)), M(hc ?? 0xd8b56a, 0.9), 0, 0.165, 0);
  } else if (o.hat === 'helmet') {
    // 機車安全帽 (半罩)
    const hm = M(hc ?? 0xfafafa, 0.4);
    add(head, G('scooterHelm', () => new THREE.SphereGeometry(0.182, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.56)), hm, -0.012, 0.03, 0).rotation.z = 0.3;
    const vis = add(head, cyl(0.1, 0.1, 0.012, 20), M(0x2c3138, 0.5), 0.15, 0.075, 0); vis.scale.set(0.75, 1, 1.25); vis.rotation.z = -0.18;
  } else if (o.hat === 'hardhat') {
    // 工地安全帽
    const hm = M(hc ?? 0xf7f7f2, 0.45);
    add(head, dome(0.18, 'hardDome'), hm, -0.004, 0.05, 0).scale.set(1.04, 0.92, 0.98);
    const brim = add(head, cyl(0.19, 0.196, 0.016, 28), hm, 0.03, 0.052, 0); brim.scale.set(1.16, 1, 1);
  } else if (o.hat === 'cap') {
    const cm = M(hc ?? 0x2e7d32, 0.8);
    add(head, dome(0.166, 'capDome'), cm, -0.004, 0.045, 0).scale.set(1.02, 0.9, 0.97);
    const visor = add(head, cyl(0.11, 0.11, 0.014, 20), cm, 0.17, 0.052, 0); visor.scale.set(1.1, 1, 1.05); visor.rotation.z = -0.12;
  } else if (o.hat === 'police') {
    const navy = M(0x1a2a4a, 0.6);
    add(head, cyl(0.17, 0.158, 0.085, 24), navy, -0.004, 0.125, 0);
    add(head, cyl(0.198, 0.182, 0.036, 24), navy, -0.004, 0.185, 0).rotation.z = -0.1;
    const visor = add(head, cyl(0.105, 0.105, 0.012, 18), M(0x16161a, 0.6), 0.15, 0.088, 0); visor.scale.set(1, 1, 1.25); visor.rotation.z = -0.2;
    add(head, sph(0.024, 10, 8), M(0xd4af37, 0.4), 0.165, 0.14, 0);
  }
  g.userData.legs = legs; g.userData.knees = knees;
  g.userData.arms = arms; g.userData.elbows = elbows;
  g.userData.head = head;
  // 身體裡面的小東西 (眼睛、反光條、皮帶扣、脖子) 不會是外輪廓，不用描；其餘同一個關節底下的合成一次描
  g.traverse(o => { if (o.userData.inner) o.userData.noOutline = true; });
  mergeOutlines(g);
  return g;
}
