/**
 * 第三天：RTK 測 GCP 中心坐標 (近距離操作)
 *  - 對中桿立在鋼釘上，WASD 把氣泡壓在圈裡 (風會一直推)
 *  - 手簿畫面：衛星數、PDOP、解算狀態 (單點 → 浮動 → 固定)、平面／高程精度
 *  - Space 開始記錄 3 筆 (每筆 3 秒)，記錄時桿子歪就會把誤差帶進去
 * 樹底下、牆邊收訊差：固定解很慢、甚至一直浮動 (遊戲不提示，看手簿自己判斷)
 */
import * as THREE from 'three';
import type { GameApp } from './legacy';
import { SM } from './legacy';
import * as ui from './ui';
import * as sfx from './sfx';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const POLE = 1.8;

export interface RtkEnv { canopy: string | null; bldD: number }
export interface RtkResult {
  sol: 'fix' | 'float';
  /** 手簿顯示的精度 (cm) */
  h: number; v: number;
  /** 記錄時桿子平均傾斜造成的偏移 (mm) */
  tiltMm: number;
  /** 假固定：手簿說固定，其實差很多 */
  falseFix: boolean;
  wait: number;
}

export interface RtkOpts {
  app: GameApp; name: string; x: number; y: number; z: number; yaw: number;
  env: RtkEnv; wind: { x: number; z: number }; asstName: string;
  onDone: (r: RtkResult | null) => void;
}

type Sol = 'none' | 'single' | 'float' | 'fix';

class RtkBench {
  active = false;
  private o!: RtkOpts;
  private root: HTMLElement | null = null;
  private pole = new THREE.Group();
  private savedCtl: ((dt: number) => void) | null = null;
  private savedFov = 65;
  private fromPos = V(); private fromQuat = new THREE.Quaternion(); private toPos = V(); private toQuat = new THREE.Quaternion();
  private t = 0;
  private hidden: THREE.Object3D[] = [];
  private keys = { u: false, d: false, l: false, r: false };
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onUp: ((e: KeyboardEvent) => void) | null = null;
  // 氣泡 (−1~1；圈的半徑 0.28)
  private bx = 0; private by = 0; private vx = 0; private vy = 0;
  // 衛星
  private time = 0;
  private sol: Sol = 'none';
  private fixAt = 0;
  private falseFixAt = -1;
  private sats = 0; private pdop = 0; private h = 0; private v = 0;
  private rec: { n: number; t: number; tiltSum: number; samples: number } | null = null;
  private screenT = 0;

