// wikiru 抽卡头像抓取：bluearchive.wikiru.jp 的星级页面 → gacha-img/{Id_db}.png
//
// ===== 为什么这么做（已实测确认，别走回头路）=====
// 页面里图标的真实路径长这样：
//     attach2/696D67_<文件名的UTF-8十六进制>.png
// 其中 `696D67_` 是 ASCII "img_" 的十六进制。把后半段 hex 解回 UTF-8 就得到真实文件名，
// 例如 `エイミ（臨戦）_icon.png`。
//
// ⚠️ HTML 里写的是 width="60" height="60"，那是**显示尺寸**；文件本体是 200×200。
//    2026-09-11 用过像素比对（NCC）确认：COS 上的 gacha-img 与这些 _icon.png 是同一批像素，
//    所以**直接改名即可，不需要裁剪、也不需要重新编码**。
//
// ===== 名字映射 =====
// wikiru 文件名（日式写法） → 库内 Name_jp 需要做归一化，规则见 normalizeWikiruName()。
// 库内 Name_jp 已是半角括号（generator.js 里把（）替换成了()）。
import { config } from './config.js';
import { writeIcon, listIds, ICON_TYPES } from './icons-store.js';
import { fetchText, fetchBuffer, sleep } from './http-util.js';

const ICON_HEX_PREFIX = '696D67_'; // ASCII "img_"
const ATTACH_RE = new RegExp(`attach2/${ICON_HEX_PREFIX}([0-9A-Fa-f]+)\\.png`, 'g');

// 已知的非学生占位/杂图，解析时直接丢弃
const JUNK_PATTERNS = [
  /^landform_aptitude_\d+\.png$/i, // 地形适性图标
  /^_icon\.png$/i,
  /^\.png$/i,
];

// 占位图（wiki 上还没画正式头像时用的），默认不自动采用
const PLACEHOLDER_RE = /_仮icon\.png$/;

// ---------- 人工豁免表（可手工编辑，优先级最高） ----------
//
// 有些角色情况特殊，走自动流程会把坏数据推上去，这里显式列出、跳过下载，交给人工处理。
// 键 = Id_db，值 = 原因说明。想解除豁免：把对应行删掉即可。
export const MANUAL_SKIP = {
  10098: 'ホシノ(臨戦)：wikiru 上只有 スタイル1/2 且带编号水印；COS 现存图也不对（是立绘照片），需人工确认',
};

// ---------- 页面解析 ----------

// 从 HTML 里解出所有图片的真实文件名（按出现顺序去重）
export function parseIconNames(html) {
  const seen = new Set();
  const out = [];
  let m;
  ATTACH_RE.lastIndex = 0;
  while ((m = ATTACH_RE.exec(html))) {
    const hex = m[1];
    let name;
    try {
      name = Buffer.from(hex, 'hex').toString('utf8');
    } catch {
      continue;
    }
    // hex 必须是合法 UTF-8（非文件名的情况通常是别的静态资源）
    if (name.includes('\uFFFD') || !name.endsWith('.png')) continue;
    if (JUNK_PATTERNS.some((re) => re.test(name))) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, hex, url: `attach2/${ICON_HEX_PREFIX}${hex}.png` });
  }
  return out;
}

// ---------- 名字归一化 ----------

