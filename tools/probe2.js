const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
// Find distinctive game-domain strings
const probes = [
  'CORAL COVE', 'THUNDER TEMPLE', 'MAGMA PEAK', 'GRAND PRIX', 'kart', 'drift', 'turbo',
  'coin', 'lap', 'beach', 'jungle', 'volcano', 'sky', 'ASSETS', 'MUSIC', 'LOBBY',
  'banana', 'item', 'minimap', 'position', 'player', 'engine', 'cheer', 'horn'
];
for (const p of probes) {
  const idxs = [];
  let i = -1;
  while ((i = s.indexOf(p, i + 1)) !== -1 && idxs.length < 6) idxs.push(i);
  console.log(p.padEnd(16), idxs.join(', '));
}
