/**
 * 第三天佈標的現場事件 (都不預警)
 *  - 農夫阿伯：在田裡噴漆就會跑來；好好講會順手把阿黃拴起來
 *  - 阿黃：漆還沒乾就從農舍跑出來踩過去 (交通錐沒用)；學弟顧標才擋得住
 *  - 鐵牛車：中途會開過農路，標在路面上就會被輾
 *  - 廟公：在廟埕佈標會出來提醒下午有進香團
 *  - 學弟遞錯漆 (噴黑漆時拿成白的，在佈標畫面裡處理)
 *  - 進香團遊覽車：標都佈完、準備飛的時候開進廟埕 (作業車擋路會被叫去移車)
 *  - 「你們要徵收喔？」：村民來問，講不清楚就引來一群人圍觀
 *  - 路邊停車：佈完標後有台車停在農路的標上，要去農舍請車主移車
 * 每天從事件池抽 3～4 個；上次留下的人情 (Progress.rel3) 會影響這次。
 */
import * as THREE from 'three';
import type { AnyObj } from './legacy';
import { SM } from './legacy';
import { buildPerson, animateWalk, buildDog, animateDog } from './npc';
import { asstName, loadProgress, relFromDays, type Rel3, type Progress } from './jobs';
import { tell, whatIf } from './story';
import { toWorld, toLocal, topAt } from './gcpSite';
import { bark } from './sound';
import * as ui from './ui';
import * as sfx from './sfx';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** 漆多久會乾 (秒) */
export const DRY_TIME = 120;

type Kind = 'farmer' | 'keeper' | 'dog' | 'tractor' | 'bus' | 'car' | 'villager' | 'crowd' | 'owner' | 'driver';
interface Actor { kind: Kind; g: THREE.Group; state: string; t: number; path?: { x: number; z: number }[]; i?: number; speed?: number; target?: AnyObj; onArrive?: () => void; wait?: number }
const VEHICLE: Kind[] = ['tractor', 'bus', 'car'];
const isVeh = (k: Kind) => VEHICLE.includes(k);

/** 事件池 (每天抽 3～4 個) */
export type PoolId = 'dog' | 'farmer' | 'tractor' | 'temple' | 'eagle' | 'grandma' | 'rumor' | 'parking';
export const POOL_ALL: PoolId[] = ['dog', 'farmer', 'tractor', 'temple', 'eagle', 'grandma', 'rumor', 'parking'];
export const POOL_NAME: Record<PoolId, string> = {
  dog: '阿黃', farmer: '田主阿伯', tractor: '鐵牛車', temple: '廟公＋進香團', eagle: '大冠鷲', grandma: '阿嬤', rumor: '徵收謠言', parking: '路邊停車',
};
const LOOKS: Record<string, { shirt: number; pants: number; hat: 'straw' | 'cap' | null; skin: number }[]> = {
  villager: [{ shirt: 0x8d6e63, pants: 0x424242, hat: 'cap', skin: 0xb98060 }],
  crowd: [
    { shirt: 0x9e9d24, pants: 0x3e2723, hat: 'straw', skin: 0xb07850 },
    { shirt: 0xad1457, pants: 0x37474f, hat: null, skin: 0xd1a07a },
    { shirt: 0x546e7a, pants: 0x263238, hat: 'cap', skin: 0xc68a5e },
    { shirt: 0xef6c00, pants: 0x4e342e, hat: null, skin: 0xb98060 },
  ],
  owner: [{ shirt: 0x0277bd, pants: 0x212121, hat: null, skin: 0xc68a5e }],
  driver: [{ shirt: 0xfafafa, pants: 0x263238, hat: 'cap', skin: 0xb98060 }],
};

/** 轎車 (面向 +X)：長 4.4 m */
function buildCar(): THREE.Group {
  const S = SM();
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.35, metalness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.15, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
  g.add(S.mk(S.rbox(4.4, 0.7, 1.75, 0.15), body, 0, 0.62, 0));
  g.add(S.mk(S.rbox(2.3, 0.55, 1.6, 0.15), body, -0.25, 1.2, 0));
  g.add(S.mk(new THREE.BoxGeometry(2.12, 0.42, 1.63), glass, -0.25, 1.2, 0));
  [-1.4, 1.35].forEach(x => [-1, 1].forEach(sd => g.add(S.mk(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14).rotateX(Math.PI / 2), dark, x, 0.33, sd * 0.82))));
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}

/** 鐵牛車 (面向 +X)：紅色車頭 + 大後輪 + 小拖斗 */
function buildTractor(): THREE.Group {
  const S = SM();
  const g = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  g.add(S.mk(S.rbox(1.3, 0.6, 0.8, 0.08), red, 0.5, 0.75, 0));
  g.add(S.mk(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8), S.M.black, 0.9, 1.3, 0.25));
  g.add(S.mk(new THREE.BoxGeometry(0.4, 0.06, 0.5), S.M.black, -0.2, 1.15, 0));
  [-1, 1].forEach(sd => {
    g.add(S.mk(new THREE.CylinderGeometry(0.55, 0.55, 0.3, 18).rotateX(Math.PI / 2), dark, -0.25, 0.55, sd * 0.6));
    g.add(S.mk(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14).rotateX(Math.PI / 2), dark, 1.0, 0.3, sd * 0.45));
  });
  // 拖斗
  const wood = new THREE.MeshStandardMaterial({ color: 0x8d6e4f, roughness: 0.9 });
  g.add(S.mk(new THREE.BoxGeometry(1.8, 0.4, 1.3), wood, -1.8, 0.8, 0));
  [-1, 1].forEach(sd => g.add(S.mk(new THREE.CylinderGeometry(0.3, 0.3, 0.18, 14).rotateX(Math.PI / 2), dark, -1.9, 0.3, sd * 0.7)));
  // 司機
  const d = buildPerson({ shirt: 0x6d8f3a, pants: 0x3e3e3e, hat: 'straw', skin: 0xb07850 });
  d.scale.setScalar(0.9);
  d.position.set(-0.2, 0.35, 0);
  g.add(d);
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}

/** 進香團遊覽車 (面向 +X)：長 10.5 m */
function buildBus(): THREE.Group {
  const S = SM();
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.4, metalness: 0.2 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.15, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
  g.add(S.mk(S.rbox(10.5, 2.7, 2.5, 0.25), white, 0, 1.75, 0));
  g.add(S.mk(new THREE.BoxGeometry(10.52, 0.35, 2.52), stripe, 0, 1.15, 0));
  g.add(S.mk(new THREE.BoxGeometry(9.2, 0.75, 2.53), glass, -0.4, 2.35, 0));
  g.add(S.mk(new THREE.BoxGeometry(0.06, 1.2, 2.2), glass, 5.25, 2.2, 0));
  [[-3.4], [3.3]].forEach(([x]) => [-1, 1].forEach(sd => g.add(S.mk(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 16).rotateX(Math.PI / 2), dark, x, 0.5, sd * 1.15))));
  // 車頭的進香旗
  g.add(S.mk(new THREE.BoxGeometry(0.02, 0.5, 0.9), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 }), 5.3, 3.4, 0.6));
  g.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
  return g;
}
/** 遊覽車停在廟埕的位置 (現場座標，車身沿 x) */
const BUS_PARK = { x: 27.5, z: 102.4 };

