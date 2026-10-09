/**
 * 第三天：航測標近距離操作 (取代舊版彈出視窗)
 *   1. 鋪模板：1.2 m 方框模板，轉到想要的方向放好
 *   2. 噴白漆：整個方框內噴白 (框外的木板會接住一點，噴太外面就噴到地上 = 溢漆)
 *   3. 學弟蓋上遮板 (擋住兩個白色象限)，噴黑漆
 *   4. 掀開模板，中心敲鋼釘 (抓時機；歪掉要拔起來重敲)
 * 噴漆真的畫在地上 (畫布貼圖)，噴完的樣子就是航拍會拍到的樣子。
 */
import * as THREE from 'three';
import type { GameApp } from './legacy';
import { SM } from './legacy';
import * as ui from './ui';
import * as sfx from './sfx';
import { tell } from './story';

const N = 256;          // 畫布解析度
const L = 1.8;          // 畫布涵蓋範圍 (公尺)
const IN = 0.6;         // 標的半寬 (1.2 m)
const OUT = 0.72;       // 模板外框半寬
const MASK = 0.63;      // 遮板半寬
const PPM = N / L;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface PaintStock { white: number; black: number }

export interface GcpWorkOpts {
  app: GameApp;
  name: string;
  x: number; z: number; y: number;
  /** 玩家面向 (相機從這一側看) */
  yaw: number;
  /** 標的範圍內是土 (不是水泥) 的比例：漆會被吃掉、釘子會鬆 */
  soil: number;
  /** 地面顏色 (亮度 0~1，用來算對比) */
  baseLum: number;
  paint: PaintStock;
  wind: { x: number; z: number };
  asst?: THREE.Object3D | null;
  asstName: string;
  /** 學弟遞錯漆：噴黑漆時拿到的其實是白漆 */
  wrongCan?: boolean;
  /** 鋼釘盒 (剩幾根；用掉會扣) */
  nails?: { left: number };
  onDone: (r: GcpWorkResult) => void;
  onCancel: () => void;
}

export interface GcpWorkResult {
  rot: number;
  whiteCov: number; blackCov: number; overflow: number; contrast: number;
  paintScore: number;
  nailTilt: number; nailHits: number; nailsUsed: number; fingers: number; loose: boolean;
  /** 鋼釘用完了，這點沒有釘 */
  noNail?: boolean;
  canvas: HTMLCanvasElement;
}

type Step = 'template' | 'white' | 'mask' | 'black' | 'lift' | 'nail' | 'out';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** 做好的航測標 (場景裡的物件)：畫布貼圖 + 鋼釘 */
export function buildGcpMarker(canvas: HTMLCanvasElement, rot: number, tilt: number, name: string): THREE.Group {
  const S = SM();
  const g = new THREE.Group();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, L), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.04, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.004;
  plane.receiveShadow = true;
  plane.rotation.z = 0;
  const holder = new THREE.Group();
  holder.rotation.y = rot;
  holder.add(plane);
  g.add(holder);
  g.add(nailMesh(tilt, 0));
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.4, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.2;
  g.add(hit);
  g.userData = { type: 'gcp_marker', label: name };
  void S;
  return g;
}

/** 鋼釘 + 墊片；depth 0 = 釘到底 */
function nailMesh(tiltDeg: number, raise: number): THREE.Group {
  const S = SM();
  const n = new THREE.Group();
  const head = S.mk(S.lathe([[0, 0], [0.026, 0], [0.028, 0.004], [0.011, 0.008], [0.009, 0.014], [0, 0.017]], 20), S.M.brass, 0, 0, 0, true);
  n.add(head);
  const shaft = S.mk(new THREE.CylinderGeometry(0.0045, 0.003, 0.11, 8), S.M.steel, 0, -0.055, 0, true);
  n.add(shaft);
  n.position.y = raise;
  const a = THREE.MathUtils.degToRad(tiltDeg);
  n.rotation.set(a * 0.8, 0, a * 0.6);
  n.userData.isNail = true;
  return n;
}

class GcpBench {
  active = false;
  private o!: GcpWorkOpts;
  private step: Step = 'out';
  private root: HTMLElement | null = null;
  private card: HTMLElement | null = null;
  private banner: HTMLElement | null = null;
  private group = new THREE.Group();
  private rot = 0;
  private center = V();

  // 鏡頭
  private camPos = V(); private camLook = V();
  private fromPos = V(); private fromQuat = new THREE.Quaternion(); private toQuat = new THREE.Quaternion();
  private t = 0; private camDur = 0.6;
  private savedCtl: ((dt: number) => void) | null = null;
  private savedFov = 65;
  private fov = 48;

  // 畫布：地面 / 模板框 / 遮板
  private gC!: HTMLCanvasElement; private gX!: CanvasRenderingContext2D; private gTex!: THREE.CanvasTexture;
  private fC!: HTMLCanvasElement; private fX!: CanvasRenderingContext2D; private fTex!: THREE.CanvasTexture;
  private mC!: HTMLCanvasElement; private mX!: CanvasRenderingContext2D; private mTex!: THREE.CanvasTexture;
  private frame = new THREE.Group();
  private mask = new THREE.Group();
  private frameOn = false;
  private maskOn = false;
  /** 遮板轉了幾個 90°：奇數 = 蓋住黑格 (先噴白)，偶數 = 蓋住白格 (換噴黑) */
  private maskTurns = 1;
  private dirty = false;

  // 噴漆
  private mouse = { x: 0, y: 0, down: false, over: false };
  private hgt = 0.3;
  private last: { u: number; v: number } | null = null;
  private can = new THREE.Group();
  private mist!: THREE.Mesh;
  private ring!: THREE.Mesh;
  private spraying = false;
  private noPaintWarned = false;
  private sprayedAny = { white: false, black: false };
  /** 現在手上那罐噴出來的顏色 */
  private canCol: 'white' | 'black' = 'white';
  private wrongT = 0;
  private wrongAsked = false;

