// REST API 路由
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { loadAllData, aggregateStudents, stats } from './aggregate.js';
import { fetchBinary, fetchJson } from './crawler.js';
import { config } from './config.js';
import { loadLatestSnapshot, listSnapshots, diffStudents, diffFields, restoreSnapshot, revertStudent } from './snapshot.js';
import { listVersions, restoreVersion, revertStudentToVersion } from './version.js';
import {
  localManifest,
  putCloudRelease,
  listCloudReleases,
  readCloudRelease,
  rebuildCloudReleases,
  diffReleaseStudents,
  diffReleaseFiles,
  diffCloudReleaseVsLocal,
  applyCloudRelease,
} from './release-cloud.js';
import { runCrawl, crawlEvents } from './crawl.js';
import { fetchCloudStudents, diffCloud } from './cloud.js';
import { editStudent } from './edit.js';
import { loadAliasConfig, saveAliasConfig } from './alias-config.js';
import { createIconsRouter } from './icons-routes.js';

const SKIP_PATH = path.join(config.dataDir, 'skip-list.json');
const PUBLISH_CONFIG_PATH = path.join(config.dataDir, 'publish-config.json');

async function readSkipList() {
  try { return JSON.parse(await fs.readFile(SKIP_PATH, 'utf8')); } catch { return []; }
}
async function writeSkipList(list) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(SKIP_PATH, JSON.stringify(list, null, 2), 'utf8');
}
async function readPublishConfig() {
  try { return JSON.parse(await fs.readFile(PUBLISH_CONFIG_PATH, 'utf8')); } catch { return null; }
}

// Arona 匹配名修正表（revisions）
async function readRevisions() {
  try { return JSON.parse(await fs.readFile(path.join(config.jsonDir, 'sms_to_arona_data_revisions.json'), 'utf8')); } catch { return []; }
}
async function writeRevisions(list) {
  await fs.mkdir(config.jsonDir, { recursive: true });
  await fs.writeFile(path.join(config.jsonDir, 'sms_to_arona_data_revisions.json'), JSON.stringify(list, null, 2), 'utf8');
}

// 图片本地缓存：先读本地，没有则下载并保存
async function cachedImage(cacheDir, key, remoteUrl) {
  const filePath = path.join(config.imgDir, cacheDir, `${key}.webp`);
  try {
    return await fs.readFile(filePath);
  } catch {}
  const buf = await fetchBinary(remoteUrl);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buf);
  } catch {}
  return buf;
}

