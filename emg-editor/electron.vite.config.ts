import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import pkg from './package.json';

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                external: ['electron'],
                input: {
                    index: resolve(__dirname, 'src/main/index.ts')
                }
            }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()]
    },
    renderer: {
        root: '.',
        plugins: [react()],
        // 画面に出す版数。手書きすると emg-packer と分岐した今、必ずどちらかが嘘になる。
        define: {
            __APP_VERSION__: JSON.stringify(pkg.version),
        },
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'index.html')
                }
            }
        }
    }
});
