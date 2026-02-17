import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

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
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'index.html')
                }
            }
        }
    }
});
