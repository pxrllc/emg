const fs = require('fs');
const JSZip = require('jszip');
const path = require('path');

const filePath = path.join(__dirname, 'asset', 'yuriko.emg');

console.log('Reading file:', filePath);

fs.readFile(filePath, async (err, data) => {
    if (err) {
        console.error('Error reading file:', err);
        return;
    }

    try {
        const zip = await JSZip.loadAsync(data);
        console.log('\nFiles in archive:');
        zip.forEach((relativePath, zipEntry) => {
            console.log('-', relativePath);
        });

        const fileToRead = zip.file('data.json');
        if (fileToRead) {
            const content = await fileToRead.async('string');
            try {
                const data = JSON.parse(content);
                console.log('\nJSON Content Summary:');
                console.log('Version:', data.version);
                console.log('Size:', data.width, 'x', data.height);
                console.log('Textures:', data.textures ? data.textures.length : 0);
                console.log('Layers:', data.layers ? data.layers.length : 0);
                if (data.layers && data.layers.length > 0) {
                    console.log('First 3 layers sample: (omitted for brevity)');
                    // console.log(JSON.stringify(data.layers.slice(0, 3), null, 2));
                }
            } catch (err) {
                console.error('Error parsing JSON:', err);
            }
        } else {
            console.log('\nNo data.json found.');
        }
    } catch (e) {
        console.error('Error processing zip:', e);
    }
});
