// 头像存储层：三类头像的目录读写 + 来源元数据
//
// 设计原则（务必保持）：
//   1. 目录名与 COS key 完全一致，落在 server/data/img/ 下：
//        stu_icon_db_png/{Id_db}.png   200×226  schaledb collection 转码
//        stu_icon_db/{Id_db}.jpg       200×226  同上转 JPG
//        gacha-img/{Id_db}.png         200×200  wikiru _icon.png
//   2. 元数据是**纯 JSON**（server/data/icons-meta.json），任何字段都能用记事本手工改，
//      改完刷新页面即生效；不存在二进制状态、不存在数据库。
//   3. 每个条目记录 source：
//        auto   = 自动流程生成（可被下次自动流程覆盖）
//        manual = 人工上传/人工指定（**永不被自动流程覆盖**）
//        cos    = 从 COS 拉回的基线（可被自动流程覆盖，但优先级高于 auto）
//      force 开关可临时打破这个保护（显式调用才生效）。
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

// ===== 三类的注册表：所有地方都从这里取，不要散落硬编码 =====
export const ICON_TYPES = {
  stu_icon_db_png: {
    key: 'stu_icon_db_png',
    label: '基础头像 PNG',
    ext: 'png',
    size: [200, 226],
    mime: 'image/png',
    desc: 'schaledb collection 立绘转码（200×226）',
  },
  stu_icon_db: {
    key: 'stu_icon_db',
    label: '基础头像 JPG',
    ext: 'jpg',
    size: [200, 226],
    mime: 'image/jpeg',
    desc: '同 PNG，转 JPG（200×226）',
  },
  'gacha-img': {
    key: 'gacha-img',
    label: '抽卡头像 PNG',
    ext: 'png',
    size: [200, 200],
    mime: 'image/png',
    desc: 'wikiru 的 <日文名>_icon.png 直接改名（200×200）',
  },
};

export const ICON_TYPE_KEYS = Object.keys(ICON_TYPES);

// 元数据文件（人工可编辑）
export const META_PATH = path.join(config.dataDir, 'icons-meta.json');

// 目录路径
export function typeDir(type) {
  if (!ICON_TYPES[type]) throw new Error(`未知的头像类型: ${type}`);
  return path.join(config.imgDir, type);
}

// 单张图的绝对路径
export function iconPath(type, idDb) {
  const t = ICON_TYPES[type];
  if (!t) throw new Error(`未知的头像类型: ${type}`);
  return path.join(typeDir(type), `${Number(idDb)}.${t.ext}`);
}

// COS key（与目录名一致）
export function cosKey(type, idDb) {
  const t = ICON_TYPES[type];
  if (!t) throw new Error(`未知的头像类型: ${type}`);
  return `${type}/${Number(idDb)}.${t.ext}`;
}

// ============ 目录初始化 ============

export async function ensureDirs() {
  for (const type of ICON_TYPE_KEYS) {
    await fs.mkdir(typeDir(type), { recursive: true });
  }
}

// ============ 元数据读写（纯 JSON，人工可改） ============

let metaCache = null;

function emptyMeta() {
  return {
    _comment: '头像来源元数据。可手工编辑：source 取 auto|manual|cos；manual 不会被自动流程覆盖。',
    _updatedAt: null,
    items: {},
  };
}

export async function readMeta() {
  if (metaCache) return metaCache;
  try {
    const raw = JSON.parse(await fs.readFile(META_PATH, 'utf8'));
    if (!raw.items) raw.items = {};
    metaCache = raw;
  } catch {
    metaCache = emptyMeta();
  }
  return metaCache;
}

export async function writeMeta(meta) {
  meta._updatedAt = new Date().toISOString();
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), 'utf8');
  metaCache = meta;
  return meta;
}

// 元数据键：`{type}/{id}`
export const metaKey = (type, idDb) => `${type}/${Number(idDb)}`;

// 取单条元数据
export async function getEntry(type, idDb) {
  const meta = await readMeta();
  return meta.items[metaKey(type, idDb)] || null;
}

