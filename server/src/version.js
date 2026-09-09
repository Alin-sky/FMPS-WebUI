// 版本管理：发布后归档版本、查看版本、变更摘要、复原到版本
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';

const verDir = path.join(config.dataDir, 'versions');

// 对比两个 studata 数组，返回变更摘要
function diffStudataSummary(prev, curr) {
  const prevMap = new Map((prev || []).map((s) => [s.Id_db, s]));
  const currMap = new Map((curr || []).map((s) => [s.Id_db, s]));
  const added = [];
  const removed = [];
  const modified = [];
  for (const [id, s] of currMap) {
    if (!prevMap.has(id)) {
      added.push({ Id_db: id, Name: s.Name_zh_cn || s.Name_en || '' });
    } else if (JSON.stringify(prevMap.get(id)) !== JSON.stringify(s)) {
      modified.push({ Id_db: id, Name: s.Name_zh_cn || s.Name_en || '' });
    }
  }
  for (const [id, s] of prevMap) {
    if (!currMap.has(id)) removed.push({ Id_db: id, Name: s.Name_zh_cn || s.Name_en || '' });
  }
  return { added, removed, modified };
}

// 读取某个版本的 studata（用于对比）
async function readVersionStudata(ts) {
  try {
    return JSON.parse(await fs.readFile(path.join(verDir, ts, 'sms_studata_main.json'), 'utf8'));
  } catch {
    return null;
  }
}

// 归档当前 data/json 为版本，并生成变更摘要（vs 上一版本）
export async function archiveVersion() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(verDir, ts);
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(config.jsonDir)).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    await fs.copyFile(path.join(config.jsonDir, f), path.join(dir, f));
  }
  // 找上一个版本做对比
  let summary = { added: [], removed: [], modified: [], prevTs: null };
  try {
    const dirs = (await fs.readdir(verDir)).filter((d) => d !== ts).sort();
    if (dirs.length > 0) {
      const prevTs = dirs[dirs.length - 1];
      const prevStudata = await readVersionStudata(prevTs);
      const currStudata = await readVersionStudata(ts);
      summary = { ...diffStudataSummary(prevStudata, currStudata), prevTs };
    }
  } catch {}
  await fs.writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return { ts, ...summary };
}

// 列出所有版本（倒序，最新在前）
export async function listVersions() {
  try {
    const dirs = (await fs.readdir(verDir)).sort().reverse();
    const versions = [];
    for (const d of dirs) {
      if (d === '.gitkeep') continue;
      let summary = { added: [], removed: [], modified: [] };
      try {
        summary = JSON.parse(await fs.readFile(path.join(verDir, d, 'summary.json'), 'utf8'));
      } catch {}
      versions.push({
        ts: d,
        added: summary.added || [],
        removed: summary.removed || [],
        modified: summary.modified || [],
        prevTs: summary.prevTs || null,
      });
    }
    return versions;
  } catch {
    return [];
  }
}

// 整体复原到指定版本
export async function restoreVersion(ts) {
  const dir = path.join(verDir, ts);
  let count = 0;
  const files = await fs.readdir(dir);
  for (const f of files) {
    if (f.endsWith('.json') && f !== 'summary.json') {
      await fs.copyFile(path.join(dir, f), path.join(config.jsonDir, f));
      count++;
    }
  }
  return { ts, count };
}

// 单个角色复原到指定版本（跨所有文件）
export async function revertStudentToVersion(id, ts, exceptId = false) {
  const dir = path.join(verDir, ts);
  const toNum = (v) => Number(v);

  const plainFiles = [
    ['sms_studata_main.json', 'Id_db'],
    ['sms_studata_toaro_stu.json', 'Id_db'],
    ['favor_stu_tap.json', 'id'],
    ['favora_data.json', 'stuid'],
  ];

  for (const [fname, key] of plainFiles) {
    let prevArr;
    try {
      prevArr = JSON.parse(await fs.readFile(path.join(dir, fname), 'utf8'));
    } catch {
      continue;
    }
    const prevItem = prevArr.find((s) => toNum(s[key]) === id);
    const currPath = path.join(config.jsonDir, fname);
    let currArr;
    try {
      currArr = JSON.parse(await fs.readFile(currPath, 'utf8'));
    } catch {
      currArr = [];
    }
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
      currArr.push(JSON.parse(JSON.stringify(prevItem)));
    } else if (currItem && !prevItem) {
      currArr.splice(currArr.indexOf(currItem), 1);
    }
    await fs.writeFile(currPath, JSON.stringify(currArr, null, 2), 'utf8');
  }

  // gacha_data.json
  try {
    const prevGacha = JSON.parse(await fs.readFile(path.join(dir, 'gacha_data.json'), 'utf8'));
    if (Array.isArray(prevGacha[1])) {
      const prevItem = prevGacha[1].find((s) => toNum(s.id) === id);
      const currPath = path.join(config.jsonDir, 'gacha_data.json');
      const currGacha = JSON.parse(await fs.readFile(currPath, 'utf8'));
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

  return { ok: true, id, ts };
}
