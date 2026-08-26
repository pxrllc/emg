import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('./package.json')

/**
 * ブラウザ向けの設定（`npm run dev:web` / `npm run build:web`）。
 *
 * src/renderer/ は Electron / Node の API を一切使っていないため、
 * **Electron 版とまったく同じコードがそのままブラウザで動きます**。
 * emg-web-packer のように別アプリを用意する必要はありません
 * （分岐で services/ が 2 系統になった以上、3 つ目の複製は作らない）。
 *
 * 出力先は Electron ビルド（out/renderer）と分けます。
 * https://vitejs.dev/config/
 */
export default defineConfig({
    plugins: [react()],
    // GitHub Pages のサブディレクトリ（/editor/）配信で必要
    base: './',
    build: {
        outDir: 'dist-web',
        emptyOutDir: true,
    },
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
})
