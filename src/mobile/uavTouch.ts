/**
 * 無人機飛行的觸控搖桿：桌機是 WASD＋Space 升／Shift 降，
 * 手機就在畫面兩側放按住式的搖桿，按下去送 keydown、放開送 keyup，飛行邏輯完全沿用。
 */
import type { AnyObj } from '../field/legacy';

const KEY = (code: string, down: boolean) =>
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));

function pad(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'm-uav';
  d.innerHTML = `
    <div class="m-uav-dpad">
      <button type="button" data-k="KeyW" class="up">▲</button>
      <button type="button" data-k="KeyA" class="left">◀</button>
      <button type="button" data-k="KeyD" class="right">▶</button>
      <button type="button" data-k="KeyS" class="down">▼</button>
    </div>
    <div class="m-uav-alt">
      <button type="button" data-k="Space" class="rise">升空</button>
      <button type="button" data-k="ShiftLeft" class="fall">下降</button>
    </div>`;
  d.querySelectorAll<HTMLButtonElement>('button[data-k]').forEach(b => {
    const code = b.dataset.k!;
    const on = (e: PointerEvent) => { e.preventDefault(); b.classList.add('on'); KEY(code, true); try { b.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ } };
    const off = (e: PointerEvent) => { b.classList.remove('on'); KEY(code, false); try { b.releasePointerCapture(e.pointerId); } catch { /* 合成事件 */ } };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', (e) => { if (b.classList.contains('on')) off(e as PointerEvent); });
  });
  return d;
}

/** 回傳每幀呼叫的函式：飛行中就掛搖桿，落地就收起來 */
export function installUavTouch() {
  let el: HTMLElement | null = null;
  return () => {
    const flying = document.body.classList.contains('uav-flying') && !(window as AnyObj).__noUavPad;
    if (flying && !el) { el = pad(); document.body.appendChild(el); }
    else if (!flying && el) { el.remove(); el = null; }
  };
}
