/**
 * 第三天下午：UAV 航拍
 *  1. 拿著無人機箱對空地按 E 架起降點 (樹下不能飛；電線桿旁指南針會受干擾 — 不提示)
 *  2. 對著無人機按 E：在平板上一個一個點出航點 (Waypoint)，畫出航線；
 *     平板即時顯示前後重疊、側向重疊、範圍覆蓋 (需求：前後 ≥ 80%、側向 ≥ 70%)
 *  3. Space 上升到 30 m 後自動照航線飛、定距拍照；地上即時畫出照片涵蓋範圍 (footprint) 和四角到飛機的連線
 *  4. 途中大冠鷲來一次 (QTE 閃避)
 *  5. 飛完回到起降點上空，手動降落 (WASD 對準、Shift 下降)
 *  6. 降落後村民來問「你在拍我家喔？」，接著出正射影像 (沒拍到的地方是黑的) + 空三平差成果
 */
import * as THREE from 'three';
import type { AnyObj } from './legacy';
import { SM } from './legacy';
import { buildPerson, animateWalk } from './npc';
import { AREA, toWorld, toLocal, canopyAt, topAt, drawSiteMap, surfAt, CROP } from './gcpSite';
import { runQTE, qteActive } from './qte';
import * as ui from './ui';
import * as sfx from './sfx';
import { tell, whatIf } from './story';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const ALT = 30;
/** 照片涵蓋範圍 (相對航高)：跨航線寬、沿航線長 */
const FW = 0.66, FL = 0.5; // 一張照片：航高 × 0.66 (左右) / × 0.5 (前後)
const SPEED = 12;
export const NEED_FWD = 0.8, NEED_SIDE = 0.7;
/** 覆蓋網格 (現場座標) */
const GX0 = AREA.x0 - 12, GZ0 = AREA.z0 - 12, GS = 2;
const GNX = Math.ceil((AREA.x1 - AREA.x0 + 24) / GS), GNZ = Math.ceil((AREA.z1 - AREA.z0 + 24) / GS);

export type UavStage = 'none' | 'setup' | 'ready' | 'flying' | 'done';

export interface FlightLog {
  homeNearPole: boolean;
  compassOk: boolean | null;
  eagle: '' | 'dodged' | 'hit';
  /** 飛到一半被叫去移車，航線中斷再續飛 */
  seam?: boolean;
  landDist: number; landSpeed: number;
  battery: number;
  photos: number;
  fwd: number; side: number; cover: number;
  ortho: string | null;
}

function buildEagle(): THREE.Group {
  const S = SM();
  const g = new THREE.Group();
  const brown = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9, side: THREE.DoubleSide });
  const light = new THREE.MeshStandardMaterial({ color: 0xcdb48a, roughness: 0.9 });
  g.add(S.mk(new THREE.SphereGeometry(0.22, 10, 8).scale(1.8, 0.8, 0.9), brown, 0, 0, 0));
  g.add(S.mk(new THREE.SphereGeometry(0.13, 10, 8), light, 0.42, 0.06, 0));
  g.add(S.mk(new THREE.ConeGeometry(0.05, 0.12, 6).rotateZ(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf2b705 }), 0.56, 0.04, 0));
  const wing = (sd: number) => {
    const w = new THREE.Group();
    const shp = new THREE.Shape(); shp.moveTo(0, 0); shp.lineTo(0.3, 0.9 * sd); shp.lineTo(-0.2, 1.1 * sd); shp.lineTo(-0.35, 0.2 * sd); shp.lineTo(0, 0);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shp), brown);
    m.rotation.x = Math.PI / 2;
    w.add(m);
    g.add(w);
    return w;
  };
  g.userData.wings = [wing(1), wing(-1)];
  g.add(S.mk(new THREE.BoxGeometry(0.4, 0.03, 0.35), brown, -0.45, 0, 0));
  return g;
}

// ======================================================================
// 航線計算 (現場座標)：重疊率、覆蓋
// ======================================================================
export interface PlanStats { fwd: number; side: number | null; cover: number; length: number }

function legs(pts: { x: number; z: number }[]) {
  const out: { a: { x: number; z: number }; b: { x: number; z: number }; dir: number; len: number }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > 12) out.push({ a, b, dir: Math.atan2(b.z - a.z, b.x - a.x), len });
  }
  return out;
}

/** 側向重疊：每一條航段找最近的平行航段，用間距算 (取最差的) */
export function sideOverlap(pts: { x: number; z: number }[], alt = ALT): number | null {
  // 只看「主航線」(夠長的那幾條)；S 型兩端的轉彎短段不算
  const all = legs(pts);
  const maxLen = Math.max(0, ...all.map(l => l.len));
  const L = all.filter(l => l.len >= maxLen * 0.55);
  if (L.length < 2) return null;
  const W = FW * alt;
  let worst = 1, found = false;
  L.forEach((l, i) => {
    const mx = (l.a.x + l.b.x) / 2, mz = (l.a.z + l.b.z) / 2;
    let best = Infinity;
    L.forEach((m, j) => {
      if (i === j) return;
      let da = Math.abs(l.dir - m.dir) % Math.PI; if (da > Math.PI / 2) da = Math.PI - da;
      if (da > 0.35) return;
      const dx = m.b.x - m.a.x, dz = m.b.z - m.a.z, ll = dx * dx + dz * dz;
      const t = ((mx - m.a.x) * dx + (mz - m.a.z) * dz) / ll;
      if (t < 0 || t > 1) return;
      const d = Math.abs((mx - m.a.x) * dz - (mz - m.a.z) * dx) / Math.sqrt(ll);
      if (d > 1) best = Math.min(best, d);
    });
    if (best < Infinity) { found = true; worst = Math.min(worst, 1 - best / W); }
  });
  return found ? worst : null;
}

/** 在覆蓋網格上蓋一張照片 (dir = 飛行方向，現場座標) */
function stamp(grid: Uint8Array, x: number, z: number, dir: number, alt: number) {
  const W = FW * alt / 2, Lh = FL * alt / 2;
  const c = Math.cos(dir), s = Math.sin(dir);
  const r = Math.hypot(W, Lh);
  for (let gx = Math.max(0, Math.floor((x - r - GX0) / GS)); gx <= Math.min(GNX - 1, Math.ceil((x + r - GX0) / GS)); gx++) {
    for (let gz = Math.max(0, Math.floor((z - r - GZ0) / GS)); gz <= Math.min(GNZ - 1, Math.ceil((z + r - GZ0) / GS)); gz++) {
      const px = GX0 + (gx + 0.5) * GS - x, pz = GZ0 + (gz + 0.5) * GS - z;
      const along = px * c + pz * s, across = -px * s + pz * c;
      if (Math.abs(along) <= Lh && Math.abs(across) <= W) grid[gx * GNZ + gz] = Math.min(255, grid[gx * GNZ + gz] + 1);
    }
  }
}
function coverOf(grid: Uint8Array): number {
  let n = 0, k = 0;
  for (let x = AREA.x0 + 1; x < AREA.x1; x += GS) for (let z = AREA.z0 + 1; z < AREA.z1; z += GS) {
    n++;
    const gx = Math.floor((x - GX0) / GS), gz = Math.floor((z - GZ0) / GS);
    if (grid[gx * GNZ + gz] > 0) k++;
  }
  return k / n;
}
/** 用航線模擬拍照，算覆蓋 */
export function planStats(pts: { x: number; z: number }[], shot: number, alt = ALT): PlanStats & { grid: Uint8Array } {
  const grid = new Uint8Array(GNX * GNZ);
  let length = 0;
  let acc = shot;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z);
    const dir = Math.atan2(b.z - a.z, b.x - a.x);
    for (let d = 0; d < len; d += 0.5) {
      acc += 0.5;
      if (acc >= shot) { acc = 0; stamp(grid, a.x + (b.x - a.x) * d / len, a.z + (b.z - a.z) * d / len, dir, alt); }
    }
    length += len;
  }
  return { fwd: 1 - shot / (FL * alt), side: sideOverlap(pts, alt), cover: pts.length > 1 ? coverOf(grid) : 0, length, grid };
}