export class GcpEvents {
  private actors: Actor[] = [];
  private sm: AnyObj;
  // 狀態
  dogTied = false;
  dogDone = false;
  private dogAt = -1;
  farmerDone = false;
  keeperDone = false;
  tractorDone = false;
  private tractorAt = -1;
  private tractorBusy = false;
  /** 鐵牛車還在路上時又有人把標佈在農路上：等它回去再來一趟 */
  private tractorAgain = false;
  private busAt = -1;
  busParked = false;
  stormWarnAt = -1;
  stormAt = -1;
  raining = false;
  /** 學弟遞錯漆已經發生過 */
  canMixDone = false;
  private rain: THREE.Points | null = null;
  private fogSave: { color: number; near: number; far: number } | null = null;
  private t = 0;
  private rainEnd = -1;
  // ---- 事件池與人情
  pool = new Set<PoolId>();
  /** 起始人情是從第一、二天推出來的 (第一次玩) */
  fromDays = true;
  pr: Progress = loadProgress();
  /** 上次 (存檔) 留下的人情 */
  prev: Rel3 = { farmer: '', keeper: '', village: '' };
  /** 這次的人情 (收工時存回去) */
  rel: Rel3 = { farmer: '', keeper: '', village: '' };
  /** 廟公：客氣過 → 二樓幫看飛機、作業車停廟埕沒關係；敷衍過 → 飛到一半叫你移車 */
  keeperFriend = false;
  keeperAnnoyed = false;
  /** 阿伯提醒過鐵牛車 */
  tractorWarned = false;
  /** 里長要打電話到公司的理由 */
  chief: string[] = [];
  chiefCalled = 0;
  // ---- 徵收謠言
  private rumorAt = -1;
  rumorDone = false;
  private rumorMood: '' | 'deflect' | 'dismiss' = '';
  private crowdGcp: AnyObj | null = null;
  private crowdTalked = false;
  private kickAt = -1;
  private crowdAt = -1;
  // ---- 路邊停車
  private carAt = -1;
  carDone = false;
  private carGcp: AnyObj | null = null;
  // ---- 遊覽車被作業車擋住
  private busTalked = false;
  private busHonked = false;

  constructor(private job: AnyObj) {
    this.sm = job.fd.app.sceneManager;
  }

  reset() {
    this.actors.forEach(a => this.sm.scene.remove(a.g));
    this.actors = [];
    this.dogTied = this.dogDone = this.farmerDone = this.keeperDone = this.tractorDone = this.canMixDone = false;
    this.dogAt = this.tractorAt = this.stormWarnAt = this.stormAt = this.busAt = -1;
    this.tractorBusy = false; this.busParked = false; this.tractorAgain = false;
    this.stopRain();
    this.t = 0;
    this.canRolls = 0;
    this.keeperFriend = this.keeperAnnoyed = this.tractorWarned = false;
    this.chief = []; this.chiefCalled = 0;
    this.rumorAt = this.carAt = this.kickAt = this.crowdAt = -1; this.rumorDone = this.carDone = this.crowdTalked = false; this.rumorMood = '';
    this.crowdGcp = this.carGcp = null;
    this.busTalked = this.busHonked = false;
    const pr = loadProgress();
    this.pr = pr;
    // 第一次玩到第三天：用前兩天的結果；重玩第三天：用上次第三天留下的人情
    this.fromDays = !pr.rel3;
    this.prev = pr.rel3 ? { ...pr.rel3 } : relFromDays(pr);
    this.rel = { ...this.prev };
    this.drawPool();
  }

  has(id: PoolId) { return this.pool.has(id); }

  /** 從事件池抽 3～4 個 (上次得罪過的人一定會再出現) */
  drawPool() {
    const forced: PoolId[] = [];
    if (this.prev.farmer === 'bad') forced.push('farmer');
    if (this.prev.keeper === 'bad') forced.push('temple');
    if (this.prev.village === 'bad') forced.push('rumor');
    const ov = (window as unknown as { __gcpPool?: PoolId[] }).__gcpPool; // 測試用
    if (ov) { this.pool = new Set(ov); return; }
    const n = Math.max(forced.length, 3 + (Math.random() < 0.5 ? 1 : 0));
    const rest = POOL_ALL.filter(x => !forced.includes(x)).sort(() => Math.random() - 0.5);
    this.pool = new Set([...forced, ...rest.slice(0, n - forced.length)]);
    // 阿伯會順口提醒今天要注意的事：抽到阿伯 (或他一來就會打招呼) 時，確保他提醒的事今天真的會發生
    const tips: PoolId[] = ['tractor', 'rumor', 'parking'];
    if ((this.pool.has('farmer') || this.prev.farmer === 'good') && !tips.some(t => this.pool.has(t))) {
      const removable = [...this.pool].filter(x => !forced.includes(x) && x !== 'farmer');
      if (removable.length) this.pool.delete(removable[Math.floor(Math.random() * removable.length)]);
      this.pool.add(tips[Math.floor(Math.random() * tips.length)]);
    }
  }
  poolText() { return [...this.pool].map(p => POOL_NAME[p]).join('、'); }

  /** 抵達現場：排定鐵牛車、雷雨 */
  onArrive() {
    if (this.has('tractor')) this.tractorAt = this.t + 80 + Math.random() * 60;
    if (this.has('rumor')) this.rumorAt = this.t + 90 + Math.random() * 40;
    // 上次留下的人情
    if (this.prev.farmer === 'good') setTimeout(() => this.farmerHello(), 9000);
    if (this.prev.keeper === 'good') {
      this.keeperFriend = true;
      setTimeout(() => ui.toast('（廟公在廟口跟你揮手：「少年仔又來啦！車停廟埕沒關係喔！」）', 'info', 4000), 14000);
    }
    if (this.prev.keeper === 'bad') this.keeperAnnoyed = true;
  }

  snapshot() { return { dogTied: this.dogTied, dogDone: this.dogDone, farmerDone: this.farmerDone, keeperDone: this.keeperDone, tractorDone: this.tractorDone, canMixDone: this.canMixDone, stormIn: this.stormAt > 0 ? this.stormAt - this.t : -1, warnIn: this.stormWarnAt > 0 ? this.stormWarnAt - this.t : -1, raining: this.raining, t: this.t, busIn: this.busAt > 0 ? this.busAt - this.t : -1, busParked: this.busParked, pool: [...this.pool], rel: this.rel, prev: this.prev, keeperFriend: this.keeperFriend, keeperAnnoyed: this.keeperAnnoyed, tractorWarned: this.tractorWarned, chief: this.chief, chiefCalled: this.chiefCalled, rumorDone: this.rumorDone, carDone: this.carDone }; }
  restore(s: AnyObj) {
    if (!s) return;
    Object.assign(this, { dogTied: !!s.dogTied, dogDone: !!s.dogDone, farmerDone: !!s.farmerDone, keeperDone: !!s.keeperDone, tractorDone: !!s.tractorDone, canMixDone: !!s.canMixDone });
    if (s.pool) this.pool = new Set(s.pool);
    if (s.rel) this.rel = s.rel;
    if (s.prev) this.prev = s.prev;
    Object.assign(this, { keeperFriend: !!s.keeperFriend, keeperAnnoyed: !!s.keeperAnnoyed, tractorWarned: !!s.tractorWarned, chief: s.chief || [], chiefCalled: s.chiefCalled || 0, rumorDone: !!s.rumorDone, carDone: !!s.carDone });
    if (!this.rumorDone && this.has('rumor')) this.rumorAt = 60;
    this.t = 0;
    this.stormAt = s.stormIn > 0 ? s.stormIn : -1;
    this.stormWarnAt = s.warnIn > 0 ? s.warnIn : -1;
    if (!this.tractorDone && this.has('tractor')) this.tractorAt = 60;
    this.busAt = s.busIn > 0 ? s.busIn : -1;
    if (s.busParked) this.spawnBus(true);
    if (s.raining) this.startRain();
  }

  /** 標佈完、準備飛的時候：進香團遊覽車開進來 */
  onLayingDone() {
    if (this.has('temple') && !this.busParked && this.busAt < 0) this.busAt = this.t + 6;
    if (this.has('parking') && !this.carDone && this.carAt < 0) this.carAt = this.t + (this.has('temple') ? 30 : 14);
  }

  /** 現場時間往前推 (例如等航管核准) */
  advance(sec: number) { this.update(sec); }

