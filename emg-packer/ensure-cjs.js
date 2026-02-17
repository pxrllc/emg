import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, 'dist-electron');

if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: "commonjs" }));
console.log('Created dist-electron/package.json with type: commonjs');