// ======================================================================
export class UavOps {
  stage: UavStage = 'none';
  private sm: AnyObj;
  home: { x: number; z: number; y: number } | null = null;
  private pad: THREE.Group | null = null;
  drone: THREE.Group | null = null;
  private props: THREE.Object3D[] = [];
  log: FlightLog = this.emptyLog();
  /** 航線 (現場座標) */
  plan: { x: number; z: number }[] = [];
  shot = 6;
  /** 實際拍到的覆蓋 */
  grid: Uint8Array = new Uint8Array(GNX * GNZ);
  private pos = V(); private vel = V();
  mode: 'takeoff' | 'mission' | 'rth' | 'land' | 'off' = 'off';
  private path: THREE.Vector3[] = [];
  pi = 0;
  private sinceShot = 0;
  private shotGaps: number[] = [];
  keys = { f: false, b: false, l: false, r: false, up: false, down: false };
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private hud: HTMLElement | null = null;
  private savedCtl: ((dt: number) => void) | null = null;
  drift = V();
  private driftT = 0;
  private eagle: THREE.Group | null = null;
  private eagleT = -1;
  eagleAt = -1;
  private qte = false;
  private warn = '';
  private camPos = V();
  t = 0;
  private hidden: THREE.Object3D[] = [];
  private villager: { g: THREE.Group; t: number; state: 'come' | 'talk' | 'back'; who: 'grandma' | 'keeper' } | null = null;
  private villagerAt = -1;
  /** 飛行中會來打擾的人 (依序) */
  private visits: ('grandma' | 'keeper')[] = [];
  paused = false;
  private heading = 0;
  private foot: THREE.LineLoop | null = null;
  private footFill: THREE.Mesh | null = null;
  private rays: THREE.LineSegments | null = null;
  private flash = 0;
  /** 地上的規劃航線 + 前幾張照片的範圍 (看得出重疊) */
  private routeLine: THREE.Line | null = null;
  private trail: THREE.LineLoop[] = [];
  private lastCorners: THREE.Vector3[] = [];
  private planEl: HTMLElement | null = null;

  constructor(private job: AnyObj) { this.sm = job.fd.app.sceneManager; }

  private emptyLog(): FlightLog { return { homeNearPole: false, compassOk: null, eagle: '', landDist: 0, landSpeed: 0, battery: 100, photos: 0, fwd: 0, side: 0, cover: 0, ortho: null }; }

  reset() {
    this.stopFlight(true);
    this.closePlanner();
    if (this.pad) this.sm.scene.remove(this.pad);
    if (this.drone) { this.sm.scene.remove(this.drone); this.job.ensureInteractive?.(this.drone, false); }
    if (this.villager) this.sm.scene.remove(this.villager.g);
    this.pad = this.drone = null; this.villager = null;
    this.home = null;
    this.stage = 'none';
    this.plan = []; this.shot = 6;
    this.grid = new Uint8Array(GNX * GNZ);
    this.log = this.emptyLog();
  }