  /** HUD：雷雨倒數 */
  stormText(): string | null {
    if (this.raining) return '下雨中';
    if (this.stormAt < 0) return null;
    const s = Math.max(0, this.stormAt - this.t);
    return `雷雨 ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  // ================================================================
  update(dt: number) {
    this.t += dt;
    const job = this.job;
    const fd = job.fd;
    const busy = job.benchBusy();
    // 鐵牛車
    if (this.tractorAt > 0 && this.t > this.tractorAt && !busy && !this.tractorBusy) { this.tractorAt = -1; this.tractorDone = true; this.spawnTractor(); }
    // 進香團遊覽車
    if (this.busAt > 0 && this.t > this.busAt && !busy && !this.busParked && !this.actors.some(a => a.kind === 'bus')) { this.busAt = -1; this.spawnBus(); }
    // 阿黃
    if (!this.dogDone && this.dogAt > 0 && this.t > this.dogAt && !busy) {
      const target = this.wetTarget();
      if (target) { this.dogDone = true; this.spawnDog(target); } else this.dogAt = -1;
    }
    // 雷雨
    if (this.stormWarnAt > 0 && this.t > this.stormWarnAt && !busy && ['site', 'observe'].includes(fd.phase)) {
      this.stormWarnAt = -1;
      this.stormAt = this.t + 480;
      sfx.phoneRing?.();
      ui.toast('📱 手機：【大雷雨即時訊息】未來 8 分鐘內本區將有雷雨，請注意。', 'warn', 6000);
      setTimeout(() => ui.toast(`學弟${asstName()}：「學長……下午還要飛欸，要快一點了。」`, 'info', 3500), 2500);
    }
    if (this.stormAt > 0 && !this.raining && this.t > this.stormAt) { this.startRain(); this.rainEnd = this.t + 150; }
    if (this.raining && this.rainEnd > 0 && this.t > this.rainEnd) { this.rainEnd = -1; this.stopRain(); ui.toast('雨停了。', 'info', 2500); }
    if (this.rain) this.rainTick(dt);
    // 徵收謠言：村民來問
    if (this.rumorAt > 0 && this.t > this.rumorAt && !busy && !this.rumorDone && ['site', 'observe'].includes(fd.phase) && !fd.inTruck) { this.rumorAt = -1; this.rumorDone = true; this.spawnRumor(); }
    if (this.crowdAt > 0 && this.t > this.crowdAt) { this.crowdAt = -1; this.spawnCrowd(); }
    if (this.kickAt > 0 && this.t > this.kickAt) { this.kickAt = -1; this.kickGcp(); }
    // 路邊停車 (遊覽車還在路上就等它停好)
    if (this.carAt > 0 && this.t > this.carAt && !this.carDone && !this.actors.some(a => a.kind === 'bus' && a.state === 'path')) { this.carAt = -1; this.carDone = true; this.spawnCar(); }
    // 里長打電話到公司 (飛到一半)
    if (this.chief.length > this.chiefCalled && job.uav.mode === 'mission' && !job.uav.paused && !document.querySelector('.qte, .dialog')) this.callChief('fly');
    for (const a of [...this.actors]) { a.t += dt; this.step(a, dt); }
  }

  /** 里長打到公司：飛行中是組長打手機來；回公司才算的話組長當面講 */
  callChief(where: 'fly' | 'office') {
    while (this.chief.length > this.chiefCalled) {
      const why = this.chief[this.chiefCalled++];
      this.job.fd.addPR(-3, `里長打電話到公司投訴（${why}）`);
      tell('得罪的人去找里長', `里長打電話到公司投訴：${why}`);
      if (where === 'fly') { sfx.phoneRing?.(); ui.toast(`📱 組長：「欸，里長剛剛打來公司，說${why}……你們在外面客氣一點啦！」`, 'bad', 6500); }
      else ui.toast(`組長：「今天里長打電話來，說${why}。我幫你們道歉了，下次注意。」`, 'bad', 6500);
    }
  }

  /** 這個標現在被什麼擋住 (航拍那一瞬間用) */
  hideReason(g: AnyObj): string | null {
    for (const a of this.actors) {
      const d = Math.hypot(a.g.position.x - g.x, a.g.position.z - g.z);
      if (a.kind === 'car' && a.state !== 'path' && d < 1.8) return '路邊停的車壓在上面';
      if (a.kind === 'crowd' && d < 0.9) return '圍觀的人站在上面';
    }
    return null;
  }

  /** 互動 (車主、圍觀的人) */
  prompt(hit: THREE.Object3D): string | null {
    const a = this.actors.find(x => x.g === hit);
    if (!a) return null;
    if (a.kind === 'owner' && a.state === 'idle') return '跟車主說話';
    if (a.kind === 'crowd' && !this.crowdTalked) return '跟圍觀的鄉親說明';
    return null;
  }
  interact(hit: THREE.Object3D): boolean {
    const a = this.actors.find(x => x.g === hit);
    if (!a) return false;
    if (a.kind === 'owner' && a.state === 'idle') { this.talkOwner(a); return true; }
    if (a.kind === 'crowd' && !this.crowdTalked) { this.talkCrowd(a); return true; }
    return false;
  }

  /** 剛做好、還沒乾的標 (沒人顧) */
  private wetTarget(): AnyObj | null {
    const job = this.job;
    const list = job.gcps.filter((g: AnyObj) => job.time - g.t < DRY_TIME && !(job.guarding === g));
    return list.length ? list[list.length - 1] : null;
  }

  /** 每次做完一個標 */
  onGcpDone(g: AnyObj) {
    const p = loadProgress();
    if (this.has('dog') && !this.dogDone && this.dogAt < 0 && !this.dogTied) this.dogAt = this.t + 25 + Math.random() * 25;
    void p;
    if (this.has('farmer') && g.spot.crop && !this.farmerDone) { this.farmerDone = true; setTimeout(() => this.spawnFarmer(g), 1200); }
    if (this.has('temple') && g.spot.temple && !this.keeperDone) { this.keeperDone = true; setTimeout(() => this.spawnKeeper(g), 1500); }
    // 標佈在農路上：鐵牛車過一陣子就會經過 (不管之前來過沒)
    if (this.has('tractor')) {
      if (g.spot.lane && this.tractorBusy) this.tractorAgain = true;
      else if (g.spot.lane && (this.tractorAt < 0 || this.tractorAt > this.t + 70)) this.tractorAt = this.t + 40 + Math.random() * 30;
    }
    // 佈到第二個點：謠言開始傳
    if (this.has('rumor') && !this.rumorDone && this.job.gcps.length >= 2 && (this.rumorAt < 0 || this.rumorAt > this.t + 25)) this.rumorAt = this.t + 15 + Math.random() * 10;
  }

  // ================================================================
  // 角色
  // ================================================================
  private spawn(kind: Kind, lx: number, lz: number, look = 0): Actor { const w = toWorld(lx, lz); return this.spawnW(kind, w.x, w.z, look); }
  private spawnW(kind: Kind, wx: number, wz: number, look = 0): Actor {
    let g: THREE.Group;
    if (kind === 'farmer') g = buildPerson({ shirt: 0x7cb342, pants: 0x5d4037, hat: 'straw', skin: 0xb07850 });
    else if (kind === 'keeper') g = buildPerson({ shirt: 0xdddddd, pants: 0x37474f, hat: null, skin: 0xc68a5e });
    else if (kind === 'dog') g = buildDog();
    else if (kind === 'bus') g = buildBus();
    else if (kind === 'car') g = buildCar();
    else if (kind === 'tractor') g = buildTractor();
    else { const L = LOOKS[kind]; g = buildPerson(L[look % L.length]); }
    const w = { x: wx, z: wz };
    g.position.set(w.x, topAt(this.sm, w.x, w.z), w.z);
    g.userData.type = 'npc';
    g.userData.npc = kind;
    this.sm.scene.add(g);
    const a: Actor = { kind, g, state: 'idle', t: 0 };
    this.actors.push(a);
    return a;
  }
  private remove(a: Actor) { this.sm.scene.remove(a.g); this.job.ensureInteractive(a.g, false); this.actors = this.actors.filter(x => x !== a); }

  private walk(a: Actor, tx: number, tz: number, speed: number, dt: number): boolean {
    const g = a.g;
    const dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
    const anim = a.kind === 'dog' ? animateDog : animateWalk;
    if (d < 0.25) { if (!isVeh(a.kind)) anim(g, a.t, 0); return true; }
    const st = Math.min(d, speed * dt);
    g.position.x += dx / d * st; g.position.z += dz / d * st;
    g.position.y = topAt(this.sm, g.position.x, g.position.z);
    g.rotation.y = Math.atan2(-dz, dx);
    if (!isVeh(a.kind)) anim(g, a.t, speed / 1.5);
    return false;
  }
  private face(a: Actor, x: number, z: number) { if (isVeh(a.kind)) return; a.g.rotation.y = Math.atan2(-(z - a.g.position.z), x - a.g.position.x); (a.kind === 'dog' ? animateDog : animateWalk)(a.g, a.t, 0); }

  private step(a: Actor, dt: number) {
    const p = this.job.fd.app.player.position;
    switch (a.state) {
      case 'path': {
        const pt = a.path![a.i!];
        // 鐵牛車：前面有人就停下來按喇叭
        if (isVeh(a.kind)) {
          const fx = Math.cos(a.g.rotation.y), fz = -Math.sin(a.g.rotation.y);
          const blockers = [this.job.fd.inTruck ? null : p, this.job.asst.g.visible ? this.job.asst.g.position : null].filter(Boolean) as THREE.Vector3[];
          const blocked = blockers.some(b => { const ax = (b.x - a.g.position.x) * fx + (b.z - a.g.position.z) * fz; const sd = Math.abs((b.x - a.g.position.x) * fz - (b.z - a.g.position.z) * fx); return ax > 0 && ax < (a.kind === 'bus' ? 7.5 : 4.5) && sd < 1.8; });
          if (blocked) { a.wait = (a.wait || 0) + dt; if (a.wait > 1.5) { a.wait = -2; sfx.honk(Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z)); } return; }
          // 遊覽車：作業車擋在前面
          if (a.kind === 'bus' && this.truckBlocks(a)) { this.busBlocked(a, dt); return; }
          this.crush(a);
        }
        if (this.walk(a, pt.x, pt.z, a.speed!, dt)) {
          a.i!++;
          if (a.i! >= a.path!.length) { a.state = 'idle'; const f = a.onArrive; a.onArrive = undefined; f?.(); }
        }
        if (a.kind === 'dog') this.dogStep(a);
        return;
      }
      case 'seek': {
        const d = Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z);
        if (d < 2.3) {
          this.face(a, p.x, p.z);
          if (!this.job.fd.app.player.isModalOpen() && !this.job.benchBusy() && !this.job.fd.inTruck) { a.state = 'talk'; a.onArrive?.(); }
          return;
        }
        this.walk(a, p.x, p.z, 1.6, dt);
        return;
      }
      case 'idle':
        if (!isVeh(a.kind)) this.face(a, p.x, p.z);
        return;
      case 'lie':
        return;
    }
  }

  private go(a: Actor, pts: { x: number; z: number }[], speed: number, onArrive?: () => void) {
    a.state = 'path'; a.path = pts; a.i = 0; a.speed = speed; a.onArrive = onArrive;
  }
  private L(lx: number, lz: number) { return toWorld(lx, lz); }

  // ---------------------------------------------------------------- 農夫阿伯
  private spawnFarmer(g: AnyObj) {
    const a = this.spawn('farmer', -24, 106);
    a.onArrive = () => this.talkFarmer(a, g);
    a.state = 'seek';
  }

  private talkFarmer(a: Actor, g: AnyObj) {
    const job = this.job;
    const pr = loadProgress();
    const know = pr.uncle === 'explain' || pr.uncle === 'order';
    ui.faceSpeaker(a.g);
    const grudge = this.prev.farmer === 'bad';
    const u = this.pr.uncle;
    const line = grudge
      ? (!this.fromDays ? '「又是你！上次就叫你不要在我田裡亂噴，這次又來？！」'
        : u === 'lie' ? '「前幾天騙我說要開高速公路的就是你吧！現在又跑來噴我的田？！」'
          : u === 'secret' ? '「國家機密的少年仔！現在又跑來我田裡噴什麼機密？！」'
            : '「前幾天問你都不理我，現在跑來噴我的田？！」')
      : know
        ? `「欸？你不是前幾天在那邊測量的少年仔？……那也不能在我田裡噴漆啊！你在我田裡噴什麼漆？」`
        : '「少年仔！你在我田裡噴什麼漆？我這是要種菜的捏！」';
    const begOk = !grudge && (know || Math.random() < 0.5);
    ui.showDialog('阿伯（田主）', line, [
      { id: 'move', text: '「歹勢歹勢，我馬上移到田埂上，這個我清掉。」', reply: `「這樣就對了嘛。……我家阿黃很皮，我先把牠綁起來，免得去踩你們的東西。啊對了，${this.farmerTip()}」`, score: 2, tag: '在田裡噴漆，道歉移點（阿伯順手綁狗）' },
      { id: 'beg', text: '「這是政府的航測案，拜託通融一下，拍完就沒事了。」', reply: begOk ? '「好啦好啦，拍完趕快弄掉喔。」' : '「政府就可以隨便噴人家的田喔？！我去找里長！」（阿伯很不爽，走回農舍拿了一條水管出來）', score: begOk ? 0 : -2, tag: begOk ? '在田裡噴漆，請阿伯通融' : '在田裡噴漆，硬拗政府的案子（阿伯去找里長）' },
      { id: 'ignore', text: '（繼續做自己的事）', reply: '「……好，你不理我。」（阿伯轉頭走回農舍，拿了一條水管出來）', score: -3, tag: '在田裡噴漆，不理阿伯（標被水沖掉）' },
    ], (o) => {
      job.fd.addPR(o.score, o.tag);
      if (grudge) tell(this.farmerMemory(), '今天噴到阿伯的田，他一點都不肯通融');
      if (o.id === 'move') {
        this.rel.farmer = 'good';
        tell(`在阿伯田裡佈標，被抓到就道歉移點`, `阿伯把阿黃綁起來，還提醒你：${this.lastTip}`);
        whatIf('如果硬拗或不理阿伯，他會拖水管把標沖掉，還去找里長投訴。');
      } else if (o.id === 'beg' && begOk) {
        tell('在阿伯田裡佈標，拜託他通融', '阿伯勉強答應');
        whatIf('如果道歉移點，阿伯會順手綁狗，還會提醒你下午要注意的事。');
      } else {
        this.rel.farmer = 'bad'; this.chief.push('有人在阿伯的田裡亂噴漆，講都講不聽');
        tell(o.id === 'beg' ? '在阿伯田裡佈標還硬拗' : '在阿伯田裡佈標還不理他', `阿伯拖水管出來沖掉 ${g.name}，還去找里長`);
        whatIf('如果道歉移點，阿伯會順手綁狗，還會提醒你下午要注意的事。');
      }
      if (o.id === 'move') {
        this.dogTied = true;
        this.dogAt = -1;
        job.removeGcp(g);
        ui.toast(`${g.name} 清掉了，換個地方重佈。`, 'info', 3000);
        this.go(a, [this.L(-24, 106)], 1.4, () => this.remove(a));
      } else if (o.id === 'beg' && begOk) {
        this.go(a, [this.L(-24, 106)], 1.4, () => this.remove(a));
      } else {
        // 回農舍拿水管，馬上回來沖
        const w = toWorld(-21, 107.6);
        this.go(a, [w], 2.4, () => {
          if (!job.gcps.includes(g)) { this.remove(a); return; }
          this.holdHose(a, true);
          ui.toast('（阿伯從農舍拖了一條水管出來……）', 'warn', 3000);
          this.go(a, [{ x: g.x + 1.6, z: g.z + 0.8 }], 2.2, () => {
            this.face(a, g.x, g.z);
            this.sprayWater(a, g, 3.2, () => {
              job.damage(g, 'washed');
              ui.toast(`阿伯用水管把 ${g.name} 的漆沖掉了！`, 'bad', 4500);
              ui.thought(`${g.name} 被沖掉了……要重佈一個。`, 4500);
              this.go(a, [w], 1.6, () => { this.holdHose(a, false); this.remove(a); });
            });
          });
        });
      }
      job.relock();
    });
  }

  /** 阿伯記得的事 (第一天) */
  private farmerMemory(): string {
    if (!this.fromDays) return '上次';
    const u = this.pr.uncle;
    return u === 'lie' ? '第一天亂說要開高速公路' : u === 'secret' ? '第一天說「國家機密」' : u === 'ignore' ? '第一天不理阿伯' : u === 'explain' ? '第一天好好跟阿伯說明' : u === 'order' ? '第一天拿派工單給阿伯看' : '之前';
  }
  /** 村民記得的事 (第一天) */
  private villageMemory(): string {
    if (!this.fromDays) return '上次';
    const p = this.pr;
    if (p.owner1 === 'argue') return `第一天頂撞${p.owner1Chief ? '里長' : '地主'}、鬧到叫警察`;
    if (p.auntie1 === 'move-blame') return '第一天亂動界樁還推給阿姨';
    if (p.uncle === 'lie') return '第一天說要開高速公路';
    if (p.boss1 === 'blame') return '第一天被 PO 上社團還推給阿伯';
    if (p.owner1 === 'doc') return `第一天拿公文給${p.owner1Chief ? '里長' : '地主'}看`;
    if (p.auntie1 === 'ok' || p.auntie1 === 'proper') return '第一天教阿姨申請鑑界';
    return '之前';
  }

  /** 阿伯順口提醒：看今天會發生什麼 */
  private lastTip = '';
  private farmerTip(): string { this.lastTip = this.tipText(); return this.lastTip; }
  private tipText(): string {
    if (this.has('tractor')) { this.tractorWarned = true; return '下午鐵牛車會從那條農路過喔，東西不要擺在路上。'; }
    if (this.has('rumor')) return '等一下要是有人來問你們是不是要徵收，你就好好講，這裡的人很怕徵收。';
    if (this.has('parking')) return '隔壁那個常常把車停在農路上，擋到你就去農舍叫他。';
    return '要喝水跟我講。';
  }

  /** 上次跟阿伯處得好：一到現場他就來打招呼、先把狗綁好 */
  private farmerHello() {
    if (!this.job.on || this.farmerDone) return;
    const a = this.spawn('farmer', -24, 106);
    a.state = 'seek';
    a.onArrive = () => {
      ui.faceSpeaker(a.g);
      this.dogTied = true; this.dogAt = -1;
      tell(this.farmerMemory(), '今天一到現場，阿伯就先把阿黃綁起來，還提醒你要注意的事');
      ui.showDialog('阿伯（田主）', `「欸！${this.fromDays ? '前幾天那個好好跟我說明的少年仔' : '又是你們喔！上次很客氣的那個少年仔'}！今天換來我田這邊喔？阿黃我先綁起來了，免得去踩你們的東西。${this.farmerTip()}」`, [
        { id: 'ok', text: '「謝謝阿伯！今天也會小心，不會噴到你的田。」', reply: '「好啦，辛苦喔。」', score: 1, tag: '阿伯記得上次的事，主動把狗綁好' },
      ], (o) => {
        this.job.fd.addPR(o.score, o.tag);
        this.go(a, [this.L(-24, 106)], 1.4, () => this.remove(a));
        this.job.relock();
      });
    };
  }

  /** 手上拿著綠色水管 (拖在地上) */
  private holdHose(a: Actor, on: boolean) {
    const old = a.g.getObjectByName('hose');
    if (old) a.g.remove(old);
    if (!on) return;
    const S = SM();
    const green = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6 });
    const h = new THREE.Group(); h.name = 'hose';
    const pts = [V(0.42, 0.95, -0.22), V(0.25, 0.5, -0.35), V(-0.3, 0.05, -0.4), V(-1.6, 0.03, -0.3), V(-3.2, 0.03, 0.1)];
    h.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.022, 6), green));
    h.add(S.mk(new THREE.CylinderGeometry(0.03, 0.025, 0.14, 8).rotateZ(-Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: 0xf59e0b }), 0.48, 0.98, -0.22, true));
    a.g.add(h);
  }

  /** 水柱：從水管頭噴到標上 */
  private sprayWater(a: Actor, g: AnyObj, sec: number, done: () => void) {
    const n = 220;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbfe3ff, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
    this.sm.scene.add(pts);
    const life = new Float32Array(n).map(() => Math.random());
    const t0 = performance.now();
    const nozzle = () => a.g.localToWorld(V(0.56, 0.98, -0.22));
    const target = V(g.x, g.y + 0.02, g.z);
    sfx.spray(true);
    const step = () => {
      const t = (performance.now() - t0) / 1000;
      const s0 = nozzle();
      for (let i = 0; i < n; i++) {
        life[i] += 0.03; if (life[i] > 1) life[i] -= 1;
        const k = life[i];
        const jx = (Math.sin(i * 12.9) * 0.5) * 0.5, jz = (Math.cos(i * 7.3) * 0.5) * 0.5;
        pos[i * 3] = s0.x + (target.x + jx - s0.x) * k;
        pos[i * 3 + 2] = s0.z + (target.z + jz - s0.z) * k;
        pos[i * 3 + 1] = s0.y + (target.y - s0.y) * k + Math.sin(k * Math.PI) * 0.6;
      }
      geo.attributes.position.needsUpdate = true;
      if (t < sec) requestAnimationFrame(step);
      else { this.sm.scene.remove(pts); sfx.spray(false); done(); }
    };
    step();
  }

  // ---------------------------------------------------------------- 廟公
  private spawnKeeper(g: AnyObj) {
    const a = this.spawn('keeper', 29, 106.4);
    a.onArrive = () => this.talkKeeper(a, g);
    a.state = 'seek';
  }
  private talkKeeper(a: Actor, g: AnyObj) {
    const job = this.job;
    ui.faceSpeaker(a.g);
    ui.showDialog('廟公', this.prev.keeper === 'bad' ? '「又是你們……少年仔，下午兩點有進香團，遊覽車會停滿整個廟埕。這次要聽喔。」' : '「少年仔，你們在廟口畫這個喔？下午兩點有進香團，遊覽車會停滿整個廟埕喔。」', [
      { id: 'move', text: '「謝謝阿伯提醒！那我換個地方。」', reply: '「不會啦。你們的車停廟埕沒關係，等一下飛的時候，我上二樓幫你看飛機。要喝水廟裡有。」', score: 2, tag: '廟公提醒進香團，客氣道謝移點' },
      { id: 'keep', text: '「沒關係，我們很快就拍完了。」', reply: '「……好啦，你們自己看。」（廟公搖搖頭走回廟裡）', score: -1, tag: '廟公提醒進香團，敷衍沒移點' },
    ], (o) => {
      job.fd.addPR(o.score, o.tag);
      if (o.id === 'move') {
        this.keeperFriend = true; this.keeperAnnoyed = false; this.rel.keeper = 'good'; job.removeGcp(g); ui.toast(`${g.name} 清掉了，換個地方重佈。`, 'info', 3000);
        tell('廟公提醒進香團，客氣道謝並移點', '廟公說作業車可以停廟埕，飛的時候還會上二樓幫你看');
        whatIf('如果敷衍廟公，標會被遊覽車蓋住，飛到一半他還會跑來叫你移車。');
      } else {
        g.busRisk = true; this.keeperAnnoyed = true; this.keeperFriend = false; this.rel.keeper = 'bad';
        whatIf('如果客氣謝謝廟公並移點，他會在二樓幫你看老鷹，遊覽車也不會蓋到標。');
      }
      this.go(a, [this.L(29, 106.4)], 1.2, () => this.remove(a));
      job.relock();
    });
  }

  // ---------------------------------------------------------------- 阿黃
  private spawnDog(g: AnyObj) {
    const a = this.spawn('dog', -18.8, 108.4);
    a.target = g;
    bark(Math.hypot(this.job.fd.app.player.position.x - a.g.position.x, this.job.fd.app.player.position.z - a.g.position.z), 2, true);
    // 跑過去、從標上面踩過去、再跑回家
    const dx = g.x - a.g.position.x, dz = g.z - a.g.position.z, d = Math.hypot(dx, dz) || 1;
    const before = { x: g.x - dx / d * 1.6, z: g.z - dz / d * 1.6 };
    const after = { x: g.x + dx / d * 2.2 + dz / d * 0.8, z: g.z + dz / d * 2.2 - dx / d * 0.8 };
    this.go(a, [before, { x: g.x, z: g.z }, after, toWorld(-18.8, 108.4)], 5.2, () => { a.state = 'lie'; a.g.rotation.z = 0; setTimeout(() => this.remove(a), 20000); });
  }
  private dogStep(a: Actor) {
    const g = a.target;
    if (!g || a.wait === 99) return;
    const d = Math.hypot(a.g.position.x - g.x, a.g.position.z - g.z);
    const job = this.job;
    // 學弟在顧：把狗趕走
    if (job.guarding === g && d < 4) {
      a.wait = 99;
      tell(`叫學弟顧著還沒乾的 ${g.name}`, '阿黃衝過來被學弟趕走');
      bark(6, 3, false);
      ui.toast(`學弟${asstName()}：「去去去！阿黃不要過來！」`, 'info', 2600);
      this.go(a, [toWorld(-18.8, 108.4)], 5, () => this.remove(a));
      return;
    }
    if (d < 0.5) {
      a.wait = 99;
      if (this.job.time - g.t < DRY_TIME) {
        job.damage(g, 'paw');
        tell(`${g.name} 的漆還沒乾，也沒人顧`, '阿黃從上面踩過去，留下一串腳印');
        whatIf('叫學弟顧著還沒乾的標，阿黃就不敢過來。');
      }
    }
  }

  // ---------------------------------------------------------------- 鐵牛車
  private spawnTractor() {
    this.tractorBusy = true;
    const a = this.spawn('tractor', 8, 44);
    this.go(a, [this.L(8, 52), this.L(8, 117), this.L(8, 118.5)], 3.2, () => {
      setTimeout(() => this.go(a, [this.L(8, 52), this.L(8, 42)], 3.2, () => {
        this.remove(a); this.tractorBusy = false;
        if (this.tractorAgain) { this.tractorAgain = false; this.tractorAt = this.t + 40 + Math.random() * 30; }
      }), 6000);
    });
  }

  // ---------------------------------------------------------------- 進香團遊覽車
  private spawnBus(parked = false) {
    if (parked) {
      const a = this.spawn('bus', BUS_PARK.x, BUS_PARK.z);
      a.g.rotation.y = Math.PI; // 現場 +x = 世界 -x
      this.busParked = true;
      return;
    }
    const a = this.spawn('bus', 8, 40);
    sfx.honk(Math.hypot(this.job.fd.app.player.position.x - a.g.position.x, this.job.fd.app.player.position.z - a.g.position.z));
    ui.toast('叭叭——！（進香團的遊覽車開進農路了）', 'info', 3500);
    this.go(a, [this.L(8, 52), this.L(8, 98.3), this.L(14, 98.3), this.L(20, 100.4), this.L(BUS_PARK.x - 1, BUS_PARK.z), this.L(BUS_PARK.x, BUS_PARK.z)], 3.4, () => this.busPark(a));
  }
  /** 遊覽車停好：底下的標被蓋住 */
  private busPark(a: Actor) {
    this.busParked = true;
    a.state = 'parked';
    const fx = Math.cos(a.g.rotation.y), fz = -Math.sin(a.g.rotation.y);
    this.job.gcps.forEach((g: AnyObj) => {
      const dx = g.x - a.g.position.x, dz = g.z - a.g.position.z;
      if (Math.abs(dx * fx + dz * fz) < 5.6 && Math.abs(dx * fz - dz * fx) < 1.6 && !g.covered) {
        g.covered = true; g.notes.push('遊覽車停在上面，整個蓋住');
        tell(g.busRisk ? `廟公提醒過進香團，${g.name} 還是留在廟埕` : `把 ${g.name} 佈在廟埕中間`, '遊覽車剛好停在上面，航拍看不到');
      }
    });
    setTimeout(() => ui.toast('（一群阿公阿嬤下車，往廟裡走去。）', 'info', 3500), 1500);
  }

  /** 作業車擋在遊覽車前面？ */
  private truckBlocks(a: Actor): boolean {
    const t = this.job.fd.truck;
    const fx = Math.cos(a.g.rotation.y), fz = -Math.sin(a.g.rotation.y);
    for (let k = -3.8; k <= 2.2; k += 0.6) {
      const q = t.toWorld(k, 0, 0);
      const ax = (q.x - a.g.position.x) * fx + (q.z - a.g.position.z) * fz;
      const sd = Math.abs((q.x - a.g.position.x) * fz - (q.z - a.g.position.z) * fx);
      if (ax > 0 && ax < 8.5 && sd < 2.3) return true;
    }
    return false;
  }
  private busBlocked(a: Actor, dt: number) {
    a.wait = Math.max(0, a.wait || 0) + dt;
    const p = this.job.fd.app.player.position;
    if (a.wait > 1.2 && !this.busHonked) { this.busHonked = true; sfx.honk(Math.hypot(p.x - a.g.position.x, p.z - a.g.position.z)); ui.toast('叭叭——！（遊覽車被你們的作業車擋住了）', 'warn', 3000); }
    if (a.wait < 3 || this.busTalked) return;
    this.busTalked = true;
    const l = toLocal(a.g.position.x, a.g.position.z);
    // 廟公幫忙：已經到廟埕了，就停在這裡
    if (this.keeperFriend && l.x > 12) {
      ui.toast('廟公跑出來幫忙指揮：「司機！停這邊就好！他們在工作啦！」', 'good', 4500);
      tell('作業車擋到遊覽車，但早上跟廟公處得好', '廟公出來幫忙指揮，遊覽車就地停好');
      this.job.fd.addPR(1, '作業車擋到遊覽車，廟公出來幫忙指揮');
      this.busPark(a);
      return;
    }
    const fx = Math.cos(a.g.rotation.y), fz = -Math.sin(a.g.rotation.y);
    const d = this.spawnW('driver', a.g.position.x + fx * 4 + fz * 2, a.g.position.z + fz * 4 - fx * 2);
    d.state = 'seek';
    d.onArrive = () => {
      ui.faceSpeaker(d.g);
      ui.showDialog('遊覽車司機', '「少年仔！那台工程車是你們的喔？擋到了啦，車要開進廟埕捏！」', [
        { id: 'move', text: '「歹勢歹勢，我馬上移！」', reply: '「麻煩喔，謝謝！」', score: 0, tag: '作業車擋到遊覽車，馬上去移' },
        { id: 'wait', text: '「我們在工作，你等一下。」', reply: '「工作？我車上四十幾個阿公阿嬤在等捏！」（司機很不爽）', score: -2, tag: '作業車擋到遊覽車，叫司機等' },
      ], (o) => {
        this.job.fd.addPR(o.score, o.tag);
        if (o.id === 'wait') this.rel.village = 'bad';
        tell('作業車停在遊覽車要走的路上', o.id === 'wait' ? '司機下車叫你移車，你還叫他等，他很不爽' : '司機下車叫你移車');
        whatIf('作業車停在路口空地，就不會擋到任何車。');
        ui.toast('上車把作業車開走，遊覽車才進得去。', 'info', 4000);
        this.go(d, [{ x: a.g.position.x + fz * 1.6, z: a.g.position.z - fx * 1.6 }], 1.8, () => this.remove(d));
        this.job.relock();
      });
    };
  }

  // ---------------------------------------------------------------- 「你們要徵收喔？」
  private spawnRumor() {
    const a = this.spawn('villager', -22, 106.8);
    a.state = 'seek';
    a.onArrive = () => this.talkRumor(a);
  }
  private talkRumor(a: Actor) {
    const job = this.job;
    ui.faceSpeaker(a.g);
    const back = () => { this.go(a, [this.L(-22, 106.8)], 1.5, () => this.remove(a)); job.relock(); };
    if (this.prev.village === 'good') {
      tell(this.villageMemory(), '今天村民主動說「你們是做測量的，不是徵收」');
      ui.showDialog('村民', this.fromDays ? '「喔～你們是前幾天那家測量公司喔？里長有說你們是合法的。今天拍地圖對吧？辛苦啦！」' : '「喔～你們又來拍地圖喔？上次有聽你們講。辛苦啦！」', [
        { id: 'ok', text: '「對啊，今天再來補拍一次，打擾了！」', reply: '「好啦好啦。」', score: 1, tag: '村民記得上次的說明，沒有誤會' },
      ], (o) => { job.fd.addPR(o.score, o.tag); back(); });
      return;
    }
    if (this.prev.village === 'bad') tell(this.villageMemory(), '村裡已經在傳你們要來徵收');
    const line = this.prev.village === 'bad' ? (this.fromDays ? `「你們就是那家測量公司喔？聽說前幾天${this.villageMemory().replace(/^第一天/, '')}……現在跑來這邊畫來畫去，是不是要徵收？」` : '「又是你們！上次問也講不清楚……你們在這邊畫來畫去，到底是不是要徵收？」') : '「少年仔，你們在這邊畫那個黑白的，是不是要徵收？要開路喔？」';
    ui.showDialog('村民', line, [
      { id: 'explain', text: '「阿伯，我們是在做航拍測量，拍照做地圖用的，不是徵收啦。這是派工單，上面有公司電話。」', reply: '「喔～拍地圖喔，那就好。我去跟大家講一下，大家都很緊張。」', score: 2, tag: '村民問是不是要徵收，拿派工單說明' },
      { id: 'deflect', text: '「這是政府的案子，詳細的要去問公所。」', reply: '「公所？……那就是要徵收啦！」（村民急急忙忙走掉了）', score: -1, tag: '村民問是不是要徵收，叫他去問公所' },
      { id: 'dismiss', text: '「不知道啦，上面叫我們來的。」', reply: '「啊你們自己在做什麼都不知道喔？」（村民很不高興地走掉了）', score: -2, tag: '村民問是不是要徵收，說不知道' },
    ], (o) => {
      job.fd.addPR(o.score, o.tag);
      if (o.id === 'explain') {
        this.rel.village = 'good'; back();
        tell('村民問是不是要徵收，拿派工單說明', '村民回去幫你跟大家解釋，沒有人來圍觀');
        whatIf('如果推給公所或說不知道，會引來一群鄉親圍著標看。');
        return;
      }
      tell(o.id === 'deflect' ? '村民問是不是要徵收，叫他去問公所' : '村民問是不是要徵收，說不知道', '謠言傳開，一群鄉親跑來圍著標看');
      whatIf('如果拿派工單好好說明，村民會回去幫你跟大家解釋。');
      this.rel.village = 'bad';
      this.rumorMood = o.id as 'deflect' | 'dismiss';
      back();
      this.crowdAt = this.t + 9;
    });
  }
  /** 一群鄉親跑來圍著標看 */
  private spawnCrowd() {
    const job = this.job;
    if (!job.on || !job.gcps.length) return;
    const p = job.fd.app.player.position;
    // 最靠近學長的那個標
    const g = job.gcps.slice().sort((a: AnyObj, b: AnyObj) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    this.crowdGcp = g;
    this.crowdTalked = false;
    ui.toast('（農舍那邊走來一群人，邊走邊講「徵收」……）', 'warn', 4000);
    const spots = [[0, 0], [1.1, 0.5], [-0.9, 0.9], [0.3, -1.2]];
    spots.forEach(([dx, dz], i) => {
      const a = this.spawn('crowd', -24 + i * 1.2, 107 + (i % 2) * 0.8, i);
      job.ensureInteractive(a.g, true);
      this.go(a, [{ x: g.x + dx, z: g.z + dz }], 1.3 + i * 0.1, () => { a.state = 'idle'; });
    });
    this.kickAt = this.t + 20;
  }
  private talkCrowd(a: Actor) {
    const job = this.job;
    ui.faceSpeaker(a.g);
    const g = this.crowdGcp;
    ui.showDialog('圍觀的鄉親', '「聽說你們要徵收？這個畫在地上的是什麼？要拆房子喔？」（大家七嘴八舌）', [
      { id: 'explain', text: '「各位，我們是做航拍測量的，拍照畫地圖用，不是要徵收。這是派工單跟公司電話，有問題可以打來問。」', reply: '「喔～原來是拍地圖……害我們緊張半天。」（大家慢慢散了）', score: 1, tag: '向圍觀鄉親說明不是徵收' },
      { id: 'shoo', text: '「你們擋到了啦，讓一下。」', reply: '「兇什麼兇……」（大家念念有詞地散了）', score: -2, tag: '叫圍觀鄉親讓開' },
    ], (o) => {
      job.fd.addPR(o.score, o.tag);
      this.crowdTalked = true;
      this.kickAt = -1;
      if (o.id === 'explain') this.rel.village = '';
      const crowd = this.actors.filter(x => x.kind === 'crowd');
      crowd.forEach((c, i) => { job.ensureInteractive(c.g, false); this.go(c, [this.L(-24 + i * 1.2, 107)], 1.1 + i * 0.15, () => this.remove(c)); });
      void g;
      job.relock();
    });
  }
  /** 沒講清楚：有人用腳把標的釘子踢歪了 (不提示是哪個) */
  /** 圍觀的人站上去：漆還沒乾就會踩出鞋印 (不提示是哪個) */
  private kickGcp() {
    const g = this.crowdGcp;
    if (!g || this.crowdTalked || !this.job.gcps.includes(g)) return;
    if (this.job.time - g.t < DRY_TIME) { this.job.damage(g, 'shoe'); tell('沒跟圍觀的鄉親講清楚', `他們站上 ${g.name}，漆還沒乾就被踩出鞋印`); }
  }

  // ---------------------------------------------------------------- 路邊停車
  private spawnCar() {
    const job = this.job;
    // 停在農路上的標上面 (沒有的話就停在路邊)
    const g = job.gcps.find((x: AnyObj) => x.spot.lane && toLocal(x.x, x.z).x > 6 && toLocal(x.x, x.z).x < 10 && !x.covered) || null;
    this.carGcp = g;
    const a = this.spawn('car', 8, 40);
    const stop = g ? { x: g.x, z: g.z } : this.L(8, 76);
    const sl = toLocal(stop.x, stop.z);
    this.go(a, [this.L(8, 52), this.L(8, sl.z - 0.01)].concat([stop]), 4.2, () => {
      a.state = 'parked';
      sfx.thud();
      ui.toast('（一台轎車開進農路停好，司機下車走進農舍了。）', 'info', 4000);
      const o = this.spawnW('owner', a.g.position.x + 1.6, a.g.position.z);
      this.go(o, [this.L(-1, sl.z), this.L(-24, 107.4)], 1.5, () => { o.state = 'idle'; job.ensureInteractive(o.g, true); });
    });
  }
  private talkOwner(o: Actor) {
    const job = this.job;
    const g = this.carGcp;
    const car = this.actors.find(x => x.kind === 'car');
    ui.faceSpeaker(o.g);
    const leave = () => {
      job.ensureInteractive(o.g, false);
      if (!car) { o.state = 'idle'; return; }
      this.go(o, [this.L(-1, toLocal(car.g.position.x, car.g.position.z).z), { x: car.g.position.x + 1.6, z: car.g.position.z }], 2.2, () => {
        this.remove(o);
        const cl = toLocal(car.g.position.x, car.g.position.z);
        // 開走
        this.go(car, [this.L(8, cl.z - 3), this.L(8, 52), this.L(8, 40)], 3.6, () => this.remove(car));
        this.carGcp = null;
      });
      job.relock();
    };
    const opts: ui.DialogOption[] = g ? [
      { id: 'polite', text: '「不好意思，你的車停在我們的測量標上面，可以麻煩移一下嗎？我們要航拍。」', reply: '「啊！歹勢歹勢，我不知道下面有東西，馬上移。」', score: 1, tag: '路邊車停在標上，客氣請車主移車' },
      { id: 'rude', text: '「欸，你車停在我的標上啦，移走。」', reply: '「你的標？這是我家門口的路捏……好啦好啦。」（車主很不爽）', score: -2, tag: '路邊車停在標上，兇車主移車' },
      { id: 'skip', text: '「沒事，打擾了。」（這個點放棄）', reply: '「喔。」', score: 0, tag: '' },
    ] : [
      { id: 'skip', text: '「沒事，打擾了。」', reply: '「喔，我停一下就走喔。」', score: 0, tag: '' },
    ];
    ui.showDialog('車主', '「蛤？什麼事？」', opts, (x) => {
      if (x.tag) job.fd.addPR(x.score, x.tag);
      if (x.id === 'rude') this.rel.village = 'bad';
      if (g && x.id === 'polite') tell(`有車停在 ${g.name} 上面，去農舍客氣請車主移車`, '車主連聲道歉，馬上開走');
      if (g && x.id === 'rude') tell(`有車停在 ${g.name} 上面，兇車主移車`, '車移走了，但車主很不爽');
      if (g && x.id === 'skip') { tell(`有車停在 ${g.name} 上面，沒請車主移`, '航拍時那個點被車壓著'); }
      if (x.id === 'polite' || x.id === 'rude') leave(); else job.relock();
    });
  }

  /** 停好的遊覽車、正在走的鐵牛車：給玩家和作業車的碰撞 */
  bodies(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    this.actors.forEach(a => {
      if (a.kind !== 'bus' && a.kind !== 'tractor') return;
      const len = a.kind === 'bus' ? 5 : 1.6, fx = Math.cos(a.g.rotation.y), fz = -Math.sin(a.g.rotation.y);
      for (let k = -len; k <= len; k += 1.2) out.push({ x: a.g.position.x + fx * k, z: a.g.position.z + fz * k, r: a.kind === 'bus' ? 1.3 : 0.8 });
    });
    return out;
  }
  /** 輪子經過的標被輾過 */
  private crush(a: Actor) {
    const job = this.job;
    job.gcps.forEach((g: AnyObj) => {
      if (!g.spot.lane || g.crushed || (a.kind === 'car' && g === this.carGcp)) return;
      const lx = a.g.position.x - g.x, lz = a.g.position.z - g.z;
      if (Math.hypot(lx, lz) < (a.kind === 'bus' ? 1.6 : 1.2)) {
        g.crushed = true; job.damage(g, 'tire');
        tell(this.tractorWarned && a.kind === 'tractor' ? '阿伯提醒過鐵牛車，標還是佈在農路上' : `把 ${g.name} 佈在農路上`, `被${a.kind === 'bus' ? '遊覽車' : a.kind === 'car' ? '轎車' : '鐵牛車'}輾出輪胎痕`);
        whatIf('標佈在田埂或水泥空地上，就不會被車輾到。');
      }
    });
  }

  // ---------------------------------------------------------------- 雷雨
  private startRain() {
    this.raining = true;
    this.stormAt = -1;
    const sm = this.sm;
    const fog = sm.scene.fog as THREE.Fog;
    if (fog && !this.fogSave) { this.fogSave = { color: fog.color.getHex(), near: fog.near, far: fog.far }; fog.color.set(0x8a939c); fog.near = 30; fog.far = 220; }
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 18; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc8d4e0, size: 0.06, transparent: true, opacity: 0.7, depthWrite: false }));
    sm.scene.add(this.rain);
    ui.toast('轟——！雨下下來了。', 'bad', 3500);
    // 還沒乾的標被沖淡
    this.job.gcps.forEach((g: AnyObj) => { if (this.job.time - g.t < DRY_TIME * 1.5) this.job.damage(g, 'rain'); });
  }
  private rainTick(dt: number) {
    const r = this.rain!;
    const c = this.sm.camera.position;
    r.position.set(c.x, c.y - 6, c.z);
    const a = r.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) { let y = a.getY(i) - 22 * dt; if (y < 0) y += 18; a.setY(i, y); }
    a.needsUpdate = true;
  }
  private stopRain() {
    if (this.rain) { this.sm.scene.remove(this.rain); this.rain = null; }
    const fog = this.sm.scene.fog as THREE.Fog;
    if (fog && this.fogSave) { fog.color.set(this.fogSave.color); fog.near = this.fogSave.near; fog.far = this.fogSave.far; }
    this.fogSave = null;
    this.raining = false;
  }

  // ---------------------------------------------------------------- 測試工具
  debug(kind: string) {
    const job = this.job;
    const last = job.gcps[job.gcps.length - 1];
    if (kind === 'rumor') { this.rumorDone = true; this.spawnRumor(); return '村民走過來了。'; }
    if (kind === 'crowd') { if (!last) return '先佈一個標。'; this.rumorMood = 'deflect'; this.spawnCrowd(); return '鄉親圍過來了。'; }
    if (kind === 'kick') { if (!this.crowdGcp) return '先叫鄉親圍觀。'; this.crowdGcp.t = job.time; this.kickGcp(); return `${this.crowdGcp.name} 被踩出鞋印了。`; }
    if (kind === 'parking') { if (this.actors.some(a => a.kind === 'car')) return '車已經停了。'; this.carDone = true; this.spawnCar(); return this.job.gcps.some((x: AnyObj) => x.spot.lane) ? '一台車開進農路，要停在農路的標上。' : '一台車開進農路（農路上沒有標，停路邊）。'; }
    if (kind === 'chief') { this.chief.push('（測試）有人投訴你們'); if (job.uav.mode !== 'mission') this.callChief('office'); return '里長打電話了。'; }
    if (kind === 'dog') { if (!last) return '先佈一個標。'; last.t = job.time; this.dogTied = false; this.dogDone = true; this.spawnDog(last); return `阿黃衝向 ${last.name}。`; }
    if (kind === 'farmer') { if (!last) return '先佈一個標。'; this.spawnFarmer(last); return '阿伯出發了（對著最後一個標）。'; }
    if (kind === 'keeper') { if (!last) return '先佈一個標。'; this.spawnKeeper(last); return '廟公出來了（對著最後一個標）。'; }
    if (kind === 'tractor') { this.tractorDone = true; this.spawnTractor(); return '鐵牛車開進農路了。'; }
    if (kind === 'bus') { if (this.busParked || this.actors.some(a => a.kind === 'bus')) return '遊覽車已經來了。'; this.spawnBus(); return '進香團遊覽車開進來了。'; }
    if (kind === 'storm') { this.stormWarnAt = this.t + 0.1; return '雷雨特報馬上來。'; }
    this.stormAt = this.t + 0.1; return '雨馬上下。';
  }
  /** 給佈標畫面：這次要不要遞錯漆 */
  private canRolls = 0;
  rollCanMix(): boolean {
    this.canRolls++;
    // 第一個標四成機率；還沒發生的話第二個標一定會遞錯
    if (this.canMixDone || (this.canRolls < 2 && Math.random() > 0.4)) return false;
    this.canMixDone = true;
    return true;
  }
  void() { return V(); }
}
