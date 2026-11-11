const fs = require('fs');
const s = fs.readFileSync('extract/app.js', 'utf8');
// esbuild module pattern: var NAME = xE((exportsName, moduleName) => { ... })
const re = /var ([A-Za-z0-9_$]{1,8})\s*=\s*xE\(\(([A-Za-z0-9_$]{1,8}),([A-Za-z0-9_$]{1,8})\)=>\{/g;
let m;
const mods = [];
while ((m = re.exec(s))) mods.push({ name: m[1], at: m.index, len: 0 });
for (let i = 0; i < mods.length; i++) mods[i].len = (i + 1 < mods.length ? mods[i + 1].at : s.length) - mods[i].at;
console.log('module count', mods.length);
for (const md of mods) {
  if (md.len > 3000) console.log(md.name.padEnd(6), String(md.at).padStart(9), 'len', md.len);
}
