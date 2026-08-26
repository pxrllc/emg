/**
 * ビルド時に package.json の version が埋め込まれる（electron.vite.config.ts / vite.config.mts の define）。
 *
 * 画面に出す版数を直接書かないのは、emg-packer から分岐した以上、
 * 両者のバージョンが独立に動くため。手書きだと必ずどちらかが嘘になる。
 */
declare const __APP_VERSION__: string;
