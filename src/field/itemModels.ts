/**
 * 外業設備 3D 模型 (後斗、地面、手持共用)
 * 座標：長度沿 +X、寬度沿 Z、底部在 y=0。
 */
import * as THREE from 'three';
import { ITEMS, type ItemId } from './items';
import { SM } from './legacy';

export const CELL_X = 0.44; // 一格長度 (沿車長)
export const CELL_Z = 0.44; // 一格寬度 (沿車寬，正方形格子以便旋轉)
export const LAYER_H = 0.32;

const labelCache = new Map<string, THREE.Texture>();
function labelTex(text: string): THREE.Texture {
  const hit = labelCache.get(text);
  if (hit) return hit;
  const t = SM().canvasTex(256, 96, (c, w, h) => {
    c.fillStyle = '#f7f5ec';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#1f2d3d';
    c.lineWidth = 4;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.fillStyle = '#1f2d3d';
    c.font = 'bold 34px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2, w - 20);
  });
  labelCache.set(text, t);
  return t;
}

function topLabel(g: THREE.Group, text: string, y: number, len: number, wid: number) {
  const lw = Math.min(len * 0.8, 0.42), lh = Math.min(wid * 0.55, lw * 0.375);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(lw, lh), new THREE.MeshStandardMaterial({ map: labelTex(text), roughness: 0.8 }));
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.PI / 2;
  m.position.y = y + 0.003;
  g.add(m);
}

const matCache = new Map<number, THREE.MeshStandardMaterial>();
function colorMat(c: number, rough = 0.5) {
  const k = c * 10 + Math.round(rough * 10);
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.05 }); matCache.set(k, m); }
  return m;
}

