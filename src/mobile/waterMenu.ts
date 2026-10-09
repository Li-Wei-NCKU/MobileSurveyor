/**
 * 點地上那箱礦泉水 → 問要喝一瓶還是整箱搬走。
 * (手機版沒有「喝水」常駐按鍵，渴了就去點水)
 */
import type { GameApp, AnyObj } from '../field/legacy';
import type { FieldDay } from '../field/fieldDay';
import { commandMenu, type CommandMenu } from './sheet';

export function installWaterMenu(app: GameApp, field: FieldDay) {
  let menu: CommandMenu | null = null;
  const close = () => { const m = menu; menu = null; m?.close(); };

  (window as AnyObj).__waterMenu = (uid: number) => {
    if (menu) return;
    const fd = field as AnyObj;
    const left = fd.waterBottles as number;
    menu = commandMenu({
      title: '礦泉水（一箱）',
      sub: `還有 ${left} 瓶・水分 ${Math.round(fd.water)}%`,
      cls: 'm-water-menu grid2',
      buttons: [
        { id: 'drink', text: '喝一瓶', kind: 'primary', disabled: left <= 0 ? '喝完了' : undefined },
        { id: 'take', text: '整箱搬起來', sub: '很重，走得慢' },
      ],
      onPick: (id) => {
        close();
        if (id === 'drink') fd.mobileDrink();
        else if (id === 'take') fd.mobilePickGround(uid);
      },
      onClose: () => { menu = null; },
    });
  };
}
