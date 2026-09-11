// 对「云端该版本 vs 本地」里大小不同的文件做内容级分析
import fs from 'fs/promises';
import path from 'path';
import { config } from '../src/config.js';
import { cosClient } from '../src/icons-cos.js';

const TS = '2026-09-10T10-51-17-000Z';
const cos = await cosClient();
const manifest = JSON.parse((await cos.get(`releases/${TS}.json`)).toString('utf8'));

const targets = [
  'json/khrtalk_satellite.json',
  'json/map_guide_shangxue.json',
  'json/sms_othersmatchlib.json',
  'json/sms_to_arona_data_revisions.json',
  'data/manga_info.json',
  'data/skip-list.json',
];

const keyOf = (item, fallback) => {
  if (item && typeof item === 'object') {
    for (const k of ['Id_db', 'id', 'Id', 'stuid', 'gid', 'mid', 'uid']) {
      if (item[k] !== undefined && item[k] !== null) return `${k}=${item[k]}`;
    }
  }
  return fallback;
};

for (const key of targets) {
  console.log('='.repeat(78));
  console.log(key);
  let cloudBuf;
  try {
    cloudBuf = await cos.get(key);
  } catch (e) {
    console.log('  云端读取失败:', e.message);
    continue;
  }
  const name = key.replace(/^(json|data)\//, '');
  const dir = key.startsWith('json/') ? config.jsonDir : config.dataDir;
  let localBuf;
  try {
    localBuf = await fs.readFile(path.join(dir, name));
  } catch {
    console.log('  本地不存在该文件');
    continue;
  }

  console.log(`  云端 ${cloudBuf.length}B  /  本地 ${localBuf.length}B`);
  let cloud, local;
  try {
    cloud = JSON.parse(cloudBuf.toString('utf8'));
    local = JSON.parse(localBuf.toString('utf8'));
  } catch {
    console.log('  非 JSON，跳过内容分析');
    continue;
  }

  if (Array.isArray(cloud) && Array.isArray(local)) {
    const cm = new Map(cloud.map((x, i) => [keyOf(x, `#idx${i}`), x]));
    const lm = new Map(local.map((x, i) => [keyOf(x, `#idx${i}`), x]));
    const cloudOnly = [...cm.keys()].filter((k) => !lm.has(k));
    const localOnly = [...lm.keys()].filter((k) => !cm.has(k));
    let changed = 0;
    for (const k of cm.keys()) {
      if (lm.has(k) && JSON.stringify(cm.get(k)) !== JSON.stringify(lm.get(k))) changed++;
    }
    console.log(`  数组长度：云端 ${cloud.length}  /  本地 ${local.length}`);
    console.log(`  仅云端有 ${cloudOnly.length} 条 | 仅本地有 ${localOnly.length} 条 | 两边都有但内容不同 ${changed} 条`);
    if (cloudOnly.length) console.log('    仅云端有的前 12 条:', cloudOnly.slice(0, 12).join(', '));
    if (localOnly.length) console.log('    仅本地有的前 12 条:', localOnly.slice(0, 12).join(', '));
  } else if (cloud && local && typeof cloud === 'object' && typeof local === 'object') {
    const ck = Object.keys(cloud);
    const lk = Object.keys(local);
    const cloudOnly = ck.filter((k) => !(k in local));
    const localOnly = lk.filter((k) => !(k in cloud));
    let changed = 0;
    for (const k of ck) {
      if (k in local && JSON.stringify(cloud[k]) !== JSON.stringify(local[k])) changed++;
    }
    console.log(`  对象键数：云端 ${ck.length}  /  本地 ${lk.length}`);
    console.log(`  仅云端有 ${cloudOnly.length} 个键 | 仅本地有 ${localOnly.length} 个键 | 值不同 ${changed} 个键`);
    if (cloudOnly.length) console.log('    仅云端有的键:', cloudOnly.slice(0, 15).join(', '));
    if (localOnly.length) console.log('    仅本地有的键:', localOnly.slice(0, 15).join(', '));
  } else {
    console.log('  类型不同或非集合，无法比对:', typeof cloud, '/', typeof local);
  }
}
