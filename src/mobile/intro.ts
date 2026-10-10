/**
 * 小遊戲開始前的說明卡：先看怎麼操作，按「開始」才真的進去。
 * 第一次玩顯示完整說明，之後只留一行提醒 (但還是要按一下，不會突然就開始)。
 */
import { isMobile } from '../field/holdPad';

export interface IntroOpt {
  /** localStorage 記「玩過了」用的 key */
  key: string;
  title: string;
  sub?: string;
  /** 完整說明 (第一次)，一行一步 */
  lines: string[];
  /** 玩過之後只顯示這一行；沒給就用 lines[0] */
  short?: string;
  /** 右邊的小圖 (inline SVG) */
  art?: string;
  start?: string;
  cancel?: string;
  onStart: () => void;
  onCancel?: () => void;
}

const seen = (k: string) => {
  try { return !!localStorage.getItem(`ks-m-intro-${k}`); } catch { return false; }
};
const mark = (k: string) => {
  try { localStorage.setItem(`ks-m-intro-${k}`, '1'); } catch { /* 無痕模式 */ }
};

/** 手機版才擋；桌機直接 onStart */
export function gameIntro(o: IntroOpt) {
  if (!isMobile()) { o.onStart(); return; }
  const first = !seen(o.key);
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop show field-modal m-intro';
  const body = first
    ? `<ol class="m-intro-steps">${o.lines.map(l => `<li>${l}</li>`).join('')}</ol>`
    : `<p class="m-intro-one">${o.short || o.lines[0]}</p>`;
  bd.innerHTML = `<div class="m-intro-box">
    <div class="m-intro-head"><h3>${o.title}</h3>${o.sub ? `<small>${o.sub}</small>` : ''}</div>
    <div class="m-intro-body">${o.art ? `<div class="m-intro-art">${o.art}</div>` : ''}${body}</div>
    <div class="m-intro-btns">
      ${o.onCancel ? `<button type="button" class="m-intro-no">${o.cancel || '等一下'}</button>` : ''}
      <button type="button" class="m-intro-go">${o.start || '開始'}</button>
    </div>
  </div>`;
  document.body.appendChild(bd);
  if (document.exitPointerLock) document.exitPointerLock();
  const close = () => { bd.remove(); };
  (bd.querySelector('.m-intro-go') as HTMLButtonElement).onclick = (e) => {
    e.stopPropagation();
    mark(o.key);
    close();
    o.onStart();
  };
  const no = bd.querySelector('.m-intro-no') as HTMLButtonElement | null;
  if (no) no.onclick = (e) => { e.stopPropagation(); close(); o.onCancel?.(); };
}
