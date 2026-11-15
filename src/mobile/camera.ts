/**
 * 2.5D 追隨相機 (寶可夢 3DS 風)：固定面向南 (+Z)、俯角 52°、距離 11 m、窄 FOV。
 * 在 sceneManager.render 之前覆寫相機；開車 / 運鏡 (externalControl) 時不插手。
 * 另外處理遮擋：玩家在器材室裡時屋頂隱藏、後牆半透明；擋在鏡頭與玩家之間的樹冠變透明。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { MobilePlayer } from './player';
import { YARD } from '../field/world';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export interface Occluders { roof: THREE.Object3D | null; walls: THREE.Mesh[] }

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _bx = new THREE.Box3(), _ray = new THREE.Ray();

export class FollowCamera {
  pitch = THREE.MathUtils.degToRad(56);
  /** 鏡頭距離 (= 縮放)：兩指捏合可調，記在 localStorage */
  dist = 18;
  fov = 36;
  /** 對話取景：目標點移到兩人中間 */
  focus: { x: number; z: number } | null = null;
  /** 對話時視軸下壓的程度 (0→1)：把對方和地上的東西抬到畫面上半部，不被對話框蓋住 */
  private talkDrop = 0;
  /** 對話時要把旁邊的東西一起框進來 (視野放寬一點) */
  focusWide = false;
  /** 靠近儀器時自動拉近，並把儀器一起框進來 (null = 不拉近) */
  closeUp: { x: number; z: number } | null = null;
  private closeK = 0;
  /** 平視器材架：鏡頭滑到貨架正前方、接近水平 */
  rack: { x: number; y: number; z: number } | null = null;
  private rackBlend = 0;
  private lastRack: { x: number; y: number; z: number } | null = null;
  private look = V();
  private pos = V();
  private wasFollowing = false;
  private occ: Occluders = { roof: null, walls: [] };
  /** 每種原本的材質各有一份半透明版 (一般樹和頂點色的樹材質不一樣) */
  private fadedMats = new Map<THREE.Material, THREE.Material>();
  private faded = new Set<THREE.Mesh>();
  private origMat = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private tmpCam = new THREE.PerspectiveCamera();
  private hidLabels: THREE.Object3D[] = [];

  constructor(private app: GameApp, private player: MobilePlayer) {
    try {
      const d = Number(localStorage.getItem('ks-m-dist'));
      if (d >= 9 && d <= 32) this.dist = d;
    } catch { /* 無痕模式 */ }
    const sm = app.sceneManager as AnyObj;
    const orig = sm.render.bind(sm);
    sm.render = () => { this.apply(); orig(); };
  }

  /** 瞬間跳到玩家身上 (換關、讀檔)；sync 會立刻把相機算好 (測試用) */
  snap() { this.wasFollowing = false; this.rack = null; this.rackBlend = 0; }
  sync() { this.wasFollowing = false; if (this.rack) this.rackBlend = 1; this.talkDrop = this.focus ? 1 : 0; this.apply(); }
  /** 兩指縮放：改鏡頭距離並記住 */
  setDist(d: number) {
    this.dist = THREE.MathUtils.clamp(d, 9, 32);
    try { localStorage.setItem('ks-m-dist', this.dist.toFixed(1)); } catch { /* 無痕模式 */ }
  }

  /** 開 / 關貨架平視 (null = 回到追隨) */
  setRack(t: { x: number; y: number; z: number } | null) { this.rack = t; }

  setOccluders(o: Occluders) {
    this.occ = o;
    o.walls.forEach(w => { const m = w.material as THREE.MeshStandardMaterial; m.transparent = true; });
  }

  get active() { return !this.player.externalControl && !this.player.isDroneMode; }

  apply() {
    const cam = this.app.sceneManager.camera as THREE.PerspectiveCamera;
    const p = this.player;
    if (this.rack) this.lastRack = this.rack;
    if (!this.active) { this.wasFollowing = false; this.restoreTrees(); this.shed(false); return; }
    const sm = this.app.sceneManager as AnyObj;
    const dt = 1 / 60;
    const foot = p.position.y - 1.65;
    // 目標點放在玩家前方一點 (南)，畫面下方留給動作列
    let tx = p.position.x, tz = p.position.z + 1.0, ty = foot + 1.0;
    // 架儀器時鏡頭靠近一點、角度放低一點
    this.closeK += ((this.closeUp ? 1 : 0) - this.closeK) * Math.min(1, (1 / 60) * 3);
    if (this.closeK < 0.002) this.closeK = 0;
    let dist = this.dist * (1 - 0.56 * this.closeK), fov = this.fov;
    if (this.focus) { tx = (tx + this.focus.x) / 2; tz = (tz + this.focus.z) / 2; ty = foot + 1.1; dist = this.dist * (this.focusWide ? 0.7 : 0.8); fov = this.focusWide ? 29 : 26; }
    else if (this.closeK > 0 && this.closeUp) {
      // 把玩家和儀器一起框進來
      tx += ((this.closeUp.x + p.position.x) / 2 - tx) * this.closeK;
      tz += ((this.closeUp.z + p.position.z) / 2 + 0.4 - tz) * this.closeK;
      ty = foot + 1.0 + 0.25 * this.closeK;
    }
    // 直式畫面：垂直視野要算進長寬比，讓畫面裡看到的範圍差不多
    const portrait = innerHeight > innerWidth;
    if (portrait) fov = Math.min(70, fov * 1.7);
    const want = V(tx, ty, tz);
    if (!this.wasFollowing || this.look.distanceTo(want) > 15) { this.look.copy(want); this.wasFollowing = true; }
    else this.look.lerp(want, Math.min(1, dt * 6));
    const pitch = this.pitch - THREE.MathUtils.degToRad(14) * this.closeK;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // 相機在目標北方 (−Z)、上方，面向南：器材室 (開口朝北) 和現場的路人都在畫面裡
    this.pos.set(this.look.x, this.look.y + dist * sp, this.look.z - dist * cp);
    const minY = (sm.heightAt?.(this.pos.x, this.pos.z) ?? 0) + 1.2;
    if (this.pos.y < minY) this.pos.y = minY;
    // 平視器材架：和追隨鏡頭之間平滑過渡 (rackBlend 0→1)
    const wantRack = this.rack ? 1 : 0;
    this.rackBlend += (wantRack - this.rackBlend) * Math.min(1, dt * 5);
    if (this.rackBlend < 0.002) this.rackBlend = 0;
    let cp2 = this.pos, cl2 = this.look;
    if (this.rackBlend > 0 && this.lastRack) {
      const r = this.lastRack;
      const rfov = portrait ? 56 : 42;
      const tanH = (innerWidth / Math.max(1, innerHeight)) * Math.tan(THREE.MathUtils.degToRad(rfov) / 2);
      const rd = THREE.MathUtils.clamp(2.9 / Math.max(0.12, tanH), 3.4, 7.6);
      const k = this.rackBlend;
      // 鏡頭和貨架同高 (平視)，但視軸略為下壓，把架子抬到畫面上半部 (下半被面板蓋住)
      cp2 = this.pos.clone().lerp(V(r.x, r.y + 0.6, r.z - rd), k);
      cl2 = this.look.clone().lerp(V(r.x, r.y - 2.0, r.z), k);
      fov += (rfov - fov) * k;
    }
    // 中暑：鏡頭輕微晃
    const heat = document.body.classList.contains('heat2') ? 1 : document.body.classList.contains('heat1') ? 0.55 : 0;
    if (heat > 0) {
      const t = performance.now() / 1000;
      cp2 = cp2.clone();
      cp2.x += Math.sin(t * 5.3) * 0.035 * heat + Math.sin(t * 11.7) * 0.015 * heat;
      cp2.y += Math.sin(t * 4.1 + 1.3) * 0.03 * heat;
      cp2.z += Math.cos(t * 6.7) * 0.03 * heat;
    }
    // 對話中：視軸往下壓，讓對方和他腳邊的東西 (界樁之類) 落在對話框上方
    const wantDrop = this.focus ? 1 : 0;
    this.talkDrop += (wantDrop - this.talkDrop) * Math.min(1, dt * 5);
    if (this.talkDrop < 0.002) this.talkDrop = 0;
    if (this.talkDrop > 0) { cl2 = cl2.clone(); cl2.y -= (this.focusWide ? 3.4 : 1.35) * this.talkDrop; }
    cam.position.copy(cp2);
    this.tmpCam.position.copy(cp2);
    this.tmpCam.up.set(0, 1, 0);
    this.tmpCam.lookAt(cl2);
    cam.quaternion.copy(this.tmpCam.quaternion);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.shed(this.inShed(p.position.x, p.position.z));
    const fa = (sm.floatingArrows || []) as THREE.Object3D[];
    if (this.closeK > 0.4) { fa.forEach(o => { if (o.visible) { this.hidLabels.push(o); o.visible = false; } }); }
    else if (this.hidLabels.length) { this.hidLabels.forEach(o => { o.visible = true; }); this.hidLabels = []; }
    this.fadeTrees();
  }

  private inShed(x: number, z: number) {
    // 站在器材室前面或裡面：屋頂會擋住貨架，就把它藏起來
    return Math.abs(x - YARD.x) < 9 && z - YARD.z > -3 && z - YARD.z < 12.5;
  }

  private shed(inside: boolean) {
    if (this.occ.roof) this.occ.roof.visible = !inside;
    // 平視貨架時牆面要是實心的，不然會看穿到外面的樹
    const o = inside && this.rackBlend < 0.5 ? 0.3 : 1;
    this.occ.walls.forEach(w => { (w.material as THREE.MeshStandardMaterial).opacity = o; });
  }

  /** 相機→玩家這條線附近的樹冠變透明 (一般的樹＋第三天的榕樹、竹林這種大的) */
  private fadeTrees() {
    const sm = this.app.sceneManager as AnyObj;
    const occ: { x: number; z: number; y: number; r: number; meshes: THREE.Mesh[] }[] = [];
    const pp = this.player.position;
    for (const t of (sm.trees || []) as THREE.Object3D[]) {
      if (Math.abs(t.position.x - pp.x) > 30 || Math.abs(t.position.z - pp.z) > 30) continue;
      const ms = t.children.filter(c => (c as THREE.Mesh).isMesh) as THREE.Mesh[];
      if (ms.length) occ.push({ x: t.position.x, z: t.position.z, y: t.position.y + 2.6, r: 2.6, meshes: ms });
    }
    // 大樹、竹林：範圍用模型實際的外框 (第一次用到時算一次，它們不會動)
    for (const o of (sm.fadeOcc || []) as AnyObj[]) {
      if (!o.bb) {
        const bb = new THREE.Box3();
        o.meshes.forEach((m: THREE.Mesh) => { m.updateWorldMatrix(true, false); bb.expandByObject(m); });
        const c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
        // 樹幹那一截不算 (擋不到什麼)，樹冠外緣稀疏的部分也不算
        o.bb = new THREE.Box3(new THREE.Vector3(c.x - sz.x * 0.42, bb.min.y + sz.y * 0.3, c.z - sz.z * 0.42), new THREE.Vector3(c.x + sz.x * 0.42, bb.max.y - sz.y * 0.05, c.z + sz.z * 0.42));
        o.x = c.x; o.z = c.z; o.r = Math.max(sz.x, sz.z) / 2;
      }
      occ.push(o);
    }
    // 從相機往「玩家本人」和「他腳邊幾個點」各看一條線，被哪棵樹冠擋到就把那棵變透明
    // (只檢查擋到玩家本人不夠：樹冠蓋住他前後的地面，一樣看不到要操作的地方)
    const cam = sm.camera as THREE.PerspectiveCamera;
    const b = this.player.position;
    const gy = b.y - 1.65;
    const fx = cam.position.x - b.x, fz = cam.position.z - b.z, fl = Math.hypot(fx, fz) || 1;
    const ux = fx / fl, uz = fz / fl;                       // 地面上朝相機的方向
    const tg: [number, number, number][] = [[0, 1.2, 0], [0, 0, 0], [ux * 3.5, 0, uz * 3.5], [ux * 7, 0, uz * 7], [-ux * 3.5, 0, -uz * 3.5], [uz * 4, 0, -ux * 4], [-uz * 4, 0, ux * 4]];
    const hit = new Set<THREE.Mesh>();
    for (const t of occ) {
      const lim = 24 + t.r;
      if (Math.abs(t.x - b.x) > lim || Math.abs(t.z - b.z) > lim) continue;
      const box: THREE.Box3 = (t as AnyObj).bb || _bx.set(_p.set(t.x - t.r * 0.8, t.y - t.r * 0.7, t.z - t.r * 0.8), _q.set(t.x + t.r * 0.8, t.y + t.r * 0.8, t.z + t.r * 0.8));
      for (const [dx, dy, dz] of tg) {
        _q.set(b.x + dx, gy + dy, b.z + dz);
        const len = _q.distanceTo(cam.position);
        _ray.origin.copy(cam.position); _ray.direction.copy(_q).sub(cam.position).normalize();
        const at = _ray.intersectBox(box, _p);
        if (at && at.distanceTo(cam.position) < len - 0.5) { t.meshes.forEach(m => hit.add(m)); break; }
      }
    }
    this.faded.forEach(m => { if (!hit.has(m)) { m.material = this.origMat.get(m)!; this.faded.delete(m); } });
    hit.forEach(m => {
      if (this.faded.has(m)) return;
      const src = m.material as THREE.Material;
      let f = this.fadedMats.get(src);
      if (!f) { f = src.clone(); f.transparent = true; f.opacity = 0.28; f.depthWrite = false; this.fadedMats.set(src, f); }
      this.origMat.set(m, m.material); m.material = f; this.faded.add(m);
    });
  }

  private restoreTrees() {
    this.faded.forEach(m => { m.material = this.origMat.get(m)!; });
    this.faded.clear();
  }

  /** 把螢幕座標轉成射線 */
  rayFromScreen(sx: number, sy: number): THREE.Raycaster {
    const cam = this.app.sceneManager.camera as THREE.PerspectiveCamera;
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), cam);
    return r;
  }
}
