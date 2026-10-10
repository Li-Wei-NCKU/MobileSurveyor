/**
 * 外業一日 (Field Day) 主控制器
 * 流程：派工單 → 倉庫整備儀器裝車 → 開車到現場 → 卸貨架設 → GNSS 靜態觀測 → 收工清點 → 開回公司 → 成果報告書
 * 以「關卡物件」介面掛在舊版 app.levelsMap.field，沿用 player 的準心互動。
 */
import { bench } from './bench';
import { cineActive } from './cine';
import { levelScope } from './scope';
import { dust } from './fx';
import * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';
import { ITEMS, type ItemId } from './items';
import { TrunkGrid, type Placed } from './trunk';
import { buildItemModel } from './itemModels';
import { FieldTruck, type Circle } from './truck';
import { TrafficVehicle, buildPerson, animateWalk, ROAD_Z } from './npc';
import { buildYard, YARD, TRUCK_HOME, CKSV, type ShelfSpot } from './world';
import * as ui from './ui';
import * as sfx from './sfx';
import { Navigator } from './nav';
import { SiteEvents } from './siteEvents';
import { ambient, menuMusic, gameMusic } from './sound';
import { CarRadio } from './radio';
import { JOBS, saveProgress, loadProgress, type JobId, type JobDef } from './jobs';
import { resetStory, getStory, storySnapshot, storyRestore } from './story';
import { showEnding } from './ending';
import { LevelJob } from './levelJob';
import { GcpJob } from './gcpJob';

/** 手機版任務指引的目標 */
export interface GuideTarget { x: number; z: number; label: string; reach?: number; obj?: THREE.Object3D; item?: ItemId }

export type Phase = 'brief' | 'prep' | 'toSite' | 'site' | 'observe' | 'packup' | 'return' | 'done';

export interface GroundItem { uid: number; item: ItemId; obj: THREE.Group }

export const PHASE_STEP: Record<Phase, number> = { brief: 0, prep: 1, toSite: 2, site: 3, observe: 4, packup: 5, return: 6, done: 7 };

let uidSeq = 1000;

export class FieldDay {
  id = 'field';
  /** 今天的派工 (主選單選的) */
  job: JobId = 'gnss';
  get J(): JobDef { return JOBS[this.job]; }
  get title() { return this.J.title; }
  /** 第二天：水準 */
  lv!: LevelJob;
  /** 第三天：航測控制點 */
  gcp!: GcpJob;
  /** 第二天以後的工作 (第一天用舊版 GNSS 關卡 + SiteEvents) */
  get sub(): LevelJob | GcpJob | null { return this.job === 'level' ? this.lv : this.job === 'gcp' ? this.gcp : null; }

  phase: Phase = 'brief';
  private built = false;
  truck!: FieldTruck;
  grid = new TrunkGrid();
  private trunkMeshes = new Map<number, THREE.Group>();
  ground: GroundItem[] = [];
  private shelfSpots: (ShelfSpot & { uid: number | null })[] = [];
  private shelfBoards: THREE.Object3D[] = [];
  private yardColliders: Circle[] = [];
  private yardOcc: { roof: THREE.Object3D | null; walls: THREE.Mesh[] } = { roof: null, walls: [] };
  carrying: ItemId | null = null;
  held: THREE.Group | null = null;
  /** 另一隻手拎著的東西 (例如收工時標尺 + 鐵墊一起拿)：手上那件放好後自動換成這件 */
  extraCarry: ItemId | null = null;
  private heldExtra: THREE.Group | null = null;
  inTruck = false;
  private traffic: TrafficVehicle[] = [];
  interactives: THREE.Object3D[] = [];
  private origCompleteLevel: AnyObj = null;
  private origUpdatePanel: AnyObj = null;
  private time = 0;
  private nav!: Navigator;
  private radio = new CarRadio();
  private radioHinted = false;
  private radioList = false;

  // GNSS 架設子步驟
  private tripodSet = false;
  private tribrachOn = false;
  private receiverOn = false;
  private toolbagOn = false;

  // 現場事件 (路人、小孩、狗、地主/里長、阿姨、組長來電)
  private events!: SiteEvents;

  // 水分 (台灣夏天外業)
  private water = 100;
  private bottles = 24;
  private thirstWarned = false;
  private drinks = 0;

  // 計分
  m = {
    crashes: 0, crashLog: [] as string[], illegalPark: 0, honked: 0,
    forgot: new Set<ItemId>(), returnTrips: 0, atYardCounted: false,
    pr: [] as { score: number; tag: string }[], gnssScore: 0, warnedLeft: false,
    gnssNotes: [] as string[],
  };
  private lastCrash = 0;
  private lastHonkToast = 0;

  constructor(public app: GameApp) {}

  /** 更新手簿面板 (今天的任務清單) */
  panel(step: Phase, hint: string) {
    let i = PHASE_STEP[step];
    if (this.job === 'gcp' && i >= 5) i++; // 第三天多一項「下午航拍」
    this.app.updateMissionPanel(this.title, this.J.tasks.map((t, k) => ({ id: k, text: t })), i, hint);
  }
  addPR(score: number, tag: string) { this.m.pr.push({ score, tag }); }

  // ================================================================
  // 生命週期
  // ================================================================
  start() {
    menuMusic.stop();
    gameMusic.start();
    const sm = this.app.sceneManager;
    sm.clearDynamicProps();
    sm.setVisibleFloatingPoints([]);
    document.body.classList.add('mode-field');
    if (!this.built) this.buildOnce();
    sm.parkedTruck.visible = false;
    (sm.siteProps || []).forEach((p: THREE.Object3D) => { p.visible = false; });
    this.truck.group.visible = true;
    this.traffic.forEach(t => { t.group.visible = true; });

    // 重置狀態
    this.resetRun();

    // 玩家站在器材室前
    const p = this.app.player;
    p.externalControl = null;
    p.position.set(YARD.x + 3.5, sm.heightAt(YARD.x, YARD.z) + 1.65, YARD.z + 1.5);
    p.euler.set(-0.12, Math.PI - 0.35, 0); // 面向器材室與作業車
    p.camera.position.copy(p.position);
    p.camera.quaternion.setFromEuler(p.euler);

    // 攔截關卡完成 (GNSS 觀測完成時進入收工)
    if (!this.origCompleteLevel) this.origCompleteLevel = this.app.completeLevel.bind(this.app);
    this.app.completeLevel = (id: string, data: AnyObj) => {
      if (this.app.currentLevelObj === this && id === 'gnss') this.onGnssDone(data);
      else this.origCompleteLevel(id, data);
    };

    // 舊關卡更新手簿時，標題改為外業一日的子任務
    if (!this.origUpdatePanel) this.origUpdatePanel = this.app.updateMissionPanel.bind(this.app);
    this.app.updateMissionPanel = (title: string, tasks: AnyObj, active: number, hint: string) => {
      const t = this.app.currentLevelObj === this && title !== this.title ? (this.job === 'gnss' ? '外業一日：CKSV 儀器操作' : this.title) : title;
      this.origUpdatePanel(t, tasks, active, hint);
    };

    ui.setControls('walk');
    this.setPhase('brief');
    ui.showWorkOrder(this.J.workOrder, () => this.setPhase('prep'));
  }

  stop() {
    const sm = this.app.sceneManager;
    ambient.set({ scene: 'off' }); ambient.update(0.016);
    gameMusic.stop();
    document.body.classList.remove('mode-field');
    document.querySelectorAll('.field-modal').forEach(e => e.remove());
    this.dropHeld(true);
    this.setExtra(null);
    this.exitTruck(true);
    this.clearGround();
    this.clearTrunk();
    this.events?.reset();
    this.lv?.reset();
    this.gcp?.stopAll();
    document.body.classList.remove('thirsty');
    this.truck.group.visible = false;
    this.traffic.forEach(t => { t.group.visible = false; });
    sm.parkedTruck.visible = true;
    (sm.siteProps || []).forEach((p: THREE.Object3D) => { p.visible = true; });
    if (this.origCompleteLevel) this.app.completeLevel = this.origCompleteLevel;
    if (this.origUpdatePanel) this.app.updateMissionPanel = this.origUpdatePanel;
    this.origUpdatePanel = null;
    this.origCompleteLevel = null;
    ui.setControls('default');
    ui.setHud({});
    ui.setNav(null);
    this.nav?.setRoute(null);
    this.radio.power(false);
    ui.setRadioPanel(null);
  }

  private buildOnce() {
    const sm = this.app.sceneManager;
    const yard = buildYard(sm);
    this.shelfSpots = yard.spots.map(s => ({ ...s, uid: null }));
    this.shelfBoards = yard.boards;
    this.yardColliders = yard.colliders;
    this.yardOcc = { roof: yard.roof, walls: yard.walls };
    this.truck = new FieldTruck((x, z) => sm.heightAt(x, z));
    sm.scene.add(this.truck.group);
    this.traffic = [
      new TrafficVehicle('car', -1, 11, 160, (x, z) => sm.heightAt(x, z), 0x455a64),
      new TrafficVehicle('car', 1, 10, -330, (x, z) => sm.heightAt(x, z), 0xb71c1c),
      new TrafficVehicle('scooter', 1, 8.5, -60, (x, z) => sm.heightAt(x, z)),
    ];
    this.traffic.forEach(t => sm.scene.add(t.group));
    this.nav = new Navigator(sm);
    dust.init(sm.scene);
    this.lv = new LevelJob(this);
    this.gcp = new GcpJob(this);
    this.events = new SiteEvents({
      app: this.app,
      phase: () => this.phase,
      inTruck: () => this.inTruck,
      playerPos: () => this.app.player.position,
      toolbagNear: () => this.toolbagNear(),
      addPR: (score, tag) => { this.m.pr.push({ score, tag }); },
      hydrate: (amt, label) => this.hydrate(amt, label),
      truckSpeed: () => this.truck.speed,
      radioPause: () => this.radio.pauseForExit(),
      radioResume: () => { if (this.inTruck) this.radio.resumeOnEnter(); },
      truckPos: () => ({ x: this.truck.pos.x, z: this.truck.pos.z }),
    });
    if (!sm.camera.parent) sm.scene.add(sm.camera); // 讓手持物品 (掛在攝影機下) 可被渲染
    this.built = true;
  }

