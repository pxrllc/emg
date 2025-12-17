import { app, BrowserWindow, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable security warnings for local content (if needed)
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true, // For simplicity in this standalone tool (optional)
            contextIsolation: false, // For simplicity
            webSecurity: false // Allow loading local resources freely
        },
        autoHideMenuBar: true
    });

    // Check if we are in development mode
    const isDev = !app.isPackaged;

    if (isDev) {
        // Load from Vite dev server
        mainWindow.loadURL('http://localhost:5173'); // Default Vite port, check if it matches
        mainWindow.webContents.openDevTools();
    } else {
        // Load from built files
        // dist/index.html
        const indexPath = path.join(__dirname, '../dist/index.html');
        mainWindow.loadFile(indexPath);
    }
};

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
