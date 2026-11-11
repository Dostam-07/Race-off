const fs = require('fs');
const g = fs.readFileSync('extract/game.js', 'utf8');
// The error is at line 426 col 35505 of the wrapped file (line 425 of game). Find the offset.
const lines = g.split('\n');
console.log('total lines', lines.length);
console.log('line425 length', lines[424].length);
// show a window around col 35505 of that line
const L = lines[424];
console.log('--- around 35300 ---');
console.log(JSON.stringify(L.slice(35300, 35700)));