  private resetRun() {
    this.clearGround();
    this.clearTrunk();
    this.dropHeld(true);
    this.setExtra(null);
    this.inTruck = false;
    this.tripodSet = this.tribrachOn = this.receiverOn = this.toolbagOn = false;
    this.events.reset();
    this.lv.reset();
    this.gcp.reset();
    this.m = { crashes: 0, crashLog: [], illegalPark: 0, honked: 0, forgot: new Set(), returnTrips: 0, atYardCounted: false, pr: [], gnssScore: 0, warnedLeft: false, gnssNotes: [] };
    resetStory();
    this.water = 100; this.bottles = 24; this.thirstWarned = false; this.drinks = 0;
    document.body.classList.remove('thirsty');
    this.truck.setPose(TRUCK_HOME.x, TRUCK_HOME.z, TRUCK_HOME.heading);
    this.truck.tailTarget = 0;
    this.interactives = [this.truck.cabHit, this.truck.tailHit, ...this.shelfBoards];

    // 貨架上的設備
    this.shelfSpots.forEach(s => { s.uid = s.item ? this.spawnGround(s.item, s.pos, s.rotY) : null; });
    // 昨天沒卸的東西 (擋在車尾)
    this.loadTrunk('drone', 0, 0, 0, false);
    this.loadTrunk('water', 2, 0, 0, false);
    this.loadTrunk('totalstation', 0, 0, 1, false);
    this.syncInteractives();
  }

  // ================================================================
  // 階段
  // ================================================================
  setPhase(ph: Phase) {
    this.phase = ph;
    const sm = this.app.sceneManager;
    const hints: Record<Phase, string> = {
      brief: '先看完派工單。',
      ...this.J.hints,
      return: '開回公司，停進停車格後下車交差。',
      done: '',
    };
    if (ph !== 'observe' || this.job !== 'gnss') this.panel(ph, hints[ph]);
    // 目的地箭頭
    sm.dynamicArrows.slice().forEach((a: THREE.Object3D) => {
      if (a.userData.label && a.userData.label.startsWith('目的地')) {
        sm.scene.remove(a);
        sm.dynamicArrows.splice(sm.dynamicArrows.indexOf(a as THREE.Group), 1);
        sm.floatingArrows.splice(sm.floatingArrows.indexOf(a as THREE.Group), 1);
      }
    });
    this.nav.setRoute(ph === 'prep' || ph === 'toSite' ? this.J.route : ph === 'packup' || ph === 'return' ? this.J.back : null);
    if (!['prep', 'toSite', 'packup', 'return'].includes(ph)) ui.setNav(null);
    if (ph === 'prep') (this.sub as AnyObj)?.onPrep?.();
    if (ph === 'toSite') this.destArrow(this.J.park.x, this.J.park.z, '目的地：現場停車處');
    if (ph === 'return') this.destArrow(TRUCK_HOME.x, TRUCK_HOME.z, '目的地：公司停車格');
  }

  private destArrow(x: number, z: number, label: string) {
    const sm = this.app.sceneManager;
    const a = sm.createFloatingHintArrow(x, z, label, 0xe9b308, true);
    a.position.y = sm.heightAt(x, z);
    a.visible = true;
  }

  /** 到現場先清點一次必帶設備：少了什麼當場就知道，指引才會叫你開車回公司拿 */
  private checkRequired() {
    const S = this.J.site;
    const here = (it: ItemId) => this.carrying === it || this.extraCarry === it || this.grid.has(it)
      || this.ground.some(g => g.item === it && Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r);
    const miss = this.J.required.filter(it => !here(it) && !this.m.forgot.has(it));
    if (!miss.length) return;
    miss.forEach(it => this.m.forgot.add(it));
    sfx.error();
    ui.toast(`清點了一下……${miss.map(i => ITEMS[i].name).join('、')}沒帶到！只好開車回公司拿。`, 'bad', 5200);
  }

  private startSite() {
    this.checkRequired();
    if (this.sub) { this.sub.startSite(); this.setPhase('site'); this.sub.refreshHint(); this.syncInteractives(); return; }
    const p = this.app.player;
    const pos = p.position.clone(), eul = p.euler.clone();
    const gnss = this.app.levelsMap.gnss;
    gnss.start();
    p.position.copy(pos);
    p.euler.copy(eul);
    p.camera.position.copy(pos);
    p.camera.quaternion.setFromEuler(eul);
    this.app.sceneManager.setVisibleFloatingPoints(['CKSV']);
    this.setPhase('site');
    this.syncInteractives();
    ui.toast('到現場了。先把需要的東西從後斗搬下來。', 'info');
  }

  // ================================================================
  // 存檔 / 讀檔
  // ================================================================
  /** 目前所有狀態 (存成文字檔) */
  snapshot(): AnyObj {
    if (bench.mode) bench.exit(false);
    if (levelScope.active) levelScope.close();
    this.sub?.prepareSave();
    const p = this.app.player;
    const g = this.app.levelsMap.gnss;
    return {
      job: this.job,
      phase: this.phase,
      time: this.time,
      player: { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.euler.y, pitch: p.euler.x },
      inTruck: this.inTruck,
      truck: { x: this.truck.pos.x, z: this.truck.pos.z, heading: this.truck.heading },
      carrying: this.carrying, extraCarry: this.extraCarry,
      ground: this.ground.map(gi => ({ item: gi.item, x: gi.obj.position.x, y: gi.obj.position.y, z: gi.obj.position.z, rot: gi.obj.rotation.y, shelf: this.shelfSpots.findIndex(sp => sp.uid === gi.uid) })),
      trunk: this.grid.placed.map(pl => ({ item: pl.item, col: pl.col, row: pl.row, layer: pl.layer, rot: pl.rot })),
      water: this.water, bottles: this.bottles, drinks: this.drinks, radioHinted: this.radioHinted,
      score: { ...this.m, forgot: [...this.m.forgot] },
      story: storySnapshot(),
      gnssSetup: { tripodSet: this.tripodSet, tribrachOn: this.tribrachOn, receiverOn: this.receiverOn, toolbagOn: this.toolbagOn },
      gnss: this.job === 'gnss' && g ? {
        currentStep: g.currentStep, screwA: g.screwA, screwB: g.screwB, screwC: g.screwC, shiftX: g.shiftX, shiftY: g.shiftY,
        finalCenteringErrorMm: g.finalCenteringErrorMm ?? null, finalLevelingErrorMm: g.finalLevelingErrorMm ?? null,
        trueSlantHeight: g.trueSlantHeight ?? null, playerInputSlantHeight: g.playerInputSlantHeight ?? null,
        tapeReadingErrorMm: g.tapeReadingErrorMm ?? null, slantHeightMeasured: !!g.slantHeightMeasured,
      } : null,
      events: this.events.snapshot(),
      level: this.job === 'level' ? this.lv.snapshot() : null,
      gcp: this.job === 'gcp' ? this.gcp.snapshot() : null,
    };
  }

  /** 從存檔還原 (會重新載入當天) */
  restore(s: AnyObj) {
    const sm = this.app.sceneManager;
    const p = this.app.player;
    this.job = s.job;
    this.app.loadLevel('field');
    ui.dismissWorkOrder();
    ui.dropMenuKeys();
    document.querySelectorAll('.field-modal').forEach(e => e.remove());
    // 設備
    this.clearGround();
    this.clearTrunk();
    this.shelfSpots.forEach(sp => { sp.uid = null; });
    (s.ground || []).forEach((gi: AnyObj) => {
      const uid = this.spawnGround(gi.item, new THREE.Vector3(gi.x, gi.y, gi.z), gi.rot || 0);
      if (gi.shelf >= 0 && this.shelfSpots[gi.shelf]) this.shelfSpots[gi.shelf].uid = uid;
    });
    (s.trunk || []).forEach((t: AnyObj) => this.loadTrunk(t.item, t.col, t.row, t.layer, t.rot));
    this.truck.setPose(s.truck.x, s.truck.z, s.truck.heading);
    this.truck.speed = 0;
    this.time = s.time || 0;
    this.water = s.water ?? 100; this.bottles = s.bottles ?? 24; this.drinks = s.drinks || 0; this.radioHinted = !!s.radioHinted;
    this.m = { ...this.m, ...s.score, forgot: new Set(s.score?.forgot || []), gnssNotes: s.score?.gnssNotes || [] };
    storyRestore(s.story);
    const su = s.gnssSetup || {};
    this.tripodSet = !!su.tripodSet; this.tribrachOn = !!su.tribrachOn; this.receiverOn = !!su.receiverOn; this.toolbagOn = !!su.toolbagOn;
    const onSite = ['site', 'observe', 'packup'].includes(s.phase);
    // 第一天：GNSS 儀器
    if (this.job === 'gnss' && onSite) {
      const g = this.app.levelsMap.gnss;
      g.start();
      if (s.phase !== 'packup') sm.setVisibleFloatingPoints(['CKSV']);
      if (s.gnss) Object.keys(s.gnss).forEach(k => { if (s.gnss[k] !== null) g[k] = s.gnss[k]; });
      if (this.tripodSet && s.phase !== 'packup') {
        const t = sm.createTripodWithInstrument(CKSV.x, CKSV.z, 'gnss');
        g.tripodMesh = t;
        t.userData.tribrach.visible = this.tribrachOn;
        t.userData.head.visible = this.receiverOn;
        t.userData.accessories.visible = this.toolbagOn;
      }
      g.recalculateTribrachPhysics?.();
    }
    this.events.restore(s.events || {}, s.phase);
    if (this.job === 'level') {
      this.lv.restore(s.level || {});
      if (onSite) this.lv.startSite(true);
    }
    if (this.job === 'gcp') {
      this.gcp.restore(s.gcp || {});
      if (onSite) this.gcp.startSite(true);
    }
    this.setPhase(s.phase);
    if (this.sub && ['site', 'observe'].includes(s.phase)) this.sub.refreshHint();
    if (this.job === 'gnss' && s.phase === 'observe') {
      const g = this.app.levelsMap.gnss;
      this.app.updateMissionPanel(g.title, g.getTasks(), g.currentStep, '讀檔完成，從上次的步驟繼續。');
    }
    this.syncInteractives();
    // 玩家
    p.position.set(s.player.x, s.player.y, s.player.z);
    p.euler.set(s.player.pitch || 0, s.player.yaw || 0, 0);
    p.camera.position.copy(p.position);
    p.camera.quaternion.setFromEuler(p.euler);
    if (s.carrying) this.hold(s.carrying);
    this.setExtra(s.extraCarry || null);
    if (s.inTruck) this.enterTruck();
  }