  // ================================================================
  // 起降點
  // ================================================================
  setHome(x: number, z: number): string | null {
    if (canopyAt(x, z, 1.2)) return '頭上有樹枝，螺旋槳會打到。';
    const l = toLocal(x, z);
    if (l.z < 51.5) return '這裡是縣道，不能在路上起飛。';
    const sf = surfAt(x, z);
    if (CROP.includes(sf)) return '田裡有作物，起降點擺這裡會壓到菜、螺旋槳也會打到葉子。找水泥地或空地。';
    if (sf === 'canal') return '這是灌溉溝。';
    if (sf === 'house' || sf === 'temple' || sf === 'bamboo') return '這裡擺不下起降墊。';
    if (this.pad) this.sm.scene.remove(this.pad);
    if (this.drone) { this.sm.scene.remove(this.drone); this.job.ensureInteractive(this.drone, false); }
    const y = topAt(this.sm, x, z);
    const poles: { x: number; z: number }[] = [...(this.sm.poleColliders || [])];
    this.log.homeNearPole = poles.some(p => Math.hypot(p.x - x, p.z - z) < 5.5);
    this.home = { x, z, y };
    const S = SM();
    this.pad = new THREE.Group();
    const padTex = S.canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#f59e0b'; c.beginPath(); c.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#1f2937'; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 14, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.font = 'bold 150px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', w / 2, h / 2 + 8);
    });
    const pm = S.mk(new THREE.CircleGeometry(0.55, 32), new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 }), 0, 0.012, 0, true);
    pm.rotation.x = -Math.PI / 2;
    this.pad.add(pm);
    this.pad.position.set(x, y, z);
    this.sm.scene.add(this.pad);
    const { group, propellers } = S.buildDrone();
    const dr = group as THREE.Group;
    this.drone = dr;
    this.props = propellers;
    dr.position.set(x, y + 0.42, z);
    dr.userData = { type: 'uav_drone' };
    this.sm.scene.add(dr);
    this.job.ensureInteractive(dr, true);
    this.stage = 'ready';
    return null;
  }

  // ================================================================
  // 起飛前：平板畫航線
  // ================================================================
  preflight() {
    if (this.job.ev.raining) { sfx.error(); ui.toast('下雨不能飛，等雨停。', 'warn', 2600); return; }
    this.openPlanner();
  }

  private openPlanner() {
    if (this.planEl) return;
    if (document.exitPointerLock) document.exitPointerLock();
    const d = document.createElement('div');
    d.className = 'modal-backdrop show field-modal uav-plan';
    d.innerHTML = `<div class="up-pad">
      <div class="up-head"><b>航線規劃</b><span>航高 ${ALT} m　一張照片涵蓋 ${Math.round(FW * ALT)} × ${Math.round(FL * ALT)} m（左右 × 前後）</span></div>
      <div class="up-body">
        <canvas width="560" height="470"></canvas>
        <div class="up-side">
          <p class="up-tip">在地圖上點一下就是一個航點，照順序連成航線（從起降點 H 出發，飛完自動回來）。<b>按住航點可以拖拉調整</b>；對著航點按右鍵刪掉那一點，Backspace 刪最後一個。</p>
          <div class="up-example">
            <svg viewBox="0 0 150 92" aria-hidden="true">
              <rect x="22" y="12" width="106" height="68" fill="none" stroke="#e11d48" stroke-dasharray="4 3" stroke-width="1.5"/>
              <polyline points="10,20 140,20 140,38 10,38 10,56 140,56 140,74 10,74" fill="none" stroke="#facc15" stroke-width="2"/>
              ${[20, 38, 56, 74].map(y => [24, 42, 60, 78, 96, 114, 132].map(x => `<circle cx="${x}" cy="${y}" r="1.8" fill="#38bdf8"/>`).join('')).join('')}
              <line x1="146" y1="20" x2="146" y2="38" stroke="#4ade80" stroke-width="1.5"/><text x="147" y="31" fill="#4ade80" font-size="7" text-anchor="end" transform="translate(-2,0)">↕</text>
              <line x1="60" y1="84" x2="78" y2="84" stroke="#38bdf8" stroke-width="1.5"/>
            </svg>
            <div><b>範例：S 型航線</b>（來回平行掃過整個紅框，兩端多飛出去一點）<br>
              <span class="g">航線間距（綠）</span> → 決定<b>側向重疊</b>：間距越小越高<br>
              <span class="b">拍照間距（藍點）</span> → 決定<b>前後重疊</b>：間距越小越高</div>
          </div>
          <div class="up-need">需求：前後重疊 ≥ ${NEED_FWD * 100}%　側向重疊 ≥ ${NEED_SIDE * 100}%</div>
          <div class="up-stat"><span>前後重疊 <small>（只看拍照間距）</small></span><b class="s-fwd">—</b></div>
          <div class="up-shot">拍照間距 <button data-a="minus">−</button><b class="s-shot"></b><button data-a="plus">＋</button></div>
          <div class="up-stat"><span>側向重疊 <small>（只看航線間距）</small></span><b class="s-side">—</b></div>
          <div class="up-stat"><span>範圍覆蓋</span><b class="s-cover">—</b></div>
          <div class="up-stat"><span>航線長度</span><b class="s-len">—</b></div>
          <div class="up-btns">
            <button data-a="undo">復原</button>
            <button data-a="clear">清除</button>
            <button data-a="fly" class="up-fly">起飛 (Enter)</button>
            <button data-a="close">先不要 (Esc)</button>
          </div>
        </div>
      </div></div>`;
    document.body.appendChild(d);
    this.planEl = d;
    const cv = d.querySelector('canvas') as HTMLCanvasElement;
    let map: { px: (x: number) => number; py: (z: number) => number; sc: number } | null = null;
    let hover: { x: number; z: number } | null = null;
    const draw = () => {
      const c = cv.getContext('2d')!;
      map = drawSiteMap(c, cv.width, cv.height, { gcps: this.job.gcps.map((g: AnyObj) => ({ x: g.x, z: g.z, name: g.name })) });
      const m = map!;
      const st = planStats(this.plan, this.shot);
      c.fillStyle = 'rgba(56,189,248,.28)';
      for (let gx = 0; gx < GNX; gx++) for (let gz = 0; gz < GNZ; gz++) if (st.grid[gx * GNZ + gz]) {
        const x0 = GX0 + gx * GS, z0 = GZ0 + gz * GS;
        c.fillRect(m.px(x0 + GS), m.py(z0 + GS), GS * m.sc + 0.5, GS * m.sc + 0.5);
      }
      const h = this.home ? toLocal(this.home.x, this.home.z) : null;
      const pts = [...(h ? [h] : []), ...this.plan, ...(h && this.plan.length ? [h] : [])];
      c.strokeStyle = '#facc15'; c.lineWidth = 2.5; c.setLineDash([]);
      c.beginPath(); pts.forEach((p, i) => { const X = m.px(p.x), Y = m.py(p.z); if (i) c.lineTo(X, Y); else c.moveTo(X, Y); }); c.stroke();
      this.plan.forEach((p, i) => {
        const X = m.px(p.x), Y = m.py(p.z);
        c.fillStyle = '#facc15'; c.beginPath(); c.arc(X, Y, 8, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#111'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), X, Y + 0.5);
      });
      // 滑鼠位置預覽「一張照片」在地上的範圍 (方向 = 上一個航點過來的方向)
      if (hover) {
        const last = this.plan.length ? this.plan[this.plan.length - 1] : h;
        const dir = last && Math.hypot(hover.x - last.x, hover.z - last.z) > 0.5 ? Math.atan2(hover.z - last.z, hover.x - last.x) : 0;
        const Lh = FL * ALT / 2, Wh = FW * ALT / 2, cc = Math.cos(dir), ss = Math.sin(dir);
        const q = [[Lh, Wh], [Lh, -Wh], [-Lh, -Wh], [-Lh, Wh]].map(([a, b]) => ({ X: m.px(hover!.x + a * cc - b * ss), Y: m.py(hover!.z + a * ss + b * cc) }));
        c.setLineDash([5, 4]); c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 1.5; c.fillStyle = 'rgba(255,255,255,.12)';
        c.beginPath(); q.forEach((o, i) => i ? c.lineTo(o.X, o.Y) : c.moveTo(o.X, o.Y)); c.closePath(); c.fill(); c.stroke(); c.setLineDash([]);
        c.fillStyle = '#fff'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
        c.fillText(`一張照片 ${Math.round(FW * ALT)}×${Math.round(FL * ALT)} m`, m.px(hover.x), Math.min(...q.map(o => o.Y)) - 3);
      }
      if (h) { c.fillStyle = '#f59e0b'; c.strokeStyle = '#111'; c.lineWidth = 1.5; c.beginPath(); c.arc(m.px(h.x), m.py(h.z), 9, 0, Math.PI * 2); c.fill(); c.stroke(); c.fillStyle = '#111'; c.font = 'bold 11px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('H', m.px(h.x), m.py(h.z) + 0.5); }
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const set = (cls: string, txt: string, ok: boolean | null) => { const e = d.querySelector(cls) as HTMLElement; e.textContent = txt; e.className = `${cls.slice(1)} ${ok === null ? '' : ok ? 'ok' : 'bad'}`; };
      set('.s-fwd', pct(st.fwd), st.fwd >= NEED_FWD - 1e-6);
      set('.s-side', st.side === null ? '—（要有兩條以上平行航線）' : pct(Math.max(0, st.side)), st.side === null ? null : st.side >= NEED_SIDE - 1e-6);
      set('.s-cover', this.plan.length > 1 ? pct(st.cover) : '—', this.plan.length > 1 ? st.cover > 0.995 : null);
      set('.s-len', `${Math.round(st.length)} m`, null);
      (d.querySelector('.s-shot') as HTMLElement).textContent = `${this.shot.toFixed(1)} m`;
    };
    const toLocalPt = (ev: MouseEvent) => {
      const r = cv.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * cv.width / r.width, sy = (ev.clientY - r.top) * cv.height / r.height;
      const m = map!;
      return { x: (m.px(0) - sx) / m.sc, z: (m.py(0) - sy) / m.sc };
    };
    /** 滑鼠附近的航點 (畫布像素 12 以內) */
    const pick = (ev: MouseEvent): number => {
      const r = cv.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * cv.width / r.width, sy = (ev.clientY - r.top) * cv.height / r.height;
      const m = map!;
      let best = -1, bd = 12;
      this.plan.forEach((p, i) => { const d = Math.hypot(m.px(p.x) - sx, m.py(p.z) - sy); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    let drag = -1;
    cv.onmousedown = (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const i = pick(ev);
      if (i >= 0) { drag = i; cv.style.cursor = 'grabbing'; return; }
      // 空白處：新增一個航點 (按住不放可以直接拖到想要的位置)
      this.plan.push(toLocalPt(ev)); drag = this.plan.length - 1; sfx.pickup(); draw();
    };
    cv.onmousemove = (ev) => {
      if (drag >= 0 && this.plan[drag]) { this.plan[drag] = toLocalPt(ev); hover = null; draw(); return; }
      cv.style.cursor = pick(ev) >= 0 ? 'grab' : 'crosshair';
      hover = toLocalPt(ev); draw();
    };
    const endDrag = () => { if (drag >= 0) { drag = -1; cv.style.cursor = 'crosshair'; draw(); } };
    cv.onmouseup = endDrag;
    cv.onmouseleave = () => { endDrag(); hover = null; draw(); };
    cv.oncontextmenu = (ev) => { ev.preventDefault(); const i = pick(ev); if (i >= 0) this.plan.splice(i, 1); else this.plan.pop(); draw(); };
    const act = (a: string) => {
      if (a === 'undo') this.plan.pop();
      if (a === 'clear') this.plan = [];
      if (a === 'minus') this.shot = Math.max(1, this.shot - 0.5);
      if (a === 'plus') this.shot = Math.min(16, this.shot + 0.5);
      if (a === 'close') { window.removeEventListener('keydown', onKey, true); this.closePlanner(); this.job.relock(); return; }
      if (a === 'fly') {
        if (this.plan.length < 2) { sfx.error(); ui.toast('至少要點兩個航點。', 'warn', 2000); return; }
        window.removeEventListener('keydown', onKey, true);
        this.closePlanner();
        this.startFlight();
        return;
      }
      draw();
    };
    d.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach(b => b.onclick = () => act(b.dataset.a!));
    const onKey = (e: KeyboardEvent) => {
      if (!this.planEl) { window.removeEventListener('keydown', onKey, true); return; }
      e.stopPropagation();
      if (e.key === 'Backspace') { e.preventDefault(); act('undo'); }
      else if (e.key === 'Enter') act('fly');
      else if (e.key === 'Escape') act('close');
      else if (e.key === '+' || e.key === '=') act('plus');
      else if (e.key === '-') act('minus');
    };
    window.addEventListener('keydown', onKey, true);
    draw();
  }
  private closePlanner() { this.planEl?.remove(); this.planEl = null; }

  // ================================================================
  // 飛行
  // ================================================================
  private startFlight() {
    const p = this.job.fd.app.player;
    if (!this.home || !this.drone) return;
    if (document.exitPointerLock) document.exitPointerLock();
    this.stage = 'flying';
    this.mode = 'takeoff';
    this.t = 0;
    this.pos.set(this.home.x, this.home.y + 0.42, this.home.z);
    this.vel.set(0, 0, 0);
    this.log.battery = 100; this.log.photos = 0; this.log.compassOk = null; this.log.eagle = '';
    this.grid = new Uint8Array(GNX * GNZ);
    this.shotGaps = []; this.sinceShot = 0;
    this.drift.set(0, 0, 0); this.driftT = 0;
    this.eagleAt = -1; this.eagleT = -1; this.villagerAt = -1; this.paused = false;
    this.path = this.plan.map(q => { const w = toWorld(q.x, q.z); return V(w.x, 0, w.z); });
    this.savedCtl = p.externalControl;
    p.externalControl = (dt: number) => this.tick(dt);
    document.body.classList.add('bench-active', 'uav-flying');
    const cam = this.sm.camera as THREE.PerspectiveCamera;
    this.hidden = cam.children.filter(c => c.visible); this.hidden.forEach(c => { c.visible = false; });
    this.camPos.copy(cam.position);
    ui.forceFieldbook(true);
    this.hud = document.createElement('div');
    this.hud.className = 'uav-hud';
    document.body.appendChild(this.hud);
    this.buildFootprint();
    this.buildRouteLine();
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    sfx.pickup();
    ui.toast(`按住 Space 起飛，升到 ${ALT} m 後會照航線自動飛。`, 'info', 3500);
  }

  private buildFootprint() {
    const sc = this.sm.scene;
    this.foot = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(), V(), V(), V()]), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.95, depthTest: false }));
    this.rays = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 8 }, () => V())), new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.5, depthTest: false }));
    this.footFill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.12, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    [this.foot, this.rays, this.footFill].forEach(o => { o.renderOrder = 20; o.frustumCulled = false; o.visible = false; sc.add(o); });
  }
  private updateFootprint(agl: number) {
    if (!this.foot || !this.rays || !this.footFill) return;
    const show = agl > 3;
    [this.foot, this.rays, this.footFill].forEach(o => { o.visible = show; });
    if (!show) return;
    const W = FW * agl / 2, L = FL * agl / 2;
    const c = Math.cos(this.heading), s = Math.sin(this.heading);
    const gy = topAt(this.sm, this.pos.x, this.pos.z) + 0.15;
    const corner = (a: number, b: number) => V(this.pos.x + a * c - b * s, gy, this.pos.z + a * s + b * c);
    const cs = [corner(L, W), corner(L, -W), corner(-L, -W), corner(-L, W)];
    this.lastCorners = cs;
    (this.foot.geometry as THREE.BufferGeometry).setFromPoints(cs);
    const segs: THREE.Vector3[] = [];
    cs.forEach(q => segs.push(this.pos.clone().add(V(0, -0.15, 0)), q));
    (this.rays.geometry as THREE.BufferGeometry).setFromPoints(segs);
    this.footFill.position.set(this.pos.x, gy, this.pos.z);
    this.footFill.scale.set(2 * L, 2 * W, 1);
    this.footFill.rotation.set(-Math.PI / 2, 0, -this.heading);
    this.flash = Math.max(0, this.flash - 0.08);
    (this.footFill.material as THREE.MeshBasicMaterial).opacity = 0.12 + this.flash * 0.35;
  }
  private removeFootprint() {
    [this.foot, this.rays, this.footFill, this.routeLine, ...this.trail].forEach(o => { if (o) this.sm.scene.remove(o); });
    this.foot = this.rays = null; this.footFill = null; this.routeLine = null; this.trail = [];
  }
  /** 把規劃的航線畫在地上 (黃線)，跟平板上畫的一樣 */
  private buildRouteLine() {
    if (!this.home) return;
    const pts = [V(this.home.x, 0, this.home.z), ...this.path, V(this.home.x, 0, this.home.z)];
    const out: THREE.Vector3[] = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / 2));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n;
        out.push(V(x, topAt(this.sm, x, z) + 0.2, z));
      }
    }
    this.routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(out), new THREE.LineDashedMaterial({ color: 0xfacc15, dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.9, depthTest: false }));
    this.routeLine.computeLineDistances();
    this.routeLine.renderOrder = 19; this.routeLine.frustumCulled = false;
    this.sm.scene.add(this.routeLine);
  }
  /** 拍一張：把這張照片的範圍留在地上一下子，慢慢淡掉 */
  private stampTrail() {
    if (this.lastCorners.length !== 4) return;
    const lp = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(this.lastCorners.map(c => c.clone())), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
    lp.renderOrder = 19; lp.frustumCulled = false;
    this.sm.scene.add(lp);
    this.trail.push(lp);
    while (this.trail.length > 5) { const o = this.trail.shift()!; this.sm.scene.remove(o); o.geometry.dispose(); }
    this.trail.forEach((o, i, a) => { (o.material as THREE.LineBasicMaterial).opacity = 0.15 + 0.55 * (i + 1) / a.length; });
  }

  private key(e: KeyboardEvent) {
    if (qteActive()) return;
    const down = e.type === 'keydown';
    const m: Record<string, keyof UavOps['keys']> = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', Space: 'up', ShiftLeft: 'down', ShiftRight: 'down' };
    if (document.querySelector('.field-modal')) return;
    if (m[e.code]) { this.keys[m[e.code]] = down; e.preventDefault(); e.stopPropagation(); return; }
    if (['KeyE', 'KeyQ', 'KeyC', 'KeyG', 'KeyF', 'KeyJ', 'KeyR'].includes(e.code)) e.stopPropagation();
  }

  tick(dt: number) {
    if (this.paused) { this.drawHud(this.pos.y - this.home!.y); return; } // 被叫住時懸停
    if (this.qte) { this.qteTick(dt); return; } // 閃鳥：只做閃避動作
    this.t += dt;
    const cam = this.sm.camera as THREE.PerspectiveCamera;
    const home = this.home!;
    const k = this.keys;
    const fwd = V(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = V(-fwd.z, 0, fwd.x);
    const stick = V().addScaledVector(fwd, (k.f ? 1 : 0) - (k.b ? 1 : 0)).addScaledVector(right, (k.r ? 1 : 0) - (k.l ? 1 : 0));
    const want = V();
    this.warn = '';
    const agl0 = this.pos.y - home.y;
    if (this.mode === 'takeoff') {
      want.copy(stick).multiplyScalar(3);
      want.y = k.up ? 6 : k.down ? -3 : 0;
      if (this.log.homeNearPole && agl0 > 1.5) {
        if (this.driftT === 0) { const a = Math.random() * Math.PI * 2; this.drift.set(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4); sfx.error(); }
        this.driftT += dt;
        this.warn = '⚠ 指南針異常（ATTI 模式）：自己用 WASD 把飛機穩住';
        want.add(this.drift);
        const off = Math.hypot(this.pos.x - home.x, this.pos.z - home.z);
        if (off > 9 && this.log.compassOk === null) { this.log.compassOk = false; ui.toast('……差點撞到電線！', 'bad', 3000); }
        if (agl0 > 15) { if (this.log.compassOk === null) this.log.compassOk = true; this.drift.set(0, 0, 0); }
      }
      if (agl0 > ALT - 1) {
        this.mode = 'mission'; this.pi = 0;
        const ev = this.job.ev;
        this.eagleAt = ev.has('eagle') ? this.t + 5 + Math.random() * 8 : -1;
        this.visits = [];
        if (ev.keeperAnnoyed) this.visits.push('keeper');
        if (ev.has('grandma')) this.visits.push('grandma');
        this.villagerAt = this.visits.length ? Math.max(this.eagleAt, this.t + 4) + 12 + Math.random() * 8 : -1;
        ui.toast('開始自動航線。', 'info', 1800);
      }
    } else if (this.mode === 'mission') {
      const tgt = this.path[this.pi];
      const ty = topAt(this.sm, tgt.x, tgt.z) + ALT;
      const d = V(tgt.x - this.pos.x, ty - this.pos.y, tgt.z - this.pos.z);
      const dist = Math.hypot(d.x, d.z);
      want.set(d.x, 0, d.z).normalize().multiplyScalar(Math.min(SPEED, dist * 2)); want.y = d.y * 2;
      if (dist < 1.5) {
        this.pi++;
        if (this.pi >= this.path.length) { this.mode = 'rth'; ui.toast('航線飛完，返航中。', 'info', 2000); }
      }
      this.sinceShot += Math.hypot(this.vel.x, this.vel.z) * dt;
      if (this.sinceShot >= this.shot) {
        this.shotGaps.push(this.shot);
        this.sinceShot -= this.shot;
        this.log.photos++;
        this.flash = 1;
        this.stampTrail();
        const blur = this.log.eagle === 'hit' && this.eagleT >= 0 && this.eagleT < 6;
        if (!blur) {
          const l = toLocal(this.pos.x, this.pos.z);
          // 世界方向 → 現場座標方向 (轉 180°)
          stamp(this.grid, l.x, l.z, this.heading + Math.PI, agl0);
          this.seeGcps(this.heading, agl0);
        }
      }
      if (this.eagleAt > 0 && this.t > this.eagleAt && !this.eagle && this.log.eagle === '') this.spawnEagle();
      if (this.villagerAt > 0 && this.t > this.villagerAt && !this.villager && !this.eagle && !document.querySelector('.dialog')) {
        const who = this.visits.shift();
        this.villagerAt = this.visits.length ? this.t + 16 + Math.random() * 6 : -1;
        if (who) this.spawnVillager(who);
      }
    } else if (this.mode === 'rth') {
      const d = V(home.x - this.pos.x, home.y + 12 - this.pos.y, home.z - this.pos.z);
      const dist = Math.hypot(d.x, d.z);
      want.set(d.x, 0, d.z).normalize().multiplyScalar(Math.min(SPEED, dist * 1.5)); want.y = THREE.MathUtils.clamp(d.y * 1.5, -6, 6);
      if (dist < 1.2 && Math.abs(d.y) < 1) { this.mode = 'land'; ui.toast('到起降點上空了。WASD 對準、按住 Shift 下降。', 'info', 3500); }
    } else if (this.mode === 'land') {
      want.copy(stick).multiplyScalar(2);
      want.y = k.down ? -3 : k.up ? 2 : 0;
      const w = this.job.wind;
      want.x += w.x * 0.15 * Math.sin(this.t * 0.8); want.z += w.z * 0.15 * Math.sin(this.t * 0.8);
    }
    this.vel.lerp(want, Math.min(1, dt * 3));
    this.pos.addScaledVector(this.vel, dt);
    if (Math.hypot(this.vel.x, this.vel.z) > 1) this.heading = Math.atan2(this.vel.z, this.vel.x);
    const ground = topAt(this.sm, this.pos.x, this.pos.z) + 0.42;
    if (this.pos.y < ground) {
      if (this.mode === 'land' || (this.mode === 'takeoff' && this.t > 2)) { this.touchdown(); return; }
      this.pos.y = ground; this.vel.y = Math.max(0, this.vel.y);
    }
    const dr = this.drone!;
    dr.position.copy(this.pos);
    dr.rotation.set(this.vel.z * 0.03, -this.heading, -this.vel.x * 0.03);
    this.props.forEach((p, i) => { p.rotation.y += (i % 2 ? 1 : -1) * dt * 60; });
    this.eagleTick(dt);
    this.villagerTick(dt);
    const agl = this.pos.y - home.y;
    this.updateFootprint(agl);
    const back = this.mode === 'mission' || this.mode === 'rth' ? V(-Math.cos(this.heading), 0, -Math.sin(this.heading)) : V(home.x - this.job.fd.app.player.position.x, 0, home.z - this.job.fd.app.player.position.z).normalize().multiplyScalar(-1);
    if (!isFinite(back.x) || back.lengthSq() < 0.1) back.set(0, 0, 1);
    const dist = agl > 12 ? 16 : 5 + agl * 0.5;
    const want2 = this.pos.clone().addScaledVector(back, dist).add(V(0, agl > 12 ? 12 : 2.5 + agl * 0.4, 0));
    this.camPos.lerp(want2, Math.min(1, dt * 2.5));
    cam.position.copy(this.camPos);
    cam.lookAt(this.pos.x, this.pos.y - (agl > 12 ? 14 : 0.3), this.pos.z);
    cam.updateMatrixWorld();
    this.drawHud(agl);
  }

  // ---------------------------------------------------------------- 大冠鷲 (只來一次，QTE)
  private dodge: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; roll: number } | null = null;
  /** QTE 每過一關：飛機真的閃一下 */
  private dodgeStep(i: number) {
    const side = V(-Math.sin(this.heading), 0, Math.cos(this.heading)); // 飛行方向的右手邊
    const off = i === 0 ? V(0, 4, 0) : i === 1 ? side.multiplyScalar(Math.random() < 0.5 ? 5 : -5) : V(0, -1.5, 0);
    this.dodge = { from: this.pos.clone(), to: this.pos.clone().add(off), t: 0, dur: 0.35, roll: i === 1 ? Math.sign(off.dot(side) || 1) : 0 };
    sfx.pickup();
  }
  private qteTick(dt: number) {
    const home = this.home!;
    if (this.dodge) {
      const d = this.dodge;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur), e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(d.from, d.to, e);
      this.drone!.rotation.set(0, -this.heading, -d.roll * Math.sin(k * Math.PI) * 0.6);
      if (k >= 1) this.dodge = null;
    }
    this.drone!.position.copy(this.pos);
    this.props.forEach((p, i) => { p.rotation.y += (i % 2 ? 1 : -1) * dt * 60; });
    this.eagleTick(dt * 0.5);
    const agl = this.pos.y - home.y;
    this.updateFootprint(agl);
    const cam = this.sm.camera as THREE.PerspectiveCamera;
    const back = V(-Math.cos(this.heading), 0, -Math.sin(this.heading));
    const want2 = this.pos.clone().addScaledVector(back, 16).add(V(0, 12, 0));
    this.camPos.lerp(want2, Math.min(1, dt * 4));
    cam.position.copy(this.camPos);
    cam.lookAt(this.pos.x, this.pos.y - 14, this.pos.z);
    this.drawHud(agl);
  }
  private spawnEagle() {
    this.eagle = buildEagle();
    this.eagle.scale.setScalar(1.4);
    this.sm.scene.add(this.eagle);
    this.eagleT = 0;
    if (this.job.ev.keeperFriend) { ui.toast('廟公在二樓大喊：「少年仔！有老鷹！老鷹往你的飛機過去了！」', 'warn', 3000); tell('早上客氣對待廟公', '大冠鷲來之前，廟公在二樓先大喊，閃得比較從容'); }
    else ui.toast('「啾——」（大冠鷲在附近盤旋）', 'warn', 2200);
  }
  private eagleTick(dt: number) {
    const e = this.eagle;
    if (!e) return;
    this.eagleT += dt;
    const t = this.eagleT;
    const gone = this.log.eagle !== '';
    let x: number, y: number, z: number;
    if (gone) {
      const k = Math.max(0, t - 3);
      x = this.pos.x + 6 + k * 10; z = this.pos.z + 4 + k * 6; y = this.pos.y + 3 + k * 4;
    } else {
      const ang = t * 1.4, r = Math.max(4, 22 - t * 6);
      x = this.pos.x + Math.cos(ang) * r; y = this.pos.y + 3; z = this.pos.z + Math.sin(ang) * r;
    }
    const prev = e.position.clone();
    e.position.set(x, y, z);
    const dx = x - prev.x, dz = z - prev.z;
    if (Math.hypot(dx, dz) > 1e-3) e.rotation.y = Math.atan2(-dz, dx);
    (e.userData.wings as THREE.Object3D[]).forEach((w, i) => { w.rotation.x = Math.sin(t * 9) * 0.4 * (i ? -1 : 1); });
    const warned = this.job.ev.keeperFriend;
    if (t > (warned ? 1.6 : 3) && !gone && !this.qte) {
      this.qte = true;
      sfx.error();
      runQTE({
        speaker: '⚠ 大冠鷲衝過來了！',
        lines: ['往上拉！', '往旁邊閃！', '穩住！'],
        hint: warned ? '廟公先喊了，比較有時間反應——按出畫面上的鍵閃開！' : '按出畫面上的鍵閃開大冠鷲！',
        slow: warned ? 1.6 : 1,
        onStep: (i) => this.dodgeStep(i),
        onDone: (ok) => {
          this.qte = false;
          this.eagleT = 3;
          if (ok) { this.log.eagle = 'dodged'; ui.toast('閃過去了！大冠鷲飛走了。', 'good', 2200); }
          else {
            this.log.eagle = 'hit';
            sfx.thud();
            ui.toast('砰！被大冠鷲撞了一下……接下來幾張照片糊了。', 'bad', 3200);
            this.vel.add(V((Math.random() - 0.5) * 8, -3, (Math.random() - 0.5) * 8));
          }
        },
      });
    }
    if (gone && t > 9) { this.sm.scene.remove(e); this.eagle = null; }
  }

  private touchdown() {
    const home = this.home!;
    this.log.landDist = Math.hypot(this.pos.x - home.x, this.pos.z - home.z);
    this.log.landSpeed = Math.abs(this.vel.y);
    this.pos.y = topAt(this.sm, this.pos.x, this.pos.z) + 0.42;
    this.drone!.position.copy(this.pos);
    this.drone!.rotation.set(0, -this.heading, 0);
    if (this.mode === 'takeoff') {
      ui.toast('落地了。', 'info', 1800);
      this.stopFlight();
      this.stage = 'ready';
      return;
    }
    const hard = this.log.landSpeed > 2.2;
    ui.toast(hard ? '咚！降落有點重……' : this.log.landDist < 0.6 ? '漂亮，穩穩停在起降墊上。' : `降落了（偏離起降墊 ${this.log.landDist.toFixed(1)} m）。`, hard ? 'warn' : 'good', 3000);
    this.finishStats();
    this.stopFlight();
    this.stage = 'done';
    this.job.onFlightDone();
  }

  private finishStats() {
    const gaps = this.shotGaps.length ? this.shotGaps.reduce((a, b) => a + b, 0) / this.shotGaps.length : this.shot;
    this.log.fwd = 1 - gaps / (FL * ALT);
    this.log.side = sideOverlap(this.plan) ?? 0;
    this.log.cover = coverOf(this.grid);
  }

  private stopFlight(silent = false) {
    if (this.onKey) { window.removeEventListener('keydown', this.onKey, true); window.removeEventListener('keyup', this.onKey, true); }
    this.onKey = null;
    this.hud?.remove(); this.hud = null;
    this.removeFootprint();
    if (this.eagle) { this.sm.scene.remove(this.eagle); this.eagle = null; }
    if (this.mode === 'off' && silent) return;
    this.mode = 'off';
    const p = this.job.fd.app.player;
    document.body.classList.remove('bench-active', 'uav-flying');
    this.hidden.forEach(c => { c.visible = true; }); this.hidden = [];
    p.externalControl = this.savedCtl;
    this.savedCtl = null;
    const cam = this.sm.camera;
    cam.position.copy(p.position); cam.quaternion.setFromEuler(p.euler);
    ui.forceFieldbook(false);
    this.keys = { f: false, b: false, l: false, r: false, up: false, down: false };
    if (!silent) this.job.relock();
  }

  private drawHud(agl: number) {
    if (!this.hud) return;
    const modeName: Record<string, string> = { takeoff: '手動起飛', mission: '自動航線', rth: '返航', land: '手動降落', off: '' };
    const keys = this.mode === 'takeoff' ? 'Space 上升　WASD 平移' : this.mode === 'land' ? 'WASD 對準　Shift 下降　Space 上升' : this.mode === 'mission' ? `航點 ${Math.min(this.pi + 1, this.path.length)} / ${this.path.length}` : '返航中';
    const home = this.home!;
    const off = Math.hypot(this.pos.x - home.x, this.pos.z - home.z);
    this.hud.innerHTML = `
      <div class="uh-top"><b>${modeName[this.mode]}</b><span>高度 ${agl.toFixed(1)} m</span><span>照片 ${this.log.photos}</span><span>覆蓋 ${Math.round(coverOf(this.grid) * 100)}%</span>${this.mode === 'land' ? `<span>離起降墊 ${off.toFixed(1)} m</span>` : ''}</div>
      ${this.warn ? `<div class="uh-warn">${this.warn}</div>` : ''}
      <div class="uh-keys">${keys}</div>`;
  }

  /** 某個世界座標點有沒有被照片拍到 */
  /** 拍照那一瞬間：照片範圍裡的標有沒有被車、人擋住 */
  private seeGcps(heading: number, agl: number) {
    const W = FW * agl / 2, L = FL * agl / 2, c = Math.cos(heading), s = Math.sin(heading);
    for (const g of this.job.gcps as AnyObj[]) {
      const dx = g.x - this.pos.x, dz = g.z - this.pos.z;
      if (Math.abs(dx * c + dz * s) > L || Math.abs(-dx * s + dz * c) > W) continue;
      const why = this.job.ev.hideReason(g);
      if (why) g.hiddenWhy = why; else g.seenClear = true;
    }
  }
  covered(x: number, z: number): boolean {
    const l = toLocal(x, z);
    const gx = Math.floor((l.x - GX0) / GS), gz = Math.floor((l.z - GZ0) / GS);
    if (gx < 0 || gz < 0 || gx >= GNX || gz >= GNZ) return false;
    return this.grid[gx * GNZ + gz] > 0;
  }

  // ================================================================
  // 降落後：村民
  // ================================================================
  /** 飛到一半，阿嬤從後面走過來 */
  private spawnVillager(who: 'grandma' | 'keeper' = 'grandma') {
    const g = who === 'keeper' ? buildPerson({ shirt: 0xdddddd, pants: 0x37474f, hat: null, skin: 0xc68a5e }) : buildPerson({ shirt: 0xc2185b, pants: 0x37474f, hat: null, skin: 0xd1a07a });
    const p = this.job.fd.app.player.position;
    const w = who === 'keeper' ? toWorld(29, 106.4) : toWorld(-24, 106);
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    // 從農舍那邊走過來 (太遠的話從 20 m 外開始走)
    const k = d > 20 ? 20 / d : 1;
    const sx = p.x + (w.x - p.x) * k, sz = p.z + (w.z - p.z) * k;
    g.position.set(sx, topAt(this.sm, sx, sz), sz);
    this.sm.scene.add(g);
    this.villager = { g, t: 0, state: 'come', who };
  }

  private villagerTick(dt: number) {
    const v = this.villager;
    if (!v || v.state !== 'come') return;
    const g = v.g, p = this.job.fd.app.player.position;
    v.t += dt;
    const dx = p.x - g.position.x, dz = p.z - g.position.z, d = Math.hypot(dx, dz);
    if (d > 1.8) {
      g.position.x += dx / d * 1.6 * dt; g.position.z += dz / d * 1.6 * dt;
      g.position.y = topAt(this.sm, g.position.x, g.position.z);
      g.rotation.y = Math.atan2(-dz, dx);
      animateWalk(g, v.t, 1);
      return;
    }
    animateWalk(g, v.t, 0);
    v.state = 'talk';
    this.paused = true;
    this.keys = { f: false, b: false, l: false, r: false, up: false, down: false };
    sfx.error();
    ui.toast('（有人在背後拍你的肩膀——飛機先懸停）', 'warn', 2500);
    if (v.who === 'keeper') { setTimeout(() => this.keeperVisit(v), 600); return; }
    setTimeout(() => {
      ui.showDialog('阿嬤', '「少年仔，你那台飛來飛去的，是在拍我家喔？」', [
        { id: 'show', text: '「阿嬤，這是在測量土地，拍的是地面。你看，畫面在這裡。」（拿遙控器螢幕給她看）', reply: '「喔～拍得真清楚捏！那我家屋頂破那個洞你也看得到喔？哈哈哈。好啦你忙。」', score: 2, tag: '阿嬤問是不是在拍她家，拿畫面給她看' },
        { id: 'no', text: '「沒有啦，沒有拍你家。」', reply: '「……真的喔？」（阿嬤半信半疑地走回去）', score: 0, tag: '阿嬤問是不是在拍她家，說沒有' },
        { id: 'ignore', text: '（盯著遙控器，假裝沒聽到）', reply: '「現在的少年仔喔……」（阿嬤一邊念一邊走回去，說要打給里長）', score: -2, tag: '阿嬤問是不是在拍她家，不理她' },
      ], (o) => {
        this.job.fd.addPR(o.score, o.tag);
        if (o.id === 'ignore') { this.job.ev.chief.push('阿嬤問飛機是不是在拍她家，你們都不理人'); tell('阿嬤問是不是在拍她家，你不理她', '阿嬤回去打電話給里長'); whatIf('拿遙控器畫面給阿嬤看，她就笑著回去了。'); }
        if (o.id === 'show') tell('阿嬤問是不是在拍她家，拿畫面給她看', '阿嬤笑著說「拍得真清楚」就回去了');
        this.paused = false;
        this.walkBack(v, toWorld(-24, 106));
      });
    }, 600);
  }

  /** 廟公 (被敷衍過)：飛到一半叫你去移車 */
  private keeperVisit(v: NonNullable<UavOps['villager']>) {
    const ev = this.job.ev;
    const resume = (sec: number) => {
      ui.toast('（飛機懸停。你把遙控器交給學弟盯著，跑去把車挪到旁邊……）', 'info', sec * 1000);
      this.log.seam = true;
      this.walkBack(v, toWorld(29, 106.4));
      setTimeout(() => { this.paused = false; ui.toast('車移好了，回來續飛。（航線中斷過，續飛的地方會有接縫）', 'warn', 3500); }, sec * 1000);
    };
    ui.showDialog('廟公', '「少年仔！你們那台工程車停在那邊擋到香客了，現在就移一下！」', [
      { id: 'ok', text: '「歹勢歹勢，我馬上去移。」', reply: '「麻煩喔。」', score: 0, tag: '廟公飛到一半叫我們移車，馬上去移' },
      { id: 'later', text: '「很快就好了啦，等我飛完。」', reply: '「現在就要移！香客都在等！」（廟公很生氣）', score: -2, tag: '廟公飛到一半叫我們移車，還叫他等' },
    ], (o) => {
      this.job.fd.addPR(o.score, o.tag);
      ev.rel.keeper = o.id === 'ok' ? '' : 'bad';
      tell(ev.fromDays || ev.prev.keeper !== 'bad' ? '早上敷衍廟公' : '上次得罪廟公', '飛到一半他跑來叫你移車，航線中斷，正射影像多一條接縫');
      whatIf('如果早上客氣謝謝廟公，他會在二樓幫你看老鷹，不會來叫你移車。');
      resume(o.id === 'ok' ? 4 : 6);
    });
  }

  private walkBack(v: NonNullable<UavOps['villager']>, back: { x: number; z: number }) {
    const g = v.g;
    v.state = 'back';
    if (this.villager === v) this.villager = null; // 下一個人可以來了
    {
        const ret = () => {
          if (!g.parent) return;
          const dx = back.x - g.position.x, dz = back.z - g.position.z, d = Math.hypot(dx, dz);
          if (d < 0.5) { this.sm.scene.remove(g); return; }
          v.t += 0.05; g.position.x += dx / d * 0.1; g.position.z += dz / d * 0.1; g.position.y = topAt(this.sm, g.position.x, g.position.z);
          g.rotation.y = Math.atan2(-dz, dx); animateWalk(g, v.t, 1);
          setTimeout(ret, 50);
        };
        ret();
    }
  }

  // ================================================================
  // 正射影像 (真的從上面拍一張；沒拍到的地方塗黑)
  // ================================================================
  renderOrtho(fx: { warp: number; broken: boolean } = { warp: 0, broken: false }): string {
    const sm = this.sm;
    const r = sm.renderer as THREE.WebGLRenderer;
    const W = 720, H = 560;
    const c0 = toWorld(AREA.x1 + 6, AREA.z1 + 6), c1 = toWorld(AREA.x0 - 6, AREA.z0 - 6);
    const x0 = Math.min(c0.x, c1.x), x1 = Math.max(c0.x, c1.x), z0 = Math.min(c0.z, c1.z), z1 = Math.max(c0.z, c1.z);
    const scale = Math.max((x1 - x0) / W, (z1 - z0) / H);
    const cam = new THREE.OrthographicCamera(-W * scale / 2, W * scale / 2, H * scale / 2, -H * scale / 2, 1, 300);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    cam.position.set(cx, 150, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    const rt = new THREE.WebGLRenderTarget(W, H, { colorSpace: THREE.SRGBColorSpace } as AnyObj);
    const fog = sm.scene.fog; sm.scene.fog = null;
    const hideList = [this.drone, this.job.asst?.g].filter(Boolean) as THREE.Object3D[];
    hideList.forEach(o => { o.userData._v = o.visible; o.visible = false; });
    r.setRenderTarget(rt);
    r.render(sm.scene, cam);
    r.setRenderTarget(null);
    sm.scene.fog = fog;
    hideList.forEach(o => { o.visible = o.userData._v; });
    const buf = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    rt.dispose();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    const ox = cx - W * scale / 2, oz = cz - H * scale / 2;
    for (let py = 0; py < H; py += 2) for (let px = 0; px < W; px += 2) {
      if (this.covered(ox + (px + 1) * scale, oz + (py + 1) * scale)) continue;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = ((py + dy) * W + px + dx) * 4; img.data[i] = 20; img.data[i + 1] = 24; img.data[i + 2] = 32; }
    }
    ctx.putImageData(img, 0, 0);
    // 控制點不夠：整張歪七扭八 (用條狀錯位模擬)
    if (fx.warp > 0.5) {
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      const t = tmp.getContext('2d')!;
      const A = fx.warp;
      t.drawImage(cv, 0, 0);
      ctx.fillStyle = '#141820'; ctx.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 4) ctx.drawImage(tmp, 0, y, W, 4, A * Math.sin(y * 0.013 + 1.3) + A * 0.5 * Math.sin(y * 0.041), y, W, 4);
      t.clearRect(0, 0, W, H); t.drawImage(cv, 0, 0);
      ctx.fillStyle = '#141820'; ctx.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 4) ctx.drawImage(tmp, x, 0, 4, H, x, A * Math.sin(x * 0.011 + 0.4) + A * 0.6 * Math.sin(x * 0.033 + 2), 4, H);
    }
    // 航線中斷再續飛：中間一條接縫錯開
    if (this.log.seam) {
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      tmp.getContext('2d')!.drawImage(cv, 0, 0);
      const y0 = Math.round(H * 0.46), hh = Math.round(H * 0.07);
      ctx.drawImage(tmp, 0, y0, W, hh, 7, y0 + 2, W, hh);
      ctx.fillStyle = 'rgba(20,24,32,.55)'; ctx.fillRect(0, y0, W, 2);
    }
    // 重疊率不夠：重疊少的地方接不起來 (破圖)
    if (fx.broken) {
      const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      tmp.getContext('2d')!.drawImage(cv, 0, 0);
      const T = 28;
      let seed = 7;
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let py = 0; py < H; py += T) for (let px = 0; px < W; px += T) {
        const wx = ox + (px + T / 2) * scale, wz = oz + (py + T / 2) * scale;
        const l = toLocal(wx, wz);
        const gx = Math.floor((l.x - GX0) / GS), gz = Math.floor((l.z - GZ0) / GS);
        const n = gx >= 0 && gz >= 0 && gx < GNX && gz < GNZ ? this.grid[gx * GNZ + gz] : 0;
        if (n === 0 || n > 5 || rnd() > 0.5) continue;
        const dx = (rnd() - 0.5) * 18, dy = (rnd() - 0.5) * 18;
        ctx.drawImage(tmp, px, py, T, T, px + dx, py + dy, T, T);
        ctx.strokeStyle = 'rgba(10,12,16,.85)'; ctx.lineWidth = 2; ctx.strokeRect(px + dx, py + dy, T, T);
      }
    }
    const toPx = (x: number, z: number) => ({ px: (x - ox) / scale, py: (z - oz) / scale });
    const b0 = toWorld(AREA.x1, AREA.z1), b1 = toWorld(AREA.x0, AREA.z0);
    const p0 = toPx(b0.x, b0.z), p1 = toPx(b1.x, b1.z);
    ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 2; ctx.setLineDash([8, 5]);
    ctx.strokeRect(Math.min(p0.px, p1.px), Math.min(p0.py, p1.py), Math.abs(p1.px - p0.px), Math.abs(p1.py - p0.py));
    ctx.setLineDash([]);
    (this.job.gcps as AnyObj[]).forEach(g => {
      const q = toPx(g.x, g.z);
      const vis = this.job.gcpVisible(g);
      ctx.strokeStyle = vis.ok ? '#22c55e' : '#ef4444'; ctx.lineWidth = 2.5;
      ctx.strokeRect(q.px - 11, q.py - 11, 22, 22);
      const label = `${g.name}${vis.ok ? '' : '：' + vis.why}`;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(q.px + 13, q.py - 20, ctx.measureText(label).width + 8, 18);
      ctx.fillStyle = vis.ok ? '#bbf7d0' : '#fecaca'; ctx.textAlign = 'left';
      ctx.fillText(label, q.px + 17, q.py - 7);
    });
    this.log.ortho = cv.toDataURL('image/jpeg', 0.85);
    return this.log.ortho;
  }

  snapshot() { return { stage: this.stage === 'flying' ? 'ready' : this.stage, home: this.home, plan: this.plan, shot: this.shot, grid: Array.from(this.grid), log: { ...this.log, ortho: null } }; }
  restore(s: AnyObj) {
    if (!s) return;
    if (s.home && s.stage !== 'none' && s.stage !== 'setup') this.setHome(s.home.x, s.home.z);
    this.stage = s.stage || 'none';
    this.plan = s.plan || []; this.shot = s.shot || 6;
    if (s.grid) this.grid = Uint8Array.from(s.grid);
    if (s.log) this.log = { ...this.emptyLog(), ...s.log };
  }

  /** 標準航線 (測試用)：剛好符合重疊需求的蛇行航線 */
  standardPlan() {
    this.plan = [];
    const sp = FW * ALT * (1 - NEED_SIDE);
    let i = 0;
    for (let z = AREA.z0 - 2; z <= AREA.z1 + sp; z += sp, i++) {
      this.plan.push({ x: i % 2 ? AREA.x1 + 8 : AREA.x0 - 8, z }, { x: i % 2 ? AREA.x0 - 8 : AREA.x1 + 8, z });
    }
    this.shot = FL * ALT * (1 - NEED_FWD);
  }

  /** 測試工具：用現在的航線 (沒有就用標準航線) 直接飛完 */
  debugComplete() {
    if (!this.home) return '先架起降點。';
    if (this.stage === 'flying') this.stopFlight(true);
    this.closePlanner();
    if (this.plan.length < 2) this.standardPlan();
    const st = planStats(this.plan, this.shot);
    this.grid = st.grid;
    for (const g of this.job.gcps as AnyObj[]) { const why = this.job.ev.hideReason(g); if (why) g.hiddenWhy = why; else g.seenClear = true; }
    if (this.log.compassOk === null && this.log.homeNearPole) this.log.compassOk = true;
    if (!this.log.eagle) this.log.eagle = 'dodged';
    this.log.photos = Math.round(st.length / this.shot); this.log.landDist = 0.3; this.log.landSpeed = 0.8; this.log.battery = 46;
    this.log.fwd = st.fwd; this.log.side = st.side ?? 0; this.log.cover = st.cover;
    this.stage = 'done';
    this.job.onFlightDone();
    return '航拍直接完成。';
  }
  debugVisit(who: 'grandma' | 'keeper') { if (this.mode !== 'mission') return '要在自動航線中。'; this.visits.unshift(who); this.villagerAt = this.t; return who === 'keeper' ? '廟公來叫你移車了。' : '阿嬤來了。'; }
  debugEagle() { if (this.mode !== 'mission') return '要在自動航線中。'; this.eagleAt = this.t; this.log.eagle = ''; return '大冠鷲來了。'; }
}
