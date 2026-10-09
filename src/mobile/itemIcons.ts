/**
 * 設備插畫：每件設備一張手繪風 SVG (viewBox 100×100)，給手機版「平視器材架」介面點選用。
 * 用 ITEMS 裡的顏色，保持和 3D 模型同一個色系，玩家一眼就能對上架上的東西。
 */
import { ITEMS, type ItemId } from '../field/items';

const INK = '#1f2d3d';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
/** 把顏色調暗 / 調亮，畫陰影面 */
function tint(n: number, f: number) {
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return hex((r << 16) | (g << 8) | b);
}

/** 共用：硬殼儀器箱 (GNSS、基座、水準儀、全站儀、無人機、電池) */
function caseBox(c: number, extra = '') {
  const body = hex(c), dark = tint(c, 0.72), light = tint(c, 1.18);
  return `
    <rect x="12" y="34" width="76" height="46" rx="6" fill="${body}" stroke="${INK}" stroke-width="3"/>
    <path d="M12 50h76" stroke="${INK}" stroke-width="2.5"/>
    <rect x="12" y="50" width="76" height="30" rx="5" fill="${dark}" stroke="${INK}" stroke-width="3"/>
    <path d="M36 34v-6a14 9 0 0 1 28 0v6" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <rect x="24" y="45" width="12" height="10" rx="2" fill="${light}" stroke="${INK}" stroke-width="2.5"/>
    <rect x="64" y="45" width="12" height="10" rx="2" fill="${light}" stroke="${INK}" stroke-width="2.5"/>
    ${extra}`;
}

/** 共用：紙箱 / 工具箱 */
function carton(c: number, extra = '') {
  const body = hex(c), dark = tint(c, 0.78);
  return `
    <rect x="14" y="40" width="72" height="42" rx="4" fill="${body}" stroke="${INK}" stroke-width="3"/>
    <path d="M14 52h72" stroke="${INK}" stroke-width="2.5"/>
    <path d="M14 40l36-12 36 12" fill="${dark}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    ${extra}`;
}

