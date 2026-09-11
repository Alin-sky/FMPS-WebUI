// 临时探测：COS 上到底有什么、时间线长什么样
import { cosClient } from '../src/icons-cos.js';

const cos = await cosClient();
console.log('bucket =', cos.cfg.bucket, '| region =', cos.cfg.region);
console.log('');

const prefixes = ['json/', 'data/', 'releases/', 'stu_icon_db_png/', 'stu_icon_db/', 'gacha-img/', 'hash.json'];
for (const p of prefixes) {
  let objs;
  try {
    objs = await cos.listPrefix(p);
  } catch (e) {
    console.log(`--- ${p}  ->  列举失败: ${e.message}`);
    continue;
  }
  if (!objs.length) {
    console.log(`--- ${p}  ->  (空)`);
    continue;
  }
  const times = objs.map((o) => o.mtime).filter(Boolean).sort();
  console.log(`--- ${p}  ->  ${objs.length} 个对象`);
  console.log(`    最早 ${times[0]}   最晚 ${times[times.length - 1]}`);
  const byDay = {};
  for (const t of times) {
    const d = String(t).slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  console.log('    按天:', JSON.stringify(byDay));
  if (p === 'json/' || p === 'data/' || p === 'releases/' || p === 'hash.json') {
    for (const o of objs.slice(0, 60)) console.log(`      ${o.key}  ${o.size}B  ${o.mtime}`);
  }
}