// wikiru 文件名 → 候选的库内 Name_jp（返回数组，按优先级排序）
//
// 覆盖的变体（2026-09-11 实测）：
//   `エイミ（臨戦）_icon.png`      → `エイミ(臨戦)`
//   `アズサ_水着_icon.png`        → `アズサ(水着)`
//   `オトギ_icon2.png`            → `オトギ`（同名角色的第 2 个变体，合法目标）
//   `ホシノ（臨戦）スタイル1_icon.png` → `ホシノ(臨戦)`（剥离 スタイルN）
//   `キサキ_icon_v2.png`          → `キサキ`
//   `セイア_icon_立ち絵準拠.png`  → `セイア`
export function normalizeWikiruName(fileName) {
  let n = String(fileName).replace(/\.png$/i, '');
  // 0) 占位图单独标记
  const isPlaceholder = PLACEHOLDER_RE.test(fileName);
  n = n.replace(/_仮icon$/i, '');

  // 1) 去掉后缀：_icon2 → 变体标记（剥掉数字，但要记录成 variantIndex 用于消歧）
  //    `オトギ_icon2` → `オトギ`（同名角色的第 2 个变体，是合法目标）
  let variantIndex = 0;
  const iconNumMatch = n.match(/_icon(\d+)$/i);
  if (iconNumMatch) {
    variantIndex = Number(iconNumMatch[1]);
    n = n.replace(/_icon\d+$/i, '');
  }
  n = n.replace(/_icon_v(\d+)$/i, '');
  n = n.replace(/_icon_.+$/i, '');
  n = n.replace(/_icon$/i, '');

  // 2) 剥离 スタイルN（正式版/style 变体标记）
  //    `ホシノ（臨戦）スタイル1` / `ホシノ（臨戦）スタイル2` 都是同一角色的不同造型图，
  //    归一化后同名 → 必须记录 styleIndex 用于消歧，否则会互相静默覆盖。
  let styleIndex = 0;
  const styleMatch = n.match(/スタイル(\d+)$/);
  if (styleMatch) {
    styleIndex = Number(styleMatch[1]);
    n = n.replace(/スタイル\d+$/g, '');
  }

  // 3) 全角括号 → 半角，全角空格 → 普通空格
  n = n.replace(/（/g, '(').replace(/）/g, ')').replace(/\u3000/g, ' ');

  // 4) 形态后缀：`X_水着` → `X(水着)`；只处理一次（形态词本身就是最后一个下划线段）
  //    `アズサ_水着` → `アズサ(水着)`
  const bracketMatch = n.match(/^(.*?)[(_]([^()]+)\)?$/);
  if (bracketMatch && !n.includes('(')) {
    const [, base, form] = bracketMatch;
    if (base && form && /^[\u3040-\u30ff\u4e00-\u9faf]/.test(form)) {
      n = `${base}(${form})`;
    }
  }

  n = n.trim();

  // 5) 生成候选：本体 + 括号变体 + 去括号变体
  //    注意：形态变体（括号里的内容）**不能退化到本体去匹配**，
  //    否则 `カスミ（水着）` 会被错误地当成 `カスミ` 本体，把本体的图覆盖掉。
  const candidates = new Set();
  candidates.add(n);
  candidates.add(n.replace(/\(/g, '（').replace(/\)/g, '）'));
  const isFormVariantName = /\([^)]*\)/.test(n);
  if (!isFormVariantName) {
    const bare = n.replace(/\([^)]*\)/g, '');
    if (bare && bare !== n) candidates.add(bare);
  }

  return { normalized: n, candidates: [...candidates], isPlaceholder, variantIndex, styleIndex };
}

// 构建 名字 → Id_db 的索引（含各种退化形式）
// students: [{ Id_db, Name_jp, Name_zh_cn, Name_en, NickName }]
export function buildNameIndex(students) {
  const exact = new Map(); // 精确名 → id（可能多个，同名不同形态）
  const exactList = new Map(); // → [id...]
  const push = (map, key, id) => {
    if (!key) return;
    const k = String(key).trim();
    if (!k) return;
    if (!map.has(k)) map.set(k, []);
    if (!map.get(k).includes(id)) map.get(k).push(id);
  };
  for (const s of students) {
    const id = Number(s.Id_db);
    for (const key of [s.Name_jp, s.Name_zh_cn, s.Name_en, s.Name_zh_tw, s.Name_zh_ft]) {
      push(exactList, key, id);
    }
    for (const nn of s.NickName || []) push(exactList, nn, id);
  }
  for (const [k, v] of exactList) exact.set(k, v);
  return { exact, exactList };
}

// ---------- 抓取主流程 ----------

// 抓三个星级页面，返回 { pages: [{url, count, error}], icons: [{name, hex, url}], stats }
export async function fetchWikiruIndex({ onLog } = {}) {
  const { base, pages, proxy } = config.icons.wikiru;
  const log = (m) => { if (onLog) onLog(m); console.log(`[wikiru] ${m}`); };
  const all = new Map(); // name → entry
  const pageResults = [];

  for (const q of pages) {
    const url = base + q;
    try {
      log(`抓取页面 ${url}${proxy ? ` (经代理 ${proxy})` : ' (直连)'}`);
      const html = await fetchText(url, {
        proxy,
        timeout: config.icons.fetchTimeout,
        retries: config.icons.fetchRetries,
        label: 'wikiru',
        headers: { Referer: base },
      });
      const names = parseIconNames(html);
      if (names.length === 0) {
        throw new Error('页面解析出 0 张图，可能是站点结构改版或返回了验证页');
      }
      for (const n of names) {
        if (!all.has(n.name)) all.set(n.name, { ...n, page: q, base });
      }
      pageResults.push({ url, count: names.length, error: null });
      log(`  → ${names.length} 张`);
    } catch (e) {
      pageResults.push({ url, count: 0, error: e.message });
      log(`  → 失败: ${e.message}`);
    }
    await sleep(300);
  }

  const icons = [...all.values()];
  return {
    pages: pageResults,
    icons,
    stats: {
      pageCount: pages.length,
      okPages: pageResults.filter((p) => !p.error).length,
      iconCount: icons.length,
      placeholderCount: icons.filter((i) => PLACEHOLDER_RE.test(i.name)).length,
    },
  };
}

