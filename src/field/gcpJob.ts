/**
 * 第三天：農地航測控制點 (GCP) 佈設
 * 流程：備料 → 開到農地 → 東西交給學弟 → 看平板 (Q) 自己選 4～5 個點 → 每個點：鋪模板、噴白、蓋遮板噴黑、敲鋼釘
 * 選點的好壞完全不提示 (樹下、車道、別人的田、土上、範圍外)，到成果報告才算帳。
 */
import * as THREE from 'three';
import { YARD } from './world';
import type { FieldDay } from './fieldDay';
import { SM, type AnyObj } from './legacy';
import { asstName, setAsstName, pickAsstName, loadProgress } from './jobs';
import { tell, whatIf } from './story';
import { buildPerson, animateWalk } from './npc';
import type { Circle } from './truck';
import type { ReportRow } from './ui';
import * as ui from './ui';
import * as sfx from './sfx';
import { ITEMS, type ItemId } from './items';
import { buildItemModel } from './itemModels';
import { JOBS } from './jobs';
import { rtkBench, type RtkResult } from './rtkBench';
import { GcpEvents, DRY_TIME } from './gcpEvents';
import { UavOps, NEED_FWD, NEED_SIDE, ALT } from './uav';
import { gcpBench, buildGcpMarker, type GcpWorkResult, type PaintStock } from './gcpBench';
import {
  buildGcpSite, type SiteBuild, surfAt, topAt, inArea, canopyAt, buildingDist, drawSiteMap,
  AREA, AREA_C, HARD, CROP, SURF_NAME, CROWNS, BAMBOO, toLocal, toWorld, refPoints, type Surf,
} from './gcpSite';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const KIT: ItemId[] = ['template', 'paint', 'hammer'];
const MAX_GCP = 5;

export interface SpotInfo {
  ok: boolean; why?: string;
  x: number; z: number; y: number;
  surf: Surf; soil: number; baseLum: number;
  canopy: string | null; lane: boolean; crop: boolean; temple: boolean; inArea: boolean;
  bld: { d: number; name: string };
}

export interface Gcp {
  name: string; x: number; z: number; y: number;
  spot: SpotInfo;
  res: Omit<GcpWorkResult, 'canvas'>;
  canvas: HTMLCanvasElement;
  obj: THREE.Group;
  rtk?: RtkResult;
  photos: { close: string | null; wide: { img: string; ref: string }[] };
  /** 做好的時間 (漆乾沒乾) */
  t: number;
  /** 乾淨的漆 (補噴用) */
  clean: HTMLCanvasElement;
  /** 現場發生的事 (報告用) */
  notes: string[];
  paw?: boolean; crushed?: boolean; washed?: boolean; busRisk?: boolean; covered?: boolean;
  /** 標被踢動過：之前測的 RTK 坐標對不上了 */
  rtkStale?: boolean; shifted?: boolean;
  /** 航拍時：有一張照片拍到它沒被擋 / 被什麼擋住 */
  seenClear?: boolean; hiddenWhy?: string;
}

interface Asst { g: THREE.Group; state: 'yard' | 'hidden' | 'follow' | 'goto' | 'work' | 'idle' | 'reportLoad' | 'talking' | 'guard'; t: number; tx?: number; tz?: number; speed?: number; onArrive?: () => void }

export class GcpJob {
  private sm: AnyObj;
  private site: SiteBuild | null = null;
  private asst!: Asst;
  gcps: Gcp[] = [];
  private kit = new Set<ItemId>();
  paint: PaintStock = { white: 150, black: 100 };
  wind = { x: 1.6, z: 0.5 };
  uav!: UavOps;
  laid = false;
  carrySet = false; // 介面相容 (水準那天扛整組儀器用)
  private map: HTMLElement | null = null;
  private mapCanvas: HTMLCanvasElement | null = null;
  time = 0;
  ev!: GcpEvents;
  /** 學弟正在顧的標 */
  guarding: Gcp | null = null;
  private nextNo = 1;
  private hintedTablet = false;
  private askedWhere = false;
  private bodiesCache: { x: number; z: number; r: number }[] = [];
  // 出發前：學弟幫忙搬東西上車
  private loading = false;
  private loaded = false;
  /** 這次有拿清單 (被學長嚴肅交代過) */
  private checklist = false;
  private handVis: THREE.Object3D | null = null;
  private clipboard: THREE.Object3D | null = null;

  constructor(private fd: FieldDay) {
    this.sm = fd.app.sceneManager;
    const g = buildPerson({ shirt: 0x1e88e5, pants: 0x37474f, hat: 'cap', skin: 0xd4a07a });
    g.userData.type = 'npc';
    g.userData.npc = 'asst3';
    g.visible = false;
    this.sm.scene.add(g);
    this.asst = { g, state: 'yard', t: 0 };
    this.ev = new GcpEvents(this);
    this.uav = new UavOps(this);
    // 現場一直都在 (每天的世界都一樣)，不是第三天才長出來
    this.site = buildGcpSite(this.sm);
    this.bodiesCache = this.site.colliders;
  }

  get on() { return this.fd.job === 'gcp'; }
  /** 鋼釘 (一盒) */
  nails = { left: 7 };
  /** 早上怎麼交代學弟搬東西 ('' = 沒講) */
  private loadMode: '' | 'serious' | 'help' | 'self' = '';
  /** 學弟收工時忘在現場的東西 */
  private forgotAt: string | null = null;
  private fetchBack = false;
  /** 第二天有沒有好好帶學弟 */
  private mentor2 = 0;
  private sameAsst = false;
  private hammerOut: '' | 'back' | 'lost' = '';

  // ================================================================
  // 生命週期
  // ================================================================
  reset() {
    gcpBench.active && (gcpBench as AnyObj).teardown?.();
    if (!this.site) this.site = buildGcpSite(this.sm);
    document.body.classList.toggle('job-gcp', this.on);
    if (this.site) this.site.group.visible = true;
    this.gcps.forEach(g => { this.sm.scene.remove(g.obj); this.ensureInteractive(g.obj, false); });
    this.gcps = [];
    this.nextNo = 1;
    this.guarding = null;
    this.ev?.reset();
    this.uav?.reset();
    this.office = false; if (this.pc) this.ensureInteractive(this.pc, false);
    this.uav?.reset();
    this.kit.clear();
    this.paint = { white: 130, black: 90 };
    this.nails = { left: 7 };
    this.loadMode = ''; this.forgotAt = null; this.fetchBack = false; this.hammerOut = '';
    const a = Math.random() * Math.PI * 2, s = 1.4 + Math.random() * 1.8;
    this.wind = { x: Math.cos(a) * s, z: Math.sin(a) * s };
    this.laid = false;
    this.time = 0;
    this.hintedTablet = false;
    this.askedWhere = false;
    this.closeMap();
    if (this.phone) this.togglePhone();
    this.loading = this.loaded = this.checklist = false;
    this.setHandVis(null);
    this.showClipboard(false);
    // 第三天的學弟就是第二天那位
    if (this.on) { const pr = loadProgress(); if (pr.asst2) setAsstName(pr.asst2); else pickAsstName(); this.mentor2 = pr.asst2 ? pr.mentor2 || 0 : 0; this.sameAsst = !!pr.asst2; }
    const g = this.asst.g;
    g.visible = this.on;
    g.position.set(-146.5, this.sm.heightAt(-146.5, 61.5), 61.5);
    g.rotation.y = 0;
    this.asst.state = 'yard';
    this.ensureInteractive(g, this.on);
    this.bodiesCache = this.site ? this.site.colliders : [];
  }

  /** 離開外業：拿掉標、藏起學弟 */
  stopAll() {
    document.body.classList.remove('job-gcp');
    this.ev?.reset();
    this.guarding = null;
    if (this.phone) this.togglePhone();
    if (rtkBench.active) (rtkBench as AnyObj).finish?.(null);
    if (gcpBench.active) (gcpBench as AnyObj).teardown?.();
    this.gcps.forEach(g => this.sm.scene.remove(g.obj));
    this.gcps = [];
    this.closeMap();
    this.asst.g.visible = false;
    this.ensureInteractive(this.asst.g, false);
  }

  ensureInteractive(o: THREE.Object3D, on: boolean) {
    const list = this.sm.interactiveObjects as THREE.Object3D[];
    const i = list.indexOf(o);
    if (on && i < 0) list.push(o);
    if (!on && i > -1) list.splice(i, 1);
  }

  startSite(silent = false) {
    if (!silent) this.ev.onArrive();
    if (!silent) {
      // 學弟自己去後斗拿模板、鐵鎚、RTK；噴漆留給學長
      const mine: ItemId[] = ['template', 'hammer', 'rtk'];
      const t = this.fd.truck.toWorld(-3.4, 0, 0.9);
      this.goto(t.x, t.z, 2.6, () => {
        const got = mine.filter(it => !this.kit.has(it) && this.fd.npcTakeFromTrunk(it));
        got.forEach(it => this.kit.add(it));
        if (got.length) sfx.pickup();
        this.showKit();
        const miss = mine.filter(it => !this.kit.has(it));
        ui.toast(`學弟${asstName()}：「${got.length ? `${got.map(i => ITEMS[i].name).join('、')}我拿了，` : ''}${miss.length ? `${got.length ? '……' : ''}${miss.map(i => ITEMS[i].name).join('、')}後斗裡沒有欸？` : ''}學長你拿噴漆就好！」`, got.length === mine.length ? 'info' : 'warn', 4200);
        this.asst.state = 'follow';
      });
      setTimeout(() => { if (!this.hintedTablet) { this.hintedTablet = true; ui.toast('按 Q 打開外業地圖，看航測範圍。', 'info', 5000); } }, 5500);
    }
    this.refreshHint();
  }

  refreshHint() {
    if (!this.on) return;
    const fd = this.fd;
    if (this.laid) {
      const st = this.uav.stage;
      const txt = st === 'setup' ? '下午航拍：從後斗拿無人機箱，找個空曠的地方對著地面按 E 架起降點。'
        : st === 'ready' ? `對著無人機按 E，先在平板上點航點畫航線（前後重疊 ≥ ${NEED_FWD * 100}%、側向重疊 ≥ ${NEED_SIDE * 100}%），再起飛。Space 上升，${ALT} m 後自動跑航線；回來後 WASD 對準、Shift 降落。`
          : st === 'done' ? '航拍完成。對著無人機按 E 收起來，東西都裝回車上再回公司。' : '';
      if (txt) fd.app.updateMissionPanel(fd.title, fd.J.tasks.map((t: string, i: number) => ({ id: i, text: t })), 5, txt);
      return;
    }
    const n = this.gcps.length;
    const miss = KIT.filter(it => !this.kit.has(it));
    const txt = n === 0
      ? (miss.length ? `去車尾拿噴漆箱（${miss.filter(i => i !== 'paint').length ? `${miss.filter(i => i !== 'paint').map(i => ITEMS[i].name).join('、')}也要有人拿；` : ''}學弟${asstName()}拿著其他的）。Q：外業地圖（航測範圍）。看著地面按 E 在那裡佈標。`
        : `選一個點，看著地面按 E 開始佈標（模板 → 噴白 → 噴黑 → 敲釘）。Q：外業地圖。`)
      : `${this.gcps.map(g => `${g.name}${g.rtk ? '·RTK' : ''}${g.photos.close ? '·近' : ''}${g.photos.wide.length ? `·遠${g.photos.wide.length}` : ''}`).join('　')}\n對著標按 E 用 RTK 測坐標；C 手機拍點位照片（近照 1 張、遠照 2 張）。${n >= 4 ? `都好了就跟學弟${asstName()}說收工。` : '工單要四角＋中央，至少 4 點。'}`;
    fd.panel(n === 0 ? 'site' : 'observe', `${txt}\n材料：白漆 ${Math.round(this.paint.white / 130 * 100)}%　黑漆 ${Math.round(this.paint.black / 90 * 100)}%　鋼釘 ${this.nails.left} 根`);
  }

