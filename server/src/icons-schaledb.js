// 基础头像生成：schaledb.com/images/student/collection/{Id_db}.webp → 200×226 PNG + JPG
//
// 实测结论（2026-09-11）：collection 原图就是 200×226，直接转码即可，不需要裁剪。
// 用 sharp（+webp 解码，200×226 是原生尺寸，resize 只是兜底保险）。
import sharp from 'sharp';
import { ICON_TYPES, writeIcon, iconPath, getEntry, setEntriesBulk, metaKey } from './icons-store.js';
import { fetchBuffer, sleep } from './http-util.js';
import fs from 'fs/promises';

const COLLECTION_URL = (id) => `https://schaledb.com/images/student/collection/${id}.webp`;
const SCHALEDB_HEADERS = { Referer: 'https://schaledb.com/' };
const TARGET_W = 200;
const TARGET_H = 226;

// 生成单个学生的两类头像
// 返回 { id, ok, skipped, png:{...}, jpg:{...}, error? }
export async function generateOne(idDb, { force = false, quality = 92 } = {}) {
  const id = Number(idDb);
  const pngPath = iconPath('stu_icon_db_png', id);
  const jpgPath = iconPath('stu_icon_db', id);

  // 非 force 模式下，两张都在且都不是"可覆盖"状态时直接跳过
  if (!force) {
    const [pngMeta, jpgMeta] = await Promise.all([
      getEntry('stu_icon_db_png', id),
      getEntry('stu_icon_db', id),
    ]);
    const pngLocked = pngMeta?.source === 'manual';
    const jpgLocked = jpgMeta?.source === 'manual';
    let pngExists = true;
    let jpgExists = true;
    try { await fs.access(pngPath); } catch { pngExists = false; }
    try { await fs.access(jpgPath); } catch { jpgExists = false; }
    if (pngExists && jpgExists && !pngLocked && !jpgLocked) {
      return { id, ok: true, skipped: true, reason: '两类图均已存在' };
    }
  }

  let webp;
  try {
    const { buf } = await fetchBuffer(COLLECTION_URL(id), {
      headers: SCHALEDB_HEADERS,
      timeout: 60000,
      retries: 3,
      label: 'schaledb',
    });
    webp = buf;
  } catch (e) {
    return { id, ok: false, error: `下载失败: ${e.message}` };
  }

  // 校验是不是真图片（schaledb 对不存在的 id 会返回错误页）
  let meta;
  try {
    meta = await sharp(webp).metadata();
  } catch (e) {
    return { id, ok: false, error: `不是有效图片: ${e.message}` };
  }
  if (!meta.width || !meta.height) {
    return { id, ok: false, error: '图片尺寸读取失败' };
  }

  const notes = [];
  if (meta.width !== TARGET_W || meta.height !== TARGET_H) {
    notes.push(`原图 ${meta.width}×${meta.height} 已缩放到 ${TARGET_W}×${TARGET_H}`);
  }

  let pngBuf;
  let jpgBuf;
  try {
    pngBuf = await sharp(webp)
      .resize(TARGET_W, TARGET_H, { fit: 'fill' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    jpgBuf = await sharp(webp)
      .resize(TARGET_W, TARGET_H, { fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality })
      .toBuffer();
  } catch (e) {
    return { id, ok: false, error: `转码失败: ${e.message}` };
  }

  const note = notes.join('；');
  const results = {};
  try {
    // 注意：这里**只传 force，不传 forceManual**。
    // force=true 表示"重跑可以覆盖旧的自动图"，但人工上传的图永远不被自动流程冲掉。
    results.png = await writeIcon('stu_icon_db_png', id, pngBuf, {
      source: 'auto',
      origin: COLLECTION_URL(id),
      note,
      force,
    });
    results.jpg = await writeIcon('stu_icon_db', id, jpgBuf, {
      source: 'auto',
      origin: COLLECTION_URL(id),
      note,
      force,
    });
  } catch (e) {
    return { id, ok: false, error: `写盘失败: ${e.message}` };
  }

  return {
    id,
    ok: true,
    skipped: false,
    png: results.png,
    jpg: results.jpg,
    srcSize: webp.length,
    outSize: pngBuf.length + jpgBuf.length,
    note,
  };
}

// 批量生成（串行 + 小间隔，避免把 schaledb 打挂）
export async function generateBatch(ids, { force = false, onProgress, delay = 60 } = {}) {
  const summary = { total: ids.length, ok: 0, skipped: 0, failed: [], wrotePng: 0, wroteJpg: 0, bytes: 0 };
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const r = await generateOne(id, { force });
    if (!r.ok) {
      summary.failed.push({ id, error: r.error });
    } else if (r.skipped) {
      summary.skipped++;
    } else {
      summary.ok++;
      if (r.png?.written) summary.wrotePng++;
      if (r.jpg?.written) summary.wroteJpg++;
      summary.bytes += r.outSize || 0;
    }
    if (onProgress) onProgress({ done: i + 1, total: ids.length, id, result: r });
    if (delay && i < ids.length - 1) await sleep(delay);
  }
  return summary;
}
