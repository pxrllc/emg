const electron = require('electron');
console.log('Electron object keys:', Object.keys(electron));
try {
    const { app } = electron;
    console.log('App object type:', typeof app);
    console.log('Is app.whenReady function?', app && typeof app.whenReady === 'function');
    if (app) {
        console.log('Electron required successfully.');
        app.quit();
    } else {
        console.error('Electron require returned object but app is missing.');
    }
} catch (e) {
    console.error('Error accessing app:', e);
}
