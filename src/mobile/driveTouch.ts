/**
 * 開車觸控：左下方向盤滑桿 (放手回正)、右下油門 / 煞車倒車、下車、收音機。
 * 車輛物理、碰撞、喇叭、路中停車計分都在 fieldDay.driveTick / truck.ts，沒有改。
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import type { MobilePlayer } from './player';
import type { MobileHud } from './hud';
import { sheet, closeSheet } from './sheet';

export class DriveTouch {
  root: HTMLElement;
  private wheel: HTMLElement;
  private knob: HTMLElement;
  private wheelId: number | null = null;
  private wheelX0 = 0;
  private shown = false;

  constructor(private app: GameApp, private field: FieldDay, private player: MobilePlayer, private hud: MobileHud) {
    this.root = document.createElement('div');
    this.root.className = 'm-drive';
    this.root.innerHTML = `
      <div class="m-wheel"><div class="m-wheel-track"><div class="m-wheel-knob"></div></div><div class="m-wheel-label">方向盤</div></div>
      <div class="m-pedals">
        <button type="button" class="m-pedal m-gas"><span>油門</span></button>
        <button type="button" class="m-pedal m-brake"><span>煞車／倒車</span></button>
      </div>
      <div class="m-drive-top">
        <button type="button" class="m-dbtn" data-a="exit">下車</button>
        <button type="button" class="m-dbtn" data-a="radio">收音機</button>
      </div>`;
    document.body.appendChild(this.root);
    this.wheel = this.root.querySelector('.m-wheel-track') as HTMLElement;
    this.knob = this.root.querySelector('.m-wheel-knob') as HTMLElement;
    const ax = this.player.axes;
    // 方向盤
    this.wheel.addEventListener('pointerdown', (e) => { this.wheelId = e.pointerId; this.wheelX0 = e.clientX - ax.steer * this.halfW(); this.wheel.setPointerCapture(e.pointerId); e.preventDefault(); });
    this.wheel.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.wheelId) return;
      const v = Math.max(-1, Math.min(1, (e.clientX - this.wheelX0) / this.halfW()));
      ax.steer = -v; // 往右拖 = 右轉 (steer 正值是左轉)
      this.knob.style.transform = `translateX(${v * this.halfW()}px)`;
    });
    const release = (e: PointerEvent) => { if (e.pointerId !== this.wheelId) return; this.wheelId = null; ax.steer = 0; this.knob.style.transform = ''; };
    this.wheel.addEventListener('pointerup', release);
    this.wheel.addEventListener('pointercancel', release);
    // 踏板 (按住)
    const hold = (el: HTMLElement, on: () => void, off: () => void) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('on'); on(); });
      const up = () => { el.classList.remove('on'); off(); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    };
    hold(this.root.querySelector('.m-gas') as HTMLElement, () => { ax.throttle = 1; }, () => { if (ax.throttle > 0) ax.throttle = 0; });
    hold(this.root.querySelector('.m-brake') as HTMLElement, () => { ax.throttle = -1; }, () => { if (ax.throttle < 0) ax.throttle = 0; });
    (this.root.querySelector('[data-a=exit]') as HTMLButtonElement).onclick = () => { closeSheet(); (this.app.currentLevelObj as AnyObj).onFreeInteract?.(); };
    (this.root.querySelector('[data-a=radio]') as HTMLButtonElement).onclick = () => this.radioSheet();
  }

  private halfW() { return this.wheel.clientWidth / 2 - 22; }

  update(_dt: number) {
    const on = this.app.currentLevelObj === this.field && this.field.inTruck;
    if (on !== this.shown) {
      this.shown = on;
      this.root.classList.toggle('show', on);
      this.hud.override = on ? [] : null;
      if (!on) { this.player.axes.steer = 0; this.player.axes.throttle = 0; this.player.axes.brake = false; this.knob.style.transform = ''; }
    }
  }
  hide() { this.shown = false; this.root.classList.remove('show'); this.hud.override = null; }

  /** 收音機：電源、上一台 / 下一台、電台清單 (重用 fieldDay 的按鍵處理) */
  private radioSheet() {
    const key = (code: string) => this.app.onExtraKey?.(new KeyboardEvent('keydown', { code }));
    const fd = this.field as AnyObj;
    const radio = fd.radio;
    const html = `
      <div class="m-radio-now"></div>
      <div class="m-radio-btns">
        <button type="button" data-r="power">電源</button>
        <button type="button" data-r="prev">上一台</button>
        <button type="button" data-r="next">下一台</button>
      </div>
      <ol class="m-radio-list">${(radio.stations as AnyObj[]).map((st, i) => `<li><button type="button" data-i="${i}">${st.name}${st.custom ? '<em>自訂</em>' : ''}</button><button type="button" class="m-radio-url" data-u="${i}">網址</button></li>`).join('')}</ol>`;
    const bd = sheet('車上收音機', html, 'm-radio');
    const now = bd.querySelector('.m-radio-now') as HTMLElement;
    const refresh = () => {
      const st = radio.current;
      const text: Record<string, string> = { off: '關閉', loading: '調頻中……', playing: '收聽中', error: `收訊不良${radio.reason ? `：${radio.reason}` : ''}` };
      now.innerHTML = radio.isOn ? `<b>${st.key || ''} ${st.name}</b><span>${text[radio.status] || ''}</span>` : '<b>— — —</b><span>收音機關閉</span>';
      bd.querySelectorAll<HTMLButtonElement>('[data-i]').forEach(b => b.classList.toggle('is-current', radio.isOn && Number(b.dataset.i) === radio.index));
    };
    refresh();
    const timer = setInterval(() => { if (!bd.isConnected) { clearInterval(timer); return; } refresh(); }, 500);
    bd.querySelectorAll<HTMLButtonElement>('[data-r]').forEach(b => b.onclick = () => { const a = b.dataset.r; if (a === 'power') key('KeyR'); else if (a === 'prev') key('KeyB'); else key('KeyN'); refresh(); });
    bd.querySelectorAll<HTMLButtonElement>('[data-i]').forEach(b => b.onclick = () => { radio.tune(Number(b.dataset.i)); refresh(); });
    bd.querySelectorAll<HTMLButtonElement>('[data-u]').forEach(b => b.onclick = () => { fd.editStationUrl(Number(b.dataset.u)); refresh(); });
  }
}
