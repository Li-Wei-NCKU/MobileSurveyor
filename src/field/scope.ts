/**
 * 電子水準儀望遠鏡視野：鏡頭換到望遠鏡物鏡前，32 倍 (視角約 1.4°)。
 * A/D 水平微動、Q/E 調焦，對準條碼尺後按 Enter 自動量測 (讀數與視距)。
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from './legacy';
import { audio } from './legacy';

export interface ScopeOpts {
  head: THREE.Object3D;        // 水準儀頭 (望遠鏡沿 +Z，光軸高 0.074)
  title: string;               // 例如「第 1 站　後視 BM-1035」
  targetDist: number;          // 到標尺的距離 (算對焦)
  focus: number;               // 目前對焦距離 (沿用上次)
  tilted: () => boolean;       // 標尺目前有沒有歪
  onFixTilt: () => void;       // 用對講機叫學弟扶直
  /** 按量測：回傳成功與否和顯示文字 (blur = 目前模糊程度 px，aim = 視線與標尺的水平夾角 rad) */
  measure: (blur: number) => { ok: boolean; text: string };
  onClose: (focus: number) => void;
  /** 測試工具：正確讀數 */
  truth?: () => number;
  /** 地面震動程度 0~1 (大車經過)：畫面會抖、補償器擺動 */
  vibe?: () => number;
}

const FOV = 1.4;

function el(cls: string, html = ''): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  e.innerHTML = html;
  return e;
}

class LevelScope {
  active = false;
  private app!: GameApp;
  private o!: ScopeOpts;
  private root: HTMLDivElement | null = null;
  private savedCtl: ((dt: number) => void) | null = null;
  private savedFov = 65;
  private focus = 10;
  private keys = { l: false, r: false, fast: false };
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onKeyUp: ((e: KeyboardEvent) => void) | null = null;
  private onResize: (() => void) | null = null;
  private done = false;

