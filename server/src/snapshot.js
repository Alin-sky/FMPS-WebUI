// 快照与 diff：爬取前备份数据，对比新旧找出变更
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const snapDir = path.join(config.dataDir, 'snapshots');

// 把当前 data/json 备份为带时间戳的快照
export async function saveSnapshot() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(snapDir, ts);
  await fs.mkdir(dir, { recursive: true });
  let files = [];
  try {
    files = await fs.readdir(config.jsonDir);
  } catch {
    return ts;
  }
  for (const f of files) {
    if (f.endsWith('.json')) {
      await fs.copyFile(path.join(config.jsonDir, f), path.join(dir, f));
    }
  }
  return ts;
}

// 加载最新一份快照
export async function loadLatestSnapshot() {
  try {
    const dirs = (await fs.readdir(snapDir)).sort().reverse();
    if (dirs.length === 0) return null;
    const dir = path.join(snapDir, dirs[0]);
    const files = await fs.readdir(dir);
    const data = {};
    for (const f of files) {
      if (f.endsWith('.json')) {
        data[f] = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
      }
    }
    return { ts: dirs[0], data };
  } catch {
    return null;
  }
}

// 列出所有快照时间戳
export async function listSnapshots() {
  try {
    return (await fs.readdir(snapDir)).sort().reverse();
  } catch {
    return [];
  }
}

// 把最新快照恢复到 data/json（全部复原）
export async function restoreSnapshot() {
  const snapshot = await loadLatestSnapshot();
  if (!snapshot) return null;
  for (const [fname, data] of Object.entries(snapshot.data)) {
    await fs.writeFile(path.join(config.jsonDir, fname), JSON.stringify(data, null, 2), 'utf8');
  }
  return snapshot.ts;
}

// 单个角色复原到快照（跨所有文件：studata/toaro/favor/gacha/favora）
// exceptId=true 时，仅 sms_studata_main 保留当前 Id，其余字段用快照值
export async function revertStudent(id, exceptId = false) {
  const snapshot = await loadLatestSnapshot();
  if (!snapshot) return { ok: false, error: '无可用快照' };

  const toNum = (v) => Number(v);
  // 各文件 + 该文件里的聚合键名
  const plainFiles = [
    ['sms_studata_main.json', 'Id_db'],
    ['sms_studata_toaro_stu.json', 'Id_db'],
    ['favor_stu_tap.json', 'id'],
    ['favora_data.json', 'stuid'],
  ];

  for (const [fname, key] of plainFiles) {
    const prevArr = snapshot.data[fname];
    if (!prevArr || !Array.isArray(prevArr)) continue;
    const prevItem = prevArr.find((s) => toNum(s[key]) === id);
    const currPath = path.join(config.jsonDir, fname);
    let currArr;
    try {
      currArr = JSON.parse(await fs.readFile(currPath, 'utf8'));
    } catch {
      currArr = [];
    }
    if (!Array.isArray(currArr)) currArr = [];
    const currItem = currArr.find((s) => toNum(s[key]) === id);

    if (currItem && prevItem) {
      if (exceptId && fname === 'sms_studata_main.json') {
        const keepId = currItem.Id;
        Object.assign(currItem, JSON.parse(JSON.stringify(prevItem)));
        currItem.Id = keepId;
      } else {
        Object.assign(currItem, JSON.parse(JSON.stringify(prevItem)));
      }
    } else if (!currItem && prevItem) {
      currArr.push(JSON.parse(JSON.stringify(prevItem))); // 恢复被删除的角色
    } else if (currItem && !prevItem) {
      currArr.splice(currArr.indexOf(currItem), 1); // 删除新增的角色
    }
    await fs.writeFile(currPath, JSON.stringify(currArr, null, 2), 'utf8');
  }

  // gacha_data.json 是 [卡池0, 学生数组1] 结构
  const prevGacha = snapshot.data['gacha_data.json'];
  if (prevGacha && Array.isArray(prevGacha[1])) {
    const prevItem = prevGacha[1].find((s) => toNum(s.id) === id);
    const currPath = path.join(config.jsonDir, 'gacha_data.json');
    try {
      const currGacha = JSON.parse(await fs.readFile(currPath, 'utf8'));
      if (Array.isArray(currGacha[1])) {
        const currItem = currGacha[1].find((s) => toNum(s.id) === id);
        if (currItem && prevItem) {
          Object.assign(currItem, JSON.parse(JSON.stringify(prevItem)));
        } else if (!currItem && prevItem) {
          currGacha[1].push(JSON.parse(JSON.stringify(prevItem)));
        } else if (currItem && !prevItem) {
          currGacha[1].splice(currGacha[1].indexOf(currItem), 1);
        }
        await fs.writeFile(currPath, JSON.stringify(currGacha, null, 2), 'utf8');
      }
    } catch {}
  }

  return { ok: true, id };
}

// 对比学生数据：新增 / 删除 / 修改
export function diffStudents(prev, curr) {
  if (!prev || !Array.isArray(prev)) {
    return { added: curr || [], removed: [], modified: [], hasSnapshot: false };
  }
  const prevMap = new Map(prev.map((s) => [s.Id_db, s]));
  const currMap = new Map(curr.map((s) => [s.Id_db, s]));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, s] of currMap) {
    if (!prevMap.has(id)) added.push(s);
    else if (JSON.stringify(prevMap.get(id)) !== JSON.stringify(s)) {
      modified.push({ id, prev: prevMap.get(id), curr: s });
    }
  }
  for (const [id, s] of prevMap) {
    if (!currMap.has(id)) removed.push(s);
  }
  return { added, removed, modified, hasSnapshot: true };
}

// 对比单个学生的字段差异（用于详情展示）
export function diffFields(prevStu, currStu) {
  const keys = new Set([...Object.keys(prevStu || {}), ...Object.keys(currStu || {})]);
  const fields = [];
  for (const k of keys) {
    const p = JSON.stringify(prevStu?.[k]);
    const c = JSON.stringify(currStu?.[k]);
    if (p !== c) fields.push({ key: k, prev: prevStu?.[k], curr: currStu?.[k] });
  }
  return fields;
}
