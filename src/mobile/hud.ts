/**
 * 手機 HUD：
 *  - 頂：目前步驟一行提示 (點開 = 外業手簿)、右邊幾個圖示鍵 (手簿、存檔、聲音)
 *  - 底：情境動作列 (放下 / 喝水 / 上車 …)，每 0.2 s 依狀態重算
 *  - 動作列的按鍵用合成 KeyboardEvent 丟給原本的 fieldDay.onKey，邏輯不重寫
 */
import * as THREE from 'three';
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import type { FollowCamera } from './camera';
import { openAudioPanel } from '../field/sound';
import { sheet, closeSheet } from './sheet';
import { quickSaveMenu } from './quicksave';
import { ITEMS } from '../field/items';
import { noteApplies, noteHtml } from './checklist';

interface Act { id: string; text: string; key?: string; accent?: boolean; minor?: boolean; on: () => void }

export class MobileHud {
  root: HTMLElement;
  private top: HTMLElement;
  private hint: HTMLElement;
  private bar: HTMLElement;
  private side: HTMLElement;
  private dial: HTMLElement;
  private dir = new THREE.Vector3();
  private t = 0;
  private sig = '';
  /** 其他模組 (開車) 要接管動作列時設定 */
  override: Act[] | null = null;
  /** 指北針點下去可以調鏡頭遠近 */
  cam: FollowCamera | null = null;