  onEnterTruck() {
    if (!this.on) return;
    // 學弟正拿東西去車上：直接放好；身上還拿著的也一起帶上車
    if (this.asst.state === 'goto' && this.asst.onArrive) { const f = this.asst.onArrive; this.asst.onArrive = undefined; f(); }
    if (this.kit.size && ['packup', 'return'].includes(this.fd.phase)) {
      const left = [...this.kit].filter(it => !this.fd.autoLoad(it));
      this.kit = new Set(left);
    }
    if (this.loading) { this.loading = false; this.loaded = true; this.setHandVis(null); }
    if (this.phone) this.togglePhone();
    this.asst.state = 'hidden';
    this.asst.g.visible = false;
    this.closeMap();
  }

  onExitTruck() {
    if (!this.on) return;
    const t = this.fd.truck;
    const p = t.toWorld(0.3, 0, 2.15);
    this.asst.g.position.set(p.x, this.sm.heightAt(p.x, p.z), p.z);
    this.asst.g.visible = true;
    this.asst.state = ['site', 'observe', 'packup'].includes(this.fd.phase) || this.fd.phase === 'toSite' ? 'follow' : 'idle';
    if (this.fd.phase === 'return' || this.fd.phase === 'prep') this.asst.state = 'idle';
  }

  destText(): string | null {
    if (!this.on || !['site', 'observe'].includes(this.fd.phase)) return null;
    const st = this.ev.stormText();
    return `GCP ${this.gcps.length} / ${MAX_GCP}${st ? `　${st}` : ''}`;
  }