const ICONS: Record<ItemId, () => string> = {
  // 黃色 GNSS 箱，上面貼一張天線貼紙
  gnss: () => caseBox(ITEMS.gnss.color, `
    <circle cx="50" cy="64" r="8" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
    <path d="M50 58v12M44 64h12" stroke="${INK}" stroke-width="2"/>`),
  tribrach: () => caseBox(ITEMS.tribrach.color, `
    <path d="M40 70l10-10 10 10z" fill="#fff" stroke="${INK}" stroke-width="2.5"/>`),
  level: () => caseBox(ITEMS.level.color, `
    <rect x="38" y="60" width="24" height="8" rx="4" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="50" cy="64" r="2" fill="${INK}"/>`),
  totalstation: () => caseBox(ITEMS.totalstation.color, `
    <rect x="40" y="58" width="20" height="14" rx="3" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="50" cy="65" r="3.5" fill="${INK}"/>`),
  drone: () => caseBox(ITEMS.drone.color, `
    <path d="M38 58l24 16M62 58L38 74" stroke="#cfd8dc" stroke-width="3" stroke-linecap="round"/>
    <circle cx="50" cy="66" r="4" fill="#cfd8dc"/>`),
  battery: () => caseBox(ITEMS.battery.color, `
    <rect x="36" y="58" width="28" height="14" rx="3" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
    <rect x="39" y="61" width="6" height="8" fill="#2e7d32"/><rect x="47" y="61" width="6" height="8" fill="#2e7d32"/>
    <rect x="55" y="61" width="6" height="8" fill="#2e7d32"/>`),

  // 木三腳架
  tripod: () => {
    const w = hex(ITEMS.tripod.color), d = tint(ITEMS.tripod.color, 0.75);
    return `
      <path d="M50 26L20 84M50 26l30 58M50 26v54" stroke="${w}" stroke-width="7" stroke-linecap="round"/>
      <path d="M50 26L20 84M50 26l30 58M50 26v54" stroke="${INK}" stroke-width="2" fill="none" opacity=".55"/>
      <path d="M28 62h18M54 62h18" stroke="${d}" stroke-width="4" stroke-linecap="round"/>
      <ellipse cx="50" cy="24" rx="17" ry="6" fill="#b0bec5" stroke="${INK}" stroke-width="3"/>
      <rect x="45" y="18" width="10" height="7" rx="2" fill="#78909c" stroke="${INK}" stroke-width="2.5"/>`;
  },
  // 水準尺：紅白 E 字分劃
  staff: () => {
    let marks = '';
    for (let i = 0; i < 8; i++) {
      const y = 14 + i * 9.4;
      marks += `<rect x="40" y="${y}" width="20" height="4.6" fill="${i % 2 ? '#b42318' : '#1f2d3d'}"/>`;
    }
    return `
      <rect x="38" y="10" width="24" height="80" rx="3" fill="#f4f6f8" stroke="${INK}" stroke-width="3"/>
      ${marks}
      <rect x="34" y="86" width="32" height="7" rx="2" fill="#90a4ae" stroke="${INK}" stroke-width="2.5"/>`;
  },
  // 稜鏡桿
  prism: () => {
    let bands = '';
    for (let i = 0; i < 5; i++) bands += `<rect x="45" y="${34 + i * 11}" width="10" height="5.5" fill="#d62828"/>`;
    return `
      <rect x="45" y="30" width="10" height="58" fill="#fff" stroke="${INK}" stroke-width="2.5"/>
      ${bands}
      <circle cx="50" cy="20" r="12" fill="#37474f" stroke="${INK}" stroke-width="3"/>
      <circle cx="50" cy="20" r="6.5" fill="#64b5f6" stroke="${INK}" stroke-width="2"/>
      <path d="M44 88h12v6H44z" fill="#90a4ae" stroke="${INK}" stroke-width="2"/>`;
  },
  // RTK 移動站：對中桿 + 接收儀 + 手簿
  rtk: () => `
    <rect x="46" y="28" width="8" height="60" fill="#eceff1" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="50" cy="24" rx="20" ry="8" fill="${hex(ITEMS.rtk.color)}" stroke="${INK}" stroke-width="3"/>
    <path d="M30 24v4a20 8 0 0 0 40 0v-4" fill="${tint(ITEMS.rtk.color, 0.75)}" stroke="${INK}" stroke-width="3"/>
    <rect x="58" y="48" width="22" height="26" rx="3" fill="#263238" stroke="${INK}" stroke-width="2.5"/>
    <rect x="61" y="51" width="16" height="12" rx="1.5" fill="#7ec8e3"/>
    <path d="M46 88h8v6h-8z" fill="#90a4ae" stroke="${INK}" stroke-width="2"/>`,
  // 外業工具袋
  toolbag: () => `
    <path d="M20 44h60l-5 38H25z" fill="${hex(ITEMS.toolbag.color)}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M30 44c0-12 8-18 20-18s20 6 20 18" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <rect x="36" y="54" width="28" height="18" rx="3" fill="${tint(ITEMS.toolbag.color, 1.5)}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M44 54v18M56 54v18" stroke="${INK}" stroke-width="2" opacity=".6"/>`,
  // 噴漆箱：露出兩罐漆
  paint: () => carton(ITEMS.paint.color, `
    <rect x="26" y="22" width="14" height="24" rx="3" fill="#f4f6f8" stroke="${INK}" stroke-width="2.5"/>
    <rect x="29" y="16" width="8" height="7" rx="2" fill="#90a4ae" stroke="${INK}" stroke-width="2"/>
    <rect x="58" y="22" width="14" height="24" rx="3" fill="#2b2f36" stroke="${INK}" stroke-width="2.5"/>
    <rect x="61" y="16" width="8" height="7" rx="2" fill="#90a4ae" stroke="${INK}" stroke-width="2"/>`),
  // 鐵鎚與鋼釘
  hammer: () => carton(ITEMS.hammer.color, `
    <rect x="30" y="56" width="40" height="7" rx="3" fill="#8d6e63" stroke="${INK}" stroke-width="2.5" transform="rotate(-18 50 60)"/>
    <rect x="22" y="44" width="18" height="14" rx="3" fill="#607d8b" stroke="${INK}" stroke-width="2.5" transform="rotate(-18 31 51)"/>
    <path d="M56 70l4 10M64 68l3 11M72 66l2 11" stroke="#cfd8dc" stroke-width="3" stroke-linecap="round"/>`),
  // 交通錐
  cones: () => {
    const c = (x: number, s: number) => `
      <path d="M${x} 30l${12 * s} ${48 * s}h${-24 * s}z" fill="${hex(ITEMS.cones.color)}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M${x - 7 * s} ${54 * s + 30}h${14 * s}" stroke="#fff" stroke-width="${6 * s}"/>
      <rect x="${x - 15 * s}" y="${78 * s + 28}" width="${30 * s}" height="${6 * s}" rx="2" fill="${tint(ITEMS.cones.color, 0.75)}" stroke="${INK}" stroke-width="2.5"/>`;
    return `<g transform="translate(-14 10) scale(0.78)">${c(44, 1)}</g><g transform="translate(16 2) scale(0.92)">${c(44, 1)}</g>`;
  },
  // 航測標模板：折疊木框 + 遮板
  template: () => `
    <rect x="18" y="26" width="64" height="56" rx="3" fill="none" stroke="${hex(ITEMS.template.color)}" stroke-width="9"/>
    <rect x="18" y="26" width="64" height="56" rx="3" fill="none" stroke="${INK}" stroke-width="2.5"/>
    <path d="M50 26v56M18 54h64" stroke="${hex(ITEMS.template.color)}" stroke-width="7"/>
    <path d="M50 26v56M18 54h64" stroke="${INK}" stroke-width="1.6" opacity=".5"/>
    <rect x="22" y="30" width="24" height="20" fill="#f4f6f8" stroke="${INK}" stroke-width="2"/>
    <rect x="54" y="58" width="24" height="20" fill="#f4f6f8" stroke="${INK}" stroke-width="2"/>`,
  // 礦泉水一箱
  water: () => {
    let b = '';
    for (let i = 0; i < 3; i++) {
      const x = 24 + i * 20;
      b += `<rect x="${x}" y="30" width="13" height="26" rx="3" fill="#cfeaf8" stroke="${INK}" stroke-width="2.5"/>
            <rect x="${x + 3.5}" y="24" width="6" height="7" rx="2" fill="#1f7ab8" stroke="${INK}" stroke-width="2"/>`;
    }
    return `${b}
      <rect x="16" y="52" width="68" height="30" rx="4" fill="${hex(ITEMS.water.color)}" stroke="${INK}" stroke-width="3"/>
      <path d="M16 64h68" stroke="#fff" stroke-width="5" opacity=".7"/>`;
  },
  // 鐵墊兩個
  plate: () => `
    <ellipse cx="38" cy="60" rx="26" ry="12" fill="${tint(ITEMS.plate.color, 1.5)}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="38" cy="56" rx="26" ry="12" fill="${hex(ITEMS.plate.color)}" stroke="${INK}" stroke-width="3"/>
    <path d="M38 50v12M30 56h16" stroke="#cfd8dc" stroke-width="2.5"/>
    <ellipse cx="62" cy="74" rx="24" ry="11" fill="${tint(ITEMS.plate.color, 1.5)}" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="62" cy="70" rx="24" ry="11" fill="${hex(ITEMS.plate.color)}" stroke="${INK}" stroke-width="3"/>
    <path d="M62 64v12M54 70h16" stroke="#cfd8dc" stroke-width="2.5"/>`,
};

/** 一件設備的 SVG (給 slot 用) */
export function itemIcon(id: ItemId, cls = 'm-ico'): string {
  const inner = ICONS[id] ? ICONS[id]() : caseBox(ITEMS[id]?.color ?? 0x8d99ae);
  return `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
}

/** 架上標籤用的短名 (去掉括號說明) */
export function shortName(id: ItemId): string {
  return (ITEMS[id]?.name || id).replace(/（[^）]*）/g, '');
}
