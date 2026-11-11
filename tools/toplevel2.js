const fs = require('fs');
const lines = fs.readFileSync('pretty/game.pretty.js', 'utf8').split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^  (?:var |function |async function |class )/.test(l)) {
    out.push(String(i + 1).padStart(6) + '  ' + l.slice(0, 170));
  }
}
console.log('top-level count', out.length);
console.log(out.join('\n'));
