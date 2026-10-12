/**
 * 手機版的後斗畫面：
 *  - 格子畫大、每件設備直接畫插畫＋名字，疊在上層的會偏移＋有「2F」標籤，一眼看得出誰壓誰
 *  - 放入：點格子就直接放上去；放不下才顯示紅色預覽並說明原因 (手機版越少步驟越好)
 *  - 取出：可以拿的亮綠框，拿不了的灰掉；點它會把「壓住／擋住它的那幾件」閃紅框，直接看到卡在哪
 */
import type { AnyObj } from '../field/legacy';
import { ITEMS, type ItemId } from '../field/items';
import { COLS, ROWS, LAYERS, footprint, type Placed, type TrunkGrid } from '../field/trunk';
import { itemIcon, shortName } from './itemIcons';
import * as sfx from '../field/sfx';

interface Opts {
  grid: TrunkGrid;
  item: ItemId | null;
  /** 任務指引現在要的那件：標金框，被壓住就直接說要先搬誰 */
  want?: ItemId | null;
  onPlace?: (col: number, row: number, layer: number, rot: boolean) => void;
  onTake?: (p: Placed) => void;
  onClose?: () => void;
}

export function installTrunkView() {
  (window as AnyObj).__trunkView = (o: Opts) => open(o);
}

