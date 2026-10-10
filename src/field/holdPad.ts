/**
 * 手機版「扶桿子／扶尺」用的觸控推桿：
 * 手指按在圓水準器上，往哪邊按就往哪邊推 (離圓心越遠力道越大)，放開就歸零。
 * 桌機版照舊用 WASD，這裡只在手機版掛上去。
 */
export interface PadVec { x: number; y: number }

export function attachHoldPad(vial: HTMLElement | null, vec: PadVec): () => void {
  if (!vial) return () => {};
  vial.classList.add('pad');
  let on = false;
  const set = (e: PointerEvent) => {
    const r = vial.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, d) / d;
    vec.x = dx * k; vec.y = dy * k;
  };
  const down = (e: PointerEvent) => {
    on = true; set(e); vial.classList.add('push');
    e.preventDefault(); e.stopPropagation();
    try { vial.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
  };
  const move = (e: PointerEvent) => { if (on) { set(e); e.preventDefault(); } };
  const up = (e: PointerEvent) => {
    on = false; vec.x = 0; vec.y = 0; vial.classList.remove('push');
    try { vial.releasePointerCapture(e.pointerId); } catch { /* 合成事件 */ }
  };
  vial.addEventListener('pointerdown', down);
  vial.addEventListener('pointermove', move);
  vial.addEventListener('pointerup', up);
  vial.addEventListener('pointercancel', up);
  return () => {
    vial.removeEventListener('pointerdown', down);
    vial.removeEventListener('pointermove', move);
    vial.removeEventListener('pointerup', up);
    vial.removeEventListener('pointercancel', up);
    vec.x = 0; vec.y = 0;
  };
}

export const isMobile = () => !!(window as unknown as { __mobile?: unknown }).__mobile;

/** 扶桿子／扶尺的第一次動畫提示 (手機版)：用過一次就不再出現 */
export function rodHintOn(): boolean {
  try { return !localStorage.getItem('ks-m-hold-hint'); } catch { return true; }
}
export function rodHintDone() {
  try { localStorage.setItem('ks-m-hold-hint', '1'); } catch { /* 無痕模式 */ }
}
