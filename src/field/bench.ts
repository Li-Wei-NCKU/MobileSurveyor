/**
 * 儀器近距離操作 (取代舊版彈出視窗)
 * 按 E 之後鏡頭推近到儀器，直接操作 3D 模型：
 *   - tribrach  基座定心定平：轉三支腳螺旋、平移基座；畫面右側有「光學對點器」與「圓水準器」兩個即時 3D 小視窗
 *   - tape      量天線斜高：鋼捲尺真的從標石拉到量高缺口，滾輪放大自己判讀
 *   - controller 手簿：手簿螢幕是 3D 場景裡的即時畫面
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';
import { audio } from './legacy';
import * as ui from './ui';

type Mode = 'tribrach' | 'tape' | 'controller';

/** 舊版對心座標 (單位約 ±0.8) → 公尺 */
const SHIFT_SCALE = 0.02;
/** 光學對點器視窗：相機離標石的高度 / 視野半徑 (公尺) */
const PLUMMET_H = 0.6;
const PLUMMET_R = 0.0156;

interface Pip { cam: THREE.PerspectiveCamera; el: HTMLElement }

/** 給其他工作 (例如水準) 借用基座定平畫面 */
export interface BenchOpts {
  /** 不需要對點 (水準儀只要定平) */
  noPlummet?: boolean;
  /** 鎖定後呼叫 (取代 GNSS 的步驟推進) */
  onDone?: () => void;
  /** 畫小視窗時暫時隱藏的物件 (例如擋住水準器的儀器本體) */
  pipHide?: THREE.Object3D[];
  title?: string;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

class InstrumentBench {
  mode: Mode | null = null;
  private app!: GameApp;
  private g: AnyObj = null;
  private tripod: THREE.Object3D | null = null;

  // 鏡頭
  private camPos = V();
  private camLook = V();
  private camUp = V(0, 1, 0);
  private fromPos = V();
  private fromQuat = new THREE.Quaternion();
  private toQuat = new THREE.Quaternion();
  private t = 0;
  private fov = 30;
  private fromFov = 65;
  private savedFov = 65;
  private savedCtl: ((dt: number) => void) | null = null;

  // DOM
  private root: HTMLElement | null = null;
  private pips: Pip[] = [];
  private labels: { el: HTMLElement; obj: THREE.Object3D; off: THREE.Vector3 }[] = [];
  private onKey: ((e: KeyboardEvent) => void) | null = null;
  private onWheel: ((e: WheelEvent) => void) | null = null;

  // tribrach
  private confirmWarned = false;
  private markDecal: THREE.Mesh | null = null;
  private plummetCam = new THREE.PerspectiveCamera(2 * Math.atan(PLUMMET_R / PLUMMET_H) * 180 / Math.PI, 1, 0.1, 3);
  private vialCam = new THREE.PerspectiveCamera(46, 1, 0.003, 1);

  // tape
  private tape: THREE.Group | null = null;
  private tapeDone = false;

  // controller
  private scr: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mesh: THREE.Mesh } | null = null;
  private rec = { on: false, done: false, t: 0, beep: 0, draw: 0 };

  install(app: GameApp) {
    this.app = app;
    const sm = app.sceneManager;
    const orig = sm.render.bind(sm);
    sm.render = () => { orig(); this.renderPips(); };

    // 舊版的三個彈出視窗改走 3D 近距離操作
    const P = (window as AnyObj).LevelGNSS.prototype;
    const bench = this;
    P.openTribrachModal = function () { bench.enter('tribrach', this); };
    P.openTapeMeasureModal = function () { bench.enter('tape', this); };
    P.openGNSSControllerModal = function () { bench.enter('controller', this); };
    const start = P.start;
    P.start = function (...a: unknown[]) { bench.exit(false); return start.apply(this, a); };
    const stop = P.stop;
    P.stop = function (...a: unknown[]) { bench.exit(false); return stop ? stop.apply(this, a) : undefined; };

    // 近距離操作時，舊版玩家控制視同開著視窗 (不走動、不轉視角)
    const pl = app.player as AnyObj;
    const isOpen = pl.isModalOpen.bind(pl);
    pl.isModalOpen = () => isOpen() || document.body.classList.contains('bench-active') || document.body.classList.contains('cine-active');
  }

  // ================================================================
  // 進入 / 離開
  // ================================================================
  private opts: BenchOpts = {};

