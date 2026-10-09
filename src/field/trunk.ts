/**
 * 後斗格位邏輯 (純資料，不含 3D)
 *  - cols：寬度方向 (0 = 駕駛側)
 *  - rows：長度方向 (0 = 車尾 / 尾門側，數字越大越靠近車頭)
 *  - layers：0 = 底層，1 = 疊在上面
 * 規則 (重力式擺放：玩家只選位置，物品自動疊到最上面)：
 *  - 底面要平：物品覆蓋的每一格高度必須相同，才放得穩
 *  - 最多疊 LAYERS 層
 *  - 取出物品時：上方不可被壓住，且朝尾門方向 (row 較小) 同一層不可被擋住
 */
import { ITEMS, type ItemId } from './items';

export const COLS = 3;
export const ROWS = 4;
export const LAYERS = 2;

export interface Placed {
  uid: number;
  item: ItemId;
  col: number;
  row: number;
  layer: number;
  rot: boolean; // true: w/d 互換
}

export function footprint(item: ItemId, rot: boolean): { w: number; d: number } {
  const def = ITEMS[item];
  return rot ? { w: def.d, d: def.w } : { w: def.w, d: def.d };
}

let uidSeq = 1;

export class TrunkGrid {
  placed: Placed[] = [];

  cells(p: Pick<Placed, 'item' | 'col' | 'row' | 'layer' | 'rot'>): [number, number, number][] {
    const { w, d } = footprint(p.item, p.rot);
    const out: [number, number, number][] = [];
    for (let c = p.col; c < p.col + w; c++) for (let r = p.row; r < p.row + d; r++) out.push([c, r, p.layer]);
    return out;
  }

  at(col: number, row: number, layer: number): Placed | undefined {
    return this.placed.find(p => this.cells(p).some(([c, r, l]) => c === col && r === row && l === layer));
  }

  /** 某格目前疊了幾層 */
  heightAt(col: number, row: number): number {
    let h = 0;
    while (h < LAYERS && this.at(col, row, h)) h++;
    return h;
  }

  /**
   * 重力式擺放：回傳物品會落在哪一層，或不能放的原因
   * (底面不平時指出哪一件比較高)
   */
  drop(item: ItemId, col: number, row: number, rot: boolean): { layer: number; reason: string | null; on: Placed[] } {
    const { w, d } = footprint(item, rot);
    if (col < 0 || row < 0 || col + w > COLS || row + d > ROWS) return { layer: 0, reason: '超出後斗範圍', on: [] };
    let maxH = 0, minH = LAYERS;
    for (let c = col; c < col + w; c++) for (let r = row; r < row + d; r++) {
      const h = this.heightAt(c, r);
      maxH = Math.max(maxH, h); minH = Math.min(minH, h);
    }
    const on = new Set<Placed>();
    if (maxH > 0) for (let c = col; c < col + w; c++) for (let r = row; r < row + d; r++) {
      const below = this.at(c, r, maxH - 1); if (below) on.add(below);
    }
    if (maxH >= LAYERS) return { layer: maxH, reason: `最多疊 ${LAYERS} 層，這裡已經滿了`, on: [...on] };
    if (maxH !== minH) {
      const tall = [...on].map(p => ITEMS[p.item].name).join('、');
      return { layer: maxH, reason: `底下不平：一半壓在${tall}上、一半懸空，放不穩`, on: [...on] };
    }
    return { layer: maxH, reason: null, on: [...on] };
  }

  /** 檢查能否放置；回傳 null 代表可以，否則為原因 */
  canPlace(item: ItemId, col: number, row: number, layer: number, rot: boolean): string | null {
    const { w, d } = footprint(item, rot);
    if (col < 0 || row < 0 || layer < 0 || col + w > COLS || row + d > ROWS || layer >= LAYERS) return '超出後斗範圍';
    for (let c = col; c < col + w; c++) for (let r = row; r < row + d; r++) {
      if (this.at(c, r, layer)) return '這裡已經有東西';
      if (layer > 0 && !this.at(c, r, layer - 1)) return '下面要有東西撐著';
    }
    return null;
  }

  /** 自動找最低、最靠近車頭的可用位置 (收工時快速裝車用) */
  findSpot(item: ItemId): { col: number; row: number; layer: number; rot: boolean } | null {
    for (let layer = 0; layer < LAYERS; layer++) {
      for (let row = ROWS - 1; row >= 0; row--) {
        for (let col = 0; col < COLS; col++) {
          for (const rot of [false, true]) {
            if (!this.canPlace(item, col, row, layer, rot)) return { col, row, layer, rot };
          }
        }
      }
    }
    return null;
  }

  place(item: ItemId, col: number, row: number, layer: number, rot: boolean): Placed {
    const p: Placed = { uid: uidSeq++, item, col, row, layer, rot };
    this.placed.push(p);
    return p;
  }

  /** 取出前檢查；回傳擋路的物品 (若可直接取出則為空陣列) */
  blockers(p: Placed): Placed[] {
    const found = new Set<Placed>();
    const mine = this.cells(p);
    // 壓在上面
    for (const [c, r, l] of mine) {
      const above = this.at(c, r, l + 1);
      if (above && above !== p) found.add(above);
    }
    // 朝尾門方向的同層障礙
    const { w } = footprint(p.item, p.rot);
    for (let c = p.col; c < p.col + w; c++) {
      for (let r = 0; r < p.row; r++) {
        const o = this.at(c, r, p.layer);
        if (o && o !== p) found.add(o);
      }
    }
    return [...found];
  }

  remove(p: Placed) {
    this.placed = this.placed.filter(x => x !== p);
  }

  has(item: ItemId): boolean {
    return this.placed.some(p => p.item === item);
  }

  usedCells(): number {
    return this.placed.reduce((n, p) => n + this.cells(p).length, 0);
  }
}
