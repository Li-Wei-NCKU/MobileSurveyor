// 進入點 (手機版)：依序載入相容墊片、樣式、舊版模組，最後是手機版系統
import './globals';
import './mobile/gfxPre';
import './styles/style.css';

import './legacy/audio.js';
import './legacy/models.js';
import './legacy/scene.js';
import './mobile/player';
import './legacy/levels/level_gnss.js';
import './legacy/levels/level_leveling.js';
import './legacy/levels/level_gcp.js';
import './legacy/levels/level_uav.js';
import './legacy/levels/level_select.js';
import './legacy/main.js';

// 外業系統 (TypeScript) + 手機版
import './styles/field.css';
import './styles/mobile.css';
import './mobile/index';
