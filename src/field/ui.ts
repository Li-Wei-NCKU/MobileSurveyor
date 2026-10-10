/**
 * 外業系統 DOM 介面：主選單、派工單、對話、成果報告書、提示條、底部鍵位
 */
import { ITEMS } from './items';
import { speak, hush } from './sound';
import { COLS, ROWS, LAYERS, footprint, type TrunkGrid, type Placed } from './trunk';
import type { ItemId } from './items';
import type { AnyObj } from './legacy';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function overlay(id: string, inner: HTMLElement): HTMLElement {
  document.getElementById(id)?.remove();
  const bd = el('div', 'modal-backdrop show field-modal');
  bd.id = id;
  bd.appendChild(inner);
  document.body.appendChild(bd);
  if (document.exitPointerLock) document.exitPointerLock();
  return bd;
}

// ------------------------------------------------------------------
// 提示條 (toast)
// ------------------------------------------------------------------
let toastBox: HTMLElement | null = null;
/** 手機版把「按 E」之類的鍵盤說明改寫成觸控說法 (由 mobile/index.ts 設定) */
let textFilter: ((s: string) => string) | null = null;
export function setTextFilter(f: ((s: string) => string) | null) { textFilter = f; }
export function fixText(s: string) { return textFilter && typeof s === 'string' ? textFilter(s) : s; }

export function toast(text: string, kind: 'info' | 'warn' | 'bad' | 'good' = 'info', ms = 3200) {
  text = fixText(text);
  if (!toastBox) {
    toastBox = el('div', 'toast-box');
    document.body.appendChild(toastBox);
  }
  const t = el('div', `toast toast-${kind}`, text);
  toastBox.appendChild(t);
  // 有人在講話的提示：配上說話聲
  if (/對講機/.test(text) && /「/.test(text)) speak('對講機', text.replace(/^.*?「/, ''));
  else { const m = text.match(/^([^：「」（）]{1,10})：「(.*)/); if (m) speak(m[1], m[2]); }
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** 主角內心 OS：畫面中下方的思考泡泡 */
export function thought(text: string, ms = 4200) {
  text = fixText(text);
  const t = el('div', 'thought', `<span class="th-dots">…</span>${text}`);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 500);
}

// ------------------------------------------------------------------
// 主選單
// ------------------------------------------------------------------
export interface MenuJob { id: string; name: string; desc: string; locked?: string; done?: boolean }
let menuKeyHandler: ((e: KeyboardEvent) => void) | null = null;
/** 不經過選單直接開始時，拿掉選單的按鍵監聽 */
export function dropMenuKeys() { if (menuKeyHandler) window.removeEventListener('keydown', menuKeyHandler, true); menuKeyHandler = null; }
export function showMainMenu(jobs: MenuJob[], onPick: (id: string) => void) {
  if (menuKeyHandler) window.removeEventListener('keydown', menuKeyHandler, true);
  const box = el('div', 'menu');
  box.innerHTML = `
    <div class="menu-title" aria-label="鍵盤測量員">
      <kbd class="cap menu-cap cap-accent">鍵</kbd><kbd class="cap menu-cap cap-accent">盤</kbd><kbd class="cap menu-cap">測</kbd><kbd class="cap menu-cap">量</kbd><kbd class="cap menu-cap">員</kbd>
    </div>
    <p class="menu-sub">理論滿分，實務……我們現場見。</p>
    <div class="menu-choices">
      ${jobs.map((j, i) => `
      <button class="menu-choice${j.locked ? ' locked' : ''}" data-act="${j.id}"${j.locked ? ' disabled' : ''}>
        <span class="menu-choice-name">${j.name}${j.done ? '<em class="menu-done">已完成</em>' : ''}</span>
        <span class="menu-choice-desc">${j.locked ? `🔒 ${j.locked}` : j.desc}</span>
        <span class="menu-choice-key"><kbd class="cap${i === 0 ? ' cap-accent' : ''}">${i + 1}</kbd></span>
      </button>`).join('')}
    </div>`;
  box.insertAdjacentHTML('beforeend', '<p class="menu-foot"><button class="menu-load" type="button"><kbd class="cap">F7</kbd> 讀取存檔</button>　<button class="menu-load menu-audio" type="button"><kbd class="cap">M</kbd> 聲音設定</button></p>');
  (box.querySelector('.menu-load') as HTMLButtonElement).onclick = () => window.dispatchEvent(new Event('ks-load'));
  (box.querySelector('.menu-audio') as HTMLButtonElement).onclick = (e) => { e.stopPropagation(); window.dispatchEvent(new Event('ks-audio')); };
  const bd = overlay('main-menu', box);
  bd.classList.add('menu-backdrop');
  const go = (act: string) => { window.removeEventListener('keydown', onKey, true); bd.remove(); onPick(act); };
  const onKey = (e: KeyboardEvent) => {
    const i = e.key === 'Enter' ? jobs.findIndex(j => !j.locked && !j.done) : parseInt(e.key, 10) - 1;
    const j = jobs[i < 0 ? 0 : i];
    if (j && !j.locked && (e.key === 'Enter' || /^[1-9]$/.test(e.key))) { e.stopPropagation(); go(j.id); }
  };
  window.addEventListener('keydown', onKey, true);
  menuKeyHandler = onKey;
  box.querySelectorAll<HTMLButtonElement>('.menu-choice').forEach(b => b.onclick = () => go(b.dataset.act!));
}

