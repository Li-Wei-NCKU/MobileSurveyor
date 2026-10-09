/**
 * 外業一日的額外場景：公司倉庫 (鐵皮器材室 + 貨架)、現場停車區
 */
import * as THREE from 'three';
import { SM, type SceneManager } from './legacy';
import type { ItemId } from './items';

export const YARD = { x: -150, z: 68, r: 20 };
export const TRUCK_HOME = { x: -150, z: 63.5, heading: Math.PI / 2 };
export const SITE_PARK = { x: -9.5, z: 12, r: 6.5 };
export const CKSV = { x: 0, z: 0 };

export interface ShelfSpot { item: ItemId | null; pos: THREE.Vector3; rotY: number }

export function buildYard(sm: SceneManager): { group: THREE.Group; spots: ShelfSpot[]; boards: THREE.Object3D[]; colliders: { x: number; z: number; r: number }[]; roof: THREE.Object3D; walls: THREE.Mesh[] } {
  const S = SM();
  const g = new THREE.Group();
  const y0 = sm.heightAt(YARD.x, YARD.z);
  g.position.set(YARD.x, y0, YARD.z);

  // 水泥地坪 + 車道
  const conc = new THREE.MeshStandardMaterial({
    map: S.canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#9c9a93'; c.fillRect(0, 0, w, h);
      const r = S.rng(9);
      for (let i = 0; i < 5000; i++) { const v = 130 + Math.floor(r() * 50); c.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; c.fillRect(r() * w, r() * h, 2, 2); }
      c.strokeStyle = 'rgba(60,60,60,0.35)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h);
    }, { repeat: [6, 6] }),
    roughness: 0.95,
  });
  const slab = S.mk(new THREE.BoxGeometry(22, 0.2, 26), conc, 0, -0.08, -1, true);
  slab.receiveShadow = true;
  g.add(slab);
  const drive = S.mk(new THREE.BoxGeometry(6, 0.2, 5), conc, 0, -0.09, -15.5, true);
  g.add(drive);
  // 停車格白線
  const paint = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
  [-1.6, 1.6].forEach(dx => g.add(S.mk(new THREE.BoxGeometry(0.12, 0.01, 6.2), paint, dx, 0.025, -4.5, true)));

  // 鐵皮器材室 (開口朝南 -Z)
  const steel = new THREE.MeshStandardMaterial({ color: 0x8aa0ad, roughness: 0.55, metalness: 0.5 });
  const roofTex = S.canvasTex(64, 256, (c, w, h) => {
    for (let x = 0; x < w; x += 8) { c.fillStyle = x % 16 ? '#5f7f95' : '#4f6d82'; c.fillRect(x, 0, 8, h); }
  }, { repeat: [10, 1] });
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  const SX = 14, SZ0 = 4, SZ1 = 12;
  [-SX / 2, 0, SX / 2].forEach(x => [SZ0, SZ1].forEach(z => g.add(S.mk(new THREE.BoxGeometry(0.18, 4.4, 0.18), S.M.aluDark, x, 2.2, z))));
  const roof = S.mk(new THREE.PlaneGeometry(SX + 1.2, SZ1 - SZ0 + 1.6), roofMat, 0, 4.25, (SZ0 + SZ1) / 2);
  roof.rotation.x = -Math.PI / 2 + 0.08;
  g.add(roof);
  const wallTex = S.canvasTex(256, 64, (c, w, h) => {
    for (let x = 0; x < w; x += 10) { c.fillStyle = x % 20 ? '#c9d2d6' : '#b5c0c5'; c.fillRect(x, 0, 10, h); }
  }, { repeat: [6, 1] });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, metalness: 0.3 });
  const walls: THREE.Mesh[] = [];
  const backWall = S.mk(new THREE.BoxGeometry(SX, 4.2, 0.08), wallMat, 0, 2.1, SZ1) as THREE.Mesh;
  g.add(backWall); walls.push(backWall);
  [-1, 1].forEach(sd => { const w = S.mk(new THREE.BoxGeometry(0.08, 4.2, SZ1 - SZ0), wallMat, sd * SX / 2, 2.1, (SZ0 + SZ1) / 2) as THREE.Mesh; g.add(w); walls.push(w); });
  // 招牌
  const sign = S.canvasTex(1024, 128, (c, w, h) => {
    c.fillStyle = '#0b3d6e'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#f2b705'; c.fillRect(0, h - 14, w, 14);
    c.fillStyle = '#ffffff'; c.font = 'bold 72px "Noto Sans TC","Microsoft JhengHei",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('鍵盤測量有限公司　器材室', w / 2, h / 2 - 4);
  });
  const signMesh = S.mk(new THREE.PlaneGeometry(9, 1.1), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }), 0, 3.6, SZ0 - 0.12, true);
  signMesh.rotation.y = Math.PI;
  g.add(signMesh);
  walls.push(signMesh as THREE.Mesh);
  g.add(S.mk(new THREE.BoxGeometry(SX, 0.6, 0.1), steel, 0, 3.75, SZ0 - 0.05));

  // 貨架
  const spots: ShelfSpot[] = [];
  const boards: THREE.Object3D[] = [];
  const rackMat = new THREE.MeshStandardMaterial({ color: 0x1e5aa8, roughness: 0.5, metalness: 0.4 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xc7c2b5, roughness: 0.8 });
  const levels = [0.12, 0.85, 1.55];
  const racks: { cx: number; items: (ItemId | null)[][] }[] = [
    { cx: -3.6, items: [['tripod', 'staff'], ['gnss', 'tribrach', 'toolbag'], ['level', 'paint', null]] },
    { cx: 2.4, items: [['prism', 'hammer'], ['plate', 'cones', null], ['rtk', 'template', null]] },
  ];
  const rz = SZ1 - 0.55;
  racks.forEach(rk => {
    const len = 4.4, dep = 0.7;
    [-len / 2, len / 2].forEach(dx => [-dep / 2, dep / 2].forEach(dz => g.add(S.mk(new THREE.BoxGeometry(0.06, 2.1, 0.06), rackMat, rk.cx + dx, 1.05, rz + dz))));
    levels.forEach((ly, li) => {
      const board = S.mk(new THREE.BoxGeometry(len, 0.04, dep), boardMat, rk.cx, ly, rz);
      board.userData = { type: 'shelf' };
      g.add(board);
      boards.push(board);
      g.add(S.mk(new THREE.BoxGeometry(len, 0.08, 0.05), rackMat, rk.cx, ly - 0.02, rz - dep / 2));
      const row = rk.items[li];
      row.forEach((it, i) => {
        const x = rk.cx - len / 2 + (len / row.length) * (i + 0.5);
        const wpos = new THREE.Vector3(YARD.x + x, y0 + ly + 0.02, YARD.z + rz);
        spots.push({ item: it, pos: wpos, rotY: 0 });
      });
    });
  });

  // 一些雜物：工作桌、垃圾桶、標語
  g.add(S.mk(new THREE.BoxGeometry(1.8, 0.05, 0.8), new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.8 }), 5.5, 0.85, 8));
  [[-0.8, -0.3], [0.8, -0.3], [-0.8, 0.3], [0.8, 0.3]].forEach(([a, b]) => g.add(S.mk(new THREE.BoxGeometry(0.05, 0.85, 0.05), S.M.aluDark, 5.5 + a, 0.42, 8 + b)));
  const poster = S.canvasTex(256, 360, (c, w, h) => {
    c.fillStyle = '#fffbe6'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#b42318'; c.font = 'bold 40px "Noto Sans TC",sans-serif'; c.textAlign = 'center';
    c.fillText('出 門 前', w / 2, 70);
    c.fillStyle = '#1f2d3d'; c.font = '28px "Noto Sans TC",sans-serif';
    ['看工單', '想流程', '點設備', '別問組長'].forEach((t, i) => c.fillText(`${i + 1}. ${t}`, w / 2, 140 + i * 50));
  });
  const pm = S.mk(new THREE.PlaneGeometry(0.8, 1.1), new THREE.MeshStandardMaterial({ map: poster, roughness: 0.9 }), -SX / 2 + 0.06, 1.7, 8, true);
  pm.rotation.y = Math.PI / 2;
  g.add(pm);

  sm.scene.add(g);

  // 碰撞：牆面以多個圓近似
  const colliders: { x: number; z: number; r: number }[] = [];
  for (let x = -SX / 2; x <= SX / 2; x += 1) colliders.push({ x: YARD.x + x, z: YARD.z + SZ1, r: 0.5 });
  for (let z = SZ0; z <= SZ1; z += 1) [-1, 1].forEach(sd => colliders.push({ x: YARD.x + sd * SX / 2, z: YARD.z + z, r: 0.5 }));
  [-SX / 2, 0, SX / 2].forEach(x => colliders.push({ x: YARD.x + x, z: YARD.z + SZ0, r: 0.4 }));

  return { group: g, spots, boards, colliders, roof, walls };
}
