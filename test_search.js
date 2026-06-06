const fs = require('fs');
const content = fs.readFileSync('/home/song/Documents/Obsidian/wiki/线控底盘.md', 'utf8');
const contentLower = content.toLowerCase();
const keywords = ["drive-by-wire", "是什么"];
const matches = keywords.some(kw => contentLower.includes(kw) && kw.length >= 2);
console.log("Matches:", matches);
