// 发布联动：头像图片的 diff 与上传
//
// 与 JSON 发布共用 publish-config.json 的 COS 凭据。
// 上传策略：只推有变化的（本地 MD5 ≠ 云端 ETag/MD5），避免每次发布重推 30MB。
import fs from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { config } from './config.js';
import { ICON_TYPE_KEYS, ICON_TYPES, iconPath, cosKey, listIds } from './icons-store.js';
import { cosClient } from './icons-cos.js';

const MB = 1024 * 1024;

// 本地 ↔ COS 的头像差异
// 返回 {
//   perType: { [type]: { add: [...], modify: [...], removeCloudOnly: [...], same: n, bytesToUpload } },
//   totals: { add, modify, cloudOnly, bytesToUpload, mb },
//   files: [...]   // 扁平清单，供确认页列表展示
// }
export async function diffLocalVsCos({ types = ICON_TYPE_KEYS, onProgress } = {}) {
  const cos = await cosClient();
  const perType = {};
  const files = [];
  const totals = { add: 0, modify: 0, cloudOnly: 0, same: 0, bytesToUpload: 0 };

  for (const type of types) {
    const t = ICON_TYPES[type];
    const local = await listIds(type);
    const remoteList = await cos.listPrefix(`${type}/`);
    const remoteMap = new Map();
    const re = new RegExp(`^${type}/(\\d+)\\.${t.ext}$`, 'i');
    for (const o of remoteList) {
      const m = re.exec(o.key);
      if (m) remoteMap.set(Number(m[1]), o);
    }

    const entry = { add: [], modify: [], cloudOnly: [], same: 0, bytesToUpload: 0, local: local.size, remote: remoteMap.size };

    // 第一轮：先做纯本地判断（新增 / 大小不同），把"确定要传"的挑出来；
    // 剩下"大小相同"的才需要一次 HEAD 比对内容 MD5。HEAD 并发跑，别串行等。
    const needHashCheck = [];
    for (const id of [...local].sort((a, b) => a - b)) {
      const p = iconPath(type, id);
      let st;
      try {
        st = await fs.stat(p);
      } catch {
        continue;
      }
      const remote = remoteMap.get(id);
      if (!remote) {
        entry.add.push({ id, size: st.size });
        totals.add++;
        entry.bytesToUpload += st.size;
        files.push({ type, typeLabel: t.label, id, action: 'add', size: st.size });
        continue;
      }
      if (st.size !== remote.size) {
        entry.modify.push({ id, size: st.size, cosSize: remote.size });
        totals.modify++;
        entry.bytesToUpload += st.size;
        files.push({ type, typeLabel: t.label, id, action: 'modify', size: st.size, cosSize: remote.size });
        continue;
      }
      needHashCheck.push({ id, path: p, size: st.size });
    }

    // 第二轮：并发 HEAD（限流 16），用云端 ETag(=内容MD5) 和本地 MD5 比对
    const CONCURRENCY = 16;
    const hashResults = new Map();
    let cursor = 0;
    const worker = async () => {
      while (cursor < needHashCheck.length) {
        const item = needHashCheck[cursor++];
        let same = false;
        try {
          const localBuf = await fs.readFile(item.path);
          const lh = createHash('md5').update(localBuf).digest('hex');
          const h = await cos.head(cosKey(type, item.id));
          same = !!h.md5 && h.md5 === lh;
        } catch {
          same = false;
        }
        hashResults.set(item.id, same);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, needHashCheck.length || 1) }, worker));

    for (const item of needHashCheck) {
      if (hashResults.get(item.id)) {
        entry.same++;
        totals.same++;
      } else {
        entry.modify.push({ id: item.id, size: item.size, cosSize: item.size });
        totals.modify++;
        entry.bytesToUpload += item.size;
        files.push({ type, typeLabel: t.label, id: item.id, action: 'modify', size: item.size, cosSize: item.size });
      }
    }

    for (const id of remoteMap.keys()) {
      if (!local.has(id)) {
        const o = remoteMap.get(id);
        entry.cloudOnly.push({ id, key: o.key, size: o.size });
        totals.cloudOnly++;
        files.push({ type, typeLabel: t.label, id, action: 'cloud-only', size: o.size });
      }
    }

    perType[type] = entry;
    if (onProgress) onProgress({ type, done: true });
  }

  totals.bytesToUpload = Object.values(perType).reduce((a, b) => a + b.bytesToUpload, 0);
  totals.mb = Number((totals.bytesToUpload / MB).toFixed(2));
  files.sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);

  return { perType, totals, files, cosAvailable: true, checkedAt: new Date().toISOString() };
}

// 把本地头像推到 COS（只推 add / modify 清单里的）
// onProgress: ({done, total, key})
// 返回 { uploaded, failed: [], bytes, skipped }
export async function uploadIconsToCos({ types = ICON_TYPE_KEYS, diff = null, onProgress, onLog } = {}) {
  const log = (m) => { if (onLog) onLog(m); console.log(`[icons-publish] ${m}`); };
  const cos = await cosClient();
  const d = diff || (await diffLocalVsCos({ types }));

  const queue = d.files.filter((f) => f.action === 'add' || f.action === 'modify');
  log(`待上传 ${queue.length} 张，共 ${(d.totals.bytesToUpload / MB).toFixed(2)} MB`);

  const result = { uploaded: 0, failed: [], bytes: 0, total: queue.length, uploadedKeys: [] };
  for (let i = 0; i < queue.length; i++) {
    const f = queue[i];
    const key = cosKey(f.type, f.id);
    try {
      const body = await fs.readFile(iconPath(f.type, f.id));
      await cos.put(key, body);
      result.uploaded++;
      result.bytes += body.length;
      result.uploadedKeys.push(key);
    } catch (e) {
      result.failed.push({ ...f, key, error: e.message });
      log(`  ✗ ${key}: ${e.message}`);
    }
    if (onProgress) onProgress({ done: i + 1, total: queue.length, key });
    if (i % 50 === 0 && i > 0) log(`  进度 ${i}/${queue.length}`);
  }
  log(`完成：上传 ${result.uploaded} / 失败 ${result.failed.length} / 共 ${(result.bytes / MB).toFixed(2)} MB`);
  return result;
}

// 生成头像发布记录（写进 versions 目录，供「历次发布记录」回看）
export async function snapshotIconRelease(diff) {
  const dir = path.join(config.dataDir, 'versions');
  await fs.mkdir(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const p = path.join(dir, `icons-${ts}.json`);
  await fs.writeFile(
    p,
    JSON.stringify(
      {
        ts,
        releasedAt: new Date().toISOString(),
        totals: diff.totals,
        files: diff.files,
      },
      null,
      2
    ),
    'utf8'
  );
  return { path: p, ts };
}

// 历次头像发布记录列表
export async function listIconReleases() {
  const dir = path.join(config.dataDir, 'versions');
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith('icons-') && f.endsWith('.json'));
    const out = [];
    for (const f of files.sort().reverse()) {
      try {
        const d = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
        out.push({ file: f, ts: d.ts, releasedAt: d.releasedAt, totals: d.totals, fileCount: d.files?.length || 0 });
      } catch {}
    }
    return out;
  } catch {
    return [];
  }
}
