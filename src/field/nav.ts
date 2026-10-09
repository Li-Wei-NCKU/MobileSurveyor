/**
 * 道路導航：地面 GPS 導航線 + 轉彎提示 + 路口指示牌
 */
import * as THREE from 'three';
import { SM, type SceneManager } from './legacy';

type Pt = [number, number];
export type TurnDir = 'left' | 'right' | 'straight' | 'arrive';
interface Maneuver { at: Pt; text: string; dir: TurnDir; idx?: number }
interface Route { pts: Pt[]; maneuvers: Maneuver[] }

export type RouteId = 'toSite' | 'return' | 'toLevel' | 'levelReturn' | 'toGcp' | 'gcpReturn';
export const ROUTES: Record<RouteId, Route> = {
  toSite: {
    pts: [[-150, 61], [-150, 55], [-149.3, 51.8], [-146, 49.8], [-120, 49.7], [-60, 49.7], [-16, 49.7], [-11.2, 48.6], [-9.4, 45.5], [-9.2, 36], [-9.2, 24], [-9.4, 17], [-9.5, 14]],
    maneuvers: [
      { at: [-149.3, 51.8], text: '右轉上縣道（往東）', dir: 'right' },
      { at: [-11.2, 48.6], text: '左轉進產業道路', dir: 'left' },
      { at: [-9.5, 14], text: '抵達現場：停在路邊空地', dir: 'arrive' },
    ],
  },
  return: {
    pts: [[-9.5, 14], [-9.3, 24], [-9.2, 36], [-9.3, 43.5], [-10.8, 46.1], [-16, 46.3], [-60, 46.3], [-120, 46.3], [-145.5, 46.5], [-149.2, 49.5], [-150, 55], [-150, 63.5]],
    maneuvers: [
      { at: [-10.8, 46.1], text: '右轉上縣道（往西）', dir: 'right' },
      { at: [-149.2, 49.5], text: '左轉進公司', dir: 'left' },
      { at: [-150, 63.5], text: '停進白線停車格', dir: 'arrive' },
    ],
  },
  // 第二天：縣道東段路肩 (水準路線)
  toLevel: {
    pts: [[-150, 61], [-150, 55], [-149.3, 51.8], [-146, 49.8], [-120, 49.7], [-60, 49.7], [-11, 49.7], [20, 49.7], [40, 49.7], [45.5, 50.6], [49, 52.1], [52, 52.4]],
    maneuvers: [
      { at: [-149.3, 51.8], text: '右轉上縣道（往東）', dir: 'right' },
      { at: [-11, 49.7], text: '直行經過產業道路口', dir: 'straight' },
      { at: [52, 52.4], text: '靠右停在路肩', dir: 'arrive' },
    ],
  },
  // 第三天：出公司左轉往西，縣道北側農地 (福德祠農路)
  toGcp: {
    pts: [[-150, 61], [-150, 55], [-150.6, 51.6], [-153, 47.4], [-160, 46.3], [-200, 46.3], [-245, 46.3], [-253.5, 46.1], [-256.4, 44.6], [-257, 42.6], [-259.4, 41.0], [-261.6, 40.8]],
    maneuvers: [
      { at: [-150.6, 51.6], text: '左轉上縣道（往西，注意來車）', dir: 'left' },
      { at: [-253.5, 46.1], text: '右轉進農路（福德祠指示牌）', dir: 'right' },
      { at: [-261.6, 40.8], text: '停在路口旁的空地', dir: 'arrive' },
    ],
  },
  gcpReturn: {
    pts: [[-261.6, 40.8], [-258.6, 41.2], [-257, 43], [-256.2, 45.8], [-252, 49.5], [-245, 49.7], [-200, 49.7], [-160, 49.7], [-152, 50.2], [-150.3, 52.5], [-150, 55], [-150, 63.5]],
    maneuvers: [
      { at: [-256.2, 45.8], text: '左轉上縣道（往東，注意來車）', dir: 'left' },
      { at: [-152, 50.2], text: '右轉進公司', dir: 'right' },
      { at: [-150, 63.5], text: '停進白線停車格', dir: 'arrive' },
    ],
  },
  levelReturn: {
    pts: [[52, 52.4], [46, 51.2], [40, 48.8], [34, 46.6], [28, 46.3], [-16, 46.3], [-60, 46.3], [-120, 46.3], [-145.5, 46.5], [-149.2, 49.5], [-150, 55], [-150, 63.5]],
    maneuvers: [
      { at: [40, 48.8], text: '左轉迴轉往西（注意來車）', dir: 'left' },
      { at: [-149.2, 49.5], text: '左轉進公司', dir: 'left' },
      { at: [-150, 63.5], text: '停進白線停車格', dir: 'arrive' },
    ],
  },
};

