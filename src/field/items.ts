/**
 * 外業設備目錄
 * w = 佔用後斗「寬度方向」格數；d = 佔用「長度方向」格數 (rot 時互換)
 */
export type ItemId =
  | 'gnss' | 'tripod' | 'tribrach' | 'toolbag'
  | 'level' | 'staff' | 'totalstation' | 'prism'
  | 'drone' | 'paint' | 'water' | 'hammer' | 'plate' | 'cones'
  | 'template' | 'rtk' | 'battery';

export type ItemKind = 'case' | 'tripod' | 'staff' | 'pole' | 'bag' | 'box' | 'water';

export interface ItemDef {
  id: ItemId;
  name: string;
  w: number;
  d: number;
  heavy: boolean;
  kind: ItemKind;
  color: number;
  /** 一句話描述，顯示於拿起時 */
  note: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  gnss:         { id: 'gnss', name: 'GNSS 接收儀箱', w: 1, d: 1, heavy: false, kind: 'case', color: 0xf2b705, note: '天線、接收儀主機都在裡面。' },
  tripod:       { id: 'tripod', name: '三腳架', w: 1, d: 2, heavy: true, kind: 'tripod', color: 0xe9a514, note: '木腳架，扛起來比想像中重。' },
  tribrach:     { id: 'tribrach', name: '基座箱', w: 1, d: 1, heavy: false, kind: 'case', color: 0x5b6470, note: '光學對點基座，GNSS 和全站儀共用。' },
  toolbag:      { id: 'toolbag', name: '外業工具袋', w: 1, d: 1, heavy: false, kind: 'bag', color: 0x2f5d8a, note: '控制手簿、鋼捲尺、外業紀錄簿。' },
  level:        { id: 'level', name: '自動水準儀箱', w: 1, d: 1, heavy: false, kind: 'case', color: 0x1f7ab8, note: '自動安平水準儀，望遠鏡 32 倍。' },
  staff:        { id: 'staff', name: '水準尺', w: 1, d: 2, heavy: false, kind: 'staff', color: 0xdfe3e8, note: '3 公尺伸縮鋁尺。' },
  totalstation: { id: 'totalstation', name: '全站儀箱', w: 1, d: 1, heavy: true, kind: 'case', color: 0xd9822b, note: '很貴，不要摔。' },
  prism:        { id: 'prism', name: '稜鏡桿', w: 1, d: 2, heavy: false, kind: 'pole', color: 0xd62828, note: '紅白相間的那根。' },
  drone:        { id: 'drone', name: '無人機箱', w: 2, d: 1, heavy: true, kind: 'case', color: 0x23272e, note: '昨天航拍組沒卸下來。' },
  paint:        { id: 'paint', name: '噴漆箱', w: 1, d: 1, heavy: false, kind: 'box', color: 0xb68b5a, note: '黑白工程漆，佈標用。' },
  water:        { id: 'water', name: '礦泉水（一箱）', w: 1, d: 1, heavy: true, kind: 'water', color: 0x8fc7ea, note: '24 瓶，夏天外業必備。' },
  hammer:       { id: 'hammer', name: '鐵鎚與鋼釘', w: 1, d: 1, heavy: false, kind: 'box', color: 0xb42318, note: '打釘用的工具箱。' },
  cones:        { id: 'cones', name: '交通錐（4 個）', w: 1, d: 1, heavy: false, kind: 'box', color: 0xf26b0f, note: '在路邊作業要擺，提醒來車減速。' },
  template:     { id: 'template', name: '航測標模板', w: 1, d: 2, heavy: false, kind: 'box', color: 0xc99a62, note: '1.2 m 折疊木框，加一片擋白格用的遮板。' },
  rtk:          { id: 'rtk', name: 'RTK 移動站', w: 1, d: 2, heavy: false, kind: 'pole', color: 0xf2b705, note: '對中桿、接收儀、手簿一組。' },
  battery:      { id: 'battery', name: '無人機電池箱', w: 1, d: 1, heavy: false, kind: 'case', color: 0x37474f, note: '三顆電池，昨晚充飽了（應該吧）。' },
  plate:        { id: 'plate', name: '尺墊（兩個）', w: 1, d: 1, heavy: true, kind: 'box', color: 0x3a3f47, note: '鑄鐵尺墊，轉點時墊在標尺底下，免得尺陷進土裡。' },
};

/** GNSS 靜態觀測必帶設備 */
export const GNSS_REQUIRED: ItemId[] = ['tripod', 'tribrach', 'gnss', 'toolbag'];
