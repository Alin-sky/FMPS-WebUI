// 云端发布记录（跨设备可见的版本线）
//
// 为什么需要它：
//   本地 `version.js` 的归档只把 **本机** data/json 复制到 **本机** data/versions/。
//   于是"在另一台设备上发布过一次"这件事，本机完全看不到 —— 版本管理页只好显示空列表。
//
//   但云端其实留着铁证：每次发布都会把 json/*.json 与 data/* 推到 COS，
//   COS 给每个对象记了 LastModified。把同一批对象的 LastModified 按时间聚类，
//   就能还原出「历史上发生过哪几次发布、分别推了哪些文件、什么时间」。
//
// 两层机制：
//   1. 往前看（manifest）：以后每次发布额外写一份 releases/<ts>.json 到 COS，
//      内含文件清单 + 大小 + MD5 + **学生指纹**。任何设备都能直接列出来，
//      还能跨设备算学生级差异（不用下载旧 JSON）。
//   2. 往回补（rebuild）：对没有 manifest 的历史发布，用 COS 对象时间聚类重建；
//      若那批内容还没被后续发布覆盖，还能补算出学生指纹。
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createHash } from 'crypto';
import { config } from './config.js';
import { cosClient } from './icons-cos.js';

export const RELEASE_PREFIX = 'releases/';
export const INDEX_KEY = `${RELEASE_PREFIX}index.json`;

// 同一批发布的对象时间戳不会差太多；超过这个间隔就认为是另一次发布
const CLUSTER_GAP_SEC = 300;

// data/ 目录随发布上传的白名单 —— 必须和 POST /api/publish 里那份保持一致，
// 否则本地 manifest 的文件清单会多出 icons-meta.json 之类，
// 导致「云端 vs 本地」永远显示一堆"新增"假差异。
// publish-config.json 含密钥，**绝不外传**。
export const DATA_FILE_WHITELIST = ['manga_info.json', 'skip-list.json', 'alias-config.json', 'arona-mismatch.json'];

const MB = 1024 * 1024;

// ---------- 工具 ----------

// 发布时刻 → 文件名安全的 ts（与本地 versions 目录同名格式，可直接排序）
export function tsFromDate(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, '-');
}

// 文件名字符串排序稳定化：JSON.stringify 的键序依赖插入顺序，跨设备可能不同
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

function md5(buf) {
  return createHash('md5').update(buf).digest('hex');
}

// 学生指纹：**刻意排除 `Id`**。
// `Id` 是生成器合成的顺序号（`String(10000+i)`），取决于各设备的源数据顺序，
// 跨设备比对时它经常无意义地不同 —— 带上它会把一堆学生误报成"已修改"。
// 真正稳定的主键是 `Id_db`。
function fingerprintStudent(s) {
  const clone = { ...s };
  delete clone.Id;
  return createHash('sha1').update(stableStringify(clone)).digest('hex').slice(0, 10);
}

function studentName(s) {
  return s.Name_zh_cn || s.Name_en || s.Name_jp || '';
}

// 从 sms_studata_main 数组生成紧凑指纹表 { "10000": "爱露|a1b2c3d4e5", ... }
function buildStudentIndex(studata) {
  const out = {};
  if (!Array.isArray(studata)) return out;
  for (const s of studata) {
    if (s?.Id_db === undefined || s?.Id_db === null) continue;
    out[String(s.Id_db)] = `${studentName(s)}|${fingerprintStudent(s)}`;
  }
  return out;
}

// 只保留「发布产物」的 key，把上游仓库的垃圾（json/.git/** 等）排除掉
function isReleaseKey(key) {
  if (/^json\/[^/]+\.json$/.test(key)) return true;
  if (/^data\/[^/]+$/.test(key)) return true;
  return false;
}

// ---------- 本地侧 ----------

