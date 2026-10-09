/**
 * 點貨車 → 先問要做什麼：上車駕駛 / 看後斗 / 把手上的東西放上去。
 * (桌機是「車頭按 E 上車、車尾按 E 看後斗」，手機點到的位置沒那麼精準，所以改成選單)
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
    const bed: MenuBtn = { id: 'bed', text: `看後斗`, sub: n ? `${n} 件設備` : '空的' };
    const hasWater = !!fd.grid?.has?.('water');
    const drive: MenuBtn = { id: 'drive', text: '上車駕駛', kind: 'primary', disabled: carrying ? '手上拿著東西' : undefined };
    const btns: MenuBtn[] = [];
    if (carrying) {
      btns.push({ id: 'load', text: `把${ITEMS[carrying].name}放上後斗`, kind: 'primary' });
      btns.push({ ...bed, kind: undefined });
      btns.push({ ...drive, kind: undefined });
    } else if (where === 'bed') {
      btns.push({ ...bed, kind: 'primary' }, { ...drive, kind: undefined });
    } else {
      btns.push(drive, bed);
    }
    // 水在後斗裡：站在車邊就可以直接喝一瓶
    if (hasWater && !carrying) btns.push({ id: 'drink', text: '喝一瓶礦泉水', sub: `剩 ${fd.waterBottles} 瓶` });
    menu = commandMenu({
      title: '公司的小貨車',
      sub: carrying ? `手上：${ITEMS[carrying].name}` : undefined,
      cls: 'm-truck-menu grid2',
      buttons: btns,
      onPick: (id) => {
        close();
        const f = field as AnyObj;
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
