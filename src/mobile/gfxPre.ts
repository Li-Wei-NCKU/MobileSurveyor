/** 場景建立前先決定效能參數 (scene.js 會讀 window.__mobileGfx) */
import { detectGfx } from './gfx';
(window as unknown as { __mobileGfx: unknown }).__mobileGfx = detectGfx();
