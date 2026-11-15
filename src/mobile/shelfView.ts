/**
 * 平視器材架：點貨架 (或架上的設備) → 鏡頭滑到架子正前方、接近水平，
 * 同時疊一張「架子插畫」面板：三層板子、每格一張設備圖，點圖就拿、點空格就放回。
 * 2.5D 俯視下架上的小箱子又小又被屋頂擋，這裡改成大圖示，手指點得到、也看得清楚。
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import type { FollowCamera } from './camera';
import type { MobilePlayer } from './player';
import { ITEMS, type ItemId } from '../field/items';
import { commandMenu, type CommandMenu, type MenuBtn } from './sheet';
import { itemIcon, shortName } from './itemIcons';

interface Slot { i: number; rack: number; level: number; col: number; item: ItemId | null; home: ItemId | null }

const RACK_NAME = ['左側器材架', '右側器材架', '器材架'];

export function installShelfView(app: GameApp, field: FieldDay, cam: FollowCamera, player: MobilePlayer) {
  let menu: CommandMenu | null = null;
  let rack = 0;

  const slotsOf = (r: number): Slot[] => (field as AnyObj).shelfLayout(r) as Slot[];

  function slotHtml(s: Slot, carrying: ItemId | null, need: Set<ItemId>): string {
    if (s.item) {
      const dim = carrying ? ' dim' : '';
      // 今天要帶、還沒上車的：標「要帶」，一眼看得出該拿哪幾件
      const want = need.has(s.item);
      return `<button type="button" class="m-slot${dim}${want ? ' need' : ''}" data-i="${s.i}" data-act="take">
        ${want ? '<em class="m-slot-need">要帶</em>' : ''}${itemIcon(s.item)}<span>${shortName(s.item)}</span></button>`;
    }
    const ghost = s.home ? `<span class="m-slot-ghost">${itemIcon(s.home)}</span>` : '';
    const tag = carrying
      ? (s.home === carrying ? '放回原位' : '放這裡')
      : s.home ? `${shortName(s.home)}（不在架上）` : '空位';
    return `<button type="button" class="m-slot empty${carrying ? ' can' : ''}" data-i="${s.i}" data-act="put">
      ${ghost}<span>${tag}</span></button>`;
  }

  function rackHtml(r: number): string {
    const slots = slotsOf(r);
    const levels = [...new Set(slots.map(s => s.level))].sort((a, b) => b - a); // 上層畫在上面
    const carrying = field.carrying;
    const need = new Set<ItemId>(((field as AnyObj).packNeed?.() || []) as ItemId[]);
    const rows = levels.map(lv => {
      // 鏡頭面向南 (+Z)，世界 +X 在畫面左邊：欄位要反過來排，才和眼前看到的架子一致
      const row = slots.filter(s => s.level === lv).sort((a, b) => b.col - a.col);
      return `<div class="m-shelf-lv" style="grid-template-columns:repeat(${row.length},1fr)">${row.map(s => slotHtml(s, carrying, need)).join('')}</div>
        <div class="m-shelf-board"></div>`;
    }).join('');
    return `<div class="m-shelf"><div class="m-shelf-top">${RACK_NAME[r] ?? RACK_NAME[2]}</div>${rows}</div>`;
  }

  /** 手上這件東西在這座架子上的原位 (空的才算) */
  const homeSlot = (r: number) => {
    const it = field.carrying;
    return it ? slotsOf(r).find(s => !s.item && s.home === it) : undefined;
  };

  /** 還要帶哪幾件、在不在這座架子上 */
  function packNote(): string {
    const need = ((field as AnyObj).packNeed?.() || []) as ItemId[];
    if (!need.length) return '今天要帶的都上車了。';
    const here = new Set(slotsOf(rack).map(s => s.item).filter(Boolean) as ItemId[]);
    const on = need.filter(i => here.has(i)), off = need.filter(i => !here.has(i));
    return `今天還要帶 ${need.length} 件。${on.length ? `這座架子上有：<b>${on.map(i => ITEMS[i].name).join('、')}</b>（標「要帶」的）。` : ''}${off.length ? `${on.length ? '另外' : ''}${off.map(i => ITEMS[i].name).join('、')}不在這座架子上。` : ''}點圖就拿起來（一次一件）。`;
  }

  function buttons(r: number): MenuBtn[] {
    const out: MenuBtn[] = [];
    const hs = homeSlot(r);
    if (hs) out.push({ id: 'home', text: `放回原位（${shortName(field.carrying!)}）`, kind: 'primary' });
    const n = (field as AnyObj).rackCount || 1;
    if (n > 1) out.push({ id: 'other', text: '走去另一座架子', kind: 'ghost' });
    return out;
  }

  function refresh() {
    if (!menu) return;
    const it = field.carrying;
    menu.setTitle(RACK_NAME[rack] ?? RACK_NAME[2], it ? `手上：${ITEMS[it].name}` : '空手');
    menu.setPanel(rackHtml(rack));
    menu.setNote(it ? '點空格 = 把手上的東西放上去。' : packNote());
    menu.setButtons(buttons(rack), pick);
    bind();
  }

  function bind() {
    if (!menu) return;
    menu.root.querySelectorAll<HTMLButtonElement>('.m-slot').forEach(b => {
      b.onclick = (e) => {
        e.stopPropagation();
        const i = Number(b.dataset.i);
        if (b.dataset.act === 'take') {
          if (field.carrying) return;
          if ((field as AnyObj).shelfTake(i)) {
            const info = (field as AnyObj).rackInfo(rack);
            close();
            // 拿了就自動往車尾走（車不在附近就先走出器材室），
            // 不然鏡頭貼著架子，玩家看不到車停在哪
            const tk = (field as AnyObj).truck;
            let dest: { x: number; z: number; label: string } | null =
              info ? { x: info.x, z: info.z - 7.2, label: '走出器材室' } : null;
            if (info && tk?.toWorld && !(field as AnyObj).inTruck) {
              const t = tk.toWorld(-3.8, 0, 0);
              if (Math.hypot(t.x - info.x, t.z - info.z) < 40) dest = { x: t.x, z: t.z, label: '搬去車尾' };
            }
            if (dest) player.walkTo({ x: dest.x, z: dest.z, reach: 0.9, label: dest.label });
          } else refresh();
        } else {
          if (!field.carrying) return;
          if ((field as AnyObj).shelfPut(i)) refresh();
        }
      };
    });
  }

  function pick(id: string) {
    if (id === 'home') {
      const hs = homeSlot(rack);
      if (hs && (field as AnyObj).shelfPut(hs.i)) refresh();
      return;
    }
    if (id === 'other') {
      const n = (field as AnyObj).rackCount || 1;
      const nr = (rack + 1) % n;
      const info = (field as AnyObj).rackInfo(nr);
      close();
      if (!info) return;
      player.walkTo({ x: info.x, z: info.z - 2.1, reach: 0.45, label: `走去${RACK_NAME[nr] ?? RACK_NAME[2]}`, onArrive: () => open(nr) });
    }
  }

  function close() {
    cam.setRack(null);
    const m = menu;
    menu = null;
    m?.close();
  }

  function open(r: number) {
    if (menu) { rack = r; cam.setRack((field as AnyObj).rackInfo(r)); refresh(); return; }
    rack = r;
    cam.setRack((field as AnyObj).rackInfo(r));
    player.cancelWalk();
    menu = commandMenu({
      title: RACK_NAME[r] ?? RACK_NAME[2],
      cls: 'm-shelf-menu',
      panel: rackHtml(r),
      buttons: buttons(r),
      onPick: pick,
      onClose: () => { menu = null; cam.setRack(null); },
    });
    refresh();
  }

  (window as AnyObj).__shelfView = (r: number) => open(Math.max(0, r | 0));
  (window as AnyObj).__mobileShelf = { open, close, get rack() { return rack; } };
}