  private onGnssDone(data: AnyObj) {
    this.m.gnssScore = typeof data.score === 'number' ? data.score : 80;
    const gn = this.app.levelsMap.gnss;
    if (gn?.nameWrong) { this.m.gnssScore = Math.max(0, this.m.gnssScore - 10); this.m.gnssNotes.push(`手簿點名打成 ${gn.nameWrong}`); }
    if (gn?.htypeWrong) this.m.gnssNotes.push('天線高型別選錯（斜高輸成垂直高）');
    if (gn?.tapeZero && gn.tapeZero !== 'center') this.m.gnssNotes.push(gn.tapeZero === 'edge' ? '捲尺零點壓在標石邊緣' : '捲尺零點壓在地面');
    if (gn?.tapeTop && gn.tapeTop !== 'notch') this.m.gnssNotes.push(gn.tapeTop === 'top' ? '捲尺拉到天線頂而不是量高缺口' : '捲尺拉到底盤外緣而不是量高缺口');
    if (document.exitPointerLock) document.exitPointerLock();
    // 拆收：移除架設中的儀器，四件設備擺回控制點旁
    const sm = this.app.sceneManager;
    sm.tripods.forEach((t: THREE.Object3D) => {
      sm.scene.remove(t);
      const i = sm.interactiveObjects.indexOf(t); if (i > -1) sm.interactiveObjects.splice(i, 1);
    });
    sm.tripods.length = 0;
    const spots: [ItemId, number, number][] = [['tripod', 1.4, 0.9], ['tribrach', -1.1, 1.0], ['gnss', -1.3, -0.6], ['toolbag', 0.9, -1.2]];
    spots.forEach(([it, dx, dz]) => this.spawnGround(it, new THREE.Vector3(CKSV.x + dx, sm.heightAt(dx, dz), CKSV.z + dz), Math.random() * 3));
    sm.setVisibleFloatingPoints([]);
    sfx.pickup();
    ui.toast(`觀測完成（施測成績 ${this.m.gnssScore} 分）。收工！`, 'good', 4000);
    this.setPhase('packup');
    this.events.onPackup();
  }

  finish() {
    this.setPhase('done');
    this.exitTruck(true);
    const S = this.J.site;
    const leftAtSite = this.ground.filter(g => Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r);
    const leftExtra: string[] = (this.sub as AnyObj)?.leftBehind?.() || [];
    const leftNames = [...leftAtSite.map(g => ITEMS[g.item].name), ...leftExtra];
    const extras = this.grid.placed.filter(p => !this.J.required.includes(p.item) && !['drone', 'water', 'totalstation'].includes(p.item));
    const rows: ui.ReportRow[] = [];
    if (this.job === 'level') rows.push(this.lv.reportRow());
    else if (this.job === 'gcp') rows.push(...this.gcp.reportRows());
    else {
      const gnssPts = Math.round(this.m.gnssScore * 0.4);
      rows.push({ label: 'GNSS 觀測品質', detail: `施測評分 ${this.m.gnssScore} / 100${this.events.bumps.length ? `；腳架被碰 ${this.events.bumps.length} 次（${this.events.bumps.join('、')}），重新定平` : ''}${(this.m.gnssNotes || []).length ? `；${this.m.gnssNotes.join('；')}` : ''}`, delta: gnssPts });
    }
    const forgotPts = Math.max(0, 20 - this.m.forgot.size * 10 - extras.length * 2);
    rows.push({ label: '整備儀器', detail: [this.m.forgot.size ? `漏帶 ${[...this.m.forgot].map(i => ITEMS[i].name).join('、')}（回公司 ${this.m.returnTrips} 趟）` : '必要設備一次帶齊', extras.length ? `多帶 ${extras.length} 件用不到的東西` : ''].filter(Boolean).join('；'), delta: forgotPts });
    const drivePts = Math.max(0, 15 - this.m.crashes * 5 - this.m.illegalPark * 5 - Math.min(5, this.m.honked));
    rows.push({ label: '行車安全', detail: [this.m.crashes ? `碰撞 ${this.m.crashes} 次` : '零碰撞', this.m.illegalPark ? `路中停車 ${this.m.illegalPark} 次` : '', this.m.honked ? `被按喇叭 ${this.m.honked} 次` : ''].filter(Boolean).join('、'), delta: drivePts });
    const prSum = this.m.pr.reduce((a, b) => a + b.score, 0);
    const prPts = Math.max(0, Math.min(10, 5 + prSum));
    rows.push({ label: '民眾應對', detail: this.m.pr.length ? this.m.pr.map(x => x.tag).join('；') : '沒遇到路人', delta: prPts });
    const leftPts = Math.max(0, 15 - leftNames.length * 10);
    rows.push({ label: '收工清點', detail: leftNames.length ? `${leftNames.join('、')} 留在現場` : '一件不少帶回公司', delta: leftPts });
    const total = Math.max(0, Math.min(100, rows.reduce((s, r) => s + r.delta, 0)));
    let title = '工讀生', comment = '';
    if (total >= 90) { title = '外業組長'; comment = '流程俐落、設備齊全、跟阿伯也聊得來。下次派工單就由你寫了。'; }
    else if (total >= 75) { title = '工程師'; comment = '大致順利，小地方再細心一點就能帶隊。'; }
    else if (total >= 60) { title = '助理工程師'; comment = '成果能交，但組長在辦公室嘆了口氣。'; }
    else { comment = '鍵盤上的測量很完美，現場……我們明天再來一次。'; }
    if (leftAtSite.some(g => g.item === 'tripod')) comment += this.job === 'gnss' ? '另外，腳架又留在田裡了。' : '另外，腳架留在路邊了。';
    if (leftAtSite.some(g => g.item === 'template' || g.item === 'hammer')) comment += '模板／鐵鎚還在田裡，阿伯應該會很開心。';
    const scores = { ...(loadProgress().scores || {}) };
    if (this.job === 'gnss') {
      const e = this.events;
      saveProgress({ day1Done: true, uncle: e.uncleSaid, dog: e.dogOutcome, kids: e.kidsOutcome, owner1: e.owner1, owner1Chief: e.owner1Chief, auntie1: e.auntie1, boss1: e.boss1, scores: { ...scores, d1: total } });
    } else if (this.job === 'level') {
      const x = this.lv.crossDay();
      saveProgress({ day2Done: true, uncle2: x.uncle2, mentor2: x.mentor2, asst2: x.asst2, scores: { ...scores, d2: total } });
    } else saveProgress({ day3Done: true, rel3: { ...this.gcp.ev.rel }, scores: { ...scores, d3: total } });
    ui.setHud({});
    const toMenu = () => this.app.levelManager && (window as AnyObj).__showMainMenu && (window as AnyObj).__showMainMenu();
    const after = this.job === 'gcp' ? () => showEnding(this.gcp.endingFacts(), toMenu) : toMenu;
    ui.showReport(rows, total, title, comment, after, getStory(), this.job === 'gcp' ? '看尾聲' : '回主選單');
  }

  // ================================================================
  // 每幀更新
  // ================================================================
  update(dt: number) {
    this.time += dt;
    const sm = this.app.sceneManager;
    const p = this.app.player;
    this.truck.update(dt);
    dust.update(dt);
    // 環境音：公司附近 / 野外；在車上小聲一點
    {
      const ref = this.inTruck ? this.truck.pos : p.position;
      const nearYard = Math.hypot(ref.x - YARD.x, ref.z - YARD.z) < 45;
      ambient.set({ scene: nearYard ? 'yard' : 'field', inTruck: this.inTruck, roadDist: Math.abs(ref.z - ROAD_Z) });
      ambient.update(dt);
      gameMusic.duck(this.inTruck && this.radio.status === 'playing');
    }

    // 車流
    const truckOnRoad = Math.abs(this.truck.pos.z - ROAD_Z) < 3.6 ? { x: this.truck.pos.x, z: this.truck.pos.z } : null;
    const playerOnRoad = !this.inTruck && Math.abs(p.position.z - ROAD_Z) < 3.4 ? { x: p.position.x, z: p.position.z } : null;
    this.traffic.forEach(t => {
      if (t.update(dt, truckOnRoad, playerOnRoad)) {
        const listener = this.inTruck ? this.truck.pos : p.position;
        const d = Math.hypot(t.x - listener.x, t.z - listener.z);
        if (d < 60) {
          sfx.honk(d);
          if (truckOnRoad) this.m.honked++;
          if (this.time - this.lastHonkToast > 4) { ui.toast(truckOnRoad && Math.abs(this.truck.speed) < 0.5 ? '叭——！車子擋到路了。' : '叭——！', 'warn', 1800); this.lastHonkToast = this.time; }
        }
      }
    });

    // 步行時：重物減速、不可穿過車身與牆面
    if (!this.inTruck) {
      const heavy = this.carrying ? ITEMS[this.carrying].heavy : false;
      p.carrySpeedFactor = heavy ? 0.6 : this.carrying ? 0.85 : 1;
      p.noSprint = heavy;
      this.collidePlayer();
    }

    // 階段推進
    const tp = this.truck.pos;
    const dYard = Math.hypot(tp.x - YARD.x, tp.z - YARD.z);
    const dSite = Math.hypot(tp.x - this.J.park.x, tp.z - this.J.park.z);
    if (this.phase === 'prep' && dYard > 32) this.setPhase('toSite');
    if (dYard < 18) {
      if (!this.m.atYardCounted && this.m.forgot.size && ['site', 'observe', 'toSite'].includes(this.phase)) { this.m.returnTrips++; this.m.atYardCounted = true; }
    } else this.m.atYardCounted = false;
    if (this.phase === 'packup' && dSite > 60) {
      const S = this.J.site;
      const left = this.ground.filter(g => Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r);
      if (left.length && !this.m.warnedLeft) { ui.toast('……總覺得好像忘了什麼。', 'warn', 4000); this.m.warnedLeft = true; }
      this.setPhase('return');
      this.events.onReturn();
    }

    if (this.job === 'gnss') this.events.update(dt);
    else { this.lv.update(dt); this.gcp.update(dt); }
    this.updateWater(dt);

    // 導航 (整備儀器時只在上車後顯示)
    const navRef = this.inTruck ? this.truck.pos : p.position;
    const ns = this.nav.update(dt, navRef.x, navRef.z);
    ui.setNav(ns && (!['prep', 'packup'].includes(this.phase) || this.inTruck) ? ns : null);

    // 收音機
    this.radio.syncMute();
    if (this.inTruck) {
      const st = this.radio.current;
      ui.setRadioPanel({ on: this.radio.isOn, status: this.radio.status, name: st.name, note: st.note, reason: this.radio.reason, key: st.key, idx: this.radio.index, total: this.radio.stations.length, list: this.radioList ? this.radio.stations.map(x => ({ name: x.name, key: x.key || '', custom: !!x.custom })) : null, onPick: (i: number) => this.radio.tune(i), onEdit: (i: number) => this.editStationUrl(i) });
    }

    // HUD
    if (this.inTruck) {
      // 手機版：開車時只留時速 (導航列已經在左上角了)
      ui.setHud({ speedKmh: Math.abs(this.truck.speed) * 3.6, dest: (window as AnyObj).__mobile ? null : this.destText() });
    } else {
      ui.setHud({ holding: this.carrying ? ITEMS[this.carrying].name + (this.extraCarry ? `＋${ITEMS[this.extraCarry].name}` : '') : null, dest: ['toSite', 'return'].includes(this.phase) ? this.destText() : this.sub ? this.sub.destText() : null, water: this.water });
    }
  }