/** 建立物品模型；w/d 為格數，會依格數決定大小 */
export function buildItemModel(id: ItemId): THREE.Group {
  const sm = SM();
  const def = ITEMS[id];
  const g = new THREE.Group();
  const len = def.d * CELL_X - 0.06;
  const wid = def.w * CELL_Z - 0.05;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  switch (def.kind) {
    case 'case': {
      const h = id === 'tribrach' ? 0.18 : id === 'drone' ? 0.3 : 0.27;
      const l = id === 'tribrach' ? len * 0.7 : len;
      const w = id === 'tribrach' ? wid * 0.8 : wid;
      g.add(sm.mk(sm.rbox(l, h, w, 0.025), colorMat(def.color, 0.45), 0, h / 2, 0));
      g.add(sm.mk(new THREE.BoxGeometry(l + 0.004, 0.014, w + 0.004), sm.M.black, 0, h * 0.62, 0, true));
      [-1, 1].forEach(s => g.add(sm.mk(new THREE.BoxGeometry(0.05, 0.045, 0.016), sm.M.black, s * l * 0.28, h * 0.62, w / 2 + 0.01, true)));
      g.add(sm.mk(sm.rbox(l * 0.36, 0.028, 0.045, 0.01), sm.M.black, 0, h + 0.018, 0));
      topLabel(g, def.name.replace('箱', ''), h, l, w);
      break;
    }
    case 'tripod': {
      const legMat = sm.M.tripodLeg;
      [[0, 0.07, 0.05], [0, 0.07, -0.05], [0, 0.15, 0]].forEach(([, y, z]) => {
        g.add(sm.mk(new THREE.BoxGeometry(len * 0.72, 0.035, 0.045), legMat, -len * 0.1, y, z));
        g.add(sm.mk(new THREE.BoxGeometry(len * 0.3, 0.025, 0.028), sm.M.aluDark, len * 0.32, y, z));
      });
      g.add(sm.mk(new THREE.CylinderGeometry(0.085, 0.085, 0.05, 24).rotateZ(Math.PI / 2), sm.M.aluDark, -len / 2 + 0.02, 0.11, 0));
      g.add(sm.mk(new THREE.BoxGeometry(0.07, 0.2, 0.17), sm.M.black, len * 0.2, 0.1, 0));
      g.add(sm.mk(new THREE.BoxGeometry(0.04, 0.03, 0.2), colorMat(0xb42318, 0.7), -len * 0.05, 0.17, 0, true));
      break;
    }
    case 'staff': {
      const tex = sm.canvasTex(256, 32, (c, w, h) => {
        c.fillStyle = '#f5f5f2'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 24; i++) { c.fillStyle = i % 10 < 5 ? '#c81e1e' : '#111'; c.fillRect(i * 10 + 4, 4, 5, h - 8); }
      });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 });
      g.add(sm.mk(new THREE.BoxGeometry(len, 0.05, 0.11), [sm.M.alu, sm.M.alu, face, sm.M.alu, sm.M.alu, sm.M.alu], 0, 0.025, 0));
      g.add(sm.mk(new THREE.BoxGeometry(0.03, 0.06, 0.12), sm.M.black, len / 2 - 0.015, 0.03, 0));
      g.add(sm.mk(new THREE.BoxGeometry(0.02, 0.055, 0.12), sm.M.steel, -len / 2 + 0.01, 0.028, 0));
      break;
    }
    case 'pole': {
      if (id === 'rtk') {
        // 黃色對中桿 + 頂端接收儀 (灰色圓盤) + 綁在桿上的手簿
        g.add(sm.rodBetween(V(-len / 2, 0.03, 0), V(len / 2 - 0.1, 0.03, 0), 0.013, 0.013, colorMat(0xf2b705, 0.4), 12));
        g.add(sm.mk(new THREE.CylinderGeometry(0.075, 0.08, 0.06, 24).rotateZ(Math.PI / 2), colorMat(0x6b7280, 0.4), len / 2 - 0.06, 0.08, 0));
        g.add(sm.mk(sm.rbox(0.16, 0.03, 0.09, 0.01), sm.M.black, 0, 0.055, 0));
        g.add(sm.mk(new THREE.BoxGeometry(0.12, 0.004, 0.07), colorMat(0x5aa9e6, 0.2), 0, 0.072, 0, true));
        break;
      }
      g.add(sm.rodBetween(V(-len / 2, 0.03, 0), V(len / 2 - 0.08, 0.03, 0), 0.0125, 0.0125, colorMat(0xd62828, 0.4), 12));
      for (let i = 0; i < 5; i++) g.add(sm.rodBetween(V(-len / 2 + 0.1 + i * 0.2, 0.03, 0), V(-len / 2 + 0.2 + i * 0.2, 0.03, 0), 0.013, 0.013, sm.M.white, 12));
      g.add(sm.rodBetween(V(len / 2 - 0.1, 0.045, 0), V(len / 2 - 0.02, 0.045, 0), 0.044, 0.044, sm.M.orange, 20));
      break;
    }
    case 'bag': {
      g.add(sm.mk(sm.rbox(len * 0.85, 0.2, wid * 0.85, 0.05), colorMat(def.color, 0.9), 0, 0.1, 0));
      g.add(sm.mk(sm.rbox(len * 0.6, 0.012, wid * 0.86, 0.004), colorMat(0x1b3550, 0.9), 0.04, 0.2, 0, true));
      [-1, 1].forEach(s => g.add(sm.rodBetween(V(-0.06, 0.2, s * 0.05), V(0.06, 0.2, s * 0.05), 0.008, 0.008, sm.M.black, 6)));
      // 露出的捲尺
      g.add(sm.mk(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 18).rotateX(Math.PI / 2), sm.M.yellow, len * 0.3, 0.2, wid * 0.25, true));
      topLabel(g, '工具袋', 0.21, len, wid * 0.5);
      break;
    }
    case 'box': {
      if (id === 'plate') {
        // 兩個鑄鐵尺墊疊在一起：三角形底板 + 中間圓頂
        [0, 0.07].forEach(y => {
          const tri = new THREE.Shape();
          for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + Math.PI / 2; const x = Math.cos(a) * 0.15, z = Math.sin(a) * 0.15; if (i === 0) tri.moveTo(x, z); else tri.lineTo(x, z); }
          const plateGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.025, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.006, bevelSegments: 2 }).rotateX(Math.PI / 2);
          g.add(sm.mk(plateGeo, colorMat(0x30343a, 0.75), 0, y + 0.03, 0));
          g.add(sm.mk(new THREE.SphereGeometry(0.035, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm.M.steel, 0, y + 0.03, 0));
        });
        g.add(sm.mk(new THREE.TorusGeometry(0.03, 0.006, 6, 16), sm.M.steel, 0.1, 0.15, 0));
      } else if (id === 'cones') {
        // 四個交通錐疊在一起
        const tex = sm.canvasTex(64, 128, (c, w, h) => { c.fillStyle = '#f26b0f'; c.fillRect(0, 0, w, h); c.fillStyle = '#f8fafc'; c.fillRect(0, 40, w, 18); c.fillRect(0, 78, w, 14); });
        const coneMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, side: THREE.DoubleSide });
        g.add(sm.mk(new THREE.BoxGeometry(0.3, 0.025, 0.3), sm.M.black, 0, 0.0125, 0));
        for (let i = 0; i < 4; i++) g.add(sm.mk(new THREE.CylinderGeometry(0.02, 0.12, 0.3, 18, 1, true), coneMat, 0, 0.17 + i * 0.03, 0));
      } else if (id === 'template') {
        // 疊起來的木框條 + 遮板
        const wood = colorMat(def.color, 0.85);
        for (let i = 0; i < 4; i++) g.add(sm.mk(new THREE.BoxGeometry(len * 0.96, 0.02, 0.12), wood, 0, 0.012 + i * 0.022, (i % 2 ? 0.07 : -0.07)));
        g.add(sm.mk(new THREE.BoxGeometry(len * 0.7, 0.012, wid * 0.8), colorMat(0xb98a55, 0.85), 0, 0.1, 0));
        g.add(sm.mk(new THREE.BoxGeometry(0.2, 0.002, 0.2), sm.M.white, -len * 0.18, 0.107, -0.05, true));
        g.add(sm.mk(new THREE.BoxGeometry(0.2, 0.002, 0.2), sm.M.black, len * 0.18, 0.107, 0.05, true));
      } else if (id === 'hammer') {
        g.add(sm.mk(sm.rbox(len * 0.8, 0.16, wid * 0.85, 0.015), colorMat(def.color, 0.4), 0, 0.08, 0));
        g.add(sm.rodBetween(V(-0.12, 0.2, 0), V(0.12, 0.2, 0), 0.01, 0.01, sm.M.black, 8));
        g.add(sm.rodBetween(V(-0.12, 0.16, 0), V(-0.12, 0.2, 0), 0.01, 0.01, sm.M.black, 8));
        g.add(sm.rodBetween(V(0.12, 0.16, 0), V(0.12, 0.2, 0), 0.01, 0.01, sm.M.black, 8));
        topLabel(g, '鐵鎚鋼釘', 0.16, len * 0.6, wid * 0.6);
      } else {
        const cardboard = colorMat(def.color, 0.95);
        g.add(sm.mk(new THREE.BoxGeometry(len * 0.85, 0.24, wid * 0.88), cardboard, 0, 0.12, 0));
        g.add(sm.mk(new THREE.BoxGeometry(len * 0.86, 0.004, 0.05), colorMat(0xc9b48a, 0.6), 0, 0.242, 0, true));
        topLabel(g, '噴漆', 0.244, len * 0.5, wid * 0.5);
      }
      break;
    }
    case 'water': {
      const tex = sm.canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = '#cfe8f7'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
          c.fillStyle = '#1e88e5'; c.beginPath(); c.arc(16 + i * 32, 11 + j * 21, 8, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#ffffff'; c.beginPath(); c.arc(14 + i * 32, 9 + j * 21, 3, 0, Math.PI * 2); c.fill();
        }
      });
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.2 });
      const side = new THREE.MeshStandardMaterial({ color: 0x9fd0ee, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 });
      g.add(sm.mk(new THREE.BoxGeometry(len * 0.85, 0.24, wid * 0.88), [side, side, top, side, side, side], 0, 0.12, 0));
      g.add(sm.mk(new THREE.BoxGeometry(len * 0.86, 0.06, wid * 0.89), colorMat(0x1565c0, 0.6), 0, 0.1, 0, true));
      break;
    }
  }
  g.userData.itemId = id;
  return g;
}
