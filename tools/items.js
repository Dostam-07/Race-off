const fs = require('fs');
const l = fs.readFileSync('pretty/game.pretty.js', 'utf8').split(/\r?\n/);
const keywords = ['"rocket"', '"durian"', '"chili"', '"star"', '"shield"', 'ITEMS', 'itemRoll', 'rollItem'];
for (const k of keywords) {
  const hits = [];
  for (let i = 0; i < l.length; i++) if (l[i].includes(k) && hits.length < 8) hits.push(i + 1);
  console.log(k.padEnd(12), hits.join(', '));
}