  private destText(): string | null {
    const ref = this.inTruck ? this.truck.pos : this.app.player.position;
    if (this.phase === 'toSite') return `現場 ${Math.round(Math.hypot(ref.x - this.J.park.x, ref.z - this.J.park.z))} m`;
    if (this.phase === 'return') return `公司 ${Math.round(Math.hypot(ref.x - TRUCK_HOME.x, ref.z - TRUCK_HOME.z))} m`;
    return null;
  }

  /** 手機版：器材室的屋頂 / 牆 (相機會把它們隱藏或變透明) */
  yardOccluders() { if (!this.built) this.buildOnce(); return this.yardOcc; }

  /** 手機版尋路用：步行會撞到的所有圓形障礙 (和 collidePlayer 一致，加上車身) */
  walkBlockers(): Circle[] {
    const out: Circle[] = [];
    if (!this.built) return out;
    const t = this.truck;
    const c = Math.cos(t.heading), sn = Math.sin(t.heading);
    for (let lx = -2.3; lx <= 2.3; lx += 1.15) out.push({ x: t.pos.x + lx * c, z: t.pos.z - lx * sn, r: 1.25 });
    out.push(...this.yardColliders, ...(this.sub ? this.sub.bodies() : this.events.bodies()), ...(this.job !== 'gcp' ? this.gcp.bodies() : []));
    const sm = this.app.sceneManager;
    const p = this.app.player.position;
    sm.trees.forEach((tr: THREE.Object3D) => { if (Math.abs(tr.position.x - p.x) < 40 && Math.abs(tr.position.z - p.z) < 40) out.push({ x: tr.position.x, z: tr.position.z, r: 0.45 }); });
    (sm.poleColliders || []).forEach((pc: Circle) => { if (Math.abs(pc.x - p.x) < 40 && Math.abs(pc.z - p.z) < 40) out.push(pc); });
    sm.tripods.forEach((tp: THREE.Object3D) => out.push({ x: tp.position.x, z: tp.position.z, r: 0.55 }));
    return out;
  }

  /** 手持物掛在哪：手機版掛在人偶的手上，桌機版掛在相機下 */
  private handAnchor(extra = false): THREE.Object3D {
    const p = this.app.player as AnyObj;
    return (extra ? p.handL : p.hand) || this.app.sceneManager.camera;
  }
  /** 這件東西怎麼拿：腳架、標尺、桿子扛肩上；重的箱子兩手捧；其他單手提 */
  private carryStyle(item: ItemId): 'shoulder' | 'front' | 'side' {
    const def = ITEMS[item];
    if (def.kind === 'tripod' || def.kind === 'staff' || def.kind === 'pole') return 'shoulder';
    if (def.heavy || def.kind === 'water') return 'front';
    return 'side';
  }
  /** 依照手上 (和另一手) 的東西決定人偶姿勢 */
  private updateCarryPose() {
    const p = this.app.player as AnyObj;
    if (!p.avatar) return;
    if (!this.carrying) { p.avatar.userData.pose = this.extraCarry ? 'carryHand' : undefined; return; }
    const st = this.carryStyle(this.carrying);
    const both = !!this.extraCarry;
    p.avatar.userData.pose = st === 'front' ? 'carryFront'
      : st === 'shoulder' ? (both ? 'carryShoulderBoth' : 'carryShoulder')
      : (both ? 'carrySideBoth' : 'carrySide');
  }

  private placeHeld(h: THREE.Group, item: ItemId, extra: boolean) {
    const p = this.app.player as AnyObj;
    const def = ITEMS[item];
    if (p.hand) {
      // 人偶身上：腳架／標尺扛肩、重箱子兩手捧在身前、其他單手提在身側
      // 設備模型本身是「躺著、長邊沿 X」的，所以：
      //   扛肩 = 長邊維持前後向、往後翹一點，放在肩膀高度
      //   單手提 = 掛在手下面 (長的就讓它直立)
      //   兩手捧 = 長邊橫過身體，捧在胸前
      const st = extra ? 'side' : this.carryStyle(item);
      const long = def.d > 1 || def.w > 1;
      if (st === 'shoulder') {
        h.position.set(-0.42, 0.52, -0.12);
        h.rotation.set(0, 0, 0.26);
        h.scale.setScalar(1);
      } else if (st === 'front') {
        h.position.set(-0.12, 0.26, -0.26);
        h.rotation.set(0, Math.PI / 2, 0);
        h.scale.setScalar(extra ? 0.7 : 0.9);
      } else {
        h.position.set(0, long ? -0.34 : -0.24, 0);
        h.rotation.set(0, 0, long ? 1.3 : 0);
        h.scale.setScalar(extra ? 0.7 : 0.88);
      }
      this.updateCarryPose();
      return;
    }
    const long = def.d > 1 || def.w > 1;
    if (extra) { h.position.set(-0.42, -0.5, -0.8); h.rotation.set(0.15, -0.3, 0); h.scale.setScalar(0.6); return; }
    h.position.set(long ? 0.34 : 0.36, long ? -0.46 : -0.44, long ? -0.95 : -0.82);
    h.rotation.set(0.12, Math.PI / 2 + 0.2, 0);
    h.scale.setScalar(long ? 0.75 : 0.62);
  }
  private handPoseReset() {
    const p = this.app.player as AnyObj;
    if (p.avatar) this.updateCarryPose();
  }

