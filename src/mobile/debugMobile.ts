/**
 * 手機版測試工具的開法：長按左上角的提示列 1.2 秒，或網址加 #debug。
 * 面板內容就是桌機版的 F9 面板 (debug.ts)，這裡只是幫它送一個 F9。
 */
export function installMobileDebug() {
  const fire = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9', key: 'F9', bubbles: true }));
  let timer = 0;
  const start = (e: Event) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.m-hint') && !t.closest('.menu-title')) return;
    timer = window.setTimeout(() => { timer = 0; fire(); if (navigator.vibrate) navigator.vibrate(30); }, 1200);
  };
  const stop = () => { if (timer) { clearTimeout(timer); timer = 0; } };
  document.addEventListener('pointerdown', start, true);
  document.addEventListener('pointerup', stop, true);
  document.addEventListener('pointercancel', stop, true);
  document.addEventListener('pointermove', (e) => { if (timer && e.buttons === 0) stop(); }, true);
  if (location.hash === '#debug') setTimeout(fire, 1500);
  // 面板的「F9 關閉」改成可以點
  const mo = new MutationObserver(() => {
    const h = document.querySelector('.ks-debug .kd-head span');
    if (h && !(h as HTMLElement).dataset.m) { (h as HTMLElement).dataset.m = '1'; h.textContent = '關閉'; (h as HTMLElement).onclick = fire; }
  });
  mo.observe(document.body, { childList: true, subtree: false });
}
