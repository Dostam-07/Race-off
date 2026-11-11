import fs from 'node:fs';

// The old brand name, built from char codes so this repo never contains the
// literal string anywhere (the checker itself included).
const OLD = String.fromCharCode(84, 117, 114, 98, 111) + ' ' +
  String.fromCharCode(84, 97, 105, 108, 115);

const html = fs.readFileSync('index.html', 'utf8');
console.log('title Race-Off:', /<title>Race-Off[\u2014-]?/.test(html));
console.log('favicon link:', html.includes('rel="icon"'));
console.log('html youtube refs:', (html.match(/youtube|youtu\.be/gi) || []).length);

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
console.log('pkg name:', pkg.name);

let src = '';
for (const f of fs.readdirSync('src', { recursive: true })) {
  if (!/\.(js|css)$/.test(String(f))) continue;
  src += fs.readFileSync('src/' + f, 'utf8');
}
console.log('src youtube refs:', (src.match(/youtube|youtu\.be/gi) || []).length);
console.log('src old-brand refs:', (src.match(new RegExp(OLD, 'gi')) || []).length);
console.log('src old storage keys:', (src.match(/['"]tt-[a-z]+['"]/g) || []).length);
