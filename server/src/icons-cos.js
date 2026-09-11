// COS 头像同步与校验
//
// 两个能力：
//   1. syncFromCos  拉 COS 现存头像当基线（本地优先，绝不覆盖本地已有文件）
//   2. verifyIcons  本地 / COS / wikiru 三方逐张比对，输出不一致清单
//
// COS 凭据来自 server/data/publish-config.json（与发布共用，不新增配置项）。
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { config } from './config.js';
import { ICON_TYPE_KEYS, ICON_TYPES, iconPath, cosKey, typeDir, writeIcon, listIds, readMeta, setEntriesBulk, metaKey } from './icons-store.js';

// ---------- COS 客户端 ----------

async function readCosConfig() {
  try {
    const cfg = JSON.parse(await fs.readFile(path.join(config.dataDir, 'publish-config.json'), 'utf8'));
    if (!cfg.secretId || !cfg.secretKey) throw new Error('publish-config.json 里缺少 secretId / secretKey');
    return {
      secretId: cfg.secretId,
      secretKey: cfg.secretKey,
      bucket: cfg.bucket || '1145141919810-1317895529',
      region: cfg.region || 'ap-chengdu',
    };
  } catch (e) {
    throw new Error(`读取 COS 配置失败：${e.message}`);
  }
}

