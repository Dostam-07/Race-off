const fs = require('fs');
const l = fs.readFileSync('pretty/game.pretty.js', 'utf8').split(/\r?\n/);
// find assignment using giveBoost definition
for (let i = 0; i < l.length; i++) {
  if (/giveBoost\s*=|giveBoost\([^)]*\)\s*\{/.test(l[i])) console.log(i + 1, l[i].trim().slice(0, 120));
}
console.log('---class decls---');
for (let i = 0; i < l.length; i++) {
  if (/class\s+\w*\s*(extends|\{)/.test(l[i]) && /^\s*(var|let|const|[A-Za-z_$])/.test(l[i])) {
    console.log(i + 1, l[i].trim().slice(0, 110));
  }
}
