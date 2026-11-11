const fs = require('fs');
const l = fs.readFileSync('pretty/game.pretty.js', 'utf8').split(/\r?\n/);
const found = {};
for (let i = 0; i < l.length; i++) {
  const m = l[i].match(/^\s{2}(?:var |function )?([A-Za-z0-9_$]{1,3})\s*=\s*(?:function|\()/) || l[i].match(/^\s{2}function ([A-Za-z0-9_$]{1,3})\(/);
  // helpers defined as "x = (a,b)=>..." inside a var chain
  const m2 = l[i].match(/^\s{4}([A-Za-z0-9_$]{1,3})\s*=\s*\(s,\s*e\)\s*=>/) || l[i].match(/^\s{4}([A-Za-z0-9_$]{1,3})\s*=\s*\(s,\s*e,\s*t\)\s*=>/);
  const mm = m2 || m;
  if (mm && !found[mm[1]]) { found[mm[1]] = i + 1; }
}
for (const k of ['fs', 'Hr', 'tt', 'Jt', 'He', 'sn', 'us', 'Rn']) {
  if (found[k]) {
    const ln = found[k];
    console.log('== ' + k + ' at line ' + ln);
    console.log(l.slice(ln - 1, ln + 6).join('\n'));
  } else console.log('== ' + k + ' NOT FOUND');
}
