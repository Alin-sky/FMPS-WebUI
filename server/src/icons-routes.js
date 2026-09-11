// 头像管理 API 路由
//
// 挂载方式：在 routes.js 里 `router.use(createIconsRouter())`
// 之所以单独一个文件：头像相关的逻辑（存储/COS/抓取/校验）已经有 6 个模块了，
// 再全塞进 routes.js 会变成一个 2000 行的怪物。
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { config } from './config.js';
import {
  ICON_TYPE_KEYS,
  ICON_TYPES,
  ensureDirs,
  iconPath,
  readIcon,
  writeIcon,
  deleteIcon,
  fileStat,
  listIds,
  localInventory,
  readMeta,
  setEntry,
  META_PATH,
  cosKey,
} from './icons-store.js';
import { iconRows, iconStateIndex } from './icons-view.js';
import { loadAllData, aggregateStudents } from './aggregate.js';
import { generateBatch, generateOne } from './icons-schaledb.js';
import { crawlWikiru, candidatesForStudent, fetchWikiruIndex, mapIconsToStudents, MANUAL_SKIP } from './icons-wikiru.js';
import { syncFromCos, verifyIcons, cosInventory } from './icons-cos.js';

// 运行中的任务状态（供前端轮询进度）
const jobs = new Map();
function startJob(name, runner) {
  if (jobs.get(name)?.running) throw new Error(`${name} 任务正在运行中`);
  const job = { name, running: true, startedAt: Date.now(), log: [], progress: null, result: null, error: null };
  jobs.set(name, job);
  const push = (msg) => {
    const line = `[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`;
    job.log.push(line);
    if (job.log.length > 500) job.log.shift();
    console.log(`[icons:${name}] ${msg}`);
  };
  job.push = push;
  (async () => {
    try {
      job.result = await runner(push, (p) => { job.progress = p; });
    } catch (e) {
      job.error = e.message;
      push(`❌ ${e.message}`);
    } finally {
      job.running = false;
      job.finishedAt = Date.now();
    }
  })();
  return job;
}

async function studentsOf() {
  const data = await loadAllData();
  return aggregateStudents(data);
}

// 安全解析 body 里的类型
function assertType(type) {
  if (!ICON_TYPES[type]) throw new Error(`未知的头像类型: ${type}（可选 ${ICON_TYPE_KEYS.join(' / ')}）`);
  return type;
}