export function createRouter() {
  const router = express.Router();

  // 头像管理（存储 / 生成 / 抓取 / COS 同步 / 上传），独立子路由
  router.use(createIconsRouter());

  // 学生列表 + 统计
  router.get('/api/students', async (req, res) => {
    try {
      const data = await loadAllData();
      const students = aggregateStudents(data);
      res.json({ students, stats: stats(data, students) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 单个学生详情
  router.get('/api/students/:id', async (req, res) => {
    try {
      const data = await loadAllData();
      const students = aggregateStudents(data);
      const st = students.find((s) => s.Id_db === Number(req.params.id));
      if (!st) return res.status(404).json({ error: 'not found' });
      res.json(st);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 单个学生的原始 JSON（各文件里该角色的原始条目）
  router.get('/api/students/:id/raw', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const data = await loadAllData();
      const raw = {};
      if (data.studata) raw.sms_studata_main = data.studata.find((s) => s.Id_db === id);
      if (data.toaro) raw.sms_studata_toaro_stu = data.toaro.find((s) => s.Id_db === id);
      if (data.favor_tap) raw.favor_stu_tap = data.favor_tap.find((s) => s.id === id);
      if (data.gacha && Array.isArray(data.gacha[1])) raw.gacha_data = data.gacha[1].find((s) => s.id === id);
      if (data.favora) raw.favora_data = data.favora.find((s) => s.stuid === id);
      if (data.satellite) raw.khrtalk_satellite = data.satellite.find((s) => s.Id_db === id);
      res.json({ Id_db: id, raw });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 编辑单个学生的原始 JSON（写回对应文件的该角色条目）
  router.put('/api/students/:id/raw', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { fileName, data } = req.body;
      if (!fileName || data === undefined) return res.status(400).json({ error: '需要 fileName 和 data' });
      let safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!safe.endsWith('.json')) safe += '.json';
      const keyMap = {
        'sms_studata_main.json': 'Id_db',
        'sms_studata_toaro_stu.json': 'Id_db',
        'favor_stu_tap.json': 'id',
        'gacha_data.json': 'id',
        'favora_data.json': 'stuid',
        'khrtalk_satellite.json': 'Id_db',
      };
      const key = keyMap[safe];
      if (!key) return res.status(400).json({ error: '不支持的文件' });
      const filePath = path.join(config.jsonDir, safe);
      const fileData = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (safe === 'gacha_data.json') {
        const idx = fileData[1].findIndex((s) => s.id === id);
        if (idx >= 0) fileData[1][idx] = data;
      } else {
        const idx = fileData.findIndex((s) => s[key] === id);
        if (idx >= 0) fileData[idx] = data;
      }
      await fs.writeFile(filePath, JSON.stringify(fileData, null, 2), 'utf8');
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 编辑学生（写回对应 JSON）
  router.put('/api/students/:id', async (req, res) => {
    try {
      const idDb = Number(req.params.id);
      const result = await editStudent(idDb, req.body.changes || req.body);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 别名配置：读取
  router.get('/api/alias-config', async (req, res) => {
    try {
      res.json({ groups: await loadAliasConfig() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 别名配置：保存
  router.put('/api/alias-config', async (req, res) => {
    try {
      const groups = req.body.groups;
      if (!Array.isArray(groups)) return res.status(400).json({ error: 'groups 必须是数组' });
      await saveAliasConfig(groups);
      res.json({ ok: true, groups });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 统计概览
  router.get('/api/stats', async (req, res) => {
    try {
      const data = await loadAllData();
      const students = aggregateStudents(data);
      res.json(stats(data, students));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 触发爬取（同步，前端等待）
  router.post('/api/crawl', async (req, res) => {
    try {
      const result = await runCrawl();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 云端更新：从 COS 复制所有 JSON 到本地（不做算法），并和上一版本快照校验
  router.post('/api/crawl/cloud', async (req, res) => {
    try {
      const { fetchCloudJson } = await import('./cloud.js');
      // 1. 先备份快照（用于校验）
      const { saveSnapshot } = await import('./snapshot.js');
      const ts = await saveSnapshot();
      // 2. 列出 COS 上所有 JSON 文件名（从 hash.json 获取）
      let files = [];
      try {
        const hash = await fetchCloudJson('hash.json');
        files = (hash || []).map((h) => h.fname).filter((f) => f && f.endsWith('.json'));
      } catch {}
      if (files.length === 0) {
        files = ['sms_studata_main.json', 'sms_studata_toaro_stu.json', 'favor_stu_tap.json', 'favora_data.json', 'liwu_list_rep.json', 'gacha_data.json', 'khrtalk_satellite.json', 'sms_othersmatchlib.json', 'sms_to_arona_data_revisions.json', 'manga_main.json', 'map_guide_shangxue.json'];
      }
      // 3. 逐个下载并写回本地
      let downloaded = 0;
      const fail = [];
      for (const f of files) {
        try {
          const data = await fetchCloudJson(f);
          if (data !== undefined && data !== null) {
            await fs.mkdir(config.jsonDir, { recursive: true });
            await fs.writeFile(path.join(config.jsonDir, f), JSON.stringify(data, null, 2), 'utf8');
            downloaded++;
          }
        } catch {
          fail.push(f);
        }
      }
      res.json({ ok: true, downloaded, failed: fail, snapshotTs: ts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 全部复原：恢复到上一版本快照
  router.post('/api/revert/all', async (req, res) => {
    try {
      const ts = await restoreSnapshot();
      if (!ts) return res.status(400).json({ error: '无可用快照' });
      res.json({ ok: true, restoredFrom: ts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 除 ID 外复原：除 Id 字段外，其他字段恢复到上一版本快照
  router.post('/api/revert/except-id', async (req, res) => {
    try {
      const snapshot = await loadLatestSnapshot();
      if (!snapshot) return res.status(400).json({ error: '无可用快照' });
      const prevStudata = snapshot.data['sms_studata_main.json'];
      const currPath = path.join(config.jsonDir, 'sms_studata_main.json');
      const currStudata = JSON.parse(await fs.readFile(currPath, 'utf8'));
      const prevMap = new Map((prevStudata || []).map((s) => [s.Id_db, s]));
      let changed = 0;
      for (const s of currStudata) {
        const p = prevMap.get(s.Id_db);
        if (!p) continue;
        const keepId = s.Id;
        const restored = { ...p, Id: keepId };
        if (JSON.stringify(restored) !== JSON.stringify(s)) {
          Object.assign(s, restored);
          changed++;
        }
      }
      await fs.writeFile(currPath, JSON.stringify(currStudata, null, 2), 'utf8');
      res.json({ ok: true, changed, restoredFrom: snapshot.ts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 单个角色：全部复原（优先最新版本，无版本则快照）
  router.post('/api/revert/student/:id/all', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const versions = await listVersions();
      const result = versions.length > 0
        ? await revertStudentToVersion(id, versions[0].ts, false)
        : await revertStudent(id, false);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 单个角色：除 ID 外复原（优先最新版本，无版本则快照）
  router.post('/api/revert/student/:id/except-id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const versions = await listVersions();
      const result = versions.length > 0
        ? await revertStudentToVersion(id, versions[0].ts, true)
        : await revertStudent(id, true);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 版本列表
  router.get('/api/versions', async (req, res) => {
    try {
      res.json({ versions: await listVersions() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 整体复原到指定版本
  router.post('/api/versions/:ts/restore', async (req, res) => {
    try {
      const result = await restoreVersion(req.params.ts);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ==================== 云端发布记录 ====================
  // 本地版本归档只存在本机，换台设备发布就看不到了。
  // 云端记录写在 COS 的 releases/ 下，任何设备都能读到。
  router.get('/api/cloud-releases', async (req, res) => {
    try {
      const releases = await listCloudReleases();
      res.json({ releases, count: releases.length });
    } catch (e) {
      res.status(500).json({ error: e.message, releases: [] });
    }
  });

  // 从 COS 现状重建/补齐发布记录（给"在别的设备发布过、本机没记录"的历史补档）
  router.post('/api/cloud-releases/rebuild', async (req, res) => {
    try {
      const r = await rebuildCloudReleases({});
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 某次云端发布的详情（文件清单 + 相对上一次发布的学生级差异）
  router.get('/api/cloud-releases/:ts', async (req, res) => {
    try {
      const ts = req.params.ts;
      const manifest = await readCloudRelease(ts);
      if (!manifest) return res.status(404).json({ error: `云端没有 ${ts} 的发布记录` });

      const releases = await listCloudReleases();
      // releases 是倒序（最新在前），"上一个"就是列表里排在它后面的那条
      const idx = releases.findIndex((r) => r.ts === ts);
      const prevEntry = idx >= 0 && idx < releases.length - 1 ? releases[idx + 1] : null;
      const prev = prevEntry ? await readCloudRelease(prevEntry.ts) : null;

      // 没有上一版本时**不要**返回"15 个文件全是新增" —— 那是 diffReleaseFiles(null, x) 的假象。
      // 显式告知前端「无对比基准」。
      const students = prev
        ? diffReleaseStudents(prev, manifest)
        : { available: false, reason: '这是最早的一次云端发布，没有可对比的前一版本', added: [], removed: [], modified: [] };
      const files = prev
        ? diffReleaseFiles(prev, manifest)
        : { hasPrev: false, added: [], removed: [], modified: [], same: 0 };

      res.json({
        release: manifest,
        prevTs: prev ? prev.ts : null,
        prevReleasedAt: prev ? prev.releasedAt : null,
        hasPrev: !!prev,
        students,
        files,
        isLatest: idx === 0,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 该云端版本 vs 本地现状（added = 本地有云端无，即待上传的新增）
  router.get('/api/cloud-releases/:ts/compare-local', async (req, res) => {
    try {
      res.json(await diffCloudReleaseVsLocal(req.params.ts));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 把某个云端版本拉到本地（会先把本地现状归档成版本，可回滚）
  router.post('/api/cloud-releases/:ts/apply', async (req, res) => {
    try {
      const result = await applyCloudRelease(req.params.ts, {});
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // SSE 日志流（爬取实时日志）
  router.get('/api/crawl/log', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.flushHeaders();
    res.write('retry: 1000\n\n');
    const listener = (msg) => {
      res.write(`data: ${JSON.stringify({ msg, time: Date.now() })}\n\n`);
    };
    crawlEvents.on('log', listener);
    req.on('close', () => crawlEvents.off('log', listener));
  });

  // diff 对比（当前 vs 最新快照）
  router.get('/api/diff', async (req, res) => {
    try {
      const data = await loadAllData();
      const snapshot = await loadLatestSnapshot();
      const prevStudata = snapshot ? snapshot.data['sms_studata_main.json'] : null;
      const diff = diffStudents(prevStudata, data.studata);
      res.json({
        snapshotTs: snapshot ? snapshot.ts : null,
        hasSnapshot: snapshot !== null,
        added: diff.added,
        removed: diff.removed,
        modified: diff.modified,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 更新模式：拉取 COS 数据对比本地，返回变更
  router.get('/api/cloud/diff', async (req, res) => {
    try {
      const data = await loadAllData();
      const cloud = await fetchCloudStudents();
      const diff = diffCloud(data.studata, cloud);
      res.json({
        cloudAvailable: diff.cloudAvailable,
        cloudCount: cloud ? cloud.length : 0,
        localCount: data.studata ? data.studata.length : 0,
        added: diff.added,
        removed: diff.removed,
        modified: diff.modified,
        unchanged: diff.unchanged,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 单个学生的字段级 diff
  router.get('/api/diff/student/:id', async (req, res) => {
    try {
      const data = await loadAllData();
      const students = aggregateStudents(data);
      const curr = students.find((s) => s.Id_db === Number(req.params.id));
      const snapshot = await loadLatestSnapshot();
      let prev = null;
      if (snapshot && snapshot.data['sms_studata_main.json']) {
        prev = snapshot.data['sms_studata_main.json'].find((s) => s.Id_db === Number(req.params.id)) || null;
      }
      res.json({
        fields: diffFields(prev, curr),
        hasSnapshot: snapshot !== null,
        isNew: prev === null,
        isRemoved: curr === undefined,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 快照列表
  router.get('/api/snapshots', async (req, res) => {
    try {
      res.json({ snapshots: await listSnapshots() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 头像代理（本地缓存，绕过 schaledb Referer 限制；主页用 collection 立绘）
  router.get('/api/avatar/:id', async (req, res) => {
    try {
      const buf = await cachedImage('avatar', req.params.id, config.avatar.collection(req.params.id));
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (e) {
      res.status(404).end();
    }
  });

  // 礼物图片代理（本地缓存）
  router.get('/api/item/:icon', async (req, res) => {
    try {
      const url = `https://schaledb.com/images/item/full/${req.params.icon}.webp`;
      const buf = await cachedImage('item', req.params.icon, url);
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (e) {
      res.status(404).end();
    }
  });

  // 可查看的 JSON 文件列表（json 目录 + data 目录数据文件，供原始 JSON 查看器选择）
  router.get('/api/json-files', async (req, res) => {
    try {
      const files = [];
      try {
        const jsonFiles = (await fs.readdir(config.jsonDir)).filter((f) => f.endsWith('.json')).sort();
        for (const f of jsonFiles) files.push({ fname: f, dir: 'json' });
      } catch {}
      // data 目录下的数据文件（不含 publish-config.json 等敏感/无关文件）
      const dataWhitelist = ['manga_info.json', 'skip-list.json', 'alias-config.json'];
      for (const f of dataWhitelist) {
        try {
          await fs.access(path.join(config.dataDir, f));
          files.push({ fname: f, dir: 'data' });
        } catch {}
      }
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 查看原始 JSON 文件（优先 json 目录，其次 data 目录，支持 manga_info.json 等）
  router.get('/api/raw/:fname', async (req, res) => {
    try {
      const fname = req.params.fname.replace(/[^a-zA-Z0-9._-]/g, '');
      const candidates = [path.join(config.jsonDir, fname), path.join(config.dataDir, fname)];
      for (const p of candidates) {
        try {
          const raw = JSON.parse(await fs.readFile(p, 'utf8'));
          return res.json({ fname, data: raw });
        } catch {}
      }
      res.status(404).json({ error: '文件不存在' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 导入 JSON 数据（作为种子/历史昵称）
  router.post('/api/import', async (req, res) => {
    try {
      const { fname, data } = req.body;
      if (!fname || data === undefined) return res.status(400).json({ error: '需要 fname 和 data' });
      const safe = fname.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!safe.endsWith('.json')) return res.status(400).json({ error: '文件名必须是 .json' });
      await fs.mkdir(config.jsonDir, { recursive: true });
      await fs.writeFile(path.join(config.jsonDir, safe), JSON.stringify(data, null, 2), 'utf8');
      res.json({ ok: true, fname: safe, count: Array.isArray(data) ? data.length : null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 导出 JSON（测试模式：复制当前生成的 JSON 到 export 目录，供与老 FMPS 比对）
  router.post('/api/export', async (req, res) => {
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const exportDir = path.join(config.dataDir, 'export', ts);
      await fs.mkdir(exportDir, { recursive: true });
      const files = (await fs.readdir(config.jsonDir)).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        await fs.copyFile(path.join(config.jsonDir, f), path.join(exportDir, f));
      }
      res.json({ ok: true, dir: exportDir, count: files.length, files });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Arona 匹配名修正表（revisions）：读取
  router.get('/api/revisions', async (req, res) => {
    try {
      let revisions = await readRevisions();
      res.json({ revisions });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  // 写回整个修正表
  router.put('/api/revisions', async (req, res) => {
    try {
      const list = Array.isArray(req.body.revisions) ? req.body.revisions : [];
      await writeRevisions(list);
      res.json({ ok: true, count: list.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 跳过爬取列表
  router.get('/api/skip-list', async (req, res) => {
    res.json({ skipIds: await readSkipList() });
  });
  router.put('/api/skip-list', async (req, res) => {
    try {
      const ids = (req.body.skipIds || []).map(Number);
      await writeSkipList(ids);
      res.json({ skipIds: ids });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  router.put('/api/skip/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const list = await readSkipList();
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1); else list.push(id);
      await writeSkipList(list);
      res.json({ skipIds: list, skipped: list.includes(id) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 匹配测试（阿罗娜 API 检测 MapName 是否精确匹配，参考 koishi name_detection）
  router.get('/api/match-test', async (req, res) => {
    try {
      const text = (req.query.text || '').trim();
      if (!text) return res.json({ text, code: null, exact: false, data: [] });
      const url = 'https://arona.diyigemt.com/api/v2/image?name=' + encodeURIComponent(text);
      const arona = await fetchJson(url);
      const ARONA_IMG_CDN = 'https://arona.cdn.diyigemt.com/image';
      res.json({
        text,
        code: arona.code,
        message: arona.message,
        exact: arona.code !== 101,
        data: (arona.data || []).map((d) => ({
          ...d,
          imageUrl: (d.content || d.path) ? ARONA_IMG_CDN + (d.content || d.path) : null,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 漫画更新模式 =====

  // 漫画数据：manga_main 列表 + 话信息 + 爬取状态
  router.get('/api/manga', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const [main, info, state, cosIds] = await Promise.all([
        manga.readMangaMain(),
        manga.readMangaInfo(),
        Promise.resolve(manga.getMangaCrawlState()),
        manga.getCosBaselineIds().catch(() => null),
      ]);
      res.json({ manga: main, info, state, running: !!(state && state.running), cosIds: cosIds ? [...cosIds] : null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 从 COS 拉取当前 manga_main.json（话数基准）
  router.post('/api/manga/cos', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const cloud = await manga.fetchCosManga();
      if (!cloud) return res.status(400).json({ error: 'COS 上拉取 manga_main.json 失败' });
      // 写入本地作为基准
      const fs2 = await import('fs/promises');
      await fs2.mkdir(config.jsonDir, { recursive: true });
      await fs2.writeFile(path.join(config.jsonDir, 'manga_main.json'), JSON.stringify(cloud, null, 2), 'utf8');
      res.json({ ok: true, count: cloud.length, latestId: cloud.length ? cloud[cloud.length - 1].id : null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 漫画目录树（不抓正文，仅列系列与话数，供前端选择抓取系列）
  router.get('/api/manga/tree', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const categories = await manga.fetchFullTree();
      const excludeConf = await manga.readMangaExclude();
      const excludeSet = new Set(excludeConf.series);
      res.json({
        categories: categories.map((c) => ({
          id: c.id,
          name: c.name,
          segment: c.segment ? c.segment.base : null,
          subCategories: c.subCategories || [],
          episodeCount: c.episodes.length,
          excluded: excludeSet.has(c.name),
        })),
        excluded: excludeConf.series,
        total: categories.reduce((acc, c) => acc + c.episodes.length, 0),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 系列排除名单：读取
  router.get('/api/manga/exclude', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      res.json(await manga.readMangaExclude());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 系列排除名单：设置（全量覆盖）
  router.put('/api/manga/exclude', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const series = Array.isArray(req.body.series) ? req.body.series : [];
      res.json({ ok: true, ...(await manga.setMangaExclude(series)) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 删除系列爬取记录（汉化合集/同人漫画等一键清除），默认同时加入排除名单
  router.post('/api/manga/delete-series', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const { series, exclude } = req.body || {};
      if (!Array.isArray(series) || series.length === 0) {
        return res.status(400).json({ error: '需要 series 数组' });
      }
      const result = await manga.deleteMangaSeries(series, { exclude: exclude !== false });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 启动 gamekee 漫画爬取（自动）
  router.post('/api/manga/crawl', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const { entryIds } = req.body || {};
      await manga.startMangaCrawl({ entryIds });
      res.json({ ok: true, started: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // 重试失败项
  router.post('/api/manga/retry', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const result = await manga.retryFailedEpisodes();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 手动抓取单话（获取失败时让用户手动填 content_id 重试）
  router.post('/api/manga/manual', async (req, res) => {
    try {
      const { contentId } = req.body;
      if (!contentId) return res.status(400).json({ error: '需要 contentId' });
      const manga = await import('./manga.js');
      const result = await manga.fetchEpisode(Number(contentId));
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== 卡池管理模式 =====

  // 读取卡池数据（gacha_data.json [0] 卡池 + 学生选择器数据）
  router.get('/api/gacha', async (req, res) => {
    try {
      const g = JSON.parse(await fs.readFile(path.join(config.jsonDir, 'gacha_data.json'), 'utf8'));
      const pools = Array.isArray(g[0]) ? g[0] : [];
      // 学生选择器（Id_db + 名字 + 星级/限定，来自聚合数据）
      const data = await loadAllData();
      const students = aggregateStudents(data);
      const picker = students.map((s) => ({
        id: s.Id_db,
        name: s.Name_zh_cn || s.Name_en || `#${s.Id_db}`,
        en: s.Name_en || '',
        star: s.StarGrade || 0,
        limited: s.IsLimited,
      }));
      res.json({ pools, students: picker, updatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 保存卡池数据（只替换 gacha[0]，学生元数据 gacha[1] 不动；结构校验）
  router.put('/api/gacha', async (req, res) => {
    try {
      const pools = req.body.pools;
      if (!Array.isArray(pools)) return res.status(400).json({ error: 'pools 必须是数组' });
      const SERVERS = ['cn', 'jp', 'in'];
      for (const p of pools) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          return res.status(400).json({ error: '卡池条目必须是对象' });
        }
        for (const s of SERVERS) {
          const pickKey = `now_pick_${s}`;
          const timeKey = `pick_${s}_time}`;
          const fesKey = `fes_${s}`;
          if (p[pickKey] !== undefined) {
            if (!Array.isArray(p[pickKey])) return res.status(400).json({ error: `${pickKey} 必须是数组` });
            p[pickKey] = p[pickKey].map(Number).filter((n) => Number.isFinite(n));
          }
          if (p[fesKey] !== undefined) p[fesKey] = !!p[fesKey];
          if (p[timeKey] !== undefined) {
            if (!Array.isArray(p[timeKey]) || p[timeKey].length !== 2
                || typeof p[timeKey][0] !== 'string' || typeof p[timeKey][1] !== 'string') {
              return res.status(400).json({ error: `${timeKey} 必须是 [开始, 结束] 两个时间字符串` });
            }
          }
        }
      }
      const gachaPath = path.join(config.jsonDir, 'gacha_data.json');
      const g = JSON.parse(await fs.readFile(gachaPath, 'utf8'));
      g[0] = pools;
      await fs.writeFile(gachaPath, JSON.stringify(g, null, 2), 'utf8');
      res.json({ ok: true, pools: g[0] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 卡池自动爬取：从 gamekee 卡池页面解析三服当前卡池（学生/时间/FES），返回建议数据（不直接保存）
  router.get('/api/gacha/auto', async (req, res) => {
    try {
      const { fetchGachaPools } = await import('./gacha-crawl.js');
      const result = await fetchGachaPools();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // gamekee 图片代理（必须带 Referer）
  router.get('/api/manga/image', async (req, res) => {
    try {
      const url = req.query.url;
      if (!url || !/gamekee\.com/.test(url)) return res.status(400).json({ error: '非法图片地址' });
      const manga = await import('./manga.js');
      const { buf, type } = await manga.proxyGamekeeImage(url);
      res.set('Content-Type', type);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (e) {
      res.status(404).end();
    }
  });

  // 漫画重复检测（URL 路径 + 图片内容 MD5 校验，检查是否存在重复更新）
  router.get('/api/manga/duplicates', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const withMd5 = req.query.md5 !== '0';
      const report = await manga.checkMangaDuplicates({ withMd5 });
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 漫画重复清理：同一图片只保留最小 id 条目，info 中的 id 重定向
  router.post('/api/manga/dedup', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const result = await manga.cleanMangaDuplicates();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 主图修复：按「最大竖屏」算法重算所有话数的主图 URL（修正杂图/横图误选）
  router.post('/api/manga/fix-images', async (req, res) => {
    try {
      const manga = await import('./manga.js');
      const result = await manga.fixMangaMainImages();
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ===== JSON 对比模式 =====

  // 云端单个 JSON 文件内容（对比用）
  router.get('/api/cloud/raw/:fname', async (req, res) => {
    try {
      const { fetchCloudJson } = await import('./cloud.js');
      const fname = req.params.fname.replace(/[^a-zA-Z0-9._-]/g, '');
      const data = await fetchCloudJson(fname);
      res.json({ fname, data });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 发布预览：校验密码后逐文件对比本地与云端（COS）JSON，返回将推送的更改明细（不实际上传）
  router.post('/api/publish/preview', async (req, res) => {
    try {
      const { password } = req.body;
      const pubConfig = await readPublishConfig();
      if (!pubConfig || !pubConfig.password) {
        return res.status(400).json({ error: '未配置发布密码，请在 server/data/publish-config.json 设置' });
      }
      if (password !== pubConfig.password) {
        return res.status(403).json({ error: '密码错误' });
      }
      const { fetchCloudJson } = await import('./cloud.js');
      const files = (await fs.readdir(config.jsonDir)).filter((f) => f.endsWith('.json') && f !== 'hash.json').sort();
      const keyMap = {
        'sms_studata_main.json': 'Id_db',
        'sms_studata_toaro_stu.json': 'Id_db',
        'khrtalk_satellite.json': 'Id_db',
        'sms_to_arona_data_revisions.json': 'Id_db',
        'favor_stu_tap.json': 'id',
        'gacha_data.json': 'id',
        'liwu_list_rep.json': 'Id',
        'favora_data.json': 'stuid',
        'manga_main.json': 'id',
        'sms_othersmatchlib.json': 'id',
      };
      // 值摘要（完整显示更改：数组全量列出，长字符串放宽截断）
      const fmtVal = (v) => {
        if (v === undefined || v === null) return '(空)';
        if (Array.isArray(v)) return v.length ? `[${v.join('、')}]` : '(空数组)';
        if (typeof v === 'object') return JSON.stringify(v).slice(0, 500);
        return String(v).slice(0, 500);
      };
      const fieldDiff = (prev, curr) => {
        const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
        const fields = [];
        for (const k of keys) {
          const p = JSON.stringify(prev?.[k]);
          const c = JSON.stringify(curr?.[k]);
          if (p !== c) fields.push({ key: k, prev: fmtVal(prev?.[k]), curr: fmtVal(curr?.[k]) });
        }
        return fields;
      };
      const summarize = (s) => {
        if (!s || typeof s !== 'object') return { id: '', label: String(s) };
        const idv = s.Id_db !== undefined ? s.Id_db
          : s.id !== undefined ? s.id
          : s.stuid !== undefined ? s.stuid
          : s.Id !== undefined ? s.Id : '';
        const label = s.Name_zh_cn || s.Name || s.name || s.title || s.MapName || s.Icon || '';
        return { id: idv, label };
      };
      const out = [];
      for (const f of files) {
        let local;
        try {
          local = JSON.parse(await fs.readFile(path.join(config.jsonDir, f), 'utf8'));
        } catch {
          continue;
        }
        let cloud = null;
        try { cloud = await fetchCloudJson(f); } catch {}
        const entry = { fname: f, cloudAvailable: cloud !== null && cloud !== undefined };
        let localArr = local;
        let cloudArr = cloud;
        if (f === 'gacha_data.json') {
          localArr = Array.isArray(local) ? local[1] : local;
          cloudArr = Array.isArray(cloud) ? cloud[1] : cloud;
        }
        const key = keyMap[f] || 'id';
        if (Array.isArray(localArr) && Array.isArray(cloudArr)) {
          const localMap = new Map(localArr.map((s) => [String(s?.[key]), s]));
          const cloudMap = new Map(cloudArr.map((s) => [String(s?.[key]), s]));
          const addList = [];
          const delList = [];
          const modList = [];
          let unchanged = 0;
          for (const [k, s] of localMap) {
            if (!cloudMap.has(k)) addList.push(s);
            else if (JSON.stringify(cloudMap.get(k)) !== JSON.stringify(s)) modList.push({ local: s, cloud: cloudMap.get(k) });
            else unchanged++;
          }
          for (const [k, s] of cloudMap) {
            if (!localMap.has(k)) delList.push(s);
          }
          entry.added = addList.length;
          entry.removed = delList.length;
          entry.modified = modList.length;
          entry.unchanged = unchanged;
          entry.addList = addList.map(summarize);
          entry.delList = delList.map(summarize);
          entry.modList = modList.map((m) => ({ ...summarize(m.local), fields: fieldDiff(m.cloud, m.local) }));
        } else if (entry.cloudAvailable) {
          // 非数组结构：整体文本对比
          const localText = JSON.stringify(local);
          const cloudText = JSON.stringify(cloud);
          entry.added = 0; entry.removed = 0;
          entry.modified = localText === cloudText ? 0 : 1;
          entry.unchanged = localText === cloudText ? 1 : 0;
          entry.addList = []; entry.delList = [];
          entry.modList = entry.modified ? [{ id: '', label: '(整体内容有差异)', fields: fieldDiff(cloud, local) }] : [];
        } else {
          // 云端无此文件（新文件）
          entry.isNew = true;
          entry.added = Array.isArray(localArr) ? localArr.length : 1;
          entry.removed = 0; entry.modified = 0; entry.unchanged = 0;
          entry.addList = []; entry.delList = []; entry.modList = [];
        }
        out.push(entry);
      }
      // 随发布一并推送的 data 目录数据文件
      const dataFiles = [];
      for (const f of ['manga_info.json', 'skip-list.json', 'alias-config.json', 'arona-mismatch.json']) {
        try {
          await fs.access(path.join(config.dataDir, f));
          dataFiles.push(f);
        } catch {}
      }

      // 头像图片：本地 ↔ COS 的差异清单（新增 / 变更 / 仅云端有），供确认页展示
      let iconDiff = null;
      try {
        const { diffLocalVsCos } = await import('./icons-publish.js');
        iconDiff = await diffLocalVsCos();
      } catch (e) {
        iconDiff = { error: e.message };
      }

      res.json({ ok: true, files: out, dataFiles, jsonCount: out.length, iconDiff });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 发布上传（密码验证 + hash + COS）
  router.post('/api/publish', async (req, res) => {
    try {
      const { password } = req.body;
      const pubConfig = await readPublishConfig();
      if (!pubConfig || !pubConfig.password) {
        return res.status(400).json({ error: '未配置发布密码，请在 server/data/publish-config.json 设置' });
      }
      if (password !== pubConfig.password) {
        return res.status(403).json({ error: '密码错误' });
      }
      // 生成 hash.json（覆盖 json 目录下所有 JSON）
      const files = (await fs.readdir(config.jsonDir)).filter((f) => f.endsWith('.json') && f !== 'hash.json');
      const hashes = [];
      for (const fname of files) {
        const content = await fs.readFile(path.join(config.jsonDir, fname));
        hashes.push({ hash: createHash('sha256').update(content).digest('hex'), fname });
      }
      await fs.writeFile(path.join(config.jsonDir, 'hash.json'), JSON.stringify(hashes, null, 2), 'utf8');

      // 云端数据文件（data 目录白名单，随发布一并推送到 COS data/ 前缀；publish-config 含密钥绝不外传）
      const dataFiles = [];
      for (const f of ['manga_info.json', 'skip-list.json', 'alias-config.json', 'arona-mismatch.json']) {
        try {
          await fs.access(path.join(config.dataDir, f));
          dataFiles.push(f);
        } catch {}
      }

      // 上传 COS
      let uploaded = 0;
      let uploadedKeys = [];
      let cosError = null;
      try {
        const COS = (await import('cos-nodejs-sdk-v5')).default;
        const cos = new COS({ SecretId: pubConfig.secretId, SecretKey: pubConfig.secretKey });
        const bucket = pubConfig.bucket || '1145141919810-1317895529';
        const region = pubConfig.region || 'ap-chengdu';
        const putObject = (Key, Body) => new Promise((resolve, reject) => {
          cos.putObject({ Bucket: bucket, Region: region, Key, Body }, (err) => err ? reject(err) : resolve());
        });
        // 1. json 目录所有 JSON → json/
        for (const f of files) {
          const body = await fs.readFile(path.join(config.jsonDir, f));
          await putObject(`json/${f}`, body);
          uploadedKeys.push(`json/${f}`);
          uploaded++;
        }
        // 2. hash.json → json/ 与根目录各一份（根目录一份兼容老 FMPS 的 hash 校验）
        const hashBody = await fs.readFile(path.join(config.jsonDir, 'hash.json'));
        await putObject('json/hash.json', hashBody);
        uploadedKeys.push('json/hash.json');
        uploaded++;
        await putObject('hash.json', hashBody);
        uploadedKeys.push('hash.json');
        uploaded++;
        // 3. data 目录数据文件 → data/
        for (const f of dataFiles) {
          const body = await fs.readFile(path.join(config.dataDir, f));
          await putObject(`data/${f}`, body);
          uploadedKeys.push(`data/${f}`);
          uploaded++;
        }
      } catch (e) {
        cosError = e.message;
      }

      // 头像图片随发布一起上传（只推有变化的；受 iconPublish 开关控制）
      let iconResult = null;
      const { iconPublish = true } = req.body || {};
      if (!cosError && iconPublish) {
        try {
          const { diffLocalVsCos, uploadIconsToCos, snapshotIconRelease } = await import('./icons-publish.js');
          const diff = await diffLocalVsCos();
          iconResult = await uploadIconsToCos({ diff });
          iconResult.totals = diff.totals;
          if (iconResult.uploaded > 0) {
            const snap = await snapshotIconRelease(diff);
            iconResult.release = snap.ts;
          }
        } catch (e) {
          iconResult = { error: e.message };
        }
      }

      // 发布成功后归档版本（本地）
      let version = null;
      if (!cosError) {
        try {
          const { archiveVersion } = await import('./version.js');
          version = await archiveVersion();
        } catch {}
      }

      // 同时写一份「云端发布记录」到 COS，这样**别的设备**也能在版本管理里看到这次发布。
      // 关键是把学生指纹一起写进去，跨设备就能算学生级差异，无需下载旧 JSON。
      let cloudRelease = null;
      let cloudReleaseError = null;
      if (!cosError) {
        try {
          const manifest = await localManifest({ note: '从 Web 界面发布推送' });
          cloudRelease = await putCloudRelease(manifest);
        } catch (e) {
          cloudReleaseError = e.message;
        }
      }

      res.json({
        ok: true,
        uploaded,
        uploadedKeys,
        dataFiles,
        hashCount: hashes.length,
        cosError,
        version,
        cloudRelease,
        cloudReleaseError,
        iconResult,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 历次头像发布记录
  router.get('/api/icons/releases', async (req, res) => {
    try {
      const { listIconReleases } = await import('./icons-publish.js');
      res.json({ releases: await listIconReleases() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