export async function cosClient() {
  const cfg = await readCosConfig();
  const COS = (await import('cos-nodejs-sdk-v5')).default;
  const cos = new COS({ SecretId: cfg.secretId, SecretKey: cfg.secretKey });
  const base = { Bucket: cfg.bucket, Region: cfg.region };
  const call = (method, params) =>
    new Promise((resolve, reject) => cos[method]({ ...base, ...params }, (e, d) => (e ? reject(e) : resolve(d))));
  return {
    cfg,
    // headObject 的实际返回是 { statusCode, headers:{'content-length','etag','last-modified'}, ETag }
    // 这里统一成 { key, size, mtime, md5 } 便于调用方使用。
    // 注意：COS 的 ETag 就是文件内容的 MD5（十六进制、带引号），可直接用于"是否需要重传"的判断。
    head: async (Key) => {
      const d = await call('headObject', { Key });
      const h = d.headers || {};
      const etag = (d.ETag || h.etag || '').replace(/"/g, '');
      return {
        ...d,
        key: Key,
        size: Number(h['content-length'] ?? 0),
        mtime: h['last-modified'] ? new Date(h['last-modified']).toISOString() : null,
        md5: /^[0-9a-f]{32}$/i.test(etag) ? etag.toLowerCase() : null,
      };
    },
    get: (Key) => call('getObject', { Key }).then((d) => d.Body),
    put: (Key, Body) => call('putObject', { Key, Body }),
    // 列某个前缀下的全部对象（自动翻页）
    // 注意：gacha-img/ 前缀下还混有 1sta.png / background.png 之类的非学生图，
    //       这里用 Delimiter 拿不到，改为全部列出后按 `{id}.{ext}` 正则过滤。
    //
    // ⚠️ COS 返回的 `IsTruncated` 是**字符串** `"false"` / `"true"`，不是布尔。
    //    写成 `if (!r.IsTruncated) break` 会因为 `!"false" === false` 而永远不 break，
    //    于是每个前缀都白翻满 20 页、结果重复 20 倍（gacha-img 实际 276 张却返回 5520 条）。
    //    必须显式按字符串比较。
    listPrefix: async (Prefix, maxPages = 20) => {
      const out = [];
      let marker;
      for (let i = 0; i < maxPages; i++) {
        const r = await call('getBucket', { Prefix, MaxKeys: 1000, Marker: marker });
        for (const c of r.Contents || []) {
          out.push({ key: c.Key, size: Number(c.Size), mtime: c.LastModified, etag: (c.ETag || '').replace(/"/g, '') });
        }
        if (String(r.IsTruncated) !== 'true') break;
        marker = r.NextMarker;
      }
      return out;
    },
  };
}

// 从 COS 对象列表里筛出符合 `{前缀}/{数字}.{ext}` 的学生头像
function filterStudentKeys(objects, prefix, ext) {
  const re = new RegExp(`^${prefix}/(\\d+)\\.${ext}$`, 'i');
  const map = new Map();
  for (const o of objects) {
    const m = re.exec(o.key);
    if (m) map.set(Number(m[1]), o);
  }
  return map;
}

// ---------- 清单：COS 上三类的存量 ----------

export async function cosInventory({ onLog } = {}) {
  const log = (m) => { if (onLog) onLog(m); console.log(`[icons-cos] ${m}`); };
  const cos = await cosClient();
  const out = {};
  for (const type of ICON_TYPE_KEYS) {
    const t = ICON_TYPES[type];
    log(`列举 COS ${type}/ …`);
    const all = await cos.listPrefix(`${type}/`);
    const students = filterStudentKeys(all, type, t.ext);
    // 非学生图（如 gacha-img/background.png），仅记录数量避免误删
    const extras = all.filter((o) => !students.has(Number((o.key.match(/\/(\d+)\./i) || [])[1])));
    out[type] = { count: students.size, ids: students, extras: extras.map((e) => e.key), total: all.length };
    log(`  → 学生头像 ${students.size} 张${extras.length ? `（另有 ${extras.length} 个非学生文件）` : ''}`);
  }
  return out;
}

// ---------- 同步：拉缺失的回来 ----------

// opts: { types: [], dryRun: false, onLog, onProgress, skipExisting: true, force: false }
export async function syncFromCos(opts = {}) {
  const {
    types = ICON_TYPE_KEYS,
    dryRun = false,
    onLog,
    onProgress,
    skipExisting = true,
    force = false,
  } = opts;
  const log = (m) => { if (onLog) onLog(m); console.log(`[icons-cos] ${m}`); };

  const cos = await cosClient();
  const result = {
    dryRun,
    perType: {},
    toDownload: [],
    downloaded: 0,
    skippedExisting: 0,
    skippedManual: 0,
    failed: [],
    bytes: 0,
  };

  const localByType = {};
  for (const type of types) {
    localByType[type] = await listIds(type);
  }
  const meta = await readMeta();

  for (const type of types) {
    const t = ICON_TYPES[type];
    log(`检查 ${type}/ …`);
    const all = await cos.listPrefix(`${type}/`);
    const remote = filterStudentKeys(all, type, t.ext);
    const local = localByType[type];
    const entry = { local: local.size, remote: remote.size, missingLocal: 0, extraLocal: 0, toFetch: [] };
    for (const [id, obj] of remote) {
      if (local.has(id) && skipExisting) { result.skippedExisting++; continue; }
      const mk = metaKey(type, id);
      // 人工图永不被 COS 同步覆盖（哪怕 force=true）。要改请走「上传/替换」。
      if (meta.items[mk]?.source === 'manual') { result.skippedManual++; continue; }
      entry.toFetch.push({ id, key: obj.key, size: obj.size });
      result.toDownload.push({ type, id, key: obj.key, size: obj.size });
    }
    for (const id of local) if (!remote.has(id)) entry.extraLocal++;
    entry.missingLocal = entry.toFetch.length;
    result.perType[type] = entry;
    log(`  → 云端 ${remote.size} / 本地 ${local.size} / 待下载 ${entry.toFetch.length} / 仅本地有 ${entry.extraLocal}`);
  }

  if (dryRun) {
    result.totalToDownload = result.toDownload.length;
    result.totalBytes = result.toDownload.reduce((a, b) => a + b.size, 0);
    log(`[dryRun] 共需下载 ${result.totalToDownload} 张，约 ${(result.totalBytes / 1024 / 1024).toFixed(1)} MB`);
    return result;
  }

  const bulk = [];
  for (let i = 0; i < result.toDownload.length; i++) {
    const item = result.toDownload[i];
    try {
      const buf = await cos.get(item.key);
      const w = await writeIcon(item.type, item.id, buf, {
        source: 'cos',
        origin: `cos://${item.key}`,
        note: '从 COS 拉取的基线',
        force,
      });
      if (w.written) {
        result.downloaded++;
        result.bytes += buf.length;
        bulk.push([metaKey(item.type, item.id), { size: buf.length, savedAt: new Date().toISOString() }]);
      }
    } catch (e) {
      result.failed.push({ ...item, error: e.message });
      log(`  ✗ ${item.key}: ${e.message}`);
    }
    if (onProgress) onProgress({ done: i + 1, total: result.toDownload.length, ...item });
  }
  if (bulk.length) await setEntriesBulk(bulk);
  log(`完成：下载 ${result.downloaded} / 跳过已有 ${result.skippedExisting} / 保护人工 ${result.skippedManual} / 失败 ${result.failed.length}`);
  return result;
}

// ---------- 全量校验：本地 / COS / wikiru 三方 ----------

// 输出三类清单：仅本地有 / 仅 COS 有 / 内容不一致
export async function verifyIcons(students, opts = {}) {
  const { onLog, includeWikiru = true, onProgress } = opts;
  const log = (m) => { if (onLog) onLog(m); console.log(`[icons-verify] ${m}`); };
  const cos = await cosClient();
  const report = { perType: {}, localOnly: [], cosOnly: [], mismatch: [], transient: [], summary: {} };

  for (const type of ICON_TYPE_KEYS) {
    const t = ICON_TYPES[type];
    log(`校验 ${type}/ …`);
    const all = await cos.listPrefix(`${type}/`);
    const remote = filterStudentKeys(all, type, t.ext);
    const local = await listIds(type);
    const entry = { local: local.size, remote: remote.size, localOnly: [], cosOnly: [], mismatch: [], same: 0 };

    for (const id of local) {
      if (!remote.has(id)) { entry.localOnly.push(id); continue; }
      // 逐个取本地 MD5 与 COS 内容比对（只有两边都有的才比）
      try {
        const localBuf = await fs.readFile(iconPath(type, id));
        const remoteBuf = await cos.get(remote.get(id).key);
        const lh = createHash('md5').update(localBuf).digest('hex');
        const rh = createHash('md5').update(remoteBuf).digest('hex');
        if (lh === rh) entry.same++;
        else entry.mismatch.push({ id, localHash: lh.slice(0, 12), cosHash: rh.slice(0, 12), localSize: localBuf.length, cosSize: remoteBuf.length });
      } catch (e) {
        report.transient.push({ type, id, error: e.message });
      }
      if (onProgress) onProgress({ type, id });
    }
    for (const id of remote.keys()) {
      if (!local.has(id)) entry.cosOnly.push(id);
    }

    report.perType[type] = entry;
    report.localOnly.push(...entry.localOnly.map((id) => ({ type, id })));
    report.cosOnly.push(...entry.cosOnly.map((id) => ({ type, id })));
    report.mismatch.push(...entry.mismatch.map((m) => ({ type, ...m })));
    log(`  → 一致 ${entry.same} / 仅本地 ${entry.localOnly.length} / 仅 COS ${entry.cosOnly.length} / 内容不一致 ${entry.mismatch.length}`);
  }

  // wikiru 侧覆盖情况（哪些学生抓不到图）
  if (includeWikiru) {
    try {
      const w = await import('./icons-wikiru.js');
      const idx = await w.fetchWikiruIndex({});
      const mapped = w.mapIconsToStudents(idx.icons, students);
      const covered = new Set(mapped.matched.map((m) => m.id));
      report.wikiru = {
        total: idx.stats.iconCount,
        matched: mapped.matched.length,
        unmatched: mapped.unmatched.map((u) => ({ name: u.name, reason: u.reason })),
        ambiguous: mapped.ambiguous.map((a) => ({ name: a.name, ids: a.ids, hint: a.hint })),
        missingStudents: students.filter((s) => !covered.has(Number(s.Id_db))).map((s) => ({ id: s.Id_db, name: s.Name_jp })),
      };
      log(`wikiru：匹配 ${mapped.matched.length} / 未匹配 ${mapped.unmatched.length} / 歧义 ${mapped.ambiguous.length} / 未覆盖学生 ${report.wikiru.missingStudents.length}`);
    } catch (e) {
      report.wikiru = { error: e.message };
      log(`wikiru 校验失败：${e.message}`);
    }
  }

  report.summary = {
    localOnly: report.localOnly.length,
    cosOnly: report.cosOnly.length,
    mismatch: report.mismatch.length,
    types: Object.fromEntries(
      Object.entries(report.perType).map(([k, v]) => [k, { local: v.local, remote: v.remote, same: v.same }])
    ),
  };
  return report;
}