// 生成本地当前状态的 manifest（发布时用）
export async function localManifest({ note = '', source = null } = {}) {
  const files = [];
  let bytes = 0;

  let names = [];
  try {
    names = (await fs.readdir(config.jsonDir)).filter((f) => f.endsWith('.json')).sort();
  } catch {}
  for (const f of names) {
    const buf = await fs.readFile(path.join(config.jsonDir, f));
    files.push({ key: `json/${f}`, size: buf.length, md5: md5(buf) });
    bytes += buf.length;
  }

  // 与发布白名单一致，不从 data/ 里乱扫
  let dataNames = [];
  try {
    const present = new Set(await fs.readdir(config.dataDir));
    dataNames = DATA_FILE_WHITELIST.filter((f) => present.has(f)).sort();
  } catch {}
  for (const f of dataNames) {
    const buf = await fs.readFile(path.join(config.dataDir, f));
    files.push({ key: `data/${f}`, size: buf.length, md5: md5(buf) });
    bytes += buf.length;
  }

  // 学生指纹：跨设备比对的关键
  let students = null;
  try {
    const studata = JSON.parse(await fs.readFile(path.join(config.jsonDir, 'sms_studata_main.json'), 'utf8'));
    students = buildStudentIndex(studata);
  } catch {}

  const now = new Date();
  return {
    ts: tsFromDate(now),
    releasedAt: now.toISOString(),
    source: {
      host: os.hostname(),
      platform: `${os.platform()} ${os.release()}`,
      app: 'fmps-web',
      ...(source || {}),
    },
    note,
    origin: 'local-publish',
    files,
    totals: { files: files.length, bytes, mb: Number((bytes / MB).toFixed(2)) },
    students: students ? { count: Object.keys(students).length, fp: students } : null,
  };
}

// ---------- 云端 manifest 读写 ----------

async function readIndex(cos) {
  try {
    const buf = await cos.get(INDEX_KEY);
    const j = JSON.parse(buf.toString('utf8'));
    return Array.isArray(j.releases) ? j.releases : [];
  } catch {
    return [];
  }
}

// 写一份发布记录，并把它插进 index（去重，按时间倒序）
export async function putCloudRelease(manifest) {
  const cos = await cosClient();
  // index 里的条目是摘要（带 students），详情另存一份完整 manifest
  const body = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  await cos.put(`${RELEASE_PREFIX}${manifest.ts}.json`, body);

  const index = await readIndex(cos);
  const entry = {
    ts: manifest.ts,
    releasedAt: manifest.releasedAt,
    source: manifest.source,
    note: manifest.note || '',
    origin: manifest.origin || 'unknown',
    totals: manifest.totals,
    students: manifest.students,
    reconstructed: !!manifest.reconstructed,
    rebuiltAt: manifest.rebuiltAt || null,
  };
  const next = index.filter((r) => r.ts !== manifest.ts);
  next.push(entry);
  next.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  await cos.put(INDEX_KEY, Buffer.from(JSON.stringify({ updatedAt: new Date().toISOString(), releases: next }, null, 2), 'utf8'));
  return entry;
}

// 列出云端全部发布记录（倒序）
export async function listCloudReleases() {
  const cos = await cosClient();
  return readIndex(cos);
}

