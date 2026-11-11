const fs = require('fs');
const src = fs.readFileSync('site_index.html', 'utf8');
const start = src.indexOf('<style>') + '<style>'.length;
const end = src.indexOf('</style>', start);
let css = src.slice(start, end);
fs.mkdirSync('src/styles', { recursive: true });
fs.writeFileSync('src/styles/game.css', css.trim() + '\n');
console.log('css bytes', css.length, 'lines', css.split('\n').length);
// also capture body markup for reference
const bs = src.indexOf('<body>') + '<body>'.length;
const be = src.indexOf('<script>window.ASSETS');
fs.writeFileSync('extract/body.html', src.slice(bs, be).trim());
console.log('body bytes', be - bs);