// 把 wikiru 索引映射到学生
// 返回 { matched: [{id, name, entry}], unmatched: [{name, reason}], ambiguous: [{name, ids}] }
//
// 消歧关键：`_icon2` 是「同名角色的第二个变体」标记。
// 例如 wikiru 上 `ケイ_icon.png` 与 `ケイ_icon2.png` 都存在，而库内只有一个 `ケイ`（id 16012），
// 这时两个文件都是合法目标，交给「异常 → 列候选 → 人工点选」流程，绝不自动覆盖。
export function mapIconsToStudents(icons, students) {
  const { exactList } = buildNameIndex(students);
  const matched = [];
  const unmatched = [];
  const ambiguous = [];
  // 记录每个 id 已被哪些文件认领，用于把带变体标记的条目强制降级为歧义
  const claimCount = new Map();

  for (const icon of icons) {
    const { normalized, candidates, isPlaceholder, variantIndex, styleIndex } = normalizeWikiruName(icon.name);
    let hitIds = null;
    let hitBy = null;
    for (const cand of candidates) {
      const ids = exactList.get(cand);
      if (ids && ids.length) {
        hitIds = ids;
        hitBy = cand;
        break;
      }
    }
    if (!hitIds) {
      unmatched.push({
        name: icon.name,
        normalized,
        reason: isPlaceholder ? '占位图（_仮icon）' : '名字匹配不上库内学生',
        icon,
      });
      continue;
    }
    if (hitIds.length > 1) {
      ambiguous.push({ name: icon.name, normalized, hitBy, ids: hitIds, icon });
      continue;
    }
    const id = hitIds[0];
    const s = students.find((x) => Number(x.Id_db) === id);
    const isFormVariant = /\(.+\)/.test(normalized) && s && !/\(.+\)/.test(s.Name_jp || '');

    // 带 `_icon2` / `スタイルN` 等变体标记：只有该 id 已有「本体」认领时才降级为歧义；
    // 若本体不存在（如 オトギ 只有 _icon2），则它就是唯一候选，可以直接用。
    const hasVariantMark = variantIndex > 0 || styleIndex > 0;
    if (hasVariantMark) {
      const priorClaims = claimCount.get(id) || [];
      if (priorClaims.length > 0) {
        const mark = styleIndex > 0 ? `スタイル${styleIndex}` : `_icon${variantIndex}`;
        ambiguous.push({
          name: icon.name,
          normalized,
          hitBy,
          ids: [id],
          icon,
          hint: `与 ${priorClaims.join('、')} 同为「${s?.Name_jp || hitBy}」（${mark}），需人工确认用哪张`,
        });
        continue;
      }
    }

    const prev = claimCount.get(id) || [];
    claimCount.set(id, [...prev, icon.name]);
    matched.push({
      id,
      name: s ? s.Name_jp : hitBy,
      icon,
      exact: hitBy === (s ? s.Name_jp : ''),
      isFormVariant,
      isPlaceholder: PLACEHOLDER_RE.test(icon.name),
      variantIndex,
      styleIndex,
    });
  }
  return { matched, unmatched, ambiguous };
}

// 下载一张 wikiru 图（原样存储，不重新编码）
export async function downloadWikiruIcon(entry, { proxy, referer } = {}) {
  const { base, proxy: cfgProxy } = config.icons.wikiru;
  const p = proxy !== undefined ? proxy : cfgProxy;
  const baseUrl = entry.base || base;
  // 页面里的相对路径 → 绝对 URL
  const rel = entry.url.startsWith('attach2/') ? `attach2/${ICON_HEX_PREFIX}${entry.hex}.png` : entry.url;
  const url = new URL(rel, baseUrl).href;
  const { buf } = await fetchBuffer(url, {
    proxy: p,
    timeout: config.icons.fetchTimeout,
    retries: config.icons.fetchRetries,
    label: 'wikiru-img',
    headers: { Referer: referer || baseUrl },
  });
  return { buf, url };
}

// ---------- 对外主入口 ----------

