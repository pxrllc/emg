import { contextBridge } from 'electron';

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', {
            // Expose minimal API for now
        });
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.electron = {};
}
