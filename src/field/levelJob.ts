/**
 * 第二天：縣道路肩一等水準 (BM-1035 → BM-1036)
 *
 * 電子水準儀 + 條碼尺 (自動讀數)。
 * 第一站玩家操作儀器：架腳架 → 裝水準儀 → 定平 → 量後視 → 指定前視點 (學弟帶尺過去) → 量前視
 * 之後學弟想操作儀器，兩人交換：學弟架站、定平、量測；玩家當扶尺員——
 *   扶直標尺 (WASD 把尺上的圓氣泡壓在圈內)、自己走到前面選前視點 (前後視距要差不多)、轉點放尺墊。
 * 前視點是 BM-1036 時路線結束，手簿自動算閉合差。
 *
 * 現場事件：阿伯回訪 (依第一天的回答)、阿黃回訪、機車停在視線上、標尺沒扶直、轉點沒放尺墊 (標尺下陷)
 */
import * as THREE from 'three';
import type { FieldDay } from './fieldDay';
import { SM, type AnyObj } from './legacy';
import { LEVEL_ROUTE, loadProgress, type Progress, asstName, setAsstName, pickAsstName } from './jobs';
import { buildLevelStaff, buildTurningPlate, PLATE_TOP } from './levelStaff';
import { buildPerson, animateWalk, buildDog, animateDog, buildScooter, buildLorry, ROAD_Z } from './npc';
import { levelScope } from './scope';
import { bench } from './bench';
import { playBossIntro, setThreat } from './cine';
import { dust, phonePhoto, GroundRing, Rumble } from './fx';
import { PoliceCar } from './police';
import { runQTE, qteActive } from './qte';
import type { Circle } from './truck';
import type { ReportRow } from './ui';
import * as ui from './ui';
import * as sfx from './sfx';
import { ITEMS, type ItemId } from './items';
import { buildItemModel } from './itemModels';
import { bark } from './sound';
import { tell, whatIf } from './story';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

interface Pt { name: string; x: number; z: number; kind: 'bm' | 'tp'; plate: THREE.Object3D | null; sink: number; top: number }
interface Obs { pt: Pt; read?: number; truth?: number; dist: number; tilted?: boolean }
interface Station { x: number; z: number; back: Obs; fore?: Obs }

type InstState = 'none' | 'tripod' | 'mounted' | 'leveled';
type ActorKind = 'asst' | 'uncle' | 'rider' | 'dog' | 'police' | 'kid';
interface Actor { kind: ActorKind; g: THREE.Group; state: string; t: number; tx?: number; tz?: number; speed?: number; onArrive?: () => void; cd?: number }

/** 已知高程 (一等水準點成果表，遊戲用) */
const H1 = 31.2045;
/** 學弟喊「要讀囉」到真正開始讀的準備時間 (秒) */
const READ_PREP = 1.2;

export class LevelJob {
  private sm: AnyObj;
  private bms: { obj: THREE.Group; pt: Pt }[] = [];
  private staff: THREE.Group;
  private asst!: Actor;
  private actors: Actor[] = [];

  // 進度
  haveStaff = false;
  havePlate = false;
  private stations: Station[] = [];
  private inst: THREE.Group | null = null;
  private instState: InstState = 'none';
  carrySet = false;
  private rodAt: Pt | null = null;      // 尺目前立在哪
  private rodTilt = 0;                  // 側傾 (rad)
  private tiltPlanned = -1;             // 哪一次讀數會遇到尺沒扶直
  private readCount = 0;
  private focus = 6;
  private finished = false;
  private lv = this.newLeveler();
  private tps: Pt[] = [];
  private notes: string[] = [];
  private pr: Progress = loadProgress();

  // 交換角色後：學弟操作儀器、玩家扶尺
  swapped = false;
  private plPlates = false;             // 尺墊在玩家身上
  private aJob = '';                    // 學弟的工作狀態
  private aT = 0;
  private remindT = 0;
  private hold: { pt: Pt; bx: number; by: number; vx: number; vy: number; sum: number; n: number; el: HTMLElement } | null = null;
  private holdLog: number[] = [];       // 每次讀數時的平均傾斜 (0~1)
  private arrows: THREE.Object3D[] = [];

  // 事件
  private uncleDone = false;
  private dogDone = false;
  private scooterDone = false;
  private waitingPlate: Pt | null = null;
  private blocker: Actor | null = null;
  private time = 0;

  // 提示圈：建議架站位置 (藍)、轉點 (綠)、擋狗站位 (黃)
  private stRing!: GroundRing;
  private tpRing!: GroundRing;
  private guard!: GroundRing;
  /** 被騎士擋住、扛起儀器換位置中：建議的新位置 */
  private reloc: { x: number; z: number } | null = null;
  /** 學弟扛著腳架 + 水準儀箱 (交換後搬站時顯示) */
  private carryVis!: THREE.Group;
  /** 收工：學弟扛儀器回車上 */
  private carryHome = false;

  // 交通錐 / 警察
  private cones: { x: number; z: number; borrowed: boolean; valid: boolean } | null = null;
  private coneObj: THREE.Group | null = null;
  /** 被警察要求：擺好交通錐之前不能作業 */
  private coneBlock = false;
  private copNag = 0;
  private policeStage: '' | 'wait' | 'come' | 'done' = '';
  private policeT = -1;
  private pcar: PoliceCar | null = null;
  // 大車經過 (地面震動)
  private truckDone = false;
  private lorry: THREE.Group | null = null;
  private rumble = new Rumble();
  private vibe = 0;
  // 學弟出包：尺立在標石旁邊的地上
  private wrongPlanned = false;
  /** 跨天：阿伯回訪的回應、帶學弟的分數 */
  uncle2: '' | 'a' | 'b' = '';
  private mentor = 0;
  private wrongDone = false;
  private rodWrong = false;
  /** 主角已經跳過「怪怪的」OS */
  private wrongOs = false;
  // 小朋友回訪
  private kidsDone = false;

  constructor(private fd: FieldDay) {
    this.sm = fd.app.sceneManager;
    const S = SM();
    [LEVEL_ROUTE.bm1, LEVEL_ROUTE.bm2].forEach(b => {
      const g = new THREE.Group();
      S.buildMonument(g, `${b.name} (一等水準點)`);
      const y = this.sm.heightAt(b.x, b.z);
      g.position.set(b.x, y, b.z);
      g.userData = { type: 'monument', label: `${b.name} (一等水準點)` };
      this.sm.scene.add(g);
      this.sm.addPavement?.(g, 1.6);
      this.bms.push({ obj: g, pt: { name: b.name, x: b.x, z: b.z, kind: 'bm', plate: null, sink: 0, top: y + 0.28 } });
    });
    this.staff = buildLevelStaff();
    this.staff.visible = false;
    this.sm.scene.add(this.staff);
    this.asst = this.spawn('asst', -146, 62);
    this.asst.g.visible = false;
    const h = (x: number, z: number) => this.sm.heightAt(x, z);
    this.stRing = new GroundRing(this.sm.scene, h, 0x4fc3f7, 0.8);
    this.tpRing = new GroundRing(this.sm.scene, h, 0x66d17a, 0.7);
    this.guard = new GroundRing(this.sm.scene, h, 0xffc83d, 0.9);
    this.carryVis = this.buildCarry();
    this.asst.g.add(this.carryVis);
  }