// ------------------------------------------------------------------
// 派工單
// ------------------------------------------------------------------
let woKeyHandler: ((e: KeyboardEvent) => void) | null = null;
/** 不按接單直接關掉派工單 (測試工具用) */
export function dismissWorkOrder() {
  if (woKeyHandler) window.removeEventListener('keydown', woKeyHandler, true);
  woKeyHandler = null;
  document.getElementById('work-order')?.remove();
}
export function showWorkOrder(wo: { seq: string; item: string; place: string; spec: string; note: string; gear?: string }, onAccept: () => void) {
  wo = { ...wo, item: fixText(wo.item), place: fixText(wo.place), spec: fixText(wo.spec), note: fixText(wo.note), gear: wo.gear ? fixText(wo.gear) : wo.gear };
  const box = el('div', 'paper workorder');
  const today = new Date();
  const d = `${today.getFullYear() - 1911} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;
  box.innerHTML = `
    <div class="paper-head">
      <h2>派　工　單</h2>
      <span class="stamp">急件</span>
    </div>
    <table class="paper-table">
      <tr><th>案號</th><td>KB-${today.getFullYear() - 1911}-${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${wo.seq}</td><th>日期</th><td>${d}</td></tr>
      <tr><th>工作項目</th><td colspan="3">${wo.item}</td></tr>
      <tr><th>地點</th><td colspan="3">${wo.place}</td></tr>
      <tr><th>精度要求</th><td colspan="3">${wo.spec}</td></tr>
      ${wo.gear ? `<tr><th>攜帶設備</th><td colspan="3">${wo.gear}</td></tr>` : ''}
      <tr><th>施測人員</th><td>你（工讀生）</td><th>派工</th><td class="hand">組長</td></tr>
      <tr><th>備註</th><td colspan="3" class="hand">${wo.note}</td></tr>
    </table>
    <div class="paper-actions">
      <button class="btn-paper" id="wo-accept"><kbd class="cap cap-accent">Enter</kbd> 接單出發</button>
    </div>`;
  const bd = overlay('work-order', box);
  const accept = () => { window.removeEventListener('keydown', onKey, true); bd.remove(); onAccept(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); accept(); } };
  if (woKeyHandler) window.removeEventListener('keydown', woKeyHandler, true);
  window.addEventListener('keydown', onKey, true);
  woKeyHandler = onKey;
  (box.querySelector('#wo-accept') as HTMLButtonElement).onclick = accept;
}

// ------------------------------------------------------------------
// 對話
// ------------------------------------------------------------------
let faceHook: ((o: unknown, also?: unknown) => void) | null = null;
export function setFaceHook(fn: (o: unknown, also?: unknown) => void) { faceHook = fn; }
/** 對話前把玩家視角轉向說話的人 */
/** also：對話時也要看得到的東西 (例如阿姨的界樁)，手機版會把它一起框進畫面 */
export function faceSpeaker(o: unknown, also?: unknown) { if (o && faceHook) faceHook(o, also); }

export interface DialogOption { text: string; reply: string; score: number; tag: string; /** 有值時選項不可選，並顯示原因 */ disabled?: string; id?: string }
export function showDialog(speaker: string, line: string, options: DialogOption[], onPick: (o: DialogOption) => void) {
  line = fixText(line);
  options = options.map(o => ({ ...o, text: fixText(o.text), disabled: o.disabled ? fixText(o.disabled) : o.disabled }));
  const box = el('div', 'dialog');
  box.innerHTML = `
    <div class="dialog-speaker">${speaker}</div>
    <p class="dialog-line">${line}</p>
    <ol class="dialog-options">${options.map((o, i) => `<li><button data-i="${i}"${o.disabled ? ' disabled' : ''}><kbd class="cap">${i + 1}</kbd><span>${o.text}${o.disabled ? `<small class="dialog-why">（${o.disabled}）</small>` : ''}</span></button></li>`).join('')}</ol>`;
  const bd = overlay('dialog-box', box);
  bd.classList.add('dialog-backdrop');
  hush(); speak(speaker, line);
  let picked = false;
  const pick = (i: number) => {
    if (picked || !options[i] || options[i].disabled) return;
    picked = true;
    window.removeEventListener('keydown', onKey, true);
    const o = options[i];
    box.innerHTML = `<div class="dialog-speaker">${speaker}</div><p class="dialog-line">${o.reply}</p><p class="dialog-hint">按任意鍵繼續</p>`;
    hush(); speak(speaker, o.reply);
    const close = () => { window.removeEventListener('keydown', close, true); bd.remove(); onPick(o); };
    setTimeout(() => { window.addEventListener('keydown', close, true); bd.addEventListener('click', close); }, 250);
  };
  const onKey = (e: KeyboardEvent) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= options.length) { e.stopPropagation(); pick(n - 1); } };
  window.addEventListener('keydown', onKey, true);
  box.querySelectorAll<HTMLButtonElement>('.dialog-options button').forEach(b => b.onclick = () => pick(parseInt(b.dataset.i!, 10)));
}

// ------------------------------------------------------------------
// 成果報告書
// ------------------------------------------------------------------
export interface ReportRow { label: string; detail: string; delta: number }
export function showReport(rows: ReportRow[], total: number, title: string, comment: string, onDone: () => void, story?: { chain: { cause: string; effect: string }[]; alts: string[] }, doneLabel = '回主選單') {
  const chain = story?.chain.slice(0, 9) || [];
  const alts = (story?.alts || []).slice().sort(() => Math.random() - 0.5).slice(0, 3);
  const storyHtml = chain.length || alts.length ? `
    <div class="report-story">
      ${chain.length ? `<h3>這一天的因果</h3><ul class="rs-chain">${chain.map(c => `<li><span>${c.cause}</span><i>→</i><b>${c.effect}</b></li>`).join('')}</ul>` : ''}
      ${alts.length ? `<h3>如果當時……</h3><ul class="rs-alt">${alts.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
    </div>` : '';
  const box = el('div', 'paper report');
  box.innerHTML = `
    <div class="paper-head"><h2>外業成果報告書</h2><span class="stamp stamp-${total >= 75 ? 'ok' : 'bad'}">${total >= 60 ? '准予驗收' : '退件'}</span></div>
    <table class="paper-table report-table">
      <tr><th>項目</th><th>紀錄</th><th class="num">分數</th></tr>
      ${rows.map(r => `<tr><td>${r.label}</td><td>${r.detail}</td><td class="num ${r.delta < 0 ? 'neg' : ''}">${r.delta > 0 ? '+' : ''}${r.delta}</td></tr>`).join('')}
      <tr class="total"><td>總分</td><td></td><td class="num">${total}</td></tr>
    </table>
    ${storyHtml}
    <div class="report-verdict">
      <div class="report-title">考評：<strong>${title}</strong></div>
      <p class="hand">${comment}</p>
    </div>
    <div class="paper-actions"><button class="btn-paper" id="rp-done"><kbd class="cap cap-accent">Enter</kbd> ${doneLabel}</button></div>`;
  const bd = overlay('field-report', box);
  const done = () => { window.removeEventListener('keydown', onKey, true); bd.remove(); onDone(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.stopPropagation(); done(); } };
  window.addEventListener('keydown', onKey, true);
  (box.querySelector('#rp-done') as HTMLButtonElement).onclick = done;
}

// ------------------------------------------------------------------
// 後斗配置圖：放入 (重力式疊放) / 取出 (點選設備)
// ------------------------------------------------------------------
export interface TrunkViewOpts {
  grid: TrunkGrid;
  /** 放入模式時手上的設備；null = 取出模式 */
  item: ItemId | null;
  onPlace?: (col: number, row: number, layer: number, rot: boolean) => void;
  onTake?: (p: Placed) => void;
  onClose?: () => void;
}

export function showTrunkView(o: TrunkViewOpts) {
  // 手機版有自己的後斗畫面 (格子大、有插畫、會指出卡住的是哪幾件)
  const mv = (window as AnyObj).__trunkView;
  if (typeof mv === 'function') { mv(o); return; }
  const { grid } = o;
  const loading = !!o.item;
  const item = o.item as ItemId;
  let rot = false;
  let hover: { col: number; row: number } | null = null;
  const box = el('div', 'paper trunk-ui');
  box.innerHTML = `
    <div class="paper-head"><h2>後斗</h2><span class="trunk-mode">${loading ? `放入：<strong>${ITEMS[item].name}</strong>` : '取出設備'}</span></div>
    <div class="trunk-body">
      <div class="trunk-grid-wrap"></div>
      <aside class="trunk-side">
        ${loading ? `
          <p>點格子放下，設備會<strong>自動疊到最上面</strong>。</p>
          <p>疊放的條件只有一個：<strong>底下要平</strong>。不能一半壓在箱子上、一半懸空。最多疊 ${LAYERS} 層。</p>
          <p class="trunk-tip">先要用的放靠車尾、放上層，到現場比較好拿。</p>
          <p class="trunk-keys"><button type="button" class="trunk-btn" data-t="rot">旋轉</button><button type="button" class="trunk-btn" data-t="close">取消</button></p>` : `
          <p>點一下要拿的設備。</p>
          <p>能直接拿的會亮<span class="sw sw-ok"></span>綠框；<span class="sw sw-bad"></span>紅框表示被<strong>壓住</strong>（上面有東西）或<strong>擋住</strong>（靠車尾那側有東西），要先把它們拿走。</p>
          <p class="trunk-keys"><button type="button" class="trunk-btn" data-t="close">關閉</button></p>`}
        <div class="trunk-legend"><span class="lg lg-1"></span>底層　<span class="lg lg-2"></span>疊在上層</div>
      </aside>
    </div>
    <p class="trunk-msg" aria-live="polite">${loading ? '點一下格子看會放在哪裡，再點一次放下。' : ''}</p>`;
  const wrap = box.querySelector('.trunk-grid-wrap') as HTMLElement;
  const touch = matchMedia('(hover: none)').matches || !!(window as AnyObj).__mobile;
  box.querySelectorAll<HTMLButtonElement>('.trunk-btn').forEach(b => b.onclick = (e) => {
    e.stopPropagation();
    if (b.dataset.t === 'rot') { rot = !rot; paint(); }
    else { cleanup(); o.onClose && o.onClose(); }
  });
  const msg = box.querySelector('.trunk-msg') as HTMLElement;
  const say = (t: string, bad = false) => { msg.innerHTML = t; msg.classList.toggle('bad', bad); };

  const anchor = (c: number, r: number) => {
    const { w, d } = footprint(item, rot);
    return { col: Math.max(0, Math.min(c, COLS - w)), row: Math.max(0, Math.min(r - d + 1, ROWS - d)) };
  };

  const blockOf = (p: Placed, extra = '') => {
    const { w, d } = footprint(p.item, p.rot);
    const b = el(loading ? 'div' : 'button', `trunk-block layer-${p.layer} ${extra}`, `<span>${ITEMS[p.item].name}</span>${p.layer > 0 ? '<em>疊放</em>' : ''}`);
    b.style.gridColumn = `${p.col + 1} / span ${w}`;
    b.style.gridRow = `${ROWS - (p.row + d - 1) + 1} / span ${d}`;
    b.style.setProperty('--c', '#' + ITEMS[p.item].color.toString(16).padStart(6, '0'));
    return b;
  };

  const render = () => {
    wrap.innerHTML = '';
    const g = el('div', 'trunk-grid');
    g.style.setProperty('--cols', String(COLS));
    g.style.setProperty('--rows', String(ROWS));
    const cab = el('div', 'trunk-end trunk-end-cab', '車頭');
    cab.style.gridRow = '1';
    g.appendChild(cab);
    for (let rr = ROWS - 1; rr >= 0; rr--) for (let c = 0; c < COLS; c++) {
      const cell = el('div', 'trunk-cell');
      cell.style.gridColumn = String(c + 1);
      cell.style.gridRow = String(ROWS - rr + 1);
      if (loading) {
        cell.onmouseenter = () => { if (!touch) { hover = { col: c, row: rr }; paint(); } };
        cell.onclick = () => {
          // 觸控：第一下預覽，再點同一格才放下
          if (touch && !(hover && hover.col === c && hover.row === rr)) { hover = { col: c, row: rr }; paint(); return; }
          tryPlace(c, rr);
        };
      }
      g.appendChild(cell);
    }
    [...grid.placed].sort((a, b) => a.layer - b.layer).forEach(p => {
      const blockers = loading ? [] : grid.blockers(p);
      const b = blockOf(p, loading ? '' : blockers.length ? 'is-blocked' : 'is-free');
      if (loading) {
        // 放入模式：方塊不攔截滑鼠，讓下面的格子接收
        b.style.pointerEvents = 'none';
      } else {
        const why = blockers.length ? `${ITEMS[p.item].name}被${blockers.map(x => ITEMS[x.item].name).join('、')}${blockers.some(x => x.layer > p.layer) ? '壓住' : '擋住'}了。` : '';
        b.onmouseenter = () => say(why ? why : `拿出 <strong>${ITEMS[p.item].name}</strong>`, !!why);
        b.onclick = () => {
          if (blockers.length) { say(why + '先把它們拿走。', true); return; }
          cleanup();
          o.onTake && o.onTake(p);
        };
      }
      g.appendChild(b);
    });
    if (loading) {
      const prev = el('div', 'trunk-preview');
      g.appendChild(prev);
    }
    const tail = el('div', 'trunk-end trunk-end-tail', '車尾（尾門）');
    tail.style.gridRow = String(ROWS + 2);
    g.appendChild(tail);
    wrap.appendChild(g);
    if (!loading && grid.placed.length === 0) say('後斗是空的。');
    paint();
  };

  const paint = () => {
    if (!loading) return;
    const prev = box.querySelector<HTMLElement>('.trunk-preview');
    if (!prev || !hover) { if (prev) prev.style.display = 'none'; return; }
    const { w, d } = footprint(item, rot);
    const a = anchor(hover.col, hover.row);
    const res = grid.drop(item, a.col, a.row, rot);
    prev.style.display = 'grid';
    prev.style.gridColumn = `${a.col + 1} / span ${w}`;
    prev.style.gridRow = `${ROWS - (a.row + d - 1) + 1} / span ${d}`;
    prev.className = `trunk-preview layer-${Math.min(res.layer, LAYERS - 1)}${res.reason ? ' bad' : ''}`;
    prev.innerHTML = `<span>${ITEMS[item].name}</span>`;
    const again = touch ? '再點一次放下。' : '';
    if (res.reason) say(res.reason, true);
    else if (res.layer === 0) say(`放在<strong>底層</strong>。${again}`);
    else say(`疊在<strong>${res.on.map(p => ITEMS[p.item].name).join('、')}</strong>上面（第 ${res.layer + 1} 層）。${again}`);
  };

  const tryPlace = (c: number, r: number) => {
    const a = anchor(c, r);
    const res = grid.drop(item, a.col, a.row, rot);
    if (res.reason) { say(res.reason, true); return; }
    cleanup();
    o.onPlace && o.onPlace(a.col, a.row, res.layer, rot);
  };

  const onKey = (e: KeyboardEvent) => {
    if (loading && e.code === 'KeyR') { e.stopPropagation(); rot = !rot; paint(); }
    if (e.key === 'Escape' || (!loading && e.code === 'KeyE')) { e.stopPropagation(); e.preventDefault(); cleanup(); o.onClose && o.onClose(); }
  };
  const cleanup = () => { window.removeEventListener('keydown', onKey, true); bd.remove(); };
  window.addEventListener('keydown', onKey, true);
  const bd = overlay('trunk-loader', box);
  render();
}

// ------------------------------------------------------------------
// 底部鍵位列
// ------------------------------------------------------------------
const CTRL_WALK = `
  <div class="ctrl"><span class="wasd"><kbd class="cap">W</kbd><span class="wasd-row"><kbd class="cap">A</kbd><kbd class="cap">S</kbd><kbd class="cap">D</kbd></span></span><span class="ctrl-label">走動</span></div>
  <div class="ctrl"><kbd class="cap cap-wide">Shift</kbd><span class="ctrl-label">快跑</span></div>
  <div class="ctrl"><span class="mouse-glyph" aria-hidden="true"></span><span class="ctrl-label">轉動視角</span></div>
  <div class="ctrl"><kbd class="cap cap-accent">E</kbd><span class="ctrl-label">拿起／互動</span></div>
  <div class="ctrl"><kbd class="cap">G</kbd><span class="ctrl-label">放下</span></div>
  <div class="ctrl"><kbd class="cap">F</kbd><span class="ctrl-label">喝水</span></div>
  <div class="ctrl"><kbd class="cap">H</kbd><span class="ctrl-label">手冊</span></div>
  <div class="ctrl"><kbd class="cap">J</kbd><span class="ctrl-label">手簿</span></div>
  <div class="ctrl gcp-only"><kbd class="cap cap-accent">Q</kbd><span class="ctrl-label">外業地圖</span></div>
  <div class="ctrl gcp-only"><kbd class="cap">C</kbd><span class="ctrl-label">手機拍照</span></div>`;
const CTRL_DRIVE = `
  <div class="ctrl"><kbd class="cap">W</kbd><span class="ctrl-label">油門</span></div>
  <div class="ctrl"><kbd class="cap">S</kbd><span class="ctrl-label">煞車／倒車</span></div>
  <div class="ctrl"><span class="wasd-row"><kbd class="cap">A</kbd><kbd class="cap">D</kbd></span><span class="ctrl-label">轉向</span></div>
  <div class="ctrl"><kbd class="cap cap-wide">Space</kbd><span class="ctrl-label">手煞車</span></div>
  <div class="ctrl"><kbd class="cap">R</kbd><span class="ctrl-label">收音機</span></div>
  <div class="ctrl"><kbd class="cap cap-accent">E</kbd><span class="ctrl-label">下車</span></div>`;
let ctrlDefault: string | null = null;
export function setControls(mode: 'walk' | 'drive' | 'default') {
  const bc = document.getElementById('bottom-controls');
  if (!bc) return;
  if (ctrlDefault === null) ctrlDefault = bc.innerHTML;
  bc.innerHTML = mode === 'walk' ? CTRL_WALK : mode === 'drive' ? CTRL_DRIVE : ctrlDefault;
}

/** 車速表 / 手持物品指示 */
export function setHud(info: { speedKmh?: number | null; holding?: string | null; dest?: string | null; water?: number }) {
  let h = document.getElementById('field-hud');
  if (!h) { h = el('div', 'field-hud'); h.id = 'field-hud'; document.body.appendChild(h); }
  const parts: string[] = [];
  if (info.speedKmh !== undefined && info.speedKmh !== null) parts.push(`<div class="fh-speed"><span class="fh-num">${Math.round(info.speedKmh)}</span><span class="fh-unit">km/h</span></div>`);
  if (info.dest) parts.push(`<div class="fh-dest">${info.dest}</div>`);
  if (info.holding) parts.push(`<div class="fh-hold">手上：<strong>${info.holding}</strong></div>`);
  if (info.water !== undefined) {
    const w = Math.round(info.water);
    parts.push(`<div class="fh-water${w < 35 ? ' low' : ''}"><span>水分</span><span class="fh-bar"><i style="width:${w}%"></i></span><span class="fh-pct">${w}%</span>${w < 35 ? '<kbd class="cap">F</kbd>' : ''}</div>`);
  }
  h.innerHTML = parts.join('');
  h.style.display = parts.length ? 'flex' : 'none';
}

// ------------------------------------------------------------------
// 導航提示 (上方中央)
// ------------------------------------------------------------------
const NAV_ICON: Record<string, string> = {
  straight: '<path d="M24 42V10M12 22l12-12 12 12"/>',
  right: '<path d="M14 42V24a8 8 0 0 1 8-8h16M30 8l8 8-8 8"/>',
  left: '<path d="M34 42V24a8 8 0 0 0-8-8H10M18 8l-8 8 8 8"/>',
  arrive: '<path d="M14 42V8M14 9h20l-5 7 5 7H14"/>',
};
export function setNav(st: { text: string; dir: string; dist: number; off: boolean } | null) {
  let n = document.getElementById('field-nav');
  if (!st) { if (n) n.style.display = 'none'; return; }
  if (!n) {
    n = el('div', 'field-nav');
    n.id = 'field-nav';
    n.innerHTML = '<svg class="fn-icon" viewBox="0 0 48 48" aria-hidden="true"></svg><div class="fn-body"><div class="fn-dist"></div><div class="fn-text"></div></div>';
    document.body.appendChild(n);
  }
  n.style.display = 'flex';
  n.classList.toggle('off', st.off);
  const icon = n.querySelector('.fn-icon') as SVGElement;
  const key = st.off ? 'straight' : st.dir;
  if (icon.dataset.k !== key) { icon.innerHTML = NAV_ICON[key] || NAV_ICON.straight; icon.dataset.k = key; }
  (n.querySelector('.fn-dist') as HTMLElement).textContent = st.off ? '' : st.dir === 'arrive' && st.dist < 8 ? '就在這裡' : `${Math.round(st.dist)} m`;
  (n.querySelector('.fn-text') as HTMLElement).textContent = st.text;
}

// ------------------------------------------------------------------
// 車上收音機面板 (駕駛時顯示於左下)
// ------------------------------------------------------------------
export function setRadioPanel(st: { on: boolean; status: string; name: string; note?: string; reason?: string; idx: number; total: number; key?: string; list?: { name: string; key: string; custom?: boolean }[] | null; onPick?: (i: number) => void; onEdit?: (i: number) => void } | null) {
  let p = document.getElementById('car-radio');
  if (!st) { if (p) p.style.display = 'none'; return; }
  if (!p) {
    p = el('div', 'car-radio');
    p.id = 'car-radio';
    p.innerHTML = `
      <ol class="cr-list" aria-label="電台清單"></ol>
      <div class="cr-lcd"><div class="cr-name"></div><div class="cr-status"></div></div>
      <div class="cr-keys"><span><kbd class="cap">R</kbd>電源</span><span><kbd class="cap">B</kbd>上一台</span><span><kbd class="cap">N</kbd>下一台</span><span><kbd class="cap">L</kbd>清單</span><span class="cr-key-u"><kbd class="cap">U</kbd>設定網址</span></div>`;
    document.body.appendChild(p);
  }
  p.style.display = 'flex';
  p.classList.toggle('is-on', st.on);
  const statusText: Record<string, string> = {
    off: '收音機關閉 · 按 R 開啟',
    loading: '調頻中……',
    playing: st.note ? `收聽中 · ${st.note}` : '收聽中',
    error: '收訊不良 · 換一台試試',
  };
  (p.querySelector('.cr-name') as HTMLElement).textContent = st.on ? `${st.key ?? ''}  ${st.name}` : '— — —';
  (p.querySelector('.cr-status') as HTMLElement).textContent = st.on ? statusText[st.status] || '' : statusText.off;
  p.dataset.status = st.on ? st.status : 'off';
  p.classList.toggle('list-open', !!st.list);

  // 電台清單 (L 開關；數字鍵 1–9、0 直接選台，也可以點)
  const list = p.querySelector('.cr-list') as HTMLElement;
  const sig = st.list ? st.list.map(x => x.key + x.name + (x.custom ? '*' : '')).join('|') + '#' + st.idx + st.on : '';
  if (list.dataset.sig !== sig) {
    list.dataset.sig = sig;
    list.innerHTML = '';
    list.style.display = st.list ? 'block' : 'none';
    (st.list || []).forEach(({ name, key, custom }, i) => {
      const li = el('li', 'cr-row');
      const b = el('button', `cr-item${i === st.idx && st.on ? ' is-current' : ''}`);
      b.innerHTML = `<kbd class="cap">${key}</kbd><span>${name}</span>${custom ? '<em class="cr-custom">自訂</em>' : ''}`;
      b.onclick = () => st.onPick && st.onPick(i);
      const ed = el('button', 'cr-edit', '網址');
      ed.title = `設定「${name}」的串流網址`;
      ed.onclick = (ev) => { ev.stopPropagation(); st.onEdit && st.onEdit(i); };
      li.append(b, ed);
      list.appendChild(li);
    });
  }
}

// ------------------------------------------------------------------
// 左側外業手簿：可以收起來 / 打開 (J)
// ------------------------------------------------------------------
let fbUser = false;   // 玩家自己收起來了
let fbForce = 0;      // 拍照等畫面暫時收起
function fbApply() {
  const p = document.getElementById('mission-panel');
  if (!p) return;
  const c = fbUser || fbForce > 0;
  p.classList.toggle('collapsed', c);
  const b = p.querySelector('.fb-toggle');
  if (b) b.innerHTML = c ? '<kbd class="cap">J</kbd> 打開' : '<kbd class="cap">J</kbd> 收起';
}
export function installFieldbookToggle() {
  const p = document.getElementById('mission-panel');
  const cover = p?.querySelector('.fb-cover');
  if (!cover || cover.querySelector('.fb-toggle')) return;
  const b = el('button', 'fb-toggle');
  b.type = 'button';
  b.title = '收起／打開外業手簿 (J)';
  b.onclick = (e) => { e.stopPropagation(); toggleFieldbook(); };
  cover.appendChild(b);
  fbApply();
}
export function toggleFieldbook() { fbUser = !fbUser; if (!fbUser) fbForce = 0; fbApply(); }
/** 暫時收起 (拍照模式)；hide=false 時恢復玩家原本的狀態 */
export function forceFieldbook(hide: boolean) { fbForce = Math.max(0, fbForce + (hide ? 1 : -1)); fbApply(); }