// 写单条元数据
export async function setEntry(type, idDb, patch) {
  const meta = await readMeta();
  const k = metaKey(type, idDb);
  meta.items[k] = {
    ...(meta.items[k] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return writeMeta(meta);
}

// 删单条元数据
export async function delEntry(type, idDb) {
  const meta = await readMeta();
  delete meta.items[metaKey(type, idDb)];
  return writeMeta(meta);
}

// 批量写元数据（一次落盘，避免 N 次 IO）
export async function setEntriesBulk(entries) {
  const meta = await readMeta();
  const now = new Date().toISOString();
  for (const [k, patch] of entries) {
    meta.items[k] = { ...(meta.items[k] || {}), ...patch, updatedAt: now };
  }
  return writeMeta(meta);
}

// ============ 文件状态 ============

// 单张图的状态（是否存在、大小、mtime、来源）
export async function fileStat(type, idDb) {
  const p = iconPath(type, idDb);
  try {
    const st = await fs.stat(p);
    const entry = await getEntry(type, idDb);
    return {
      exists: true,
      size: st.size,
      mtime: st.mtime.toISOString(),
      source: entry?.source || 'unknown',
      note: entry?.note || '',
      origin: entry?.origin || '',
    };
  } catch {
    return { exists: false, size: 0, mtime: null, source: null };
  }
}

// 某类型下已存在的全部 Id（用 readdir，比逐个 stat 快得多）
export async function listIds(type) {
  try {
    const t = ICON_TYPES[type];
    const files = await fs.readdir(typeDir(type));
    const out = new Set();
    const re = new RegExp(`^(\\d+)\\.${t.ext}$`, 'i');
    for (const f of files) {
      const m = re.exec(f);
      if (m) out.add(Number(m[1]));
    }
    return out;
  } catch {
    return new Set();
  }
}

// 三类的本地存量概览
export async function localInventory() {
  const result = {};
  for (const type of ICON_TYPE_KEYS) {
    const ids = await listIds(type);
    let bytes = 0;
    for (const id of ids) {
      try {
        const st = await fs.stat(iconPath(type, id));
        bytes += st.size;
      } catch {}
    }
    result[type] = { count: ids.size, bytes, ids };
  }
  return result;
}

// ============ 写文件 ============

// 写入一张头像（source 默认 manual，因为写文件这个动作基本都来自人工或明确的自动流程）
//
// 两个开关的语义**严格区分**，不要混用：
//   force      —— 允许覆盖「非人工」的文件（auto/cos/unknown）。批量重跑时传 true 是安全的。
//   forceManual—— 允许覆盖「人工」的文件。**只能由针对单张图的显式人工操作传入**，
//                 批量自动流程（生成/爬取/同步）永远不要传，否则人工结果会被冲掉。
//
// 返回 { written: boolean, skipped: boolean, reason?: string }
export async function writeIcon(
  type,
  idDb,
  buf,
  { source = 'manual', note = '', origin = '', force = false, forceManual = false } = {}
) {
  if (!ICON_TYPES[type]) throw new Error(`未知的头像类型: ${type}`);
  if (!buf || !buf.length) throw new Error('图片内容为空');
  const existing = await getEntry(type, idDb);
  const isManualExisting = existing?.source === 'manual';
  // manual 保护：自动流程不能覆盖人工结果（除非显式 forceManual）
  if (isManualExisting && !forceManual) {
    return {
      written: false,
      skipped: true,
      reason: `已有人工指定（${existing.note || '人工上传'}），自动流程不覆盖；如需强改请用「上传/替换」`,
    };
  }
  // 非人工文件：force=false 时也不动（沿用原有"只补空缺"的语义）
  if (existing && !isManualExisting && !force && !forceManual) {
    return { written: false, skipped: true, reason: '已存在（未开启覆盖）' };
  }
  const p = iconPath(type, idDb);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, buf);
  await setEntry(type, idDb, { source, note, origin, size: buf.length, savedAt: new Date().toISOString() });
  return { written: true, skipped: false };
}

// 从本地复制一张图到目标类型（自动生成 PNG→JPG 这类场景）
export async function copyIcon(fromType, toType, idDb, fromIdDb = null, opts = {}) {
  const buf = await fs.readFile(iconPath(fromType, fromIdDb ?? idDb));
  return writeIcon(toType, idDb, buf, opts);
}

// 删除一张头像
export async function deleteIcon(type, idDb) {
  const p = iconPath(type, idDb);
  let existed = true;
  try {
    await fs.unlink(p);
  } catch {
    existed = false;
  }
  await delEntry(type, idDb);
  return { deleted: existed };
}

// 读取一张头像（用于本地预览）
export async function readIcon(type, idDb) {
  return fs.readFile(iconPath(type, idDb));
}