export interface NavState { text: string; dir: TurnDir; dist: number; off: boolean }

export class Navigator {
  private ribbon: THREE.Mesh | null = null;
  private tex: THREE.Texture;
  private samples: { x: number; z: number; s: number }[] = [];
  private route: Route | null = null;
  private progress = 0;

  constructor(private sm: SceneManager) {
    this.tex = SM().canvasTex(64, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      // 半透明底帶 + 兩側邊線，讓導航線在草地和柏油上都看得清楚
      c.fillStyle = 'rgba(255, 210, 63, 0.22)'; c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255, 210, 63, 0.9)'; c.fillRect(0, 0, 5, h); c.fillRect(w - 5, 0, 5, h);
      c.strokeStyle = 'rgba(255, 210, 63, 0.95)';
      c.lineWidth = 12;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      // 指向 +v (前進方向) 的人字箭頭
      c.beginPath(); c.moveTo(10, 92); c.lineTo(32, 52); c.lineTo(54, 92); c.stroke();
    });
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.buildSigns();
  }

  setRoute(kind: RouteId | null) {
    if (this.ribbon) { this.sm.scene.remove(this.ribbon); this.ribbon.geometry.dispose(); this.ribbon = null; }
    this.route = kind ? ROUTES[kind] : null;
    this.samples = [];
    this.progress = 0;
    if (!this.route) return;

    // 每 1 m 取樣
    const pts = this.route.pts;
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const L = Math.hypot(x2 - x1, z2 - z1);
      const n = Math.max(1, Math.ceil(L));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        this.samples.push({ x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, s: acc + L * t });
      }
      acc += L;
    }
    const last = pts[pts.length - 1];
    this.samples.push({ x: last[0], z: last[1], s: acc });
    this.route.maneuvers.forEach(m => { m.idx = this.nearestIndex(m.at[0], m.at[1], 0, this.samples.length); });

    // 地面導航帶
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const halfW = 0.75;
    this.samples.forEach((p, i) => {
      const a = this.samples[Math.max(0, i - 1)], b = this.samples[Math.min(this.samples.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx;
      const yl = this.sm.heightAt(p.x + nx * halfW, p.z + nz * halfW) + 0.14;
      const yr = this.sm.heightAt(p.x - nx * halfW, p.z - nz * halfW) + 0.14;
      pos.push(p.x + nx * halfW, yl, p.z + nz * halfW, p.x - nx * halfW, yr, p.z - nz * halfW);
      uv.push(0, p.s / 1.6, 1, p.s / 1.6);
      if (i > 0) { const j = (i - 1) * 2; idx.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.ribbon = new THREE.Mesh(g, mat);
    this.ribbon.renderOrder = 3;
    this.ribbon.frustumCulled = false;
    this.sm.scene.add(this.ribbon);
  }

  private nearestIndex(x: number, z: number, from: number, to: number): number {
    let best = from, bd = Infinity;
    for (let i = Math.max(0, from); i < Math.min(this.samples.length, to); i++) {
      const d = (this.samples[i].x - x) ** 2 + (this.samples[i].z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  update(dt: number, x: number, z: number): NavState | null {
    this.tex.offset.y -= dt * 1.2;
    if (!this.route || !this.samples.length) return null;
    // 只往前找，避免在路口附近跳回
    let i = this.nearestIndex(x, z, this.progress - 5, this.progress + 60);
    const d = Math.hypot(this.samples[i].x - x, this.samples[i].z - z);
    if (d > 15) {
      const g = this.nearestIndex(x, z, 0, this.samples.length);
      if (Math.hypot(this.samples[g].x - x, this.samples[g].z - z) < 15) i = g;
    }
    this.progress = Math.max(this.progress, i);
    const off = Math.hypot(this.samples[this.progress].x - x, this.samples[this.progress].z - z) > 12;
    const next = this.route.maneuvers.find(m => (m.idx ?? 0) >= this.progress - 2) || this.route.maneuvers[this.route.maneuvers.length - 1];
    const dist = Math.max(0, this.samples[next.idx ?? 0].s - this.samples[this.progress].s);
    if (off) return { text: '偏離路線了，回到地上的黃色導航線', dir: 'straight', dist: Math.round(d), off: true };
    if (dist > 60 && next.dir !== 'arrive') return { text: `沿路直行，${Math.round(dist)} m 後${next.text}`, dir: 'straight', dist, off: false };
    return { text: next.text, dir: next.dir, dist, off: false };
  }

  /** 路口指示牌 (台灣綠底白字指示牌風格) */
  private buildSigns() {
    const S = SM();
    const sign = (x: number, z: number, rotY: number, lines: string[], arrow: '←' | '→' | '↑', color = '#1b6e3c') => {
      const g = new THREE.Group();
      const y0 = this.sm.heightAt(x, z);
      g.position.set(x, y0, z);
      g.rotation.y = rotY;
      // 柱子在牌子背面 (牌面朝 +Z)
      g.add(S.mk(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 10), S.M.alu, -0.9, 1.6, -0.09));
      g.add(S.mk(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 10), S.M.alu, 0.9, 1.6, -0.09));
      const tex = S.canvasTex(512, 256, (c, w, h) => {
        c.fillStyle = color; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#fff'; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
        c.fillStyle = '#fff'; c.textBaseline = 'middle';
        c.font = 'bold 150px sans-serif'; c.textAlign = arrow === '←' ? 'left' : 'right';
        c.fillText(arrow, arrow === '←' ? 26 : w - 26, h / 2 + 6);
        c.textAlign = 'center';
        c.font = 'bold 54px "Noto Sans TC","Microsoft JhengHei",sans-serif';
        const cx = arrow === '←' ? w / 2 + 70 : w / 2 - 70;
        lines.forEach((t, i) => c.fillText(t, cx, h / 2 + (i - (lines.length - 1) / 2) * 66));
      });
      const board = S.mk(new THREE.BoxGeometry(2.4, 1.2, 0.06), [S.M.alu, S.M.alu, S.M.alu, S.M.alu, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), S.M.alu], 0, 2.7, 0);
      g.add(board);
      this.sm.scene.add(g);
    };
    // 公司出口：面向公司車道 (看向 -Z 時可讀)
    sign(-153.5, 52.6, 0, ['現場 CKSV', '往東 140 m'], '→', '#1b6e3c');
    // 產業道路路口：從西邊來 (往東開) 時可讀
    sign(-17, 52.6, -Math.PI / 2 + 0.25, ['CKSV 測點', '產業道路'], '←', '#1b6e3c');
    // 回程：產業道路口往西
    sign(-12.2, 42.6, Math.PI, ['公司', '往西'], '→', '#0b4f8a');
    // 回程：公司入口 (往西開時可讀)
    sign(-141, 43.4, Math.PI / 2 - 0.25, ['鍵盤測量', '有限公司'], '←', '#0b4f8a');
  }
}