// 爬取并落库
// mode: 'new'  只补缺图（默认）
//       'full' 全量重抓（已存在的也会覆盖 —— 但仍然尊重 manual 保护）
// opts: { students, mode, force, includePlaceholder, onLog, onProgress, dryRun, proxy }
export async function crawlWikiru(students, opts = {}) {
  const {
    mode = 'new',
    force = false,
    includePlaceholder = false,
    onLog,
    onProgress,
    dryRun = false,
    proxy,
  } = opts;
  const log = (m) => { if (onLog) onLog(m); console.log(`[wikiru] ${m}`); };

  const index = await fetchWikiruIndex({ onLog });
  if (index.stats.iconCount === 0) {
    throw new Error(
      `wikiru 三页全部解析失败（${index.pages.map((p) => p.error).filter(Boolean).join('; ')}）——` +
      `请检查网络/代理，或用「手动上传」兜底`
    );
  }

  const mapped = mapIconsToStudents(index.icons, students);
  const existing = await listIds('gacha-img');

  const result = {
    pages: index.pages,
    stats: {
      wikiruTotal: index.stats.iconCount,
      placeholderTotal: index.stats.placeholderCount,
      matched: mapped.matched.length,
      unmatched: mapped.unmatched.length,
      ambiguous: mapped.ambiguous.length,
      existingLocal: existing.size,
    },
    added: [],
    skipped: [],
    failed: [],
    manualSkipped: [],
    unmatched: mapped.unmatched.map((u) => ({ name: u.name, normalized: u.normalized, reason: u.reason })),
    ambiguous: mapped.ambiguous.map((a) => ({ name: a.name, normalized: a.normalized, ids: a.ids })),
    dryRun,
  };

  const candidates = mapped.matched.filter((m) => {
    if (MANUAL_SKIP[m.id] && !opts.ignoreManualSkip) return false;
    if (!includePlaceholder && m.isPlaceholder) return false;
    if (mode === 'new' && existing.has(m.id)) return false;
    return true;
  });

  // 被豁免表挡下的，记进结果让用户看得见
  result.manualSkipped = mapped.matched
    .filter((m) => MANUAL_SKIP[m.id] && !opts.ignoreManualSkip)
    .map((m) => ({ id: m.id, name: m.name, file: m.icon.name, reason: MANUAL_SKIP[m.id] }));

  log(`wikiru 共 ${index.stats.iconCount} 张 → 匹配 ${mapped.matched.length} / 未匹配 ${mapped.unmatched.length} / 歧义 ${mapped.ambiguous.length}`);
  log(`本次待处理 ${candidates.length} 张（模式=${mode === 'new' ? '新增优先' : '全量重抓'}${includePlaceholder ? '，含占位图' : '，排除占位图'}）`);

  if (dryRun) {
    result.plan = candidates.map((c) => ({ id: c.id, name: c.name, file: c.icon.name, exists: existing.has(c.id) }));
    return result;
  }

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const { buf, url } = await downloadWikiruIcon(c.icon, { proxy });
      const w = await writeIcon('gacha-img', c.id, buf, {
        source: 'auto',
        origin: url,
        note: c.icon.name,
        force,
      });
      if (w.written) {
        result.added.push({ id: c.id, name: c.name, file: c.icon.name, bytes: buf.length });
      } else {
        result.skipped.push({ id: c.id, name: c.name, reason: w.reason });
      }
    } catch (e) {
      result.failed.push({ id: c.id, name: c.name, file: c.icon.name, error: e.message });
      log(`  ✗ ${c.id} ${c.name} (${c.icon.name}): ${e.message}`);
    }
    if (onProgress) onProgress({ done: i + 1, total: candidates.length, id: c.id, name: c.name });
    await sleep(120);
  }

  log(`完成：新增 ${result.added.length} / 跳过 ${result.skipped.length} / 失败 ${result.failed.length}`);
  return result;
}

// 某学生的候选图列表（用于异常条目的「点选」流程）
// 优先把「名字相关的变体」排前面，后面再跟全部图
export async function candidatesForStudent(idDb, students) {
  const { students: _s } = { students };
  const target = students.find((s) => Number(s.Id_db) === Number(idDb));
  if (!target) return { id: Number(idDb), related: [], all: [], error: '学生不存在' };

  const index = await fetchWikiruIndex({});
  const mapped = mapIconsToStudents(index.icons, students);
  const used = new Set(mapped.matched.map((m) => m.id));

  // 相关：归一化后前缀能对上日文名本体的
  const baseName = String(target.Name_jp || '').replace(/\([^)]*\)/g, '');
  const related = [];
  const all = [];
  for (const icon of index.icons) {
    const { normalized, isPlaceholder } = normalizeWikiruName(icon.name);
    const item = {
      file: icon.name,
      normalized,
      hex: icon.hex,
      url: `${config.icons.wikiru.base.replace(/\/$/, '')}/${icon.url}`,
      isPlaceholder,
      takenBy: null,
    };
    const claim = mapped.matched.find((m) => m.icon.name === icon.name);
    if (claim) item.takenBy = { id: claim.id, name: claim.name };
    all.push(item);
    if (baseName && normalized.replace(/\([^)]*\)/g, '') === baseName) related.push(item);
  }
  return { id: Number(idDb), name: target.Name_jp, related, all, total: all.length };
}