export async function readCloudRelease(ts) {
  const cos = await cosClient();
  try {
    const buf = await cos.get(`${RELEASE_PREFIX}${ts}.json`);
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

// ---------- 从 COS 现状重建 ----------

// 列出云端发布产物对象的真实时间线（已去重）
// 顺带把 COS 列目录返回的 ETag 当 md5 用 —— 分片上传的 ETag 形如 `xxx-3`，不是内容 MD5，
// 这种就留空，让上层退化成比大小。
export async function scanCloudState() {
  const cos = await cosClient();
  const [jsonAll, dataAll] = await Promise.all([cos.listPrefix('json/'), cos.listPrefix('data/')]);
  const seen = new Map();
  for (const o of [...jsonAll, ...dataAll]) {
    if (!isReleaseKey(o.key)) continue;
    if (!seen.has(o.key)) seen.set(o.key, o);
  }
  const files = [...seen.values()].map((o) => ({
    key: o.key,
    size: o.size,
    mtime: o.mtime,
    md5: /^[0-9a-f]{32}$/i.test(o.etag || '') ? o.etag.toLowerCase() : null,
  }));
  files.sort((a, b) => String(a.mtime).localeCompare(String(b.mtime)));
  return files;
}

// 按时间把对象聚成「一次发布」
export function clusterByTime(files, gapSec = CLUSTER_GAP_SEC) {
  const out = [];
  let cur = null;
  for (const f of files) {
    const t = new Date(f.mtime).getTime();
    if (!cur || t - cur.lastT > gapSec * 1000) {
      cur = { start: f.mtime, end: f.mtime, lastT: t, files: [] };
      out.push(cur);
    }
    cur.files.push(f);
    cur.end = f.mtime;
    cur.lastT = t;
  }
  return out.map((c) => ({
    ts: tsFromDate(new Date(c.start)),
    releasedAt: new Date(c.start).toISOString(),
    start: c.start,
    end: c.end,
    files: c.files,
    totals: {
      files: c.files.length,
      bytes: c.files.reduce((a, b) => a + b.size, 0),
      mb: Number((c.files.reduce((a, b) => a + b.size, 0) / MB).toFixed(2)),
    },
  }));
}

// 重建/补齐云端发布记录：
//   - 扫 COS 现状 → 时间聚类 → 对缺失 manifest 的批次生成一条 reconstructed 记录
//   - 若某批次的 sms_studata_main.json 仍是当前线上内容（没被后续发布覆盖），
//     顺手补算学生指纹，这样它也能参与学生级差异对比
export async function rebuildCloudReleases({ onLog } = {}) {
  const log = (m) => { if (onLog) onLog(m); console.log(`[release-cloud] ${m}`); };
  const cos = await cosClient();
  const files = await scanCloudState();
  log(`云端发布产物对象 ${files.length} 个`);

  const clusters = clusterByTime(files);
  log(`时间聚类得到 ${clusters.length} 次发布`);

  const existing = await readIndex(cos);
  let added = 0;
  let updated = 0;
  const results = [];

  // 判断某批次的内容是否仍是「线上现行内容」：
  // 对象只保留最后一份，所以**只有最后一个包含 sms_studata_main.json 的批次**，
  // 它的那份文件才还躺在 COS 上（其余批次的同名文件早被后来的发布覆盖了）。
  // 别拿"批次起始时间 vs 文件时间"去比 —— 同一批次内各文件时间本来就差几秒。
  let liveClusterIdx = -1;
  for (let i = 0; i < clusters.length; i++) {
    if (clusters[i].files.some((f) => f.key === 'json/sms_studata_main.json')) liveClusterIdx = i;
  }

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const prev = existing.find((e) => e.ts === c.ts);
    const hasStudata = c.files.some((f) => f.key === 'json/sms_studata_main.json');
    const isLive = hasStudata && i === liveClusterIdx;

    let students = null;
    let studentsNote = null;
    if (isLive) {
      try {
        const buf = await cos.get('json/sms_studata_main.json');
        const studata = JSON.parse(buf.toString('utf8'));
        students = buildStudentIndex(studata);
        log(`  批次 ${c.ts}：内容仍为线上现行版本，已补算学生指纹 ${Object.keys(students).length} 条`);
      } catch (e) {
        studentsNote = `补算学生指纹失败：${e.message}`;
      }
    } else if (hasStudata) {
      studentsNote = '该批次内容已被后续发布覆盖，无法还原学生级差异（仅保留文件清单）';
    } else {
      studentsNote = '该批次不含 sms_studata_main.json';
    }

    // 已经有 manifest 且带了学生指纹 → 不重复写，仅补一次时间线元信息
    if (prev && prev.students && !prev.reconstructed) {
      results.push({ ts: c.ts, action: 'skip', reason: '已有正式发布记录' });
      continue;
    }

    const manifest = {
      ts: c.ts,
      releasedAt: c.releasedAt,
      source: prev?.source || {
        host: '未知设备（从云端对象时间重建）',
        platform: null,
        app: 'fmps-web',
      },
      note: prev?.note || '由 COS 对象时间重建',
      origin: 'reconstructed',
      reconstructed: true,
      rebuiltAt: new Date().toISOString(),
      files: c.files.map((f) => ({ key: f.key, size: f.size, md5: f.md5 || null, mtime: f.mtime })),
      totals: c.totals,
      students: students ? { count: Object.keys(students).length, fp: students } : null,
      studentsNote,
    };
    await putCloudRelease(manifest);
    if (prev) updated++;
    else added++;
    results.push({ ts: c.ts, action: prev ? 'updated' : 'added', files: c.files.length, hasStudents: !!students, studentsNote });
  }

  // 清掉 index 里指向已不存在批次的悬空记录（不删对象，只清索引）
  const validTs = new Set(clusters.map((c) => c.ts));
  const fresh = await readIndex(cos);
  const kept = fresh.filter((e) => validTs.has(e.ts));
  const dropped = fresh.length - kept.length;
  if (dropped > 0) {
    await cos.put(INDEX_KEY, Buffer.from(JSON.stringify({ updatedAt: new Date().toISOString(), releases: kept }, null, 2), 'utf8'));
    log(`清理悬空记录 ${dropped} 条`);
  }

  return { clusters: clusters.length, added, updated, dropped, results };
}

// ---------- 差异比对（纯 manifest，不下载旧 JSON）----------

// 用学生指纹算两次发布之间的学生级差异
export function diffReleaseStudents(prev, curr) {
  const a = prev?.students?.fp || null;
  const b = curr?.students?.fp || null;
  if (!a || !b) {
    return { available: false, reason: '任一侧缺少学生指纹，无法做学生级比对', added: [], removed: [], modified: [] };
  }
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, v] of Object.entries(b)) {
    const p = a[id];
    if (p === undefined) added.push({ Id_db: Number(id), Name: (b[id] || '|').split('|')[0] });
    else if (p !== v) modified.push({ Id_db: Number(id), Name: (b[id] || '|').split('|')[0] });
  }
  for (const [id, v] of Object.entries(a)) {
    if (b[id] === undefined) removed.push({ Id_db: Number(id), Name: (v || '|').split('|')[0] });
  }
  added.sort((x, y) => x.Id_db - y.Id_db);
  removed.sort((x, y) => x.Id_db - y.Id_db);
  modified.sort((x, y) => x.Id_db - y.Id_db);
  return { available: true, added, removed, modified };
}

