/**
 * 點貨車 → 問要做什麼：上車駕駛 / 把手上的東西放上後斗 / 直接拿出後斗裡的某一件。
 * (沒有「看後斗」這一層：要拿什麼就直接列出來點)
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import { ITEMS, type ItemId } from '../field/items';
import { commandMenu, type CommandMenu, type MenuBtn } from './sheet';

export function installTruckMenu(app: GameApp, field: FieldDay) {
  let menu: CommandMenu | null = null;
  const close = () => { const m = menu; menu = null; m?.close(); };

  function open(where: 'cab' | 'bed') {
    if (menu) return;
    const fd = field as AnyObj;
    const carrying = field.carrying;
    const list = (fd.trunkList?.() || []) as { uid: number; item: ItemId; blocked: string | null }[];
    const btns: MenuBtn[] = [];
    const drive: MenuBtn = { id: 'drive', text: '上車駕駛', disabled: carrying ? '手上拿著東西' : undefined };

    if (carrying) {
      btns.push({ id: 'load', text: `把${ITEMS[carrying].name}放上後斗`, kind: 'primary' });
      btns.push(drive);
    } else {
      if (where === 'cab') btns.push({ ...drive, kind: 'primary' });
      // 後斗裡的東西直接列出來拿
      list.forEach(p => btns.push({
        id: `take:${p.uid}`,
        text: `拿出${ITEMS[p.item].name}`,
        disabled: p.blocked || undefined,
      }));
      if (where !== 'cab') btns.push(drive);
      if (list.some(p => p.item === 'water')) btns.push({ id: 'drink', text: '喝一瓶礦泉水', sub: `剩 ${fd.waterBottles} 瓶` });
    }

    menu = commandMenu({
      title: '公司的小貨車',
      sub: carrying ? `手上：${ITEMS[carrying].name}` : list.length ? `後斗：${list.length} 件` : '後斗是空的',
      cls: 'm-truck-menu grid2',
      buttons: btns,
      onPick: (id) => {
        const fd2 = field as AnyObj;
        close();
        if (id === 'load') fd2.openLoader();
        else if (id === 'drive') fd2.mobileEnterTruck();
        else if (id === 'drink') fd2.mobileDrink();
        else if (id.startsWith('take:')) fd2.mobileTakeFromTrunk(Number(id.slice(5)));
      },
      onClose: () => { menu = null; },
    });
  }

  (window as AnyObj).__truckMenu = (where: 'cab' | 'bed') => open(where === 'bed' ? 'bed' : 'cab');
}