  // 動畫
  private anim: { t: number; dur: number; tick: (k: number) => void; done?: () => void } | null = null;

  // 敲釘
  private nail: THREE.Group | null = null;
  private hammer = new THREE.Group();
  private meter = 0; private meterDir = 1; private meterSpeed = 0.9;
  private depth = 0; private tilt = { x: 0, z: 0 };
  private hits = 0; private nailsUsed = 1; private fingers = 0;
  private swing = -1;
  private pendingQ = 0;
  private bent = false;

  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onMove: ((e: MouseEvent) => void) | null = null;
  private onDown: ((e: MouseEvent) => void) | null = null;
  private onUp: ((e: MouseEvent) => void) | null = null;
  private onWheel: ((e: WheelEvent) => void) | null = null;
  private ray = new THREE.Raycaster();
  private hidden: THREE.Object3D[] = [];

  // ================================================================
  start(o: GcpWorkOpts) {
    if (this.active) this.teardown();
    this.o = o;
    this.active = true;
    const app = o.app;
    const sm = app.sceneManager;
    const p = app.player;
    const cam = sm.camera;
    if (document.exitPointerLock) document.exitPointerLock();
    document.body.classList.add('bench-active', 'gcp-bench');
    p.hidePrompt?.();
    this.savedCtl = p.externalControl;
    p.externalControl = (dt: number) => this.update(dt);
    this.savedFov = cam.fov;
    this.fromPos.copy(cam.position);
    this.fromQuat.copy(cam.quaternion);
    this.center.set(o.x, o.y, o.z);
    // 模板預設：方向對著玩家
    this.rot = Math.round(o.yaw / (Math.PI / 12)) * (Math.PI / 12);
    this.depth = 0; this.tilt = { x: 0, z: 0 }; this.hits = 0; this.nailsUsed = 1; this.fingers = 0; this.bent = false; this.swing = -1; this.noNail = false;
    this.meterSpeed = 0.9; this.meter = 0; this.meterDir = 1;
    this.hgt = 0.3; this.last = null; this.noPaintWarned = false;
    this.sprayedAny = { white: false, black: false };
    this.wrongT = 0; this.wrongAsked = false;

    this.buildCanvases();
    this.buildProps();
    this.group.position.copy(this.center);
    sm.scene.add(this.group);

    // 鏡頭：玩家這一側上方往下看
    this.setCam(1.3, 2.1, 50, 0, V(Math.sin(o.yaw) * 0.38, 0, Math.cos(o.yaw) * 0.38));

    this.root = el('div', 'bench gcpb');
    document.body.appendChild(this.root);
    this.placeAsst(1.25, 0.35);
    // 手上拿的東西先藏起來 (不然會擋在鏡頭前)
    this.hidden = cam.children.filter(c => c.visible);
    this.hidden.forEach(c => { c.visible = false; });

    this.onKey = (e) => this.key(e);
    this.onMove = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; };
    this.onDown = (e) => { if (e.button !== 0 || (e.target as HTMLElement)?.closest?.('.bench-card')) return; this.mouse.down = true; if (this.step === 'nail') this.strike(); };
    this.onUp = (e) => { if (e.button === 0) this.mouse.down = false; };
    this.onWheel = (e) => {
      e.preventDefault();
      if (this.step === 'template') { this.rot += (e.deltaY > 0 ? 1 : -1) * Math.PI / 36; this.applyRot(); return; }
      if (this.step === 'white' || this.step === 'black') { this.hgt = THREE.MathUtils.clamp(this.hgt + (e.deltaY > 0 ? 0.03 : -0.03), 0.12, 0.55); this.refreshCard(); }
    };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    this.mouse.x = innerWidth / 2; this.mouse.y = innerHeight / 2;
    this.go('template');
  }

  private setCam(back: number, up: number, fov: number, side = 0, look = V()) {
    const yaw = this.o.yaw;
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw));
    const r = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const cam = this.o.app.sceneManager.camera;
    this.fromPos.copy(cam.position);
    this.fromQuat.copy(cam.quaternion);
    this.camLook.copy(this.center).add(look);
    this.camPos.copy(this.center).addScaledVector(f, -back).addScaledVector(r, side).add(V(0, up, 0));
    const m = new THREE.Matrix4().lookAt(this.camPos, this.camLook, V(0, 1, 0));
    this.toQuat.setFromRotationMatrix(m);
    this.t = 0;
    this.fov = fov;
  }

  /** 學弟站在模板旁邊 (相對玩家的方位角) */
  private placeAsst(dist: number, ang: number) {
    const a = this.o.asst;
    if (!a) return;
    const yaw = this.o.yaw + ang;
    const x = this.center.x - Math.sin(yaw) * dist, z = this.center.z - Math.cos(yaw) * dist;
    a.position.set(x, this.o.app.sceneManager.heightAt(x, z), z);
    a.rotation.y = Math.atan2(-(this.center.z - z), this.center.x - x);
  }

  // ---------------------------------------------------------------- 畫布
  private mkCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D, THREE.CanvasTexture] {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return [c, x, t];
  }
  private px(m: number) { return (m / L + 0.5) * N; }

  private buildCanvases() {
    [this.gC, this.gX, this.gTex] = this.mkCanvas();
    [this.fC, this.fX, this.fTex] = this.mkCanvas();
    [this.mC, this.mX, this.mTex] = this.mkCanvas();
    const wood = (x: CanvasRenderingContext2D, path: () => void, tint: string) => {
      x.save(); x.beginPath(); path(); x.clip('evenodd');
      x.fillStyle = tint; x.fillRect(0, 0, N, N);
      const r = SM().rng(17);
      for (let i = 0; i < 260; i++) { x.strokeStyle = `rgba(110,72,36,${0.08 + r() * 0.12})`; x.lineWidth = 1; const y = r() * N; x.beginPath(); x.moveTo(0, y); x.lineTo(N, y + (r() - 0.5) * 6); x.stroke(); }
      x.restore();
    };
    wood(this.fX, () => this.framePath(this.fX), '#c99a62');
    wood(this.mX, () => this.maskPath(this.mX), '#b98a55');
    // 遮板上的手寫字
    this.mX.save(); this.mX.fillStyle = 'rgba(30,30,30,.55)'; this.mX.font = 'bold 13px "Noto Sans TC",sans-serif'; this.mX.textAlign = 'center';
    this.mX.fillText('遮板', this.px(0.3), this.px(-0.3)); this.mX.fillText('遮板', this.px(-0.3), this.px(0.3)); this.mX.restore();
  }

  private sq(x: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number) {
    x.rect(this.px(u0), this.px(v0), this.px(u1) - this.px(u0), this.px(v1) - this.px(v0));
  }
  private framePath(x: CanvasRenderingContext2D) { this.sq(x, -OUT, -OUT, OUT, OUT); this.sq(x, -IN, -IN, IN, IN); }
  /** 遮板蓋住兩個白色象限 (u·v < 0) */
  /** 遮板本身的形狀 (遮板自己的座標)：u·v < 0 的兩格 */
  private maskPath(x: CanvasRenderingContext2D) { this.sq(x, 0, -MASK, MASK, 0); this.sq(x, -MASK, 0, 0, MASK); }
  /** 遮板目前蓋住的範圍 (模板座標) */
  private maskNowPath(x: CanvasRenderingContext2D) {
    if (this.maskTurns % 2 === 0) this.maskPath(x);
    else { this.sq(x, 0, 0, MASK, MASK); this.sq(x, -MASK, -MASK, 0, 0); }
  }

  private buildProps() {
    const S = SM();
    this.group.clear();
    const holder = new THREE.Group();
    holder.name = 'holder';
    // 地面漆
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(L, L), new THREE.MeshStandardMaterial({ map: this.gTex, transparent: true, alphaTest: 0.02, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    gm.rotation.x = -Math.PI / 2; gm.position.y = 0.004; gm.receiveShadow = true;
    holder.add(gm);
    // 模板框 (木板)
    this.frame.clear();
    const fm = new THREE.Mesh(new THREE.PlaneGeometry(L, L), new THREE.MeshStandardMaterial({ map: this.fTex, transparent: true, alphaTest: 0.5, roughness: 0.85 }));
    fm.rotation.x = -Math.PI / 2; fm.position.y = 0.019; fm.castShadow = true; fm.receiveShadow = true;
    this.frame.add(fm);
    const edge = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.9 });
    const w = OUT - IN, c = (OUT + IN) / 2;
    [[0, c, OUT * 2, w], [0, -c, OUT * 2, w], [c, 0, w, IN * 2], [-c, 0, w, IN * 2]].forEach(([x, z, a, b]) => this.frame.add(S.mk(new THREE.BoxGeometry(a, 0.017, b), edge, x, 0.009, z, true)));
    holder.add(this.frame);
    // 遮板
    this.mask.clear();
    const mm = new THREE.Mesh(new THREE.PlaneGeometry(L, L), new THREE.MeshStandardMaterial({ map: this.mTex, transparent: true, alphaTest: 0.5, roughness: 0.85 }));
    mm.rotation.x = -Math.PI / 2; mm.position.y = 0.033; mm.castShadow = true;
    this.mask.add(mm);
    [[MASK / 2, -MASK / 2], [-MASK / 2, MASK / 2]].forEach(([x, z]) => this.mask.add(S.mk(new THREE.BoxGeometry(MASK, 0.012, MASK), edge, x, 0.026, z, true)));
    holder.add(this.mask);
    this.group.add(holder);
    this.frame.visible = false; this.mask.visible = false;
    this.frameOn = this.maskOn = false;
    this.maskTurns = 1;
    this.mask.rotation.set(0, this.maskTurns * Math.PI / 2, 0);
    this.applyRot();

    // 噴罐 + 霧 + 噴幅圈
    this.can.clear();
    const body = S.mk(new THREE.CylinderGeometry(0.033, 0.033, 0.19, 18), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.35, metalness: 0.4 }), 0, 0.12, 0, true);
    body.name = 'body';
    this.can.add(body);
    this.can.add(S.mk(new THREE.CylinderGeometry(0.03, 0.033, 0.03, 18), S.M.steel, 0, 0.23, 0, true));
    const cap = S.mk(new THREE.CylinderGeometry(0.009, 0.012, 0.022, 10), S.M.black, 0, 0.255, 0, true);
    this.can.add(cap);
    const label = S.mk(new THREE.CylinderGeometry(0.0335, 0.0335, 0.07, 18, 1, true), new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.5 }), 0, 0.11, 0, true);
    this.can.add(label);
    this.can.visible = false;
    this.group.add(this.can);
    this.mist = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.mist.visible = false;
    this.group.add(this.mist);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffd54a, transparent: true, opacity: 0.55, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private applyRot() {
    const h = this.group.getObjectByName('holder');
    if (h) h.rotation.y = this.rot;
  }

  // ---------------------------------------------------------------- 流程
  private go(s: Step) {
    this.step = s;
    this.spraySound(false);
    this.can.visible = this.mist.visible = this.ring.visible = false;
    if (s === 'template') {
      // 模板 + 遮板一起放下去：遮板一開始就蓋住對角兩格
      this.frame.visible = true; this.frameOn = true;
      this.mask.visible = true; this.maskOn = true;
      this.frame.position.y = 0.25; this.mask.position.y = 0.25;
      this.animate(0.5, k => { this.frame.position.y = this.mask.position.y = 0.25 * (1 - k); });
    }
    if (s === 'black') {
      ui.toast('換黑漆。', 'info', 2200);
    }
    if (s === 'white' || s === 'black') this.setCan(s === 'black' && this.o.wrongCan ? 'white' : s);
    if (s === 'mask') {
      this.mask.visible = true;
      const a = this.o.asst;
      const from = a ? this.group.worldToLocal(a.position.clone().add(V(0, 0.9, 0))) : V(1, 0.6, 0);
      const h = this.group.getObjectByName('holder')!;
      const fromL = h.worldToLocal(this.group.localToWorld(from.clone()));
      this.mask.position.copy(fromL);
      this.animate(0.8, k => { const e = k * k * (3 - 2 * k); this.mask.position.set(fromL.x * (1 - e), fromL.y * (1 - e) + Math.sin(k * Math.PI) * 0.2, fromL.z * (1 - e)); }, () => {
        this.maskOn = true;
        ui.toast(`學弟${this.o.asstName}：「遮板蓋好了，換黑漆！」`, 'info', 2600);
        this.go('black');
      });
    }
    if (s === 'lift') {
      this.frameOn = this.maskOn = false;
      this.animate(0.9, k => {
        const e = k * k;
        this.mask.position.set(0, 0.6 * e, 0.0);
        this.mask.rotation.set(0, this.maskTurns * Math.PI / 2, e * 0.9);
        this.frame.position.set(0, 0.5 * e, 0);
        this.frame.rotation.x = -e * 0.7;
        const fade = 1 - Math.max(0, (k - 0.55) / 0.45);
        [this.mask, this.frame].forEach(g => { g.visible = fade > 0.02; });
      }, () => {
        this.frame.visible = this.mask.visible = false;
        this.frame.rotation.set(0, 0, 0); this.mask.rotation.set(0, this.maskTurns * Math.PI / 2, 0);
        ui.toast(`學弟${this.o.asstName}：「喔～還不錯欸！」`, 'info', 2200);
        this.go('nail');
      });
    }
    if (s === 'nail') this.setupNail();
    this.refreshCard();
  }

  private setCan(col: 'white' | 'black') {
    this.canCol = col;
    (this.can.getObjectByName('body') as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: col === 'white' ? 0xf2f2ee : 0x1a1b1e, roughness: 0.35, metalness: 0.4 });
    (this.mist.material as THREE.MeshBasicMaterial).color.set(col === 'white' ? 0xffffff : 0x202020);
    sfx.canShake();
  }

  /** 噴下去才發現顏色不對 */
  private askWrongCan() {
    if (!this.active) return;
    const want = this.step === 'white' ? '白' : '黑', got = this.canCol === 'white' ? '白' : '黑';
    ui.showDialog('（噴出來是' + got + '的……）', `「欸？${this.o.asstName}，這罐是${got}漆吧？」`, [
      { id: 'swap', text: `「${this.o.asstName}，這罐是${got}的，換${want}的給我。」`, reply: `「啊！拿錯了拿錯了，${want}的在這。」`, score: 0, tag: '' },
      { id: 'keep', text: '「……算了，先這樣噴。」', reply: `（${this.o.asstName}假裝沒聽到。）`, score: 0, tag: '' },
    ], (o) => {
      if (o.id === 'swap') { this.setCan(this.step as 'white' | 'black'); tell(`學弟${this.o.asstName}遞錯漆，馬上叫他換`, `${this.o.name} 的${want}格沒被噴錯`); }
      else tell(`學弟${this.o.asstName}遞錯漆，將就著噴`, `${this.o.name} 的${want}格噴成${got}的，對比變差`);
    });
  }

  /** 遮板轉 90° (學弟幫忙轉) */
  private turnMask() {
    if (this.anim) return;
    this.mouse.down = false;
    sfx.thud();
    const a0 = this.maskTurns * Math.PI / 2;
    this.maskOn = false;
    this.animate(0.4, k => {
      const e = k * k * (3 - 2 * k);
      this.mask.rotation.set(0, a0 + e * Math.PI / 2, 0);
      this.mask.position.y = Math.sin(k * Math.PI) * 0.06;
    }, () => {
      this.maskTurns++;
      this.mask.rotation.set(0, this.maskTurns * Math.PI / 2, 0);
      this.mask.position.y = 0;
      this.maskOn = true;
      this.refreshCard();
    });
  }

  private animate(dur: number, tick: (k: number) => void, done?: () => void) { this.anim = { t: 0, dur, tick, done }; tick(0); }

  private refreshCard() {
    if (!this.root) return;
    const st = this.o.paint;
    const canBar = (v: number, max: number, label: string, col: string) => `<span class="gcpb-can"><b>${label}</b><span class="bar"><i style="width:${Math.max(0, Math.min(100, v / max * 100))}%;background:${col}"></i></span><em>${v <= 0 ? '沒了' : v < 15 ? '快沒了' : ''}</em></span>`;
    let title = '', body = '', keys = '';
    switch (this.step) {
      case 'template':
        title = `${this.o.name}　鋪模板`;
        body = '1.2 m 方框模板放在選好的位置，遮板先蓋住對角兩格。方向轉一轉，喜歡的話就放好。';
        keys = '滾輪：轉方向　Enter：放好　Esc：不放了';
        break;
      case 'white':
        title = `${this.o.name}　噴白漆`;
        body = `露出來的兩格噴白。噴罐離地 <b>${Math.round(this.hgt * 100)} cm</b>（越高噴得越開、越淡，也越容易被風吹走）。<br>${canBar(st.white, 150, '白漆', '#f2f2ee')}`;
        keys = '按住左鍵：噴　滾輪：高低　Enter：白漆好了';
        break;
      case 'mask':
        title = `${this.o.name}　蓋遮板`;
        body = `學弟${this.o.asstName}把遮板蓋上去，擋住要留白的兩格。`;
        break;
      case 'black':
        title = `${this.o.name}　噴黑漆`;
        body = `換黑漆。噴罐離地 <b>${Math.round(this.hgt * 100)} cm</b>。<br>${canBar(st.black, 100, '黑漆', '#1a1b1e')}`;
        keys = '按住左鍵：噴　R：遮板轉 90°　滾輪：高低　Enter：黑漆好了';
        break;
      case 'lift':
        title = `${this.o.name}　掀開模板`;
        body = '……';
        break;
      case 'nail':
        title = `${this.o.name}　中心敲鋼釘`;
        body = `指針走到中間綠色那格再敲。偏掉的話釘子會歪。${this.bent ? '<br><b class="bad">釘子歪掉了！按 R 拔起來換一根。</b>' : ''}
          <div class="gcpb-meter"><div class="gcpb-zone y"></div><div class="gcpb-zone g"></div><div class="gcpb-needle"></div></div>
          <div class="gcpb-depth">入土 <i style="width:${Math.min(100, this.depth * 100)}%"></i></div>`;
        keys = this.bent ? 'R：拔起來重敲' : 'Space／左鍵：敲';
        break;
    }
    const order: [string, string][] = [['template', '鋪模板'], ['white', '噴白'], ['black', '噴黑'], ['nail', '敲鋼釘']];
    const cur = this.step === 'mask' ? 'black' : this.step === 'lift' ? 'nail' : this.step;
    const big: Record<string, string> = {
      template: '滾輪轉方向，按 <kbd class="cap">Enter</kbd> 放好模板',
      white: '按住 <kbd class="cap cap-wide">滑鼠左鍵</kbd> 把露出來的兩格噴白　噴好按 <kbd class="cap">Enter</kbd>',
      black: '按住 <kbd class="cap cap-wide">滑鼠左鍵</kbd> 噴黑（<kbd class="cap">R</kbd> 轉遮板）　噴好按 <kbd class="cap">Enter</kbd>',
      nail: this.bent ? '釘子歪了！按 <kbd class="cap">R</kbd> 拔起來換一根' : '指針走到<b class="g">綠色</b>那格時按 <kbd class="cap cap-wide">Space</kbd> 敲下去',
    };
    if (!this.banner) { this.banner = el('div', 'big-guide gcpb-banner'); this.root.appendChild(this.banner); }
    this.banner.innerHTML = `<div class="bg-steps">${order.map(([k, n], i) => `<span class="${k === cur ? 'on' : order.findIndex(o => o[0] === cur) > i ? 'done' : ''}">${i + 1} ${n}</span>`).join('<i>→</i>')}</div><div class="bg-main">${big[cur] || '……'}</div>`;
    if (!this.card) { this.card = el('div', 'bench-card paper gcpb-card'); this.root.appendChild(this.card); }
    this.card.innerHTML = `<div class="bench-head"><h3>${title}</h3><span class="bench-keys">${keys}</span></div><div class="bench-body">${body}</div>`;
  }

  private key(e: KeyboardEvent) {
    if (document.querySelector('.field-modal')) return;
    e.stopPropagation();
    const c = e.code;
    if (c === 'Escape') {
      e.preventDefault();
      if (this.step === 'template') { this.cancel(); return; }
      ui.toast('漆都噴下去了，做完吧。', 'warn', 1800); sfx.error();
      return;
    }
    if (this.anim && this.step !== 'nail') return;
    if (this.step === 'template') {
      if (c === 'KeyA' || c === 'ArrowLeft') { this.rot += Math.PI / 36; this.applyRot(); }
      if (c === 'KeyD' || c === 'ArrowRight') { this.rot -= Math.PI / 36; this.applyRot(); }
      if (c === 'Enter' || c === 'Space' || c === 'KeyE') { e.preventDefault(); sfx.thud(); this.go('white'); }
      return;
    }
    if ((this.step === 'white' || this.step === 'black') && (c === 'Enter' || c === 'NumpadEnter')) {
      e.preventDefault();
      if (!this.sprayedAny[this.step]) { ui.toast(this.step === 'white' ? '一滴白漆都還沒噴喔。' : '黑漆還沒噴喔。', 'warn', 1800); sfx.error(); return; }
      this.mouse.down = false;
      this.go(this.step === 'white' ? 'black' : 'lift');
      return;
    }
    if (this.step === 'black' && c === 'KeyR') { this.turnMask(); return; }
    if ((this.step === 'white' || this.step === 'black') && c === 'KeyX') {
      const want = this.step;
      if (this.canCol === want) { ui.toast(`學弟${this.o.asstName}：「這罐就是${want === 'white' ? '白' : '黑'}的啊？」`, 'info', 2000); return; }
      this.mouse.down = false;
      this.setCan(want);
      ui.toast(`學弟${this.o.asstName}：「啊！拿錯了拿錯了，這罐才是${want === 'white' ? '白' : '黑'}的。」`, 'info', 2600);
      return;
    }
    if (this.step === 'nail') {
      if (c === 'Space' || c === 'Enter') { e.preventDefault(); this.strike(); }
      if (c === 'KeyR' && this.bent) this.newNail();
    }
  }

  // ---------------------------------------------------------------- 每幀
  private update(dt: number) {
    const cam = this.o.app.sceneManager.camera;
    this.t = Math.min(1, this.t + dt / this.camDur);
    const e = this.t * this.t * (3 - 2 * this.t);
    cam.position.lerpVectors(this.fromPos, this.camPos, e);
    cam.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, e);
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov += (this.fov - cam.fov) * Math.min(1, e + dt * 4); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    if (this.anim) {
      this.anim.t += dt;
      const k = Math.min(1, this.anim.t / this.anim.dur);
      this.anim.tick(k);
      if (k >= 1) { const d = this.anim.done; this.anim = null; d?.(); }
    }
    if ((this.step === 'white' || this.step === 'black') && !this.anim) this.sprayTick(dt);
    if (this.step === 'nail') this.nailTick(dt);
    if (this.dirty) { this.gTex.needsUpdate = this.fTex.needsUpdate = this.mTex.needsUpdate = true; this.dirty = false; }
  }

  /** 滑鼠對到的地面點 (模板座標 u, v；公尺) */
  private aim(): { u: number; v: number; w: THREE.Vector3 } | null {
    const sm = this.o.app.sceneManager;
    const nx = (this.mouse.x / innerWidth) * 2 - 1, ny = -(this.mouse.y / innerHeight) * 2 + 1;
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), sm.camera);
    const plane = new THREE.Plane(V(0, 1, 0), -this.center.y);
    const w = V();
    if (!this.ray.ray.intersectPlane(plane, w)) return null;
    const d = w.clone().sub(this.center);
    // 世界 → 模板座標 (holder 轉了 rot)
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const u = d.x * c - d.z * s, v = d.x * s + d.z * c;
    return { u, v, w };
  }

  private sprayTick(dt: number) {
    const a = this.aim();
    const col = this.canCol;
    const R = 0.045 + this.hgt * 0.27;
    const drift = { x: this.o.wind.x * this.hgt * 0.16, z: this.o.wind.z * this.hgt * 0.16 };
    // 風的方向轉到模板座標
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const du = drift.x * c - drift.z * s, dv = drift.x * s + drift.z * c;
    if (!a || Math.abs(a.u) > 1.6 || Math.abs(a.v) > 1.6) { this.can.visible = this.ring.visible = this.mist.visible = false; this.spraySound(false); this.last = null; return; }
    // 噴罐跟著游標，稍微往鏡頭這邊傾
    const local = this.group.worldToLocal(a.w.clone());
    this.can.visible = true;
    this.can.position.set(local.x, this.hgt, local.z);
    const yaw = this.o.yaw;
    this.can.rotation.set(-Math.cos(yaw) * 0.35, 0, Math.sin(yaw) * 0.35);
    this.ring.visible = true;
    this.ring.position.set(local.x + drift.x, 0.05, local.z + drift.z);
    this.ring.scale.setScalar(R);
    const stock = col === 'white' ? this.o.paint.white : this.o.paint.black;
    const on = this.mouse.down && stock > 0;
    if (this.mouse.down && stock <= 0 && !this.noPaintWarned) {
      this.noPaintWarned = true;
      sfx.error();
      ui.toast(`${col === 'white' ? '白' : '黑'}漆噴完了……噴漆箱裡沒有了。`, 'bad', 3500);
    }
    this.mist.visible = on;
    if (on) {
      this.mist.position.set(local.x + drift.x / 2, this.hgt / 2 + 0.02, local.z + drift.z / 2);
      this.mist.scale.set(R, this.hgt, R);
      (this.mist.material as THREE.MeshBasicMaterial).opacity = 0.18 + Math.random() * 0.06;
    }
    this.spraySound(on);
    if (!on) { this.last = null; return; }
    this.sprayedAny[this.step as 'white' | 'black'] = true;
    // 學弟遞錯罐：噴了一下發現顏色不對
    if (this.canCol !== this.step) {
      this.wrongT += dt;
      if (this.wrongT > 0.6 && !this.wrongAsked) { this.wrongAsked = true; this.mouse.down = false; this.spraySound(false); setTimeout(() => this.askWrongCan(), 50); }
    }
    if (col === 'white') this.o.paint.white = Math.max(0, this.o.paint.white - dt); else this.o.paint.black = Math.max(0, this.o.paint.black - dt);
    const cu = a.u + du, cv = a.v + dv;
    const prev = this.last || { u: cu, v: cv };
    const segLen = Math.hypot(cu - prev.u, cv - prev.v);
    const n = Math.max(1, Math.ceil(segLen / (R / 3)));
    const dwell = 0.32 * Math.pow(this.hgt / 0.3, 2) / Math.max(0.3, 1 - 0.55 * this.o.soil);
    const alpha = 1 - Math.pow(0.08, dt / dwell / n);
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      this.stamp(prev.u + (cu - prev.u) * k, prev.v + (cv - prev.v) * k, R, alpha, col);
    }
    // 風吹的漆霧 (淡淡一大片)
    const wind = Math.hypot(drift.x, drift.z);
    if (wind > 0.005) this.stamp(cu + du * 2.5, cv + dv * 2.5, R * 2.2, alpha * 0.06 * Math.min(1, wind / 0.04), col);
    this.last = { u: cu, v: cv };
    if (Math.random() < dt * 0.6 && this.refreshT <= 0) { this.refreshCard(); this.refreshT = 0.5; }
    this.refreshT -= dt;
    this.dirty = true;
  }
  private refreshT = 0;

  private stamp(u: number, v: number, R: number, a: number, col: 'white' | 'black') {
    let x = this.px(u), y = this.px(v);
    const r = R * PPM;
    const rgb = col === 'white' ? '244,244,238' : '22,23,26';
    const draw = (ctx: CanvasRenderingContext2D, clip: (c: CanvasRenderingContext2D) => void) => {
      ctx.save();
      ctx.beginPath(); clip(ctx); ctx.clip('evenodd');
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(0.55, `rgba(${rgb},${a * 0.75})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    };
    // 地面：除了被木板蓋住的地方
    draw(this.gX, c => {
      c.rect(0, 0, N, N);
      if (this.frameOn) this.framePath(c);
      if (this.maskOn) this.maskNowPath(c);
    });
    if (this.frameOn) draw(this.fX, c => this.framePath(c));
    if (this.maskOn) {
      // 遮板上的漆畫在遮板自己的座標 (遮板轉了，漆跟著轉)
      const th = this.maskTurns * Math.PI / 2, cs = Math.cos(th), sn = Math.sin(th);
      const ul = u * cs - v * sn, vl = u * sn + v * cs;
      const sx = x, sy = y;
      x = this.px(ul); y = this.px(vl);
      draw(this.mX, c => this.maskPath(c));
      x = sx; y = sy;
    }
  }

  private spraySound(on: boolean) {
    if (on === this.spraying) return;
    this.spraying = on;
    sfx.spray(on);
  }

  // ---------------------------------------------------------------- 敲釘
  private setupNail() {
    this.setCam(0.8, 0.85, 42, -0.05, V(0, 0.1, 0));
    this.camDur = 0.7;
    this.newNail(true);
    const S = SM();
    this.hammer.clear();
    // 原點 = 鎚頭中心；握把沿 +x，鎚頭長軸沿 y
    const handle = S.mk(new THREE.CylinderGeometry(0.014, 0.017, 0.3, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa47a4c, roughness: 0.7 }), 0.16, 0, 0, true);
    this.hammer.add(handle);
    this.hammer.add(S.mk(new THREE.BoxGeometry(0.036, 0.1, 0.036), S.M.steel, 0, 0.005, 0, true));
    this.hammer.add(S.mk(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14), S.M.steel, 0, -0.05, 0, true));
    this.hammer.visible = true;
    this.group.add(this.hammer);
    this.poseHammer(0);
    this.placeAsst(1.1, 0.25);
  }

  private noNail = false;
  private newNail(first = false) {
    const box = this.o.nails;
    if (box && box.left <= 0) {
      // 盒子空了
      sfx.error();
      if (first) {
        this.noNail = true;
        ui.toast('鋼釘盒空了……這個點只能先不釘。', 'bad', 3200);
        setTimeout(() => this.finish(), 1400);
      } else {
        ui.toast('沒有備用的鋼釘了，只能用這根歪的。', 'bad', 3000);
        this.bent = false; this.depth = 1;
        setTimeout(() => this.finish(), 1400);
      }
      return;
    }
    if (box) box.left--;
    if (this.nail) this.group.remove(this.nail);
    if (!first) { this.nailsUsed++; sfx.pickup(); ui.toast(`拔起來換一根新的鋼釘。${box ? `（盒子裡剩 ${box.left} 根）` : ''}`, 'info', 1800); }
    this.depth = 0; this.tilt = { x: 0, z: 0 }; this.bent = false;
    this.meterSpeed = 0.8 + Math.random() * 0.18;
    this.nail = nailMesh(0, 0.075);
    this.group.add(this.nail);
    this.refreshCard();
  }

  /** 鐵鎚姿勢：k = 0 舉起來，1 = 敲下去 (手握在右後方，鎚頭繞著手腕揮) */
  private poseHammer(k: number) {
    const yaw = this.o.yaw;
    const r = V(Math.cos(yaw), 0, -Math.sin(yaw));
    const f = V(-Math.sin(yaw), 0, -Math.cos(yaw));
    const dir = r.clone().addScaledVector(f, 0.15).normalize(); // 從鎚頭指向手 (手在右邊)
    const top = this.nail ? this.nail.position.y + 0.017 : 0.02;
    const hand = dir.clone().multiplyScalar(0.3).add(V(0, top + 0.05, 0));
    const a = 0.1 + (1 - k) * 0.62; // 握把往上翹的角度
    const toHead = dir.clone().multiplyScalar(-Math.cos(a)).add(V(0, Math.sin(a), 0)).normalize();
    const head = hand.clone().addScaledVector(toHead, 0.3);
    this.hammer.position.copy(head).add(V(0, 0.05, 0));
    const x = hand.clone().sub(head).normalize();
    const z = new THREE.Vector3().crossVectors(x, V(0, 1, 0)).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    this.hammer.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }

  private nailTick(dt: number) {
    // 指針來回擺
    if (!this.bent && this.depth < 1) {
      this.meter += this.meterDir * this.meterSpeed * dt;
      if (this.meter > 1) { this.meter = 1; this.meterDir = -1; }
      if (this.meter < 0) { this.meter = 0; this.meterDir = 1; }
      const nd = this.card?.querySelector('.gcpb-needle') as HTMLElement | null;
      if (nd) nd.style.left = `${this.meter * 100}%`;
    }
    if (this.swing >= 0) {
      this.swing += dt / 0.16;
      const k = this.swing < 1 ? this.swing * this.swing : Math.max(0, 1 - (this.swing - 1) * 2.5);
      this.poseHammer(k);
      if (this.swing >= 1 && this.pendingQ >= 0) { this.land(this.pendingQ); this.pendingQ = -1; }
      if (this.swing > 1.4) { this.swing = -1; this.poseHammer(0); }
    }
    if (this.nail) {
      const raise = 0.075 * (1 - Math.min(1, this.depth)) + 0.001;
      this.nail.position.y = raise;
      this.nail.rotation.set(THREE.MathUtils.degToRad(this.tilt.x), 0, THREE.MathUtils.degToRad(this.tilt.z));
    }
  }

  private strike() {
    if (this.step !== 'nail' || this.anim || this.swing >= 0) return;
    if (this.bent) { sfx.error(); ui.toast('釘子歪了，按 R 拔起來重敲。', 'warn', 1800); return; }
    if (this.depth >= 1) return;
    this.pendingQ = 1 - Math.abs(this.meter - 0.5) * 2;
    this.swing = 0;
  }

  private land(q: number) {
    const soil = this.o.soil > 0.5;
    const jitter = (m: number) => (Math.random() - 0.5) * 2 * m;
    this.hits++;
    if (q < 0.18 && Math.random() < 0.5) {
      this.fingers++;
      sfx.thud();
      ui.toast('……啊！敲到手指了！！', 'bad', 2200);
      this.o.app.sceneManager.camera.position.y += 0.02;
      this.meterSpeed *= 1.05;
      this.refreshCard();
      return;
    }
    sfx.clink(q);
    if (q > 0.83) { this.depth += soil ? 0.6 : 0.26; this.tilt.x += jitter(0.5); this.tilt.z += jitter(0.5); }
    else if (q > 0.62) { this.depth += soil ? 0.45 : 0.18; this.tilt.x += jitter(1.6); this.tilt.z += jitter(1.6); }
    else { this.depth += soil ? 0.25 : 0.06; this.tilt.x += jitter(3.4); this.tilt.z += jitter(3.4); }
    this.meterSpeed *= 1.08;
    const tilt = Math.hypot(this.tilt.x, this.tilt.z);
    if (tilt > 6) {
      this.bent = true;
      sfx.error();
      ui.toast(`釘子敲歪了（${tilt.toFixed(1)}°）。`, 'warn', 2200);
    } else if (this.depth >= 1) {
      this.depth = 1;
      ui.toast(soil ? '釘下去了……土有點軟，感覺會晃。' : `鋼釘敲到底了${tilt < 1.5 ? '，很正！' : '。'}`, soil || tilt > 3 ? 'info' : 'good', 2400);
      setTimeout(() => this.finish(), 900);
    }
    this.refreshCard();
  }

  // ---------------------------------------------------------------- 結算
  private evaluate(): Omit<GcpWorkResult, 'nailTilt' | 'nailHits' | 'nailsUsed' | 'fingers' | 'loose' | 'canvas' | 'rot'> {
    const d = this.gX.getImageData(0, 0, N, N).data;
    const base = this.o.baseLum;
    let wN = 0, wOk = 0, bN = 0, bOk = 0, wSum = 0, bSum = 0, over = 0;
    const step = 2;
    for (let y = 0; y < N; y += step) for (let x = 0; x < N; x += step) {
      const u = (x / N - 0.5) * L, v = (y / N - 0.5) * L;
      const i = (y * N + x) * 4;
      const a = d[i + 3] / 255;
      const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const eff = a * lum + (1 - a) * base;
      if (Math.abs(u) < IN && Math.abs(v) < IN) {
        if (Math.abs(u) < 0.012 || Math.abs(v) < 0.012) continue;
        if (u * v > 0) { bN++; bSum += eff; if (eff < 0.24) bOk++; }
        else { wN++; wSum += eff; if (eff > 0.78) wOk++; }
      } else if (a > 0.3) over++;
    }
    const whiteCov = wOk / Math.max(1, wN), blackCov = bOk / Math.max(1, bN);
    const overflow = over / Math.max(1, wN + bN);
    const contrast = wSum / Math.max(1, wN) - bSum / Math.max(1, bN);
    const paintScore = Math.round(Math.max(0, Math.min(100, ((whiteCov + blackCov) / 2) * 100 - overflow * 120)));
    return { whiteCov, blackCov, overflow, contrast, paintScore };
  }

  private finish() {
    if (!this.active) return;
    const ev = this.evaluate();
    // 地面漆的畫布 (給場景裡的標用)
    const out = document.createElement('canvas');
    out.width = out.height = N;
    out.getContext('2d')!.drawImage(this.gC, 0, 0);
    const res: GcpWorkResult = {
      ...ev, rot: this.rot,
      nailTilt: Math.hypot(this.tilt.x, this.tilt.z), nailHits: this.hits, nailsUsed: this.nailsUsed, fingers: this.fingers,
      loose: this.o.soil > 0.5 || this.noNail, noNail: this.noNail, canvas: out,
    };
    const cb = this.o.onDone;
    this.teardown();
    cb(res);
  }

  private cancel() {
    const cb = this.o.onCancel;
    this.teardown();
    cb();
  }

  /** 測試工具：直接做出一個漂亮 (或指定品質) 的標 */
  quick(quality = 1) {
    if (!this.active) return;
    if (!this.nail && this.o.nails && this.o.nails.left > 0) this.o.nails.left--;
    this.frameOn = false; this.maskOn = false;
    const x = this.gX;
    x.clearRect(0, 0, N, N);
    const q = quality;
    x.fillStyle = `rgba(244,244,238,${0.6 + 0.4 * q})`;
    x.fillRect(this.px(-IN), this.px(-IN), this.px(IN) - this.px(-IN), this.px(IN) - this.px(-IN));
    x.fillStyle = `rgba(22,23,26,${0.6 + 0.4 * q})`;
    x.fillRect(this.px(0), this.px(0), this.px(IN) - this.px(0), this.px(IN) - this.px(0));
    x.fillRect(this.px(-IN), this.px(-IN), this.px(0) - this.px(-IN), this.px(0) - this.px(-IN));
    this.o.paint.white = Math.max(0, this.o.paint.white - 14);
    this.o.paint.black = Math.max(0, this.o.paint.black - 8);
    this.depth = 1; this.hits = 4;
    this.finish();
  }

  private teardown() {
    const app = this.o.app;
    const p = app.player;
    const cam = app.sceneManager.camera;
    this.spraySound(false);
    if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
    if (this.onMove) window.removeEventListener('mousemove', this.onMove);
    if (this.onDown) window.removeEventListener('mousedown', this.onDown);
    if (this.onUp) window.removeEventListener('mouseup', this.onUp);
    if (this.onWheel) window.removeEventListener('wheel', this.onWheel);
    this.onKey = this.onMove = this.onDown = this.onUp = null; this.onWheel = null;
    this.root?.remove(); this.root = null; this.card = null; this.banner = null;
    app.sceneManager.scene.remove(this.group);
    if (this.nail) { this.group.remove(this.nail); this.nail = null; }
    this.group.remove(this.hammer);
    document.body.classList.remove('bench-active', 'gcp-bench');
    this.hidden.forEach(c => { c.visible = true; });
    this.hidden = [];
    p.externalControl = this.savedCtl;
    this.savedCtl = null;
    cam.fov = this.savedFov;
    cam.updateProjectionMatrix();
    cam.position.copy(p.position);
    cam.quaternion.setFromEuler(p.euler);
    this.active = false;
    this.step = 'out';
    this.anim = null;
    this.camDur = 0.6;
    const c = app.sceneManager.renderer.domElement;
    try { (c.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需要使用者手勢 */ }
  }
}

export const gcpBench = new GcpBench();
(window as unknown as Record<string, unknown>).__gcpBench = gcpBench;