// 文件级差异（大小/md5，md5 缺失时退化比大小）
export function diffReleaseFiles(prev, curr) {
  const pm = new Map((prev?.files || []).map((f) => [f.key, f]));
  const cm = new Map((curr?.files || []).map((f) => [f.key, f]));
  const added = [];
  const modified = [];
  const same = [];
  for (const [k, f] of cm) {
    const p = pm.get(k);
    if (!p) { added.push(k); continue; }
    const changed = p.md5 && f.md5 ? p.md5 !== f.md5 : p.size !== f.size;
    if (changed) modified.push({ key: k, size: f.size, prevSize: p.size });
    else same.push(k);
  }
  const removed = [...pm.keys()].filter((k) => !cm.has(k));
  return { added, removed, modified, same: same.length };
}

// ---------- 云端版本 vs 本地现状 ----------

// 语义与 cloud.js 的 diffCloud 保持一致：
//   added    = 本地有、云端该版本没有（待上传的新增）
//   removed  = 云端该版本有、本地没有（待上传的删除）
//   modified = 两边都有但内容不同（待上传的修改）
//
// ⚠️ 换行符陷阱：本项目在多台设备上跑，Windows 写出的 JSON 是 CRLF，类 Unix 是 LF。
//    于是同样一份数据在两边 md5 不同、体积差恰好等于行数，会被误报成"内容已变更"。
//    实测 `data/manga_info.json` 之外的 5 个文件差 968/848/1935/89/3 字节，正好是行数 —— 纯 CRLF。
//    所以这里对内容不同的文件再做一次「忽略换行符」的比对，能消掉这类假差异。
function normalizeEol(buf) {
  return buf.toString('utf8').replace(/\r\n/g, '\n');
}