  private collidePlayer() {
    if (bench.mode || cineActive() || levelScope.active || document.body.classList.contains('bench-active')) return; // 儀器近距離操作 / 運鏡中，鏡頭不歸玩家
    const p = this.app.player;
    const { lx, lz } = this.truck.toLocalFlat(p.position.x, p.position.z);
    const hx = 2.85, hz = 1.15;
    if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
      const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
      let nlx = lx, nlz = lz;
      if (px < pz) nlx = Math.sign(lx || 1) * hx; else nlz = Math.sign(lz || 1) * hz;
      const c = Math.cos(this.truck.heading), s = Math.sin(this.truck.heading);
      p.position.x = this.truck.pos.x + nlx * c + nlz * s;
      p.position.z = this.truck.pos.z - nlx * s + nlz * c;
    }
    for (const o of [...this.yardColliders, ...(this.sub ? this.sub.bodies() : this.events.bodies()), ...(this.job !== 'gcp' ? this.gcp.bodies() : [])]) {
      const dx = p.position.x - o.x, dz = p.position.z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.3;
      if (d < min && d > 1e-4) { p.position.x = o.x + dx / d * min; p.position.z = o.z + dz / d * min; }
    }
    p.camera.position.copy(p.position);
  }

  // ================================================================
  // 駕駛
  // ================================================================
  private enterTruck() {
    if (this.carrying) { ui.toast(`手上拿著${ITEMS[this.carrying].name}，先放上後斗或放下。`, 'warn'); sfx.error(); return; }
    const p = this.app.player;
    this.inTruck = true;
    p.hoveredObject = null;
    p.hidePrompt();
    document.getElementById('reticle-crosshair')?.classList.add('hidden');
    this.truck.resetCam();
    this.truck.tailTarget = 0;
    ui.setControls('drive');
    p.externalControl = (dt: number) => this.driveTick(dt);
    this.radio.resumeOnEnter();
    this.sub?.onEnterTruck();
    if (!this.radioHinted) { this.radioHinted = true; ui.toast((this.app.player as AnyObj).hand ? '要聽廣播嗎？點右下角的收音機。' : '要聽廣播嗎？按 R 打開收音機，B／N 上一台／下一台，L 電台清單。', 'info', 5000); }
  }

  private driveTick(dt: number) {
    const p = this.app.player;
    const k = p.keys;
    const tp = this.truck.pos;
    const onRoad = Math.abs(tp.z - ROAD_Z) < 3.6 && Math.abs(tp.x) < 380;
    const onYard = Math.hypot(tp.x - YARD.x, tp.z - YARD.z) < 22;
    const maxSpeed = onRoad ? 16 : onYard ? 7 : 8;
    const obstacles: Circle[] = [];
    const sm = this.app.sceneManager;
    sm.trees.forEach((t: THREE.Object3D) => { if (Math.abs(t.position.x - tp.x) < 25 && Math.abs(t.position.z - tp.z) < 25) obstacles.push({ x: t.position.x, z: t.position.z, r: 0.6, tag: '樹' }); });
    sm.poleColliders.forEach(c => { if (Math.abs(c.x - tp.x) < 25 && Math.abs(c.z - tp.z) < 25) obstacles.push({ ...c, tag: '電線桿' }); });
    sm.benchmarks.forEach((b: THREE.Object3D) => { if (b.visible) obstacles.push({ x: b.position.x, z: b.position.z, r: 0.45, tag: '控制點' }); });
    this.yardColliders.forEach(c => obstacles.push({ ...c, tag: '器材室' }));
    this.traffic.forEach(t => obstacles.push({ x: t.x, z: t.z, r: t.kind === 'car' ? 1.7 : 0.9, tag: t.kind === 'car' ? '別人的車' : '機車' }));
    (this.sub ? this.sub.obstacles() : this.events.obstacles()).forEach(o => obstacles.push(o));
    if (this.job !== 'gcp') this.gcp.obstacles().forEach(o => obstacles.push(o));

    const ax = (p as AnyObj).axes as { steer: number; throttle: number; brake: boolean } | undefined;
    this.truck.drive(dt, {
      throttle: ax && ax.throttle ? ax.throttle : (k.forward ? 1 : 0) - (k.backward ? 1 : 0),
      steer: ax && ax.steer ? ax.steer : (k.left ? 1 : 0) - (k.right ? 1 : 0),
      brake: !!k.jump || !!(ax && ax.brake),
    }, maxSpeed * ((p as AnyObj).hand ? 0.85 : 1), obstacles, (o, impact) => {
      if (impact > 1.5 && this.time - this.lastCrash > 1.2) {
        this.lastCrash = this.time;
        this.m.crashes++;
        this.m.crashLog.push(o.tag || '障礙物');
        sfx.thud();
        ui.toast(['路人', '小朋友', '狗'].includes(o.tag || '') ? '……差點撞到人！開慢一點！' : `砰！撞到${o.tag || '東西'}了。`, 'bad', 2200);
      }
    });
    this.truck.updateChaseCam(p.camera, dt);
  }

  private exitTruck(silent = false) {
    if (!this.inTruck) return;
    if (!silent && Math.abs(this.truck.speed) > 1.0) { ui.toast((window as AnyObj).__mobile ? '車還在動，等車停下來再下車。' : '車還在動，先停好再下車（手煞車）。', 'warn'); return; }
    const p = this.app.player;
    const sm = this.app.sceneManager;
    this.inTruck = false;
    this.truck.speed = 0;
    p.externalControl = null;
    this.radio.pauseForExit();
    ui.setRadioPanel(null);
    document.getElementById('reticle-crosshair')?.classList.remove('hidden');
    const out = this.truck.toWorld(0.4, 0, -1.75);
    p.position.set(out.x, sm.heightAt(out.x, out.z) + 1.65, out.z);
    p.euler.set(-0.1, this.truck.heading - Math.PI / 2 - 0.6, 0);
    p.camera.position.copy(p.position);
    p.camera.quaternion.setFromEuler(p.euler);
    ui.setControls('walk');
    this.sub?.onExitTruck();
    if (silent) return;

    const tp = this.truck.pos;
    if (Math.abs(tp.z - ROAD_Z) < 3.6) {
      this.m.illegalPark++;
      ui.toast('車停在路中間……等一下一定會被叭。', 'warn', 3500);
    }
    const arrived = this.job === 'gnss' ? Math.hypot(tp.x - CKSV.x, tp.z - CKSV.z) < 45 : Math.hypot(tp.x - this.J.park.x, tp.z - this.J.park.z) < 30 || Math.hypot(tp.x - this.J.site.x, tp.z - this.J.site.z) < 40;
    if (this.phase === 'toSite' && arrived) this.startSite();
    else if (this.phase === 'return' && Math.hypot(tp.x - TRUCK_HOME.x, tp.z - TRUCK_HOME.z) < 6) { if (this.job === 'gcp') this.gcp.atOffice(); else this.finish(); }
    else if (this.phase === 'return' && Math.hypot(tp.x - YARD.x, tp.z - YARD.z) < 20) ui.toast('停進白線停車格裡再下車。', 'info');
  }

  // ================================================================
  // 物品：地面 / 手持 / 後斗
  // ================================================================
  spawnGround(item: ItemId, pos: THREE.Vector3, rotY: number): number {
    const obj = buildItemModel(item);
    obj.position.copy(pos);
    obj.rotation.y = rotY;
    const uid = uidSeq++;
    obj.userData = { type: 'field_item', item, uid, itemId: item };
    this.app.sceneManager.scene.add(obj);
    this.ground.push({ uid, item, obj });
    this.interactives.push(obj);
    this.syncInteractives();
    return uid;
  }

  /** 這件地上的設備是不是放在公司貨架上 */
  private onShelf(uid: number) { return this.shelfSpots.some(s => s.uid === uid); }

  // ---------- 手機版任務指引 ----------
  /** 下一步要去哪、做什麼；手機版用來畫目標圈與「前往」提示 */
  guideTarget(): GuideTarget | null {
    const t = this.guideTargetRaw();
    if (!t || this.inTruck) return t;
    // 目標太遠 (而且車就在旁邊)：提醒開車過去，不要用走的
    const p = this.app.player.position;
    const d = Math.hypot(p.x - t.x, p.z - t.z);
    const tk = this.truck.pos;
    const dTruck = Math.hypot(p.x - tk.x, p.z - tk.z);
    // 回公司拿東西：拿到了就先開車回現場，不要又叫你從後斗拿出來
    if (['site', 'observe'].includes(this.phase) && Math.hypot(p.x - YARD.x, p.z - YARD.z) < 40) {
      const ud = t.obj?.userData?.type;
      const atTruck = ud === 'truck' || ud === 'truck_bed';
      const tNearYard = Math.hypot(t.x - YARD.x, t.z - YARD.z) < 40;
      if (this.carrying && !tNearYard) return { ...this.guideTail(), label: `把${ITEMS[this.carrying].name}放上後斗`, reach: 1.4 };
      if (!this.carrying && (atTruck || !tNearYard)) return { ...this.guideDoor(), label: '東西拿到了，開車回現場', reach: 1.3 };
    }
    if (d > 70 && dTruck < 45 && dTruck < d) {
      const toYard = Math.hypot(t.x - YARD.x, t.z - YARD.z) < 45;
      const dr = this.guideDoor();
      return { ...dr, label: toYard ? (t.item ? `哎呀！忘了帶${ITEMS[t.item].name}，開車回公司拿吧` : '開車回公司') : '開車回現場', reach: 1.3 };
    }
    return t;
  }

  /** 車門旁邊 (上車用) */
  private guideDoor() {
    const t = this.truck.toWorld(0.95, 0, 2.1);
    return { x: t.x, z: t.z, obj: this.truck.cabHit as THREE.Object3D };
  }
  /** 車尾 */
  private guideTail() {
    const t = this.truck.toWorld(-3.6, 0, 0);
    return { x: t.x, z: t.z, obj: this.truck.tailHit as THREE.Object3D };
  }

  private guideTargetRaw(): GuideTarget | null {
    if (this.inTruck || this.phase === 'brief' || this.phase === 'done') return null;
    const nm = (i: ItemId) => ITEMS[i].name;
    const tail = () => { const t = this.truck.toWorld(-3.6, 0, 0); return { x: t.x, z: t.z, obj: this.truck.tailHit as THREE.Object3D }; };
    const door = () => this.guideDoor();
    const find = (f: (o: THREE.Object3D) => boolean) => this.app.sceneManager.interactiveObjects.find(f);

    // 太渴了：先去喝水
    if (this.heatStage >= 2) {
      const w = this.ground.find(x => x.item === 'water');
      const pp0 = this.app.player.position;
      if (this.carrying === 'water') return { ...door(), label: '快喝一瓶水！', reach: 1.2 };
      if (w && Math.hypot(w.obj.position.x - pp0.x, w.obj.position.z - pp0.z) < 60) {
        return { x: w.obj.position.x, z: w.obj.position.z, label: '快去喝水！', reach: 1.3, obj: w.obj };
      }
      if (this.grid.has('water')) return { ...tail(), label: '快去車上喝水！', reach: 1.4 };
    }

    // 東西忘在公司：指引開車回去拿 (m.forgot 是遊戲自己記下來的)
    if (['site', 'observe'].includes(this.phase) && this.m.forgot.size) {
      const S = this.J.site;
      const here = (it: ItemId) => this.carrying === it || this.extraCarry === it || this.grid.has(it)
        || this.ground.some(g => g.item === it && Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r);
      const left = [...this.m.forgot].filter(it => !here(it));
      const want = left[0];
      const more = left.length > 1 ? `（還有 ${left.length - 1} 件）` : '';
      const pp = this.app.player.position;
      const atYard = Math.hypot(pp.x - YARD.x, pp.z - YARD.z) < 32;
      if (want) {
        if (atYard) {
          const g = this.ground.find(x => x.item === want);
          if (g) return { x: g.obj.position.x, z: g.obj.position.z - 2.4, label: `拿${nm(want)}（剛剛忘了帶）${more}`, reach: 1.1, obj: g.obj };
        }
        return { ...door(), label: `哎呀！忘了帶${left.map(nm).join('、')}，開車回公司拿吧`, reach: 1.3 };
      }
      if (atYard) return { ...door(), label: '東西拿到了，開車回現場', reach: 1.3 };
    }

    if (this.phase === 'prep') {
      if (this.carrying) return { ...tail(), label: `把${nm(this.carrying)}放上後斗`, reach: 1.4 };
      // 交給學弟裝車而且沒自己檢查過：就照他說的「都裝好了」，少了什麼到現場才會知道
      const sub = this.sub as AnyObj | null;
      const asst = sub?.asst?.g as THREE.Object3D | undefined;
      const atAsst = (label: string) => (asst ? { x: asst.position.x, z: asst.position.z, label, reach: 2.2, obj: asst } : { ...door(), label, reach: 1.3 });
      if (sub?.asstLoading) return { ...atAsst('等學弟搬完'), obj: undefined, reach: 3.0 };
      if (sub?.asstLoaded && !sub?.asstChecked) return { ...door(), label: '學弟說都裝好了，上車出發', reach: 1.3 };
      // 一開始選了「交給學弟」：指引帶你去找他
      if (sub && sub.loadBy === 'asst' && !sub.asstLoaded) return atAsst('跟學弟說，請他去裝車');
      // 還沒裝車的必帶設備：指到它現在放的架子
      for (const it of this.J.required) {
        if (this.grid.has(it)) continue;
        const g = this.ground.find(x => x.item === it);
        if (g) return { x: g.obj.position.x, z: g.obj.position.z - 2.4, label: `到器材架拿${nm(it)}`, reach: 1.1, obj: g.obj };
      }
      return { ...door(), label: '設備齊了，上車出發', reach: 1.3 };
    }
    if (this.phase === 'toSite') return { ...door(), label: '上車出發', reach: 1.3 };
    if (this.phase === 'return') {
      if (this.carrying) return { ...tail(), label: `把${nm(this.carrying)}放上後斗`, reach: 1.4 };
      return { ...door(), label: '上車開回公司', reach: 1.3 };
    }
    if (this.phase === 'packup') {
      if (this.carrying) return { ...tail(), label: `把${nm(this.carrying)}搬上後斗`, reach: 1.4 };
      const S = this.J.site;
      const left = this.ground.filter(g => Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r);
      if (left.length) {
        const p = this.app.player.position;
        const g = left.slice().sort((a, b) => a.obj.position.distanceToSquared(p) - b.obj.position.distanceToSquared(p))[0];
        return { x: g.obj.position.x, z: g.obj.position.z, label: `搬回後斗：${nm(g.item)}`, reach: 1.3, obj: g.obj };
      }
      const cone = (this.sub as AnyObj)?.coneToCollect?.();
      if (cone) return { x: cone.x, z: cone.z, label: '交通錐還擺在路邊，去收起來', reach: 1.3, obj: cone.obj };
      return { ...door(), label: '東西都收好了，上車回公司', reach: 1.3 };
    }
    // 現場：第一天 GNSS
    if (this.job === 'gnss' && (this.phase === 'site' || this.phase === 'observe')) {
      const gnss = this.app.levelsMap.gnss;
      const monObj = find(o => o.userData?.type === 'monument' && String(o.userData.label || '').includes('CKSV'));
      const instObj = find(o => o.userData?.type === 'instrument' && o.userData.instrumentType === 'gnss');
      const mon = { x: CKSV.x, z: CKSV.z, obj: instObj || monObj };
      const S = this.J.site;
      const fetch = (it: ItemId): GuideTarget | null => {
        if (this.carrying === it) return null;
        const near = this.ground.find(x => x.item === it && Math.hypot(x.obj.position.x - S.x, x.obj.position.z - S.z) < S.r);
        if (near) return { x: near.obj.position.x, z: near.obj.position.z, label: `拿起${nm(it)}`, reach: 1.3, obj: near.obj, item: it };
        if (this.grid.has(it)) return { ...tail(), label: `從後斗拿${nm(it)}`, reach: 1.4, item: it };
        // 不在現場也不在後斗 = 忘在公司了
        const far = this.ground.find(x => x.item === it);
        if (far) return { x: far.obj.position.x, z: far.obj.position.z - 2.4, label: `拿${nm(it)}（忘了帶）`, reach: 1.1, obj: far.obj, item: it };
        return { ...door(), label: `哎呀！忘了帶${nm(it)}，開車回公司拿吧`, reach: 1.3, item: it };
      };
      if (!this.tripodSet) return fetch('tripod') || { ...mon, label: '在 CKSV 控制點上架三腳架', reach: 1.6 };
      if (!this.tribrachOn) return fetch('tribrach') || { ...mon, label: '把基座裝上腳架', reach: 1.6 };
      if (!this.receiverOn) return fetch('gnss') || { ...mon, label: '裝上 GNSS 接收儀', reach: 1.6 };
      if (gnss?.currentStep >= 2 && !this.toolbagOn) return fetch('toolbag') || { ...mon, label: '拿外業工具袋來量天線高', reach: 1.6 };
      return { ...mon, label: '回到儀器旁繼續作業', reach: 1.6 };
    }
    // 第二、三天：由各自的工作給指引
    const sub = this.sub as AnyObj | null;
    return sub?.mobileGuide?.() || null;
  }

  /** 手機版：後斗裡有什麼、拿不拿得出來 */
  trunkList(): { uid: number; item: ItemId; blocked: string | null }[] {
    return this.grid.placed.map(p => {
      const b = this.grid.blockers(p);
      return {
        uid: p.uid, item: p.item,
        blocked: b.length ? `被${b.map(x => ITEMS[x.item].name).join('、')}${b.some(x => x.layer > p.layer) ? '壓住' : '擋住'}` : null,
      };
    });
  }
  mobileTakeFromTrunk(uid: number) { this.takeFromTrunk(uid); }
  /** 整備儀器 / 清點清單用 */
  packList(): { item: ItemId; name: string; loaded: boolean; inHand: boolean }[] {
    return this.J.required.map(it => ({ item: it, name: ITEMS[it].name, loaded: this.grid.has(it), inHand: this.carrying === it }));
  }
  /** 後斗裡不是今天必帶的東西 (昨天沒卸的) */
  extraInTrunk(): string[] {
    return this.grid.placed.filter(p => !this.J.required.includes(p.item)).map(p => ITEMS[p.item].name);
  }

  /** 手機版：點貨車 → 問要上車還是看後斗 */
  private openTruckUI(where: 'cab' | 'bed'): boolean {
    const fn = (window as AnyObj).__truckMenu;
    if (typeof fn !== 'function') return false;
    fn(where);
    return true;
  }
  /** 給手機版選單呼叫 */
  mobileEnterTruck() { this.enterTruck(); }

  // ---------- 手機版「平視器材架」介面用 ----------
  /** 這格現在放的是什麼 (可能被玩家換過位置) */
  private spotItem(uid: number | null): ItemId | null {
    if (uid == null) return null;
    return this.ground.find(g => g.uid === uid)?.item ?? null;
  }
  /** 某座貨架的格位狀態；level 0 = 最下層 */
  shelfLayout(rack: number) {
    return this.shelfSpots
      .map((s, i) => ({ i, rack: s.rack, level: s.level, col: s.col, item: this.spotItem(s.uid), home: s.item }))
      .filter(s => s.rack === rack);
  }
  /** 貨架座標 (世界)：給相機平視與走過去用 */
  rackInfo(rack: number): { x: number; y: number; z: number } | null {
    const b = this.shelfBoards.find(o => o.userData?.rack === rack && o.userData?.level === 1);
    if (!b) return null;
    const ud = b.userData;
    return { x: ud.wx, y: ud.wy, z: ud.wz };
  }
  get rackCount() { return this.shelfBoards.reduce((n, b) => Math.max(n, (b.userData?.rack ?? 0) + 1), 0); }
  /** 從某格拿起設備 */
  shelfTake(i: number): boolean {
    const sp = this.shelfSpots[i];
    if (!sp || sp.uid == null) return false;
    if (this.carrying) { ui.toast('一次只能拿一件，先放下。', 'warn'); sfx.error(); return false; }
    this.pickGround(sp.uid);
    return true;
  }
  /** 把手上的設備放進指定的空格 */
  shelfPut(i: number): boolean {
    const sp = this.shelfSpots[i];
    const it = this.carrying;
    if (!sp || sp.uid != null || !it) return false;
    if (this.held) this.handAnchor().remove(this.held);
    this.held = null;
    this.carrying = null;
    this.handPoseReset();
    sp.uid = this.spawnGround(it, sp.pos, sp.rotY);
    sfx.thud();
    ui.toast(`${ITEMS[it].name}放回架上${sp.item === it ? '（原位）' : ''}`, 'good', 1600);
    this.promoteExtra();
    return true;
  }
  /** 手機版：點架子 → 開平視介面 (桌機沒掛就回 false，照舊邏輯走) */
  private openShelfUI(rack: number): boolean {
    const fn = (window as AnyObj).__shelfView;
    if (typeof fn !== 'function') return false;
    fn(rack);
    return true;
  }
  /** 這件地上的設備放在哪座架子 */
  private shelfRackOf(uid: number): number {
    const sp = this.shelfSpots.find(s => s.uid === uid);
    return sp ? sp.rack : -1;
  }

  /** 把手上的設備放回貨架：優先放回它原本的位置，否則放在離準心最近的空位 */
  private shelve(aim?: THREE.Vector3) {
    const it = this.carrying;
    if (!it) return;
    const free = this.shelfSpots.filter(s => s.uid === null);
    let spot = free.find(s => s.item === it);
    if (!spot && free.length) {
      const ref = aim || this.app.player.position;
      spot = free.slice().sort((a, b) => a.pos.distanceToSquared(ref) - b.pos.distanceToSquared(ref))[0];
    }
    if (!spot) { sfx.error(); ui.toast('架上沒有空位了。', 'warn'); return; }
    if (this.held) this.handAnchor().remove(this.held);
    this.held = null;
    this.carrying = null;
    this.handPoseReset();
    spot.uid = this.spawnGround(it, spot.pos, spot.rotY);
    sfx.thud();
    ui.toast(`${ITEMS[it].name}放回架上${spot.item === it ? '（原位）' : ''}`, 'good', 1600);
    this.promoteExtra();
  }

  private clearGround() {
    const sm = this.app.sceneManager;
    this.ground.forEach(g => { sm.scene.remove(g.obj); this.unregister(g.obj); });
    this.ground = [];
  }

  mobilePickGround(uid: number) { this.pickGround(uid); }

  private pickGround(uid: number) {
    const g = this.ground.find(x => x.uid === uid);
    if (!g) return;
    this.app.sceneManager.scene.remove(g.obj);
    this.unregister(g.obj);
    this.ground = this.ground.filter(x => x !== g);
    this.shelfSpots.forEach(s => { if (s.uid === uid) s.uid = null; });
    this.hold(g.item);
  }

  hold(item: ItemId) {
    this.carrying = item;
    const anchor = this.handAnchor();
    if (this.held) anchor.remove(this.held);
    const h = buildItemModel(item);
    h.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    const def = ITEMS[item];
    this.placeHeld(h, item, false);
    anchor.add(h);
    this.held = h;
    sfx.pickup();
    ui.toast(`拿起 ${def.name}：${def.note}`, 'info', 2200);
  }

  /** 另一隻手拎東西 (畫面左下顯示) */
  setExtra(item: ItemId | null) {
    const anchor = this.handAnchor(true);
    if (this.heldExtra) anchor.remove(this.heldExtra);
    this.heldExtra = null;
    this.extraCarry = item;
    if (!item) { this.handPoseReset(); return; }
    const h = buildItemModel(item);
    h.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
    this.placeHeld(h, item, true);
    anchor.add(h);
    this.heldExtra = h;
  }

  /** 手上那件放掉之後：另一隻手的東西換到主手 */
  private promoteExtra() {
    const x = this.extraCarry;
    if (!x || this.carrying) return;
    this.setExtra(null);
    this.hold(x);
    ui.toast(`接著把${ITEMS[x].name}也放好。`, 'info', 2000);
  }

  private dropHeld(silent = false) {
    if (!this.carrying) return;
    if (this.held) this.handAnchor().remove(this.held);
    this.held = null;
    const it = this.carrying;
    this.carrying = null;
    this.handPoseReset();
    if (silent) return;
    const p = this.app.player;
    const sm = this.app.sceneManager;
    const fwd = new THREE.Vector3(-Math.sin(p.euler.y), 0, -Math.cos(p.euler.y));
    const pos = p.position.clone().addScaledVector(fwd, 1.1);
    pos.y = sm.heightAt(pos.x, pos.z) + (Math.hypot(pos.x - YARD.x, pos.z - YARD.z) < 14 ? 0.02 : 0);
    this.spawnGround(it, pos, p.euler.y + Math.PI / 2);
    sfx.thud();
    this.promoteExtra();
  }

  /** NPC 幫忙裝車：找空位放上後斗，放不下回傳 false */
  autoLoad(item: ItemId): boolean {
    const spot = this.grid.findSpot(item);
    if (!spot) return false;
    this.loadTrunk(item, spot.col, spot.row, spot.layer, spot.rot);
    return true;
  }

  /** NPC 從後斗拿走某件設備 (不管有沒有被壓住，學弟自己會搬開再疊回去) */
  npcTakeFromTrunk(item: ItemId): boolean {
    const pl = this.grid.placed.find(p => p.item === item);
    if (!pl) return false;
    this.grid.remove(pl);
    const mdl = this.trunkMeshes.get(pl.uid);
    if (mdl) { this.truck.bedItems.remove(mdl); this.unregister(mdl); this.trunkMeshes.delete(pl.uid); }
    return true;
  }

  /** NPC 把設備放回貨架 (原位優先) */
  npcShelve(item: ItemId): boolean {
    const free = this.shelfSpots.filter(s => s.uid === null);
    const spot = free.find(s => s.item === item) || free[0];
    if (!spot) return false;
    spot.uid = this.spawnGround(item, spot.pos, spot.rotY);
    return true;
  }

  /** 某件設備的貨架原位 (或任何空位) */
  shelfPos(item: ItemId): THREE.Vector3 | null {
    const free = this.shelfSpots.filter(s => s.uid === null);
    const spot = free.find(s => s.item === item) || free[0];
    return spot ? spot.pos.clone() : null;
  }

  /** NPC 從地上撿走某件設備 (不經過玩家的手) */
  takeGroundItem(item: ItemId, near: THREE.Vector3, r: number): boolean {
    const g = this.ground.find(x => x.item === item && Math.hypot(x.obj.position.x - near.x, x.obj.position.z - near.z) < r);
    if (!g) return false;
    this.app.sceneManager.scene.remove(g.obj);
    this.unregister(g.obj);
    this.ground = this.ground.filter(x => x !== g);
    this.shelfSpots.forEach(sp => { if (sp.uid === g.uid) sp.uid = null; });
    return true;
  }

  /** 公司貨架上 (或器材室地上) 某件設備的位置 */
  yardItemPos(item: ItemId): THREE.Vector3 | null {
    const g = this.ground.find(x => x.item === item && Math.hypot(x.obj.position.x - YARD.x, x.obj.position.z - YARD.z) < 25);
    return g ? g.obj.position.clone() : null;
  }

  private loadTrunk(item: ItemId, col: number, row: number, layer: number, rot: boolean): Placed {
    const pl = this.grid.place(item, col, row, layer, rot);
    const mdl = buildItemModel(item);
    mdl.position.copy(this.truck.slotLocal(pl));
    if (rot) mdl.rotation.y = Math.PI / 2;
    mdl.userData = { type: 'trunk_item', uid: pl.uid, item, itemId: item };
    this.truck.bedItems.add(mdl);
    this.trunkMeshes.set(pl.uid, mdl);
    this.interactives.push(mdl);
    this.syncInteractives();
    return pl;
  }

  private clearTrunk() {
    this.trunkMeshes.forEach(m => { this.truck?.bedItems.remove(m); this.unregister(m); });
    this.trunkMeshes.clear();
    this.grid = new TrunkGrid();
  }

  /** 放入：開啟後斗配置圖 (重力式疊放) */
  private openLoader() {
    if (!this.carrying) return;
    if (Math.abs(this.truck.speed) > 0.3) return;
    this.truck.tailTarget = 1;
    const item = this.carrying;
    ui.showTrunkView({
      grid: this.grid, item,
      onPlace: (c, r, l, rot) => {
        if (this.held) this.handAnchor().remove(this.held);
        this.held = null;
        this.carrying = null;
        this.handPoseReset();
        this.loadTrunk(item, c, r, l, rot);
        sfx.thud();
        ui.toast(`${ITEMS[item].name} 已放上後斗${l > 0 ? '（疊在上層）' : ''}`, 'good', 1600);
        setTimeout(() => this.promoteExtra(), 400);
      },
    });
  }

  /** 取出：開啟後斗配置圖，點選要拿的設備 */
  openUnload() {
    if (Math.abs(this.truck.speed) > 0.3) return;
    this.truck.tailTarget = 1;
    ui.showTrunkView({ grid: this.grid, item: null, onTake: (p) => this.takeFromTrunk(p.uid) });
  }

  /** 測試工具：把某件設備從手上 / 地上 / 後斗拿掉 (不管有沒有被壓住) */
  debugRemoveItem(item: ItemId, keepYard = false): boolean {
    if (this.carrying === item) { this.consumeHeld(); return true; }
    const g = this.ground.find(x => x.item === item && !(keepYard && Math.hypot(x.obj.position.x - YARD.x, x.obj.position.z - YARD.z) < 25));
    if (g) { this.app.sceneManager.scene.remove(g.obj); this.unregister(g.obj); this.ground = this.ground.filter(x => x !== g); return true; }
    const pl = this.grid.placed.find(p => p.item === item);
    if (pl) {
      this.grid.remove(pl);
      const mdl = this.trunkMeshes.get(pl.uid);
      if (mdl) { this.truck.bedItems.remove(mdl); this.unregister(mdl); this.trunkMeshes.delete(pl.uid); }
      return true;
    }
    return false;
  }

  /** 測試工具：在公司貨架上放一件 (原本的格子優先) */
  debugPutOnShelf(item: ItemId) {
    if (this.yardItemPos(item)) return;
    const spot = this.shelfSpots.find(s => s.item === item && s.uid === null) || this.shelfSpots.find(s => s.uid === null);
    if (spot) spot.uid = this.spawnGround(item, spot.pos, spot.rotY);
  }

  private takeFromTrunk(uid: number) {
    const pl = this.grid.placed.find(p => p.uid === uid);
    if (!pl) return;
    this.truck.tailTarget = 1;
    const block = this.grid.blockers(pl);
    if (block.length) {
      sfx.error();
      ui.toast(`${ITEMS[pl.item].name}被${block.map(b => ITEMS[b.item].name).join('、')}${block.some(b => b.layer > pl.layer) ? '壓住' : '擋住'}了，先把它們搬開。`, 'warn', 3200);
      return;
    }
    this.grid.remove(pl);
    const mdl = this.trunkMeshes.get(uid);
    if (mdl) { this.truck.bedItems.remove(mdl); this.unregister(mdl); this.trunkMeshes.delete(uid); }
    this.hold(pl.item);
  }

  syncInteractives() {
    const list = this.app.sceneManager.interactiveObjects;
    this.interactives.forEach(o => { if (!list.includes(o)) list.push(o); });
  }
  unregister(o: THREE.Object3D) {
    this.interactives = this.interactives.filter(x => x !== o);
    const list = this.app.sceneManager.interactiveObjects;
    const i = list.indexOf(o); if (i > -1) list.splice(i, 1);
  }

  /** 設備在哪裡？ 'hand' | 'site' | 'truck-here' | 'far' */
  whereIs(item: ItemId): 'hand' | 'site' | 'truck-here' | 'far' {
    if (this.carrying === item) return 'hand';
    const S = this.J.site;
    if (this.ground.some(g => g.item === item && Math.hypot(g.obj.position.x - S.x, g.obj.position.z - S.z) < S.r)) return 'site';
    if (this.grid.has(item) && Math.hypot(this.truck.pos.x - S.x, this.truck.pos.z - S.z) < S.r) return 'truck-here';
    return 'far';
  }

  needItem(item: ItemId) {
    const w = this.whereIs(item);
    const name = ITEMS[item].name;
    sfx.error();
    if (w === 'site') ui.toast(`${name}在地上，拿起來再過來。`, 'info');
    else if (w === 'truck-here') ui.toast(`${name}還在後斗裡，去車尾拿。`, 'info');
    else {
      if (!this.m.forgot.has(item)) this.m.forgot.add(item);
      ui.toast(`糟糕……${name}沒帶！只好開車回公司拿。`, 'bad', 4500);
      this.panel('site', `${name}忘在公司了。開車回去拿（貨架上），再回來繼續。`);
    }
  }

  // ================================================================
  // 互動 (由 player 準心呼叫)
  // ================================================================
  /** 太渴了：只剩喝水、上車、跟人說話 */
  private heatBlocks(ud: AnyObj): boolean {
    if (this.heatStage < 2) return false;
    if (ud.type === 'npc' || ud.type === 'truck' || ud.type === 'truck_bed' || ud.type === 'trunk_item') return false;
    if (ud.type === 'field_item' && ud.item === 'water') return false;
    return true;
  }

  getInteractionPrompt(hit: THREE.Object3D): string | null {
    if (this.inTruck || this.phase === 'brief' || this.phase === 'done') return null;
    const ud = hit.userData || {};
    if (this.heatBlocks(ud)) return '太渴了……先喝水';
    const carryName = this.carrying ? ITEMS[this.carrying].name : '';
    switch (ud.type) {
      case 'field_item':
        if (ud.item === 'water' && !this.carrying && (window as AnyObj).__waterMenu) return '礦泉水（喝水／搬起來）';
        if (this.onShelf(ud.uid) && (window as AnyObj).__shelfView) return this.carrying ? `把${carryName}放上架子` : '看器材架';
        if (this.carrying && this.onShelf(ud.uid)) return `把${carryName}放回架上`;
        return this.carrying ? `手上已拿著${carryName}（先放下）` : `拿起 ${ITEMS[ud.item as ItemId].name}`;
      case 'shelf':
        if ((window as AnyObj).__shelfView) return this.carrying ? `把${carryName}放上架子` : '看器材架';
        return this.carrying ? `把${carryName}放回架上` : null;
      case 'truck':
        if ((window as AnyObj).__truckMenu) return this.carrying ? `把${carryName}放上後斗` : '看貨車（上車／後斗）';
        return this.carrying ? `把${carryName}放上後斗` : '上車駕駛';
      case 'truck_bed':
      case 'trunk_item':
        return this.carrying ? `把${carryName}放上後斗` : `查看後斗（${this.grid.placed.length} 件設備）`;
    }
    if (this.sub) return this.sub.prompt(hit);
    if (ud.type === 'npc') return this.events.promptFor(hit);
    if (!['site', 'observe'].includes(this.phase)) return null;
    const gnss = this.app.levelsMap.gnss;
    if (ud.type === 'monument' && String(ud.label || '').includes('CKSV') && !this.tripodSet) {
      return this.carrying === 'tripod' ? '在 CKSV 上架設三腳架' : '架設三腳架（需要手持三腳架）';
    }
    if (ud.type === 'instrument' && ud.instrumentType === 'gnss') {
      if (!this.tribrachOn) return this.carrying === 'tribrach' ? '裝上基座' : '裝上基座（需要基座箱）';
      if (!this.receiverOn) return this.carrying === 'gnss' ? '裝上 GNSS 接收儀' : '裝上接收儀（需要 GNSS 接收儀箱）';
      if (gnss.currentStep >= 2 && !this.toolbagOn) return this.carrying === 'toolbag' ? '拿出捲尺和手簿' : '量天線高（需要外業工具袋）';
      const blocked = this.events.blockedReason();
      if (blocked) return `暫停：${blocked}`;
      return gnss.getInteractionPrompt(hit);
    }
    return null;
  }

  onInteract(obj: THREE.Object3D) {
    const ud = obj.userData || {};
    if (this.heatBlocks(ud)) { sfx.error(); ui.toast('太渴了，手都在抖……先喝一瓶水。', 'warn', 3000); return; }
    const gnss = this.app.levelsMap.gnss;
    if (this.job === 'level' && this.lv.carrySet && ['shelf', 'truck', 'truck_bed', 'trunk_item', 'field_item'].includes(ud.type)) {
      ui.toast('扛著整組儀器。先架好，或按 G 拆開放地上再裝車。', 'warn', 3000); sfx.error(); return;
    }
    switch (ud.type) {
      case 'shelf':
        if (this.openShelfUI(ud.rack ?? 0)) return;
        if (this.carrying) this.shelve(this.app.player.raycaster?.intersectObject?.(obj)?.[0]?.point);
        return;
      case 'field_item':
        if (ud.item === 'water' && !this.carrying && (window as AnyObj).__waterMenu) { (window as AnyObj).__waterMenu(ud.uid); return; }
        if (this.onShelf(ud.uid)) {
          const rk = this.shelfRackOf(ud.uid);
          if (rk >= 0 && this.openShelfUI(rk)) return;
        }
        if (this.carrying && this.onShelf(ud.uid)) { this.shelve(obj.position); return; }
        if (this.carrying) { ui.toast('一次只能拿一件，先放下，或點貨架放回去。', 'warn'); sfx.error(); return; }
        this.pickGround(ud.uid);
        return;
      case 'truck':
        if (this.openTruckUI('cab')) return;
        if (this.carrying) this.openLoader(); else this.enterTruck();
        return;
      case 'truck_bed':
      case 'trunk_item':
        if (this.openTruckUI('bed')) return;
        if (this.carrying) this.openLoader(); else this.openUnload();
        return;
    }
    if (this.sub) { this.sub.interact(obj); return; }
    if (ud.type === 'npc') { this.events.interact(obj); return; }
    if (ud.type === 'monument' && String(ud.label || '').includes('CKSV') && !this.tripodSet) {
      if (this.carrying !== 'tripod') { this.needItem('tripod'); return; }
      this.consumeHeld();
      gnss.onInteract(obj); // 舊關卡建立三腳架組並進入 step 1
      const t = gnss.tripodMesh;
      if (t) {
        t.userData.tribrach.visible = false;
        t.userData.head.visible = false;
        t.userData.accessories.visible = false;
      }
      this.tripodSet = true;
      this.events.onTripodSet();
      this.panel('site', '腳架架好了。接著拿基座箱過來裝上。');
      return;
    }
    if (ud.type === 'instrument' && ud.instrumentType === 'gnss') {
      const t = gnss.tripodMesh;
      if (!this.tribrachOn) {
        if (this.carrying !== 'tribrach') { this.needItem('tribrach'); return; }
        this.consumeHeld(); this.tribrachOn = true; if (t) t.userData.tribrach.visible = true;
        this.panel('site', '基座裝好了。再把 GNSS 接收儀拿過來。');
        return;
      }
      if (!this.receiverOn) {
        if (this.carrying !== 'gnss') { this.needItem('gnss'); return; }
        this.consumeHeld(); this.receiverOn = true; if (t) t.userData.head.visible = true;
        this.phase = 'observe';
        gnss.currentStep = 1;
        this.app.updateMissionPanel(gnss.title, gnss.getTasks(), 1, '儀器都裝好了。對著儀器按 E 進行定心定平。');
        return;
      }
      if (gnss.currentStep >= 2 && !this.toolbagOn) {
        const nearBag = this.ground.find(g => g.item === 'toolbag' && Math.hypot(g.obj.position.x - CKSV.x, g.obj.position.z - CKSV.z) < 4);
        if (this.carrying === 'toolbag') this.consumeHeld();
        else if (nearBag) { this.app.sceneManager.scene.remove(nearBag.obj); this.unregister(nearBag.obj); this.ground = this.ground.filter(x => x !== nearBag); }
        else { this.needItem('toolbag'); return; }
        this.toolbagOn = true;
        if (t) t.userData.accessories.visible = true;
        ui.toast('拿出鋼捲尺和控制手簿。', 'info');
        return;
      }
      const blocked = this.events.blockedReason();
      if (blocked) { sfx.error(); ui.toast(blocked, 'warn', 2600); return; }
      gnss.onInteract(obj);
    }
  }

  getFreeInteractPrompt(): string | null {
    if (this.inTruck || !this.sub) return null;
    return this.sub.freePrompt();
  }

  onFreeInteract() {
    if (this.inTruck) { this.exitTruck(); return; }
    if (this.sub && this.sub.freeInteract()) return;
    if (this.carrying) this.dropHeld();
  }

  /** G 鍵 */
  onKey(e: KeyboardEvent): boolean {
    if (this.sub && !this.inTruck && this.sub.onKey(e)) return true;
    if (e.code === 'KeyG' && !this.inTruck && this.carrying) { this.dropHeld(); return true; }
    if (e.code === 'KeyF' && !this.inTruck && !['brief', 'done'].includes(this.phase)) { this.drink(); return true; }
    if (this.inTruck && e.code === 'KeyR') { this.radio.power(); return true; }
    if (this.inTruck && e.code === 'KeyN') { this.radio.next(1); return true; }
    if (this.inTruck && e.code === 'KeyB') { this.radio.next(-1); return true; }
    if (this.inTruck && e.code === 'KeyL') { this.radioList = !this.radioList; return true; }
    if (this.inTruck && this.radioList && e.code === 'KeyU') { this.editStationUrl(this.radio.index); return true; }
    if (this.inTruck && this.radioList && /^Digit[0-9]$/.test(e.code)) {
      const k = e.code.slice(5);
      const i = this.radio.stations.findIndex(st => st.key === k);
      if (i >= 0) this.radio.tune(i);
      return true;
    }
    return false;
  }

  /** 自訂某台的串流網址 (目錄查不到時，玩家可從官網播放器取得網址貼上) */
  private editStationUrl(i: number) {
    const st = this.radio.stations[i];
    if (!st) return;
    if (document.exitPointerLock) document.exitPointerLock();
    const v = window.prompt(`貼上「${st.name}」的串流網址（.m3u8、.mp3 或 .aac）。\n留空並按確定可清除自訂網址。`, st.custom ? st.url : '');
    if (v === null) return;
    this.radio.setCustomUrl(i, v.trim());
    ui.toast(v.trim() ? `已儲存「${st.name}」的網址，下次開遊戲也會記得。` : `已清除「${st.name}」的自訂網址。`, 'good', 3000);
  }

  consumeHeld() {
    if (this.held) this.handAnchor().remove(this.held);
    this.held = null;
    this.carrying = null;
    this.handPoseReset();
    sfx.thud();
  }

  // ================================================================
  // 水分
  // ================================================================
  private updateWater(dt: number) {
    if (!['prep', 'toSite', 'site', 'observe', 'packup', 'return'].includes(this.phase)) return;
    if (this.app.player.isModalOpen()) return;
    const heavy = this.carrying && ITEMS[this.carrying].heavy;
    const rate = (100 / 360) * (this.inTruck ? 0.25 : heavy ? 1.8 : 1);
    this.water = Math.max(0, this.water - rate * dt);
    if (this.water < 35 && !this.thirstWarned) {
      this.thirstWarned = true;
      ui.toast('口好渴……去點那箱礦泉水（在後斗或地上）喝一瓶。', 'warn', 4500);
    }
    if (this.water > 50) this.thirstWarned = false;
    document.body.classList.toggle('thirsty', this.water <= 0.5);
    // 中暑：30% 以下畫面開始暗、晃；10% 以下一定要先喝水
    const hs = this.heatStage;
    document.body.classList.toggle('heat1', hs >= 1);
    document.body.classList.toggle('heat2', hs >= 2);
    if (hs > this.heatWarned) {
      this.heatWarned = hs;
      if (hs === 1) ui.toast('太陽好毒……有點中暑了，找個地方喝水。', 'warn', 3800);
      else ui.toast('頭很暈、手都在抖——先喝水，其他的等一下再說。', 'bad', 4200);
    } else if (hs < this.heatWarned) this.heatWarned = hs;
    if (this.water <= 0.5 && !this.inTruck) this.app.player.carrySpeedFactor = (this.app.player.carrySpeedFactor || 1) * 0.7;
  }

  /** 0 = 正常、1 = 有點中暑 (畫面變暗、晃)、2 = 一定要先喝水 */
  get heatStage(): 0 | 1 | 2 { return this.water < 10 ? 2 : this.water < 30 ? 1 : 0; }
  private heatWarned = 0;

  hydrate(amount: number, label: string) {
    this.water = Math.min(100, this.water + amount);
    this.drinks++;
    sfx.gulp();
    ui.toast(`喝了${label}，水分 ${Math.round(this.water)}%`, 'good', 2000);
  }

  /** 手機版：點礦泉水 / 點車尾選單用 */
  mobileDrink() { this.drink(); }
  get waterBottles() { return this.bottles; }
  /** 附近有沒有水可以喝 */
  canDrink() {
    const p = this.app.player.position;
    return this.carrying === 'water'
      || this.ground.some(g => g.item === 'water' && Math.hypot(g.obj.position.x - p.x, g.obj.position.z - p.z) < 3)
      || (this.grid.has('water') && (() => { const t = this.truck.toWorld(-2.6, 0, 0); return Math.hypot(t.x - p.x, t.z - p.z) < 3.5; })());
  }

  /** F：喝水 (手上、附近地上、或站在車尾時後斗裡有礦泉水) */
  private drink() {
    const p = this.app.player.position;
    const near = this.carrying === 'water'
      || this.ground.some(g => g.item === 'water' && Math.hypot(g.obj.position.x - p.x, g.obj.position.z - p.z) < 3)
      || (this.grid.has('water') && (() => { const t = this.truck.toWorld(-2.6, 0, 0); return Math.hypot(t.x - p.x, t.z - p.z) < 3.5; })());
    if (!near) { sfx.error(); ui.toast(this.grid.has('water') ? '礦泉水在後斗，到車尾再喝。' : '附近沒有水……那箱礦泉水呢？', 'warn', 2600); return; }
    if (this.bottles <= 0) { ui.toast('礦泉水喝完了。', 'warn'); return; }
    if (this.water > 92) { ui.toast('還不渴。', 'info', 1400); return; }
    this.bottles--;
    this.hydrate(55, `一瓶礦泉水（剩 ${this.bottles} 瓶）`);
  }

  /** 測試工具：第一天的儀器一鍵架好 (腳架、基座、接收儀，定心定平完成) */
  debugSetupGnss(): string {
    if (this.job !== 'gnss' || !['site', 'observe'].includes(this.phase)) return '要先到第一天的現場。';
    if (this.inTruck) return '先下車。';
    const gnss = this.app.levelsMap.gnss;
    const sm = this.app.sceneManager;
    if (!this.tripodSet) {
      const mon = sm.interactiveObjects.find((o: AnyObj) => o.userData.type === 'monument' && String(o.userData.label).includes('CKSV'));
      if (!mon) return '找不到 CKSV。';
      if (this.carrying) this.consumeHeld();
      this.hold('tripod');
      this.onInteract(mon);
    }
    const t = gnss.tripodMesh;
    this.tribrachOn = this.receiverOn = true;
    if (t) { t.userData.tribrach.visible = true; t.userData.head.visible = true; }
    // 解出讓氣泡和對點都歸零的腳螺旋 / 基座平移
    const tx = -0.5275 / 1.0175, ty = 0.4425 / 1.0175;
    const sum = ty / 0.08, diff = tx / 0.12;
    Object.assign(gnss, { screwA: (sum - diff) / 2, screwB: (sum + diff) / 2, screwC: 0, shiftX: 0.55 + 0.35 * tx, shiftY: -0.45 + 0.35 * ty });
    gnss.recalculateTribrachPhysics();
    gnss.finalCenteringErrorMm = parseFloat(gnss.currentCenterErrorMm || '0');
    gnss.finalLevelingErrorMm = parseFloat(gnss.currentLevelErrorMm || '0');
    gnss.currentStep = Math.max(2, gnss.currentStep);
    this.phase = 'observe';
    this.app.updateMissionPanel(gnss.title, gnss.getTasks(), gnss.currentStep, '（測試工具）儀器已架好、定心定平完成。');
    return '儀器架好了，定心定平完成。碰腳架事件幾秒內會發生。';
  }

  toolbagNear(): boolean {
    if (this.carrying === 'toolbag' || this.toolbagOn) return true;
    const p = this.app.player.position;
    return this.ground.some(g => g.item === 'toolbag' && Math.hypot(g.obj.position.x - p.x, g.obj.position.z - p.z) < 4);
  }

}
