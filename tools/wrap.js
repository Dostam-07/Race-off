const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
const seam = s.indexOf('var gi=(s,e,t)=>{let n=Math.min(1');
const game = s.slice(seam);
// Wrap in an IIFE-ish function so prettier can parse statements
fs.writeFileSync('extract/game_wrapped.js', 'function __GAME_BODY__(){\n' + game + '\n}\n');
