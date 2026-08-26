import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const pkg = createRequire(import.meta.url)('./package.json')

// Electron を使わずブラウザで renderer を動かすための設定（npm run dev:web）。
// src/renderer/ は Electron/Node API を使っていないため、そのまま Vite で動く。
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
})