export function createIconsRouter() {
  const router = express.Router();

  // 启动时确保目录存在
  ensureDirs().catch(() => {});

  // ---------- 概览 ----------

  // 三类头像整体状态 + 每个学生的图状态（表格数据源）
  router.get('/api/icons/status', async (req, res) => {
    try {
      const students = await studentsOf();
      const { missing, abnormal, idFrom, idTo, keyword, type } = req.query;
      const data = await iconRows(students, {
        missing: missing === '1' || missing === 'true',
        abnormal: abnormal === '1' || abnormal === 'true',
        idFrom,
        idTo,
        keyword,
        type: type ? assertType(type) : undefined,
      });
      const inv = await localInventory();
      res.json({
        ...data,
        inventory: Object.fromEntries(
          Object.entries(inv).map(([k, v]) => [k, { count: v.count, bytes: v.bytes, mb: Number((v.bytes / 1024 / 1024).toFixed(1)) }])
        ),
        types: ICON_TYPE_KEYS.map((k) => ({ key: k, ...ICON_TYPES[k] })),
        manualSkip: MANUAL_SKIP,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 本地存量盘点（不读学生表，纯目录）
  router.get('/api/icons/inventory', async (req, res) => {
    try {
      const inv = await localInventory();
      res.json({
        inventory: Object.fromEntries(
          Object.entries(inv).map(([k, v]) => [k, { count: v.count, bytes: v.bytes, mb: Number((v.bytes / 1024 / 1024).toFixed(1)), ids: [...v.ids].sort((a, b) => a - b) }])
        ),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // COS 侧存量盘点
  router.get('/api/icons/cos-inventory', async (req, res) => {
    try {
      const inv = await cosInventory({ onLog: (m) => console.log(m) });
      res.json({
        inventory: Object.fromEntries(
          Object.entries(inv).map(([k, v]) => [k, { count: v.count, extras: v.extras, total: v.total }])
        ),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- 元数据（可直接编辑的 JSON） ----------

  router.get('/api/icons/meta', async (req, res) => {
    try {
      const meta = await readMeta();
      res.json({ meta, path: META_PATH });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 整表写回（配合前端「直接编辑 JSON」用）
  router.put('/api/icons/meta', async (req, res) => {
    try {
      const { items } = req.body;
      if (!items || typeof items !== 'object') return res.status(400).json({ error: '需要 items 对象' });
      const cur = await readMeta();
      cur.items = items;
      await fs.writeFile(META_PATH, JSON.stringify(cur, null, 2), 'utf8');
      // 清缓存
      const { readMeta: rm } = await import('./icons-store.js');
      res.json({ ok: true, count: Object.keys(items).length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 单条元数据（改 source / note）
  router.put('/api/icons/meta/:type/:id', async (req, res) => {
    try {
      const type = assertType(req.params.type);
      const id = Number(req.params.id);
      const { source, note } = req.body || {};
      if (source && !['auto', 'manual', 'cos'].includes(source)) {
        return res.status(400).json({ error: 'source 只能是 auto / manual / cos' });
      }
      await setEntry(type, id, { ...(source ? { source } : {}), ...(note !== undefined ? { note } : {}) });
      res.json({ ok: true, entry: await fileStat(type, id) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- 图源生成 / 抓取 ----------

  // schaledb 生成（PNG + JPG）
  // body: { ids?: number[], mode?: 'missing'|'all', force?: bool, dryRun?: bool }
  router.post('/api/icons/gen-schaledb', async (req, res) => {
    try {
      const students = await studentsOf();
      const allIds = students.map((s) => Number(s.Id_db));
      const { ids, mode = 'missing', force = false, dryRun = false } = req.body || {};
      let targets = Array.isArray(ids) && ids.length ? ids.map(Number) : allIds;
      if (mode === 'missing' && !force) {
        // 只处理「PNG 或 JPG 缺一」的
        const png = await listIds('stu_icon_db_png');
        const jpg = await listIds('stu_icon_db');
        targets = targets.filter((id) => !png.has(id) || !jpg.has(id));
      }

      if (dryRun) {
        return res.json({ ok: true, dryRun: true, total: targets.length, ids: targets, students: students.length });
      }
      const job = startJob('gen-schaledb', async (push, setProgress) => {
        push(`开始生成 ${targets.length} 个学生的 PNG + JPG（force=${force}）`);
        const r = await generateBatch(targets, {
          force,
          onProgress: (p) => {
            setProgress({ done: p.done, total: p.total, current: p.id });
            if (p.done % 25 === 0 || p.result?.error) {
              push(`  进度 ${p.done}/${p.total}${p.result?.error ? ` ✗ #${p.id} ${p.result.error}` : ''}`);
            }
          },
        });
        push(`完成：成功 ${r.ok} / 跳过 ${r.skipped} / 失败 ${r.failed.length}，产出 ${(r.bytes / 1024 / 1024).toFixed(1)} MB`);
        return r;
      });
      res.json({ ok: true, started: true, job: job.name, total: targets.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 抓 wikiru
  // body: { mode: 'new'|'full', force, includePlaceholder, dryRun }
  router.post('/api/icons/crawl-wikiru', async (req, res) => {
    try {
      const students = await studentsOf();
      const { mode = 'new', force = false, includePlaceholder = false, dryRun = false, proxy } = req.body || {};
      if (dryRun) {
        const r = await crawlWikiru(students, { mode, force, includePlaceholder, dryRun: true, proxy });
        return res.json({ ok: true, ...r });
      }
      const job = startJob('crawl-wikiru', async (push, setProgress) => {
        push(`开始抓取 wikiru（模式=${mode}）`);
        const r = await crawlWikiru(students, {
          mode,
          force,
          includePlaceholder,
          proxy,
          onLog: push,
          onProgress: (p) => {
            setProgress({ done: p.done, total: p.total, current: `${p.id} ${p.name}` });
            if (p.done % 20 === 0) push(`  进度 ${p.done}/${p.total}`);
          },
        });
        push(`完成：新增 ${r.added.length} / 跳过 ${r.skipped.length} / 失败 ${r.failed.length} / 未匹配 ${r.unmatched.length} / 歧义 ${r.ambiguous.length}`);
        return r;
      });
      res.json({ ok: true, started: true, job: job.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 只预览 wikiru 映射结果（不下载）
  router.get('/api/icons/wikiru-preview', async (req, res) => {
    try {
      const students = await studentsOf();
      const idx = await fetchWikiruIndex({ onLog: (m) => console.log(m) });
      const mapped = mapIconsToStudents(idx.icons, students);
      const existing = await listIds('gacha-img');
      const covered = new Set(mapped.matched.map((m) => m.id));
      res.json({
        stats: {
          ...idx.stats,
          matched: mapped.matched.length,
          unmatched: mapped.unmatched.length,
          ambiguous: mapped.ambiguous.length,
          localGacha: existing.size,
          studentsTotal: students.length,
          studentsWithoutSource: students.filter((s) => !covered.has(Number(s.Id_db))).length,
        },
        pages: idx.pages,
        matched: mapped.matched.map((m) => ({
          id: m.id,
          name: m.name,
          file: m.icon.name,
          localExists: existing.has(m.id),
          isPlaceholder: m.isPlaceholder,
          variantIndex: m.variantIndex,
          styleIndex: m.styleIndex,
        })),
        unmatched: mapped.unmatched.map((u) => ({ name: u.name, normalized: u.normalized, reason: u.reason })),
        ambiguous: mapped.ambiguous.map((a) => ({ name: a.name, ids: a.ids, hint: a.hint })),
        manualSkip: MANUAL_SKIP,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- COS 同步 / 校验 ----------

  router.post('/api/icons/sync-cos', async (req, res) => {
    try {
      const { types, dryRun = false, skipExisting = true, force = false } = req.body || {};
      const typeList = Array.isArray(types) && types.length ? types.map(assertType) : ICON_TYPE_KEYS;
      if (dryRun) {
        const r = await syncFromCos({ types: typeList, dryRun: true, skipExisting, force });
        return res.json({ ok: true, ...r });
      }
      const job = startJob('sync-cos', async (push, setProgress) => {
        push(`开始从 COS 拉取基线（类型：${typeList.join(', ')}）`);
        const r = await syncFromCos({
          types: typeList,
          skipExisting,
          force,
          onLog: push,
          onProgress: (p) => {
            setProgress({ done: p.done, total: p.total, current: `${p.type}/${p.id}` });
            if (p.done % 100 === 0) push(`  进度 ${p.done}/${p.total}`);
          },
        });
        return r;
      });
      res.json({ ok: true, started: true, job: job.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/api/icons/verify', async (req, res) => {
    try {
      const students = await studentsOf();
      const { includeWikiru = true } = req.body || {};
      const job = startJob('verify', async (push, setProgress) => {
        push('开始全量校验（本地 ↔ COS' + (includeWikiru ? ' ↔ wikiru' : '') + '）');
        const r = await verifyIcons(students, {
          includeWikiru,
          onLog: push,
          onProgress: (p) => setProgress({ current: `${p.type}/${p.id}` }),
        });
        // 校验报告落盘，方便人工查看/对比
        const reportPath = path.join(config.dataDir, `icons-verify-${Date.now()}.json`);
        await fs.writeFile(reportPath, JSON.stringify(r, null, 2), 'utf8');
        push(`报告已保存: ${reportPath}`);
        return { ...r, reportPath };
      });
      res.json({ ok: true, started: true, job: job.name });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- 任务进度 ----------

  router.get('/api/icons/job/:name', (req, res) => {
    const job = jobs.get(req.params.name);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    res.json({
      name: job.name,
      running: job.running,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt || null,
      progress: job.progress,
      log: job.log.slice(-200),
      result: job.result,
      error: job.error,
    });
  });

  router.get('/api/icons/jobs', (req, res) => {
    res.json({
      jobs: [...jobs.values()].map((j) => ({
        name: j.name,
        running: j.running,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt || null,
        progress: j.progress,
        error: j.error,
      })),
    });
  });

  router.post('/api/icons/job/:name/cancel', (req, res) => {
    const job = jobs.get(req.params.name);
    if (!job) return res.status(404).json({ error: '任务不存在' });
    jobs.delete(req.params.name);
    res.json({ ok: true });
  });

  // ---------- 候选点选 ----------

  // 某学生的候选图（异常条目用）
  router.get('/api/icons/candidates/:id', async (req, res) => {
    try {
      const students = await studentsOf();
      const r = await candidatesForStudent(Number(req.params.id), students);
      const { icon, ...rest } = r;
      res.json(rest);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 把某张 wikiru 图指定给某学生（人工确认）
  router.post('/api/icons/assign', async (req, res) => {
    try {
      const { type = 'gacha-img', id, wikiruFile, source = 'manual', note } = req.body || {};
      assertType(type);
      const idDb = Number(id);
      if (!idDb) return res.status(400).json({ error: '需要 id' });
      if (!wikiruFile) return res.status(400).json({ error: '需要 wikiruFile' });

      const students = await studentsOf();
      const idx = await fetchWikiruIndex({});
      const target = idx.icons.find((i) => i.name === wikiruFile);
      if (!target) return res.status(404).json({ error: `wikiru 上找不到文件 ${wikiruFile}` });

      const { downloadWikiruIcon } = await import('./icons-wikiru.js');
      const { buf, url } = await downloadWikiruIcon(target, {});
      const w = await writeIcon(type, idDb, buf, {
        source,
        origin: url,
        note: note || `人工指定：${wikiruFile}`,
        forceManual: true, // 人工指定是显式单图操作，允许覆盖任何来源
      });
      res.json({ ok: true, ...w, size: buf.length, file: wikiruFile });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- 上传 / 替换 / 删除 ----------

  // 手动上传（multer 不引入，直接用 express.raw 收二进制）
  // POST /api/icons/upload?type=gacha-img&id=10098  body = 图片二进制
  router.post(
    '/api/icons/upload',
    express.raw({ type: ['image/*', 'application/octet-stream'], limit: '20mb' }),
    async (req, res) => {
      try {
        const type = assertType(req.query.type || req.body?.type || 'gacha-img');
        const id = Number(req.query.id || req.body?.id);
        if (!id) return res.status(400).json({ error: '需要 id' });
        if (!req.body || !req.body.length) return res.status(400).json({ error: '请求体为空，需传入图片二进制' });
        const { source = 'manual', note = '' } = req.query;
        const w = await writeIcon(type, id, req.body, {
          source,
          origin: 'manual-upload',
          note: note || '人工上传',
          forceManual: true, // 人工上传是显式单图操作，永远覆盖
        });
        res.json({ ok: true, ...w, size: req.body.length, stat: await fileStat(type, id) });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  // 从一个学生复制到另一个（换皮/合并场景）
  router.post('/api/icons/copy', async (req, res) => {
    try {
      const { type, fromId, toId, source = 'manual', note } = req.body || {};
      assertType(type);
      const buf = await readIcon(type, Number(fromId));
      const w = await writeIcon(type, Number(toId), buf, {
        source,
        origin: `copy://${type}/${fromId}`,
        note: note || `从 #${fromId} 复制`,
        forceManual: true, // 人工复制的显式单图操作
      });
      res.json({ ok: true, ...w, size: buf.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/api/icons/:type/:id', async (req, res) => {
    try {
      const type = assertType(req.params.type);
      const r = await deleteIcon(type, Number(req.params.id));
      res.json({ ok: true, ...r });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 批量删除
  router.post('/api/icons/delete-batch', async (req, res) => {
    try {
      const { items } = req.body || {};
      if (!Array.isArray(items)) return res.status(400).json({ error: '需要 items 数组' });
      const out = [];
      for (const it of items) {
        try {
          const type = assertType(it.type);
          out.push({ ...it, ...(await deleteIcon(type, Number(it.id))) });
        } catch (e) {
          out.push({ ...it, error: e.message });
        }
      }
      res.json({ ok: true, results: out, deleted: out.filter((o) => o.deleted).length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------- 图片预览 ----------

  // 本地优先，回退 COS；再回退 schaledb（仅基础头像类型）
  // 单学生的三类头像状态（详情页用）
  router.get('/api/icons/student/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!id) return res.status(400).json({ error: '需要 id' });
      const out = {};
      for (const t of ICON_TYPE_KEYS) {
        out[t] = await fileStat(t, id);
      }
      const manualSkip = MANUAL_SKIP[id];
      res.json({ id, types: out, manualSkip: manualSkip || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/iconview/:type/:id', async (req, res) => {
    try {
      const type = assertType(req.params.type);
      const id = Number(req.params.id);
      const t = ICON_TYPES[type];
      let buf = null;
      // 1) 本地
      try {
        buf = await readIcon(type, id);
      } catch {}
      // 2) COS
      if (!buf) {
        try {
          const { cosClient } = await import('./icons-cos.js');
          const cos = await cosClient();
          buf = await cos.get(cosKey(type, id));
        } catch {}
      }
      if (!buf) return res.status(404).end();
      res.set('Content-Type', t.mime);
      res.set('Cache-Control', 'no-cache');
      res.send(buf);
    } catch (e) {
      res.status(404).end();
    }
  });

  // 代理 wikiru 图（给候选网格用）
  router.get('/api/iconview-wikiru', async (req, res) => {
    try {
      const { hex, base } = req.query;
      if (!hex || !/^[0-9A-Fa-f]+$/.test(hex)) return res.status(400).json({ error: 'hex 非法' });
      const { fetchBuffer } = await import('./http-util.js');
      const b = base || config.icons.wikiru.base.replace(/\/$/, '');
      const url = `${b}/attach2/696D67_${hex}.png`;
      const { buf } = await fetchBuffer(url, {
        proxy: config.icons.wikiru.proxy,
        headers: { Referer: b + '/' },
        label: 'iconview-wikiru',
      });
      res.set('Content-Type', 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch (e) {
      res.status(404).end();
    }
  });

  return router;
}