  enter(mode: Mode, g: AnyObj, opts: BenchOpts = {}) {
    this.opts = opts;
    if (this.mode) this.exit(false);
    const tripod = g.tripodMesh as THREE.Object3D | null;
    if (!tripod) return;
    this.mode = mode;
    this.g = g;
    this.tripod = tripod;
    const p = this.app.player;
    const cam = this.app.sceneManager.camera;
    if (document.exitPointerLock) document.exitPointerLock();
    document.body.classList.add('bench-active');
    p.hidePrompt?.();

    this.savedCtl = p.externalControl;
    p.externalControl = (dt: number) => this.update(dt);
    this.savedFov = cam.fov;
    this.fromFov = cam.fov;
    this.fromPos.copy(cam.position);
    this.fromQuat.copy(cam.quaternion);
    this.t = 0;
    this.camUp.set(0, 1, 0);
    this.tripod.updateMatrixWorld(true);

    this.root = el('div', 'bench');
    this.root.id = 'bench';
    document.body.appendChild(this.root);

    if (mode === 'tribrach') this.setupTribrach();
    else if (mode === 'tape') this.setupTape();
    else this.setupController();

    const m = new THREE.Matrix4().lookAt(this.camPos, this.camLook, this.camUp);
    this.toQuat.setFromRotationMatrix(m);

    this.onKey = (e: KeyboardEvent) => this.key(e);
    window.addEventListener('keydown', this.onKey, true);
    this.onWheel = (e: WheelEvent) => {
      if (this.mode !== 'tape') return;
      e.preventDefault();
      this.fov = THREE.MathUtils.clamp(this.fov * (e.deltaY > 0 ? 1.12 : 1 / 1.12), 5, 34);
    };
    window.addEventListener('wheel', this.onWheel, { passive: false });
  }

  exit(relock = true) {
    if (!this.mode) return;
    const p = this.app.player;
    const cam = this.app.sceneManager.camera;
    if (this.onKey) window.removeEventListener('keydown', this.onKey, true);
    if (this.onWheel) window.removeEventListener('wheel', this.onWheel);
    this.onKey = null; this.onWheel = null;
    this.root?.remove();
    this.root = null;
    this.pips = [];
    this.labels = [];
    if (this.tape) { this.tape.parent?.remove(this.tape); this.tape = null; }
    this.rec.on = false;
    document.body.classList.remove('bench-active');
    p.externalControl = this.savedCtl;
    this.savedCtl = null;
    cam.fov = this.savedFov;
    cam.updateProjectionMatrix();
    cam.position.copy(p.position);
    cam.quaternion.setFromEuler(p.euler);
    this.mode = null;
    if (relock) {
      const c = this.app.sceneManager.renderer.domElement;
      try { (c.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需使用者手勢，失敗就讓玩家點畫面 */ }
    }
  }

  // ================================================================
  // 每幀
  // ================================================================
  private update(dt: number) {
    const cam = this.app.sceneManager.camera;
    this.t = Math.min(1, this.t + dt / 0.55);
    const e = this.t * this.t * (3 - 2 * this.t);
    cam.position.lerpVectors(this.fromPos, this.camPos, e);
    cam.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, e);
    const fov = this.fromFov + (this.fov - this.fromFov) * e;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    if (this.mode === 'tribrach') this.tickTribrach();
    else if (this.mode === 'controller') this.tickController(dt);
    this.placeLabels();
  }

