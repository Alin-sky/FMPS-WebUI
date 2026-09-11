import { cosClient } from '../src/icons-cos.js';
const cos = await cosClient();
console.log('=== 修复后：listPrefix 是否还重复 / 耗时 ===');
for (const p of ['json/', 'data/', 'stu_icon_db_png/', 'stu_icon_db/', 'gacha-img/']) {
  const t0 = Date.now();
  const all = await cos.listPrefix(p);
  const m = new Map(all.map((o) => [o.key, o]));
  const ok = all.length === m.size ? 'OK 无重复' : 'FAIL 仍有重复';
  console.log(`${p.padEnd(18)} 返回 ${String(all.length).padStart(5)}  去重 ${String(m.size).padStart(4)}  ${ok}  ${Date.now() - t0}ms`);
}
