const fs = require('fs');
const l = fs.readFileSync('pretty/game.pretty.js', 'utf8').split(/\r?\n/);
for (let i = 0; i < l.length; i++) {
  const m = l[i].match(/^\s*name:\s*"([A-Z ]+)",\s*$/);
  if (m) console.log('line', i + 1, 'NAME', m[1]);
  const s = l[i].match(/^\s*sub:\s*"([^"]+)",\s*$/);
  if (s) console.log('   sub:', s[1]);
}
