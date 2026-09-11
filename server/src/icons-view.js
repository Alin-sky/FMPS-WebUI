// 头像视图：把「学生列表」和「头像状态」拼成前端要用的形状
//
// 单独一层的原因：前端页面要的是「一个学生一行、三类图状态全在」，而不是三次目录扫描。
// 这里做一次内存聚合，避免前端发 N 个请求。
import fs from 'fs/promises';
import { ICON_TYPE_KEYS, ICON_TYPES, iconPath, listIds, readMeta, metaKey } from './icons-store.js';

// 读取某类型的全部本地状态（id → {exists, size, mtime, source}）
async function localState(type) {
  const ids = await listIds(type);
  const map = new Map();
  for (const id of ids) {
    try {
      const st = await fs.stat(iconPath(type, id));
      map.set(Number(id), { exists: true, size: st.size, mtime: st.mtime.toISOString() });
    } catch {
      map.set(Number(id), { exists: false });
    }
  }
  return map;
}

// 汇总三类图的本地状态 + 元数据来源
// 返回 { byId: Map<id, {[type]: {exists,size,mtime,source}}>, counts: {} }
export async function iconStateIndex() {
  const meta = await readMeta();
  const states = {};
  for (const type of ICON_TYPE_KEYS) states[type] = await localState(type);

  const allIds = new Set();
  for (const type of ICON_TYPE_KEYS) for (const id of states[type].keys()) allIds.add(id);

  const byId = new Map();
  const counts = {};
  for (const type of ICON_TYPE_KEYS) counts[type] = { total: states[type].size, bytes: 0 };

  for (const id of allIds) {
    const entry = {};
    for (const type of ICON_TYPE_KEYS) {
      const s = states[type].get(id);
      const m = meta.items[metaKey(type, id)];
      entry[type] = s?.exists
        ? { exists: true, size: s.size, mtime: s.mtime, source: m?.source || 'unknown', note: m?.note || '' }
        : { exists: false, source: null };
      if (s?.exists) counts[type].bytes += s.size;
    }
    byId.set(Number(id), entry);
  }
  return { byId, counts, ids: [...allIds].sort((a, b) => a - b) };
}

// 把学生列表 + 头像状态拼成表格行
// students: aggregateStudents() 的输出
// filter: { missing: bool, abnormal: bool, idFrom, idTo, type }
export async function iconRows(students, filter = {}) {
  const { byId, counts } = await iconStateIndex();
  const rows = [];
  for (const s of students) {
    const id = Number(s.Id_db);
    const st = byId.get(id) || {};
    const status = {};
    for (const type of ICON_TYPE_KEYS) {
      const e = st[type] || { exists: false };
      status[type] = {
        exists: e.exists,
        size: e.size || 0,
        mtime: e.mtime || null,
        source: e.source || null,
        note: e.note || '',
      };
    }
    const missingTypes = ICON_TYPE_KEYS.filter((t) => !status[t].exists);
    const row = {
      Id_db: id,
      Name_jp: s.Name_jp || '',
      Name_zh_cn: s.Name_zh_cn || '',
      Name_en: s.Name_en || '',
      StarGrade: s.StarGrade ?? null,
      IsLimited: !!s.IsLimited,
      status,
      missingTypes,
      missingCount: missingTypes.length,
      complete: missingTypes.length === 0,
      // 有图但来源不是 auto 的，标出来（人工改过的要能一眼看到）
      hasManual: ICON_TYPE_KEYS.some((t) => status[t].source === 'manual'),
    };
    rows.push(row);
  }

  let filtered = rows;
  if (filter.missing) filtered = filtered.filter((r) => r.missingCount > 0);
  if (filter.abnormal) filtered = filtered.filter((r) => r.hasManual || (r.missingCount > 0 && r.missingCount < ICON_TYPE_KEYS.length));
  if (filter.type) filtered = filtered.filter((r) => !r.status[filter.type]?.exists);
  if (filter.idFrom !== undefined && filter.idFrom !== null && filter.idFrom !== '') {
    filtered = filtered.filter((r) => r.Id_db >= Number(filter.idFrom));
  }
  if (filter.idTo !== undefined && filter.idTo !== null && filter.idTo !== '') {
    filtered = filtered.filter((r) => r.Id_db <= Number(filter.idTo));
  }
  if (filter.keyword) {
    const kw = String(filter.keyword).toLowerCase();
    filtered = filtered.filter(
      (r) =>
        String(r.Id_db).includes(kw) ||
        r.Name_jp.toLowerCase().includes(kw) ||
        r.Name_zh_cn.toLowerCase().includes(kw) ||
        r.Name_en.toLowerCase().includes(kw)
    );
  }

  return {
    rows: filtered,
    total: rows.length,
    filtered: filtered.length,
    counts,
    types: ICON_TYPE_KEYS.map((k) => ({ key: k, ...ICON_TYPES[k] })),
    // 三类都为「无图」的学生数（最需要处理的）
    emptyCount: rows.filter((r) => r.missingCount === ICON_TYPE_KEYS.length).length,
    partialCount: rows.filter((r) => r.missingCount > 0 && r.missingCount < ICON_TYPE_KEYS.length).length,
    completeCount: rows.filter((r) => r.complete).length,
    manualCount: rows.filter((r) => r.hasManual).length,
  };
}