  private placeLabels() {
    const cam = this.app.sceneManager.camera;
    const v = V();
    this.labels.forEach(l => {
      l.obj.getWorldPosition(v).add(l.off);
      v.project(cam);
      const show = this.t > 0.85 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      l.el.style.display = show ? '' : 'none';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -50%)`;
    });
  }

  /** 在主畫面之後，把小視窗 (對點器、水準器) 用第二支相機畫上去 */
  private renderPips() {
    if (!this.mode || !this.pips.length || this.t < 0.6) return;
    const r = this.app.sceneManager.renderer;
    const scene = this.app.sceneManager.scene;
    const c = r.domElement.getBoundingClientRect();
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setScissorTest(true);
    const hidden = (this.opts.pipHide || []).filter(o => o.visible);
    hidden.forEach(o => { o.visible = false; });
    this.pips.forEach(p => {
      const b = p.el.getBoundingClientRect();
      if (b.width < 4) return;
      const x = b.left - c.left, y = c.height - (b.bottom - c.top);
      r.setScissor(x, y, b.width, b.height);
      r.setViewport(x, y, b.width, b.height);
      p.cam.aspect = b.width / b.height;
      p.cam.updateProjectionMatrix();
      r.render(scene, p.cam);
    });
    hidden.forEach(o => { o.visible = true; });
    r.setScissorTest(false);
    r.setViewport(0, 0, c.width, c.height);
    r.shadowMap.autoUpdate = auto;
  }

  private key(e: KeyboardEvent) {
    if (document.querySelector('.field-modal')) return; // 路人對話等視窗優先
    const inInput = (e.target as HTMLElement)?.tagName === 'INPUT';
    if (!inInput) e.stopPropagation();
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.mode === 'controller' && this.rec.on) { ui.toast('觀測中，先別動手簿。', 'warn', 1800); return; }
      this.exit(true);
      return;
    }
    if (this.mode === 'tribrach') this.keyTribrach(e);
    else if (this.mode === 'tape') { if (e.key === 'Enter') { e.preventDefault(); this.submitTape(); } }
    else if (this.mode === 'controller') {
      if ((e.key === 'Enter' || e.code === 'Space') && !this.rec.on && !this.rec.done) { e.preventDefault(); this.startRecording(); }
    }
  }

  private card(title: string, body: string, keys: string) {
    const c = el('div', 'bench-card paper', `
      <div class="bench-head"><h3>${title}</h3><span class="bench-keys">${keys}</span></div>
      <div class="bench-body">${body}</div>`);
    this.root!.appendChild(c);
    return c;
  }

  private markWorld(): THREE.Vector3 {
    const t = this.tripod!;
    const sm = this.app.sceneManager;
    let best: THREE.Object3D | null = null, bd = Infinity;
    sm.interactiveObjects.forEach(o => {
      if (o.userData?.type !== 'monument') return;
      const d = Math.hypot(o.position.x - t.position.x, o.position.z - t.position.z);
      if (d < bd) { bd = d; best = o; }
    });
    const m = best as THREE.Object3D | null;
    if (!m || bd > 1) return V(t.position.x, sm.heightAt(t.position.x, t.position.z), t.position.z);
    const p = V(m.position.x, m.position.y + 0.28, m.position.z);
    if (!this.markDecal || this.markDecal.parent !== sm.scene) this.markDecal = this.makeMarkDecal(p);
    return p;
  }

  /** 標石中心的細部刻劃 (光學對點器放大後才看得清楚) */
  private makeMarkDecal(p: THREE.Vector3): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(230, 220, 10, 256, 256, 256);
    g.addColorStop(0, '#f0cf7a'); g.addColorStop(1, '#b08530');
    x.fillStyle = g; x.beginPath(); x.arc(256, 256, 256, 0, Math.PI * 2); x.fill();
    // 細刮痕
    for (let i = 0; i < 160; i++) {
      x.strokeStyle = `rgba(90,60,10,${0.05 + Math.random() * 0.08})`;
      x.lineWidth = 1;
      const a = Math.random() * Math.PI, r = Math.random() * 240;
      x.beginPath(); x.moveTo(256 + Math.cos(a) * r - 30, 256 + Math.sin(a) * r); x.lineTo(256 + Math.cos(a) * r + 30, 256 + Math.sin(a) * r + 4); x.stroke();
    }
    x.strokeStyle = 'rgba(60,38,8,.85)';
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(256, 206); x.lineTo(256, 306); x.moveTo(206, 256); x.lineTo(306, 256); x.stroke();
    x.fillStyle = '#1b1206';
    x.beginPath(); x.arc(256, 256, 11, 0, Math.PI * 2); x.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.02, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(p).y += 0.0004;
    m.receiveShadow = true;
    this.app.sceneManager.scene.add(m);
    return m;
  }

  // ================================================================
  // 1. 基座定心定平
  // ================================================================
  private setupTribrach() {
    const g = this.g;
    g.recalculateTribrachPhysics?.();
    this.confirmWarned = false;
    this.applyTribrachPose();
    const T = this.tripod!.localToWorld(V(0, 1.3, 0));
    this.camPos.copy(T).add(V(0.03, 0.22, 0.5));
    this.camLook.copy(T).add(V(0, -0.035, 0));
    this.fov = 30;

    // 小視窗：光學對點器 + 圓水準器
    const side = el('div', 'bench-side');
    const np = !!this.opts.noPlummet;
    side.innerHTML = (np ? '' : `
      <figure class="bench-pip-wrap"><div class="bench-pip pip-plummet"><svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="6.4" class="ret-tol"/>
        <circle cx="50" cy="50" r="2.4" class="ret-c"/>
        <path d="M50 8V44M50 56V92M8 50H44M56 50H92" class="ret-x"/>
        <circle cx="50" cy="50" r="25" class="ret-r"/><circle cx="50" cy="50" r="40" class="ret-r"/>
      </svg></div><figcaption>光學對點器<span class="pip-val" data-v="center"></span><small>WASD：黑點移進紅圈</small></figcaption></figure>`) + `
      <figure class="bench-pip-wrap"><div class="bench-pip pip-vial"></div><figcaption>圓水準器<span class="pip-val" data-v="level"></span><small>1 2 3：白色氣泡進黑圈</small></figcaption></figure>`;
    this.root!.appendChild(side);
    this.pips = [
      ...(np ? [] : [{ cam: this.plummetCam, el: side.querySelector('.pip-plummet') as HTMLElement }]),
      { cam: this.vialCam, el: side.querySelector('.pip-vial') as HTMLElement },
    ];
    this.plummetCam.up.set(0, 0, -1);
    this.vialCam.up.set(0, 0, -1);

    if (np) this.card(this.opts.title || '整平儀器',
      `<p>看右邊的<strong>圓水準器</strong>：轉腳螺旋把氣泡趕進黑圈（<kbd class="cap">1</kbd><kbd class="cap">2</kbd><kbd class="cap">3</kbd> 順轉，加 <kbd class="cap cap-wide">Shift</kbd> 反轉；也可以直接點旋鈕上的數字，右鍵反轉）。</p>
       <p class="bench-note">水準儀不用對點，只要氣泡居中；自動安平補償器會把視線拉平。</p>`,
      `<kbd class="cap cap-wide">Enter</kbd> 鎖定　<kbd class="cap cap-wide">Esc</kbd> 離開`);
    else this.card('基座定心、定平',
      `<p>看右上的<strong>對點器</strong>：把標石中心的黑點移進紅圈（<kbd class="cap">W</kbd><kbd class="cap">A</kbd><kbd class="cap">S</kbd><kbd class="cap">D</kbd> 平移基座）。</p>
       <p>看右下的<strong>水準器</strong>：轉腳螺旋把氣泡趕進黑圈（<kbd class="cap">1</kbd><kbd class="cap">2</kbd><kbd class="cap">3</kbd> 順轉，加 <kbd class="cap cap-wide">Shift</kbd> 反轉；也可以直接點旋鈕上的數字，右鍵反轉）。</p>
       <p class="bench-note">轉腳螺旋會讓對點器跑掉一點，兩個要輪流修。</p>`,
      `<kbd class="cap cap-wide">Enter</kbd> 鎖定　<kbd class="cap cap-wide">Esc</kbd> 離開`);

    // 腳螺旋上的數字鈕：knobs[0]=後 (C)、[1]=左前 (A)、[2]=右前 (B)
    const knobs: THREE.Object3D[] = this.tripod!.userData.tribrach?.userData?.knobs || [];
    const map: [number, 'A' | 'B' | 'C', string][] = [[1, 'A', '1'], [2, 'B', '2'], [0, 'C', '3']];
    map.forEach(([i, s, label]) => {
      const k = knobs[i];
      if (!k) return;
      const b = el('button', 'bench-knob', label);
      b.title = `腳螺旋 ${label}：左鍵順轉、右鍵反轉`;
      b.onclick = (ev) => { ev.preventDefault(); this.screw(s, 1); };
      b.oncontextmenu = (ev) => { ev.preventDefault(); this.screw(s, -1); };
      this.root!.appendChild(b);
      this.labels.push({ el: b, obj: k, off: V(0, -0.03, 0) });
    });
  }

  private screw(s: 'A' | 'B' | 'C', d: number) {
    const g = this.g;
    if (s === 'A') g.screwA += d; else if (s === 'B') g.screwB += d; else g.screwC += d;
    audio()?.playScrewRotate?.();
    g.recalculateTribrachPhysics();
  }

  private keyTribrach(e: KeyboardEvent) {
    const g = this.g;
    const dir = e.shiftKey ? -1 : 1;
    if (e.code === 'Digit1' || e.code === 'Numpad1') this.screw('A', dir);
    else if (e.code === 'Digit2' || e.code === 'Numpad2') this.screw('B', dir);
    else if (e.code === 'Digit3' || e.code === 'Numpad3') this.screw('C', dir);
    else {
      const mv: Record<string, [number, number]> = { KeyW: [0, -0.06], ArrowUp: [0, -0.06], KeyS: [0, 0.06], ArrowDown: [0, 0.06], KeyA: [-0.06, 0], ArrowLeft: [-0.06, 0], KeyD: [0.06, 0], ArrowRight: [0.06, 0] };
      const m = this.opts.noPlummet ? undefined : mv[e.code];
      if (m) {
        e.preventDefault();
        g.shiftX += m[0]; g.shiftY += m[1];
        audio()?.playClick?.();
        g.recalculateTribrachPhysics();
      } else if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        this.confirmTribrach();
      }
    }
  }

  private confirmTribrach() {
    const g = this.g;
    if (!(g.isCentered && g.isLeveled) && !this.confirmWarned) {
      this.confirmWarned = true;
      const what = !g.isCentered && !g.isLeveled ? '對心和氣泡都' : !g.isCentered ? '對心' : '氣泡';
      ui.toast(`${what}還沒進圈。確定要這樣鎖定，再按一次 Enter。`, 'warn', 3200);
      return;
    }
    if (this.opts.onDone) {
      const done = this.opts.onDone;
      audio()?.playSuccessChime?.();
      this.exit(true);
      done();
      return;
    }
    g.finalCenteringErrorMm = parseFloat(g.currentCenterErrorMm || '0.4');
    g.finalLevelingErrorMm = parseFloat(g.currentLevelErrorMm || '0.1');
    g.currentStep = 2;
    audio()?.playSuccessChime?.();
    this.exit(true);
    this.app.updateMissionPanel(g.title, g.getTasks(), g.currentStep, `基座已鎖定（對心誤差 ${g.finalCenteringErrorMm} mm、氣泡殘差 ${g.finalLevelingErrorMm} mm）。按 E 量儀器斜高。`);
  }

  /** 依舊版的對心/定平狀態擺放 3D 基座、旋鈕、氣泡 */
  private applyTribrachPose() {
    const g = this.g, t = this.tripod!;
    const tri = t.userData.tribrach as THREE.Object3D | undefined;
    const head = t.userData.head as THREE.Object3D | undefined;
    const ox = -g.centerX * SHIFT_SCALE, oz = -g.centerY * SHIFT_SCALE;
    if (tri) {
      tri.position.set(ox, 0, oz);
      const knobs: THREE.Object3D[] = tri.userData.knobs || [];
      if (knobs[1]) knobs[1].rotation.y = -g.screwA * 0.63;
      if (knobs[2]) knobs[2].rotation.y = -g.screwB * 0.63;
      if (knobs[0]) knobs[0].rotation.y = -g.screwC * 0.63;
      const bub = tri.userData.bubble as THREE.Object3D | undefined;
      const vial = tri.userData.vial as THREE.Vector3 | undefined;
      if (bub && vial) {
        let bx = g.bubbleX, by = g.bubbleY;
        const r = Math.hypot(bx, by);
        if (r > 0.95) { bx *= 0.95 / r; by *= 0.95 / r; }
        bub.position.set(vial.x + bx * 0.0074, vial.y, vial.z + by * 0.0074);
      }
    }
    if (head) head.position.set(ox, head.position.y, oz);
  }

  private tickTribrach() {
    const g = this.g, t = this.tripod!;
    this.applyTribrachPose();
    t.updateMatrixWorld(true);
    // 對點器：視線從基座中心垂直向下
    const M = this.opts.noPlummet ? V() : this.markWorld();
    if (!this.opts.noPlummet) this.plummetCam.position.set(M.x - g.centerX * SHIFT_SCALE, M.y + PLUMMET_H, M.z - g.centerY * SHIFT_SCALE);
    if (!this.opts.noPlummet) this.plummetCam.lookAt(this.plummetCam.position.x, M.y, this.plummetCam.position.z);
    // 水準器：正上方 3.5 cm 往下看
    const tri = t.userData.tribrach as THREE.Object3D;
    const vial = tri?.userData?.vial as THREE.Vector3 | undefined;
    if (vial) {
      const w = tri.localToWorld(vial.clone());
      this.vialCam.position.set(w.x, w.y + 0.032, w.z);
      this.vialCam.lookAt(w);
    }
    // 讀數
    const cv = this.root?.querySelector('[data-v="center"]');
    const lv = this.root?.querySelector('[data-v="level"]');
    if (cv) { cv.textContent = `${g.currentCenterErrorMm} mm${g.isCentered ? ' ✓' : ''}`; cv.classList.toggle('ok', !!g.isCentered); }
    if (lv) { lv.textContent = `${g.currentLevelErrorMm} mm${g.isLeveled ? ' ✓' : ''}`; lv.classList.toggle('ok', !!g.isLeveled); }
  }

  // ================================================================
  // 2. 量天線斜高
  // ================================================================
  private setupTape() {
    const g = this.g, t = this.tripod!;
    const head = t.userData.head as THREE.Object3D;
    this.applyTribrachPose();
    t.updateMatrixWorld(true);
    const M = this.markWorld();
    const hi = (head.userData.hiMark as THREE.Vector3) || V(-0.1085, 0.112, 0);
    const N = head.localToWorld(hi.clone());
    const L = M.distanceTo(N);
    g.trueSlantHeight = Math.round(L * 10000) / 10000;
    this.tapeDone = false;

    const u = N.clone().sub(M).normalize();
    const o = V(N.x - t.position.x, 0, N.z - t.position.z).normalize();
    const n = o.clone().addScaledVector(u, -o.dot(u)).normalize();
    const w = u.clone().cross(n).normalize();
    this.tape = this.buildTape(M, u, n, w, L);
    this.app.sceneManager.scene.add(this.tape);

    this.camPos.copy(N).addScaledVector(n, 0.12).addScaledVector(u, -0.004);
    this.camLook.copy(N).addScaledVector(u, -0.004);
    this.camUp.copy(u);
    this.fov = 20;

    const c = this.card('量天線斜高',
      `<p>鋼捲尺的零點壓在標石中心，往上拉到天線的<strong>黃色量高缺口</strong>。讀<strong>紅色基準線</strong>壓到的刻度，估讀到 0.1 mm。</p>
       <p class="bench-note">滾輪可以放大。最小刻度是 1 mm，長刻度是 5 mm，數字是公分。</p>
       <label class="bench-input">斜高 <input type="text" inputmode="decimal" autocomplete="off" placeholder="1.xxxx"> m</label>
       <p class="bench-fb" aria-live="polite"></p>`,
      `<kbd class="cap cap-wide">Enter</kbd> 記錄　<kbd class="cap cap-wide">Esc</kbd> 離開`);
    const inp = c.querySelector('input') as HTMLInputElement;
    setTimeout(() => inp.focus(), 600);
    const lab = el('div', 'bench-tag', '量高缺口（紅線）');
    this.root!.appendChild(lab);
    const anchor = new THREE.Object3D();
    anchor.position.copy(N);
    this.labels.push({ el: lab, obj: anchor, off: w.clone().multiplyScalar(-0.014).addScaledVector(u, 0.005) });
  }

  private buildTape(M: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, w: THREE.Vector3, L: number): THREE.Group {
    const grp = new THREE.Group();
    const half = 0.009;
    const strip = (s0: number, s1: number, tex: THREE.Texture) => {
      const pos: number[] = [];
      const P = (s: number, side: number) => M.clone().addScaledVector(u, s).addScaledVector(w, side * half).addScaledVector(n, 0.0012);
      [P(s0, -1), P(s0, 1), P(s1, -1), P(s1, 1)].forEach(p => pos.push(p.x, p.y, p.z));
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
      geo.setIndex([0, 1, 2, 1, 3, 2]);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }));
      m.receiveShadow = true;
      grp.add(m);
    };
    const mkTex = (cw: number, ch: number, s0: number, s1: number, fine: boolean) => {
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const x = c.getContext('2d')!;
      x.fillStyle = '#f2c417'; x.fillRect(0, 0, cw, ch);
      const pxPerMm = ch / ((s1 - s0) * 1000);
      x.fillStyle = '#111';
      for (let mm = Math.ceil(s0 * 1000); mm <= Math.floor(s1 * 1000); mm++) {
        const y = ch - (mm / 1000 - s0) * 1000 * pxPerMm;
        const cm = mm % 10 === 0, five = mm % 5 === 0;
        if (!fine && !cm) continue;
        const len = cm ? cw * 0.5 : five ? cw * 0.34 : cw * 0.2;
        const th = fine ? (cm ? 3.2 : five ? 2.4 : 1.6) : 1.5;
        x.fillRect(0, y - th / 2, len, th);
        if (cm && (fine || mm % 100 === 0)) {
          x.fillStyle = mm % 100 === 0 ? '#c1121f' : '#111';
          x.font = `bold ${fine ? Math.round(cw * 0.22) : 18}px "Noto Sans TC", sans-serif`;
          x.textAlign = 'right'; x.textBaseline = 'middle';
          x.fillText(String(mm / 10), cw - 8, y - (fine ? pxPerMm * 2.4 : 0));
          x.fillStyle = '#111';
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    const sSplit = L - 0.05;
    strip(0, sSplit, mkTex(64, 2048, 0, sSplit, false));
    strip(sSplit, L + 0.006, mkTex(460, 2048, sSplit, L + 0.006, true));
    // 紅色基準線 (橫跨捲尺)
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.00035, 0.0004), new THREE.MeshBasicMaterial({ color: 0xe11d48 }));
    line.position.copy(M).addScaledVector(u, L).addScaledVector(n, 0.0022);
    line.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(w, u, n));
    grp.add(line);
    // 頂端掛鉤 (勾在量高缺口上)
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.003, 0.004), new THREE.MeshStandardMaterial({ color: 0x9aa1a9, metalness: 0.8, roughness: 0.3 }));
    hook.position.copy(M).addScaledVector(u, L + 0.0065).addScaledVector(n, -0.0005);
    hook.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(w, u, n));
    grp.add(hook);
    // 捲尺盒放在腳邊
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.035), new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.5 }));
    box.position.copy(M).addScaledVector(n, 0.06).add(V(0, -0.24, 0));
    box.castShadow = true;
    grp.add(box);
    return grp;
  }

  private submitTape() {
    if (this.tapeDone) return;
    const g = this.g;
    const inp = this.root?.querySelector('.bench-input input') as HTMLInputElement | null;
    const fb = this.root?.querySelector('.bench-fb') as HTMLElement | null;
    const v = parseFloat(inp?.value || '');
    if (isNaN(v) || v < 1.0 || v > 2.5) {
      if (fb) { fb.textContent = '請輸入公尺數，估讀到小數點後四位，例如 1.2345。'; fb.className = 'bench-fb bad'; }
      return;
    }
    this.tapeDone = true;
    g.playerInputSlantHeight = v;
    g.tapeReadingErrorMm = parseFloat((Math.abs(v - g.trueSlantHeight) * 1000).toFixed(2));
    g.slantHeightMeasured = true;
    const hv = Math.sqrt(Math.max(0, v * v - 0.14 * 0.14)).toFixed(4);
    if (fb) { fb.textContent = `已記錄 ${v.toFixed(4)} m（垂直高 ${hv} m）`; fb.className = 'bench-fb ok'; }
    audio()?.playSuccessChime?.();
    setTimeout(() => {
      if (this.mode !== 'tape') return;
      g.currentStep = 3;
      this.exit(true);
      this.app.updateMissionPanel(g.title, g.getTasks(), g.currentStep, `斜高 ${v.toFixed(4)} m 已記錄。按 E 操作手簿開始靜態觀測。`);
    }, 900);
  }

  // ================================================================
  // 3. 手簿靜態觀測
  // ================================================================
  private setupController() {
    const t = this.tripod!;
    if (t.userData.accessories) t.userData.accessories.visible = true;
    t.updateMatrixWorld(true);
    const mesh = t.userData.accessories?.userData?.ctrlScreen as THREE.Mesh | undefined;
    this.rec = { on: false, done: false, t: 0, beep: 0, draw: 0 };
    this.g.epochsRecorded = 0;
    if (mesh) {
      if (!this.scr || this.scr.mesh !== mesh) {
        const canvas = document.createElement('canvas');
        canvas.width = 280; canvas.height = 480;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        (mesh.material as THREE.MeshBasicMaterial).map = tex;
        (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
        this.scr = { canvas, tex, mesh };
      }
      this.drawScreen();
      const S = mesh.getWorldPosition(V());
      const nrm = V(0, 0, 1).transformDirection(mesh.matrixWorld);
      const up = V(0, 1, 0).transformDirection(mesh.matrixWorld);
      this.camPos.copy(S).addScaledVector(nrm, 0.34).addScaledVector(up, -0.012);
      this.camLook.copy(S).addScaledVector(up, -0.012);
    } else {
      const T = t.localToWorld(V(0, 1.0, 0));
      this.camPos.copy(T).add(V(0, 0.2, 0.5));
      this.camLook.copy(T);
    }
    this.fov = 34;
    this.card('手簿：靜態觀測',
      `<p>點名、天線高都輸入好了。按 <kbd class="cap cap-wide">Enter</kbd> 開始記錄，記滿歷元前別碰腳架。</p>`,
      `<kbd class="cap cap-wide">Enter</kbd> 開始　<kbd class="cap cap-wide">Esc</kbd> 離開`);
  }

  private startRecording() {
    this.rec.on = true;
    this.rec.t = 0;
    audio()?.playClick?.();
    const body = this.root?.querySelector('.bench-body');
    if (body) body.innerHTML = '<p>記錄中……接收儀正在收衛星訊號。這段時間腳架被碰到就要重來。</p>';
    const keys = this.root?.querySelector('.bench-keys');
    if (keys) keys.innerHTML = '觀測中';
  }

  private tickController(dt: number) {
    const g = this.g;
    if (this.rec.on) {
      this.rec.t += dt;
      g.epochsRecorded = Math.min(g.targetEpochs, Math.round(g.targetEpochs * this.rec.t / 5));
      this.rec.beep += dt;
      if (this.rec.beep > 0.35) { this.rec.beep = 0; audio()?.playLaserBeep?.(); }
      if (g.epochsRecorded >= g.targetEpochs) {
        this.rec.on = false;
        this.rec.done = true;
        audio()?.playSuccessChime?.();
        this.drawScreen();
        setTimeout(() => {
          if (this.mode !== 'controller') return;
          this.exit(false);
          g.finishLevel();
        }, 1300);
      }
    }
    this.rec.draw += dt;
    if (this.rec.draw > 0.07) { this.rec.draw = 0; this.drawScreen(); }
  }

  private drawScreen() {
    if (!this.scr) return;
    const g = this.g;
    const c = this.scr.canvas.getContext('2d')!;
    const W = this.scr.canvas.width, H = this.scr.canvas.height;
    const font = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';
    c.fillStyle = '#0b1220'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#16325c'; c.fillRect(0, 0, W, 40);
    c.fillStyle = '#e2e8f0'; c.font = `bold 20px ${font}`; c.textBaseline = 'middle';
    c.fillText('靜態觀測', 12, 21);
    const st = this.rec.done ? ['完成', '#22c55e'] : this.rec.on ? ['● 記錄中', '#f43f5e'] : ['待命', '#94a3b8'];
    c.fillStyle = st[1]; c.textAlign = 'right'; c.fillText(st[0], W - 12, 21); c.textAlign = 'left';
    // 天空圖
    const cx = W / 2, cy = 140, R = 82;
    c.strokeStyle = '#2b4c7e'; c.lineWidth = 1.5;
    [R, R * 0.66, R * 0.33].forEach(r => { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); });
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
    c.fillStyle = '#64748b'; c.font = `12px ${font}`; c.fillText('N', cx - 4, cy - R - 8);
    const now = performance.now() / 1000;
    const sats: [number, number, string][] = [[0.3, 0.7, '#22c55e'], [1.4, 0.5, '#22c55e'], [2.2, 0.85, '#38bdf8'], [3.1, 0.35, '#22c55e'], [3.9, 0.6, '#eab308'], [4.6, 0.75, '#22c55e'], [5.4, 0.25, '#38bdf8'], [6.0, 0.9, '#a78bfa'], [2.7, 0.55, '#22c55e']];
    sats.forEach(([a, r, col], i) => {
      const aa = a + now * 0.004 * (i % 2 ? 1 : -1);
      c.fillStyle = col;
      c.beginPath(); c.arc(cx + Math.sin(aa) * R * r, cy - Math.cos(aa) * R * r, 5, 0, Math.PI * 2); c.fill();
    });
    // 數據
    const rows: [string, string][] = [
      ['點名', 'CKSV'],
      ['天線高', g.playerInputSlantHeight ? `${Number(g.playerInputSlantHeight).toFixed(4)} m 斜高` : '—'],
      ['衛星', this.rec.on || this.rec.done ? '19' : '18'],
      ['PDOP', this.rec.on ? (1.23 + Math.random() * 0.07).toFixed(2) : '1.28'],
      ['HRMS', this.rec.on ? `${(0.002 + Math.random() * 0.002).toFixed(3)} m` : '—'],
    ];
    c.font = `16px ${font}`;
    rows.forEach(([k, v], i) => {
      const y = 242 + i * 26;
      c.fillStyle = '#94a3b8'; c.fillText(k, 14, y);
      c.fillStyle = '#e2e8f0'; c.textAlign = 'right'; c.fillText(v, W - 14, y); c.textAlign = 'left';
    });
    // 進度
    const pct = (g.epochsRecorded || 0) / g.targetEpochs;
    c.fillStyle = '#1e293b'; c.fillRect(14, 380, W - 28, 14);
    c.fillStyle = this.rec.done ? '#22c55e' : '#38bdf8'; c.fillRect(14, 380, (W - 28) * pct, 14);
    c.fillStyle = '#cbd5e1'; c.font = `bold 15px ${font}`;
    c.fillText(`${g.epochsRecorded || 0} / ${g.targetEpochs} 歷元`, 14, 408);
    c.textAlign = 'center';
    c.fillStyle = this.rec.done ? '#22c55e' : this.rec.on ? '#94a3b8' : '#facc15';
    c.font = `bold 17px ${font}`;
    c.fillText(this.rec.done ? 'RINEX 已儲存' : this.rec.on ? '別碰腳架…' : '按 Enter 開始記錄', W / 2, 395 - 0 + 40);
    c.textAlign = 'left';
    this.scr.tex.needsUpdate = true;
  }
}

export const bench = new InstrumentBench();
(window as AnyObj).__bench = bench;
