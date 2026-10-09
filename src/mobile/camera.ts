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

export class FollowCamera {
  pitch = THREE.MathUtils.degToRad(56);
  /** 鏡頭距離 (= 縮放)：兩指捏合可調，記在 localStorage */
  dist = 18;
  fov = 36;
  /** 對話取景：目標點移到兩人中間 */
  focus: { x: number; z: number } | null = null;
  /** 平視器材架：鏡頭滑到貨架正前方、接近水平 */
  rack: { x: number; y: number; z: number } | null = null;
  private rackBlend = 0;
  private lastRack: { x: number; y: number; z: number } | null = null;
  private look = V();
  private pos = V();
  private wasFollowing = false;
  private occ: Occluders = { roof: null, walls: [] };
  private fadedMat: THREE.Material | null = null;
  private faded = new Set<THREE.Mesh>();
  private origMat = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private tmpCam = new THREE.PerspectiveCamera();

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
  sync() { this.wasFollowing = false; if (this.rack) this.rackBlend = 1; this.apply(); }
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
    let dist = this.dist, fov = this.fov;
    if (this.focus) { tx = (tx + this.focus.x) / 2; tz = (tz + this.focus.z) / 2; ty = foot + 1.1; dist = this.dist * 0.8; fov = 26; }
    // 直式畫面：垂直視野要算進長寬比，讓畫面裡看到的範圍差不多
    const portrait = innerHeight > innerWidth;
    if (portrait) fov = Math.min(70, fov * 1.7);
    const want = V(tx, ty, tz);
    if (!this.wasFollowing || this.look.distanceTo(want) > 15) { this.look.copy(want); this.wasFollowing = true; }
    else this.look.lerp(want, Math.min(1, dt * 6));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
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
    cam.position.copy(cp2);
    this.tmpCam.position.copy(cp2);
    this.tmpCam.up.set(0, 1, 0);
    this.tmpCam.lookAt(cl2);
    cam.quaternion.copy(this.tmpCam.quaternion);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.shed(this.inShed(p.position.x, p.position.z));
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

  /** 相機→玩家這條線附近的樹冠變透明 */
  private fadeTrees() {
    const sm = this.app.sceneManager as AnyObj;
    const trees: THREE.Group[] = sm.trees || [];
    const a = this.pos, b = this.player.position;
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const L2 = abx * abx + aby * aby + abz * abz;
    const hit = new Set<THREE.Mesh>();
    for (const t of trees) {
      if (Math.abs(t.position.x - b.x) > 14 || Math.abs(t.position.z - b.z) > 14) continue;
      const cx = t.position.x, cy = t.position.y + 2.6, cz = t.position.z;
      let k = ((cx - a.x) * abx + (cy - a.y) * aby + (cz - a.z) * abz) / L2;
      k = Math.max(0.05, Math.min(0.92, k));
      const px = a.x + abx * k, py = a.y + aby * k, pz = a.z + abz * k;
      const d = Math.hypot(cx - px, cy - py, cz - pz);
      if (d < 2.6) t.children.forEach(c => { if ((c as THREE.Mesh).isMesh) hit.add(c as THREE.Mesh); });
    }
    if (!this.fadedMat && hit.size) {
      const src = (hit.values().next().value as THREE.Mesh).material as THREE.Material;
      const m = src.clone() as THREE.MeshStandardMaterial;
      m.transparent = true; m.opacity = 0.28; m.depthWrite = false;
      this.fadedMat = m;
    }
    this.faded.forEach(m => { if (!hit.has(m)) { m.material = this.origMat.get(m)!; this.faded.delete(m); } });
    hit.forEach(m => { if (!this.faded.has(m)) { this.origMat.set(m, m.material); m.material = this.fadedMat!; this.faded.add(m); } });
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
