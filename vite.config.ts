import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// build 產出單一 HTML（所有 JS/CSS 內嵌），放到手機上用瀏覽器打開即可
// QTE 換成手機版的選單實作 (呼叫端不用改)
const qteMobile = new URL('./src/mobile/qteMenu.ts', import.meta.url).pathname;
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  resolve: {
    alias: [{ find: /^\.\/qte$/, replacement: qteMobile }, { find: /\/field\/qte$/, replacement: qteMobile }],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
