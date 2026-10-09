/**
 * QTE：小朋友很盧，一次打發不走。
 * 畫面中間出現按鍵，限時內按對才算擋下這一波；連續幾波都過才算成功。
 */
import { audio } from './legacy';

export interface QteOpts {
  speaker: string;
  lines: string[];          // 每一波小朋友說的話 (波數 = lines.length)
  hint?: string;
  /** 每過一關 (i = 第幾關) */
  onStep?: (i: number) => void;
  /** 時間放寬倍數 (有人先喊預警) */
  slow?: number;
  onDone: (ok: boolean) => void;
}

const KEYS = ['Q', 'E', 'R', 'F', 'Z', 'X', 'C', 'V'];

let active = false;
export function qteActive() { return active; }

export function runQTE(o: QteOpts) {
  if (active) return;
  active = true;
  if (document.exitPointerLock) document.exitPointerLock();
  // 已經在近距離操作 (例如無人機飛行中) 就不要在結束時把 bench-active 拿掉，否則鏡頭會被玩家搶回去
  const hadBench = document.body.classList.contains('bench-active');
  document.body.classList.add('bench-active', 'qte-active');
  const root = document.createElement('div');
  root.className = 'qte';
  root.innerHTML = `
    <div class="qte-speaker">${o.speaker}</div>
    <div class="qte-line"></div>
    <div class="qte-key"><kbd class="cap"></kbd><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="qte-ring"/></svg></div>
    <div class="qte-dots">${o.lines.map(() => '<i></i>').join('')}</div>
    <div class="qte-hint">${o.hint || '按出畫面上的鍵，把小朋友擋下來！'}</div>`;
  document.body.appendChild(root);
  const lineEl = root.querySelector('.qte-line') as HTMLElement;
  const keyEl = root.querySelector('.qte-key kbd') as HTMLElement;
  const ring = root.querySelector('.qte-ring') as SVGCircleElement;
  const dots = [...root.querySelectorAll('.qte-dots i')] as HTMLElement[];
  const C = 2 * Math.PI * 46;
  ring.style.strokeDasharray = `${C}`;

  let round = 0, want = '', t0 = 0, limit = 1.5, raf = 0, done = false;

  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    root.classList.add(ok ? 'win' : 'lose');
    if (!ok) audio()?.playClick?.();
    setTimeout(() => {
      root.remove();
      document.body.classList.remove('qte-active');
      if (!hadBench) document.body.classList.remove('bench-active');
      active = false;
      o.onDone(ok);
    }, ok ? 500 : 900);
  };

  const next = () => {
    if (round >= o.lines.length) { finish(true); return; }
    lineEl.textContent = o.lines[round];
    let k = KEYS[Math.floor(Math.random() * KEYS.length)];
    if (k === want) k = KEYS[(KEYS.indexOf(k) + 3) % KEYS.length];
    want = k;
    keyEl.textContent = k;
    keyEl.classList.remove('pop'); void keyEl.offsetWidth; keyEl.classList.add('pop');
    limit = Math.max(0.9, 1.6 - round * 0.2) * ((window as unknown as { __qteSlow?: number }).__qteSlow || 1) * (o.slow || 1); // __qteSlow：測試用
    t0 = performance.now();
  };

  const tick = () => {
    const k = (performance.now() - t0) / 1000 / limit;
    ring.style.strokeDashoffset = `${C * Math.min(1, k)}`;
    ring.classList.toggle('late', k > 0.65);
    if (k >= 1) { dots[round]?.classList.add('bad'); finish(false); return; }
    raf = requestAnimationFrame(tick);
  };

  const onKey = (e: KeyboardEvent) => {
    if (done) return;
    if (e.repeat) return;
    const k = e.code.startsWith('Key') ? e.code.slice(3) : '';
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === want) {
      audio()?.playClick?.();
      dots[round]?.classList.add('ok');
      o.onStep?.(round);
      round++;
      next();
    } else {
      dots[round]?.classList.add('bad');
      finish(false);
    }
  };
  window.addEventListener('keydown', onKey, true);
  next();
  raf = requestAnimationFrame(tick);
}
