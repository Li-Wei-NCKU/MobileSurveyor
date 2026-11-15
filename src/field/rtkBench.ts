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
import { attachHoldPad, isMobile, rodHintOn, rodHintDone, type PadVec } from './holdPad';
import { gameIntro } from '../mobile/intro';
import { tiltEnable, tiltLive, tiltBubbleStep, tiltOff, type BubbleState } from '../mobile/tilt';
import { rtkPoseArt, posePop } from '../mobile/poseArt';
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
  private pad: PadVec = { x: 0, y: 0 };
  private padDetach: (() => void) | null = null;
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onUp: ((e: KeyboardEvent) => void) | null = null;
  // 氣泡 (−1~1；圈的半徑 0.28)
  private bx = 0; private by = 0; private vx = 0; private vy = 0;
  private bub: BubbleState = { bx: 0, by: 0 };
  // 衛星
  private time = 0;
  private sol: Sol = 'none';
  private fixAt = 0;
  private falseFixAt = -1;
  private sats = 0; private pdop = 0; private h = 0; private v = 0;
  private rec: { n: number; t: number; tiltSum: number; samples: number } | null = null;
  private screenT = 0;
  private pose: ((bad: boolean, dt: number) => void) | null = null;

  start(o: RtkOpts) {
    gameIntro({
      key: 'rtk',
      title: 'RTK 測坐標',
      sub: '對中桿立在鋼釘上，桿子要扶直',
      art: rtkPoseArt, artWide: true,
      lines: ['把<b>手機放平</b>（螢幕朝上，照上面的圖），手機就是桿子上的圓水準器。',
        '手機一歪，氣泡就跑掉。把<b>氣泡留在中間的圈裡</b>。',
        '風會一直推，氣泡會飄，要<b>跟著修</b>，擺在桌上不動是過不了的。',
        '等手簿跳成<b>固定解 FIX</b> 才按<b>「開始記錄」</b>。',
        '記錄 3 筆；記錄中桿子歪掉，誤差就會記進去。（手機沒有動作感測器時，改用手指按住下面的推桿區來扶。）'],
      short: '手機放平當圓水準器，把氣泡留在圈裡，等固定解 FIX 再按「開始記錄」。',
      onStart: () => { tiltEnable(); this.startNow(o); },
    });
  }

  private startNow(o: RtkOpts) {
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
        <div class="bench-head"><h3>${o.name}　RTK 測坐標</h3><span class="bench-keys">${isMobile() ? '按住水準器扶正桿子' : 'WASD：扶正桿子　Space：開始記錄　Esc：先不測'}</span></div>
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
        ${isMobile() ? `<div class="rh-pad"><i class="rh-pad-x"></i><span>按住這裡，往要扶的方向推</span>${rodHintOn() ? '<svg class="rh-tip" viewBox="0 0 120 120" aria-hidden="true"><circle class="tip-dot" cx="60" cy="60" r="9"><animate attributeName="cx" values="60;86;60;34;60" dur="2.6s" repeatCount="indefinite"/><animate attributeName="cy" values="34;60;86;60;34" dur="2.6s" repeatCount="indefinite"/></circle></svg>' : ''}</div>` : ''}
        ${isMobile() ? '<div class="rh-tilt flat"><svg viewBox="0 0 56 40" aria-hidden="true"><path d="M8 24 L30 14 L50 20 L28 31 Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 24v3l20 7 22-11v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span class="rh-tilt-t">把手機放平，螢幕朝上</span></div>' : ''}
        ${isMobile() ? `<div class="scope-mbar rtk-mbar">
          <button type="button" class="sm-btn primary" data-a="rec">開始記錄</button>
          <button type="button" class="sm-btn ghost" data-a="quit">先不測</button>
        </div>` : ''}
      </div>`;
    document.body.appendChild(this.root);
    if (isMobile()) {
      if (rodHintOn()) {
        const v = this.root.querySelector('.rh-pad');
        v?.addEventListener('pointerdown', () => { rodHintDone(); this.root?.querySelectorAll('.rh-tip').forEach(e => e.remove()); }, { once: true });
      }
      this.padDetach = attachHoldPad(this.root.querySelector('.rh-pad'), this.pad);
      this.root.querySelectorAll<HTMLButtonElement>('.rtk-mbar .sm-btn').forEach(b => {
        b.onclick = (ev) => {
          ev.stopPropagation();
          if (b.dataset.a === 'rec') this.key({ code: 'Space', preventDefault() {}, stopPropagation() {} } as KeyboardEvent, true);
          else this.key({ code: 'Escape', preventDefault() {}, stopPropagation() {} } as KeyboardEvent, true);
        };
      });
    }
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
    const fx = (this.keys.r ? 1 : 0) - (this.keys.l ? 1 : 0) + this.pad.x;
    const fy = (this.keys.d ? 1 : 0) - (this.keys.u ? 1 : 0) + this.pad.y;
    // 記錄中要撐住：陣風比平常大 (不然按住推桿就沒事做了)
    const tense = this.rec ? 2.0 : 1;
    const sensor = isMobile() && tiltLive();
    this.root?.classList.toggle('tilt', sensor);
    if (sensor) {
      // 手機放平當圓水準器：氣泡 = 手機歪斜 ＋ 擾動 (風)
      this.bub.bx = this.bx; this.bub.by = this.by;
      tiltBubbleStep(this.bub, 'flat', this.time, dt, this.rec ? 0.58 : 0.52);
      this.bx = this.bub.bx; this.by = this.bub.by;
      const tt = this.root?.querySelector('.rh-tilt-t') as HTMLElement | null;
      const t2 = tiltOff('flat') > 25 ? '把手機放平，螢幕朝上' : '微微調整手機，讓氣泡留在圈裡';
      // 手機一直拿錯 (立起來、或斜很多)：跳出圖提醒怎麼拿
      if (!this.pose && this.root) this.pose = posePop(this.root, rtkPoseArt, '手機要<b>放平</b>、螢幕朝上');
      this.pose?.(tiltOff('flat') > 35, dt);
      if (tt && tt.textContent !== t2) tt.textContent = t2;
    } else {
      this.vx += ((Math.random() - 0.5) * 0.85 * tense + Math.sin(this.time * 2.4) * 0.3 * tense + w.x * 0.11 * gust + fx * 3.2) * dt;
      this.vy += ((Math.random() - 0.5) * 0.85 * tense + Math.cos(this.time * 1.9) * 0.3 * tense + w.z * 0.11 * gust + fy * 3.2) * dt;
      this.vx *= Math.pow(0.15, dt); this.vy *= Math.pow(0.15, dt);
      this.bx = THREE.MathUtils.clamp(this.bx + this.vx * dt, -1, 1);
      this.by = THREE.MathUtils.clamp(this.by + this.vy * dt, -1, 1);
    }
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
    const vw2 = (r.querySelector('.rh-vial') as HTMLElement)?.clientWidth || 120;
    bub.style.transform = `translate(${this.bx * vw2 * 0.38}px, ${this.by * vw2 * 0.38}px)`;
    bub.classList.toggle('ok', tilt < 0.38);
    const g = r.querySelector('.rtk-banner .bg-main') as HTMLElement;
    const sens = isMobile() && tiltLive();
    const gtxt = this.rec ? (sens ? '記錄中……手機端平別動，氣泡留在圈裡！' : '記錄中……桿子扶好別動！（<kbd class="cap">WASD</kbd> 保持氣泡在圈裡）')
      : this.sol === 'fix' ? '手簿是<b class="g">固定解 FIX</b> 了 → 按 <kbd class="cap cap-wide">Space</kbd> 開始記錄'
        : sens ? '手機放平，把氣泡留在中間圈裡，等手簿跳成<b class="g">固定解 FIX</b>'
          : '用 <kbd class="cap">WASD</kbd> 把氣泡壓在中間圈裡，等手簿跳成<b class="g">固定解 FIX</b>';
    if (isMobile()) { const bk = r.querySelector('.bench-keys') as HTMLElement | null; const kt = sens ? '手機放平當圓水準器' : '按住水準器扶正桿子'; if (bk && bk.textContent !== kt) bk.textContent = kt; }
    const gfix = ui.fixText(gtxt);
    if (g.innerHTML !== gfix) g.innerHTML = gfix;
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
    (r.querySelector('.rs-rec-t') as HTMLElement).textContent = this.rec ? `記錄中 ${Math.min(3, this.rec.n + 1)} / 3` : ui.fixText('按 Space 開始記錄');
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
    this.padDetach?.(); this.padDetach = null;
    this.root?.remove(); this.root = null; this.pose = null;
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
