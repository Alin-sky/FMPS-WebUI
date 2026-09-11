// 一次性验证脚本：把 wikiru 抓到的图下载下来，与 COS 上现存 gacha-img 做像素比对
// 目的：确认映射正确（NCC = 1.000 表示像素完全一致）
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { crawlWikiru, fetchWikiruIndex, mapIconsToStudents, downloadWikiruIcon } from '../src/icons-wikiru.js';
import { config } from '../src/config.js';

const students = JSON.parse(await fs.readFile(path.join(config.jsonDir, 'sms_studata_main.json'), 'utf8'));
const pubCfg = JSON.parse(await fs.readFile(path.join(config.dataDir, 'publish-config.json'), 'utf8'));

const COS = (await import('cos-nodejs-sdk-v5')).default;
const cos = new COS({ SecretId: pubCfg.secretId, SecretKey: pubCfg.secretKey });
const getCos = (Key) =>
  new Promise((res, rej) =>
    cos.getObject({ Bucket: pubCfg.bucket, Region: pubCfg.region, Key }, (e, d) => (e ? rej(e) : res(d.Body)))
  );

const idx = await fetchWikiruIndex({});
const m = mapIconsToStudents(idx.icons, students);

// 抽样：跨多个 id 段
const sample = [];
const wanted = [10000, 10003, 10022, 10037, 10066, 10098, 10136, 16002, 16012, 16020, 20008, 20039, 26000, 20033];
for (const id of wanted) {
  const hit = m.matched.find((x) => x.id === id);
  if (hit) sample.push(hit);
}

// 用 sharp 算灰度矩阵 + 归一化互相关
async function ncc(bufA, bufB) {
  const toRaw = async (b) => {
    const { data, info } = await sharp(b).greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    return { data, w: info.width, h: info.height };
  };
  const a = await toRaw(bufA);
  const b = await toRaw(bufB);
  const n = a.data.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a.data[i]; mb += b.data[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a.data[i] - ma, y = b.data[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
}

const report = [];
let perfect = 0, mismatch = 0, missing = 0;
const cacheDir = path.join(config.dataDir, '_verify-tmp');
await fs.mkdir(cacheDir, { recursive: true });

for (const s of sample) {
  let wikiruBuf, cosBuf;
  try {
    const r = await downloadWikiruIcon(s.icon, {});
    wikiruBuf = r.buf;
  } catch (e) {
    report.push({ id: s.id, name: s.name, file: s.icon.name, error: `下载失败 ${e.message}` });
    continue;
  }
  try {
    cosBuf = await getCos(`gacha-img/${s.id}.png`);
  } catch {
    missing++;
    report.push({ id: s.id, name: s.name, file: s.icon.name, status: 'COS 无此图', wikiruSize: wikiruBuf.length });
    continue;
  }
  const [wa, wb] = await Promise.all([sharp(wikiruBuf).metadata(), sharp(cosBuf).metadata()]);
  const score = await ncc(wikiruBuf, cosBuf);
  const same = score > 0.999;
  if (same) perfect++; else mismatch++;
  report.push({
    id: s.id, name: s.name, file: s.icon.name,
    wikiru: `${wa.width}x${wa.height}`,
    cos: `${wb.width}x${wb.height}`,
    ncc: Number(score.toFixed(4)),
    status: same ? '✅ 像素一致' : '⚠️ 不一致',
  });
}

console.log('=== 像素比对（wikiru 图源 vs COS 现存 gacha-img）===');
for (const r of report) {
  console.log(
    r.error ? `  #${r.id} ${r.name} — ${r.error}`
      : `  ${r.status} #${r.id} ${r.name}\n      wikiru=${r.wikiru} cos=${r.cos} NCC=${r.ncc ?? '-'} file=${r.file}`
  );
}
console.log(`\n汇总：一致 ${perfect} / 不一致 ${mismatch} / COS 缺失 ${missing} / 合计 ${report.length}`);
await fs.rm(cacheDir, { recursive: true, force: true });
