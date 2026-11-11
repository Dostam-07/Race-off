const fs = require('fs');
const l = fs.readFileSync('pretty/game.pretty.js', 'utf8').split(/\r?\n/);
const pats = ['MAXSPD', 'maxSpeed', 'vmax', 'speedCap', 'giveBoost', 'driftCharge', 'steerRate', 'grip', 'accelRate', 'hop', 'trick', 'grade'];
for (const p of pats) {
  const hits = [];
  for (let i = 0; i < l.length; i++) if (l[i].includes(p) && hits.length < 6) hits.push(i + 1);
  console.log(p.padEnd(14), hits.join(', '));
}
