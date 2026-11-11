const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
const re = /yg\s*=\s*["']([0-9]+[a-z]*)["']/g;
let m;
while ((m = re.exec(s))) console.log('THREE revision:', m[1], 'at', m.index);
const i2 = s.indexOf('PeerJS');
console.log('PeerJS ctx:', JSON.stringify(s.slice(i2 - 400, i2 + 100)));
const i3 = s.indexOf('GLTFLoader');
console.log('GLTFLoader ctx:', JSON.stringify(s.slice(i3 - 200, i3 + 100)));
