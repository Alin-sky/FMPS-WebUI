// 只看 manga_info.json 的真实内容差异（这是唯一一个非换行符差异）
import fs from 'fs/promises';
import { cosClient } from '../src/icons-cos.js';
import { config } from '../src/config.js';
import path from 'path';

const cos = await cosClient();
const cloud = JSON.parse((await cos.get('data/manga_info.json')).toString('utf8'));
const local = JSON.parse(await fs.readFile(path.join(config.dataDir, 'manga_info.json'), 'utf8'));

console.log('顶层结构：云端 keys =', Object.keys(cloud), ' 本地 keys =', Object.keys(local));
for (const k of Object.keys(cloud)) {
  const c = cloud[k];
  const l = local[k];
  const ct = Array.isArray(c) ? `数组(${c.length})` : typeof c === 'object' && c ? `对象(${Object.keys(c).length}键)` : String(c);
  const lt = Array.isArray(l) ? `数组(${l.length})` : typeof l === 'object' && l ? `对象(${Object.keys(l).length}键)` : String(l);
  console.log(`  ${k}: 云端 ${ct}  |  本地 ${lt}`);
}

// 对是数组/对象的键做细粒度差
for (const k of Object.keys(cloud)) {
  const c = cloud[k];
  const l = local[k];
  if (!c || typeof c !== 'object') continue;

  if (Array.isArray(c) && Array.isArray(l)) {
    const keyOf = (x, i) => (x && typeof x === 'object' ? String(x.mid ?? x.id ?? x.Id ?? x.Id_db ?? x.uid ?? `#${i}`) : `#${i}`);
    const cm = new Map(c.map((x, i) => [keyOf(x, i), x]));
    const lm = new Map(l.map((x, i) => [keyOf(x, i), x]));
    const cloudOnly = [...cm.keys()].filter((x) => !lm.has(x));
    const localOnly = [...lm.keys()].filter((x) => !cm.has(x));
    let changed = 0;
    for (const kk of cm.keys()) if (lm.has(kk) && JSON.stringify(cm.get(kk)) !== JSON.stringify(lm.get(kk))) changed++;
    console.log(`\n  [${k}] 数组细比：仅云端 ${cloudOnly.length} | 仅本地 ${localOnly.length} | 内容不同 ${changed}`);
    if (cloudOnly.length) console.log('    仅云端有的前 10:', cloudOnly.slice(0, 10).join(', '));
    if (localOnly.length) console.log('    仅本地有的前 10:', localOnly.slice(0, 10).join(', '));
    // 抽样看一条，判断是什么东西
    const sample = c[0];
    if (sample) console.log('    云端样本:', JSON.stringify(sample).slice(0, 260));
    if (l[0]) console.log('    本地样本:', JSON.stringify(l[0]).slice(0, 260));
  } else if (!Array.isArray(c) && !Array.isArray(l)) {
    const ck = Object.keys(c);
    const lk = Object.keys(l);
    const cloudOnly = ck.filter((x) => !(x in l));
    const localOnly = lk.filter((x) => !(x in c));
    let changed = 0;
    for (const kk of ck) if (kk in l && JSON.stringify(c[kk]) !== JSON.stringify(l[kk])) changed++;
    console.log(`\n  [${k}] 对象细比：云端 ${ck.length} 键 / 本地 ${lk.length} 键 | 仅云端 ${cloudOnly.length} | 仅本地 ${localOnly.length} | 值不同 ${changed}`);
    if (cloudOnly.length) console.log('    仅云端有的前 10 个键:', cloudOnly.slice(0, 10).join(', '));
    if (localOnly.length) console.log('    仅本地有的前 10 个键:', localOnly.slice(0, 10).join(', '));
  } else {
    console.log(`\n  [${k}] 类型不同：云端 ${Array.isArray(c) ? 'array' : typeof c} / 本地 ${Array.isArray(l) ? 'array' : typeof l}`);
  }
}
