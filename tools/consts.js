const fs = require('fs');
const l = fs.readFileSync('pretty/game.pretty.js', 'utf8').split(/\r?\n/);
const names = ['wa', 'Eb', 'fs', 'Hr', 'tt', 'Jt', 'He', 'sn', 'us', 'fs'];
for (const n of names) {
  for (let i = 0; i < l.length; i++) {
    const re = new RegExp('^\\s*(?:var )?' + n + '\\s*=');
    if (re.test(l[i])) { console.log('==', n, 'line', i + 1); console.log(l.slice(i, i + 8).join('\n')); break; }
  }
}