  constructor(private app: GameApp, private field: FieldDay) {
    this.root = document.createElement('div');
    this.root.className = 'm-hud';
    this.root.innerHTML = `
      <div class="m-top">
        <button type="button" class="m-hint"><span class="m-hint-no"></span><span class="m-hint-text">…</span></button>
        <div class="m-top-btns">
          <div class="m-compass" aria-label="指北針"><div class="m-compass-dial"><b class="n">北</b><b class="e">東</b><b class="s">南</b><b class="w">西</b></div><i></i></div>
          <button type="button" data-a="save" aria-label="存檔">💾</button>
          <button type="button" data-a="audio" aria-label="聲音">🔊</button>
        </div>
      </div>
      <div class="m-bar"></div>
      <div class="m-bar-side"></div>
      <div class="m-heat" aria-hidden="true"></div>`;
    document.body.appendChild(this.root);
    this.top = this.root.querySelector('.m-top') as HTMLElement;
    this.hint = this.root.querySelector('.m-hint') as HTMLElement;
    this.bar = this.root.querySelector('.m-bar') as HTMLElement;
    this.side = this.root.querySelector('.m-bar-side') as HTMLElement;
    this.dial = this.root.querySelector('.m-compass-dial') as HTMLElement;
    (this.root.querySelector('.m-compass') as HTMLElement).onclick = (e) => { e.stopPropagation(); this.zoomPanel(); };
    this.hint.onclick = () => this.openBook();
    this.root.querySelectorAll<HTMLButtonElement>('.m-top-btns button').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const a = b.dataset.a;
        if (a === 'save') quickSaveMenu(this.app, this.field);
        else if (a === 'audio') openAudioPanel();
      };
    });
  }

  /** 鏡頭遠近：拉桿或兩指捏合 */
  zoomPanel() {
    const cam = this.cam;
    if (!cam) return;
    const el = sheet('鏡頭遠近', `
      <div class="m-zoom">
        <div class="m-zoom-row"><span>遠</span><input type="range" min="9" max="32" step="0.5" value="${cam.dist}"><span>近</span></div>
        <div class="m-zoom-val"><b>${cam.dist.toFixed(0)}</b> m</div>
        <p class="m-tip">在畫面上用兩指撐開／收合也可以縮放，設定會記住。</p>
      </div>`, 'm-zoom-sheet');
    const r = el.querySelector('input') as HTMLInputElement;
    const v = el.querySelector('.m-zoom-val b') as HTMLElement;
    // 拉桿往右 = 拉近，所以用 min+max−value
    const flip = (n: number) => 41 - n;
    r.value = String(flip(cam.dist));
    r.oninput = () => { const d = flip(Number(r.value)); cam.setDist(d); v.textContent = d.toFixed(0); };
  }

  /** 外業手簿：設備清單 (格紋筆記本) ＋ 任務進度 */
  openBook() {
    const title = (document.getElementById('mission-title')?.textContent || '外業手簿');
    const list = document.getElementById('mission-task-list')?.innerHTML || '';
    const tip = document.getElementById('mission-tip-text')?.textContent || '';
    const note = noteApplies(this.field) ? noteHtml(this.field) : '';
    sheet(title, `${note}<ol class="task-list m-tasks">${list}</ol><div class="m-tip"><b>備註</b>${tip}</div>`, 'm-book');
  }

  private key(code: string) {
    const e = new KeyboardEvent('keydown', { code, key: code.replace('Key', '').toLowerCase(), bubbles: true, cancelable: true });
    if (this.app.onExtraKey?.(e)) return;
    window.dispatchEvent(e);
  }

  /** 指北針：轉盤跟著鏡頭轉，北 = 世界 −Z */
  private compass() {
    const cam = this.app.sceneManager.camera as THREE.PerspectiveCamera;
    cam.getWorldDirection(this.dir);
    const fx = this.dir.x, fz = this.dir.z;
    if (!fx && !fz) return;
    const deg = Math.atan2(-fx, -fz) * 180 / Math.PI;
    this.dial.style.setProperty('--r', `${deg.toFixed(1)}deg`);
  }

  /** 每幀 */
  update(dt: number) {
    this.compass();
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const fd = this.field;
    const active = this.app.currentLevelObj === fd && !['brief', 'done'].includes(fd.phase);
    this.root.classList.toggle('show', active);
    if (!active) return;
    // 提示列
    const tip = document.getElementById('mission-tip-text')?.textContent || '';
    const actLi = document.querySelector('#mission-task-list .task-item.active');
    const no = actLi ? (actLi.querySelector('.task-no')?.textContent || '') : '';
    const txt = actLi ? (actLi.querySelector('.task-text')?.textContent || '') : tip;
    (this.hint.querySelector('.m-hint-no') as HTMLElement).textContent = no;
    (this.hint.querySelector('.m-hint-text') as HTMLElement).textContent = txt;
    this.hint.title = tip;
    // 動作列
    const acts: Act[] = this.override || this.walkActs();
    const sig = acts.map(a => a.id + a.text).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      this.bar.innerHTML = '';
      this.side.innerHTML = '';
      acts.forEach(a => {
        const b = document.createElement('button');
        b.type = 'button';
        // 次要動作 (放下) 縮到右下角，不要跟任務指引搶注意力
        b.className = `m-act${a.accent ? ' accent' : ''}${a.minor ? ' minor' : ''}`;
        b.innerHTML = `<span>${a.text}</span>`;
        b.onclick = (e) => { e.stopPropagation(); closeSheet(); a.on(); };
        (a.minor ? this.side : this.bar).appendChild(b);
      });
    }
  }

  private walkActs(): Act[] {
    const fd = this.field;
    const out: Act[] = [];
    if (fd.inTruck) return out; // 開車由 driveTouch 接管
    const fp0 = (this.app.currentLevelObj as AnyObj)?.getFreeInteractPrompt?.() as string | null;
    // 情境動作已經是「放下○○」時就不要再給一顆小「放下」
    if (fd.carrying && !(fp0 && fp0.startsWith('放下'))) out.push({ id: 'drop', text: '放下', minor: true, on: () => this.key('KeyG') });
    // 喝水沒有常駐按鍵：點地上或後斗的礦泉水時才出現選項 (waterMenu / truckMenu)
    const sub = (fd as AnyObj).sub;
    if (sub) {
      // 第二、三天的額外動作：由各自的工作提供 (之後的里程碑)
      const extra: Act[] = (sub.mobileActs?.() || []).map((a: AnyObj) => ({ id: a.id, text: a.text, on: () => this.key(a.code) }));
      out.push(...extra);
    }
    const rp = (fd as AnyObj).events?.rescuePoint?.();
    if (rp) out.push({ id: 'rescue', text: rp.label, accent: true, on: () => (this.app.player as AnyObj).walkTo({ x: rp.x, z: rp.z, reach: rp.follow ? 1.2 : 0.2, follow: rp.follow, label: rp.label }) });
    const fp = fp0;
    if (fp) out.push({ id: 'free', text: fp, key: 'E', accent: true, on: () => (this.app.currentLevelObj as AnyObj).onFreeInteract?.() });
    return out;
  }

  /** 顯示「前往…」提示用 */
  get topEl() { return this.top; }
}