function open(o: Opts) {
  const grid = o.grid;
  const loading = !!o.item;
  const want = o.want || null;
  const item = o.item as ItemId;
  let rot = false;
  let hover: { col: number; row: number } | null = null;
  let flash: Placed[] = [];

  const bd = document.createElement('div');
  bd.className = 'modal-backdrop show field-modal m-trunk-bd';
  bd.innerHTML = `<div class="m-trunk">
    <div class="m-trunk-head">
      <div><h3>後斗</h3><small>${loading ? `放入：${ITEMS[item].name}　·　先要用的放靠車尾` : '點設備拿出來'}</small></div>
      <button type="button" class="m-cmd-x" data-a="close">離開</button>
    </div>
    <div class="m-trunk-stage">
      <div class="m-trunk-end cab">車頭（裡面）</div>
      <div class="m-trunk-grid"></div>
      <div class="m-trunk-end tail">車尾 · 從這裡搬東西 ↓</div>
    </div>
    <div class="m-trunk-msg"></div>
    <div class="m-trunk-bar"></div>
  </div>`;
  document.body.appendChild(bd);
  if (document.exitPointerLock) document.exitPointerLock();

  const g = bd.querySelector('.m-trunk-grid') as HTMLElement;
  const msgEl = bd.querySelector('.m-trunk-msg') as HTMLElement;
  const bar = bd.querySelector('.m-trunk-bar') as HTMLElement;
  g.style.setProperty('--cols', String(COLS));
  g.style.setProperty('--rows', String(ROWS));

  const close = () => { bd.remove(); o.onClose?.(); };
  (bd.querySelector('[data-a="close"]') as HTMLButtonElement).onclick = (e) => { e.stopPropagation(); close(); };

  const say = (html: string, kind: '' | 'ok' | 'bad' = '') => { msgEl.innerHTML = html; msgEl.className = `m-trunk-msg ${kind}`; };

  /** 格子座標 → CSS grid (車頭在上、車尾在下) */
  const place = (el: HTMLElement, col: number, row: number, w: number, d: number) => {
    el.style.gridColumn = `${col + 1} / span ${w}`;
    el.style.gridRow = `${ROWS - (row + d - 1)} / span ${d}`;
  };

  const anchor = (c: number, r: number) => {
    const { w, d } = footprint(item, rot);
    return { col: Math.max(0, Math.min(c, COLS - w)), row: Math.max(0, Math.min(r - d + 1, ROWS - d)) };
  };

  const render = () => {
    g.innerHTML = '';
    // 空格子
    for (let r = ROWS - 1; r >= 0; r--) for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'm-tcell';
      place(cell, c, r, 1, 1);
      if (loading) cell.onclick = (e) => { e.stopPropagation(); tapCell(c, r); };
      g.appendChild(cell);
    }
    // 已放的設備 (下層先畫)
    [...grid.placed].sort((a, b) => a.layer - b.layer).forEach(p => {
      const { w, d } = footprint(p.item, p.rot);
      const blockers = loading ? [] : grid.blockers(p);
      const isWant = !loading && want === p.item;
      // 被上層壓住的：名字移到左下角，才不會整個被 2F 的卡片蓋掉
      const under = p.layer === 0 && grid.cells(p).some(([c, r]) => !!grid.at(c, r, 1));
      const b = document.createElement(loading ? 'div' : 'button');
      b.className = `m-tblock layer-${p.layer}${loading ? '' : blockers.length ? ' blocked' : ' free'}${isWant ? ' wanted' : ''}${under ? ' under' : ''}${flash.includes(p) ? ' flash' : ''}`;
      b.innerHTML = `${itemIcon(p.item, 'm-ico')}<span>${shortName(p.item)}</span>${p.layer > 0 ? '<em class="lv">2F</em>' : ''}${isWant ? '<em class="wt">要拿這件</em>' : ''}${loading ? '' : blockers.length ? '<i class="lock">✕</i>' : '<i class="ok">↑</i>'}`;
      place(b, p.col, p.row, w, d);
      if (loading) b.style.pointerEvents = 'none';
      else (b as HTMLButtonElement).onclick = (e) => {
        e.stopPropagation();
        if (blockers.length) {
          flash = blockers;
          const how = blockers.some(x => x.layer > p.layer) ? '壓住' : '擋住';
          say(`<b>${shortName(p.item)}</b> 被 <b>${blockers.map(x => shortName(x.item)).join('、')}</b> ${how}了，要先把它們拿走。`, 'bad');
          sfx.error();
          render();
          setTimeout(() => { flash = []; render(); }, 1400);
          return;
        }
        bd.remove();
        o.onTake?.(p);
      };
      g.appendChild(b);
    });
    // 放入預覽
    if (loading) {
      const prev = document.createElement('div');
      prev.className = 'm-tprev';
      prev.style.display = 'none';
      g.appendChild(prev);
    }
    paint();
  };

  const paint = () => {
    bar.innerHTML = '';
    if (!loading) {
      const n = grid.placed.length;
      if (!flash.length) {
        const wp = want ? grid.placed.find(p => p.item === want) : null;
        const wb = wp ? grid.blockers(wp) : [];
        if (wp && wb.length) say(`要拿的是 <b>${shortName(wp.item)}</b>，但被 <b>${wb.map(x => shortName(x.item)).join('、')}</b> 壓住了——先把它們拿下來放旁邊。`, 'bad');
        else if (wp) say(`要拿的是 <b>${shortName(wp.item)}</b>（金色框），點它就拿出來。`, 'ok');
        else say(n ? '綠色＝可以直接拿；灰色＝被壓住或擋住，點它會告訴你卡在哪。' : '後斗是空的。');
      }
      return;
    }
    const prev = g.querySelector('.m-tprev') as HTMLElement;
    const { w, d } = footprint(item, rot);
    let can = false;
    if (hover) {
      const a = anchor(hover.col, hover.row);
      const res = grid.drop(item, a.col, a.row, rot);
      prev.style.display = '';
      place(prev, a.col, a.row, w, d);
      prev.className = `m-tprev layer-${Math.min(res.layer, LAYERS - 1)}${res.reason ? ' bad' : ''}`;
      prev.innerHTML = `${itemIcon(item, 'm-ico')}<span>${shortName(item)}</span>${res.layer > 0 && !res.reason ? '<em class="lv">2F</em>' : ''}`;
      can = !res.reason;
      if (res.reason) say(res.reason, 'bad');
      else if (res.layer === 0) say('放在<b>底層</b>。', 'ok');
      else say(`疊在 <b>${res.on.map(p => shortName(p.item)).join('、')}</b> 上面（第 2 層）。`, 'ok');
    } else {
      prev.style.display = 'none';
      say(`點一個格子，<b>${shortName(item)}</b>就直接放上去；放不下會告訴你為什麼。`);
    }
    const btn = (t: string, cls: string, on: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `m-tbtn ${cls}`;
      b.textContent = t;
      b.onclick = (e) => { e.stopPropagation(); on(); };
      bar.appendChild(b);
    };
    const { w: fw, d: fd2 } = footprint(item, true);
    if (fw !== w || fd2 !== d) btn(rot ? '轉回來' : '旋轉 90°', 'ghost', () => { rot = !rot; render(); });
    void can;
  };

  const tapCell = (c: number, r: number) => {
    // 點一下就直接放上去；放不下才顯示預覽和原因
    const a = anchor(c, r);
    const res = grid.drop(item, a.col, a.row, rot);
    if (!res.reason) { bd.remove(); o.onPlace?.(a.col, a.row, res.layer, rot); return; }
    sfx.error();
    hover = { col: c, row: r };
    paint();
  };

  render();
}
