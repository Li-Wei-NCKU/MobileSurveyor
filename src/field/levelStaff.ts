/**
 * 3 m 條碼水準尺 (電子水準儀自動判讀)。原點在尺底中心，條碼面朝 +Z。
 * 每 1 m 一張 256×4096 貼圖；右側窄條印公寸數字 (14 = 1.4 m) 方便人看。
 */
import * as THREE from 'three';
import { SM } from './legacy';

export const STAFF_LEN = 3.0;
const FACE_W = 0.07;

function faceTexture(meter: number): THREE.CanvasTexture {
  // 條碼尺 (電子水準儀用)：寬窄不一的黑白條碼，右側窄條留給人眼看的公寸數字
  const W = 256, H = 4096;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f7f6f0';
  x.fillRect(0, 0, W, H);
  const pxPerMm = H / 1000;
  const unit = 2.025; // mm，常見條碼尺的基本碼寬
  // 固定亂數 (每支尺一樣)
  let seed = 9173 + meter * 131;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const barW = W * 0.78;
  let mm = 0, black = true;
  while (mm < 1000) {
    const w = unit * (1 + Math.floor(rnd() * 4));
    if (black) {
      x.fillStyle = '#111';
      const y1 = H - (mm + w) * pxPerMm, y0 = H - mm * pxPerMm;
      x.fillRect(0, y1, barW, y0 - y1);
    }
    mm += w;
    black = !black;
  }
  // 右側公寸刻度與數字
  x.fillStyle = '#e9e7dc';
  x.fillRect(barW, 0, W - barW, H);
  x.fillStyle = '#b3121b';
  x.font = `bold ${Math.round(pxPerMm * 24)}px "Noto Sans TC", Arial, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  for (let dm = 0; dm < 10; dm++) {
    const y = H - dm * 100 * pxPerMm;
    x.fillRect(barW, y - 3, W - barW, 3);
    x.save();
    x.translate(barW + (W - barW) / 2, y - 50 * pxPerMm);
    x.rotate(-Math.PI / 2);
    x.fillText(String(meter * 10 + dm), 0, 0);
    x.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

let faceMats: THREE.MeshStandardMaterial[] | null = null;

export function buildLevelStaff(): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  if (!faceMats) faceMats = [0, 1, 2].map(m => new THREE.MeshStandardMaterial({ map: faceTexture(m), roughness: 0.55, emissive: 0xffffff, emissiveMap: faceTexture(m), emissiveIntensity: 0.18 }));
  // 鋁框
  g.add(sm.mk(new THREE.BoxGeometry(FACE_W + 0.012, STAFF_LEN, 0.03), sm.M.alu, 0, STAFF_LEN / 2, -0.001));
  // 刻劃面
  for (let i = 0; i < 3; i++) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(FACE_W, 1), faceMats[i]);
    face.position.set(0, i + 0.5, 0.0145);
    face.receiveShadow = true;
    g.add(face);
  }
  // 抽節接頭 + 底座 + 握把 + 圓水準器
  [1.0, 2.0].forEach(y => g.add(sm.mk(new THREE.BoxGeometry(FACE_W + 0.02, 0.012, 0.036), sm.M.aluDark, 0, y, -0.002)));
  g.add(sm.mk(new THREE.BoxGeometry(FACE_W + 0.016, 0.01, 0.036), sm.M.steel, 0, 0.005, 0));
  g.add(sm.mk(sm.rbox(0.024, 0.12, 0.026, 0.008), sm.M.black, -0.05, 1.25, -0.01));
  const bub = new THREE.Group();
  bub.add(sm.mk(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 18), sm.M.black, 0, 0, 0));
  bub.add(sm.mk(new THREE.SphereGeometry(0.004, 8, 6), sm.M.bubble, 0, 0.008, 0, true));
  bub.position.set(0.055, 1.45, -0.005);
  g.add(bub);
  g.userData.type = 'level_staff';
  return g;
}

/** 鑄鐵尺墊 (轉點用)，頂部圓頂高 4 cm */
export function buildTurningPlate(): THREE.Group {
  const sm = SM();
  const g = new THREE.Group();
  const tri = new THREE.Shape();
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + Math.PI / 2; const px = Math.cos(a) * 0.15, pz = Math.sin(a) * 0.15; if (i === 0) tri.moveTo(px, pz); else tri.lineTo(px, pz); }
  const geo = new THREE.ExtrudeGeometry(tri, { depth: 0.022, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.006, bevelSegments: 2 }).rotateX(Math.PI / 2);
  g.add(sm.mk(geo, new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.75, metalness: 0.3 }), 0, 0.028, 0));
  g.add(sm.mk(new THREE.SphereGeometry(0.03, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm.M.steel, 0, 0.012, 0));
  return g;
}
/** 尺墊頂 (標尺立在上面) 離地高度 */
export const PLATE_TOP = 0.042;
