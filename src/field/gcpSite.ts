/**
 * 第三天現場：公司出門左轉 (往西) 約 100 m，縣道北側的農地 (航測控制點佈設 + 當天航拍)
 *  這個檔案裡的座標都是「現場座標」：縣道在 z = 48、農地往 +z 延伸。
 *  實際世界座標 = 現場座標繞 (PIVOT_X, 48) 轉 180°：world = (2·PIVOT_X − x, 96 − z)
 *  (世界 +x = 東、+z = 南，所以農地在縣道北側，農路口在 x ≈ -257)
 *  所有 export 的查詢函式 (surfAt、topAt…) 都吃「世界座標」。
 *  - 一條水泥農路從縣道往南穿過整片農地
 *  - 靠縣道那頭一條灌溉水泥溝，溝旁有水泥步道
 *  - 西邊是阿伯的旱田 (中間一道田埂 + 交叉口水泥墊)，東邊剛翻過土
 *  - 西南：鐵皮農舍 + 曬穀場 (阿黃的家)；南邊竹林；東南：土地公廟 + 廟埕
 *  - 農路旁有一棵大榕樹，樹下水泥平台 (看起來很適合放標……)
 * 這個檔案只負責「長什麼樣子」和「每個位置是什麼地面」，不判斷好壞。
 */
import * as THREE from 'three';
import { SM, type SceneManager } from './legacy';

export const PIVOT_X = -124.5;
/** 現場座標 ↔ 世界座標 (轉 180°，正反都是同一個公式) */
export function toWorld(x: number, z: number) { return { x: 2 * PIVOT_X - x, z: 96 - z }; }
export const toLocal = toWorld;

/** 航測範圍 (工單上的紅框，現場座標) */
export const AREA = { x0: -36, x1: 36, z0: 58, z1: 112 };
export const AREA_C = { x: (AREA.x0 + AREA.x1) / 2, z: (AREA.z0 + AREA.z1) / 2 };
/** 建議停車：農路口旁空地 (世界座標) */
export const GCP_PARK = toWorld(12.6, 55.2);

export type Surf =
  | 'lane' | 'drive' | 'bank' | 'canal' | 'apron' | 'path' | 'yard' | 'apronT' | 'platform' | 'pad' | 'ridge'
  | 'fieldW' | 'fieldE' | 'veg' | 'bamboo' | 'house' | 'temple' | 'verge';

interface Rect { s: Surf; x0: number; x1: number; z0: number; z1: number; top?: number }

/** 由上到下比對，先中先贏 */
export const RECTS: Rect[] = [
  { s: 'house', x0: -32, x1: -20, z0: 108.5, z1: 115.5 },
  { s: 'temple', x0: 25.5, x1: 32.5, z0: 107.2, z1: 112.8 },
  { s: 'lane', x0: 6.2, x1: 9.8, z0: 51.4, z1: 120, top: 0.05 },
  { s: 'canal', x0: -40, x1: 42, z0: 59.9, z1: 61.1 },
  { s: 'bank', x0: -40, x1: 42, z0: 58.4, z1: 59.9, top: 0.06 },
  { s: 'apron', x0: 9.8, x1: 15.6, z0: 51.8, z1: 58.4, top: 0.05 },
  { s: 'path', x0: -36.2, x1: -34.6, z0: 59.9, z1: 98.5, top: 0.05 },
  { s: 'yard', x0: -34.6, x1: -14, z0: 98.5, z1: 107.8, top: 0.05 },
  { s: 'apronT', x0: 20.5, x1: 36, z0: 98.5, z1: 106.6, top: 0.07 },
  { s: 'drive', x0: 9.8, x1: 20.5, z0: 96.4, z1: 100.2, top: 0.05 },
  { s: 'platform', x0: 0.2, x1: 5.6, z0: 87.6, z1: 93.2, top: 0.28 },
  { s: 'pad', x0: -6.6, x1: -4.4, z0: 83.9, z1: 86.1, top: 0.06 },
  { s: 'ridge', x0: -34.6, x1: -0.6, z0: 84.62, z1: 85.38, top: 0.06 },
  { s: 'ridge', x0: 10.6, x1: 36, z0: 84.62, z1: 85.38, top: 0.06 },
  { s: 'bamboo', x0: -12.5, x1: -0.5, z0: 100, z1: 116 },
  { s: 'veg', x0: 10.6, x1: 19.6, z0: 100.6, z1: 113 },
  { s: 'fieldW', x0: -34.6, x1: -0.6, z0: 61.8, z1: 97.6 },
  { s: 'fieldE', x0: 10.6, x1: 36, z0: 61.8, z1: 96.0 },
];

export const HARD: Surf[] = ['lane', 'drive', 'bank', 'apron', 'path', 'yard', 'apronT', 'platform', 'pad', 'ridge'];
export const CROP: Surf[] = ['fieldW', 'fieldE', 'veg'];