  /** 學弟搬站時身上的東西：腳架扛在右肩、左手提水準儀箱 */
  private buildCarry(): THREE.Group {
    const S = SM();
    const g = new THREE.Group();
    // 收起來的腳架 (三支腳併攏)，扛在右肩：腳尖朝前上方、架頭在後
    const tri = buildItemModel('tripod');
    tri.scale.setScalar(1.35);
    tri.position.set(-0.12, -0.14, 0);
    const pivot = new THREE.Group();
    pivot.add(tri);
    pivot.position.set(0.0, 1.5, 0.32);        // 右肩外側
    pivot.rotation.z = 0.32;
    g.add(pivot);
    const box = new THREE.Group();
    box.add(S.mk(S.rbox(0.36, 0.26, 0.18, 0.03), new THREE.MeshStandardMaterial({ color: 0xf57c00, roughness: 0.5 }), 0, 0, 0));
    box.add(S.mk(new THREE.BoxGeometry(0.14, 0.04, 0.03), S.M.black, 0, 0.15, 0));
    box.position.set(0.02, 0.66, -0.34);       // 左手提著
    g.add(box);
    const book = S.mk(new THREE.BoxGeometry(0.2, 0.26, 0.04), new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.8 }), 0.06, 1.12, -0.24);
    book.name = 'book';                        // 手簿夾在左腋下 (收工時)
    g.add(book);
    g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
    g.visible = false;
    return g;
  }

  /** 第一站建議位置：離 BM-1035 約 14.5 m，旁邊就是第一個轉點，第二站剛好看到 BM-1036 */
  private get s1() { return { x: this.bm1.x + (this.bm2.x - this.bm1.x) / 4, z: this.bm1.z + 0.6 }; }
  /** 轉點建議位置：跟後視點對稱 (前後視距相等) */
  private tpSuggest(): { x: number; z: number } | null {
    const st = this.cur;
    if (!st || !this.inst) return null;
    const x = Math.min(this.bm2.x - 12, 2 * this.inst.position.x - st.back.pt.x);
    return { x, z: this.bm1.z };
  }

  private updateRings() {
    const fd = this.fd;
    const p = fd.app.player.position;
    const active = ['site', 'observe'].includes(fd.phase) && !this.finished && !this.swapped;
    // 架站位置
    const placing = fd.carrying === 'tripod' && (this.carrySet || this.instState === 'none');
    if (active && ((this.stations.length === 0 && !this.reloc && (this.haveStaff || placing)) || (this.reloc && placing))) {
      const q = this.reloc || this.s1;
      if (!this.stRing.visible || this.stRing.x !== q.x || this.stRing.z !== q.z) this.stRing.show(q.x, q.z, this.reloc ? '換到這裡架站' : '建議架站位置', '#9fe3ff');
      this.stRing.update(this.time, this.stRing.contains(p.x, p.z, 1.5));
    } else this.stRing.hide();
    // 轉點
    const st = this.cur;
    const tp = active && st && this.instState === 'leveled' && st.back.read !== undefined && !st.fore ? this.tpSuggest() : null;
    if (tp) { if (!this.tpRing.visible || this.tpRing.x !== tp.x) this.tpRing.show(tp.x, tp.z, '轉點 TP1（前視）', '#b6f5c0'); this.tpRing.update(this.time); } else this.tpRing.hide();
    // 交通錐擺放位置 (拿著交通錐時才顯示)
    // 學弟搬站
    this.carryVis.visible = (this.swapped && this.aJob === 'toStation' && this.asst.state === 'goto') || this.carryHome;
    const book = this.carryVis.getObjectByName('book');
    if (book) book.visible = this.carryHome;
    if (this.carryVis.visible) this.asst.g.userData.pose = 'carryShoulder';
    else if (this.asst.g.userData.pose === 'carryShoulder') this.asst.g.userData.pose = undefined;
  }

  // ================================================================
  // 存檔 / 讀檔
  // ================================================================
  /** 存檔前：結束扶尺、讓正在走路的人直接走到目的地 (走路途中的後續動作沒辦法寫進檔案) */
  prepareSave() {
    this.endHold();
    for (let i = 0; i < 8; i++) {
      const a = this.actors.find(x => x.state === 'goto');
      if (!a) break;
      a.g.position.set(a.tx!, this.sm.heightAt(a.tx!, a.tz!), a.tz!);
      a.state = 'idle';
      const f = a.onArrive; a.onArrive = undefined;
      f?.();
    }
  }

  snapshot(): AnyObj {
    const ref = (p: Pt | null | undefined) => (p ? p.name : null);
    const obs = (o?: Obs) => (o ? { pt: o.pt.name, read: o.read ?? null, truth: o.truth ?? null, dist: o.dist, tilted: !!o.tilted } : null);
    const head = this.inst?.userData.head as THREE.Object3D | undefined;
    const job = this.aJob === 'readBack' ? 'waitBack' : this.aJob === 'readFore' ? 'waitFore' : this.aJob;
    return {
      haveStaff: this.haveStaff, havePlate: this.havePlate, plPlates: this.plPlates, swapped: this.swapped, carrySet: this.carrySet,
      readCount: this.readCount, tiltPlanned: this.tiltPlanned, focus: this.focus, finished: this.finished, bookOut: this.bookOut,
      notes: this.notes, holdLog: this.holdLog, uncleDone: this.uncleDone, dogDone: this.dogDone, scooterDone: this.scooterDone,
      aJob: job, aT: this.aT, rodTilt: this.rodTilt, reloc: this.reloc, asstName: asstName(), asstLoaded: this.asstLoaded || this.asstLoading,
      cones: this.cones, coneBlock: this.coneBlock, policeStage: this.policeStage === 'come' ? 'wait' : this.policeStage,
      truckDone: this.truckDone, wrongPlanned: this.wrongPlanned, wrongDone: this.wrongDone, rodWrong: this.rodWrong, wrongOs: this.wrongOs, caughtWrong: this.caughtWrong, kidsDone: this.kidsDone, uncle2: this.uncle2, mentor: this.mentor,
      tps: this.tps.map(t => ({ name: t.name, x: t.x, z: t.z, plate: !!t.plate, sink: t.sink })),
      rodAt: ref(this.rodAt), waitingPlate: ref(this.waitingPlate),
      stations: this.stations.map(st => ({ x: st.x, z: st.z, back: obs(st.back), fore: obs(st.fore) })),
      inst: this.inst ? {
        x: this.inst.position.x, z: this.inst.position.z, state: this.instState, yaw: head ? head.rotation.y : 0,
        lv: { screwA: this.lv.screwA, screwB: this.lv.screwB, screwC: this.lv.screwC, bx0: this.lv.bx0, by0: this.lv.by0 },
      } : null,
      asst: { x: this.asst.g.position.x, z: this.asst.g.position.z, state: this.asst.state, visible: this.asst.g.visible },
      actors: this.actors.filter(a => a !== this.asst && a.state !== 'leave').map(a => ({ kind: a.kind, x: a.g.position.x, z: a.g.position.z, state: a.state, stubborn: !!(a.g.userData as AnyObj).stubborn })),
    };
  }

  restore(s: AnyObj) {
    this.reset();
    setAsstName(s.asstName);
    ['haveStaff', 'havePlate', 'plPlates', 'swapped', 'carrySet', 'readCount', 'tiltPlanned', 'focus', 'finished', 'bookOut', 'notes', 'holdLog', 'uncleDone', 'dogDone', 'scooterDone', 'aJob', 'aT', 'rodTilt', 'reloc', 'coneBlock', 'policeStage', 'truckDone', 'wrongPlanned', 'wrongDone', 'rodWrong', 'wrongOs', 'caughtWrong', 'kidsDone', 'asstLoaded', 'uncle2', 'mentor']
      .forEach(k => { if (s[k] !== undefined) (this as AnyObj)[k] = s[k]; });
    if (s.cones) this.placeCones(s.cones.x, s.cones.z ?? ROAD_Z + 3.3, !!s.cones.borrowed);
    if (this.policeStage === 'wait') this.policeT = 5;
    this.tps = (s.tps || []).map((t: AnyObj) => {
      const pt: Pt = { name: t.name, x: t.x, z: t.z, kind: 'tp', plate: null, sink: t.sink || 0, top: 0 };
      if (t.plate) this.putPlate(pt);
      return pt;
    });
    const find = (n: string | null): Pt | null => (!n ? null : n === this.bm1.name ? this.bm1 : n === this.bm2.name ? this.bm2 : this.tps.find(t => t.name === n) || null);
    const obs = (o: AnyObj | null): Obs | undefined => (o && find(o.pt) ? { pt: find(o.pt)!, read: o.read ?? undefined, truth: o.truth ?? undefined, dist: o.dist, tilted: o.tilted } : undefined);
    this.stations = (s.stations || []).map((st: AnyObj) => ({ x: st.x, z: st.z, back: obs(st.back)!, fore: obs(st.fore) }));
    this.rodAt = find(s.rodAt);
    this.waitingPlate = find(s.waitingPlate);
    if (s.inst) {
      this.placeInst(s.inst.x, s.inst.z, s.inst.state !== 'tripod');
      this.instState = s.inst.state;
      Object.assign(this.lv, s.inst.lv || {});
      this.lv.recalculateTribrachPhysics();
      (this.inst!.userData.head as THREE.Object3D).rotation.y = s.inst.yaw || 0;
    }
    // 學弟
    const a = this.asst;
    if (s.asst) {
      a.g.position.set(s.asst.x, this.sm.heightAt(s.asst.x, s.asst.z), s.asst.z);
      a.state = ['goto', 'talking'].includes(s.asst.state) ? 'idle' : s.asst.state;
      a.g.visible = s.asst.visible !== false && a.state !== 'hidden';
      if (a.state === 'hold') this.placeAsstAtRod();
    }
    if (this.swapped && this.rodAt) this.ensureInteractive(this.staff, true);
    // 其他人
    (s.actors || []).forEach((o: AnyObj) => {
      if (o.kind === 'police') return; // 警察：讀檔後重新開過來
      const b = this.spawn(o.kind, o.x, o.z);
      if (o.kind === 'kid' && ['intro', 'qte'].includes(o.state)) o.state = 'kidRush';
      if (o.kind === 'kid' && o.state === 'listen') o.state = 'kidLeave';
      const map: Record<string, string> = { talking: 'seek', photo: 'leave', intro: 'rush', goto: 'seek', stopped: 'leave', wait: 'seek' };
      b.state = map[o.state] || o.state;
      if (o.stubborn) (b.g.userData as AnyObj).stubborn = true;
      if (b.state === 'block') {
        this.blocker = b;
        if (b.kind === 'rider') {
          const sc = buildScooter();
          sc.position.set(o.x + 0.6, this.sm.heightAt(o.x + 0.6, o.z + 0.15), o.z + 0.15);
          if (sc.userData.rider) sc.userData.rider.visible = false;
          this.sm.scene.add(sc);
          (b.g.userData as AnyObj).scooter = sc;
        }
      }
    });
    this.book(this.stations, this.finished);
    // 存檔當下還在等待中的事件
    const st = this.cur;
    if (!this.uncleDone && this.stations.length >= 1) setTimeout(() => this.spawnUncle(), 9000);
    if (!this.swapped && this.stations.length === 1 && st?.fore?.read !== undefined) setTimeout(() => this.offerSwap(), 1500);
    if (!this.swapped && this.stations.length === 1 && this.instState === 'leveled' && !this.scooterDone) setTimeout(() => this.spawnScooter(), 1500);
    if (this.swapped) this.swapHint(); else this.nextHint();
  }

  /** 更新手簿面板提示 (讀檔後用) */
  refreshHint() { if (this.swapped) this.swapHint(); else this.nextHint(); }

  get bm1() { return this.bms[0].pt; }
  get bm2() { return this.bms[1].pt; }
  private get cur(): Station | undefined { return this.stations[this.stations.length - 1]; }

  // ================================================================
  // 生命週期
  // ================================================================
  reset() {
    this.actors.filter(a => a !== this.asst).forEach(a => this.sm.scene.remove(a.g));
    this.actors = this.asst ? [this.asst] : [];
    this.haveStaff = this.havePlate = false;
    this.stations = [];
    this.removeInst();
    this.carrySet = false;
    this.rodAt = null; this.rodTilt = 0;
    this.readCount = 0;
    this.bookOut = false;
    this.tiltPlanned = Math.random() < 0.5 ? 1 : 2;
    this.finished = false;
    this.tps.forEach(t => t.plate && this.sm.scene.remove(t.plate));
    this.tps = [];
    this.notes = [];
    this.uncleDone = this.dogDone = this.scooterDone = false;
    this.swapped = false; this.plPlates = false; this.aJob = ''; this.aT = 0;
    this.endHold();
    this.holdLog = [];
    this.clearArrows();
    this.ensureInteractive(this.staff, false);
    this.waitingPlate = null;
    this.blocker = null;
    this.reloc = null;
    this.stRing?.hide(); this.tpRing?.hide(); this.guard?.hide();
    if (this.coneObj) { this.sm.scene.remove(this.coneObj); this.ensureInteractive(this.coneObj, false); }
    this.coneObj = null; this.cones = null; this.coneBlock = false; this.copNag = 0;
    this.policeStage = ''; this.policeT = -1; this.pcar?.dispose(); this.pcar = null;
    this.truckDone = false; if (this.lorry) this.sm.scene.remove(this.lorry); this.lorry = null; this.rumble?.stop(); this.vibe = 0;
    this.wrongPlanned = Math.random() < 0.7; this.wrongDone = false; this.rodWrong = false; this.wrongOs = false;
    this.kidsDone = false;
    this.uncle2 = ''; this.mentor = 0;
    this.carryHome = false;
    this.asstLoading = false; this.asstLoaded = false; if (this.asst) this.setHandVis(null);
    pickAsstName();
    if (this.carryVis) this.carryVis.visible = false;
    this.pr = loadProgress();
    this.staff.visible = false;
    if (this.staff.parent !== this.sm.scene) this.sm.scene.add(this.staff);
    if (this.asst) {
      const job = this.fd.job === 'level';
      this.asst.g.visible = job;
      this.asst.g.position.set(-146.5, this.sm.heightAt(-146.5, 61.5), 61.5);
      this.asst.state = 'yard';
      this.ensureInteractive(this.asst.g, job);
    }
    setThreat(this.fd.app, []);
    this.book(null);
  }

  private clearArrows() {
    const sm = this.sm;
    this.arrows.forEach(a => {
      sm.scene.remove(a);
      [sm.dynamicArrows, sm.floatingArrows].forEach((arr: THREE.Object3D[]) => { const i = arr.indexOf(a); if (i > -1) arr.splice(i, 1); });
    });
    this.arrows = [];
  }

  /** HUD：到 BM-1036 還有多遠 */
  destText(): string | null {
    if (this.fd.job !== 'level' || !['site', 'observe'].includes(this.fd.phase)) return null;
    const p = this.fd.app.player.position;
    const d = Math.hypot(this.bm2.x - p.x, this.bm2.z - p.z);
    return `BM-1036 ${Math.round(d)} m${this.bm2.x > p.x + 2 ? '（往東）' : this.bm2.x < p.x - 2 ? '（往西）' : ''}`;
  }

  private ensureInteractive(o: THREE.Object3D, on: boolean) {
    const list = this.sm.interactiveObjects as THREE.Object3D[];
    const i = list.indexOf(o);
    if (on && i < 0) list.push(o);
    if (!on && i > -1) list.splice(i, 1);
  }

  /** 抵達現場 */
  startSite(silent = false) {
    this.bms.forEach(b => this.ensureInteractive(b.obj, true));
    this.sm.setVisibleFloatingPoints?.([]);
    if (!silent) ui.toast(`到了。標尺和尺墊從後斗拿出來交給學弟${asstName()}（對著他按 E）。`, 'info', 4500);
    this.clearArrows();
    [[this.bm1, '起點 BM-1035', 0x2e7d4f], [this.bm2, '終點 BM-1036', 0xd62828]].forEach(([pt, label, col]) => {
      const p = pt as Pt;
      const a = this.sm.createFloatingHintArrow(p.x, p.z, label as string, col as number, true);
      a.position.y = this.sm.heightAt(p.x, p.z);
      a.visible = true;
      this.arrows.push(a);
    });
    this.book(this.stations);
  }

  onEnterTruck() {
    if (this.asstLoading) { this.asstLoading = false; this.setHandVis(null); }
    if (this.asst.state !== 'hidden') { this.asst.state = 'hidden'; this.asst.g.visible = false; }
    this.staff.visible = false;
  }

  onExitTruck() {
    if (this.fd.job !== 'level') return;
    const t = this.fd.truck;
    // 從副駕駛 (車身右側 = 本地 +Z) 下車，往外站一步等候
    const p = t.toWorld(0.3, 0, 2.15);
    this.asst.g.position.set(p.x, this.sm.heightAt(p.x, p.z), p.z);
    this.asst.g.visible = true;
    this.asst.state = this.rodAt ? 'hold' : 'idle';
    if (this.rodAt) this.placeAsstAtRod();
    this.refreshStaff();
  }

  // ================================================================
  // 每幀
  // ================================================================
  update(dt: number) {
    if (this.fd.job !== 'level') return;
    this.time += dt;
    const p = this.fd.app.player.position;
    for (const a of [...this.actors]) {
      a.t += dt;
      this.stepActor(a, dt, p);
    }
    if (this.swapped) this.asstTick(dt);
    this.holdTick(dt);
    this.refreshStaff();
    this.updateRings();
    this.policeTick(dt, p);
    // 走到學弟附近，看到尺立的位置不太對
    if (this.rodWrong && !this.wrongOs && this.rodAt === this.bm1 && Math.hypot(p.x - this.bm1.x, p.z - this.bm1.z) < 7) this.wrongHint(0);
    this.lorryTick(dt, p);
    const threats: { obj: THREE.Object3D; h: number; who: string; dist: number; target?: string }[] = this.actors.filter(a => a.kind === 'dog' && a.state === 'rush' && this.inst).map(a => ({ obj: a.g, h: 0.9, who: '阿黃', dist: Math.hypot(a.g.position.x - this.inst!.position.x, a.g.position.z - this.inst!.position.z), target: '儀器' }));
    const tp = this.kidTarget();
    if (tp) this.actors.filter(a => a.kind === 'kid' && a.state === 'kidRush').forEach(a => threats.push({ obj: a.g, h: 1.4, who: '小朋友', dist: Math.hypot(a.g.position.x - tp.x, a.g.position.z - tp.z), target: '尺墊' }));
    setThreat(this.fd.app, threats);
  }

  // ---------------------------------------------------------------- 角色
  private spawn(kind: ActorKind, x: number, z: number): Actor {
    let g: THREE.Group;
    if (kind === 'asst') g = buildPerson({ shirt: 0x1e88e5, pants: 0x37474f, hat: 'cap', skin: 0xd4a07a });
    else if (kind === 'uncle') g = buildPerson({ shirt: 0x7cb342, pants: 0x5d4037, hat: 'straw', skin: 0xb07850 });
    else if (kind === 'rider') g = buildPerson({ shirt: 0x1565c0, pants: 0x263238, hat: 'helmet', skin: 0xc68a5e }); // 跟機車上的騎士同一套衣服
    else if (kind === 'police') g = buildPerson({ shirt: 0x9cc3e6, pants: 0x1a2a4a, hat: 'police', skin: 0xc68a5e });
    else if (kind === 'kid') { g = buildPerson({ shirt: 0xfbc02d, pants: 0x1e3a5f, hat: 'cap' }); g.scale.setScalar(0.66); }
    else g = buildDog();
    g.position.set(x, this.sm.heightAt(x, z), z);
    g.userData.type = 'npc';
    g.userData.npc = kind;
    this.sm.scene.add(g);
    const a: Actor = { kind, g, state: 'idle', t: 0 };
    this.actors.push(a);
    if (kind !== 'asst') this.ensureInteractive(g, true);
    return a;
  }

  private removeActor(a: Actor) {
    this.sm.scene.remove(a.g);
    this.ensureInteractive(a.g, false);
    this.actors = this.actors.filter(x => x !== a);
    if (this.blocker === a) this.blocker = null;
  }

  private walk(a: Actor, tx: number, tz: number, speed: number, dt: number): boolean {
    const g = a.g;
    const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
    const anim = a.kind === 'dog' ? animateDog : animateWalk;
    if (d < 0.2) { anim(g, a.t, 0); return true; }
    const st = Math.min(d, speed * dt);
    g.position.x += dx / d * st; g.position.z += dz / d * st;
    this.avoidTruck(g.position, tx, tz, st);
    g.position.y = this.sm.heightAt(g.position.x, g.position.z);
    g.rotation.y = Math.atan2(-dz, dx);
    anim(g, a.t, speed / 1.5);
    return false;
  }

  /** NPC 不穿過作業車：推到車身外，正對車身時沿車邊繞到比較近的那一頭 */
  private avoidTruck(pos: THREE.Vector3, tx: number, tz: number, step: number) {
    const t = this.fd.truck;
    if (!t || this.fd.inTruck && this.asst.state === 'hidden') return;
    const hx = 2.85 + 0.35, hz = 1.15 + 0.35;
    const { lx, lz } = t.toLocalFlat(pos.x, pos.z);
    if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return;
    const tl = t.toLocalFlat(tx, tz);
    let nlx = lx, nlz = lz;
    if (hx - Math.abs(lx) < hz - Math.abs(lz)) {
      // 撞到車頭 / 車尾：往旁邊滑開繞過去 (往目標那一側，沒有就往路肩側)
      nlx = Math.sign(lx || 1) * hx;
      const side = Math.abs(tl.lz) > 0.3 ? Math.sign(tl.lz) : (Math.sign(lz) || 1);
      nlz = lz + side * step;
    } else {
      nlz = Math.sign(lz || 1) * hz;
      // 沿長邊往目標比較近的那一頭走
      const end = Math.abs(tl.lx) > 0.5 ? Math.sign(tl.lx) : Math.sign(lx || 1);
      nlx = lx + end * step;
    }
    const c = Math.cos(t.heading), sn = Math.sin(t.heading);
    pos.x = t.pos.x + nlx * c + nlz * sn;
    pos.z = t.pos.z - nlx * sn + nlz * c;
  }

  /** 給玩家碰撞用：學弟與現場路人 */
  bodies(): { x: number; z: number; r: number }[] {
    return this.actors.filter(a => a.g.visible && a.state !== 'hidden').map(a => ({ x: a.g.position.x, z: a.g.position.z, r: a.kind === 'dog' ? 0.3 : 0.35 }));
  }
  private face(a: Actor, x: number, z: number) {
    a.g.rotation.y = Math.atan2(-(z - a.g.position.z), x - a.g.position.x);
    (a.kind === 'dog' ? animateDog : animateWalk)(a.g, a.t, 0);
  }

  private goTo(a: Actor, x: number, z: number, speed: number, onArrive: () => void) {
    a.state = 'goto'; a.tx = x; a.tz = z; a.speed = speed; a.onArrive = onArrive;
  }

  private stepActor(a: Actor, dt: number, p: THREE.Vector3) {
    switch (a.state) {
      case 'goto':
        if (this.walk(a, a.tx!, a.tz!, a.speed!, dt)) { a.state = 'idle'; const f = a.onArrive; a.onArrive = undefined; f?.(); }
        return;
      case 'reportLoad': {
        // 搬完東西跑來問學長要不要檢查
        if (this.fd.phase !== 'prep' || this.fd.inTruck) { a.state = 'idle'; return; }
        const d = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z);
        if (d > 2.2) { this.walk(a, p.x, p.z, a.speed || 2.6, dt); return; }
        this.face(a, p.x, p.z);
        if (!this.fd.app.player.isModalOpen()) { a.state = 'talking'; this.askCheckTrunk(a); }
        return;
      }
      case 'seek': {
        // 跟著玩家走，走到身邊才開口 (玩家在車上就站著等)
        const d = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z);
        if (d < 2.3) { a.state = a.kind === 'police' ? 'pwait' : 'wait'; this.face(a, p.x, p.z); return; }
        if (this.fd.inTruck) { this.face(a, p.x, p.z); return; }
        this.walk(a, p.x, p.z, a.speed || 1.6, dt);
        return;
      }
      case 'follow': {
        const d = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z);
        if (d > 2.6) this.walk(a, p.x, p.z, d > 8 ? 3.2 : 1.6, dt);
        else this.face(a, p.x, p.z);
        return;
      }
      case 'hold':
        if (this.inst) this.face(a, this.inst.position.x, this.inst.position.z); else this.face(a, p.x, p.z);
        return;
      case 'wait':
        this.face(a, p.x, p.z);
        // 阿伯走到旁邊就自己開口
        if (a.kind === 'uncle' && !this.fd.app.player.isModalOpen() && !this.fd.inTruck) { a.state = 'talking'; this.talkUncle(a); }
        return;
      case 'yard':
      case 'idle':
        this.face(a, p.x, p.z);
        return;
      case 'rush': {
        if (!this.inst) { a.state = 'leave'; this.guard.hide(); return; }
        dust.trail(a.g, dt);
        const tx = this.inst.position.x + 0.7, tz = this.inst.position.z + 0.4;
        const g = this.guard;
        if (!g.visible) { const d = V(a.g.position.x - tx, 0, a.g.position.z - tz).normalize(); g.show(tx + d.x * 1.8, tz + d.z * 1.8, '站到這裡擋住阿黃！'); }
        a.cd = (a.cd ?? 0.3) - dt;
        if (a.cd <= 0) { a.cd = 1.1 + Math.random() * 0.9; bark(Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z), 2); }
        const inRing = !this.fd.inTruck && !this.hold && g.contains(p.x, p.z, 0.15);
        g.update(this.time, inRing);
        if (inRing && Math.hypot(a.g.position.x - g.x, a.g.position.z - g.z) < 2.6) {
          g.hide();
          sfx.thud();
          ui.toast('你擋在儀器前面，阿黃緊急煞車……搖搖尾巴跑走了。', 'good', 3000);
          bark(3, 1, true);
          this.fd.addPR(1, '擋在儀器前面攔住阿黃');
          a.state = 'stopped'; a.t = 0;
          return;
        }
        if (this.walk(a, tx, tz, 5.2, dt)) { g.hide(); this.dogBump(); a.state = 'leave'; a.t = 0; }
        return;
      }
      case 'stopped':
        this.face(a, p.x, p.z);
        if (a.t > 0.8) { a.state = 'leave'; a.t = 0; }
        return;
      // ---- 警察
      case 'pwait':
        this.face(a, p.x, p.z);
        if (!this.fd.app.player.isModalOpen() && !this.fd.inTruck) { a.state = 'talking'; this.talkPolice(a); }
        return;
      case 'pcones':
        this.face(a, p.x, p.z);
        if (this.cones?.valid) { ui.toast('警察：「好，這樣就對了。注意安全喔！」', 'good', 3000); this.policeGo(a); }
        return;
      // ---- 小朋友
      case 'kidRush':
      case 'kidFollow': {
        const tp = this.kidTarget();
        if (!tp) { a.state = 'kidLeave'; return; }
        a.cd = Math.max(0, (a.cd || 0) - dt);
        if (!a.cd && !qteActive() && !this.fd.app.player.isModalOpen() && !this.fd.inTruck && Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 1.8) { this.kidQTE(a); return; }
        const off = a.state === 'kidFollow' ? 0.8 : 0;
        if (this.walk(a, tp.x + 0.3 + off, tp.z - 0.3, 1.7, dt) && a.state === 'kidRush') this.plateKicked();
        return;
      }
      case 'kidGuard': {
        const tp = this.kidTarget();
        if (tp && Math.hypot(a.g.position.x - tp.x, a.g.position.z - tp.z) > 1.4) { this.walk(a, tp.x + 1.0, tp.z + 0.6 + (a.cd || 0), 1.7, dt); return; }
        this.face(a, p.x, p.z);
        if (Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 3.5 && !this.fd.app.player.isModalOpen()) {
          this.actors.filter(k => k.kind === 'kid').forEach(k => { k.state = 'listen'; k.t = 0; });
          ui.faceSpeaker(a.g);
          ui.showDialog('昨天的小朋友', '「哥哥！我們幫你顧著這個鐵餅喔，都沒有人碰！」', [
            { text: '「謝謝你們！這叫尺墊，很重要的，動到就要重測。」', reply: '「我們很厲害吧！掰掰～」', score: 2, tag: '昨天的小朋友幫忙顧尺墊', id: 'a' },
            { text: '「好，謝謝。快回家吧。」', reply: '「掰掰～」', score: 1, tag: '昨天的小朋友幫忙顧尺墊', id: 'b' },
          ], (o) => { this.fd.addPR(o.score, o.tag); tell('第一天耐心攔下小朋友', '今天他們自己跑來幫你顧尺墊'); this.kidsGo(); this.relock(); });
        }
        return;
      }
      case 'listen':
        this.face(a, p.x, p.z);
        return;
      case 'kidLeave':
        if (this.walk(a, a.g.position.x + 20, 70, 1.8, dt) || a.g.position.z > 69) this.removeActor(a);
        return;
      case 'leave':
        if (this.walk(a, a.kind === 'dog' ? 30 : 20, a.kind === 'dog' ? 70 : 54, a.kind === 'dog' ? 3.4 : 1.5, dt)) this.removeActor(a);
        return;
      case 'lie':
        (a.kind === 'dog' ? animateDog : animateWalk)(a.g, a.t, 0);
        return;
      case 'photo':
        a.g.rotation.y = Math.atan2(-(p.z - a.g.position.z), p.x - a.g.position.x);
        return;
      case 'block':
        // 擋在望遠鏡前的阿伯：玩家一走近，他就自己開口
        if (a.kind === 'uncle' && Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z) < 3.5 && !this.fd.app.player.isModalOpen() && !this.fd.inTruck) { a.state = 'talking'; this.talkUncle(a); }
        return;
    }
  }

  /** 學弟扶尺站位：尺旁邊、面向儀器 */
  private placeAsstAtRod() {
    if (!this.rodAt) return;
    const to = this.inst ? V(this.inst.position.x - this.rodAt.x, 0, this.inst.position.z - this.rodAt.z).normalize() : V(-1, 0, 0);
    const side = V(-to.z, 0, to.x);
    const q = this.rodXZ(this.rodAt);
    const x = q.x + side.x * 0.38 - to.x * 0.12, z = q.z + side.z * 0.38 - to.z * 0.12;
    this.asst.g.position.set(x, this.sm.heightAt(x, z), z);
  }

  /** 標尺跟著學弟：立在點上 / 扛在肩上 / 收起來 */
  private refreshStaff() {
    const s = this.staff;
    const a = this.asst;
    if (this.swapped) {
      // 交換後：尺立在點上 (玩家扶) 或在玩家手上 (手持模型另外顯示)
      if (!this.rodAt) { s.visible = false; return; }
      const r = this.rodAt;
      s.visible = true;
      s.position.set(r.x, this.rodBase(r), r.z);
      const ix = this.inst ? this.inst.position.x : this.asst.g.position.x;
      const iz = this.inst ? this.inst.position.z : this.asst.g.position.z;
      s.rotation.set(0, Math.atan2(ix - r.x, iz - r.z), 0, 'YXZ');
      const h = this.hold;
      s.rotation.z = h ? h.bx * 0.05 : 0.04;
      s.rotation.x = h ? h.by * 0.05 : 0;
      return;
    }
    if (!this.haveStaff || !a.g.visible || a.state === 'hidden') { s.visible = false; return; }
    s.visible = true;
    if (this.rodAt && a.state === 'hold') {
      const r = this.rodAt;
      const q = this.rodXZ(r);
      s.position.set(q.x, this.rodBase(r), q.z);
      const ix = this.inst ? this.inst.position.x : this.fd.app.player.position.x;
      const iz = this.inst ? this.inst.position.z : this.fd.app.player.position.z;
      s.rotation.set(0, Math.atan2(ix - r.x, iz - r.z), 0, 'YXZ');
      s.rotation.z = this.rodTilt;
    } else {
      // 扛著走：斜靠在右肩
      const g = a.g;
      const fwd = V(Math.cos(g.rotation.y), 0, -Math.sin(g.rotation.y));
      const side = V(-fwd.z, 0, fwd.x);
      s.position.copy(g.position).addScaledVector(side, -0.28).addScaledVector(fwd, -0.15).add(V(0, 0.25, 0));
      s.rotation.set(0, g.rotation.y, 0.35, 'YXZ');
    }
  }

  /** 學弟尺立錯時，主角跳一次 OS (不直接講破) */
  private wrongHint(delay: number) {
    if (!this.rodWrong || this.wrongOs) return;
    this.wrongOs = true;
    setTimeout(() => { if (this.rodWrong) ui.thought('嗯？BM-1035 那邊……好像哪裡怪怪的。'); }, delay);
  }

  /** 尺實際立的位置 (學弟出包時立在標石旁邊的地上) */
  private rodXZ(r: Pt): { x: number; z: number } {
    return this.rodWrong && r === this.bm1 ? { x: r.x + 0.15, z: r.z - 0.5 } : { x: r.x, z: r.z };
  }

  private rodBase(r: Pt): number {
    if (this.rodWrong && r === this.bm1) { const q = this.rodXZ(r); return this.sm.heightAt(q.x, q.z); }
    if (r.kind === 'bm') return r.top;
    return this.sm.heightAt(r.x, r.z) + (r.plate ? PLATE_TOP : 0) - r.sink;
  }

  // ================================================================
  // 儀器
  // ================================================================
  private newLeveler(): AnyObj {
    const o: AnyObj = {
      screwA: 0, screwB: 0, screwC: 0, shiftX: 0, shiftY: 0, centerX: 0, centerY: 0,
      bx0: 0.4, by0: -0.35, bubbleX: 0, bubbleY: 0, isLeveled: false, isCentered: true,
      currentLevelErrorMm: '0', currentCenterErrorMm: '0', tripodMesh: null,
      recalculateTribrachPhysics() {
        const tiltX = o.screwA * -0.12 + o.screwB * 0.12;
        const tiltY = o.screwA * 0.08 + o.screwB * 0.08 - o.screwC * 0.16;
        o.bubbleX = o.bx0 + tiltX; o.bubbleY = o.by0 + tiltY;
        const d = Math.hypot(o.bubbleX, o.bubbleY);
        o.currentLevelErrorMm = (d * 1.8).toFixed(2);
        o.isLeveled = d < 0.1;
      },
    };
    return o;
  }

  private placeInst(x: number, z: number, withLevel: boolean) {
    this.removeInst(); // 保險：同時只會有一台儀器
    const S = SM();
    const { group, head, tribrach, accessories } = S.buildInstrumentStation('level');
    group.position.set(x, this.sm.heightAt(x, z), z);
    group.userData = { type: 'instrument', instrumentType: 'level', head, tribrach, accessories };
    head.visible = withLevel;
    this.sm.scene.add(group);
    this.ensureInteractive(group, true);
    this.inst = group;
    this.instState = withLevel ? 'mounted' : 'tripod';
    this.lv = this.newLeveler();
    this.lv.bx0 = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.3);
    this.lv.by0 = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.3);
    this.lv.tripodMesh = group;
    this.lv.recalculateTribrachPhysics();
    if (this.rodAt) this.aimAt(this.rodAt, 0.012);
    if (!this.swapped) this.placeAsstAtRod();
  }

  private removeInst() {
    if (!this.inst) return;
    this.sm.scene.remove(this.inst);
    this.ensureInteractive(this.inst, false);
    this.inst = null;
    this.instState = 'none';
  }

  private aimAt(pt: Pt, jitter = 0) {
    if (!this.inst) return;
    const head = this.inst.userData.head as THREE.Object3D;
    const q = this.rodXZ(pt);
    const dx = q.x - this.inst.position.x, dz = q.z - this.inst.position.z;
    head.rotation.y = Math.atan2(dx, dz) - this.inst.rotation.y + (Math.random() - 0.5) * 2 * jitter;
  }

  /** 視線高 (世界座標 y) */
  private losY(): number {
    const head = this.inst!.userData.head as THREE.Object3D;
    this.inst!.updateMatrixWorld(true);
    return head.localToWorld(V(0, 0.074, 0)).y;
  }

  private dist(pt: Pt, x?: number, z?: number): number {
    const ix = x ?? this.inst!.position.x, iz = z ?? this.inst!.position.z;
    const q = this.rodXZ(pt);
    return Math.hypot(q.x - ix, q.z - iz);
  }

  // ================================================================
  // 準心互動
  // ================================================================
  prompt(hit: THREE.Object3D): string | null {
    const fd = this.fd;
    const ud = hit.userData || {};
    const ph = fd.phase;
    const carry = fd.carrying;
    if (ud.type === 'npc') {
      const a = this.actors.find(x => x.g === hit);
      if (!a) return null;
      if (a.kind === 'asst') {
        if (ph === 'prep' || ph === 'toSite' || ph === 'brief') return `跟學弟${asstName()}說話`;
        if (this.finished && carry) return `請學弟${asstName()}把${ITEMS[carry].name}放上後斗`;
        if (carry === 'staff') return `把標尺交給學弟${asstName()}`;
        if (carry === 'plate') return `把尺墊交給學弟${asstName()}`;
        return `跟學弟${asstName()}說話`;
      }
      if (a.kind === 'uncle') return null; // 阿伯會自己走過來開口
      if (a.kind === 'rider' && a.state !== 'leave') return (a.g.userData as AnyObj).stubborn ? '再跟騎士說說看' : '跟騎士說一下';
      if (a.kind === 'police') return a.state === 'pcones' ? '（警察在等你擺交通錐）' : null;
      if (a.kind === 'kid') return null;
      if (a.kind === 'dog') return a.state === 'lie' ? '摸摸阿黃' : null;
      return null;
    }
    if (ud.type === 'coneLine') {
      if (this.cones?.borrowed) return '（警察借的三角錐，收工放著就好）';
      return carry ? '手上有東西，先放下（G）再拿交通錐' : '拿起交通錐（可以換個地方重擺）';
    }
    if (!['site', 'observe', 'packup'].includes(ph)) return null;
    if (hit === this.staff && this.swapped && this.rodAt && !this.hold) {
      return this.canPickRod() ? '拿起標尺往前走' : this.readyFor(this.rodAt) ? `扶尺（學弟${asstName()}要讀了）` : '扶尺';
    }
    if (ud.type === 'instrument' && hit === this.inst && this.swapped) return `（學弟${asstName()}在操作儀器）`;
    if (ud.type === 'instrument' && hit === this.inst) {
      switch (this.instState) {
        case 'tripod': return (carry === 'level' ? '裝上水準儀' : '裝上水準儀（需要水準儀箱）') + this.rHint();
        case 'mounted': return '整平水準儀（圓水準器）' + this.rHint();
        case 'leveled': {
          const st = this.cur;
          if (!st) return null;
          if (!st.fore && this.blocker && this.blockingLine(st.back.pt)) return '視線被擋住了：扛起儀器換個位置架站';
          if (st.back.read === undefined) return `讀後視（${st.back.pt.name}）${this.rHint()}`;
          if (!st.fore) return `讀完後視了。看著地上按 E，指定前視點${this.rHint()}`;
          if (st.fore.read === undefined) return this.rodAt === st.fore.pt && this.asst.state === 'hold' ? `讀前視（${st.fore.pt.name}）` : `學弟${asstName()}還在走過去……`;
          return this.finished ? null : `（這站完成，換學弟${asstName()}操作儀器）`;
        }
      }
    }
    if (ud.type === 'monument' && String(ud.label || '').includes('BM-')) {
      // 對著水準點本身也能做「看著地面」的動作 (例如在 BM-1036 上立尺)
      const free = this.freePrompt();
      if (free) return free;
      const b = this.bms.find(x => x.obj === hit);
      return b ? `${b.pt.name}　一等水準點` : null;
    }
    return null;
  }

  interact(obj: THREE.Object3D) {
    const fd = this.fd;
    const ud = obj.userData || {};
    if (ud.type === 'coneLine') {
      if (this.cones?.borrowed || fd.carrying) return;
      this.removeCones();
      fd.hold('cones');
      return;
    }
    if (ud.type === 'npc') {
      const a = this.actors.find(x => x.g === obj);
      if (a) this.talk(a);
      return;
    }
    if (obj === this.staff && this.swapped && this.rodAt) { if (this.canPickRod()) this.pickUpRod(); else this.startHold(this.rodAt); return; }
    if (ud.type === 'instrument' && obj === this.inst && this.swapped) return;
    if (ud.type === 'instrument' && obj === this.inst) this.useInst();
    else if (ud.type === 'monument' && this.freePrompt()) this.freeInteract();
    else if (fd.carrying === 'tripod' && this.carrySet) ui.toast('扛著儀器：看著空地按 E 架站，或按 G 拆開放下。', 'info');
  }

  private useInst() {
    const fd = this.fd;
    switch (this.instState) {
      case 'tripod':
        if (fd.carrying !== 'level') { fd.needItem('level'); return; }
        fd.consumeHeld();
        (this.inst!.userData.head as THREE.Object3D).visible = true;
        this.instState = 'mounted';
        if (this.rodAt) this.aimAt(this.rodAt, 0.012);
        fd.panel('observe', '水準儀裝好了。對著儀器按 E 整平（轉腳螺旋把氣泡趕進圈）。');
        return;
      case 'mounted': {
        const stop = this.workBlocked();
        if (stop) { sfx.error(); ui.toast(stop, 'warn', 3000); return; }
      }
        this.lv.recalculateTribrachPhysics();
        bench.enter('tribrach', this.lv, {
          noPlummet: true,
          title: '整平水準儀',
          pipHide: [this.inst!.userData.head],
          onDone: () => {
            this.instState = 'leveled';
            if (!this.lv.isLeveled) this.notes.push('氣泡沒完全居中就讀數');
            this.nextHint();
            // 儀器一擺好，機車就來了
            if (!this.swapped && this.stations.length === 1 && !this.scooterDone) setTimeout(() => this.spawnScooter(), 1500);
          },
        });
        return;
      case 'leveled': {
        const st = this.cur;
        if (st && !st.fore && this.blocker && this.blockingLine(st.back.pt)) { this.relocate(true); return; }
        this.readOrMove();
      }
    }
  }

  /** 手簿拿出來過就一直在身上 (工具袋本身還是要記得收) */
  private bookOut = false;
  private toolbagHere(): boolean {
    if (this.bookOut) return true;
    const fd = this.fd;
    const ix = this.inst!.position.x, iz = this.inst!.position.z;
    const ok = fd.carrying === 'toolbag' || fd.ground.some(g => g.item === 'toolbag' && Math.hypot(g.obj.position.x - ix, g.obj.position.z - iz) < 8);
    if (ok) { this.bookOut = true; ui.toast('從工具袋拿出水準手簿。工具袋收工時記得帶走。', 'info', 3000); }
    return ok;
  }

  private readOrMove() {
    const fd = this.fd;
    const st = this.cur;
    if (!st || !this.inst) return;
    const back = st.back.read === undefined;
    if (!back && st.fore && st.fore.read !== undefined) { ui.toast(`這站完成了，學弟${asstName()}要接手。`, 'info'); return; }
    if (!back && !st.fore) { ui.toast(`先指定前視點：看著地上（或 BM-1036）按 E，學弟${asstName()}會把尺帶過去。`, 'info', 3500); return; }
    const obs = back ? st.back : st.fore!;
    if (this.rodAt !== obs.pt || this.asst.state !== 'hold') { sfx.error(); ui.toast(`學弟${asstName()}還沒在那個點上立好尺。`, 'warn'); return; }
    const stop = this.workBlocked();
    if (stop) { sfx.error(); ui.toast(stop, 'warn', 3000); return; }
    // 第一站讀前視時：大貨車經過
    if (!back && !this.swapped && this.stations.length === 1 && !this.truckDone) { this.truckDone = true; setTimeout(() => this.spawnLorry(), 1500); }
    if (!this.toolbagHere()) { fd.needItem('toolbag'); ui.toast('水準手簿在外業工具袋裡。工具袋拿過來放在儀器附近。', 'info', 4000); return; }
    if (!this.lv.isLeveled && this.instState === 'leveled' && !this.notes.includes('補償器警示')) {
      // 氣泡沒進圈：補償器超出範圍，讀數會偏
      this.notes.push('補償器警示');
      ui.toast('氣泡沒居中，補償器可能超出範圍，讀數會不準。', 'warn', 3500);
    }
    this.readCount++;
    if (this.readCount === this.tiltPlanned) this.rodTilt = (Math.random() < 0.5 ? -1 : 1) * 0.06;
    obs.dist = this.dist(obs.pt);
    // 先用手把望遠鏡大致轉向標尺，剩下的用水平微動 (A/D) 對準
    this.aimAt(obs.pt, 0.008);
    if (back && obs.pt === this.bm1) this.wrongHint(1800); // 望遠鏡裡看到標尺好像比較低
    levelScope.open(fd.app, {
      head: this.inst.userData.head,
      title: `第 ${this.stations.length} 站　${back ? '後視' : '前視'}　${obs.pt.name}`,
      targetDist: obs.dist,
      focus: this.focus,
      tilted: () => Math.abs(this.rodTilt) > 0.001,
      onFixTilt: () => { this.rodTilt = 0; },
      onClose: (f) => { this.focus = f; },
      measure: (blur) => {
        const fail = this.measureFail(obs.pt, blur);
        if (fail) return { ok: false, text: fail };
        let v = this.trueRead(obs.pt) + (Math.random() - 0.5) * 0.0003;
        const shaking = this.vibe > 0.12;
        if (shaking) {
          // 震動中讀數：補償器還在擺，讀數偏掉 1~3 mm
          v += (Math.random() < 0.5 ? -1 : 1) * (0.001 + 0.002 * this.vibe);
          this.notes.push(`${obs.pt.name} 震動中讀數`);
        }
        if (this.rodWrong && obs.pt === this.bm1) this.notes.push('BM-1035 標尺沒立在標石頂上');
        this.record(obs, v, back);
        return { ok: true, text: `${v.toFixed(4)} m　D ${obs.dist.toFixed(2)} m${shaking ? '　⚠' : ''}` };
      },
      vibe: () => this.vibe,
      truth: () => (this.losY() - this.rodBase(obs.pt)) / Math.cos(this.rodTilt),
    });
  }

  /** 正確讀數 (含標尺傾斜、補償器超限的偏差) */
  private trueRead(pt: Pt): number {
    const d = this.dist(pt);
    return (this.losY() - this.rodBase(pt)) / Math.cos(this.rodTilt) + (this.lv.isLeveled ? 0 : d * 0.0004);
  }

  // ---------------------------------------------------------------- 視線遮擋 (樹、電線桿、車子、地形……)
  /** 可能擋住視線的東西：場景裡看得到的實體 mesh (草、半透明提示、精靈圖、電線不算) */
  private losCandidates(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const skip = new Set<THREE.Object3D>([this.staff, this.sm.camera, this.carryVis, ...this.arrows, ...(this.inst ? [this.inst] : [])]);
    ((this.sm.floatingArrows || []) as THREE.Object3D[]).forEach(o => skip.add(o));
    ((this.sm.dynamicArrows || []) as THREE.Object3D[]).forEach(o => skip.add(o));
    const walk = (o: THREE.Object3D) => {
      if (!o.visible || skip.has(o)) return;
      const m = o as AnyObj;
      if (m.isSprite || m.isLine || m.isPoints) return;
      if (m.isInstancedMesh && m.count > 300) return; // 草、花
      if (m.isMesh) {
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        if (!(mat && mat.transparent && (mat.depthWrite === false || mat.opacity < 0.6))) out.push(o);
      }
      o.children.forEach(walk);
    };
    walk(this.sm.scene);
    return out;
  }

  /** 從儀器 (或指定位置) 看標尺：條碼那一段被擋住一大半就讀不到 */
  private sightBlocked(pt: Pt, from?: { x: number; z: number; y: number }): boolean {
    const o = from ?? (this.inst ? { x: this.inst.position.x, z: this.inst.position.z, y: this.losY() } : null);
    if (!o) return false;
    const q = this.rodXZ(pt);
    const list = this.losCandidates();
    const rc = new THREE.Raycaster();
    let blocked = 0;
    for (const dy of [-0.16, -0.08, 0, 0.08, 0.16]) {
      const a = V(o.x, o.y + dy, o.z);
      const dir = V(q.x - o.x, 0, q.z - o.z);
      const L = dir.length();
      if (L < 1) return false;
      dir.normalize();
      rc.set(a, dir);
      rc.near = 0.45; rc.far = L - 0.6; // 儀器本身和標尺旁扶尺的人不算
      if (rc.intersectObjects(list, false).length) blocked++;
    }
    return blocked >= 3;
  }

  /** 腳架 / 尺墊放不下去：電線桿、樹、車子 */
  private spotBlocked(x: number, z: number, r = 0.5): string | null {
    const poles = (this.sm.poleColliders || []) as { x: number; z: number; r: number }[];
    if (poles.some(c => Math.hypot(c.x - x, c.z - z) < c.r + r)) return '電線桿';
    const trees = (this.sm.trees || []) as THREE.Object3D[];
    if (trees.some(t => Math.hypot(t.position.x - x, t.position.z - z) < 0.6 + r)) return '樹';
    const t = this.fd.truck;
    if (t) { const l = t.toLocalFlat(x, z); if (Math.abs(l.lx) < 2.85 + r && Math.abs(l.lz) < 1.15 + r) return '作業車'; }
    if (this.pcar && Math.hypot(this.pcar.x - x, this.pcar.z - z) < 2.4 + r) return '警車';
    return null;
  }

  /** 電子水準儀量測失敗的原因 (null = 可以量) */
  private measureFail(pt: Pt, blur: number): string | null {
    if (this.blocker && this.blockingLine(pt)) return 'E 323　視線被擋住';
    if (!this.inst) return 'E 000';
    if (this.sightBlocked(pt)) return 'E 323　視線被擋住';
    const head = this.inst.userData.head as THREE.Object3D;
    const yaw = head.rotation.y + this.inst.rotation.y;
    const rq = this.rodXZ(pt); // 尺實際立的位置 (學弟立錯時不在點上)
    const want = Math.atan2(rq.x - this.inst.position.x, rq.z - this.inst.position.z);
    let dy = Math.abs(yaw - want) % (Math.PI * 2); if (dy > Math.PI) dy = Math.PI * 2 - dy;
    // 標尺寬 8 cm：豎絲要壓在尺上
    if (dy * this.dist(pt) > 0.05) return 'E 324　找不到標尺';
    if (blur > 1.6) return 'E 325　對焦不清';
    return null;
  }

  /** 擋路的人是不是站在儀器和標尺之間 */
  private blockingLine(pt: Pt): boolean {
    if (!this.blocker || !this.inst) return false;
    const ax = this.inst.position.x, az = this.inst.position.z;
    const bx = pt.x - ax, bz = pt.z - az;
    const L2 = bx * bx + bz * bz;
    const px = this.blocker.g.position.x - ax, pz = this.blocker.g.position.z - az;
    const t = Math.max(0, Math.min(1, (px * bx + pz * bz) / L2));
    return Math.hypot(px - t * bx, pz - t * bz) < 0.6 && t > 0.05 && t < 0.95;
  }

  private record(obs: Obs, v: number, back: boolean) {
    const fd = this.fd;
    const truth = this.trueRead(obs.pt);
    obs.read = v;
    obs.truth = truth;
    obs.tilted = !this.swapped && Math.abs(this.rodTilt) > 0.001;
    if (obs.tilted) this.notes.push(`${obs.pt.name} 讀數時標尺沒扶直`);
    this.rodTilt = 0;
    this.book(this.stations);
    if (back) {
      fd.phase = 'observe';
      this.nextHint();
      if (!this.swapped && this.stations.length === 1 && !this.policeStage) { this.policeStage = 'wait'; this.policeT = 4; }
      return;
    }
    // 前視讀完
    if (obs.pt === this.bm2) { this.finishRoute(); return; }
    this.nextHint();
    if (!this.swapped && this.stations.length === 1) setTimeout(() => this.offerSwap(), 1600);
  }

  private nextHint() {
    if (this.swapped) { this.swapHint(); return; }
    const st = this.cur;
    if (!st) {
      this.fd.panel('observe', this.reloc ? '扛著儀器到旁邊的藍圈重新架站（避開騎士）。' : !this.haveStaff ? `先把標尺、尺墊交給學弟${asstName()}，他去 BM-1035 立尺。` : '扛腳架到藍色圈圈（建議架站位置）按 E 架站。');
      return;
    }
    let h = '';
    if (this.instState === 'tripod') h = '腳架架好了。拿水準儀箱過來，對著腳架按 E 裝上。';
    else if (this.instState === 'mounted') h = '對著儀器按 E 整平。';
    else if (st.back.read === undefined) h = `對著儀器按 E，看望遠鏡讀後視 ${st.back.pt.name}。${st.back.pt === this.bm1 ? `（讀之前先看一下學弟${asstName()}的尺有沒有立對位置）` : ''}`;
    else if (!st.fore) h = `看著地上的綠色圈圈（轉點 TP1）按 E，叫學弟${asstName()}去立尺。前後視距要差不多長。`;
    else if (st.fore.read === undefined) h = `等學弟${asstName()}立好尺，對著儀器按 E 讀前視 ${st.fore.pt.name}。`;
    else h = `這站完成！學弟${asstName()}要接手操作儀器。`;
    this.fd.panel('observe', h);
  }

  /** 搬站：整組扛起來 */
  private pickUpSet() {
    const fd = this.fd;
    if (fd.carrying) { ui.toast('手上有東西，先放下（G）。', 'warn'); return; }
    this.removeInst();
    this.carrySet = true;
    fd.hold('tripod');
    // 轉點沒放尺墊：搬站這段時間尺陷下去一點
    const r = this.rodAt;
    if (r && r.kind === 'tp' && !r.plate && r.sink === 0) { r.sink = 0.002 + Math.random() * 0.002; this.notes.push(`${r.name} 沒放尺墊，標尺下陷`); }
    ui.toast('扛著腳架和水準儀（裝在一起）。走到下一站，看著地上按 E 架設；按 G 會拆開放地上。', 'info', 4200);
    fd.panel('observe', '找下一站的位置：前後視距要差不多。');
  }

  /** 被騎士擋住：扛起儀器，到旁邊 (離路遠一點) 重新架站 */
  /** 扛起儀器換位置 (第一站、還沒指定前視前)。rider = 被騎士擋住：給一個避得開的建議位置 */
  private relocate(rider = false) {
    const fd = this.fd;
    if (fd.carrying) { ui.toast('手上有東西，先放下（G）。', 'warn'); return; }
    const ip = this.inst!.position;
    this.reloc = rider ? { x: ip.x, z: ip.z + 2.4 } : null;
    const withLevel = this.instState !== 'tripod';
    this.removeInst();
    this.stations.pop();
    this.book(this.stations);
    this.carrySet = withLevel;
    fd.hold('tripod');
    ui.toast(rider ? '扛起腳架和水準儀。旁邊的藍圈避得開騎士，到那裡重新架站。' : `扛起腳架${withLevel ? '和水準儀' : ''}，找個新位置重新架站。`, 'info', 4200);
    this.nextHint();
  }

  private rHint(): string { return this.canRelocate() ? '　（R 扛起來換位置）' : ''; }

  /** 第一站還沒指定前視前，可以按 R 扛起來換位置 */
  private canRelocate(): boolean {
    const st = this.cur;
    return !this.swapped && !!this.inst && !!st && !st.fore && this.stations.length === 1 && !this.fd.carrying;
  }

  // ================================================================
  // 自由互動 (看著地面)
  // ================================================================
  private groundAim(maxD = 45): THREE.Vector3 | null {
    const cam = this.sm.camera as THREE.PerspectiveCamera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const o = cam.position.clone();
    for (let t = 0.5; t < maxD; t += 0.25) {
      const q = o.clone().addScaledVector(dir, t);
      if (q.y <= this.sm.heightAt(q.x, q.z)) return q;
    }
    return null;
  }

  private standPoint(): THREE.Vector3 {
    const p = this.fd.app.player;
    const f = V(-Math.sin(p.euler.y), 0, -Math.cos(p.euler.y));
    return p.position.clone().addScaledVector(f, 1.2);
  }

  /** 架站點：靠近藍圈就吸到圈中心 */
  /** 架站點：就是玩家站的前方 (藍圈只是建議，不會吸過去) */
  private stationPoint(): { x: number; z: number; snap: boolean } {
    const q = this.standPoint();
    const r = this.reloc || this.s1;
    return { x: q.x, z: q.z, snap: Math.hypot(q.x - r.x, q.z - r.z) < 1.2 };
  }
  /** 轉點：看著的地面 (綠圈只是建議) */
  private tpPoint(): { x: number; z: number; snap: boolean } | null {
    const q = this.groundAim();
    if (!q) return null;
    const s = this.tpSuggest();
    return { x: q.x, z: q.z, snap: !!s && Math.hypot(q.x - s.x, q.z - s.z) < 1.2 };
  }
  /** 轉點不合適的原因：第二站 (學弟) 要能前後視都看得到 */
  private tpBad(x: number, z: number, df: number): string | null {
    if (df > 40) return `太遠了（${df.toFixed(0)} m，視距最多 40 m）`;
    const rem = Math.hypot(this.bm2.x - x, this.bm2.z - z);
    if (Math.hypot(this.bm2.x - x, this.bm2.z - z) < 3.5) return `第一站前視先放轉點（下一站換學弟${asstName()}架，才看 BM-1036）`;
    if (rem > 70) return `這裡離 BM-1036 太遠（${rem.toFixed(0)} m），學弟${asstName()}那一站看不到，往前一點`;
    if (rem < 10) return '太靠近 BM-1036 了，往回一點';
    return null;
  }

  /** 架站時的後視點 (尺目前所在) */
  private backPt(): Pt { return this.rodAt || this.bm1; }

  freePrompt(): string | null {
    const fd = this.fd;
    if (!['site', 'observe'].includes(fd.phase)) return null;
    if (fd.carrying === 'cones') {
      if (this.cones) return null;
      return this.groundAim(20) ? '在這裡擺交通錐（往來車方向排一排）' : null;
    }
    if (this.swapped) {
      if (fd.carrying !== 'staff' || this.aJob !== 'waitFore' || !this.inst || !this.cur) return null;
      const q = this.standPoint();
      const d2 = Math.hypot(q.x - this.bm2.x, q.z - this.bm2.z);
      if (d2 >= 3.5) return null;
      const df = Math.hypot(this.bm2.x - this.inst.position.x, this.bm2.z - this.inst.position.z);
      const db = this.cur.back.dist;
      return `在 BM-1036 上立尺（離儀器 ${df.toFixed(1)} m／後視 ${db.toFixed(1)} m）`;
    }
    if (fd.carrying === 'tripod' && !this.carrySet && this.instState === 'none' && !this.haveStaff) return `先把標尺交給學弟${asstName()}，讓他去 BM-1035 立尺，再來架站`;
    if (fd.carrying === 'tripod' && (this.carrySet || this.instState === 'none')) {
      if (this.stations.length >= 1) return null;
      const q = this.stationPoint();
      const b = this.backPt();
      const db = Math.hypot(q.x - b.x, q.z - b.z);
      if (db < 3) return null;
      if (db > 30) return `離 ${b.name} 太遠了（${db.toFixed(0)} m）`;
      const hit = this.spotBlocked(q.x, q.z);
      if (hit) return `這裡架不下去（${hit}擋著）`;
      return `在這裡架站（後視 ${b.name} ${db.toFixed(1)} m）`;
    }
    const st = this.cur;
    if (!fd.carrying && st && this.inst && this.instState === 'leveled' && st.back.read !== undefined && !st.fore) {
      const q = this.tpPoint();
      if (!q) return null;
      const df = Math.hypot(q.x - this.inst.position.x, q.z - this.inst.position.z);
      const db = st.back.dist || this.dist(st.back.pt);
      if (df < 4) return null;
      const why = this.tpBad(q.x, q.z, df);
      if (why) return why;
      const hit = this.spotBlocked(q.x, q.z, 0.25);
      if (hit) return `這裡放不了尺墊（${hit}擋著）`;
      return `叫學弟${asstName()}到這裡立尺（前視 ${df.toFixed(1)} m／後視 ${db.toFixed(1)} m，差 ${Math.abs(df - db).toFixed(1)} m）`;
    }
    return null;
  }

  freeInteract(): boolean {
    const fd = this.fd;
    if (!['site', 'observe'].includes(fd.phase)) return false;
    if (fd.carrying === 'cones' && !this.cones) {
      const q = this.groundAim(20);
      if (!q) return false;
      fd.consumeHeld();
      this.placeCones(q.x, q.z, false, true);
      return true;
    }
    if (this.swapped) {
      if (fd.carrying !== 'staff' || this.aJob !== 'waitFore' || !this.inst || !this.cur) return false;
      const q = this.standPoint();
      if (Math.hypot(q.x - this.bm2.x, q.z - this.bm2.z) >= 3.5) { sfx.error(); ui.toast('這站的前視要立在 BM-1036 上（紅色箭頭那裡）。', 'warn', 3000); return true; }
      const df = Math.hypot(this.bm2.x - this.inst.position.x, this.bm2.z - this.inst.position.z);
      fd.consumeHeld();
      const pt = this.bm2;
      this.cur.fore = { pt, dist: df };
      this.rodAt = pt;
      this.ensureInteractive(this.staff, true);
      this.book(this.stations);
      this.startHold(pt);
      return true;
    }
    if (fd.carrying === 'tripod' && !this.carrySet && this.instState === 'none' && !this.haveStaff) {
      sfx.error();
      ui.toast(`先把標尺（和尺墊）交給學弟${asstName()}，他去 BM-1035 立尺之後再架站。腳架要放下按 G。`, 'warn', 4000);
      return true;
    }
    if (fd.carrying === 'tripod' && (this.carrySet || this.instState === 'none')) {
      if (this.stations.length >= 1) return false;
      const q = this.stationPoint();
      const b = this.backPt();
      const db = Math.hypot(q.x - b.x, q.z - b.z);
      if (db < 3) { ui.toast('離標尺太近了。', 'warn'); return true; }
      if (db > 30) { sfx.error(); ui.toast('離後視點太遠了，到藍圈架站。', 'warn'); return true; }
      const hit = this.spotBlocked(q.x, q.z);
      if (hit) { sfx.error(); ui.toast(`這裡架不下去，${hit}擋著。`, 'warn'); return true; }
      this.reloc = null;
      const withLevel = this.carrySet;
      fd.consumeHeld();
      this.carrySet = false;
      this.placeInst(q.x, q.z, withLevel);
      this.stations.push({ x: q.x, z: q.z, back: { pt: b, dist: Math.hypot(q.x - b.x, q.z - b.z) } });
      // 學弟把尺轉向新的測站
      this.book(this.stations);
      this.nextHint();
      if (!this.uncleDone && this.stations.length === 1) setTimeout(() => this.spawnUncle(), 9000);
      return true;
    }
    const st = this.cur;
    if (!fd.carrying && st && this.inst && this.instState === 'leveled' && st.back.read !== undefined && !st.fore) {
      const q = this.tpPoint();
      if (!q) return false;
      const df = Math.hypot(q.x - this.inst.position.x, q.z - this.inst.position.z);
      if (df < 4 || this.tpBad(q.x, q.z, df) || this.spotBlocked(q.x, q.z, 0.25)) { sfx.error(); return true; }
      const pt: Pt = { name: `TP${this.tps.length + 1}`, x: q.x, z: q.z, kind: 'tp', plate: null, sink: 0, top: 0 };
      this.tps.push(pt);
      st.fore = { pt, dist: df };
      this.sendRod(pt);
      return true;
    }
    return false;
  }

  /** 叫學弟帶尺過去 (轉點要放尺墊) */
  private sendRod(pt: Pt) {
    const a = this.asst;
    this.rodAt = null;
    sfx.pickup();
    ui.toast(`（對講機）「收到，我到${pt.kind === 'bm' ? ` ${pt.name}` : '那邊'}立尺！」`, 'info', 2400);
    this.goTo(a, pt.x + 0.3, pt.z + 0.3, 1.7, () => {
      if (pt.kind === 'tp' && !pt.plate) {
        if (this.havePlate) this.putPlate(pt);
        else { this.askPlate(pt); return; }
      }
      this.holdAt(pt);
    });
    this.nextHint();
  }

  private putPlate(pt: Pt) {
    const pl = buildTurningPlate();
    pl.position.set(pt.x, this.sm.heightAt(pt.x, pt.z), pt.z);
    pl.rotation.y = Math.random() * 3;
    this.sm.scene.add(pl);
    pt.plate = pl;
    sfx.thud();
  }

  private holdAt(pt: Pt) {
    this.rodAt = pt;
    // 學弟出包：第一次到 BM-1035，尺立在標石旁邊的地上 (要玩家自己發現)
    if (pt === this.bm1 && !this.swapped && this.wrongPlanned && !this.wrongDone) { this.wrongDone = true; this.rodWrong = true; }
    this.asst.state = 'hold';
    this.placeAsstAtRod();
    ui.toast(`（對講機）「${pt.name} 立好了！」`, 'good', 2000);
    this.nextHint();
  }

  private askPlate(pt: Pt) {
    this.asst.state = 'wait';
    this.waitingPlate = pt;
    ui.showDialog(`學弟${asstName()}（對講機）`, '「學長，尺墊沒有在我這耶……直接立在土上可以嗎？」', [
      { text: '「直接立啦，沒差。」', reply: '「好喔～」（土有點軟……）', score: 0, tag: '', id: 'go' },
      { text: '「等一下，我拿尺墊過去給你。」', reply: '「好，我在這邊等。」', score: 0, tag: '', id: 'wait' },
    ], (o) => {
      if (o.id === 'go') { this.waitingPlate = null; this.holdAt(pt); this.mentor--; tell('叫學弟把尺直接立在土上', '轉點的尺慢慢往下陷'); whatIf('如果把尺墊拿去給學弟，轉點就不會下陷，學弟也學到一課。'); }
      else this.mentor++;
      if (o.id !== 'go') this.fd.panel('observe', `尺墊在後斗或地上。拿過去交給學弟${asstName()}（對著他按 E）。`);
      this.relock();
    });
  }

  private relock() {
    const c = this.sm.renderer.domElement;
    try { (c.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需要使用者手勢 */ }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'KeyR' && this.canRelocate() && !this.fd.app.player.isModalOpen()) {
      const p = this.fd.app.player.position;
      if (Math.hypot(p.x - this.inst!.position.x, p.z - this.inst!.position.z) < 3) { this.relocate(this.instState === 'leveled' && !!this.blocker && this.blockingLine(this.cur!.back.pt)); return true; }
    }
    if (e.code === 'KeyG' && this.carrySet && this.fd.carrying === 'tripod') {
      // 拆開放地上
      const fd = this.fd;
      fd.consumeHeld();
      this.carrySet = false;
      const q = this.standPoint();
      fd.spawnGround('tripod', V(q.x, this.sm.heightAt(q.x, q.z), q.z), 0);
      fd.spawnGround('level', V(q.x + 0.6, this.sm.heightAt(q.x + 0.6, q.z), q.z + 0.3), 0);
      return true;
    }
    return false;
  }

  // ================================================================
  // 對話
  // ================================================================
  private talk(a: Actor) {
    const fd = this.fd;
    if (a.kind === 'asst') {
      if (fd.phase === 'prep' || fd.phase === 'toSite') { this.talkYard(a); return; }
      if (this.finished && fd.carrying) {
        // 收工了：東西交給學弟，他幫忙放上後斗
        const it = fd.carrying;
        fd.consumeHeld();
        if (fd.extraCarry) { const x = fd.extraCarry; fd.setExtra(null); fd.hold(x); }
        const t = fd.truck.toWorld(-3.4, 0, 0.9);
        ui.toast(`學弟${asstName()}：「${ITEMS[it].name}給我，我拿去放後斗！」`, 'info', 2600);
        this.goTo(a, t.x, t.z, 2.0, () => {
          if (!fd.autoLoad(it)) { fd.spawnGround(it, V(t.x, this.sm.heightAt(t.x, t.z + 0.5), t.z + 0.5), 0); ui.toast(`學弟${asstName()}：「後斗塞不下，先放車尾地上。」`, 'info'); }
          a.state = 'follow';
        });
        return;
      }
      if (fd.carrying === 'staff') {
        fd.consumeHeld();
        this.haveStaff = true;
        ui.toast(`學弟${asstName()}：「標尺交給我！我先去 ${this.cur ? this.cur.back.pt.name : 'BM-1035'} 立尺。」`, 'good', 3000);
        if (!this.rodAt) {
          // 已經架了站就去那一站的後視點，還沒架就去 BM-1035
          const pt = this.cur ? this.cur.back.pt : this.bm1;
          this.goTo(a, pt.x + 0.3, pt.z + 0.3, 1.7, () => this.holdAt(pt));
        }
        if (fd.phase === 'site') { fd.phase = 'observe'; }
        this.nextHint();
        return;
      }
      if (fd.carrying === 'plate') {
        fd.consumeHeld();
        this.havePlate = true;
        ui.toast(`學弟${asstName()}：「尺墊我帶著，轉點的時候會墊。」`, 'good', 3000);
        if (this.waitingPlate) { const pt = this.waitingPlate; this.waitingPlate = null; this.putPlate(pt); this.holdAt(pt); }
        return;
      }
      const lines: Record<string, string> = {
        yard: '「學長早！今天水準對吧？標尺、尺墊、水準儀、腳架……還有手簿。東西你拿，我跟車。」',
        prep: '「學長早！今天水準對吧？標尺、尺墊、水準儀、腳架……還有手簿。東西你拿，我跟車。」',
      };
      void lines;
      if (fd.phase === 'brief') return;
      if (this.finished) { ui.toast(`學弟${asstName()}：「收工囉！東西都上車再出發，交通錐別忘了收。」`, 'info', 3200); return; }
      if (!this.haveStaff) { ui.toast(`學弟${asstName()}：「學長，標尺給我，我去立尺。」`, 'info'); return; }
      if (this.rodWrong && this.rodAt === this.bm1 && !this.cur?.fore) { this.fixWrongRod(); return; }
      const st = this.cur;
      const tip = !st ? '「前後視距要差不多喔，組長很在意。」'
        : st.back.read === undefined ? '「我這邊尺立好了，你讀就好。」'
          : '「讀完記得叫我換點！」';
      ui.toast(`學弟${asstName()}：${tip}`, 'info', 3200);
      return;
    }
    if (a.kind === 'dog') {
      if (a.state === 'lie') {
        ui.toast('阿黃翻肚子給你摸。牠記得你昨天沒兇牠。（被療癒了）', 'good', 2600);
        bark(2, 1, true);
      }
      return;
    }
    if (a.kind === 'rider' && a.state !== 'leave') { if ((a.g.userData as AnyObj).stubborn) this.talkRiderAgain(a); else this.talkRider(a); return; }
  }

  // ---------------------------------------------------------------- 出發前：學弟幫忙裝車 (常常裝錯)
  private asstLoading = false;
  private asstLoaded = false;
  private handVis: THREE.Object3D | null = null;

  private talkYard(a: Actor) {
    const fd = this.fd;
    if (fd.phase === 'prep' && !this.asstLoading && !this.asstLoaded) {
      ui.faceSpeaker(a.g);
      ui.showDialog(`學弟${asstName()}`, '「學長早！今天水準對吧？要我幫忙把東西搬上車嗎？」', [
        { id: 'help', text: '「好啊，你幫我把今天要用的搬上後斗。」', reply: '「沒問題！交給我！」', score: 0, tag: '' },
        { id: 'self', text: '「我自己來，你在旁邊等。」', reply: '「好喔～」', score: 0, tag: '' },
      ], (o) => { if (o.id === 'help') this.asstLoad(); this.relock(); });
      return;
    }
    ui.toast(this.asstLoading ? `學弟${asstName()}：「搬東西中，等我一下！」` : `學弟${asstName()}：「東西都好了就出發吧！我坐副駕。」`, 'info', 3000);
  }

  /** 學弟搬東西上車：一件一件從貨架搬到車尾。常常會少搬一件或多搬一件用不到的 */
  private asstLoad() {
    const fd = this.fd;
    const need: ItemId[] = ['tripod', 'level', 'staff', 'plate', 'toolbag', 'cones'];
    let list = need.slice();
    const roll = Math.random();
    if (roll < 0.4) list.splice(Math.floor(Math.random() * list.length), 1);            // 少搬一件
    else if (roll < 0.8) { const ex: ItemId[] = ['paint', 'prism', 'hammer', 'gnss', 'tribrach']; list.push(ex[Math.floor(Math.random() * ex.length)]); } // 多搬一件
    list = list.filter(it => !fd.grid.placed.some(p => p.item === it) && fd.carrying !== it && fd.yardItemPos(it)).sort(() => Math.random() - 0.5);
    this.asstLoading = true;
    const a = this.asst;
    const done = () => {
      this.asstLoading = false; this.asstLoaded = true; this.setHandVis(null);
      if (a.state !== 'hidden') { a.state = 'reportLoad'; a.speed = 2.6; } // 跑去跟學長回報
    };
    const step = (i: number) => {
      if (!this.asstLoading || a.state === 'hidden') { done(); return; }
      if (i >= list.length) { done(); return; }
      const it = list[i];
      const pos = fd.yardItemPos(it);
      if (!pos) { step(i + 1); return; }
      const t0 = fd.truck.toWorld(-3.4, 0, 0.9);
      const d = V(t0.x - pos.x, 0, t0.z - pos.z).normalize();
      this.goTo(a, pos.x + d.x * 0.8, pos.z + d.z * 0.8, 3.2, () => {
        if (!fd.takeGroundItem(it, pos, 0.6)) { step(i + 1); return; }
        this.setHandVis(it);
        const t = fd.truck.toWorld(-3.4, 0, 0.9);
        this.goTo(a, t.x, t.z, 3.2, () => {
          this.setHandVis(null);
          if (!fd.autoLoad(it)) fd.spawnGround(it, V(t.x, this.sm.heightAt(t.x, t.z + 0.6), t.z + 0.6), 0);
          sfx.thud();
          step(i + 1);
        });
      });
    };
    ui.toast(`學弟${asstName()}開始搬東西上車。`, 'info', 2500);
    step(0);
  }

  private askCheckTrunk(a: Actor) {
    const fd = this.fd;
    ui.faceSpeaker(a.g);
    ui.showDialog(`學弟${asstName()}`, '「學長，東西都搬上後斗了！要不要檢查一下？」', [
      { id: 'check', text: '「好，我看一下。」', reply: '「好！都在後斗。」', score: 0, tag: '' },
      { id: 'trust', text: `「沒關係，學弟${asstName()}我相信你。」`, reply: `「謝謝學長！」（學弟${asstName()}看起來很開心）`, score: 0, tag: '' },
    ], (o) => {
      a.state = 'idle';
      if (o.id === 'check') (fd as AnyObj).openUnload?.();
      else this.relock();
    });
  }

  /** 學弟手上拿著的設備 */
  private setHandVis(it: ItemId | null) {
    if (this.handVis) this.asst.g.remove(this.handVis);
    this.handVis = null;
    this.asst.g.userData.pose = it ? 'carryFront' : undefined;
    if (!it) return;
    const m = buildItemModel(it);
    m.scale.setScalar(0.75);
    m.position.set(0.52, 1.0, 0);              // 兩手捧在胸前
    m.rotation.y = Math.PI / 2;
    this.asst.g.add(m);
    this.handVis = m;
  }

  // ================================================================
  // 事件
  // ================================================================
  /** 罵過之後再去講：他已經不爽了，怎麼講都不走 */
  private talkRiderAgain(a: Actor) {
    ui.faceSpeaker(a.g);
    const lines = [
      '「又怎樣？我在等朋友啦，你們量你們的。」',
      '「（滑手機，頭也不抬）……剛剛不是很兇？」',
      '「我朋友等一下就來了，你去旁邊量啦。」',
    ];
    ui.showDialog('賴著不走的騎士', lines[Math.floor(Math.random() * lines.length)], [
      { text: '「……好吧，我換個位置。」', reply: '（看來只能扛起儀器，到旁邊的藍圈重新架站了。）', score: 0, tag: '', id: 'a' },
      { text: '「拜託啦，剛剛是我口氣不好，對不起。」', reply: '「哼，現在才道歉。」（騎士轉過去，還是不走）', score: 0, tag: '', id: 'b' },
    ], () => this.relock());
  }

  /** 騎士騎車離開 */
  private riderLeave(a: Actor) {
    if (!this.actors.includes(a)) return;
    const sc = (a.g.userData as AnyObj).scooter as THREE.Object3D | undefined;
    this.blocker = this.blocker === a ? null : this.blocker;
    if (sc) {
      if (sc.userData.rider) sc.userData.rider.visible = true; // 騎回車上
      const t0 = performance.now(), x0 = sc.position.x;
      const run = () => { const k = (performance.now() - t0) / 2500; sc.position.x = x0 + k * k * 30; sc.position.z += (ROAD_Z + 1.7 - sc.position.z) * 0.05; if (k < 1) requestAnimationFrame(run); else this.sm.scene.remove(sc); };
      run();
    }
    this.removeActor(a);
  }

  /** 阿伯回訪：台詞依第一天的回答而不同 */
  private spawnUncle() {
    if (this.uncleDone || this.fd.phase !== 'observe') return;
    this.uncleDone = true;
    const a = this.spawn('uncle', 38, 53.4);
    const said = this.pr.uncle;
    if (said === 'ignore' && this.inst && this.rodAt) {
      // 站到望遠鏡前面擋視線
      const ix = this.inst.position.x, iz = this.inst.position.z;
      const d = V(this.rodAt.x - ix, 0, this.rodAt.z - iz).normalize();
      this.goTo(a, ix + d.x * 2.2, iz + d.z * 2.2, 1.3, () => { a.state = 'block'; this.face(a, ix, iz); });
      this.blocker = a;
      ui.toast('昨天被你無視的阿伯，雙手抱胸往你的望遠鏡前面走過來……', 'warn', 4000);
      return;
    }
    a.state = 'seek'; a.speed = 1.6;
  }

  private talkUncle(a: Actor) {
    ui.faceSpeaker(a.g);
    const fd = this.fd;
    const said = this.pr.uncle;
    const leave = () => { a.state = 'leave'; a.t = 0; this.blocker = this.blocker === a ? null : this.blocker; this.relock(); };
    if (said === 'explain' || said === 'order') {
      ui.showDialog('昨天的阿伯', '「欸！昨天那個少年仔！今天換量馬路喔？來來來，冬瓜茶，冰的。」', [
        { text: '「謝謝阿伯！今天測水準，量兩個點的高低差。」', reply: '「高低差喔？這條路下雨會積水，你們量完要跟縣政府講。」', score: 2, tag: '阿伯回訪：請喝冬瓜茶', id: 'a' },
        { text: '「謝謝，我們在趕工，先不聊了。」', reply: '「好啦好啦，認真喔！」', score: 1, tag: '阿伯回訪：收下冬瓜茶', id: 'b' },
      ], (o) => { fd.addPR(o.score, o.tag); fd.hydrate(100, '阿伯的冰冬瓜茶'); this.uncle2 = 'a'; tell('第一天好好跟阿伯說明', '今天阿伯一看到你就端冰冬瓜茶過來'); leave(); });
    } else if (said === 'lie') {
      ui.showDialog('昨天的阿伯', '「少年仔！你昨天說要開路，我去問里長，里長說根本沒有這回事！」', [
        { text: '「阿伯對不起，昨天是我亂講的。我們是在做控制測量。」', reply: '「啊這樣早講嘛……好啦，年輕人誠實就好。」', score: 2, tag: '阿伯回訪：為昨天亂講道歉', id: 'a' },
        { text: '「呃……今天也是在量開路啦。」', reply: '「……（阿伯臉都黑了，拿起手機打給里長）」', score: -2, tag: '阿伯回訪：又亂講一次', id: 'b' },
      ], (o) => {
        fd.addPR(o.score, o.tag); this.uncle2 = o.id as 'a' | 'b';
        tell('第一天跟阿伯亂說要開路', '阿伯問了里長，今天跑來興師問罪');
        if (o.id === 'a') tell('今天老實跟阿伯道歉', '阿伯原諒你了：「年輕人誠實就好」'); else whatIf('如果今天老實道歉，阿伯會原諒你，之後也不會一直記著。');
        leave();
      });
    } else if (said === 'secret') {
      ui.showDialog('昨天的阿伯', '「（小聲）又是國家機密喔？今天是什麼機密？」', [
        { text: '「其實是在量高低差啦，昨天跟你開玩笑的。」', reply: '「我就知道！我孫子也是讀測量的。」', score: 2, tag: '阿伯回訪：說實話', id: 'a' },
        { text: '「噓——這次更機密。」', reply: '「（阿伯比了一個 OK，又拿出手機……）」', score: 0, tag: '阿伯回訪：繼續國家機密，又被拍照', id: 'b' },
      ], (o) => {
        fd.addPR(o.score, o.tag); this.uncle2 = o.id as 'a' | 'b';
        tell('第一天說是國家機密', '阿伯今天又來問「今天是什麼機密」');
        if (o.id === 'a') tell('今天跟阿伯說實話', '阿伯說他孫子也是讀測量的'); else whatIf('如果今天說實話，阿伯就不會一直記著「國家機密」這件事。');
        if (o.id === 'b') { a.state = 'photo'; phonePhoto(this.sm.scene, a.g, 2, leave); this.relock(); } else leave();
      });
    } else if (said === 'ignore') {
      ui.showDialog('昨天的阿伯', '「（阿伯站在你的望遠鏡前面，雙手抱胸）……昨天問你都不理我。」', [
        { text: '「阿伯，昨天很不好意思，我在忙沒聽到。我們在測高低差。」', reply: '「好啦，有說就好。」（阿伯讓開了）', score: 2, tag: '阿伯回訪：為昨天不理人道歉', id: 'a' },
        { text: '「阿伯，你擋到了。」', reply: '「哼。」（阿伯慢慢讓開）', score: 0, tag: '阿伯回訪：請他讓開', id: 'b' },
      ], (o) => {
        fd.addPR(o.score, o.tag); this.uncle2 = o.id as 'a' | 'b';
        tell('第一天不理阿伯', '阿伯今天故意站在望遠鏡前面');
        if (o.id === 'a') tell('今天跟阿伯道歉、說明在測什麼', '阿伯讓開了'); else whatIf('如果今天跟阿伯道歉，他就不會一直記著你不理他。');
        leave();
      });
    } else {
      ui.showDialog('路過的阿伯', '「少年仔，你們在量什麼？那根尺上面一格一格的是什麼？」', [
        { text: '「水準測量，量兩個點的高低差。尺上一格是一公分。」', reply: '「喔～所以下雨會積水就是這個在管的喔？」', score: 1, tag: '向路人解釋水準測量', id: 'a' },
        { text: '「在工作，不方便聊。」', reply: '「好啦好啦。」', score: 0, tag: '打發路人', id: 'b' },
      ], (o) => { fd.addPR(o.score, o.tag); leave(); });
    }
  }

  /** 機車停在視線上 (第二站前視時) */
  private spawnScooter() {
    const st = this.cur;
    if (this.scooterDone || !this.inst || !st || this.swapped) return;
    this.scooterDone = true;
    const ix = this.inst.position.x, iz = this.inst.position.z;
    const B = st.back.pt;
    const mx = (ix + B.x) / 2, mz = (iz + B.z) / 2;
    const sc = buildScooter();
    sc.position.set(mx - 12, this.sm.heightAt(mx - 12, ROAD_Z + 1.7), ROAD_Z + 1.7);
    this.sm.scene.add(sc);
    const r = this.spawn('rider', mx - 12, ROAD_Z + 1.7);
    r.g.visible = false;
    r.state = 'arrive';
    const start = performance.now();
    const ride = () => {
      const k = Math.min(1, (performance.now() - start) / 3200);
      const e = 1 - Math.pow(1 - k, 2);
      const x = mx - 12 + 12 * e + 0.6, z = ROAD_Z + 1.7 + (mz + 0.15 - ROAD_Z - 1.7) * Math.min(1, e * 1.4);
      sc.position.set(x, this.sm.heightAt(x, z), z);
      if (k < 1) { requestAnimationFrame(ride); return; }
      // 停好，騎士下車站在視線上 (車上的騎士藏起來，換成站著的那個)
      if (sc.userData.rider) sc.userData.rider.visible = false;
      r.g.visible = true;
      r.g.position.set(mx, this.sm.heightAt(mx, mz), mz);
      r.state = 'block';
      this.face(r, mx, mz - 3);
      this.blocker = r;
      (r.g.userData as AnyObj).scooter = sc;
      ui.toast('一台機車停在路肩，騎士下車剛好站在你和 BM-1035 中間（看起來是在等人）。去跟他說一下。', 'warn', 4500);
    };
    sfx.honk(25);
    ride();
  }

  private talkRider(a: Actor) {
    ui.faceSpeaker(a.g);
    const fd = this.fd;
    const sc = (a.g.userData as AnyObj).scooter as THREE.Object3D | undefined;
    void sc;
    const go = (delay: number) => setTimeout(() => this.riderLeave(a), delay);
    ui.showDialog('等人的騎士', '「蛤？怎樣？」', [
      { text: '「不好意思，我們在測量，車可以往前停一點嗎？你剛好擋到視線。」', reply: '「喔歹勢歹勢，我馬上移。」', score: 1, tag: '請機車騎士移開（客氣）', id: 'a' },
      { text: '「喂！這裡不能停車啦！」', reply: '「啊你是警察喔？路是你家開的喔？我就要停這裡等朋友！」<br>（騎士雙手抱胸，一步也不想動）', score: -1, tag: '對機車騎士兇，騎士賴著不走', id: 'b' },
    ], (o) => {
      fd.addPR(o.score, o.tag);
      if (o.id === 'a') go(1200);
      else {
        a.state = 'block';
        (a.g.userData as AnyObj).stubborn = true;
        ui.toast('騎士不走了……只好扛起儀器（對著儀器按 E）換個位置架站。', 'warn', 4500);
      }
      this.relock();
    });
  }

  /** 阿黃回訪：第一天撞過腳架 → 又來衝；被攔住過 → 來撒嬌 */
  private maybeDog() {
    this.dogDone = true;
    const dog = this.pr.dog;
    if (!dog || !this.inst) return;
    const d = this.spawn('dog', this.inst.position.x + 26, 58);
    if (dog === 'stopped') {
      const t = this.fd.truck.toWorld(-3.5, 0, 1.2);
      this.goTo(d, t.x, t.z, 2.4, () => { d.state = 'lie'; });
      ui.toast('阿黃搖著尾巴跑過來，在車子旁邊趴下了。看來牠記得你。', 'good', 3500);
      bark(15, 2, true);
      return;
    }
    const target = this.inst.position.clone();
    bark(26, 3);
    if (bench.mode) bench.exit(false);
    if (levelScope.active) levelScope.close();
    d.state = 'intro';
    playBossIntro(this.fd.app, { subject: d.g, target, eye: 0.45, name: '阿黃（又來了）', sub: '二度衝撞者', tagline: '昨天那一撞，牠念念不忘……' }, () => { d.state = 'rush'; d.t = 0; });
  }

  private dogBump() {
    if (!this.inst) return;
    sfx.thud();
    this.notes.push('阿黃撞到腳架，這站重測');
    if (this.swapped) {
      const st = this.cur;
      if (st) { st.back.read = undefined; st.back.truth = undefined; if (st.fore) { st.fore.read = undefined; st.fore.truth = undefined; } }
      if (st && st.fore && this.rodAt === st.fore.pt) { this.rodAt = st.back.pt; }
      if (st) st.fore = undefined;
      this.endHold();
      this.instState = 'mounted';
      this.aJob = 'leveling'; this.aT = 4;
      this.book(this.stations);
      ui.toast(`阿黃撞到腳架了！學弟${asstName()}要重新整平，這站重測。`, 'bad', 4500);
      this.swapHint();
      return;
    }
    this.instState = 'mounted';
    this.lv.screwA += 3; this.lv.screwC -= 2;
    this.lv.recalculateTribrachPhysics();
    const st = this.cur;
    if (st) { st.back.read = undefined; st.back.truth = undefined; if (st.fore) { st.fore.read = undefined; st.fore.truth = undefined; } }
    // 尺回到後視點
    if (st && st.fore && this.rodAt === st.fore.pt) { this.rodAt = st.back.pt; this.placeAsstAtRod(); }
    if (st) st.fore = undefined;
    this.book(this.stations);
    ui.toast('阿黃撞到腳架了！儀器歪了，這一站要重新整平、重讀。', 'bad', 4500);
    this.nextHint();
  }

  // ================================================================
  // 交通錐 / 警察
  // ================================================================
  /** 交通錐有沒有擺對：作業區 (BM-1035 起) 後方、來車方向 (西) 的路邊，車子才會提早看到 */
  private coneValid(x: number, z: number): boolean {
    return x > this.bm1.x - 45 && x < this.bm1.x - 1 && z > ROAD_Z + 1.8 && z < ROAD_Z + 5.2;
  }

  /** 從擺的位置往來車方向 (西) 排一排 */
  private placeCones(x: number, z: number, borrowed: boolean, animate = false) {
    this.removeCones();
    const S = SM();
    const g = new THREE.Group();
    const n = borrowed ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const c = S.buildCone();
      const cx = x - i * 2.6;
      c.position.set(cx, this.sm.heightAt(cx, z), z);
      g.add(c);
      // 一個一個擺下去
      if (animate) { c.visible = false; setTimeout(() => { c.visible = true; sfx.thud(); }, 250 + i * 380); }
    }
    g.userData = { type: 'coneLine' };
    this.sm.scene.add(g);
    this.ensureInteractive(g, true);
    this.coneObj = g;
    const valid = borrowed || this.coneValid(x, z);
    this.cones = { x, z, borrowed, valid };
    sfx.thud();
    // 警察還在旁邊盯著：擺錯位置馬上念
    const cop = this.actors.find(x => x.kind === 'police' && x.state === 'pcones');
    if (!borrowed && !(cop && !valid)) ui.toast('交通錐擺好了。', 'good', 2200);
    if (cop && !borrowed && !valid) {
      this.face(cop, this.fd.app.player.position.x, this.fd.app.player.position.z);
      const lines = [
        '巡邏警員：「欸欸，擺那邊不對啦！要擺在作業區後面、車子開過來的那一側，讓來車先看到。」',
        '巡邏警員：「還是不對喔。車子是從西邊開過來的，錐要擺在你們工作的地方後面。」',
        '巡邏警員：「少年欸，交通錐是要提醒來車的，擺在你們前面車子都開到旁邊了才看到啦。」',
      ];
      this.copNag = (this.copNag || 0) + 1;
      setTimeout(() => ui.toast(lines[Math.min(lines.length - 1, this.copNag - 1)], 'warn', 4500), 600);
    }
    if (this.coneBlock && valid) { this.coneBlock = false; ui.toast('交通錐擺對了，可以繼續作業。', 'good', 2600); }
  }

  private removeCones() {
    if (!this.coneObj) return;
    this.sm.scene.remove(this.coneObj);
    this.ensureInteractive(this.coneObj, false);
    this.coneObj = null;
    this.cones = null;
  }

  /** 事件中不能作業的原因 */
  private workBlocked(): string | null {
    if (this.actors.some(a => a.kind === 'police' && ['pwait', 'talking', 'goto', 'seek'].includes(a.state)) && this.policeStage === 'come') return '警察走過來了，先跟他說明。';
    if (this.coneBlock && !this.cones?.valid) return '先把交通錐擺在作業區後面、來車的方向，才能繼續作業（警察交代的）。';
    return null;
  }

  private policeTick(dt: number, p: THREE.Vector3) {
    if (this.policeStage === 'wait' && this.policeT > 0) {
      this.policeT -= dt;
      if (this.policeT <= 0) this.spawnPolice();
    }
    const c = this.pcar;
    if (!c) return;
    c.update(dt, Math.hypot(p.x - c.x, p.z - c.z), null);
    if (c.stage === 'parked' && this.policeStage === 'come' && !this.actors.some(a => a.kind === 'police')) {
      const d = c.doorPos(), f = c.frontPos();
      const cop = this.spawn('police', d.x, d.z);
      this.goTo(cop, f.x, f.z, 1.6, () => { cop.state = 'seek'; cop.speed = 1.7; });
    }
    if (c.stage === 'gone') this.pcar = null;
  }

  /** 測試工具：交通錐狀態 none / wrong / ok，警車從近處開來 */
  debugPolice(cones: 'none' | 'nohave' | 'wrong' | 'ok') {
    const fd = this.fd;
    this.actors.filter(a => a.kind === 'police').forEach(a => this.removeActor(a));
    this.pcar?.dispose(); this.pcar = null;
    if (this.cones && !this.cones.borrowed) fd.spawnGround('cones', V(this.cones.x, this.sm.heightAt(this.cones.x, this.cones.z), this.cones.z), 0);
    this.removeCones();
    this.coneBlock = false; this.copNag = 0;
    if (cones === 'nohave') {
      // 現場 (手上、地上、後斗) 的交通錐全部拿走，當作忘在公司；貨架上留一組讓你回去拿
      let n = 0; while (fd.debugRemoveItem('cones', true) && n++ < 5) { /* */ }
      fd.debugPutOnShelf('cones');
    }
    else if (cones !== 'none') {
      fd.debugRemoveItem('cones');
      if (cones === 'wrong') this.placeCones(this.bm1.x + 22, ROAD_Z + 3.3, false);
      else this.placeCones(this.bm1.x - 12, ROAD_Z + 3.3, false);
    }
    this.policeStage = 'wait'; this.policeT = 0;
    this.spawnPolice(true);
  }

  private spawnPolice(near = false) {
    if (this.pcar || this.finished) return;
    const ix = this.inst ? this.inst.position.x : this.fd.app.player.position.x;
    const far = near ? 55 : 150;
    const lane = ROAD_Z + 1.7;
    const h = (x: number, z: number) => this.sm.heightAt(x, z);
    if (this.cones?.valid) {
      // 巡邏經過：看到交通錐就放心了
      this.pcar = new PoliceCar(this.sm.scene, h, { path: [[ix - Math.min(far, 140), lane], [ix - 25, lane], [ix + 15, lane], [ix + 260, lane]], slowFrom: 2, siren: false, pass: true });
      this.pcar.lights = false;
      this.policeStage = 'done';
      setTimeout(() => { if (this.fd.job !== 'level') return; ui.toast('一台警車慢慢經過，看到交通錐，警察比了個讚。', 'good', 3500); this.fd.addPR(1, '有擺交通錐，巡邏警車比讚'); }, near ? 4000 : 8500);
      return;
    }
    this.pcar = new PoliceCar(this.sm.scene, h, { path: [[ix - far, lane], [ix - 30, lane], [ix - 17, lane], [ix - 10, ROAD_Z + 3.3]], slowFrom: 2, siren: false, pass: false });
    this.policeStage = 'come';
    setTimeout(() => { if (this.policeStage === 'come') ui.toast('一台警車閃著燈，在你們後面的路肩停下來了……', 'warn', 3500); }, 7000);
  }

  private talkPolice(a: Actor) {
    const fd = this.fd;
    ui.faceSpeaker(a.g);
    const where = (fd as AnyObj).whereIs?.('cones');
    const wrong = !!this.cones && !this.cones.valid;
    const have = wrong || fd.carrying === 'cones' || where === 'site' || where === 'truck-here';
    const line = wrong
      ? '「你好，你們交通錐擺那邊沒有用喔。要擺在作業區後面、車子開過來的方向，讓來車提早看到、先切出去。哪個單位的？」'
      : '「你好，這裡是縣道，你們在路肩作業沒有擺交通錐，車子開過來很危險。哪個單位的？」';
    ui.showDialog('巡邏警員', line, [
      { id: 'ok', text: wrong ? '「不好意思，我馬上移過去。」' : have ? '「不好意思，我們馬上擺。」' : '「不好意思……交通錐沒帶，我回公司拿。」',
        reply: have ? '「好，擺好我再走。」' : '「那這段先停工，交通錐拿來擺好才能做。」',
        score: have ? 0 : -1, tag: wrong ? '交通錐擺錯位置，被警察提醒' : have ? '沒擺交通錐，被警察提醒' : '沒帶交通錐，被警察要求停工' },
      { id: 'plz', text: '「我們很快就好，通融一下啦。」',
        reply: wrong ? '「……勸導單一張。我車上的三角錐先幫你們擺在後面，你們那幾個收一收。下次擺對！」' : '「……勸導單一張。我車上有兩個三角錐先借你們擺，收工放著我再來收。下次自己帶！」',
        score: -2, tag: '沒擺交通錐，被開勸導單' },
      { id: 'argue', text: '「我們是公家委託的，不用吧？」',
        reply: '「公家也一樣要擺！勸導單，簽名。交通錐擺好才能繼續。」',
        score: -4, tag: '頂撞警察，被開勸導單' },
    ], (o) => {
      fd.addPR(o.score, o.tag);
      if (o.id === 'plz') {
        // 玩家自己擺錯的那排收回地上，換成警察的
        if (wrong && this.cones) { const c = this.cones; this.removeCones(); fd.spawnGround('cones', V(c.x, this.sm.heightAt(c.x, c.z), c.z), 0); }
        this.placeCones(this.bm1.x - 12, ROAD_Z + 3.3, true);
        this.policeGo(a);
      }
      else {
        this.coneBlock = true;
        if (have) a.state = 'pcones';
        else { fd.needItem('cones'); this.policeGo(a); }
      }
      this.relock();
    });
  }

  private policeGo(a: Actor) {
    const c = this.pcar;
    this.policeStage = 'done';
    if (!c) { this.removeActor(a); return; }
    const f = c.frontPos();
    this.goTo(a, f.x, f.z, 1.6, () => {
      const d = c.doorPos();
      this.goTo(a, d.x, d.z, 1.6, () => {
        this.removeActor(a);
        const lane = ROAD_Z + 1.7;
        c.leave([[c.x + 14, lane], [c.x + 280, lane]]);
      });
    });
  }

  // ================================================================
  // 大貨車經過：地面震動
  // ================================================================
  private spawnLorry() {
    if (!this.inst || this.lorry) return;
    const g = buildLorry();
    g.rotation.y = Math.PI; // 朝 -X
    const x = this.inst.position.x + 80, z = ROAD_Z - 1.7;
    g.position.set(x, this.sm.heightAt(x, z), z);
    this.sm.scene.add(g);
    this.lorry = g;
    this.rumble.start();
    sfx.honk(70);
  }

  private lorryTick(dt: number, p: THREE.Vector3) {
    this.vibe = Math.max(0, this.vibe - dt * 0.35);
    const g = this.lorry;
    if (!g) return;
    g.position.x -= 14 * dt;
    g.position.y = this.sm.heightAt(g.position.x, g.position.z);
    const ix = this.inst ? this.inst.position.x : p.x;
    this.vibe = Math.max(this.vibe, Math.max(0, 1 - Math.abs(g.position.x - ix) / 26));
    this.rumble.setDistance(Math.hypot(g.position.x - p.x, g.position.z - p.z));
    if (g.position.x < ix - 220) { this.sm.scene.remove(g); this.lorry = null; this.rumble.stop(); }
  }

  // ================================================================
  // 學弟出包：尺沒立在標石頂上
  // ================================================================
  private caughtWrong = false;
  private fixWrongRod() {
    const st = this.cur;
    ui.faceSpeaker(this.asst.g);
    ui.showDialog(`學弟${asstName()}`, '「學長？怎麼了？」', [
      { id: 'fix', text: `「${asstName()}，你尺立在地上啦！要立在標石頂上那個點。」`, reply: `「啊！歹勢歹勢，我以為放旁邊就好……」（學弟${asstName()}把尺移到標石頂上）`, score: 0, tag: '' },
      { id: 'no', text: '「沒事，加油。」', reply: '「好！」', score: 0, tag: '' },
    ], (o) => {
      if (o.id === 'fix') {
        this.rodWrong = false;
        this.caughtWrong = true;
        tell(`發現學弟${asstName()}的尺沒立在標石頂上，當場教他`, '那段重讀，學弟記住了');
        this.placeAsstAtRod();
        this.notes = this.notes.filter(n => n !== 'BM-1035 標尺沒立在標石頂上');
        if (st && st.back.pt === this.bm1 && st.back.read !== undefined) {
          st.back.read = undefined; st.back.truth = undefined;
          this.book(this.stations);
          ui.toast('剛剛讀的後視不能用，重讀一次。', 'warn', 3000);
        }
        this.nextHint();
      }
      this.relock();
    });
  }

  // ================================================================
  // 小朋友回訪：沒人顧的轉點尺墊
  // ================================================================
  /** 交換後、玩家拿起標尺之前，TP1 上只有標尺和尺墊 */
  private kidTarget(): Pt | null {
    const tp = this.tps[this.tps.length - 1];
    return tp && this.swapped && this.rodAt === tp ? tp : null;
  }

  private spawnKids() {
    if (this.kidsDone || this.finished) return;
    const tp = this.kidTarget();
    if (!tp) return;
    this.kidsDone = true;
    const kids = this.pr.kids;
    const k1 = this.spawn('kid', tp.x + 7, 66), k2 = this.spawn('kid', tp.x + 8.2, 67);
    if (kids === 'stopped') {
      k1.state = k2.state = 'kidGuard'; k2.cd = 0.9;
      ui.toast('昨天那兩個小朋友又來了，跑到 TP1 的尺墊旁邊……', 'info', 3500);
      return;
    }
    k1.state = k2.state = 'intro';
    if (bench.mode) bench.exit(false);
    if (levelScope.active) levelScope.close();
    const go = () => { k1.state = 'kidRush'; k2.state = 'kidFollow'; ui.toast('尺墊被動到就要從 BM-1035 重測！快去擋住小朋友！', 'warn', 4000); };
    if (this.fd.inTruck || document.querySelector('.field-modal')) { go(); return; }
    playBossIntro(this.fd.app, {
      subject: k1.g, target: V(tp.x, this.sm.heightAt(tp.x, tp.z), tp.z), eye: 0.95,
      name: kids === 'bumped' ? '昨天的小朋友 ×2' : '放學小朋友 ×2', sub: '目標：尺墊',
      tagline: kids === 'bumped' ? '「欸！那個鐵餅可以踢嗎？」' : '「那個鐵的是什麼？可以玩嗎？」',
    }, go);
  }

  private kidQTE(a: Actor) {
    if (qteActive()) return;
    this.endHold();
    const kids = this.actors.filter(x => x.kind === 'kid');
    const prev = kids.map(k => k.state);
    kids.forEach(k => { k.state = 'qte'; });
    ui.faceSpeaker(a.g);
    const pool = ['那個鐵餅可以踢嗎？', '我只是要摸一下！', '這個可以帶回家嗎？', '為什麼要放鐵餅在地上？', '我踢很準喔！', '哥哥小氣！'];
    runQTE({
      speaker: '小朋友（很盧）', lines: pool.sort(() => Math.random() - 0.5).slice(0, 4), onDone: (ok) => {
        if (!ok) {
          const tp = this.kidTarget();
          kids.forEach((k, i) => {
            k.state = prev[i] === 'kidFollow' ? 'kidFollow' : 'kidRush';
            k.cd = 2.5;
            if (tp) { const d = V(tp.x - k.g.position.x, 0, tp.z - k.g.position.z); if (d.length() > 1.6) k.g.position.addScaledVector(d.normalize(), 1.2); }
          });
          ui.toast('小朋友從你旁邊鑽過去了！快追上去擋住！', 'bad', 3000);
          this.relock();
          return;
        }
        kids.forEach(k => { k.state = 'listen'; k.t = 0; });
        ui.faceSpeaker(a.g);
        ui.showDialog('小朋友', '「好啦……那個到底是什麼？」', [
          { text: '「這叫尺墊，標尺要放在上面，動到就要整條重測喔。」', reply: '「喔～好啦，我們不碰。掰掰！」', score: 2, tag: '擋下想踢尺墊的小朋友，並解釋尺墊' },
          { text: '「走開走開。」', reply: '……（小朋友嘟著嘴跑掉了）', score: 1, tag: '擋下想踢尺墊的小朋友' },
        ], (o) => { this.fd.addPR(o.score, o.tag); this.kidsGo(); this.relock(); });
      },
    });
  }

  /** 對話講完，小朋友才走 */
  private kidsGo() { this.actors.filter(k => k.kind === 'kid').forEach(k => { k.state = 'kidLeave'; k.t = 0; }); }

  /** 尺墊被踢動：轉點高程作廢，從 BM-1035 重測 */
  private plateKicked() {
    const tp = this.kidTarget();
    this.actors.filter(k => k.kind === 'kid').forEach(k => { k.state = 'kidLeave'; k.t = 0; });
    sfx.thud();
    if (tp?.plate) { tp.plate.position.x += 0.35; tp.plate.rotation.y += 0.8; }
    this.notes.push('TP1 尺墊被小朋友踢動，從 BM-1035 重測');
    ui.toast('「碰！」尺墊被踢歪了！TP1 的高程不能用了，要從 BM-1035 重測……', 'bad', 6000);
    setTimeout(() => this.restartRoute(), 1500);
  }

  private restartRoute() {
    const fd = this.fd;
    this.endHold();
    if (levelScope.active) levelScope.close();
    if (fd.carrying === 'staff') fd.consumeHeld();
    const a = this.asst;
    // 儀器 (學弟扛著或已經架好) 放到地上，讓玩家重新架
    const ip = this.inst ? this.inst.position.clone() : a.g.position.clone();
    this.removeInst();
    this.carryVis.visible = false;
    fd.spawnGround('tripod', V(ip.x, this.sm.heightAt(ip.x, ip.z + 0.8), ip.z + 0.8), 0.3);
    fd.spawnGround('level', V(ip.x + 0.7, this.sm.heightAt(ip.x + 0.7, ip.z + 0.5), ip.z + 0.5), 0);
    this.tps.forEach(t => { if (t.plate) this.sm.scene.remove(t.plate); });
    this.tps = [];
    this.stations = [];
    this.rodAt = null; this.rodTilt = 0;
    this.swapped = false; this.aJob = ''; this.aT = 0; this.reloc = null; this.carrySet = false;
    this.havePlate = true; this.plPlates = false; this.haveStaff = true;
    this.ensureInteractive(this.staff, false);
    this.actors.filter(x => x.kind === 'rider').forEach(r => this.riderLeave(r));
    this.book(this.stations);
    a.state = 'idle';
    this.goTo(a, this.bm1.x + 0.3, this.bm1.z + 0.3, 1.8, () => this.holdAt(this.bm1));
    fd.panel('observe', `重測：儀器學弟${asstName()}放在地上了。扛腳架回藍圈架站，從 BM-1035 重新開始。`);
  }

  /** 有人站在視線上：望遠鏡被擋 (場景裡真的擋住，不用特別處理) */
  blockedBy(): string | null { return this.blocker ? (this.blocker.kind === 'rider' ? '騎士' : '阿伯') : null; }

  // ================================================================
  // 結束
  // ================================================================
  private finishRoute() {
    const fd = this.fd;
    this.finished = true;
    this.actors.filter(x => x.kind === 'rider').forEach(r => this.riderLeave(r));
    this.endHold();
    this.aJob = '';
    this.clearArrows();
    this.ensureInteractive(this.staff, false);
    this.book(this.stations, true);
    ui.toast(`測到 BM-1036 了！閉合差 ${this.misclosureMm().toFixed(1)} mm。收工！`, 'good', 5000);
    // 轉點的尺墊都收起來了；玩家一手標尺、一手尺墊
    this.tps.forEach(t => { if (t.plate) { this.sm.scene.remove(t.plate); t.plate = null; } });
    this.rodAt = null;
    this.haveStaff = false; this.havePlate = false; this.plPlates = false;
    if (!fd.carrying) fd.hold('staff');
    else { const p = fd.app.player.position; fd.spawnGround('staff', V(p.x + 0.8, this.sm.heightAt(p.x + 0.8, p.z), p.z), 0); }
    fd.setExtra('plate');
    // 學弟：扛腳架 + 水準儀，拿著手簿 (工具袋) 回車上
    const a = this.asst;
    const ip = this.inst ? this.inst.position.clone() : a.g.position.clone();
    const bag = fd.takeGroundItem('toolbag', ip, 45);
    this.goTo(a, ip.x - 0.5, ip.z + 0.3, 1.6, () => {
      this.removeInst();
      this.carryHome = true;
      ui.toast(`學弟${asstName()}：「尺跟尺墊學長你拿，儀器${bag ? '和手簿' : ''}我扛回車上！」`, 'info', 3500);
      const t = fd.truck.toWorld(-3.4, 0, 0.9);
      this.goTo(a, t.x, t.z, 2.0, () => {
        this.carryHome = false;
        const items: ('tripod' | 'level' | 'toolbag')[] = ['tripod', 'level'];
        if (bag) items.push('toolbag');
        const failed = items.filter(it => !fd.autoLoad(it));
        failed.forEach((it, k) => fd.spawnGround(it, V(t.x + k * 0.6, this.sm.heightAt(t.x + k * 0.6, t.z + 0.5), t.z + 0.5), 0));
        ui.toast(failed.length ? `學弟${asstName()}：「後斗塞不下，我放車尾地上了。」` : `學弟${asstName()}：「腳架、水準儀${bag ? '、手簿' : ''}都放上後斗了！學長，尺跟尺墊交給你囉。」`, 'info', 3800);
        a.state = 'follow';
      });
    });
    fd.setPhase('packup');
  }

  // ================================================================
  // 交換角色：學弟操作儀器、玩家扶尺
  // ================================================================
  private offerSwap() {
    if (this.swapped || this.finished) return;
    ui.faceSpeaker(this.asst.g);
    ui.showDialog(`學弟${asstName()}`, '「學長～這台電子水準好酷，我也想操作看看！換你扶尺好不好？我會好好架站的。」', [
      { text: '「好啊，換你。扶尺我來。」', reply: '「耶！學長你先去 TP1 扶尺，我把儀器搬過去。」', score: 0, tag: '', id: 'a' },
      { text: '「……好啦，腳架小心一點。」', reply: '「放心啦！」', score: 0, tag: '', id: 'b' },
    ], () => { this.doSwap(); this.relock(); });
  }

  private doSwap() {
    this.swapped = true;
    if (!this.kidsDone) setTimeout(() => this.spawnKids(), 5000);
    // 賴著不走的騎士：朋友終於來了
    this.actors.filter(x => x.kind === 'rider').forEach(r => setTimeout(() => { this.riderLeave(r); ui.toast('騎士的朋友終於來了，兩台機車一起騎走。', 'info', 2500); }, 2500));
    this.plPlates = this.havePlate;
    this.havePlate = false;
    this.ensureInteractive(this.staff, true);
    if (this.plPlates) ui.toast(`學弟${asstName()}把兩個尺墊交給你。轉點立尺時會自動墊上。`, 'info', 3500);
    else ui.toast(`（尺墊不在學弟${asstName()}身上，轉點只能直接立在土上……）`, 'warn', 3500);
    const a = this.asst;
    a.state = 'idle';
    this.aJob = 'toInst';
    const ip = this.inst ? this.inst.position : a.g.position;
    this.goTo(a, ip.x - 0.6, ip.z + 0.4, 1.8, () => { this.removeInst(); this.goNextStation(); });
    this.swapHint();
  }

  /** 學弟扛著儀器去下一站：後視點 = 尺目前所在 */
  private goNextStation() {
    const B = this.rodAt;
    if (!B) return;
    const rem = Math.hypot(this.bm2.x - B.x, this.bm2.z - B.z);
    // 只剩一站：架在轉點和 BM-1036 正中間；被擋到就往旁邊挪一點
    const mx = (B.x + this.bm2.x) / 2, mz = (B.z + this.bm2.z) / 2;
    let sx = mx, sz = mz + 0.6;
    for (const [ox, oz] of [[0, 0.6], [0, -0.4], [0, 1.6], [1.5, 0.6], [-1.5, 0.6], [0, 2.6], [2.5, 1.6], [-2.5, 1.6]]) {
      const x = mx + ox, z = mz + oz, y = this.sm.heightAt(x, z) + 1.42;
      if (this.spotBlocked(x, z)) continue;
      if (this.sightBlocked(B, { x, z, y }) || this.sightBlocked(this.bm2, { x, z, y })) continue;
      sx = x; sz = z; break;
    }
    this.aJob = 'toStation';
    this.goTo(this.asst, sx - 0.6, sz, 1.6, () => {
      this.placeInst(sx, sz, true);
      this.stations.push({ x: sx, z: sz, back: { pt: B, dist: Math.hypot(B.x - sx, B.z - sz) } });
      this.aJob = 'leveling'; this.aT = 3;
      this.asstBehindInst(B);
      this.book(this.stations);
      ui.toast(`（對講機）「我架在這了，整平一下。這站前視直接放 BM-1036！（${rem.toFixed(0)} m）」`, 'info', 3000);
      this.swapHint();
    });
    this.swapHint();
  }

  private asstBehindInst(look: Pt) {
    if (!this.inst) return;
    const d = V(look.x - this.inst.position.x, 0, look.z - this.inst.position.z).normalize();
    const x = this.inst.position.x - d.x * 0.55, z = this.inst.position.z - d.z * 0.55;
    this.asst.g.position.set(x, this.sm.heightAt(x, z), z);
    this.asst.state = 'idle';
    this.face(this.asst, look.x, look.z);
  }

  private readyFor(pt: Pt): boolean {
    const st = this.cur;
    if (!st) return false;
    return (['waitBack', 'readBack'].includes(this.aJob) && st.back.pt === pt) || (['waitFore', 'readFore'].includes(this.aJob) && st.fore?.pt === pt);
  }
  /** 後視讀完、前視還沒放：可以拿起尺往前走 */
  private canPickRod(): boolean {
    const st = this.cur;
    return !!st && this.aJob === 'waitFore' && !st.fore && this.rodAt === st.back.pt && st.back.read !== undefined;
  }

  private pickUpRod() {
    this.endHold();
    const r = this.rodAt;
    if (r && r.kind === 'tp' && r.plate) { this.sm.scene.remove(r.plate); r.plate = null; ui.toast('順手把尺墊也撿起來帶著。', 'info', 2200); }
    this.rodAt = null;
    this.ensureInteractive(this.staff, false);
    this.fd.hold('staff');
    this.swapHint();
  }

  private asstTick(dt: number) {
    const st = this.cur;
    const radio = (t: string) => { if (this.time - this.remindT > 9) { this.remindT = this.time; ui.toast(`（對講機）${t}`, 'info', 3200); } };
    switch (this.aJob) {
      case 'leveling':
        this.aT -= dt;
        if (this.aT <= 0 && st) {
          Object.assign(this.lv, { bx0: 0, by0: 0, screwA: 0, screwB: 0, screwC: 0 });
          this.lv.recalculateTribrachPhysics();
          this.instState = 'leveled';
          this.aimAt(st.back.pt);
          this.aJob = 'waitBack';
          this.remindT = -99;
          radio(`「整平好了！學長，${st.back.pt.name} 扶尺，我要讀後視。」`);
          this.swapHint();
          if (this.stations.length >= 2 && !this.dogDone) this.maybeDog();
        }
        return;
      case 'waitBack':
      case 'waitFore': {
        if (!st) return;
        const pt = this.aJob === 'waitBack' ? st.back.pt : st.fore?.pt;
        if (pt && this.hold && this.hold.pt === pt) {
          this.aimAt(pt);
          this.aJob = this.aJob === 'waitBack' ? 'readBack' : 'readFore';
          this.aT = 2.6 + READ_PREP; // 先喊一聲「要讀囉」，再開始讀
          ui.toast(`（對講機）「好，${this.aJob === 'readBack' ? '後視' : '前視'}要讀囉——扶穩！」`, 'info', 2000);
          if (this.hold) { this.hold.sum = 0; this.hold.n = 0; }
          return;
        }
        if (this.aJob === 'waitBack') radio(`「學長，回 ${st.back.pt.name} 扶尺啦！」`);
        else if (!st.fore && this.rodAt) radio('「後視好了，尺拿起來往前放前視點！」');
        return;
      }
      case 'readBack':
      case 'readFore': {
        if (!st) return;
        const back = this.aJob === 'readBack';
        const obs = back ? st.back : st.fore!;
        if (!this.hold || this.hold.pt !== obs.pt) { this.aJob = back ? 'waitBack' : 'waitFore'; ui.toast('（對講機）「欸欸還沒讀好！」', 'warn', 2200); return; }
        if (this.blocker && this.blockingLine(obs.pt)) { radio('「有人擋住視線了，學長你去跟他說一下！」'); return; }
        this.aT -= dt;
        if (this.aT > 0) return;
        const h = this.hold;
        const avg = h.n ? h.sum / h.n : 0;
        this.holdLog.push(avg);
        this.rodTilt = avg * 0.05;
        obs.dist = this.dist(obs.pt);
        const v = this.trueRead(obs.pt) + (Math.random() - 0.5) * 0.0003;
        if (avg > 0.6) this.notes.push(`${obs.pt.name} 標尺沒扶直`);
        this.endHold(`✓ ${back ? '後視' : '前視'}讀好了：${v.toFixed(4)} m`);
        sfx.pickup();
        ui.toast(`（對講機）「${back ? '後視' : '前視'} ${v.toFixed(4)}，好了！${avg > 0.6 ? '……尺有點歪喔。' : ''}」`, avg > 0.6 ? 'warn' : 'good', 3000);
        this.aJob = back ? 'waitFore' : 'done';
        this.record(obs, v, back);
        this.rodTilt = 0;
        this.swapHint();
        return;
      }
    }
  }

  private swapHint() {
    const st = this.cur;
    const where = this.rodAt ? this.rodAt.name : '標尺';
    const h: Record<string, string> = {
      toInst: `學弟${asstName()}去搬儀器了。你先到 ${where} 扶尺（對著標尺按 E）。`,
      toStation: `學弟${asstName()}正在架下一站。你到 ${where} 準備扶尺。`,
      leveling: `學弟${asstName()}在整平。你到 ${where} 準備扶尺。`,
      waitBack: `對著 ${st?.back.pt.name || '標尺'} 的標尺按 E 扶尺，讓學弟${asstName()}讀後視。`,
      readBack: `扶好尺！WASD 把尺上的氣泡壓在圈裡，學弟${asstName()}正在讀後視。`,
      waitFore: this.fd.carrying === 'staff'
        ? '拿著標尺走到 BM-1036（紅色箭頭）按 E 立尺。'
        : '後視讀好了。對著標尺按 E 拿起來，往前找前視點。',
      readFore: `扶好尺！學弟${asstName()}正在讀前視。`,
    };
    this.fd.panel('observe', h[this.aJob] || `跟著學弟${asstName()}的對講機指示。`);
  }

  // ---------------------------------------------------------------- 扶尺小遊戲
  private holdKeys = { u: false, d: false, l: false, r: false };
  private onHoldKey: ((e: KeyboardEvent) => void) | null = null;

  private startHold(pt: Pt) {
    if (this.hold) return;
    const p = this.fd.app.player.position;
    if (Math.hypot(p.x - pt.x, p.z - pt.z) > 3) { ui.toast('走近一點才扶得到尺。', 'info'); return; }
    const el = document.createElement('div');
    el.className = 'rodhold enter';
    el.innerHTML = `
      <div class="rh-title">扶尺　${pt.name}</div>
      <div class="rh-vial"><i class="rh-ring"></i><b class="rh-bub"></b></div>
      <div class="rh-prog"><i></i></div>
      <div class="rh-msg"></div>
      <div class="rh-keys"><kbd class="cap">W</kbd><kbd class="cap">A</kbd><kbd class="cap">S</kbd><kbd class="cap">D</kbd> 把氣泡壓在圈裡　<kbd class="cap">E</kbd> 放手</div>`;
    document.body.appendChild(el);
    document.body.classList.add('bench-active', 'rod-holding');
    this.hold = { pt, bx: (Math.random() - 0.5) * 0.6, by: (Math.random() - 0.5) * 0.6, vx: 0, vy: 0, sum: 0, n: 0, el };
    this.holdKeys = { u: false, d: false, l: false, r: false };
    this.onHoldKey = (e: KeyboardEvent) => {
      const down = e.type === 'keydown';
      const m: Record<string, keyof typeof this.holdKeys> = { KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
      if (document.querySelector('.field-modal')) return;
      if (m[e.code]) { this.holdKeys[m[e.code]] = down; e.preventDefault(); e.stopPropagation(); return; }
      if (down && (e.code === 'KeyE' || e.code === 'Escape')) { e.preventDefault(); e.stopPropagation(); this.endHold(); this.swapHint(); }
    };
    window.addEventListener('keydown', this.onHoldKey, true);
    window.addEventListener('keyup', this.onHoldKey, true);
    // 視角會在 holdTick 裡平滑地一直鎖定學弟
    this.swapHint();
  }

  /** 結束扶尺：有 msg 時先顯示結果一下再淡出；沒有就直接淡出 */
  private endHold(msg?: string) {
    if (!this.hold) return;
    const el = this.hold.el;
    this.hold = null;
    el.classList.remove('enter', 'ready');
    if (msg) {
      const m = el.querySelector('.rh-msg') as HTMLElement | null;
      if (m) m.textContent = msg;
      const pg = el.querySelector('.rh-prog i') as HTMLElement | null;
      if (pg) pg.style.width = '100%';
      el.classList.add('done');
      setTimeout(() => { el.classList.add('leave'); setTimeout(() => el.remove(), 320); }, 1000);
    } else {
      el.classList.add('leave');
      setTimeout(() => el.remove(), 320);
    }
    document.body.classList.remove('bench-active', 'rod-holding');
    if (this.onHoldKey) { window.removeEventListener('keydown', this.onHoldKey, true); window.removeEventListener('keyup', this.onHoldKey, true); }
    this.onHoldKey = null;
  }

  private holdTick(dt: number) {
    const h = this.hold;
    if (!h) return;
    const k = this.holdKeys;
    // 風吹 + 手抖：隨機推力；玩家用 WASD 修正
    const gust = 1.4 + Math.sin(this.time * 0.7) * 0.6;
    h.vx += ((Math.random() - 0.5) * gust + ((k.r ? 1 : 0) - (k.l ? 1 : 0)) * 2.4) * dt;
    h.vy += ((Math.random() - 0.5) * gust + ((k.d ? 1 : 0) - (k.u ? 1 : 0)) * 2.4) * dt;
    const damp = Math.pow(0.3, dt);
    h.vx *= damp; h.vy *= damp;
    h.bx += h.vx * dt * 2; h.by += h.vy * dt * 2;
    const r = Math.hypot(h.bx, h.by);
    if (r > 1) { h.bx /= r; h.by /= r; h.vx *= 0.3; h.vy *= 0.3; }
    const busy = this.aJob === 'readBack' || this.aJob === 'readFore';
    const prep = busy && this.aT > 2.6;
    const reading = busy && !prep;
    if (reading) { h.sum += Math.min(1, Math.hypot(h.bx, h.by)); h.n++; }
    h.el.classList.toggle('ready', prep);
    this.trackAsst(dt);
    const bub = h.el.querySelector('.rh-bub') as HTMLElement;
    bub.style.transform = `translate(${h.bx * 46}px, ${h.by * 46}px)`;
    bub.classList.toggle('ok', Math.hypot(h.bx, h.by) < 0.28);
    const prog = h.el.querySelector('.rh-prog i') as HTMLElement;
    prog.style.width = reading ? `${Math.round((1 - Math.max(0, this.aT) / 2.6) * 100)}%` : '0%';
    const msg = h.el.querySelector('.rh-msg') as HTMLElement;
    const blocked = this.blocker && this.blockingLine(h.pt);
    msg.textContent = blocked ? '視線被擋住了！' : prep ? `學弟${asstName()}：「要讀囉——扶穩！」` : reading ? `學弟${asstName()}讀數中……` : this.readyFor(h.pt) ? `學弟${asstName()}準備讀數` : `等學弟${asstName()}準備好……`;
  }

  /** 扶尺時視角平滑鎖定學弟 (他在走路也跟著轉)：指數平滑 + 角速度上限，避免頭暈 */
  private trackAsst(dt: number) {
    const p = this.fd.app.player as AnyObj;
    const a = this.asst.g;
    if (!a.visible || p.externalControl) return;
    const eye = p.position as THREE.Vector3;
    const dx = a.position.x - eye.x, dz = a.position.z - eye.z;
    const flat = Math.hypot(dx, dz);
    if (flat < 0.5) return;
    const yaw1 = Math.atan2(-dx, -dz);
    const pitch1 = Math.max(-0.5, Math.min(0.3, Math.atan2(a.position.y + 1.45 - eye.y, flat) - 0.06));
    let dyaw = (yaw1 - p.euler.y) % (Math.PI * 2);
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const k = 1 - Math.exp(-dt * 3.2);
    const maxStep = 1.6 * dt; // 每秒最多轉 1.6 rad
    p.euler.y += Math.max(-maxStep, Math.min(maxStep, dyaw * k));
    p.euler.x += Math.max(-maxStep, Math.min(maxStep, (pitch1 - p.euler.x) * k));
    p.camera.quaternion.setFromEuler(p.euler);
  }

  private sumDh(): number {
    return this.stations.reduce((s, st) => s + ((st.back.read ?? 0) - (st.fore?.read ?? 0)), 0);
  }
  private knownDh(): number { return this.bm2.top - this.bm1.top; }
  private misclosureMm(): number { return (this.sumDh() - this.knownDh()) * 1000; }

  /** 收工時：記下要帶到第三天的事 */
  crossDay() {
    const missed = this.wrongDone && !this.caughtWrong;
    if (missed) { tell(`沒發現學弟${asstName()}的尺立在地上`, 'BM-1035 那段高程有誤差'); whatIf('如果注意到學弟的尺沒立在標石頂上、當場教他，那段就不會錯，他也會記住。'); }
    return { uncle2: this.uncle2, mentor2: this.mentor + (this.caughtWrong ? 1 : 0) - (missed ? 1 : 0), asst2: asstName() };
  }

  reportRow(): ReportRow {
    const obs = this.stations.flatMap(s => [s.back, s.fore]).filter((o): o is Obs => !!o && o.read !== undefined);
    if (!this.finished || !obs.length) return { label: '水準觀測品質', detail: '路線沒有測完', delta: 0 };
    const hl = this.holdLog;
    const tiltAvg = hl.length ? hl.reduce((a, b) => a + b, 0) / hl.length : 0.3;
    const readPts = tiltAvg <= 0.25 ? 15 : tiltAvg <= 0.45 ? 10 : tiltAvg <= 0.7 ? 5 : 2;
    const bal = this.stations.map(s => Math.abs((s.back.dist || 0) - (s.fore?.dist || 0)));
    const okBal = bal.filter(b => b <= 2).length;
    const balPts = Math.round(10 * okBal / Math.max(1, bal.length));
    const w = Math.abs(this.misclosureMm());
    const wPts = w <= 3 ? 15 : w <= 6 ? 9 : w <= 12 ? 4 : 0;
    if (this.coneObj && !this.cones?.borrowed) this.notes.push('交通錐留在現場沒收');
    else if (this.cones && !this.cones.valid) this.notes.push('交通錐擺錯位置');
    const extra = [...new Set(this.notes.filter(n => n !== '補償器警示'))];
    const serious = extra.filter(n => /震動中讀數|沒立在標石|踢動|沒放尺墊|撞到腳架|交通錐留在/.test(n)).length;
    const pen = Math.min(12, serious * 3);
    const detail = `${this.stations.length} 站；閉合差 ${this.misclosureMm().toFixed(1)} mm（限 3 mm）；扶尺${hl.length ? `平均偏離 ${Math.round(tiltAvg * 100)}%` : '（沒扶到尺）'}；視距差合格 ${okBal}/${bal.length} 站${extra.length ? '；' + extra.join('、') : ''}`;
    const bonus = this.caughtWrong ? 3 : 0;
    return { label: '水準觀測品質', detail: detail + (this.caughtWrong ? `；發現學弟${asstName()}尺沒立在標石上並更正` : ''), delta: Math.max(0, readPts + balPts + wPts - pen + bonus) };
  }

  obstacles(): Circle[] {
    const o: Circle[] = this.bms.map(b => ({ x: b.pt.x, z: b.pt.z, r: 0.5, tag: '水準點' }));
    this.actors.forEach(a => { if (a.g.visible) o.push({ x: a.g.position.x, z: a.g.position.z, r: a.kind === 'dog' ? 0.4 : 0.5, tag: a.kind === 'dog' ? '狗' : '路人' }); });
    if (this.inst) o.push({ x: this.inst.position.x, z: this.inst.position.z, r: 0.7, tag: '水準儀' });
    return o;
  }

  // ================================================================
  // 水準手簿 (畫面右側)
  // ================================================================
  private book(stations: Station[] | null, done = false) {
    let b = document.getElementById('level-book');
    if (!stations || this.fd.job !== 'level') { b?.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'level-book'; b.className = 'level-book paper'; document.body.appendChild(b); }
    const f = (v?: number) => (v === undefined ? '' : v.toFixed(3));
    const rows = stations.map((s, i) => {
      const dh = s.back.read !== undefined && s.fore?.read !== undefined ? s.back.read - s.fore.read : undefined;
      const bd = s.back.dist ? s.back.dist.toFixed(1) : '';
      const fdist = s.fore?.dist ? s.fore.dist.toFixed(1) : '';
      const diff = s.back.dist && s.fore?.dist ? Math.abs(s.back.dist - s.fore.dist) : undefined;
      return `<tr><td>${i + 1}</td><td>${s.back.pt.name}</td><td class="hand">${f(s.back.read)}</td><td>${s.fore?.pt.name || ''}</td><td class="hand">${f(s.fore?.read)}</td><td class="hand">${dh === undefined ? '' : (dh >= 0 ? '+' : '') + dh.toFixed(3)}</td><td class="${diff !== undefined && diff > 2 ? 'bad' : ''}">${bd}${fdist ? ' / ' + fdist : ''}</td></tr>`;
    }).join('');
    const sum = this.sumDh();
    b.innerHTML = `
      <div class="lb-head"><strong>水準手簿</strong><span>BM-1035 H = ${H1.toFixed(4)} m</span></div>
      <table><thead><tr><th>站</th><th>後視點</th><th>後視</th><th>前視點</th><th>前視</th><th>高差</th><th>視距 後/前</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="lb-empty">還沒架站</td></tr>'}</tbody></table>
      ${done ? `<div class="lb-foot">Σ高差 ${(sum >= 0 ? '+' : '') + sum.toFixed(4)} m　已知 ${(this.knownDh() >= 0 ? '+' : '') + this.knownDh().toFixed(4)} m<br><strong>閉合差 ${this.misclosureMm().toFixed(1)} mm</strong>（限 3 mm）${Math.abs(this.misclosureMm()) <= 3 ? '　<em class="ok">合格</em>' : '　<em class="bad">超限</em>'}</div>` : ''}`;
  }
}

