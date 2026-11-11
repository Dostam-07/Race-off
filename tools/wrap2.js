const fs = require('fs');
const full = fs.readFileSync('extract/app.js', 'utf8'); // starts with (()=>{ ... })();
const seam = full.indexOf('var gi=(s,e,t)=>{let n=Math.min(1');
const game = full.slice(seam);
// game ends with "})();" which closes the outer IIFE. Remove that trailing closer.
const tail = game.slice(-8);
console.log('tail', JSON.stringify(tail));
const body = game.slice(0, game.lastIndexOf('})();'));
fs.writeFileSync('extract/game_body.js', 'function __GAME_BODY__(){\n' + body + '\n}\n');
console.log('body len', body.length);
