const electron = require('electron');
console.log('Electron object keys:', Object.keys(electron));
console.log('Electron default:', electron.default);
try {
    const electronNamespace = electron; // It seems to be the namespace? 
    // If keys are 0,1,2... it looks like an array or arguments object??
    console.log('Is array?', Array.isArray(electron));
    console.log('Electron stringified:', JSON.stringify(electron));
    const { app } = electron;
    console.log('App object:', app);
    console.log('Is app.whenReady function?', typeof app.whenReady === 'function');
    if (app) {
        app.quit();
    }
} catch (e) {
    console.error('Error accessing app:', e);
}
