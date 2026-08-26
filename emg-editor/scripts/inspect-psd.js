const { readPsd } = require('../node_modules/ag-psd/dist/index.js');
const fs = require('fs');
const path = require('path');

const buf = fs.readFileSync(path.join(__dirname, '../asset/himari.psd'));
const psd = readPsd(buf.buffer, {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
    useImageData: true,
});

console.log('PSD size:', psd.width, 'x', psd.height);
console.log('PSD id:', psd.id);
console.log('Top-level children:', psd.children ? psd.children.length : 0);
console.log('');

function printLayer(layer, depth) {
    const pad = '  '.repeat(depth);
    const hasCanvas = layer.canvas !== undefined && layer.canvas !== null;
    const hasImageData = layer.imageData !== undefined && layer.imageData !== null;
    const childCount = layer.children ? layer.children.length : 0;
    console.log(
        pad + (layer.name || 'unnamed'),
        '| id:', layer.id,
        '| canvas:', hasCanvas,
        '| imageData:', hasImageData,
        '| hidden:', layer.hidden,
        '| opacity:', layer.opacity,
        '| children:', childCount
    );
    if (layer.children) {
        layer.children.forEach(function(c) { printLayer(c, depth + 1); });
    }
}

if (psd.children) {
    psd.children.forEach(function(c) { printLayer(c, 0); });
}
