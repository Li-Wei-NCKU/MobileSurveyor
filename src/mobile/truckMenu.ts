/**
 * 點貨車 → 問要做什麼：上車駕駛 / 看後車廂 (手上有東西時就是放上後斗)。
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import { ITEMS } from '../field/items';
import { commandMenu, type CommandMenu, type MenuBtn } from './sheet';

export function installTruckMenu(app: GameApp, field: FieldDay) {
  let menu: CommandMenu | null = null;
  const close = () => { const m = menu; menu = null; m?.close(); };

  function open(where: 'cab' | 'bed') {
    if (menu) return;
    const fd = field as AnyObj;
    const carrying = field.carrying;
    const n = fd.grid?.placed?.length ?? 0;
    const btns: MenuBtn[] = [];
    const busy = fd.loadingBlock?.() as string | null;
    const drive: MenuBtn = { id: 'drive', text: '上車駕駛', disabled: carrying ? '手上拿著東西' : busy ? '學弟還在搬東西上車' : undefined };
    const bed: MenuBtn = { id: 'bed', text: '看後車廂', sub: n ? `${n} 件設備` : '空的' };
    if (carrying) {
      btns.push({ id: 'load', text: `把${ITEMS[carrying].name}放上後斗`, kind: 'primary' });
      btns.push(drive);
    } else if (where === 'bed') {
      btns.push({ ...bed, kind: 'primary' }, drive);
    } else {
      btns.push({ ...drive, kind: 'primary' }, bed);
    }
    // 渴了而且水在後斗：順手給一顆
    if (!carrying && fd.grid?.has?.('water') && fd.water < 70) btns.push({ id: 'drink', text: '喝一瓶礦泉水', sub: `剩 ${fd.waterBottles} 瓶` });

    menu = commandMenu({
      title: '公司的小貨車',
      sub: carrying ? `手上：${ITEMS[carrying].name}` : n ? `後斗：${n} 件` : '後斗是空的',
      cls: 'm-truck-menu grid2',
      buttons: btns,
      onPick: (id) => {
        const f = field as AnyObj;
        close();
        if (id === 'load') f.openLoader();
        else if (id === 'bed') f.openUnload();
        else if (id === 'drive') f.mobileEnterTruck();
        else if (id === 'drink') f.mobileDrink();
      },
      onClose: () => { menu = null; },
    });
  }

  (window as AnyObj).__truckMenu = (where: 'cab' | 'bed') => open(where === 'bed' ? 'bed' : 'cab');
}
