const fs = require('fs');
const lines = fs.readFileSync('pretty/game.pretty.js', 'utf8').split('\n');
// top-level statements start at column 2 (inside wrapper) with 'var ' or 'function ' or 'const ' etc
const out = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^  (var|let|const|function|class|async function)\s/.test(l)) {
    out.push(String(i + 1).padStart(6) + '  ' + l.slice(0, 150));
  }
}
console.log('top-level count', out.length);
console.log(out.join('\n'));
