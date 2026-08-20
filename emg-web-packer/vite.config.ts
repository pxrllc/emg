import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')

// 変換ロジックは emg-packer と共有する（コピーしない）。
// emg-packer/src/renderer/services/ は Electron/Node に依存しておらず
// （ag-psd + jszip + ブラウザ標準APIのみ）、そのままブラウザで動く。
// この前提が崩れると当プロジェクトのビルドも壊れるため、services/ に
// Electron 固有のコードを入れないこと。
const packerServices = path.resolve(repoRoot, 'emg-packer/src/renderer/services')

export default defineConfig({
    plugins: [react()],
    base: './', // GitHub Pages のサブディレクトリ配信で必要
    resolve: {
        alias: {
            '@packer': packerServices,
            // emg-packer 側にも ag-psd / jszip がインストールされているため、
            // 何もしないと同じパッケージの実体が2つ読み込まれ、TypeScript が
            // 「別々の型」として扱ってしまう（Psd や Layer の代入でエラーになる）。
            // 解決先を当プロジェクトの node_modules に固定して1つに揃える。
            'ag-psd': path.resolve(dirname, 'node_modules/ag-psd'),
            'jszip': path.resolve(dirname, 'node_modules/jszip'),
        },
    },
    server: {
        fs: {
            // emg-packer 側のソースを直接読むため、プロジェクト外の参照を許可する
            allow: [repoRoot],
        },
    },
})
