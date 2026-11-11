const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
const seam = s.indexOf('var gi=(s,e,t)=>{let n=Math.min(1');
console.log('seam', seam);
fs.writeFileSync('extract/lib.js', s.slice(0, seam));
fs.writeFileSync('extract/game.js', s.slice(seam));
console.log('lib', seam, 'game', s.length - seam);
// Print the game's top-level var declarations to understand structure
const game = s.slice(seam);
const re = /(?:^|[;,{}])\s*var ([A-Za-z0-9_$]+)\s*=/g;
let m; const decls = [];
while ((m = re.exec(game))) decls.push(m[1]);
console.log('decl count', decls.length);