export const SURF_NAME: Record<Surf, string> = {
  lane: '水泥農路', drive: '往廟埕的水泥車道', bank: '水溝旁水泥步道', canal: '灌溉溝', apron: '路口空地', path: '田邊水泥小徑', yard: '曬穀場',
  apronT: '廟埕', platform: '榕樹下的水泥平台', pad: '田埂交叉口水泥墊', ridge: '田埂', fieldW: '旱田', fieldE: '剛翻過的田',
  veg: '菜園', bamboo: '竹林', house: '農舍', temple: '土地公廟', verge: '草地',
};

/** 樹冠 (遮擋航拍 / 衛星) */
export interface Crown { x: number; z: number; r: number; trunk: number; name: string }
export const CROWNS: Crown[] = [
  { x: 2.9, z: 90.4, r: 6.6, trunk: 0.7, name: '大榕樹' },
  { x: -30.8, z: 63.6, r: 4.6, trunk: 0.35, name: '芒果樹' },
  { x: 35.5, z: 116.5, r: 4.8, trunk: 0.4, name: '廟後的老樹' },
  { x: -17.5, z: 112.5, r: 3.4, trunk: 0.3, name: '龍眼樹' },
];

export function surfAt(wx: number, wz: number): Surf {
  const { x, z } = toLocal(wx, wz);
  for (const r of RECTS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.s;
  return 'verge';
}

/** 地表 (含水泥鋪面厚度) 高度 */
export function topAt(sm: SceneManager, wx: number, wz: number): number {
  const { x, z } = toLocal(wx, wz);
  for (const r of RECTS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return sm.heightAt(wx, wz) + (r.top || 0);
  return sm.heightAt(wx, wz);
}

export function inArea(wx: number, wz: number, m = 0) {
  const { x, z } = toLocal(wx, wz);
  return x > AREA.x0 - m && x < AREA.x1 + m && z > AREA.z0 - m && z < AREA.z1 + m;
}

/** 點位遠照的參考地物 (現場座標；拍遠照時畫面裡要有其中一個) */
const REFS_L: { name: string; x: number; z: number; y: number }[] = [
  { name: '土地公廟', x: 29, z: 110, y: 2.2 },
  { name: '農舍', x: -26, z: 112, y: 2 },
  { name: '大榕樹', x: 2.9, z: 90.4, y: 5 },
  { name: '芒果樹', x: -30.8, z: 63.6, y: 3.5 },
  { name: '廟後的老樹', x: 35.5, z: 116.5, y: 4 },
  { name: '龍眼樹', x: -17.5, z: 112.5, y: 3 },
  { name: '電線桿', x: 11, z: 72, y: 5 },
  { name: '電線桿', x: 11, z: 100, y: 5 },
  { name: '福德祠指示牌', x: 5.6, z: 53, y: 1.6 },
  { name: '竹林', x: -6, z: 108, y: 5 },
  { name: '金爐', x: 34.1, z: 106, y: 1 },
];
export function refPoints() { return REFS_L.map(r => ({ name: r.name, ...toWorld(r.x, r.z), y: r.y })); }

/** 竹林叢 (碰撞 + 遮蔽) */
export const BAMBOO: { x: number; z: number; r: number }[] = [];
{
  const r = mulberry(77);
  for (let i = 0; i < 18; i++) BAMBOO.push({ x: -11.5 + r() * 10.5, z: 101 + r() * 14, r: 0.7 + r() * 0.5 });
}

function mulberry(a: number) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** 某點上方是否被樹冠 / 竹林遮住 (回傳遮擋物名稱) */
export function canopyAt(wx: number, wz: number, pad = 0): string | null {
  const { x, z } = toLocal(wx, wz);
  for (const c of CROWNS) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return c.name;
  if (x > -14 && x < 1 && z > 98.5 && z < 117.5) return '竹林';
  return null;
}

/** 離建物牆面多遠 */
export function buildingDist(wx: number, wz: number): { d: number; name: string } {
  const { x, z } = toLocal(wx, wz);
  let best = { d: 1e9, name: '' };
  RECTS.filter(r => r.s === 'house' || r.s === 'temple').forEach(r => {
    const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
    const d = Math.hypot(dx, dz);
    if (d < best.d) best = { d, name: r.s === 'house' ? '農舍' : '土地公廟' };
  });
  return best;
}

// ======================================================================
// 3D 場景
// ======================================================================
export interface SiteBuild {
  group: THREE.Group;
  colliders: { x: number; z: number; r: number }[];
  /** 狗屋前 (阿黃平常趴的地方) */
  kennel: { x: number; z: number };
}

export function buildGcpSite(sm: SceneManager): SiteBuild {
  const S = SM();
  const g = new THREE.Group();
  g.name = 'gcp-site';
  // 整組轉 180° 放到縣道北側；裡面的模型用現場座標
  g.position.set(2 * PIVOT_X, 0, 96);
  g.rotation.y = Math.PI;
  const colliders: { x: number; z: number; r: number }[] = [];
  const H = (x: number, z: number) => { const w = toWorld(x, z); return sm.heightAt(w.x, w.z); };

  const concTex = (seed: number, joints: number) => S.canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#a3a199'; c.fillRect(0, 0, w, h);
    const r = S.rng(seed);
    for (let i = 0; i < 5200; i++) { const v = 128 + Math.floor(r() * 60); c.fillStyle = `rgba(${v},${v},${v - 6},0.32)`; c.fillRect(r() * w, r() * h, 2, 2); }
    for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(70,64,52,${0.05 + r() * 0.08})`; c.beginPath(); c.ellipse(r() * w, r() * h, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, Math.PI * 2); c.fill(); }
    if (joints) { c.strokeStyle = 'rgba(55,55,52,0.55)'; c.lineWidth = 2; for (let k = 0; k <= joints; k++) { c.beginPath(); c.moveTo(0, k * h / joints); c.lineTo(w, k * h / joints); c.stroke(); } }
  });
  const slab = (r: Rect, mat: THREE.Material, th = r.top || 0.05) => {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const m = S.mk(new THREE.BoxGeometry(w, th + 0.3, d), mat, cx, H(cx, cz) + th / 2 - 0.15, cz, true);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const rect = (s: Surf) => RECTS.filter(r => r.s === s);

  // ------------------------------------------------ 農路 (車轍 + 伸縮縫)
  const laneTex = S.canvasTex(128, 512, (c, w, h) => {
    c.fillStyle = '#a6a49c'; c.fillRect(0, 0, w, h);
    const r = S.rng(31);
    for (let i = 0; i < 6000; i++) { const v = 125 + Math.floor(r() * 60); c.fillStyle = `rgba(${v},${v},${v - 6},0.33)`; c.fillRect(r() * w, r() * h, 2, 2); }
    // 車轍 (輪子壓過的深色帶)
    [[22, 18], [w - 40, 18]].forEach(([x0, bw]) => { const gr = c.createLinearGradient(x0, 0, x0 + bw, 0); gr.addColorStop(0, 'rgba(60,56,50,0)'); gr.addColorStop(0.5, 'rgba(60,56,50,0.28)'); gr.addColorStop(1, 'rgba(60,56,50,0)'); c.fillStyle = gr; c.fillRect(x0, 0, bw, h); });
    c.strokeStyle = 'rgba(50,50,46,0.6)'; c.lineWidth = 2;
    for (let k = 0; k <= 4; k++) { c.beginPath(); c.moveTo(0, k * h / 4); c.lineTo(w, k * h / 4); c.stroke(); }
    // 泥巴
    for (let i = 0; i < 10; i++) { c.fillStyle = `rgba(110,82,50,${0.15 + r() * 0.2})`; c.beginPath(); c.ellipse(r() * w, r() * h, 6 + r() * 14, 3 + r() * 8, 0, 0, Math.PI * 2); c.fill(); }
  });
  laneTex.wrapS = laneTex.wrapT = THREE.RepeatWrapping;
  rect('lane').forEach(r => {
    laneTex.repeat.set(1, (r.z1 - r.z0) / 12);
    slab(r, new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.95 }));
  });
  // 迴車處
  slab({ s: 'lane', x0: 4.6, x1: 11.4, z0: 116.4, z1: 120.6, top: 0.05 }, new THREE.MeshStandardMaterial({ map: concTex(4, 0), roughness: 0.95 }));

  // ------------------------------------------------ 各種水泥面
  const concMat = (seed: number, rep: [number, number], joints = 4) => { const t = concTex(seed, joints); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }); };
  rect('bank').forEach(r => slab(r, concMat(5, [(r.x1 - r.x0) / 3, 1], 1)));
  rect('apron').forEach(r => slab(r, concMat(6, [2, 2])));
  rect('drive').forEach(r => slab(r, concMat(14, [3, 1], 3)));
  rect('path').forEach(r => slab(r, concMat(7, [1, (r.z1 - r.z0) / 3], 1)));
  rect('yard').forEach(r => slab(r, concMat(8, [5, 2], 2)));
  rect('apronT').forEach(r => {
    // 廟埕：洗石子 + 紅磚邊
    const t = S.canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#b9ae9c'; c.fillRect(0, 0, w, h);
      const rr = S.rng(12);
      for (let i = 0; i < 7000; i++) { const v = 150 + Math.floor(rr() * 70); c.fillStyle = `rgba(${v},${v - 8},${v - 20},0.45)`; c.fillRect(rr() * w, rr() * h, 2, 2); }
      c.strokeStyle = '#9c3b26'; c.lineWidth = 8; c.strokeRect(0, 0, w, h);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 2);
    slab(r, new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
  });
  rect('pad').forEach(r => slab(r, concMat(9, [1, 1], 0)));
  rect('ridge').forEach(r => slab(r, concMat(10, [(r.x1 - r.x0) / 4, 0.25], 0)));
  rect('platform').forEach(r => {
    const m = slab(r, concMat(11, [2, 2], 0));
    m.castShadow = true;
    // 石桌石椅 (阿伯們泡茶的地方)
    const stone = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.85 });
    const y0 = H(r.x0, r.z0) + (r.top || 0);
    g.add(S.mk(new THREE.CylinderGeometry(0.45, 0.32, 0.7, 14), stone, r.x0 + 1.2, y0 + 0.35, r.z1 - 1.0));
    [[0.75, 0], [-0.75, 0], [0, 0.75]].forEach(([dx, dz]) => g.add(S.mk(new THREE.CylinderGeometry(0.2, 0.17, 0.42, 10), stone, r.x0 + 1.2 + dx, y0 + 0.21, r.z1 - 1.0 + dz)));
  });

  // ------------------------------------------------ 灌溉溝 (墊高的水泥溝)
  rect('canal').forEach(r => {
    const len = r.x1 - r.x0, cx = (r.x0 + r.x1) / 2;
    const wallMat = new THREE.MeshStandardMaterial({ map: concTex(13, 0), roughness: 0.9 });
    [r.z0 + 0.08, r.z1 - 0.08].forEach(z => {
      // 農路經過的地方是涵管 (路面蓋過去)
      [[r.x0, 6.2], [9.8, r.x1]].forEach(([a, b]) => g.add(S.mk(new THREE.BoxGeometry(b - a, 0.5, 0.16), wallMat, (a + b) / 2, H(cx, z) + 0.2, z)));
    });
    const water = new THREE.MeshStandardMaterial({ color: 0x51624a, roughness: 0.15, metalness: 0.3 });
    [[r.x0, 6.2], [9.8, r.x1]].forEach(([a, b]) => {
      const wm = S.mk(new THREE.PlaneGeometry(b - a, r.z1 - r.z0 - 0.3), water, (a + b) / 2, H(cx, r.z0) + 0.2, (r.z0 + r.z1) / 2, true);
      wm.rotation.x = -Math.PI / 2;
      g.add(wm);
    });
    void len;
  });

  // ------------------------------------------------ 田 (旱田 + 翻過的土 + 菜園)
  const soil = (seed: number, rows: 'crop' | 'tilled' | 'veg') => S.canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = rows === 'tilled' ? '#7a5a3c' : '#86684a'; c.fillRect(0, 0, w, h);
    const r = S.rng(seed);
    for (let i = 0; i < 6000; i++) { const v = r(); c.fillStyle = v > 0.5 ? `rgba(60,40,24,${0.2 + r() * 0.3})` : `rgba(160,130,95,${0.15 + r() * 0.25})`; c.fillRect(r() * w, r() * h, 2, 2); }
    if (rows === 'tilled') { for (let y = 0; y < h; y += 16) { c.fillStyle = 'rgba(50,34,20,0.35)'; c.fillRect(0, y, w, 5); } }
    else {
      for (let y = 8; y < h; y += rows === 'veg' ? 32 : 21) {
        for (let x = 4; x < w; x += rows === 'veg' ? 22 : 9) {
          c.fillStyle = rows === 'veg' ? `hsl(${100 + r() * 20},55%,${30 + r() * 12}%)` : `hsl(${90 + r() * 25},50%,${32 + r() * 14}%)`;
          c.beginPath(); c.arc(x + r() * 3, y + r() * 3, rows === 'veg' ? 7 + r() * 3 : 3 + r() * 2, 0, Math.PI * 2); c.fill();
        }
      }
    }
  });
  const fieldMesh = (r: Rect, tex: THREE.Texture, rep: [number, number]) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(rep[0], rep[1]);
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const m = S.mk(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), (r.x0 + r.x1) / 2, H((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2) + 0.02, (r.z0 + r.z1) / 2, true);
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = true;
    g.add(m);
  };
  rect('fieldW').forEach(r => fieldMesh(r, soil(21, 'crop'), [(r.x1 - r.x0) / 6, (r.z1 - r.z0) / 6]));
  rect('fieldE').forEach(r => fieldMesh(r, soil(22, 'tilled'), [(r.x1 - r.x0) / 6, (r.z1 - r.z0) / 6]));
  rect('veg').forEach(r => fieldMesh(r, soil(23, 'veg'), [(r.x1 - r.x0) / 5, (r.z1 - r.z0) / 5]));
  // 旱田上的作物 (矮矮的綠叢，用 instancing)
  {
    const r0 = rect('fieldW')[0];
    const geo = new THREE.IcosahedronGeometry(0.16, 0); geo.scale(1, 0.6, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x5f9a3a, roughness: 0.9, flatShading: true });
    const rows: THREE.Matrix4[] = [];
    const rr = S.rng(55);
    for (let z = r0.z0 + 0.6; z < r0.z1 - 0.4; z += 0.9) {
      if (Math.abs(z - 85) < 0.7) continue;
      for (let x = r0.x0 + 0.5; x < r0.x1 - 0.4; x += 0.55) {
        if (x > -7 && x < -4 && Math.abs(z - 85) < 1.6) continue;
        const s = 0.7 + rr() * 0.6;
        rows.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (rr() - 0.5) * 0.15, H(x, z) + 0.06, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rr() * 6, 0)), new THREE.Vector3(s, s, s)));
      }
    }
    const im = new THREE.InstancedMesh(geo, mat, rows.length);
    rows.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = false; im.receiveShadow = true;
    g.add(im);
    // 菜園：高麗菜
    const v0 = rect('veg')[0];
    const cab = new THREE.SphereGeometry(0.22, 10, 7); cab.scale(1, 0.7, 1);
    const cmat = new THREE.MeshStandardMaterial({ color: 0x9cc96b, roughness: 0.7 });
    const cm: THREE.Matrix4[] = [];
    for (let z = v0.z0 + 0.8; z < v0.z1 - 0.5; z += 1.0) for (let x = v0.x0 + 0.7; x < v0.x1 - 0.5; x += 0.7) cm.push(new THREE.Matrix4().makeTranslation(x, H(x, z) + 0.12, z));
    const ci = new THREE.InstancedMesh(cab, cmat, cm.length);
    cm.forEach((m, i) => ci.setMatrixAt(i, m));
    ci.castShadow = true;
    g.add(ci);
  }

  // ------------------------------------------------ 樹
  const tree = (c: Crown, s: number, seed: number) => {
    const parts: unknown[] = [];
    S.broadleafParts(S.rng(seed), s, parts);
    const m = new THREE.Mesh(S.mergeColored(parts), S.M.vertexFlat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(c.x, H(c.x, c.z) + (c.name === '大榕樹' ? 0.2 : -0.05), c.z);
    m.rotation.y = seed;
    g.add(m);
    colliders.push({ x: c.x, z: c.z, r: c.trunk });
    const proxy = new THREE.Object3D(); // 開車會撞到 (sm.trees 用世界座標)
    const w = toWorld(c.x, c.z);
    proxy.position.set(w.x, H(c.x, c.z), w.z);
    sm.trees.push(proxy);
  };
  tree(CROWNS[0], 2.05, 901);
  tree(CROWNS[1], 1.4, 902);
  tree(CROWNS[2], 1.45, 903);
  tree(CROWNS[3], 1.05, 904);
  // 榕樹氣根
  {
    const c = CROWNS[0];
    const root = new THREE.MeshStandardMaterial({ color: 0x6b5543, roughness: 0.9 });
    const rr = S.rng(5);
    for (let i = 0; i < 14; i++) {
      const a = rr() * Math.PI * 2, d = 1.2 + rr() * 2.6, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const top = 4.2 + rr() * 1.4;
      g.add(S.mk(new THREE.CylinderGeometry(0.015, 0.025, top, 4), root, x, H(x, z) + top / 2, z, true));
    }
  }

  // ------------------------------------------------ 竹林
  {
    const parts: { geo: THREE.BufferGeometry; color: THREE.Color }[] = [];
    const rr = S.rng(66);
    BAMBOO.forEach(b => {
      for (let i = 0; i < 9; i++) {
        const a = rr() * Math.PI * 2, d = rr() * b.r, x = b.x + Math.cos(a) * d, z = b.z + Math.sin(a) * d;
        const h = 6 + rr() * 4;
        const lean = new THREE.Vector3((rr() - 0.5) * 0.9, h, (rr() - 0.5) * 0.9);
        const cg = new THREE.CylinderGeometry(0.035, 0.05, lean.length(), 5);
        cg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), lean.clone().normalize())));
        cg.translate(x + lean.x / 2, H(x, z) + lean.y / 2, z + lean.z / 2);
        parts.push({ geo: cg, color: new THREE.Color().setHSL(0.22 + rr() * 0.05, 0.45, 0.35 + rr() * 0.1, THREE.SRGBColorSpace) });
        for (let k = 0; k < 3; k++) {
          const lg = new THREE.IcosahedronGeometry(0.9 + rr() * 0.5, 0);
          lg.scale(1, 0.6, 1);
          const t = 0.55 + k * 0.17;
          lg.translate(x + lean.x * t + (rr() - 0.5), H(x, z) + lean.y * t, z + lean.z * t + (rr() - 0.5));
          parts.push({ geo: lg, color: new THREE.Color().setHSL(0.25 + rr() * 0.04, 0.5, 0.3 + rr() * 0.1, THREE.SRGBColorSpace) });
        }
      }
      colliders.push({ x: b.x, z: b.z, r: b.r * 0.7 });
    });
    const m = new THREE.Mesh(S.mergeColored(parts), S.M.vertexFlat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }

  // ------------------------------------------------ 鐵皮農舍 + 狗屋
  const house = rect('house')[0];
  {
    const cx = (house.x0 + house.x1) / 2, cz = (house.z0 + house.z1) / 2, w = house.x1 - house.x0, d = house.z1 - house.z0;
    const y0 = H(cx, cz);
    const wallTex = S.canvasTex(256, 128, (c, ww, hh) => {
      c.fillStyle = '#d8d2c4'; c.fillRect(0, 0, ww, hh);
      const r = S.rng(3);
      for (let i = 0; i < 2000; i++) { c.fillStyle = `rgba(120,110,95,${r() * 0.15})`; c.fillRect(r() * ww, r() * hh, 2, 2); }
      c.fillStyle = 'rgba(90,80,60,0.25)'; c.fillRect(0, hh - 14, ww, 14);
    });
    const wall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    g.add(S.mk(new THREE.BoxGeometry(w, 3.2, d), wall, cx, y0 + 1.6, cz));
    const roofTex = S.canvasTex(64, 256, (c, ww, hh) => { for (let x = 0; x < ww; x += 8) { c.fillStyle = x % 16 ? '#3f6f9a' : '#355f86'; c.fillRect(x, 0, 8, hh); } });
    roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping; roofTex.repeat.set(10, 1);
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    [-1, 1].forEach(sd => {
      const rf = S.mk(new THREE.PlaneGeometry(w + 1.2, d / 2 + 0.9), roofMat, cx, y0 + 3.75, cz + sd * (d / 4 + 0.2));
      rf.rotation.x = -Math.PI / 2 + sd * -0.3;
      if (sd < 0) rf.rotation.x = -Math.PI / 2 + 0.3;
      g.add(rf);
    });
    // 門窗 (朝南)
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6 });
    const win = new THREE.MeshStandardMaterial({ color: 0x9fb6c4, roughness: 0.1, metalness: 0.5 });
    g.add(S.mk(new THREE.BoxGeometry(2.2, 2.4, 0.06), dark, cx - 1, y0 + 1.2, house.z0 - 0.02));
    [-4.2, 3.2].forEach(dx => g.add(S.mk(new THREE.BoxGeometry(1.6, 1.1, 0.06), win, cx + dx, y0 + 1.7, house.z0 - 0.02)));
    // 屋簷下的雜物：機車、藍白拖、塑膠椅
    g.add(S.mk(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshStandardMaterial({ color: 0xd64545, roughness: 0.6 }), cx + 1.8, y0 + 0.22, house.z0 - 0.7));
    for (let x = house.x0; x <= house.x1; x += 1.2) [house.z0, house.z1].forEach(z => colliders.push({ x, z, r: 0.7 }));
    for (let z = house.z0; z <= house.z1; z += 1.2) [house.x0, house.x1].forEach(x => colliders.push({ x, z, r: 0.7 }));
  }
  const kennel = { x: house.x1 + 1.6, z: house.z0 - 0.9 };
  {
    const wood = S.M.wood;
    const y0 = H(kennel.x, kennel.z);
    const k = new THREE.Group();
    k.add(S.mk(new THREE.BoxGeometry(0.9, 0.7, 0.8), wood, 0, 0.35, 0));
    const r1 = S.mk(new THREE.BoxGeometry(1.0, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: 0x8c2f1e, roughness: 0.7 }), 0, 0.85, 0.2);
    r1.rotation.x = 0.6; k.add(r1);
    const r2 = r1.clone(); r2.position.z = -0.2; r2.rotation.x = -0.6; k.add(r2);
    k.add(S.mk(new THREE.BoxGeometry(0.4, 0.45, 0.02), S.M.black, 0, 0.27, -0.41, true));
    k.position.set(kennel.x + 0.9, y0, kennel.z + 0.3);
    g.add(k);
    // 狗碗
    g.add(S.mk(new THREE.CylinderGeometry(0.12, 0.1, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.4 }), kennel.x + 0.2, y0 + 0.03, kennel.z - 0.6, true));
    colliders.push({ x: kennel.x + 0.9, z: kennel.z + 0.3, r: 0.6 });
  }
  // 曬穀場上的竹掃把、竹篩
  {
    const y = rect('yard')[0];
    const yy = H(y.x0, y.z0) + 0.05;
    const sieve = S.mk(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0xc8a96a, roughness: 0.9 }), y.x1 - 2.2, yy + 0.03, y.z1 - 1.4);
    g.add(sieve);
  }

  // ------------------------------------------------ 土地公廟
  const tpl = rect('temple')[0];
  {
    const cx = (tpl.x0 + tpl.x1) / 2, cz = (tpl.z0 + tpl.z1) / 2, w = tpl.x1 - tpl.x0, d = tpl.z1 - tpl.z0;
    const y0 = H(cx, cz);
    const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.7 });
    const stoneM = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 0.85 });
    const tile = new THREE.MeshStandardMaterial({ color: 0xc9562c, roughness: 0.6 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.35, metalness: 0.6 });
    g.add(S.mk(new THREE.BoxGeometry(w + 0.4, 0.35, d + 0.4), stoneM, cx, y0 + 0.17, cz));
    g.add(S.mk(new THREE.BoxGeometry(w, 2.6, d), red, cx, y0 + 1.65, cz));
    // 屋頂 + 燕尾
    const roof = S.mk(new THREE.BoxGeometry(w + 1.4, 0.35, d + 1.2), tile, cx, y0 + 3.1, cz);
    g.add(roof);
    g.add(S.mk(new THREE.BoxGeometry(w + 0.6, 0.3, 0.3), tile, cx, y0 + 3.4, cz));
    [-1, 1].forEach(sd => {
      const tail = S.mk(new THREE.BoxGeometry(0.9, 0.18, 0.22), tile, cx + sd * (w / 2 + 0.55), y0 + 3.7, cz);
      tail.rotation.z = sd * 0.55;
      g.add(tail);
    });
    // 門 + 匾額
    g.add(S.mk(new THREE.BoxGeometry(2.0, 2.0, 0.08), new THREE.MeshStandardMaterial({ color: 0x3d1a12, roughness: 0.6 }), cx, y0 + 1.35, tpl.z0 - 0.03));
    const plaque = S.canvasTex(256, 80, (c, ww, hh) => {
      c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, ww, hh);
      c.strokeStyle = '#d4a017'; c.lineWidth = 6; c.strokeRect(3, 3, ww - 6, hh - 6);
      c.fillStyle = '#e8c35a'; c.font = 'bold 50px "Noto Serif TC","Noto Sans TC",serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('福 德 祠', ww / 2, hh / 2 + 2);
    });
    const pq = S.mk(new THREE.PlaneGeometry(2.2, 0.68), new THREE.MeshStandardMaterial({ map: plaque, roughness: 0.6 }), cx, y0 + 2.65, tpl.z0 - 0.06, true);
    pq.rotation.y = Math.PI;
    g.add(pq);
    // 金爐
    const burner = new THREE.Group();
    burner.add(S.mk(new THREE.CylinderGeometry(0.55, 0.65, 1.1, 8), red, 0, 0.55, 0));
    burner.add(S.mk(new THREE.CylinderGeometry(0.15, 0.4, 0.6, 8), gold, 0, 1.4, 0));
    burner.position.set(tpl.x1 + 1.6, y0 + 0.07, tpl.z0 - 1.2);
    g.add(burner);
    colliders.push({ x: burner.position.x, z: burner.position.z, r: 0.7 });
    // 紅燈籠
    [-1, 1].forEach(sd => g.add(S.mk(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe53935, emissive: 0x661010, emissiveIntensity: 0.6, roughness: 0.5 }), cx + sd * 1.6, y0 + 2.6, tpl.z0 - 0.3)));
    for (let x = tpl.x0; x <= tpl.x1; x += 1.2) [tpl.z0, tpl.z1].forEach(z => colliders.push({ x, z, r: 0.7 }));
    for (let z = tpl.z0; z <= tpl.z1; z += 1.2) [tpl.x0, tpl.x1].forEach(x => colliders.push({ x, z, r: 0.7 }));
  }

  // ------------------------------------------------ 農路旁電線桿 + 路口指示牌
  {
    const pole = new THREE.MeshStandardMaterial({ color: 0x9b9a94, roughness: 0.8 });
    [[11.0, 72], [11.0, 100]].forEach(([x, z]) => {
      g.add(S.mk(new THREE.CylinderGeometry(0.1, 0.14, 8, 10), pole, x, H(x, z) + 4, z));
      colliders.push({ x, z, r: 0.3 });
      sm.poleColliders.push({ ...toWorld(x, z), r: 0.3 });
    });
    const sign = S.canvasTex(256, 96, (c, ww, hh) => {
      c.fillStyle = '#f2b705'; c.fillRect(0, 0, ww, hh);
      c.fillStyle = '#1f2d3d'; c.font = 'bold 40px "Noto Sans TC",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('福德祠 ↑', ww / 2, hh / 2 + 2);
    });
    // 牌面朝 -x (現場座標；也就是迎著從公司開過來的車)，柱子在背面
    const post = S.mk(new THREE.CylinderGeometry(0.04, 0.04, 2.0, 8), S.M.aluDark, 5.66, H(5.6, 53) + 1.0, 53);
    g.add(post);
    const back = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.5, metalness: 0.4 });
    const face = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 });
    const pl = S.mk(new THREE.BoxGeometry(0.025, 0.38, 1.0), [back, face, back, back, back, back], 5.6, H(5.6, 53) + 1.8, 53, true);
    g.add(pl);
  }

  sm.scene.add(g);
  return { group: g, colliders: colliders.map(c => ({ ...toWorld(c.x, c.z), r: c.r })), kennel: toWorld(kennel.x, kennel.z) };
}

// ======================================================================
// 平板地圖 (俯視示意)：Q 開關。只畫地物，不標好壞
// ======================================================================
const MAP_COL: Partial<Record<Surf, string>> = {
  lane: '#b9b6ad', drive: '#b9b6ad', bank: '#c4c1b8', canal: '#6f8a9a', apron: '#bdbab2', path: '#c4c1b8', yard: '#cfccc2', apronT: '#d5c6ae',
  platform: '#bdbab2', pad: '#c4c1b8', ridge: '#c4c1b8', fieldW: '#9c8a5c', fieldE: '#8a6a48', veg: '#7da35a', bamboo: '#5f8f4a',
  house: '#6d8fb0', temple: '#c0392b',
};

export function drawSiteMap(c: CanvasRenderingContext2D, W: number, Hh: number, o: {
  player?: { x: number; z: number; yaw: number }; truck?: { x: number; z: number; heading: number };
  gcps?: { x: number; z: number; name: string }[]; asst?: { x: number; z: number } | null;
}) {
  const X0 = -46, X1 = 46, Z0 = 41, Z1 = 124;
  const sc = Math.min(W / (X1 - X0), Hh / (Z1 - Z0));
  const ox = (W - (X1 - X0) * sc) / 2, oy = (Hh - (Z1 - Z0) * sc) / 2;
  // 北在上、東在右。現場座標轉了 180°，所以現場的 +x 在左、+z 在上
  const px = (x: number) => ox + (X1 - x) * sc;
  const py = (z: number) => oy + (Z1 - z) * sc;
  const L = (p: { x: number; z: number }) => toLocal(p.x, p.z);
  c.fillStyle = '#9cbf7a'; c.fillRect(0, 0, W, Hh);
  // 縣道
  c.fillStyle = '#55585c'; c.fillRect(0, py(51.4), W, (51.4 - 44.6) * sc);
  c.strokeStyle = '#e8c547'; c.lineWidth = 1.5; c.setLineDash([]); c.beginPath(); c.moveTo(0, py(48)); c.lineTo(W, py(48)); c.stroke();
  [...RECTS].reverse().forEach(r => {
    const col = MAP_COL[r.s];
    if (!col) return;
    c.fillStyle = col;
    c.fillRect(px(r.x1), py(r.z1), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);
  });
  // 樹冠
  CROWNS.forEach(t => { c.fillStyle = 'rgba(40,95,40,0.85)'; c.beginPath(); c.arc(px(t.x), py(t.z), t.r * sc, 0, Math.PI * 2); c.fill(); });
  BAMBOO.forEach(b => { c.fillStyle = 'rgba(50,110,45,0.9)'; c.beginPath(); c.arc(px(b.x), py(b.z), (b.r + 0.9) * sc, 0, Math.PI * 2); c.fill(); });
  // 文字
  c.fillStyle = '#1f2d3d'; c.font = `bold ${Math.round(sc * 2.2)}px "Noto Sans TC",sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillStyle = '#f3f4f6'; c.fillText('縣道', px(38), py(48));
  c.fillText('農舍', px(-26), py(112));
  c.fillText('土地公廟', px(29), py(110));
  c.fillText('竹林', px(-6.5), py(108));
  c.fillText('菜園', px(15), py(106));
  // 航測範圍
  c.strokeStyle = '#e11d48'; c.lineWidth = 3; c.setLineDash([10, 6]);
  c.strokeRect(px(AREA.x1), py(AREA.z1), (AREA.x1 - AREA.x0) * sc, (AREA.z1 - AREA.z0) * sc);
  c.setLineDash([]);
  c.fillStyle = '#e11d48'; c.font = `bold ${Math.round(sc * 2)}px "Noto Sans TC",sans-serif`; c.textAlign = 'left';
  c.fillText('航測範圍', px(AREA.x1) + 4, py(AREA.z0) + sc * 1.9);
  // 已佈設的點
  (o.gcps || []).forEach(pw => {
    const p = { ...L(pw), name: pw.name };
    c.fillStyle = '#111'; c.fillRect(px(p.x) - 6, py(p.z) - 6, 12, 12);
    c.fillStyle = '#fff'; c.fillRect(px(p.x) - 6, py(p.z) - 6, 6, 6); c.fillRect(px(p.x), py(p.z), 6, 6);
    c.strokeStyle = '#e11d48'; c.lineWidth = 1.5; c.strokeRect(px(p.x) - 6, py(p.z) - 6, 12, 12);
    c.fillStyle = '#111'; c.font = 'bold 13px "Noto Sans TC",sans-serif'; c.textAlign = 'left';
    c.fillText(p.name, px(p.x) + 9, py(p.z) - 8);
  });
  if (o.truck) {
    const t = L(o.truck);
    c.save(); c.translate(px(t.x), py(t.z)); c.rotate(-o.truck.heading);
    c.fillStyle = '#f5f5f5'; c.strokeStyle = '#333'; c.lineWidth = 1;
    c.fillRect(-2.9 * sc, -1.1 * sc, 5.8 * sc, 2.2 * sc); c.strokeRect(-2.9 * sc, -1.1 * sc, 5.8 * sc, 2.2 * sc);
    c.restore();
  }
  if (o.asst) { const a = L(o.asst); c.fillStyle = '#1e88e5'; c.beginPath(); c.arc(px(a.x), py(a.z), 5, 0, Math.PI * 2); c.fill(); }
  if (o.player) {
    const pl = L(o.player);
    c.save(); c.translate(px(pl.x), py(pl.z)); c.rotate(-o.player.yaw);
    c.fillStyle = '#f59e0b'; c.strokeStyle = '#111'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -11); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }
  // 指北 + 比例尺
  c.fillStyle = '#111'; c.font = 'bold 16px sans-serif'; c.textAlign = 'center';
  c.fillText('N', W - 24, 22); c.beginPath(); c.moveTo(W - 24, 30); c.lineTo(W - 30, 46); c.lineTo(W - 18, 46); c.closePath(); c.fill();
  c.fillRect(16, Hh - 18, 10 * sc, 4); c.font = '12px sans-serif'; c.textAlign = 'left'; c.fillText('10 m', 16, Hh - 26);
  return { px, py, sc };
}
