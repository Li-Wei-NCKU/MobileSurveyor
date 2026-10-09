/**
 * 手機版「連點衝刺」：土狗阿黃直直衝向腳架時，畫面下方跳出一個大大的「跑！」
 * 每點一下就往黃圈跑近一點，點得夠快才來得及擋在腳架前面。
 *
 * 位置、成敗判定都沿用 siteEvents 的黃圈邏輯 (站進圈裡阿黃就煞車)，
 * 這裡只負責把「連點」變成位移。
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { MobilePlayer } from './player';

export interface DashOpt {
  /** 每一幀回傳要衝過去的點；回傳 null 代表結束 (阿黃停了或撞到了) */
  target: () => { x: number; z: number } | null;
  title: string;
  /** 每點一下跑多遠 (公尺) */
  perTap?: number;
  onEnd?: () => void;
}

let cur: (() => void) | null = null;

export function installDashQte(app: GameApp, player: MobilePlayer) {
  (window as AnyObj).__dashQte = (opt: DashOpt) => {
    cur?.();
    const per = opt.perTap ?? 0.85;
    const root = document.createElement('div');
    root.className = 'm-dash';
    root.innerHTML = `
      <div class="m-dash-top"><b>${opt.title}</b><span class="m-dash-left"></span></div>
      <div class="m-dash-bar"><i></i></div>
      <button type="button" class="m-dash-go">跑！<small>連點</small></button>`;
    document.body.appendChild(root);
    const btn = root.querySelector('.m-dash-go') as HTMLButtonElement;
    const bar = root.querySelector('.m-dash-bar i') as HTMLElement;
    const left = root.querySelector('.m-dash-left') as HTMLElement;
    let d0 = 0, taps = 0, raf = 0;
    const tap = (e: Event) => {
      e.preventDefault(); e.stopPropagation();
      const t = opt.target();
      if (!t) return;
      taps++;
      if (!player.dash) player.dash = { x: t.x, z: t.z, buf: 0 };
      player.dash.x = t.x; player.dash.z = t.z;
      player.dash.buf = Math.min(player.dash.buf + per, per * 3);
      btn.classList.remove('hit');
      void btn.offsetWidth;
      btn.classList.add('hit');
    };
    btn.addEventListener('pointerdown', tap);
    const close = () => {
      if (raf) cancelAnimationFrame(raf);
      btn.removeEventListener('pointerdown', tap);
      root.remove();
      player.dash = null;
      cur = null;
      opt.onEnd?.();
    };
    cur = close;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = opt.target();
      if (!t) { close(); return; }
      player.dash = player.dash || { x: t.x, z: t.z, buf: 0 };
      player.dash.x = t.x; player.dash.z = t.z;
      const d = Math.hypot(t.x - player.position.x, t.z - player.position.z);
      if (!d0) d0 = Math.max(1, d);
      bar.style.width = `${Math.max(0, Math.min(100, (1 - d / d0) * 100))}%`;
      left.textContent = `還有 ${d.toFixed(1)} m`;
    };
    tick();
    void app; void taps;
    return close;
  };
  (window as AnyObj).__dashQteClose = () => cur?.();
}