  start(o: RtkOpts) {
    this.o = o;
    this.active = true;
    const app = o.app, sm = app.sceneManager, p = app.player, cam = sm.camera;
    if (document.exitPointerLock) document.exitPointerLock();
    document.body.classList.add('bench-active', 'gcp-bench');
    p.hidePrompt?.();
    this.savedCtl = p.externalControl;
    p.externalControl = (dt: number) => this.update(dt);
    this.savedFov = cam.fov;
    this.hidden = cam.children.filter(c => c.visible);
    this.hidden.forEach(c => { c.visible = false; });

    // 環境 → 收訊
    const e = o.env;
    this.time = 0; this.sol = 'none'; this.falseFixAt = -1;
    if (e.canopy) { this.fixAt = Infinity; if (Math.random() < 0.35) this.falseFixAt = 70 + Math.random() * 30; }
    else if (e.bldD < 4) this.fixAt = 18 + Math.random() * 14;
    else this.fixAt = 5 + Math.random() * 6;
    this.bx = (Math.random() - 0.5) * 0.8; this.by = (Math.random() - 0.5) * 0.8; this.vx = this.vy = 0;
    this.rec = null;
    this.keys = { u: false, d: false, l: false, r: false };

    this.buildPole();
    this.pole.position.set(o.x, o.y + 0.02, o.z);
    sm.scene.add(this.pole);

    // 鏡頭：站在桿子後面，看氣泡和手簿
    const f = V(-Math.sin(o.yaw), 0, -Math.cos(o.yaw));
    const r = V(Math.cos(o.yaw), 0, -Math.sin(o.yaw));
    this.fromPos.copy(cam.position); this.fromQuat.copy(cam.quaternion);
    this.toPos.set(o.x, o.y, o.z).addScaledVector(f, -1.15).addScaledVector(r, -0.15).add(V(0, 1.6, 0));
    const look = V(o.x, o.y + 0.85, o.z);
    this.toQuat.setFromRotationMatrix(new THREE.Matrix4().lookAt(this.toPos, look, V(0, 1, 0)));
    this.t = 0;

    this.root = document.createElement('div');
    this.root.className = 'bench rtkb';
    this.root.innerHTML = `
      <div class="big-guide rtk-banner"><div class="bg-main"></div></div>
      <div class="bench-card paper rtk-card">
        <div class="bench-head"><h3>${o.name}　RTK 測坐標</h3><span class="bench-keys">WASD：扶正桿子　Space：開始記錄　Esc：先不測</span></div>
        <div class="rtk-body">
          <div class="rh-vial"><i class="rh-ring"></i><b class="rh-bub"></b></div>
          <div class="rtk-screen">
            <div class="rs-top"><span>GNSS RTK</span><span class="rs-net">網路 RTK　已連線</span></div>
            <div class="rs-sol">—</div>
            <div class="rs-grid">
              <span>衛星</span><b class="rs-sats">0</b>
              <span>PDOP</span><b class="rs-pdop">—</b>
              <span>平面精度</span><b class="rs-h">—</b>
              <span>高程精度</span><b class="rs-v">—</b>
            </div>
            <div class="rs-rec"><span class="rs-rec-t">記錄 0 / 3</span><i><em></em></i></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.onKey = (ev) => this.key(ev, true);
    this.onUp = (ev) => this.key(ev, false);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onUp, true);
  }

  private buildPole() {
    const S = SM();
    this.pole.clear();
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.4 });
    this.pole.add(S.mk(new THREE.CylinderGeometry(0.0125, 0.0125, POLE, 12), yellow, 0, POLE / 2, 0, true));
    this.pole.add(S.mk(new THREE.ConeGeometry(0.012, 0.04, 10).rotateX(Math.PI), S.M.steel, 0, -0.005, 0, true));
    // 接收儀
    this.pole.add(S.mk(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 24), new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.4 }), 0, POLE + 0.035, 0));
    this.pole.add(S.mk(new THREE.SphereGeometry(0.075, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.3 }), 0, POLE + 0.07, 0));
    // 圓水準器 + 手簿架
    this.pole.add(S.mk(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), S.M.black, 0.035, 1.45, 0, true));
    this.pole.add(S.mk(S.rbox(0.11, 0.18, 0.025, 0.01), S.M.black, 0.0, 1.22, 0.07, true));
    this.pole.add(S.mk(new THREE.BoxGeometry(0.085, 0.11, 0.002), new THREE.MeshStandardMaterial({ color: 0x0f2740, emissive: 0x1d4f80, emissiveIntensity: 0.6 }), 0.0, 1.24, 0.084, true));
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (document.querySelector('.field-modal')) return;
    const m: Record<string, keyof RtkBench['keys']> = { KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
    if (m[e.code]) { this.keys[m[e.code]] = down; e.preventDefault(); e.stopPropagation(); return; }
    e.stopPropagation();
    if (!down) return;
    if (e.code === 'Escape') { e.preventDefault(); if (this.rec) { ui.toast('記錄中，先別走。', 'warn', 1500); return; } this.finish(null); return; }
    if ((e.code === 'Space' || e.code === 'Enter') && !this.rec) {
      e.preventDefault();
      if (this.sol === 'none' || this.sol === 'single') { sfx.error(); ui.toast('還在搜衛星……', 'info', 1500); return; }
      this.rec = { n: 0, t: 0, tiltSum: 0, samples: 0 };
      sfx.pickup();
    }
  }

  private update(dt: number) {
    const cam = this.o.app.sceneManager.camera;
    this.t = Math.min(1, this.t + dt / 0.6);
    const k = this.t * this.t * (3 - 2 * this.t);
    cam.position.lerpVectors(this.fromPos, this.toPos, k);
    cam.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, k);
    if (Math.abs(cam.fov - 50) > 0.1) { cam.fov += (50 - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    // 氣泡：亂飄 + 風推 + 玩家壓
    const w = this.o.wind;
    const gust = 0.5 + 0.5 * Math.sin(this.time * 0.9) * Math.sin(this.time * 2.3);
    const fx = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0), fy = (this.keys.d ? 1 : 0) - (this.keys.u ? 1 : 0);
    this.vx += ((Math.random() - 0.5) * 1.4 + w.x * 0.18 * gust + fx * 2.2) * dt;
    this.vy += ((Math.random() - 0.5) * 1.4 + w.z * 0.18 * gust + fy * 2.2) * dt;
    this.vx *= Math.pow(0.25, dt); this.vy *= Math.pow(0.25, dt);
    this.bx = THREE.MathUtils.clamp(this.bx + this.vx * dt, -1, 1);
    this.by = THREE.MathUtils.clamp(this.by + this.vy * dt, -1, 1);
    const tilt = Math.hypot(this.bx, this.by); // 1 ≈ 1.5°
    this.pole.rotation.set(this.by * 0.045, 0, -this.bx * 0.045);

    this.satTick(dt);
    if (this.rec) {
      this.rec.t += dt;
      this.rec.tiltSum += tilt; this.rec.samples++;
      if (this.rec.t >= 3) {
        this.rec.n++; this.rec.t = 0;
        sfx.pickup();
        if (this.rec.n >= 3) { this.finishRec(); return; }
      }
    }
    this.draw(tilt);
  }

  private satTick(dt: number) {
    this.time += dt;
    const e = this.o.env, t = this.time;
    const prev = this.sol;
    if (t < 1.5) { this.sol = 'none'; this.sats = Math.floor(t * 4); }
    else if (t < 3.5) this.sol = 'single';
    else if (this.falseFixAt > 0 && t > this.falseFixAt) this.sol = 'fix';
    else if (t >= this.fixAt) this.sol = 'fix';
    else this.sol = 'float';
    this.screenT -= dt;
    if (this.screenT <= 0) {
      this.screenT = 0.5;
      const j = (a: number, b: number) => a + Math.random() * (b - a);
      if (e.canopy) { this.sats = Math.round(j(7, 10)); this.pdop = j(4, 6.5); }
      else if (e.bldD < 4) { this.sats = Math.round(j(11, 14)); this.pdop = j(2.4, 3.6); }
      else if (t > 1.5) { this.sats = Math.round(j(19, 24)); this.pdop = j(1.1, 1.7); }
      const base = this.sol === 'fix' ? (e.bldD < 4 ? [1.8, 3] : e.canopy ? [1.6, 2.6] : [0.7, 1.2]) : this.sol === 'float' ? (e.canopy ? [18, 45] : [6, 25]) : [120, 400];
      this.h = j(base[0], base[1]); this.v = this.h * j(1.5, 2);
    }
    if (prev !== this.sol && this.sol === 'fix') sfx.pickup();
  }

  private draw(tilt: number) {
    const r = this.root;
    if (!r) return;
    const bub = r.querySelector('.rh-bub') as HTMLElement;
    bub.style.transform = `translate(${this.bx * 50}px, ${this.by * 50}px)`;
    bub.classList.toggle('ok', tilt < 0.28);
    const g = r.querySelector('.rtk-banner .bg-main') as HTMLElement;
    const gtxt = this.rec ? '記錄中……桿子扶好別動！（<kbd class="cap">WASD</kbd> 保持氣泡在圈裡）'
      : this.sol === 'fix' ? '手簿是<b class="g">固定解 FIX</b> 了 → 按 <kbd class="cap cap-wide">Space</kbd> 開始記錄'
        : '用 <kbd class="cap">WASD</kbd> 把氣泡壓在中間圈裡，等手簿跳成<b class="g">固定解 FIX</b>';
    if (g.innerHTML !== gtxt) g.innerHTML = gtxt;
    const solEl = r.querySelector('.rs-sol') as HTMLElement;
    const lab: Record<Sol, string> = { none: '搜尋衛星中…', single: '單點定位', float: '浮動解 FLOAT', fix: '固定解 FIX' };
    solEl.textContent = lab[this.sol];
    solEl.className = `rs-sol s-${this.sol}`;
    (r.querySelector('.rs-sats') as HTMLElement).textContent = String(this.sats);
    (r.querySelector('.rs-pdop') as HTMLElement).textContent = this.pdop ? this.pdop.toFixed(1) : '—';
    const cm = (v: number) => (this.sol === 'none' ? '—' : v >= 100 ? `${(v / 100).toFixed(1)} m` : `${v.toFixed(1)} cm`);
    (r.querySelector('.rs-h') as HTMLElement).textContent = cm(this.h);
    (r.querySelector('.rs-v') as HTMLElement).textContent = cm(this.v);
    const n = this.rec ? this.rec.n + this.rec.t / 3 : 0;
    (r.querySelector('.rs-rec-t') as HTMLElement).textContent = this.rec ? `記錄中 ${Math.min(3, this.rec.n + 1)} / 3` : '按 Space 開始記錄';
    (r.querySelector('.rs-rec em') as HTMLElement).style.width = `${n / 3 * 100}%`;
  }

  private finishRec() {
    const r = this.rec!;
    const avgTilt = r.tiltSum / Math.max(1, r.samples); // 1 ≈ 1.5°
    const tiltMm = Math.tan(avgTilt * 1.5 * Math.PI / 180) * POLE * 1000;
    const res: RtkResult = {
      sol: this.sol === 'fix' ? 'fix' : 'float',
      h: this.h, v: this.v, tiltMm,
      falseFix: this.sol === 'fix' && !!this.o.env.canopy,
      wait: this.time,
    };
    ui.toast(`${this.o.name} 記錄完成：${res.sol === 'fix' ? '固定解' : '浮動解'}，平面 ${res.h.toFixed(1)} cm。`, res.sol === 'fix' ? 'good' : 'warn', 3200);
    this.finish(res);
  }

  private finish(res: RtkResult | null) {
    const app = this.o.app, p = app.player, cam = app.sceneManager.camera;
    if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
    if (this.onUp) window.removeEventListener('keyup', this.onUp, true);
    this.onKey = this.onUp = null;
    this.root?.remove(); this.root = null;
    app.sceneManager.scene.remove(this.pole);
    document.body.classList.remove('bench-active', 'gcp-bench');
    this.hidden.forEach(c => { c.visible = true; }); this.hidden = [];
    p.externalControl = this.savedCtl; this.savedCtl = null;
    cam.fov = this.savedFov; cam.updateProjectionMatrix();
    cam.position.copy(p.position); cam.quaternion.setFromEuler(p.euler);
    this.active = false;
    const c = app.sceneManager.renderer.domElement;
    try { (c.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需要使用者手勢 */ }
    this.o.onDone(res);
  }

  /** 測試工具：直接用現在的狀態記錄完 */
  quick() {
    if (!this.active) return;
    this.time = Math.max(this.time, this.o.env.canopy ? 20 : this.fixAt + 1);
    this.satTick(0.6);
    this.rec = { n: 3, t: 0, tiltSum: 0.1, samples: 1 };
    this.finishRec();
  }
}

export const rtkBench = new RtkBench();
(window as unknown as Record<string, unknown>).__rtkBench = rtkBench;