  // ================================================================
  // 每幀
  // ================================================================
  update(dt: number) {
    if (!this.on) return;
    this.time += dt;
    const a = this.asst;
    a.t += dt;
    const p = this.fd.app.player.position;
    // 學長拿到噴漆：學弟問要佈在哪
    if (!this.askedWhere && !this.laid && this.fd.carrying === 'paint' && ['site', 'observe'].includes(this.fd.phase) && this.kit.size) {
      this.askedWhere = true;
      setTimeout(() => ui.toast(`學弟${asstName()}：「學長，請告訴我要在哪裡佈標！（看著地面按 E）」`, 'info', 5000), 700);
    }
    if (!gcpBench.active) {
      switch (a.state) {
        case 'goto':
          if (this.walk(a.tx!, a.tz!, a.speed || 1.8, dt)) { a.state = 'idle'; const f = a.onArrive; a.onArrive = undefined; f?.(); }
          break;
        case 'follow': {
          const d = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z);
          if (d > 2.8) this.walk(p.x, p.z, d > 9 ? 3.4 : 1.7, dt);
          else this.face(p.x, p.z);
          break;
        }
        case 'reportLoad': {
          // 搬完跑來跟學長回報
          if (this.fd.phase !== 'prep' || this.fd.inTruck) { a.state = 'yard'; break; }
          const d = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z);
          if (d > 2.2) { this.walk(p.x, p.z, 2.6, dt); break; }
          this.face(p.x, p.z);
          if (!this.fd.app.player.isModalOpen()) { a.state = 'talking'; this.askCheck(); }
          break;
        }
        case 'talking':
          this.face(p.x, p.z);
          break;
        case 'guard': {
          const g = this.guarding;
          if (!g || !this.gcps.includes(g)) { a.state = 'follow'; this.guarding = null; break; }
          const sx = g.x + 1.3, sz = g.z + 1.3;
          if (Math.hypot(a.g.position.x - sx, a.g.position.z - sz) > 0.4) this.walk(sx, sz, 2.6, dt);
          else this.face(g.x, g.z);
          if (this.time - g.t > DRY_TIME) {
            this.guarding = null; a.state = 'follow';
            ui.toast(`學弟${asstName()}：「學長，${g.name} 的漆乾了！我過去找你。」`, 'info', 3000);
          }
          break;
        }
        case 'yard': case 'idle':
          if (Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 6) this.face(p.x, p.z);
          else animateWalk(a.g, a.t, 0);
          break;
      }
    } else animateWalk(a.g, a.t, 0);
    if (this.map) this.drawMap();
    this.ev.update(dt);
  }

  benchBusy() { return gcpBench.active || rtkBench.active || this.uav.stage === 'flying' || !!document.querySelector('.uav-plan, .pc-modal, .ortho-modal'); }

  private walk(tx: number, tz: number, speed: number, dt: number): boolean {
    const g = this.asst.g;
    const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { animateWalk(g, this.asst.t, 0); return true; }
    const st = Math.min(d, speed * dt);
    g.position.x += dx / d * st; g.position.z += dz / d * st;
    // 不穿過房子、竹林
    for (const c of this.bodiesCache) {
      const ex = g.position.x - c.x, ez = g.position.z - c.z, e = Math.hypot(ex, ez), m = c.r + 0.3;
      if (e < m && e > 1e-4) { g.position.x = c.x + ex / e * m; g.position.z = c.z + ez / e * m; }
    }
    g.position.y = topAt(this.sm, g.position.x, g.position.z);
    g.rotation.y = Math.atan2(-dz, dx);
    animateWalk(g, this.asst.t, speed / 1.5);
    return false;
  }
  private face(x: number, z: number) {
    const g = this.asst.g;
    g.rotation.y = Math.atan2(-(z - g.position.z), x - g.position.x);
    animateWalk(g, this.asst.t, 0);
  }

  bodies(): { x: number; z: number; r: number }[] {
    const p = this.fd.app.player.position;
    const out = this.bodiesCache.filter(c => Math.abs(c.x - p.x) < 12 && Math.abs(c.z - p.z) < 12).concat(this.ev.bodies());
    if (this.on && this.asst.g.visible && this.asst.state !== 'hidden') out.push({ x: this.asst.g.position.x, z: this.asst.g.position.z, r: 0.35 });
    return out;
  }

  obstacles(): Circle[] {
    const t = this.fd.truck.pos;
    const out: Circle[] = this.bodiesCache.filter(c => Math.abs(c.x - t.x) < 25 && Math.abs(c.z - t.z) < 25).map(c => ({ ...c, tag: '房子' })).concat(this.ev.bodies().map(c => ({ ...c, tag: '別人的車' })));
    if (this.on && this.asst.g.visible && this.asst.state !== 'hidden') out.push({ x: this.asst.g.position.x, z: this.asst.g.position.z, r: 0.4, tag: '路人' });
    return out;
  }

  // ================================================================
  // 選點：腳下這塊地是什麼
  // ================================================================
  analyze(x: number, z: number): SpotInfo {
    const samples: Surf[] = [];
    let ymin = 1e9, ymax = -1e9, block = '';
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const sx = x + i * 0.2, sz = z + j * 0.2;
      const s = surfAt(sx, sz);
      const lc = toLocal(sx, sz);
      samples.push(s);
      const y = topAt(this.sm, sx, sz);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
      if (s === 'canal') block = block || '旁邊就是水溝，模板放不下。';
      if (s === 'house' || s === 'temple') block = block || '牆壁擋著，模板放不下。';
      for (const c of CROWNS) if (Math.hypot(lc.x - c.x, lc.z - c.z) < c.trunk + 0.15) block = block || `${c.name}的樹幹擋住了。`;
      for (const b of BAMBOO) if (Math.hypot(lc.x - b.x, lc.z - b.z) < b.r * 0.8) block = block || '竹子太密，模板放不下。';
      for (const c of this.site?.colliders || []) if (c.r < 0.8 && Math.hypot(sx - c.x, sz - c.z) < c.r * 0.8) block = block || '有東西擋著。';
    }
    if (!block && ymax - ymin > 0.12) block = '地面高低不平，模板放不平。';
    const count = new Map<Surf, number>();
    samples.forEach(s => count.set(s, (count.get(s) || 0) + 1));
    const surf = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const soil = samples.filter(s => !HARD.includes(s)).length / samples.length;
    const crop = samples.filter(s => CROP.includes(s)).length / samples.length > 0.3;
    return {
      ok: !block, why: block || undefined,
      x, z, y: topAt(this.sm, x, z), surf, soil,
      baseLum: soil > 0.5 ? 0.36 : surf === 'apronT' ? 0.64 : 0.6,
      canopy: canopyAt(x, z, 0.4), lane: samples.includes('lane') || samples.includes('drive'), crop, temple: surf === 'apronT', inArea: inArea(x, z),
      bld: buildingDist(x, z),
    };
  }

  private groundAim(maxD = 5): THREE.Vector3 | null {
    const cam = this.sm.camera as THREE.PerspectiveCamera;
    const dir = V(); cam.getWorldDirection(dir);
    const o = cam.position.clone();
    for (let t = 0.4; t < maxD; t += 0.1) {
      const q = o.clone().addScaledVector(dir, t);
      if (q.y <= topAt(this.sm, q.x, q.z)) return q;
    }
    return null;
  }

  /** 測試工具用：準心對到的地面 (遠一點也可以) */
  groundAimFar() { return this.groundAim(40); }

  private canLay(): boolean {
    const fd = this.fd;
    return !this.phone && !rtkBench.active && this.on && !this.laid && ['site', 'observe'].includes(fd.phase) && !fd.inTruck && !gcpBench.active && this.gcps.length < MAX_GCP;
  }

  /**
   * 對著地面按 E 是「佈標」還是「放下手上的東西」？
   *  - 手上拿的不是噴漆 → 一律放下
   *  - 停車的地方 (車子附近、路口空地、縣道) → 放下
   *  - 其他地方 (空手或拿噴漆) → 佈標
   */
  private layAim(): THREE.Vector3 | null {
    if (!this.canLay()) return null;
    const fd = this.fd;
    if (fd.carrying && fd.carrying !== 'paint') return null;
    const q = this.groundAim();
    if (!q) return null;
    const t = fd.truck.pos;
    if (Math.hypot(q.x - t.x, q.z - t.z) < 7) return null;
    const s = surfAt(q.x, q.z);
    if (s === 'apron' || toLocal(q.x, q.z).z < 51.4) return null;
    return q;
  }

  /** 拿著無人機箱對地面：架起降點 */
  private homeAim(): THREE.Vector3 | null {
    const fd = this.fd;
    if (!this.on || fd.inTruck || this.uav.stage !== 'setup' || fd.carrying !== 'drone' || this.benchBusy()) return null;
    const q = this.groundAim();
    if (!q) return null;
    if (Math.hypot(q.x - fd.truck.pos.x, q.z - fd.truck.pos.z) < 4) return null;
    return q;
  }

  freePrompt(): string | null {
    if (this.homeAim()) return '在這裡架起降點、放無人機';
    const q = this.layAim();
    if (!q) return this.fd.carrying && this.on && !this.fd.inTruck ? `放下${ITEMS[this.fd.carrying].name}` : null;
    const near = this.gcps.find(g => Math.hypot(g.x - q.x, g.z - q.z) < 3);
    if (near) return `這裡太靠近 ${near.name}`;
    return `在這裡佈設 GCP-0${this.nextNo}`;
  }

  freeInteract(): boolean {
    const h = this.homeAim();
    if (h) {
      const why = this.uav.setHome(h.x, h.z);
      if (why) { sfx.error(); ui.toast(why, 'warn', 2400); return true; }
      this.fd.consumeHeld();
      ui.toast('起降點架好了。對著無人機按 E 準備起飛。', 'good', 3000);
      this.refreshHint();
      return true;
    }
    const q = this.layAim();
    if (!q) return false; // 交給外面：手上有東西就放下
    if (this.gcps.some(g => Math.hypot(g.x - q.x, g.z - q.z) < 3)) { sfx.error(); return true; }
    this.tryLay(q.x, q.z);
    return true;
  }

  /** 東西在不在手邊：學弟拿著、自己拿著、或放在附近地上 */
  private have(it: ItemId, x: number, z: number): boolean {
    const fd = this.fd;
    if (this.kit.has(it) || fd.carrying === it || fd.extraCarry === it) return true;
    return fd.ground.some(g => g.item === it && Math.hypot(g.obj.position.x - x, g.obj.position.z - z) < 6);
  }

  private tryLay(x: number, z: number) {
    const fd = this.fd;
    const spot = this.analyze(x, z);
    if (!spot.ok) { sfx.error(); ui.toast(spot.why!, 'warn', 2400); return; }
    if (this.phone) this.togglePhone();
    for (const it of KIT) {
      if (!this.have(it, x, z)) { fd.needItem(it); return; }
    }
    const a = this.asst;
    const p = fd.app.player;
    const name = `GCP-0${this.nextNo}`;
    // 學弟在附近才幫忙蓋遮板；不在就自己來 (動畫一樣，台詞不同)
    const asstNear = a.g.visible && a.state !== 'guard' && Math.hypot(a.g.position.x - x, a.g.position.z - z) < 12;
    if (asstNear) a.state = 'work';
    gcpBench.start({
      app: fd.app, name, x, z, y: spot.y, yaw: p.euler.y,
      soil: spot.soil, baseLum: spot.baseLum, paint: this.paint, wind: this.wind,
      asst: asstNear ? a.g : null, asstName: asstName(), wrongCan: asstNear && this.ev.rollCanMix(), nails: this.nails,
      onDone: (res) => this.addGcp(name, spot, res),
      onCancel: () => { if (asstNear) a.state = 'follow'; },
    });
  }

  addGcp(name: string, spot: SpotInfo, res: GcpWorkResult, quiet = false) {
    const obj = buildGcpMarker(res.canvas, res.rot, res.nailTilt, name);
    obj.position.set(spot.x, spot.y, spot.z);
    this.sm.scene.add(obj);
    const { canvas, ...rest } = res;
    const clean = document.createElement('canvas'); clean.width = canvas.width; clean.height = canvas.height;
    clean.getContext('2d')!.drawImage(canvas, 0, 0);
    const g: Gcp = { name, x: spot.x, z: spot.z, y: spot.y, spot, res: rest, canvas, obj, photos: { close: null, wide: [] }, t: this.time, clean, notes: rest.noNail ? ['鋼釘用完了，沒有釘'] : [] };
    this.gcps.push(g);
    const no = parseInt(name.slice(-2), 10);
    if (no >= this.nextNo) this.nextNo = no + 1;
    this.ensureInteractive(obj, true);
    if (!quiet) this.ev.onGcpDone(g);
    if (this.asst.state === 'work') this.asst.state = 'follow';
    const fd = this.fd;
    if (fd.phase === 'site') fd.phase = 'observe';
    if (!quiet) {
      sfx.pickup();
      const n = this.gcps.length;
      ui.toast(`${name} 佈設完成。`, 'good', 2600);
      setTimeout(() => ui.thought(`接下來要對著 ${name} 按 E，用 RTK 測坐標。`, 5500), 1200);
    }
    this.refreshHint();
  }

  // ================================================================
  // 互動
  // ================================================================
  prompt(hit: THREE.Object3D): string | null {
    if (!this.on) return null;
    const ep = this.ev.prompt(hit);
    if (ep) return ep;
    if (hit === this.asst.g) {
      const fd = this.fd;
      if (fd.carrying && [...KIT, 'rtk'].includes(fd.carrying) && ['site', 'observe'].includes(fd.phase)) return `把${ITEMS[fd.carrying].name}交給學弟${asstName()}`;
      if (fd.carrying && fd.phase === 'packup') return `把${ITEMS[fd.carrying].name}交給學弟${asstName()}（拿去放後斗）`;
      return `跟學弟${asstName()}說話`;
    }
    if (hit.userData?.type === 'office_pc') return this.office ? '用電腦處理航拍資料（匯入照片、跑空三）' : null;
    if (hit.userData?.type === 'uav_drone') {
      if (this.uav.stage === 'ready') return '規劃航線、準備起飛';
      if (this.uav.stage === 'done') return this.fd.carrying ? '手上有東西，先放下' : '收起無人機';
      return null;
    }
    const g = this.gcps.find(x => x.obj === hit);
    if (g && ['site', 'observe', 'packup'].includes(this.fd.phase)) {
      if (rtkBench.active || gcpBench.active) return null;
      if (g.paw && !g.washed) return `${g.name}：補噴（有腳印）`;
      return g.rtk ? `${g.name}：RTK 重測` : `${g.name}：RTK 測坐標`;
    }
    return null;
  }

  interact(obj: THREE.Object3D) {
    if (!this.on) return;
    if (this.ev.interact(obj)) return;
    if (obj.userData?.type === 'office_pc') { if (this.office) this.openPC(); return; }
    if (obj.userData?.type === 'uav_drone') { this.droneInteract(obj); return; }
    const g = this.gcps.find(x => x.obj === obj);
    if (g) { if (g.paw && !g.washed) this.touchUp(g); else this.startRtk(g); return; }
    if (obj !== this.asst.g) return;
    const fd = this.fd;
    const nm = `學弟${asstName()}`;
    if (fd.phase === 'brief') return;
    if (fd.phase === 'prep' || fd.phase === 'toSite') {
      if (fd.phase === 'prep' && !this.loading && !this.loaded) { this.offerLoad(); return; }
      ui.toast(this.loading ? `${nm}：「${this.checklist ? '照清單搬中，等我一下！' : '搬東西中，等我一下！'}」` : `${nm}：「東西都好了就出發吧！我坐副駕。」`, 'info', 3000);
      return;
    }
    if (fd.phase === 'packup' && fd.carrying) {
      const it = fd.carrying;
      fd.consumeHeld();
      if (fd.extraCarry) { const x = fd.extraCarry; fd.setExtra(null); fd.hold(x); }
      ui.toast(`${nm}：「${ITEMS[it].name}給我，我拿去放後斗！」`, 'info', 2600);
      this.carryToTruck([it]);
      return;
    }
    if (['site', 'observe'].includes(fd.phase) && fd.carrying && [...KIT, 'rtk'].includes(fd.carrying)) {
      const it = fd.carrying;
      fd.consumeHeld();
      this.kit.add(it);
      this.showKit();
      if (fd.extraCarry) { const x = fd.extraCarry; fd.setExtra(null); fd.hold(x); }
      const lines: Record<string, string> = {
        template: '「模板我扛著，到了點我幫你壓。」',
        paint: '「噴漆我拿！黑的白的都在裡面。」',
        hammer: '「鐵鎚鋼釘我這邊。」',
        rtk: '「RTK 我先拿著。」',
      };
      ui.toast(`${nm}：${lines[it] || '「好。」'}`, 'good', 2600);
      this.asst.state = 'follow';
      this.refreshHint();
      return;
    }
    if (['site', 'observe'].includes(fd.phase) && !this.laid) {
      const n = this.gcps.length;
      const p = fd.app.player.position;
      const wet = this.gcps.filter(g => this.time - g.t < DRY_TIME && Math.hypot(g.x - p.x, g.z - p.z) < 10).pop();
      const opts: ui.DialogOption[] = [];
      if (wet && this.guarding !== wet) opts.push({ id: 'guard', text: `「幫我顧著 ${wet.name}，漆乾之前別讓東西踩到。」`, reply: '「好！我站這邊顧。」', score: 0, tag: '' });
      if (n >= 4) opts.push({ id: 'done', text: '「收工！東西拿回車上。」', reply: '「好～我先把東西拿回去。」', score: 0, tag: '' });
      if (opts.length) {
        opts.push({ id: 'more', text: '「沒事，繼續。」', reply: '「好。」', score: 0, tag: '' });
        ui.faceSpeaker(this.asst.g);
        ui.showDialog(nm, n >= 4 ? `「學長，${n} 個點了。收工嗎？」` : '「學長，什麼事？」', opts, (o) => {
          if (o.id === 'done') this.finishLaying();
          if (o.id === 'guard' && wet) { this.guarding = wet; this.asst.state = 'guard'; }
          this.relock();
        });
        return;
      }
      const miss = KIT.filter(it => !this.kit.has(it) && fd.carrying !== it);
      ui.toast(`${nm}：${miss.length ? `「${miss.map(i => ITEMS[i].name).join('、')}在你那邊喔，還是在車上？」` : `「東西都在我這，你選好點看著地上按 E 就開始。」`}`, 'info', 3600);
      this.asst.state = 'follow';
      return;
    }
    ui.toast(`${nm}：「東西都上車再出發喔。」`, 'info', 2400);
  }

  // ================================================================
  // 出發前：學弟幫忙搬東西上車
  // ================================================================
  private offerLoad() {
    const a = this.asst;
    const nm = `學弟${asstName()}`;
    a.state = 'talking';
    ui.faceSpeaker(a.g);
    const hello = !this.sameAsst ? '「學長早！今天佈標對吧？要我幫忙把東西搬上車嗎？」'
      : this.mentor2 >= 1 ? '「學長早！昨天你教我的，我都寫在筆記本第一頁了！今天佈標對吧？要我幫忙把東西搬上車嗎？」'
        : this.mentor2 <= -1 ? '「學長早……今天佈標對吧？要我幫忙搬東西上車嗎？（學弟看起來還是有點迷糊）」'
          : '「學長早！昨天水準辛苦了。今天佈標對吧？要我幫忙把東西搬上車嗎？」';
    ui.showDialog(nm, hello, [
      { id: 'serious', text: `（嚴肅）「${asstName()}，上次東西搬錯害我們差點白跑一趟。這次拿一張清單，照派工單一樣一樣打勾。」`, reply: '「……是！我拿清單，一樣一樣打勾，絕對不會再搬錯！」', score: 0, tag: '' },
      { id: 'help', text: '「好啊，你幫我把今天要用的搬上後斗。」', reply: '「沒問題！交給我！」', score: 0, tag: '' },
      { id: 'self', text: '「我自己來，你在旁邊等。」', reply: '「好喔～」', score: 0, tag: '' },
    ], (o) => {
      a.state = 'yard';
      this.loadMode = o.id as 'serious' | 'help' | 'self';
      if (o.id === 'serious') { this.checklist = true; this.startLoad(); }
      else if (o.id === 'help') this.startLoad();
      this.relock();
    });
  }

  /** 一件一件從貨架搬到車尾。沒清單：常常少一件或多一件；有清單：照派工單搬，不會錯 */
  private startLoad() {
    const fd = this.fd;
    const need = JOBS.gcp.required.slice();
    let list: ItemId[] = need.slice();
    if (!this.checklist) {
      const roll = Math.random();
      if (roll < 0.4) list.splice(Math.floor(Math.random() * list.length), 1);
      else if (roll < 0.8) { const ex: ItemId[] = ['prism', 'tripod', 'cones', 'staff', 'tribrach']; list.push(ex[Math.floor(Math.random() * ex.length)]); }
    }
    list = list.filter(it => !fd.grid.has(it) && fd.carrying !== it && fd.yardItemPos(it));
    if (!this.checklist) list.sort(() => Math.random() - 0.5);
    this.loading = true;
    this.showClipboard(this.checklist);
    const a = this.asst;
    const done = () => {
      this.loading = false; this.loaded = true; this.setHandVis(null);
      if (a.state !== 'hidden') { a.state = 'reportLoad'; }
    };
    // 拿清單：先把後斗裡用不到的東西 (例如全站儀) 搬回架上
    const back: ItemId[] = this.checklist ? fd.grid.placed.map(p => p.item).filter(it => !JOBS.gcp.required.includes(it) && it !== 'water') : [];
    const unload = (j: number) => {
      if (!this.loading || a.state === 'hidden') { done(); return; }
      if (j >= back.length) { step(0); return; }
      const it = back[j];
      const t = fd.truck.toWorld(-3.4, 0, 0.9);
      this.goto(t.x, t.z, 3.2, () => {
        if (!fd.npcTakeFromTrunk(it)) { unload(j + 1); return; }
        this.setHandVis(it);
        sfx.pickup();
        ui.toast(`學弟${asstName()}：「${ITEMS[it].name}今天用不到，我放回架上。」`, 'info', 2200);
        const sp = fd.shelfPos(it);
        if (!sp) { this.setHandVis(null); fd.autoLoad(it); unload(j + 1); return; }
        const d = V(sp.x - t.x, 0, sp.z - t.z).normalize();
        this.goto(sp.x - d.x * 0.8, sp.z - d.z * 0.8, 3.2, () => {
          this.setHandVis(null);
          if (!fd.npcShelve(it)) fd.autoLoad(it);
          sfx.thud();
          unload(j + 1);
        });
      });
    };
    const step = (i: number) => {
      if (!this.loading || a.state === 'hidden') { done(); return; }
      if (i >= list.length) { done(); return; }
      const it = list[i];
      const pos = fd.yardItemPos(it);
      if (!pos) { step(i + 1); return; }
      const t0 = fd.truck.toWorld(-3.4, 0, 0.9);
      const d = V(t0.x - pos.x, 0, t0.z - pos.z).normalize();
      this.goto(pos.x + d.x * 0.8, pos.z + d.z * 0.8, 3.2, () => {
        if (!fd.takeGroundItem(it, pos, 0.6)) { step(i + 1); return; }
        this.setHandVis(it);
        const t = fd.truck.toWorld(-3.4, 0, 0.9);
        this.goto(t.x, t.z, 3.2, () => {
          this.setHandVis(null);
          if (!fd.autoLoad(it)) fd.spawnGround(it, V(t.x, this.sm.heightAt(t.x, t.z + 0.6), t.z + 0.6), 0);
          sfx.thud();
          if (this.checklist) ui.toast(`學弟${asstName()}：「${ITEMS[it].name}……打勾！」`, 'info', 1600);
          step(i + 1);
        });
      });
    };
    ui.toast(this.checklist ? `學弟${asstName()}拿著清單開始整理後斗、搬東西上車。` : `學弟${asstName()}開始搬東西上車。`, 'info', 2500);
    unload(0);
  }

  private goto(x: number, z: number, speed: number, onArrive: () => void) {
    const a = this.asst;
    a.state = 'goto'; a.tx = x; a.tz = z; a.speed = speed; a.onArrive = onArrive;
  }

  private askCheck() {
    const fd = this.fd;
    const a = this.asst;
    const nm = `學弟${asstName()}`;
    ui.faceSpeaker(a.g);
    const line = this.checklist
      ? `「學長，清單上的都打勾了！${fd.grid.has('drone') ? '無人機本來就在後斗，我也勾了。' : ''}要不要檢查一下？」`
      : '「學長，東西都搬上後斗了！要不要檢查一下？」';
    ui.showDialog(nm, line, [
      { id: 'check', text: '「好，我看一下。」', reply: this.checklist ? '「好！清單給你對。」' : '「好！都在後斗。」', score: 0, tag: '' },
      { id: 'trust', text: `「沒關係，${asstName()}我相信你。」`, reply: `「謝謝學長！」（${nm}看起來很開心）`, score: 0, tag: '' },
    ], (o) => {
      a.state = 'yard';
      this.showClipboard(false);
      if (o.id === 'check') fd.openUnload();
      else this.relock();
    });
  }

  /** 學弟手上捧著他負責的東西 (模板、鐵鎚、RTK…) */
  showKit() {
    const list = [...this.kit].filter(it => it !== 'paint' || this.kit.size === 1);
    this.setHandVis(list.length ? list : null);
  }

  /** 學弟手上捧著的設備；拿清單的話：捧東西時板子放在東西上，空手時單手提在身側 */
  private setHandVis(it: ItemId | ItemId[] | null) {
    if (this.handVis) this.asst.g.remove(this.handVis);
    this.handVis = null;
    const list = it === null ? [] : Array.isArray(it) ? it : [it];
    let top = 0;
    if (list.length) {
      // 好幾件就疊起來捧著 (最大的放最下面)
      const g = new THREE.Group();
      let y = 0;
      list.slice().sort((a, b) => ITEMS[b].w * ITEMS[b].d - ITEMS[a].w * ITEMS[a].d).forEach((id, i) => {
        const m = buildItemModel(id);
        m.scale.setScalar(0.75);
        m.rotation.y = Math.PI / 2 + (i % 2 ? 0.15 : -0.1);
        m.position.y = y;
        g.add(m);
        m.updateMatrix();
        y = new THREE.Box3().setFromObject(g).max.y + 0.005;
      });
      g.position.set(0.52, 1.0, 0);
      this.asst.g.add(g);
      this.handVis = g;
      g.updateMatrixWorld(true);
      top = new THREE.Box3().setFromObject(g).max.y - this.asst.g.position.y;
    }
    this.placeClipboard(list.length ? top : null);
  }

  private clipOn = false;
  private showClipboard(on: boolean) {
    this.clipOn = on;
    this.placeClipboard(this.handVis ? this.clipboard?.userData.top ?? 1.3 : null);
  }

  /** top = 捧著的東西頂面高度 (null = 空手) */
  private placeClipboard(top: number | null) {
    const g = this.asst.g;
    if (!this.clipboard) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 90;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fafaf5'; x.fillRect(0, 0, 64, 90);
      x.strokeStyle = '#1f2d3d'; x.lineWidth = 2;
      for (let i = 0; i < 6; i++) { x.strokeRect(6, 14 + i * 12, 7, 7); x.beginPath(); x.moveTo(18, 18 + i * 12); x.lineTo(56, 18 + i * 12); x.stroke(); }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const b = new THREE.Group();
      b.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.012), new THREE.MeshStandardMaterial({ color: 0x8d6e4f, roughness: 0.8 })));
      b.add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.02), new THREE.MeshStandardMaterial({ color: 0x9aa1a9, metalness: 0.8, roughness: 0.3 })).translateY(0.15));
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      paper.position.z = 0.008;
      b.add(paper);
      this.clipboard = b;
    }
    const b = this.clipboard;
    b.parent?.remove(b);
    if (!this.clipOn) { g.userData.pose = top !== null ? 'carryFront' : undefined; return; }
    if (top !== null) {
      // 平放在捧著的東西上面
      g.userData.pose = 'carryFront';
      b.userData.top = top;
      b.position.set(0.52, top + 0.008, 0);
      b.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      g.add(b);
    } else {
      // 左手提著，貼在身側 (跟第二天提水準儀箱一樣，那隻手不擺)
      g.userData.pose = 'carryHand';
      const arm = (g.userData.arms as THREE.Object3D[])[0];
      b.position.set(0.02, -0.72, -0.07);
      b.rotation.set(0, Math.PI, 0);
      arm.add(b);
    }
  }

  relock() {
    const c = this.sm.renderer.domElement;
    try { (c.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需要使用者手勢 */ }
  }

  // ================================================================
  // 事件造成的損壞 / 移點 / 補噴
  // ================================================================
  /** 拿掉一個標 (移點重佈) */
  removeGcp(g: Gcp) {
    this.sm.scene.remove(g.obj);
    this.ensureInteractive(g.obj, false);
    this.gcps = this.gcps.filter(x => x !== g);
    if (this.guarding === g) { this.guarding = null; this.asst.state = 'follow'; }
    this.refreshHint();
  }

  private refreshMarker(g: Gcp) {
    g.obj.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.map) m.map.needsUpdate = true; });
  }

  /** 在標上畫出損壞 (腳印、輪胎痕、水沖、雨) 並扣分 */
  damage(g: Gcp, kind: 'paw' | 'shoe' | 'tire' | 'washed' | 'rain') {
    const c = g.canvas.getContext('2d')!;
    const N = g.canvas.width, px = (m: number) => (m / 1.8 + 0.5) * N;
    if (kind === 'paw') {
      // 一串腳印斜斜穿過去 (踩過黑格帶出黑腳印、踩過白格帶出白腳印)
      const a = Math.random() * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      for (let i = -6; i <= 6; i++) {
        const u = i * 0.13, v = (i % 2 ? 0.07 : -0.07);
        const x = px(u * ca - v * sa), y = px(u * sa + v * ca);
        c.fillStyle = (i * 7) % 3 ? 'rgba(30,30,30,.85)' : 'rgba(235,235,230,.85)';
        c.beginPath(); c.ellipse(x, y, 4.5, 3.5, a, 0, Math.PI * 2); c.fill();
        for (let k = -1; k <= 2; k++) { c.beginPath(); c.arc(x + Math.cos(a + k * 0.5) * 6, y + Math.sin(a + k * 0.5) * 6, 1.8, 0, Math.PI * 2); c.fill(); }
      }
      g.paw = true;
      g.res.paintScore = Math.max(0, g.res.paintScore - 25);
      g.notes.push('阿黃踩過，留下腳印');
    } else if (kind === 'shoe') {
      // 幾個人站上去：一團一團的鞋印，把黑白邊界抹糊
      for (let i = 0; i < 9; i++) {
        const x = px((Math.random() - 0.5) * 1.1), y = px((Math.random() - 0.5) * 1.1), a = Math.random() * Math.PI;
        c.fillStyle = i % 2 ? 'rgba(40,38,34,.8)' : 'rgba(225,224,218,.8)';
        c.beginPath(); c.ellipse(x, y, 11, 5, a, 0, Math.PI * 2); c.fill();
      }
      g.paw = true;
      g.res.paintScore = Math.max(0, g.res.paintScore - 25);
      g.notes.push('圍觀的人站上去，踩出鞋印');
    } else if (kind === 'tire') {
      c.save(); c.translate(N / 2, N / 2); c.rotate(-g.res.rot);
      c.fillStyle = 'rgba(70,52,36,.75)';
      [-0.42, 0.42].forEach(o => { c.fillRect(px(o) - N / 2 - 10, -N / 2, 20, N); });
      c.restore();
      g.res.paintScore = Math.max(0, g.res.paintScore - 45);
      g.notes.push('被鐵牛車輾過，輪胎痕');
    } else if (kind === 'washed') {
      c.save(); c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,.8)'; c.fillRect(0, 0, N, N); c.restore();
      g.washed = true; g.paw = false;
      g.res.paintScore = Math.min(g.res.paintScore, 5);
      g.notes.push('被阿伯用水管沖掉');
    } else {
      c.save(); c.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 40; i++) { c.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.2})`; c.fillRect(Math.random() * N, Math.random() * N * 0.3, 3 + Math.random() * 6, N * (0.4 + Math.random() * 0.6)); }
      c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 0, N, N);
      c.restore();
      g.res.paintScore = Math.max(0, g.res.paintScore - 35);
      g.notes.push('漆還沒乾就下雨，被沖淡');
    }
    this.refreshMarker(g);
  }

  /** 腳印補噴 */
  private touchUp(g: Gcp) {
    const fd = this.fd;
    if (!this.have('paint', g.x, g.z)) { fd.needItem('paint'); return; }
    if (this.paint.white < 6 || this.paint.black < 4) { sfx.error(); ui.toast('漆不夠補了。', 'warn', 2200); return; }
    this.paint.white -= 6; this.paint.black -= 4;
    const c = g.canvas.getContext('2d')!;
    c.clearRect(0, 0, g.canvas.width, g.canvas.height);
    c.drawImage(g.clean, 0, 0);
    g.paw = false;
    g.res.paintScore = Math.min(100, g.res.paintScore + 25);
    const was = g.notes.find(n => n.startsWith('阿黃') || n.startsWith('圍觀的人站上去'));
    g.notes = g.notes.filter(n => n !== was).concat(was?.startsWith('圍觀') ? '被圍觀的人踩過，補噴過了' : '阿黃踩過，補噴過了');
    g.t = this.time; // 又要等乾
    sfx.spray(true); setTimeout(() => sfx.spray(false), 900);
    ui.toast(`${g.name} 的腳印補噴好了（又要等它乾）。`, 'good', 2600);
    this.refreshMarker(g);
  }

  // ================================================================
  // RTK
  // ================================================================
  private startRtk(g: Gcp) {
    const fd = this.fd;
    if (!this.have('rtk', g.x, g.z)) { fd.needItem('rtk'); return; }
    const p = fd.app.player;
    if (Math.hypot(p.position.x - g.x, p.position.z - g.z) > 3) { ui.toast('走近一點。', 'info', 1500); return; }
    const yaw = Math.atan2(-(g.x - p.position.x), -(g.z - p.position.z));
    rtkBench.start({
      app: fd.app, name: g.name, x: g.x, y: g.y, z: g.z, yaw,
      env: { canopy: g.spot.canopy, bldD: g.spot.bld.d }, wind: this.wind, asstName: asstName(),
      onDone: (r) => { if (r) { g.rtk = r; if (g.rtkStale) { g.rtkStale = false; g.notes.push('踢動後重測了 RTK'); } this.refreshHint(); setTimeout(() => ui.thought(`${g.name} 坐標測好了。再用手機（C）拍點位照片：近照 1 張、遠照 2 張。`, 5500), 3300); } },
    });
  }

  // ================================================================
  // 點位照片：C 開手機相機，Space 拍
  // ================================================================
  private phone: HTMLElement | null = null;
  private phoneHid: THREE.Object3D[] = [];
  private togglePhone() {
    const cam = this.sm.camera as THREE.Camera;
    if (this.phone) { this.phone.remove(); this.phone = null; document.body.classList.remove('phone-cam'); this.phoneHid.forEach(c => { c.visible = true; }); this.phoneHid = []; ui.forceFieldbook(false); return; }
    ui.forceFieldbook(true);
    this.phoneHid = cam.children.filter(c => c.visible); this.phoneHid.forEach(c => { c.visible = false; });
    const d = document.createElement('div');
    d.className = 'phone-view';
    d.innerHTML = '<div class="pv-frame"><i class="pv-c tl"></i><i class="pv-c tr"></i><i class="pv-c bl"></i><i class="pv-c br"></i><b class="pv-cross"></b></div><div class="big-guide"><b>點位照片</b>　近照：站在標旁邊、標放在畫面中間按 <kbd class="cap">Space</kbd><br>遠照（2 張）：退到 5～40 m，畫面要帶到廟、房子、大樹、電線桿等參考地物</div><div class="pv-bar"><span class="pv-rec">● 點位照片</span><span>Space 拍照　C 收起手機</span></div>';
    document.body.appendChild(d);
    document.body.classList.add('phone-cam');
    this.phone = d;
    sfx.pickup();
  }

  private shoot() {
    const sm = this.sm;
    const cam = sm.camera as THREE.PerspectiveCamera;
    // 拍下目前畫面 (縮圖)
    sm.render();
    const src = sm.renderer.domElement as HTMLCanvasElement;
    const th = document.createElement('canvas'); th.width = 192; th.height = 108;
    th.getContext('2d')!.drawImage(src, 0, 0, 192, 108);
    const img = th.toDataURL('image/jpeg', 0.7);
    sfx.clink(1);
    this.phone?.classList.remove('flash'); void this.phone?.offsetWidth; this.phone?.classList.add('flash');
    cam.updateMatrixWorld();
    const inFrame = (x: number, y: number, z: number, m = 0.92) => { const q = V(x, y, z).project(cam); return q.z < 1 && Math.abs(q.x) < m && Math.abs(q.y) < m ? q : null; };
    const cands = this.gcps.map(g => ({ g, q: inFrame(g.x, g.y, g.z), d: cam.position.distanceTo(V(g.x, g.y, g.z)) })).filter(c => c.q) as { g: Gcp; q: THREE.Vector3; d: number }[];
    if (!cands.length) { ui.toast('拍到了風景……畫面裡沒有控制點。', 'info', 2200); return; }
    cands.sort((a, b) => Math.hypot(a.q.x, a.q.y) - Math.hypot(b.q.x, b.q.y));
    const { g, q, d } = cands[0];
    // 被牆、樹、房子擋住就看不到標
    const to = V(g.x, g.y + 0.05, g.z);
    const ray = new THREE.Raycaster(cam.position.clone(), to.clone().sub(cam.position).normalize(), 0.3, d - 0.9);
    const blockers = [this.site!.group, ...(this.sm.trees as THREE.Object3D[]).filter(t => t.parent), this.fd.truck.group];
    if (ray.intersectObjects(blockers, true).length) { ui.toast(`${g.name} 被擋住了，拍不到標。`, 'info', 2200); return; }
    if (d < 3.6) {
      if (Math.hypot(q.x, q.y) > 0.4) { ui.toast(`${g.name} 近照：標沒有在畫面中間，重拍一張比較好。`, 'warn', 2400); return; }
      g.photos.close = img;
      ui.toast(`${g.name} 近照 ✓`, 'good', 1800);
    } else if (d >= 5 && d <= 40) {
      const refs = refPoints().filter(r => Math.hypot(r.x - cam.position.x, r.z - cam.position.z) < 70 && inFrame(r.x, this.sm.heightAt(r.x, r.z) + r.y, r.z, 0.95));
      const used = new Set(g.photos.wide.map(w => w.ref));
      const ref = refs.find(r => !used.has(r.name)) || refs[0];
      if (g.photos.wide.length >= 2 && ref && !used.has(ref.name)) g.photos.wide.shift();
      if (g.photos.wide.length >= 2) { ui.toast(`${g.name} 遠照已經有兩張了。`, 'info', 1800); return; }
      g.photos.wide.push({ img, ref: ref ? ref.name : '' });
      ui.toast(ref ? `${g.name} 遠照 ${g.photos.wide.length}／2（參考：${ref.name}）` : `${g.name} 遠照 ${g.photos.wide.length}／2`, 'good', 2200);
    } else {
      ui.toast(`${g.name}：這個距離不像近照也不像遠照。`, 'info', 2000);
      return;
    }
    this.refreshHint();
  }

  /** 學弟把東西拿回車上 */
  private carryToTruck(items: ItemId[], then?: () => void) {
    const fd = this.fd;
    const t = fd.truck.toWorld(-3.4, 0, 0.9);
    this.asst.state = 'goto';
    this.asst.tx = t.x; this.asst.tz = t.z; this.asst.speed = 2.0;
    this.setHandVis(items);
    this.asst.onArrive = () => {
      this.setHandVis(null);
      const failed = items.filter(it => !fd.autoLoad(it));
      failed.forEach((it, k) => fd.spawnGround(it, V(t.x + k * 0.6, this.sm.heightAt(t.x + k * 0.6, t.z + 0.5), t.z + 0.5), 0));
      if (failed.length) ui.toast(`學弟${asstName()}：「後斗塞不下，我放車尾地上了。」`, 'info', 3000);
      this.asst.state = 'follow';
      then?.();
    };
  }

  private finishLaying() {
    if (this.laid) return;
    this.laid = true;
    const fd = this.fd;
    let items = [...this.kit];
    this.kit.clear();
    // 學弟收東西：早上交代得隨便的話，可能把鐵鎚忘在某個標旁邊
    let forgetP = this.loadMode === 'serious' ? 0 : this.loadMode === 'help' ? 0.7 : 0.4;
    // 第二天有好好帶他：比較細心；沒帶好：更容易漏
    if (this.mentor2 >= 1) forgetP *= 0.4; else if (this.mentor2 <= -1) forgetP = Math.min(0.9, forgetP + 0.2);
    const fw = (window as unknown as { __forgetHammer?: boolean }).__forgetHammer; // 測試用
    if (items.includes('hammer') && this.gcps.length && (fw ?? Math.random() < forgetP)) {
      const g = this.gcps[Math.floor(Math.random() * this.gcps.length)];
      items = items.filter(i => i !== 'hammer');
      const px = g.x + 1.1, pz = g.z + 0.7;
      fd.spawnGround('hammer', V(px, topAt(this.sm, px, pz), pz), Math.random() * 3);
      this.forgotAt = g.name;
      tell(this.loadMode === 'help' ? '早上隨口交代學弟搬東西' : '早上沒特別交代學弟', `收工時他把鐵鎚忘在 ${g.name} 旁邊`);
      whatIf('早上嚴肅交代學弟拿清單一樣一樣打勾，他收工就不會漏東西。');
    } else if (items.length) {
      if (this.loadMode === 'serious') tell('早上嚴肅交代學弟拿清單', '收工時他一樣一樣對清單，一件都沒漏');
      else if (this.mentor2 >= 1 && this.sameAsst) tell('第二天有好好教學弟', '今天收工時他自己檢查了一遍，沒漏東西');
    }
    ui.toast(`佈標完成（${this.gcps.length} 點）。${items.length ? `學弟${asstName()}把${items.map(i => ITEMS[i].name).join('、')}拿回車上。` : ''}`, 'good', 4500);
    if (items.length) this.carryToTruck(items, () => this.fetchBattery());
    else this.fetchBattery();
    this.uav.stage = 'setup';
    this.ev.onLayingDone();
    setTimeout(() => ui.toast(`學弟${asstName()}：「學長，要飛了嗎？無人機箱你拿，找個空曠的地方當起降點。」`, 'info', 5000), 1500);
    this.refreshHint();
  }

  /** 學弟去後斗拿無人機電池 */
  private fetchBattery() {
    const fd = this.fd;
    void fd;
  }

  // ================================================================
  // 航拍
  // ================================================================
  private droneInteract(obj: THREE.Object3D) {
    const fd = this.fd;
    if (this.uav.stage === 'ready') {
      const h = this.uav.home!;
      void h;
      this.uav.preflight();
      return;
    }
    if (this.uav.stage === 'done') {
      if (fd.carrying) { sfx.error(); return; }
      this.sm.scene.remove(obj);
      this.ensureInteractive(obj, false);
      fd.hold('drone');
      this.uav.stage = 'none';
      ui.toast('無人機收進箱子了，拿回車上。', 'info', 2600);
      fd.setPhase('packup');
    }
  }

  /** 降落後：村民 → 正射影像成果 */
  onFlightDone() {
    setTimeout(() => ui.toast('照片都拍好了。把無人機收起來（對著它按 E），回公司用電腦匯入照片、跑空三。', 'info', 5500), 1200);
    this.refreshHint();
  }

  // ================================================================
  // 回公司：電腦處理 (匯入照片 → 匯入控制點 → 空三) → 正射 + 報表 → 結算
  // ================================================================
  private pc: THREE.Group | null = null;
  private office = false;
  private buildPC() {
    const S = SM();
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 });
    const scr = S.canvasTex(256, 160, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0e3a5f'); gr.addColorStop(1, '#1d6fa5'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e5e7eb'; c.font = 'bold 22px sans-serif'; c.textAlign = 'center'; c.fillText('空三處理', w / 2, h / 2 + 8);
    });
    g.add(S.mk(new THREE.BoxGeometry(0.06, 0.38, 0.6), dark, 0, 0.27, 0));
    const m = S.mk(new THREE.PlaneGeometry(0.56, 0.34), new THREE.MeshBasicMaterial({ map: scr }), -0.032, 0.27, 0, true);
    m.rotation.y = -Math.PI / 2;
    g.add(m);
    g.add(S.mk(new THREE.BoxGeometry(0.08, 0.08, 0.06), dark, 0.03, 0.05, 0));
    g.add(S.mk(new THREE.BoxGeometry(0.2, 0.012, 0.16), dark, 0.03, 0.006, 0));
    g.add(S.mk(new THREE.BoxGeometry(0.16, 0.015, 0.45), new THREE.MeshStandardMaterial({ color: 0x374151 }), -0.25, 0.008, 0));
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.3; g.add(hit);
    // 器材室工作桌 (world.ts：YARD + (5.5, 0.875, 8))，螢幕朝 -x
    g.position.set(YARD.x + 5.9, this.sm.heightAt(YARD.x, YARD.z) + 0.875, YARD.z + 8);
    g.userData = { type: 'office_pc' };
    this.sm.scene.add(g);
    this.pc = g;
  }

  /** 開回公司停好下車 */
  atOffice() {
    if (!this.pc) this.buildPC();
    // 學弟忘在現場的鐵鎚
    const S = this.fd.J.site;
    const left = this.fd.ground.some((g: AnyObj) => g.item === 'hammer' && Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r);
    if (this.fetchBack && !left) { this.fetchBack = false; this.hammerOut = 'back'; tell('學弟忘了鐵鎚，開回去拿', '鐵鎚找回來了，學弟說下次收東西會對清單'); ui.toast(`學弟${asstName()}：「鐵鎚拿回來了……學長歹勢，下次我收東西會對清單。」`, 'info', 4500); }
    else if (left && !this.fetchBack && this.forgotAt) {
      ui.showDialog(`學弟${asstName()}`, `「學長……我剛剛整理後斗，鐵鎚好像……忘在 ${this.forgotAt} 旁邊了。」`, [
        { id: 'back', text: '「走，開回去拿。」', reply: '「好！對不起……」', score: 0, tag: '' },
        { id: 'leave', text: '「算了，回報遺失。」', reply: '「……好。」（學弟很沮喪）', score: 0, tag: '' },
      ], (o) => {
        if (o.id === 'back') {
          this.fetchBack = true;
          ui.toast(`開回農地，把 ${this.forgotAt} 旁邊的鐵鎚拿回來。`, 'info', 4500);
          this.fd.app.updateMissionPanel(this.fd.title, this.fd.J.tasks.map((t: string, i: number) => ({ id: i, text: t })), 7, `學弟把鐵鎚忘在 ${this.forgotAt} 旁邊了。開回農地拿回來（放進後斗或拿在手上），再開回公司。`);
        } else { this.forgotAt = null; this.hammerOut = 'lost'; tell('學弟忘了鐵鎚，決定回報遺失', '鐵鎚留在田裡，收工清點扣分'); }
        if (o.id === 'leave') this.atOffice();
        this.relock();
      });
      return;
    } else if (left && this.fetchBack) { ui.toast('鐵鎚還沒拿回來。', 'warn', 2500); return; }
    this.ev.callChief('office');
    this.office = true;
    this.ensureInteractive(this.pc!, true);
    ui.toast('回到公司了。走到器材室的電腦，把照片和控制點匯進去跑空三。', 'info', 5000);
    this.fd.app.updateMissionPanel(this.fd.title, this.fd.J.tasks.map((t: string, i: number) => ({ id: i, text: t })), 7, '走到器材室工作桌上的電腦（按 E），匯入照片、匯入控制點、跑空三，看正射影像和報表。');
  }

  private openPC() {
    if (document.exitPointerLock) document.exitPointerLock();
    const flew = this.uav.log.photos > 0;
    const box = document.createElement('div');
    box.className = 'modal-backdrop show field-modal pc-modal';
    box.innerHTML = `<div class="pc-screen">
      <div class="pc-title">空三處理軟體　<span>${this.fd.J.workOrder.item}</span></div>
      <div class="pc-steps">
        <button data-s="0">① 匯入照片（${this.uav.log.photos} 張）</button>
        <button data-s="1" disabled>② 匯入控制點坐標（${this.gcps.filter(g => g.rtk).length} 點）</button>
        <button data-s="2" disabled>③ 空中三角測量</button>
      </div>
      <div class="pc-bar"><i></i></div>
      <div class="pc-log"></div>
    </div>`;
    document.body.appendChild(box);
    const log = box.querySelector('.pc-log') as HTMLElement;
    const bar = box.querySelector('.pc-bar i') as HTMLElement;
    const btns = [...box.querySelectorAll<HTMLButtonElement>('.pc-steps button')];
    const run = (i: number, lines: string[], dur: number, next: () => void) => {
      btns.forEach(b => { b.disabled = true; });
      let t = 0;
      const tick = () => {
        t += 0.05;
        bar.style.width = `${Math.min(100, t / dur * 100)}%`;
        const k = Math.floor(t / dur * lines.length);
        log.innerHTML = lines.slice(0, Math.min(lines.length, k + 1)).map(l => `<div>${l}</div>`).join('');
        if (t < dur) setTimeout(tick, 50); else { btns[i].classList.add('done'); next(); }
      };
      tick();
    };
    if (!flew) {
      log.innerHTML = '<div>找不到航拍照片……今天沒有飛。</div>';
      btns.forEach(b => { b.disabled = true; });
      setTimeout(() => this.showOrtho(box), 1800);
      return;
    }
    btns[0].onclick = () => run(0, ['讀取 SD 卡……', `${this.uav.log.photos} 張照片、POS 資料`, '建立影像金字塔……'], 1.6, () => { btns[1].disabled = false; });
    btns[1].onclick = () => run(1, ['讀取 RTK 手簿匯出檔……', ...this.gcps.map(g => `${g.name}　${g.rtk ? (g.rtk.sol === 'fix' ? '固定解' : '浮動解') : '<b class="bad">沒有坐標</b>'}`), '在照片上點選控制點……'], 2, () => { btns[2].disabled = false; });
    btns[2].onclick = () => run(2, ['連結點匹配……', '光束法平差……', '產生數值地表模型……', '正射糾正、鑲嵌……'], 2.6, () => this.showOrtho(box));
  }


  /** 尾聲要用的事 */
  endingFacts() {
    const ev = this.ev;
    return {
      rel: { ...ev.rel }, metKeeper: ev.keeperDone || ev.keeperFriend || ev.keeperAnnoyed,
      asst: asstName(), mentor2: this.mentor2, sameAsst: this.sameAsst, serious: this.loadMode === 'serious',
      hammer: this.hammerOut, aeroOk: this.aero().ok,
    };
  }

  /** 這個標在正射影像上看不看得到 */
  gcpVisible(g: Gcp): { ok: boolean; why: string } {
    const l = toLocal(g.x, g.z);
    if (g.covered) return { ok: false, why: '被遊覽車蓋住' };
    if (g.spot.canopy) return { ok: false, why: `${g.spot.canopy}擋住` };
    if (g.washed) return { ok: false, why: '標被沖掉了' };
    if (g.hiddenWhy && !g.seenClear) return { ok: false, why: g.hiddenWhy };
    void l;
    if (!this.uav.covered(g.x, g.z)) return { ok: false, why: '沒拍到' };
    if (g.res.paintScore < 30) return { ok: false, why: '標太模糊認不出來' };
    return { ok: true, why: '' };
  }

  /** 空三平差：每點殘差 (cm)，null = 這點不能用 */
  private residual(g: Gcp): number | null {
    if (!this.gcpVisible(g).ok || !g.rtk) return null;
    let r = 1.5 + g.rtk.tiltMm / 10 + (100 - g.res.paintScore) / 25 + (g.res.loose ? 1 : 0) + (g.spot.bld.d < 4 ? 1.5 : 0);
    if (g.rtk.sol === 'float') r += 15;
    if (g.rtk.falseFix) r += 18;
    if (g.res.nailTilt > 3) r += 0.5;
    if (g.res.noNail) r += 3;
    if (g.rtkStale) r += 14;
    return r;
  }
  aero(): { ok: boolean; rmse: number | null; used: number; note: string } {
    const rs = this.gcps.map(g => this.residual(g)).filter((r): r is number => r !== null);
    if (rs.length < 3) return { ok: false, rmse: null, used: rs.length, note: `可用控制點只有 ${rs.length} 個，無法平差` };
    // 分布差：少一個角放大誤差
    const usable = this.gcps.filter(g => this.residual(g) !== null).map(g => toLocal(g.x, g.z));
    const corners = [[AREA.x0, AREA.z0], [AREA.x1, AREA.z0], [AREA.x0, AREA.z1], [AREA.x1, AREA.z1]];
    const miss = corners.filter(([cx, cz]) => !usable.some(g => Math.hypot(g.x - cx, g.z - cz) < 19)).length;
    const center = usable.some(g => Math.hypot(g.x - AREA_C.x, g.z - AREA_C.z) < 14);
    const base = Math.sqrt(rs.reduce((a, b) => a + b * b, 0) / rs.length);
    const L = this.uav.log;
    const lowF = L.fwd < NEED_FWD - 0.01, lowS = L.side < NEED_SIDE - 0.01;
    const rmse = base * (1 + 0.3 * miss + (center ? 0 : 0.2)) * (L.eagle === 'hit' ? 1.15 : 1) * (L.seam ? 1.1 : 1) * (lowF ? 1 + (NEED_FWD - L.fwd) * 4 : 1) * (lowS ? 1 + (NEED_SIDE - L.side) * 4 : 1);
    const notes = [miss ? `少了 ${miss} 個角的控制點，邊緣誤差放大` : '', lowF ? `前後重疊只有 ${Math.round(L.fwd * 100)}%，影像接不好` : '', lowS ? `側向重疊只有 ${Math.round(Math.max(0, L.side) * 100)}%，航帶之間接不好` : '', L.seam ? '航線中途中斷再續飛，接縫處誤差較大' : '', ...this.gcps.filter(g => g.rtkStale && this.gcpVisible(g).ok).map(g => `${g.name} 殘差特別大（測完 RTK 後標被動過？）`)].filter(Boolean);
    return { ok: rmse <= 10, rmse, used: rs.length, note: notes.join('；') };
  }

  private showOrtho(pcBox?: HTMLElement) {
    const a = this.aero();
    const L = this.uav.log;
    const warp = a.rmse === null ? 22 : Math.max(0, Math.min(16, (a.rmse - 4) * 1.6));
    const broken = L.fwd < NEED_FWD - 0.01 || L.side < NEED_SIDE - 0.01;
    const flew = L.photos > 0;
    const img = flew ? this.uav.renderOrtho({ warp, broken }) : '';
    pcBox?.remove();
    const box = document.createElement('div');
    box.className = 'modal-backdrop show field-modal ortho-modal';
    const rows = this.gcps.map(g => { const v = this.gcpVisible(g); const r = this.residual(g); return `<tr><td>${g.name}</td><td>${v.ok ? '看得到' : `<b class="bad">${v.why}</b>`}</td><td>${g.rtk ? (g.rtk.sol === 'fix' ? '固定解' : '浮動解') : '<b class="bad">沒測</b>'}</td><td>${r === null ? '—' : `${r.toFixed(1)} cm`}</td></tr>`; }).join('');
    box.innerHTML = `<div class="paper ortho-paper">
      <div class="paper-head"><h2>航拍成果（正射影像）</h2><span class="stamp ${a.ok ? '' : 'bad'}">${a.ok ? '合格' : '不合格'}</span></div>
      <div class="ortho-body">${flew ? `<img src="${img}" alt="正射影像">` : '<div class="ortho-none">沒有航拍照片</div>'}<div>
        <table class="paper-table"><tr><th>點號</th><th>影像</th><th>RTK</th><th>殘差</th></tr>${rows}</table>
        <p class="ortho-sum">空三平差：${a.rmse === null ? a.note : `RMSE <b>${a.rmse.toFixed(1)} cm</b>（規範 ≤ 10 cm）${a.note ? `<br>${a.note}` : ''}`}</p>
      </div></div>
      <div class="paper-actions"><button class="btn-paper" id="ortho-ok"><kbd class="cap cap-accent">Enter</kbd> 交差</button></div>
    </div>`;
    document.body.appendChild(box);
    if (document.exitPointerLock) document.exitPointerLock();
    const close = () => { window.removeEventListener('keydown', onKey, true); box.remove(); this.office = false; if (this.pc) this.ensureInteractive(this.pc, false); this.fd.finish(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    (box.querySelector('#ortho-ok') as HTMLButtonElement).onclick = close;
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.on) return false;
    if (e.code === 'KeyQ' && !this.fd.inTruck && !this.fd.app.player.isModalOpen() && ['site', 'observe', 'packup', 'prep'].includes(this.fd.phase)) { this.toggleMap(); return true; }
    if (e.code === 'KeyC' && !this.fd.inTruck && !this.fd.app.player.isModalOpen() && ['site', 'observe', 'packup'].includes(this.fd.phase)) { this.togglePhone(); return true; }
    if (e.code === 'Space' && this.phone) { this.shoot(); return true; }
    return false;
  }

  // ================================================================
  // 平板 (航測範圍)
  // ================================================================
  private toggleMap() { if (this.map) this.closeMap(); else this.openMap(); }
  private openMap() {
    const d = document.createElement('div');
    d.className = 'gcp-tablet';
    d.innerHTML = '<div class="gt-head"><b>外業地圖（航測範圍）</b><span>Q 收起</span></div><canvas width="520" height="430"></canvas><div class="gt-foot">比例尺 10 m　紅框：航測範圍（四角＋中央各一點）</div><div class="gt-list"></div>';
    document.body.appendChild(d);
    this.map = d;
    this.mapCanvas = d.querySelector('canvas');
    this.hintedTablet = true;
    sfx.pickup();
    this.drawMap();
  }
  closeMap() { this.map?.remove(); this.map = null; this.mapCanvas = null; }
  private drawMap() {
    const list = this.map?.querySelector('.gt-list') as HTMLElement | null;
    if (list) {
      const html = this.gcps.length ? this.gcps.map(g => `<span><b>${g.name}</b> RTK ${g.rtk ? (g.rtk.sol === 'fix' ? '固定' : '浮動') : '—'}　近 ${g.photos.close ? '✓' : '—'}　遠 ${g.photos.wide.length}/2</span>`).join('') : '<span>還沒佈點</span>';
      if (list.innerHTML !== html) list.innerHTML = html;
    }
    const c = this.mapCanvas?.getContext('2d');
    if (!c || !this.mapCanvas) return;
    const p = this.fd.app.player;
    const t = this.fd.truck;
    drawSiteMap(c, this.mapCanvas.width, this.mapCanvas.height, {
      player: { x: p.position.x, z: p.position.z, yaw: p.euler.y },
      truck: { x: t.pos.x, z: t.pos.z, heading: t.heading },
      gcps: this.gcps.map(g => ({ x: g.x, z: g.z, name: g.name })),
      asst: this.asst.g.visible ? { x: this.asst.g.position.x, z: this.asst.g.position.z } : null,
    });
  }

  // ================================================================
  // 成果
  // ================================================================
  /** 每個點的問題 (報告用) */
  issues(g: Gcp): string[] {
    const s = g.spot;
    const out: string[] = [];
    if (!s.inArea) out.push('在航測範圍外');
    if (s.canopy) out.push(`在${s.canopy}底下，航拍看不到`);
    if (s.lane) out.push('壓在農路上，車子會輾過');
    if (s.crop) out.push(`噴在${SURF_NAME[s.surf] === '田埂' ? '別人的田' : SURF_NAME[s.surf]}裡`);
    if (s.soil > 0.5 && !s.crop) out.push('噴在土上，漆被吃掉、釘子會鬆');
    else if (s.soil > 0.5) out.push('土上的漆不清楚、釘子會鬆');
    const l = toLocal(g.x, g.z);
    if (g.covered) out.push('在廟埕，被遊覽車停在上面');
    else if (!this.ev.busParked && Math.abs(l.x - 27.5) < 5.6 && Math.abs(l.z - 102.4) < 1.6) out.push('在廟埕正中間，下午遊覽車會停在上面');
    return out;
  }

  reportRows(): ReportRow[] {
    const rows: ReportRow[] = [];
    const n = this.gcps.length;
    // 分布：四角 + 中央 (只算看得到的點)
    // 用現場座標算 (範圍是軸對齊的方框)；角落名稱用世界方位 (+x 東、+z 南)
    const usable = this.gcps.filter(g => g.spot.inArea && !g.spot.canopy).map(g => toLocal(g.x, g.z));
    const cw = toWorld(AREA_C.x, AREA_C.z);
    const corners: [number, number, string][] = ([[AREA.x0, AREA.z0], [AREA.x1, AREA.z0], [AREA.x0, AREA.z1], [AREA.x1, AREA.z1]] as [number, number][]).map(([lx, lz]) => {
      const w = toWorld(lx, lz);
      return [lx, lz, `${w.z < cw.z ? '北' : '南'}${w.x > cw.x ? '東' : '西'}角`.replace(/^(.)(.)角$/, '$2$1角')] as [number, number, string];
    });
    const missC = corners.filter(([cx, cz]) => !usable.some(g => Math.hypot(g.x - cx, g.z - cz) < 19)).map(c => c[2]);
    const center = usable.some(g => Math.hypot(g.x - AREA_C.x, g.z - AREA_C.z) < 14);
    let minPair = Infinity;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minPair = Math.min(minPair, Math.hypot(this.gcps[i].x - this.gcps[j].x, this.gcps[i].z - this.gcps[j].z));
    const distPts = Math.max(0, (4 - missC.length) * 1.5 + (center ? 1 : 0));
    rows.push({
      label: '控制點分布',
      detail: n === 0 ? '一個點都沒佈' : [missC.length ? `${missC.join('、')}沒有可用的點` : '四個角都有', center ? '中央有點' : '中央沒有可用的點', minPair < 10 ? `有兩點只隔 ${minPair.toFixed(1)} m，太擠` : ''].filter(Boolean).join('；'),
      delta: Math.round(distPts),
    });
    // 點位選擇
    const bad = this.gcps.map(g => ({ g, iss: this.issues(g) })).filter(x => x.iss.length);
    rows.push({
      label: '點位選擇',
      detail: n === 0 ? '—' : bad.length ? bad.map(x => `${x.g.name}${x.iss.join('、')}`).join('；') : `${n} 點都選在空曠的硬鋪面上`,
      delta: n === 0 ? 0 : Math.max(0, 7 - bad.length * 2),
    });
    // 標誌品質
    if (n) {
      const avg = this.gcps.reduce((s, g) => s + g.res.paintScore, 0) / n;
      const nail = this.gcps.reduce((s, g) => s + Math.max(0, 1 - g.res.nailTilt / 5), 0) / n;
      const fingers = this.gcps.reduce((s, g) => s + g.res.fingers, 0);
      const over = this.gcps.filter(g => g.res.overflow > 0.06).map(g => g.name);
      const thin = this.gcps.filter(g => (g.res.whiteCov + g.res.blackCov) / 2 < 0.75).map(g => g.name);
      const bent = this.gcps.reduce((s, g) => s + g.res.nailsUsed - 1, 0);
      const pts = Math.round(Math.max(0, Math.min(8, avg / 100 * 5.5 + nail * 2.5)));
      rows.push({
        label: '標誌品質',
        detail: [`噴漆平均 ${Math.round(avg)} 分`, ...this.gcps.filter(g => g.notes.length).map(g => `${g.name}${g.notes.join('、')}`), thin.length ? `${thin.join('、')}噴得不夠滿` : '', over.length ? `${over.join('、')}漆噴出框外` : '', `鋼釘平均傾斜 ${(this.gcps.reduce((s, g) => s + g.res.nailTilt, 0) / n).toFixed(1)}°`, bent ? `敲歪換釘 ${bent} 次` : '', fingers ? `敲到手指 ${fingers} 次` : ''].filter(Boolean).join('；'),
        delta: pts,
      });
    } else rows.push({ label: '標誌品質', detail: '—', delta: 0 });
    // RTK
    if (n) {
      const noRtk = this.gcps.filter(g => !g.rtk).map(g => g.name);
      const flt = this.gcps.filter(g => g.rtk && g.rtk.sol === 'float').map(g => g.name);
      const ff = this.gcps.filter(g => g.rtk && g.rtk.falseFix).map(g => g.name);
      const tilt = this.gcps.filter(g => g.rtk && g.rtk.tiltMm > 15).map(g => `${g.name}（桿子歪 ${Math.round(g.rtk!.tiltMm)} mm）`);
      const good = this.gcps.filter(g => g.rtk && g.rtk.sol === 'fix' && !g.rtk.falseFix && g.rtk.tiltMm <= 15).length;
      rows.push({
        label: 'RTK 坐標',
        detail: [noRtk.length ? `${noRtk.join('、')}沒測坐標（航拍等於白佈）` : '', flt.length ? `${flt.join('、')}用浮動解交差` : '', ff.length ? `${ff.join('、')}手簿顯示固定，平差後殘差十幾公分（假固定）` : '', tilt.length ? tilt.join('、') : '', good === n ? `${n} 點都是固定解` : ''].filter(Boolean).join('；'),
        delta: Math.round(6 * good / Math.max(n, 4)),
      });
      // 照片
      const pc = this.gcps.map(g => ({ g, c: !!g.photos.close, w: g.photos.wide.filter(x => x.ref).length, wn: g.photos.wide.length }));
      const lack = pc.filter(x => !x.c || x.w < 2);
      rows.push({
        label: '點位照片',
        detail: lack.length ? lack.map(x => `${x.g.name}${!x.c ? '缺近照' : ''}${x.wn < 2 ? `${!x.c ? '、' : ''}遠照 ${x.wn}/2` : x.w < 2 ? `${!x.c ? '、' : ''}遠照沒拍到參考地物` : ''}`).join('；') : '每點近照 1、遠照 2，都有參考地物',
        delta: Math.round(3 * pc.filter(x => x.c && x.w >= 2).length / Math.max(n, 4)),
      });
    }
    // 航拍
    const L = this.uav.log;
    if (this.uav.stage === 'done' || (this.uav.stage === 'none' && L.photos > 0)) {
      const a = this.aero();
      const safe = 3 - (L.compassOk === false ? 1 : 0) - (L.eagle === 'hit' ? 1 : 0) - (L.landSpeed > 2.2 ? 1 : 0) - (L.landDist > 2 ? 1 : 0) - (L.cover < 0.995 ? 1 : 0);
      rows.push({
        label: '航拍飛行',
        detail: [`前後重疊 ${Math.round(L.fwd * 100)}%、側向重疊 ${Math.round(Math.max(0, L.side) * 100)}%、範圍覆蓋 ${Math.round(L.cover * 100)}%`, L.compassOk === false ? '起飛點靠電線桿，指南針干擾差點撞到電線' : L.compassOk ? '指南針干擾，手動穩住' : '', L.eagle === 'hit' ? '被大冠鷲撞到，幾張照片糊掉' : L.eagle === 'dodged' ? '閃過大冠鷲' : '', L.landSpeed > 2.2 ? '降落太重' : '', L.cover < 0.995 ? '範圍沒拍滿' : '', `降落偏離起降墊 ${L.landDist.toFixed(1)} m`, `拍了 ${L.photos} 張`].filter(Boolean).join('；'),
        delta: Math.max(0, safe),
      });
      rows.push({
        label: '空三平差',
        detail: a.rmse === null ? a.note : `用了 ${a.used} 個控制點，RMSE ${a.rmse.toFixed(1)} cm（規範 ≤ 10 cm）${a.ok ? '，合格' : '，不合格'}${a.note ? `；${a.note}` : ''}`,
        delta: a.rmse === null ? 0 : a.rmse <= 5 ? 6 : a.rmse <= 10 ? 4 : a.rmse <= 15 ? 2 : 0,
      });
    } else rows.push({ label: '航拍', detail: '沒有飛', delta: 0 });
    return rows;
  }

  // ================================================================
  // 存讀檔 (盡量簡單：點位 + 結果 + 漆的畫布)
  // ================================================================
  prepareSave() {
    if (this.asst.state === 'goto') { const a = this.asst; a.g.position.set(a.tx!, this.sm.heightAt(a.tx!, a.tz!), a.tz!); a.state = 'idle'; const f = a.onArrive; a.onArrive = undefined; f?.(); }
  }
  snapshot(): AnyObj {
    return {
      asstName: asstName(), kit: [...this.kit], paint: this.paint, wind: this.wind, laid: this.laid, nails: this.nails.left, loadMode: this.loadMode, forgotAt: this.forgotAt, fetchBack: this.fetchBack,
      asst: { x: this.asst.g.position.x, z: this.asst.g.position.z, state: this.asst.state, visible: this.asst.g.visible },
      gcps: this.gcps.map(g => ({ name: g.name, spot: g.spot, res: g.res, img: g.canvas.toDataURL('image/png'), rtk: g.rtk || null, photos: g.photos, notes: g.notes, paw: !!g.paw, washed: !!g.washed, crushed: !!g.crushed, busRisk: !!g.busRisk, covered: !!g.covered, rtkStale: !!g.rtkStale, shifted: !!g.shifted, seenClear: !!g.seenClear, hiddenWhy: g.hiddenWhy || '' })),
      ev: this.ev.snapshot(),
      uav: this.uav.snapshot(),
    };
  }
  restore(s: AnyObj) {
    if (s.asstName) setAsstName(s.asstName);
    this.kit = new Set(s.kit || []);
    this.showKit();
    if (s.paint) this.paint = s.paint;
    if (s.wind) this.wind = s.wind;
    if (typeof s.nails === 'number') this.nails = { left: s.nails };
    this.loadMode = s.loadMode || ''; this.forgotAt = s.forgotAt || null; this.fetchBack = !!s.fetchBack;
    this.laid = !!s.laid;
    this.ev.restore(s.ev);
    this.uav.restore(s.uav);
    (s.gcps || []).forEach((g: AnyObj) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const img = new Image();
      img.onload = () => { c.getContext('2d')!.drawImage(img, 0, 0); const m = this.gcps.find(x => x.name === g.name); if (m) m.obj.traverse(o => { const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (mm?.map) mm.map.needsUpdate = true; }); };
      img.src = g.img;
      this.addGcp(g.name, g.spot, { ...g.res, canvas: c }, true);
      const m = this.gcps[this.gcps.length - 1];
      if (g.rtk) m.rtk = g.rtk;
      if (g.photos) m.photos = g.photos;
      Object.assign(m, { notes: g.notes || [], paw: !!g.paw, washed: !!g.washed, crushed: !!g.crushed, busRisk: !!g.busRisk, covered: !!g.covered, rtkStale: !!g.rtkStale, shifted: !!g.shifted, seenClear: !!g.seenClear, hiddenWhy: g.hiddenWhy || undefined, t: -999 });
    });
    if (s.asst) {
      this.asst.g.position.set(s.asst.x, this.sm.heightAt(s.asst.x, s.asst.z), s.asst.z);
      this.asst.g.visible = !!s.asst.visible;
      this.asst.state = s.asst.state === 'goto' || s.asst.state === 'work' ? 'follow' : s.asst.state;
    }
  }

  // ================================================================
  // 測試工具
  // ================================================================
  /** 在指定位置直接做出一個標 (quality 0~1) */
  debugPlace(x: number, z: number, quality = 1): string {
    const spot = this.analyze(x, z);
    if (!spot.ok) return spot.why!;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const px = (m: number) => (m / 1.8 + 0.5) * 256;
    const a = 0.55 + 0.45 * quality;
    g.fillStyle = `rgba(244,244,238,${a})`; g.fillRect(px(-0.6), px(-0.6), px(0.6) - px(-0.6), px(0.6) - px(-0.6));
    g.fillStyle = `rgba(22,23,26,${a})`; g.fillRect(px(0), px(0), px(0.6) - px(0), px(0.6) - px(0)); g.fillRect(px(-0.6), px(-0.6), px(0) - px(-0.6), px(0) - px(-0.6));
    const name = `GCP-0${this.nextNo}`;
    this.addGcp(name, spot, { rot: 0, whiteCov: quality, blackCov: quality, overflow: 0, contrast: 0.7 * quality, paintScore: Math.round(quality * 95), nailTilt: (1 - quality) * 4, nailHits: 4, nailsUsed: 1, fingers: 0, loose: spot.soil > 0.5, canvas: c });
    return `${name}：${SURF_NAME[spot.surf]}${this.issues(this.gcps[this.gcps.length - 1]).length ? '（' + this.issues(this.gcps[this.gcps.length - 1]).join('、') + '）' : ''}`;
  }
  /** 一鍵佈好：good = 四角＋中央的好位置；bad = 全踩坑 */
  debugAuto(kind: 'good' | 'bad') {
    const good: [number, number][] = [[-24, 59.15], [30, 59.15], [-28, 103], [28, 102.5], [-5.5, 85]];
    const bad: [number, number][] = [[8, 70], [1.2, 88.4], [-20, 75], [25, 75], [15, 105]];
    const list = kind === 'good' ? good : bad;
    const out: string[] = [];
    for (const [lx, lz] of list) { if (this.gcps.length >= MAX_GCP) break; const w = toWorld(lx, lz); out.push(this.debugPlace(w.x, w.z, kind === 'good' ? 1 : 0.7)); }
    return out.join('\n');
  }
  debugQuick() {
    if (gcpBench.active) { gcpBench.quick(1); return '這個標直接完成。'; }
    if (rtkBench.active) { rtkBench.quick(); return 'RTK 直接記錄完成（照現場收訊）。'; }
    return '要在佈標或 RTK 畫面裡才能用。';
  }
  /** 每個點都補上 RTK (照現場收訊決定固定或浮動) 和三張照片 */
  debugRtkPhotos() {
    this.gcps.forEach(g => {
      const e = g.spot;
      g.rtk = e.canopy ? { sol: 'float', h: 25, v: 40, tiltMm: 4, falseFix: false, wait: 30 } : { sol: 'fix', h: e.bld.d < 4 ? 2.4 : 0.9, v: 1.8, tiltMm: 4, falseFix: false, wait: 10 };
      g.photos = { close: 'x', wide: [{ img: 'x', ref: '土地公廟' }, { img: 'x', ref: '大榕樹' }] };
    });
    this.refreshHint();
    return `${this.gcps.length} 點都補上 RTK 和照片。`;
  }
  debugFinish() { if (this.gcps.length) this.finishLaying(); }
  debugFly() {
    if (!this.laid) this.finishLaying();
    if (!this.uav.home) { const w = toWorld(9.5, 54.5); this.uav.setHome(w.x, w.z); }
    return this.uav.debugComplete();
  }
}