export async function diffCloudReleaseVsLocal(ts) {
  const cloud = await readCloudRelease(ts);
  if (!cloud) throw new Error(`云端没有 ${ts} 的发布记录`);
  const local = await localManifest();
  const files = diffReleaseFiles(cloud, local);

  // 对"内容不同"的文件复查一遍：只有换行符不同就归到 eolOnly，不算真差异
  const cos = await cosClient();
  const eolOnly = [];
  const realModified = [];
  await Promise.all(
    files.modified.map(async (m) => {
      const name = m.key.replace(/^(json|data)\//, '');
      const localPath = m.key.startsWith('json/')
        ? path.join(config.jsonDir, name)
        : path.join(config.dataDir, name);
      try {
        const [cloudBuf, localBuf] = await Promise.all([cos.get(m.key), fs.readFile(localPath)]);
        if (normalizeEol(cloudBuf) === normalizeEol(localBuf)) {
          eolOnly.push({ ...m, note: '仅换行符不同（CRLF vs LF），数据一致' });
          files.same++;
          return;
        }
      } catch {
        // 读不到就按真差异处理，宁可多报也别漏报
      }
      realModified.push(m);
    })
  );
  files.modified = realModified.sort((a, b) => a.key.localeCompare(b.key));
  eolOnly.sort((a, b) => a.key.localeCompare(b.key));

  return {
    ts,
    cloudReleasedAt: cloud.releasedAt,
    cloudSource: cloud.source || null,
    cloudFileCount: cloud.totals?.files ?? 0,
    localFileCount: local.totals.files,
    students: diffReleaseStudents(cloud, local),
    files,
    eolOnly,
  };
}

// ---------- 把某个云端版本拉到本地 ----------

// 先归档本地（可回滚），再把该版本在云端仍存在的文件下载覆盖到本地
export async function applyCloudRelease(ts, { onLog } = {}) {
  const log = (m) => { if (onLog) onLog(m); console.log(`[release-cloud] ${m}`); };
  const cos = await cosClient();
  const manifest = await readCloudRelease(ts);
  if (!manifest) throw new Error(`云端没有 ${ts} 的发布记录`);

  // 1) 先把本地现状归档成一个版本，出问题可以「复原到此版本」退回来
  const { archiveVersion } = await import('./version.js');
  const backup = await archiveVersion();
  log(`已把本地现状归档为 ${backup.ts}（可回滚）`);

  // 2) 逐个下载覆盖
  const done = [];
  const failed = [];
  const missingInCloud = [];
  for (const f of manifest.files || []) {
    const isJson = f.key.startsWith('json/');
    const targetDir = isJson ? config.jsonDir : config.dataDir;
    const name = f.key.replace(/^(json|data)\//, '');
    try {
      const buf = await cos.get(f.key);
      await fs.writeFile(path.join(targetDir, name), buf);
      done.push(name);
    } catch (e) {
      // 该版本的文件可能已被更新的发布覆盖或删除
      missingInCloud.push({ key: f.key, error: e.message });
      failed.push(name);
    }
  }
  log(`已写入本地 ${done.length} 个文件，失败/云端已不存在 ${failed.length} 个`);

  // 3) 归档成"当前状态"的一份新版本，让本地版本线连续
  const after = await archiveVersion();
  return { ts, backupTs: backup.ts, written: done.length, failed, missingInCloud, newLocalVersion: after.ts, files: done };
}