  open(app: GameApp, o: ScopeOpts) {
    if (this.active) this.close();
    this.app = app; this.o = o; this.active = true; this.done = false;
    this.focus = o.focus;
    const p = app.player as AnyObj;
    const cam = app.sceneManager.camera;
    if (document.exitPointerLock) document.exitPointerLock();
    document.body.classList.add('bench-active', 'scope-active');
    p.hidePrompt?.();
    this.savedCtl = p.externalControl;
    this.savedFov = cam.fov;
    p.externalControl = (dt: number) => this.tick(dt);

    this.root = el('scope');
    this.root.innerHTML = `
      <svg class="scope-ret" aria-hidden="true"></svg>
      <div class="scope-mask"></div>
      <div class="scope-focus"><span>調焦</span><div class="sf-bar"><i></i></div></div>
      <div class="scope-tilt" hidden>標尺沒扶直！<kbd class="cap">Y</kbd> 用對講機叫學弟扶好</div>
      <div class="scope-vibe" hidden>⚠ 地面震動中：補償器擺動，影像一直跳</div>
      <div class="bench-card paper scope-card">
        <div class="bench-head"><h3>${o.title}</h3><span class="bench-keys"><kbd class="cap">A</kbd><kbd class="cap">D</kbd> 轉動　<kbd class="cap">Q</kbd><kbd class="cap">E</kbd> 調焦　<kbd class="cap cap-wide">Esc</kbd> 離開</span></div>
        <div class="bench-body">
          <p>電子水準儀會自己讀條碼。把<strong>豎絲對準標尺</strong>、<strong>調焦到清楚</strong>，按 <kbd class="cap cap-wide">Enter</kbd> 量測。</p>
          <div class="dl-screen"><span class="dl-label">DNA 03</span><span class="dl-val">— — —</span></div>
          <p class="bench-fb" aria-live="polite"></p>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.drawReticle();

    this.onKeyDown = (e: KeyboardEvent) => this.key(e, true);
    this.onKeyUp = (e: KeyboardEvent) => this.key(e, false);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.onResize = () => this.drawReticle();
    window.addEventListener('resize', this.onResize);
    audio()?.playClick?.();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    const p = this.app.player as AnyObj;
    const cam = this.app.sceneManager.camera;
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown, true);
    if (this.onKeyUp) window.removeEventListener('keyup', this.onKeyUp, true);
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    this.root?.remove(); this.root = null;
    document.body.classList.remove('bench-active', 'scope-active');
    this.app.sceneManager.renderer.domElement.style.filter = '';
    p.externalControl = this.savedCtl;
    cam.clearViewOffset();
    cam.fov = this.savedFov;
    cam.updateProjectionMatrix();
    cam.position.copy(p.position);
    cam.quaternion.setFromEuler(p.euler);
    try { (this.app.sceneManager.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 需要使用者手勢 */ }
    this.o.onClose(this.focus);
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (document.querySelector('.field-modal')) return;
    const c = e.code;
    const ctl = ['KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyY', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Escape', 'Enter', 'NumpadEnter'];
    e.preventDefault();
    if (!ctl.includes(c)) { e.stopPropagation(); return; }
    e.stopPropagation();
    if (c === 'KeyA' || c === 'ArrowLeft') this.keys.l = down;
    if (c === 'KeyD' || c === 'ArrowRight') this.keys.r = down;
    if (c === 'ShiftLeft' || c === 'ShiftRight') this.keys.fast = down;
    if (!down) return;
    if (c === 'KeyQ') { this.focus = Math.max(2, this.focus * 0.9); audio()?.playScrewRotate?.(); }
    if (c === 'KeyE') { this.focus = Math.min(80, this.focus / 0.9); audio()?.playScrewRotate?.(); }
    if (c === 'KeyY' && this.o.tilted()) { this.o.onFixTilt(); this.say('「好，扶直了！」', 'ok'); }
    if (c === 'Escape') this.close();
    if (c === 'Enter' || c === 'NumpadEnter') this.submit();
  }

  private say(t: string, kind: '' | 'ok' | 'bad' = '') {
    const fb = this.root?.querySelector('.bench-fb') as HTMLElement | null;
    if (fb) { fb.textContent = t; fb.className = `bench-fb ${kind}`; }
  }

  private blur = 0;
  private submit() {
    if (this.done) return;
    audio()?.playLaserBeep?.();
    const r = this.o.measure(this.blur);
    const scr = this.root?.querySelector('.dl-val') as HTMLElement | null;
    if (scr) { scr.textContent = r.text; scr.classList.toggle('err', !r.ok); }
    if (!r.ok) { this.say('量測失敗，調整後再按一次 Enter。', 'bad'); audio()?.playClick?.(); return; }
    this.done = true;
    this.say('已記錄到手簿。', 'ok');
    audio()?.playSuccessChime?.();
    setTimeout(() => { if (this.active) this.close(); }, 1300);
  }

  private tick(dt: number) {
    const head = this.o.head;
    const cam = this.app.sceneManager.camera;
    const turn = (this.keys.r ? -1 : 0) + (this.keys.l ? 1 : 0);
    if (turn) head.rotation.y += turn * dt * (this.keys.fast ? 0.12 : 0.012);
    head.updateMatrixWorld(true);
    const pos = head.localToWorld(new THREE.Vector3(0, 0.074, 0.135));
    const fwd = head.localToWorld(new THREE.Vector3(0, 0.074, 1.135)).sub(pos);
    fwd.y = 0; // 自動安平：視線水平
    fwd.normalize();
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(pos.clone().add(fwd));
    // 大車經過：影像抖動
    const v = this.o.vibe ? this.o.vibe() : 0;
    if (v > 0.02) {
      const t = performance.now() / 1000;
      cam.rotateX((Math.sin(t * 37) + Math.sin(t * 23.3) * 0.6) * 0.0011 * v);
      cam.rotateY(Math.sin(t * 29.1) * 0.0005 * v);
    }
    const vb = this.root?.querySelector('.scope-vibe') as HTMLElement | null;
    if (vb) vb.hidden = v < 0.12;
    if (cam.fov !== FOV) { cam.fov = FOV; cam.updateProjectionMatrix(); }
    // 對焦：與目標距離不符就模糊
    const blur = Math.min(7, Math.abs(1 / this.focus - 1 / this.o.targetDist) * 55);
    this.blur = blur;
    this.app.sceneManager.renderer.domElement.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : '';
    const bar = this.root?.querySelector('.sf-bar i') as HTMLElement | null;
    if (bar) bar.style.top = `${Math.max(0, Math.min(100, (Math.log(this.focus / 2) / Math.log(40)) * 100))}%`;
    const dbg = (window as AnyObj).__ksDebug;
    let tr = this.root?.querySelector('.scope-truth') as HTMLElement | null;
    if (dbg?.truth && this.o.truth) {
      if (!tr && this.root) { tr = el('scope-truth'); this.root.appendChild(tr); }
      if (tr) tr.textContent = `（測試）正確讀數 ${this.o.truth().toFixed(4)} m`;
    } else tr?.remove();
    const tilt = this.root?.querySelector('.scope-tilt') as HTMLElement | null;
    if (tilt) tilt.hidden = !this.o.tilted();
  }

  /** 十字絲：中絲 + 豎絲 + 上下視距絲 (±0.005 rad) */
  private drawReticle() {
    const svg = this.root?.querySelector('.scope-ret') as SVGSVGElement | null;
    if (!svg) return;
    const W = innerWidth, H = innerHeight;
    const R = Math.min(W, H) * 0.44;
    const cx = W / 2, cy = H * 0.46;
    const half = Math.tan((FOV / 2) * Math.PI / 180);
    const st = (0.005 / half) * (H / 2);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `
      <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" class="sr-main"/>
      <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" class="sr-main"/>
      <line x1="${cx - R * 0.22}" y1="${cy - st}" x2="${cx + R * 0.22}" y2="${cy - st}" class="sr-stadia"/>
      <line x1="${cx - R * 0.22}" y1="${cy + st}" x2="${cx + R * 0.22}" y2="${cy + st}" class="sr-stadia"/>`;
    const mask = this.root?.querySelector('.scope-mask') as HTMLElement | null;
    if (mask) mask.style.background = `radial-gradient(circle ${R}px at ${cx}px ${cy}px, transparent 0 ${R - 2}px, #050608 ${R + 1}px)`;
    // 望遠鏡畫面中心不在螢幕正中：讓相機視角對齊十字絲
    this.app.sceneManager.camera.setViewOffset(W, H, 0, H / 2 - cy, W, H);
  }
}

export const levelScope = new LevelScope();
