const fs = require('fs');
const path = require('path');
const assets = JSON.parse(fs.readFileSync('extract/assets.json', 'utf8'));
const music = JSON.parse(fs.readFileSync('extract/music.json', 'utf8'));
const thumbs = JSON.parse(fs.readFileSync('extract/thumbs.json', 'utf8'));

const outModels = 'public/models';
const outMusic = 'public/music';
const outThumbs = 'public/thumbs';
for (const d of [outModels, outMusic, outThumbs]) fs.mkdirSync(d, { recursive: true });

let total = 0;
for (const [name, b64] of Object.entries(assets)) {
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(outModels, name + '.glb'), buf);
  total += buf.length;
  if (buf.slice(0, 4).toString('ascii') !== 'glTF') console.log('BAD MAGIC', name, buf.slice(0, 8));
}
console.log('models:', Object.keys(assets).length, 'bytes:', total);

for (const [name, v] of Object.entries(music)) {
  const b64 = typeof v === 'string' ? v : v.b64;
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(outMusic, name + '.mp3'), buf);
  console.log('music', name, buf.length, buf.slice(0, 3).toString('ascii'));
}

for (const [name, dataUrl] of Object.entries(thumbs)) {
  const b64 = dataUrl.split(',')[1];
  fs.writeFileSync(path.join(outThumbs, name + '.jpg'), Buffer.from(b64, 'base64'));
}
console.log('thumbs:', Object.keys(thumbs).join(', '));
