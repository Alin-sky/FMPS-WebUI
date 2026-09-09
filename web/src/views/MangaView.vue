<template>
  <div class="manga-page">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>

    <div class="head">
      <div class="head-left">
        <h2>漫画更新模式</h2>
        <span class="muted">从腾讯 COS 拉取话数基准，再尝试从 gamekee 自动抓取漫画图片并生成 manga_main.json</span>
      </div>
      <div class="head-actions">
        <el-button type="primary" :loading="cosLoading" @click="pullCos">
          <el-icon><Download /></el-icon> 拉取 COS 话数
        </el-button>
        <el-button type="success" :loading="crawling" @click="openCrawl">
          <el-icon><Refresh /></el-icon> 抓取 gamekee 漫画
        </el-button>
        <el-button v-if="state && state.failed && state.failed.length" type="warning" @click="openManual">
          <el-icon><Tools /></el-icon> 手动补抓 ({{ state.failed.length }})
        </el-button>
        <el-button @click="openRawJson">
          <el-icon><Document /></el-icon> 查看原始JSON
        </el-button>
        <el-button :loading="dupChecking" @click="openDupCheck">
          <el-icon><CopyDocument /></el-icon> 重复检测 (MD5)
        </el-button>
        <el-button :loading="fixingImages" @click="doFixImages">
          <el-icon><PictureFilled /></el-icon> 主图修复
        </el-button>
        <el-button type="warning" plain @click="openSeriesDialog">
          <el-icon><FolderDelete /></el-icon> 系列管理
        </el-button>
      </div>
    </div>

    <!-- 统计卡 -->
    <div class="stats-row">
      <div class="stat glass">
        <div class="stat-num">{{ manga.length }}</div>
        <div class="stat-label">manga_main 条目</div>
      </div>
      <div class="stat glass">
        <div class="stat-num">{{ episodes.length }}</div>
        <div class="stat-label">已抓取话数</div>
      </div>
      <div class="stat glass">
        <div class="stat-num">{{ latestId }}</div>
        <div class="stat-label">最新 id</div>
      </div>
      <div class="stat glass" v-if="state">
        <div class="stat-num" :class="{ warn: state.failed && state.failed.length }">
          {{ state.done || 0 }}/{{ state.total || 0 }}
        </div>
        <div class="stat-label">{{ state.running ? '抓取中...' : '抓取进度' }}</div>
      </div>
    </div>

    <!-- 抓取进度条 -->
    <div v-if="state && state.running" class="progress glass">
      <el-progress
        :percentage="state.total ? Math.round((state.done / state.total) * 100) : 0"
        :stroke-width="12"
        striped
        striped-flow
      />
      <div class="muted mt-8">成功 {{ state.ok }} · 失败 {{ (state.failed || []).length }}</div>
    </div>

    <!-- 抓取日志 -->
    <div v-if="logs.length" class="log-panel glass">
      <div class="log-head">
        <span class="log-title">抓取日志</span>
        <el-button size="small" text @click="logs = []">清空</el-button>
      </div>
      <div class="log-box" ref="logBox">
        <div v-for="(l, i) in logs" :key="i" class="log-line">{{ l }}</div>
      </div>
    </div>

    <!-- 系列分类 -->
    <div class="series-row">
      <el-radio-group v-model="seriesFilter" size="default">
        <el-radio-button value="">全部系列</el-radio-button>
        <el-radio-button v-for="s in seriesList" :key="s" :value="s">{{ s }}</el-radio-button>
      </el-radio-group>
    </div>

    <!-- 话列表（紧凑表格：凸显 id + 新/旧状态，画廊缩小） -->
    <div class="ep-table glass" v-loading="loading">
      <el-empty v-if="!loading && episodes.length === 0" description="还没有抓取到任何漫画话数，点击右上角「抓取 gamekee 漫画」开始" />
      <div v-if="filteredEpisodes.length" class="ep-thead">
        <span class="th-id">id</span>
        <span class="th-thumb">封面</span>
        <span class="th-name">话数 / 标题</span>
        <span class="th-series">系列</span>
        <span class="th-status">状态</span>
      </div>
      <div
        v-for="ep in filteredEpisodes"
        :key="ep.contentId"
        class="ep-row"
        :class="{ 'is-new': isNew(ep) }"
        @click="preview(ep)"
      >
        <span class="td-id mono">{{ ep.id }}</span>
        <span class="td-thumb">
          <img
            v-if="ep.images && ep.images.length"
            :src="mangaImageUrl(ep.images[0])"
            loading="lazy"
            class="thumb-img"
          />
          <span v-else class="thumb-empty">—</span>
        </span>
        <span class="td-name">
          <span class="ep-name">{{ ep.name }}</span>
          <span class="ep-title">{{ ep.title || '（无标题）' }}</span>
        </span>
        <span class="td-series">
          <span class="series-name">{{ ep.series }}</span>
          <span v-if="ep.sub" class="series-sub">{{ ep.sub }}</span>
        </span>
        <span class="td-status">
          <el-tag size="small" :type="isNew(ep) ? 'success' : 'info'" effect="plain">{{ isNew(ep) ? '新' : '旧' }}</el-tag>
          <span v-if="ep.images && ep.images.length > 1" class="img-count">{{ ep.images.length }}图</span>
        </span>
      </div>
    </div>

    <!-- 生成 JSON 预览 -->
    <div class="gen-json glass" v-if="episodes.length">
      <div class="gen-head">
        <span class="gen-title">生成结果预览（manga_main.json，键名与原版 FMPS 一致）</span>
        <el-button size="small" text type="primary" @click="copyJson">复制 JSON</el-button>
      </div>
      <pre class="json-preview mono">{{ jsonPreview }}</pre>
    </div>

    <!-- 抓取方式弹窗 -->
    <el-dialog v-model="crawlDialog" title="抓取 gamekee 漫画" width="min(680px, 94vw)" top="4vh" append-to-body>
      <el-alert type="info" :closable="false" class="mb-12" title="将遍历 gamekee 漫画目录树（碧蓝档案！/ 四格 / 青春记录 等），增量抓取新增话数。已抓过的话会跳过；已排除的系列不会被抓取。" />
      <div class="crawl-toolbar mb-12">
        <el-checkbox
          :model-value="crawlAllChecked"
          :indeterminate="crawlIndeterminate"
          @change="toggleAllSeries"
        >全选（未排除）</el-checkbox>
        <el-button size="small" text @click="crawlSeries = []">清空</el-button>
        <el-button size="small" text @click="selectOfficialOnly">仅选官方</el-button>
        <div class="spacer"></div>
        <span class="muted crawl-stat">已选 {{ crawlSeries.length }} 个系列 · 共 {{ selectedEpisodeCount }} 话</span>
      </div>

      <div v-for="g in seriesGroups" :key="g.key" class="crawl-group">
        <div class="crawl-group-title">
          {{ g.label }}
          <span class="muted">（{{ g.items.length }} 个系列 · {{ groupEpisodeCount(g.items) }} 话）</span>
        </div>
        <div class="crawl-cards">
          <label
            v-for="s in g.items"
            :key="s.id"
            class="crawl-card"
            :class="{ 'is-excluded': s.excluded, 'is-checked': crawlSeries.includes(s.id) }"
          >
            <el-checkbox
              :model-value="crawlSeries.includes(s.id)"
              :disabled="s.excluded"
              @change="(v) => toggleCrawlSeries(s.id, v)"
            />
            <div class="crawl-card-main">
              <div class="crawl-card-name">
                <span v-if="s.lang" class="lang-tag" :class="'lang-' + s.langKey">{{ s.lang }}</span>
                <span class="crawl-card-title">{{ s.clean }}</span>
              </div>
              <div v-if="s.subCount" class="crawl-card-sub muted">{{ s.subCount }} 个子分类</div>
            </div>
            <span class="crawl-count">{{ s.count }}<i>话</i></span>
            <span v-if="s.excluded" class="ex-badge">已排除</span>
          </label>
        </div>
      </div>

      <template #footer>
        <el-button @click="crawlDialog = false">取消</el-button>
        <el-button type="success" @click="doCrawl">开始抓取</el-button>
      </template>
    </el-dialog>

    <!-- 系列管理弹窗：删除不需要的系列爬取记录（汉化合集/同人漫画），并加入排除名单 -->
    <el-dialog v-model="seriesDialog" title="系列管理（清除不需要的爬取记录）" width="min(680px, 94vw)" top="4vh" append-to-body>
      <el-alert
        type="info" :closable="false" class="mb-12"
        title="勾选不需要的系列（汉化合集 / 同人漫画等）后删除：将清除其全部爬取记录（manga_info 话数 + manga_main 条目），并加入排除名单，后续爬取自动跳过。"
      />
      <div class="series-toolbar mb-12">
        <el-button size="small" @click="preselectUnwanted">预选同人 / 汉化合集</el-button>
        <el-button size="small" @click="seriesSelected = new Set()">清空勾选</el-button>
        <span class="muted series-sel-count">已选 {{ seriesSelected.size }} 个系列</span>
      </div>
      <div v-loading="seriesLoading" class="series-list">
        <div v-for="s in seriesMgmtList" :key="s.name" class="series-item" :class="{ 'is-excluded': s.excluded }" @click="toggleSeries(s.name)">
          <el-checkbox :model-value="seriesSelected.has(s.name)" @click.stop="toggleSeries(s.name)" />
          <span class="series-name">{{ s.name }}</span>
          <span class="muted series-count">{{ s.count }} 话</span>
          <el-tag v-if="s.excluded" size="small" type="danger" effect="plain">已排除</el-tag>
        </div>
        <el-empty v-if="!seriesLoading && !seriesMgmtList.length" description="暂无爬取记录" />
      </div>
      <template #footer>
        <el-button @click="seriesDialog = false">关闭</el-button>
        <el-button
          v-if="seriesSelected.size && [...seriesSelected].some(n => excludeSet.has(n))"
          type="primary" plain @click="doUnexclude"
        >取消排除所选</el-button>
        <el-button type="danger" :disabled="!seriesSelected.size" :loading="seriesDeleting" @click="doDeleteSeries">
          删除所选记录并排除
        </el-button>
      </template>
    </el-dialog>

    <!-- 手动补抓弹窗 -->
    <el-dialog v-model="manualDialog" title="手动补抓失败的话" width="min(640px, 94vw)" append-to-body>
      <div class="failed-list">
        <div v-for="(f, i) in (state ? state.failed : [])" :key="i" class="failed-item">
          <div class="failed-info">
            <el-tag size="small" type="danger">失败</el-tag>
            <span class="failed-name">{{ f.series }} · {{ f.name }}</span>
            <span class="mono muted">content_id {{ f.contentId }}</span>
          </div>
          <div class="failed-err muted">{{ f.error }}</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="manualDialog = false">关闭</el-button>
        <el-button type="warning" @click="doRetry">一键重试全部失败项</el-button>
      </template>
    </el-dialog>

    <!-- 漫画预览弹窗 -->
    <el-dialog v-model="previewVisible" :title="previewEp ? `${previewEp.name} ${previewEp.title || ''}` : '预览'" width="min(720px, 94vw)" align-center destroy-on-close append-to-body>
      <div v-if="previewEp" class="preview-body">
        <div class="preview-meta mb-12">
          <el-tag size="small" type="primary">{{ previewEp.series }}</el-tag>
          <el-tag size="small" effect="plain">id {{ previewEp.id }}</el-tag>
          <el-tag size="small" effect="plain" type="info">{{ (previewEp.images || []).length }} 张图</el-tag>
        </div>
        <p v-if="previewEp.textPreview" class="preview-text">{{ previewEp.textPreview }}</p>
        <div class="preview-imgs">
          <img
            v-for="(img, i) in (previewEp.images || [])"
            :key="i"
            :src="mangaImageUrl(img)"
            class="preview-img"
            loading="eager"
          />
        </div>
      </div>
      <template #footer>
        <el-button @click="previewVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 原始 JSON 查看弹窗（支持 manga_main / manga_info 等漫画相关文件） -->
    <el-dialog v-model="rawDialog" title="查看原始 JSON" width="min(860px, 94vw)" top="4vh" append-to-body>
      <div class="raw-toolbar">
        <el-select v-model="rawFname" filterable placeholder="选择 JSON 文件" class="raw-select" @change="loadRawJson">
          <el-option v-for="f in jsonFiles" :key="f.fname" :label="f.fname + (f.dir === 'data' ? '（data）' : '')" :value="f.fname" />
        </el-select>
        <el-tag v-if="rawMeta" size="small" effect="plain" type="info">{{ rawMeta }}</el-tag>
        <div class="spacer"></div>
        <el-button size="small" text type="primary" @click="copyRawJson">复制 JSON</el-button>
      </div>
      <div v-loading="rawLoading" class="raw-wrap">
        <pre class="json-preview mono raw-pre">{{ rawText }}</pre>
      </div>
      <template #footer>
        <el-button @click="rawDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 重复检测弹窗（URL 路径 + MD5 内容校验） -->
    <el-dialog v-model="dupDialog" title="漫画重复检测（MD5 校验）" width="min(760px, 94vw)" top="4vh" append-to-body>
      <div v-loading="dupChecking">
        <el-alert
          v-if="dupReport && !dupChecking"
          :type="(dupReport.urlDuplicates.length + dupReport.md5Duplicates.length) ? 'warning' : 'success'"
          :closable="false"
          class="mb-12"
          :title="`共 ${dupReport.total} 条，MD5 校验 ${dupReport.checked} 条：URL 路径重复 ${dupReport.urlDuplicates.length} 组，内容 MD5 重复 ${dupReport.md5Duplicates.length} 组`"
        />
        <div class="muted mb-12 dup-tip">💡 检测前建议先执行「主图修复」：占位杂图（如 16×16 图标）内容相同但并非同一话，会干扰 MD5 判断；修复后仍重复的才是真正的重复更新。</div>
        <template v-if="dupReport && !dupChecking">
          <template v-if="!dupReport.urlDuplicates.length && !dupReport.md5Duplicates.length">
            <el-empty description="未发现重复更新的漫画" />
          </template>
          <template v-else>
            <section v-if="dupReport.urlDuplicates.length" class="dup-sec">
              <h4 class="dup-title">URL 路径重复（{{ dupReport.urlDuplicates.length }} 组）</h4>
              <div v-for="(g, i) in dupReport.urlDuplicates" :key="'u' + i" class="dup-group">
                <div class="dup-ids">
                  <el-tag v-for="e in g.entries" :key="e.id" size="small" type="danger" effect="plain">id {{ e.id }}</el-tag>
                </div>
                <div class="dup-img mono">{{ g.image }}</div>
              </div>
            </section>
            <section v-if="dupReport.md5Duplicates.length" class="dup-sec">
              <h4 class="dup-title">内容 MD5 重复（{{ dupReport.md5Duplicates.length }} 组）</h4>
              <div v-for="(g, i) in dupReport.md5Duplicates" :key="'m' + i" class="dup-group">
                <div class="dup-ids">
                  <el-tag v-for="e in g.entries" :key="e.id" size="small" type="warning" effect="plain">id {{ e.id }}</el-tag>
                  <span class="mono muted dup-md5">{{ g.md5 }}</span>
                </div>
              </div>
            </section>
          </template>
        </template>
        <el-empty v-else-if="!dupChecking" description="点击下方按钮开始检测" />
      </div>
      <template #footer>
        <el-button @click="dupDialog = false">关闭</el-button>
        <el-button type="primary" :loading="dupChecking" @click="doDupCheck">重新检测</el-button>
        <el-button
          v-if="dupReport && (dupReport.urlDuplicates.length || dupReport.md5Duplicates.length)"
          type="danger"
          :loading="deduping"
          @click="doDedup"
        >一键清理重复</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, onUnmounted } from 'vue';
import { ArrowLeft, Download, Refresh, Tools, Document, CopyDocument, PictureFilled, FolderDelete } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  getManga, getMangaTree, fetchCosManga, crawlManga, retryManga, mangaImageUrl,
  getJsonFiles, getRawJsonFile, checkMangaDuplicates, dedupManga, fixMangaImages,
  getMangaExclude, setMangaExclude, deleteMangaSeries,
} from '../api';

const manga = ref([]);
const episodes = ref([]);
const state = ref(null);
const cosIds = ref(null);
const loading = ref(true);
const cosLoading = ref(false);
const crawling = ref(false);
const seriesFilter = ref('');
const logs = ref([]);
const logBox = ref(null);

const crawlDialog = ref(false);
const crawlSeries = ref([]);
const manualDialog = ref(false);
const previewVisible = ref(false);
const previewEp = ref(null);

let es = null;

const seriesList = computed(() => {
  const set = new Set(episodes.value.map((e) => e.series).filter(Boolean));
  return [...set];
});
const seriesOptions = ref([]);
const latestId = computed(() => {
  if (!manga.value.length) return '—';
  return manga.value[manga.value.length - 1].id;
});
const filteredEpisodes = computed(() => {
  let list = [...episodes.value];
  if (seriesFilter.value) list = list.filter((e) => e.series === seriesFilter.value);
  // 按 id 倒序（最新在前）
  return list.sort((a, b) => Number(b.id) - Number(a.id));
});
const jsonPreview = computed(() => {
  return JSON.stringify(manga.value.slice(-6), null, 2);
});
// 判断新/旧：id 不在 COS 基线里则为「新」
function isNew(ep) {
  if (!cosIds.value) return false;
  return !cosIds.value.includes(String(ep.id));
}

async function load() {
  loading.value = true;
  try {
    const data = await getManga();
    manga.value = data.manga || [];
    episodes.value = (data.info && data.info.episodes) || [];
    state.value = data.state;
    cosIds.value = data.cosIds || null;
    if (data.running) startLogStream();
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function pullCos() {
  cosLoading.value = true;
  try {
    const r = await fetchCosManga();
    ElMessage.success(`已从 COS 拉取 ${r.count} 条话数基准`);
    await load();
  } catch (e) {
    ElMessage.error('拉取 COS 失败：' + e.message);
  } finally {
    cosLoading.value = false;
  }
}

const LANG_MAP = { JP: 'jp', GL: 'gl', CN: 'cn', 非官方: 'fan', 官方: 'off' };

function classifySeries(name) {
  if (/非官方|二创/.test(name)) return 'fan';
  if (/^\[(JP|GL)\]/i.test(name) || /官方/.test(name)) return 'official';
  return 'other';
}

async function openCrawl() {
  crawlDialog.value = true;
  // 拉目录树供选择系列
  try {
    const tree = await getMangaTree();
    seriesOptions.value = tree.categories.map((c) => {
      const lang = (c.name.match(/^\[(JP|GL|CN|非官方|官方)\]/i) || [])[1] || null;
      return {
        id: c.id,
        name: c.name,
        clean: c.name.replace(/^\[[^\]]+\]\s*/, ''),
        lang,
        langKey: lang ? (LANG_MAP[lang] || 'other') : null,
        group: classifySeries(c.name),
        count: c.episodeCount,
        subCount: (c.subCategories || []).length,
        excluded: c.excluded,
      };
    });
    // 默认勾选所有未排除的系列
    crawlSeries.value = seriesOptions.value.filter((s) => !s.excluded).map((s) => s.id);
  } catch (e) {
    ElMessage.warning('拉取目录树失败：' + e.message);
  }
}

const GROUP_META = { official: '官方系列', other: '其他', fan: '二创 / 同人' };
const seriesGroups = computed(() => {
  const groups = { official: [], other: [], fan: [] };
  for (const s of seriesOptions.value) {
    (groups[s.group] || (groups[s.group] = [])).push(s);
  }
  const order = ['official', 'other', 'fan'];
  return order
    .filter((k) => groups[k] && groups[k].length)
    .map((k) => {
      const items = [...groups[k]].sort((a, b) => {
        if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
        return b.count - a.count;
      });
      return { key: k, label: GROUP_META[k], items };
    });
});
function groupEpisodeCount(items) {
  return items.reduce((acc, s) => acc + s.count, 0);
}

const selectableIds = computed(() => seriesOptions.value.filter((s) => !s.excluded).map((s) => s.id));
const crawlAllChecked = computed(() =>
  selectableIds.value.length > 0 && selectableIds.value.every((id) => crawlSeries.value.includes(id))
);
const crawlIndeterminate = computed(() => {
  const n = selectableIds.value.filter((id) => crawlSeries.value.includes(id)).length;
  return n > 0 && n < selectableIds.value.length;
});
const selectedEpisodeCount = computed(() => {
  const set = new Set(crawlSeries.value);
  return seriesOptions.value.filter((s) => set.has(s.id)).reduce((acc, s) => acc + s.count, 0);
});
function toggleCrawlSeries(id, v) {
  const set = new Set(crawlSeries.value);
  v ? set.add(id) : set.delete(id);
  crawlSeries.value = [...set];
}
function toggleAllSeries(v) {
  crawlSeries.value = v ? [...selectableIds.value] : [];
}
function selectOfficialOnly() {
  crawlSeries.value = seriesOptions.value
    .filter((s) => s.group === 'official' && !s.excluded)
    .map((s) => s.id);
}

async function doCrawl() {
  crawlDialog.value = false;
  crawling.value = true;
  logs.value = [];
  startLogStream();
  try {
    await crawlManga(crawlSeries.value);
    ElMessage.success('抓取任务已启动');
    pollState();
  } catch (e) {
    ElMessage.error('启动抓取失败：' + e.message);
    crawling.value = false;
  }
}

async function pollState() {
  const tick = async () => {
    try {
      const data = await getManga();
      state.value = data.state;
      manga.value = data.manga || [];
      episodes.value = (data.info && data.info.episodes) || [];
      cosIds.value = data.cosIds || cosIds.value;
      if (data.running) {
        crawling.value = true;
        setTimeout(tick, 2000);
      } else {
        crawling.value = false;
      }
    } catch {
      setTimeout(tick, 3000);
    }
  };
  setTimeout(tick, 1500);
}

function startLogStream() {
  if (es) return;
  es = new EventSource('/api/crawl/log');
  es.onmessage = (e) => {
    try {
      const { msg } = JSON.parse(e.data);
      logs.value.push(msg);
      if (logs.value.length > 200) logs.value.shift();
      nextTick(() => { if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight; });
    } catch {}
  };
}

function openManual() {
  manualDialog.value = true;
}

async function doRetry() {
  try {
    const r = await retryManga();
    ElMessage.success(`重试完成：成功 ${r.ok} / 共 ${r.retried}`);
    await load();
  } catch (e) {
    ElMessage.error('重试失败：' + e.message);
  }
}

function preview(ep) {
  previewEp.value = ep;
  previewVisible.value = true;
}

// ===== 原始 JSON 查看 =====
const rawDialog = ref(false);
const jsonFiles = ref([]);
const rawFname = ref('manga_main.json');
const rawText = ref('');
const rawMeta = ref('');
const rawLoading = ref(false);

async function openRawJson() {
  rawDialog.value = true;
  if (!jsonFiles.value.length) {
    try {
      const r = await getJsonFiles();
      jsonFiles.value = r.files || [];
      // 漫画界面默认选中 manga_main.json，其次 manga_info.json
      if (!jsonFiles.value.some((f) => f.fname === rawFname.value)) {
        rawFname.value = jsonFiles.value.find((f) => f.fname === 'manga_main.json')?.fname
          || jsonFiles.value.find((f) => f.fname === 'manga_info.json')?.fname
          || (jsonFiles.value[0] && jsonFiles.value[0].fname)
          || '';
      }
    } catch (e) {
      ElMessage.error('获取文件列表失败：' + e.message);
    }
  }
  if (rawFname.value) await loadRawJson();
}

async function loadRawJson() {
  if (!rawFname.value) return;
  rawLoading.value = true;
  rawText.value = '';
  try {
    const r = await getRawJsonFile(rawFname.value);
    rawText.value = JSON.stringify(r.data, null, 2);
    const d = r.data;
    rawMeta.value = Array.isArray(d) ? `${d.length} 条` : `${Object.keys(d).length} 个键`;
  } catch (e) {
    ElMessage.error('读取失败：' + e.message);
  } finally {
    rawLoading.value = false;
  }
}

async function copyRawJson() {
  try {
    await navigator.clipboard.writeText(rawText.value);
    ElMessage.success(`已复制 ${rawFname.value}`);
  } catch {
    ElMessage.error('复制失败');
  }
}

// ===== 重复检测（MD5 校验） =====
const dupDialog = ref(false);
const dupReport = ref(null);
const dupChecking = ref(false);
const deduping = ref(false);

async function openDupCheck() {
  dupDialog.value = true;
  await doDupCheck();
}

async function doDupCheck() {
  dupChecking.value = true;
  dupReport.value = null;
  try {
    dupReport.value = await checkMangaDuplicates(true);
  } catch (e) {
    ElMessage.error('重复检测失败：' + e.message);
  } finally {
    dupChecking.value = false;
  }
}

async function doDedup() {
  try {
    await ElMessageBox.confirm(
      `将删除重复条目（每张重复图片只保留最小 id 的一条），并同步重定向 manga_info 中的话数 id。确认清理？`,
      '清理重复条目',
      { type: 'warning', confirmButtonText: '确认清理', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  deduping.value = true;
  try {
    const r = await dedupManga();
    ElMessage.success(`清理完成：移除 ${r.removed.length} 条重复，保留 ${r.kept} 条`);
    dupReport.value = null;
    await load();
  } catch (e) {
    ElMessage.error('清理失败：' + e.message);
  } finally {
    deduping.value = false;
  }
}

// ===== 主图修复（最大竖屏算法） =====
const fixingImages = ref(false);

// ===== 系列管理：删除不需要的系列爬取记录 + 排除配置 =====
const seriesDialog = ref(false);
const seriesLoading = ref(false);
const seriesMgmtList = ref([]); // [{ name, count, excluded }]
const seriesSelected = ref(new Set());
const excludeSet = ref(new Set());
const seriesDeleting = ref(false);

// 同人 / 汉化合集特征（用于预选）
function isUnwanted(name) {
  return /二创|非官方/.test(name) || /^20\d{2}[上下]$/.test(name);
}

async function openSeriesDialog() {
  seriesDialog.value = true;
  seriesLoading.value = true;
  try {
    const exc = await getMangaExclude();
    excludeSet.value = new Set(exc.series || []);
    const bySeries = new Map();
    for (const e of episodes.value) {
      bySeries.set(e.series, (bySeries.get(e.series) || 0) + 1);
    }
    seriesMgmtList.value = [...bySeries.entries()]
      .map(([name, count]) => ({ name, count, excluded: excludeSet.value.has(name) }))
      .sort((a, b) => b.count - a.count);
    // 预选疑似同人/汉化合集
    const pre = new Set(seriesMgmtList.value.filter((s) => isUnwanted(s.name)).map((s) => s.name));
    seriesSelected.value = pre;
  } catch (e) {
    ElMessage.error('读取系列信息失败：' + e.message);
  } finally {
    seriesLoading.value = false;
  }
}

function toggleSeries(name) {
  const s = new Set(seriesSelected.value);
  s.has(name) ? s.delete(name) : s.add(name);
  seriesSelected.value = s;
}

function preselectUnwanted() {
  const s = new Set(seriesSelected.value);
  for (const it of seriesMgmtList.value) {
    if (isUnwanted(it.name)) s.add(it.name);
  }
  seriesSelected.value = s;
}

async function doDeleteSeries() {
  const list = [...seriesSelected.value];
  if (!list.length) return;
  const total = list.reduce((acc, n) => acc + (seriesMgmtList.value.find((s) => s.name === n)?.count || 0), 0);
  try {
    await ElMessageBox.confirm(
      `将删除 ${list.length} 个系列（共约 ${total} 话）的全部爬取记录，并加入排除名单（后续爬取自动跳过）。确认删除？\n${list.join('、')}`,
      '删除系列爬取记录',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  seriesDeleting.value = true;
  try {
    const r = await deleteMangaSeries(list);
    ElMessage.success(`已删除 ${r.series.length} 个系列：${r.removedEpisodes} 话 / ${r.removedEntries} 条记录，已加入排除名单`);
    seriesDialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error('删除失败：' + e.message);
  } finally {
    seriesDeleting.value = false;
  }
}

async function doUnexclude() {
  const list = [...seriesSelected.value];
  try {
    const next = [...excludeSet.value].filter((n) => !list.includes(n));
    const r = await setMangaExclude(next);
    excludeSet.value = new Set(r.series);
    for (const s of seriesMgmtList.value) s.excluded = r.series.includes(s.name);
    ElMessage.success(`已取消排除 ${list.length} 个系列（下次爬取会重新抓取）`);
    seriesSelected.value = new Set();
  } catch (e) {
    ElMessage.error('操作失败：' + e.message);
  }
}

async function doFixImages() {
  try {
    await ElMessageBox.confirm(
      '将按「最大竖屏图」算法重新计算所有已抓话数的主图 URL，并修正 manga_main.json 中误选的杂图/横图。确认执行？',
      '主图修复',
      { type: 'info', confirmButtonText: '开始修复', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  fixingImages.value = true;
  try {
    const r = await fixMangaImages();
    ElMessage.success(`主图修复完成：共 ${r.total} 话，修正 ${r.fixed} 条主图`);
    await load();
  } catch (e) {
    ElMessage.error('主图修复失败：' + e.message);
  } finally {
    fixingImages.value = false;
  }
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(manga.value, null, 2));
    ElMessage.success('已复制 manga_main.json');
  } catch {
    ElMessage.error('复制失败');
  }
}

onMounted(load);
onUnmounted(() => { if (es) { es.close(); es = null; } });
</script>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 15px;
  margin-bottom: 10px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.head h2 { margin: 0 0 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 14px; }
.mb-12 { margin-bottom: 12px; }
.mt-8 { margin-top: 8px; }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.stat {
  padding: 14px 18px;
  border-radius: 14px;
  text-align: center;
}
.stat-num { font-size: 30px; font-weight: 700; color: var(--el-color-primary); }
.stat-num.warn { color: var(--el-color-warning); }
.stat-label { font-size: 14px; color: var(--el-text-color-secondary); margin-top: 2px; }

.glass {
  background: rgba(30, 31, 43, 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.12);
}
html:not(.dark) .glass {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 8px 28px rgba(30, 50, 90, 0.08);
}

.progress { padding: 16px 18px; border-radius: 14px; margin-bottom: 14px; }

.log-panel { border-radius: 14px; margin-bottom: 14px; overflow: hidden; }
.log-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px 0; }
.log-title { font-weight: 600; font-size: 14px; }
.log-box {
  max-height: 200px;
  overflow-y: auto;
  padding: 8px 14px 14px;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 13px;
}
.log-line { padding: 1px 0; color: var(--el-text-color-regular); white-space: pre-wrap; }

.series-row { margin-bottom: 14px; }

.ep-table {
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 16px;
}
.ep-thead {
  display: grid;
  grid-template-columns: 90px 56px 1.6fr 1.2fr 90px;
  gap: 10px;
  align-items: center;
  padding: 10px 16px;
  background: var(--el-fill-color);
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-light);
}
.ep-row {
  display: grid;
  grid-template-columns: 90px 56px 1.6fr 1.2fr 90px;
  gap: 10px;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: background 0.12s;
}
.ep-row:last-child { border-bottom: none; }
.ep-row:hover { background: var(--el-fill-color-light); }
.ep-row.is-new { background: rgba(74, 222, 128, 0.05); }
.td-id {
  font-size: 17px;
  font-weight: 700;
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
}
.ep-row.is-new .td-id { color: var(--el-color-success); }
.td-thumb { display: flex; align-items: center; }
.thumb-img {
  width: 44px;
  height: 60px;
  object-fit: cover;
  border-radius: 5px;
  background: var(--el-fill-color-light);
  display: block;
}
.thumb-empty {
  width: 44px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
  font-size: 13px;
}
.td-name { display: flex; flex-direction: column; min-width: 0; }
.ep-name { font-weight: 700; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ep-title { font-size: 13px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-series { display: flex; flex-direction: column; min-width: 0; }
.series-name { font-size: 14px; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.series-sub { font-size: 12px; color: var(--el-text-color-secondary); }
.td-status { display: flex; align-items: center; gap: 6px; }
.img-count { font-size: 12px; color: var(--el-text-color-secondary); }

@media (max-width: 700px) {
  .ep-thead, .ep-row { grid-template-columns: 64px 46px 1.4fr 90px; }
  .th-series, .td-series { display: none; }
}

.gen-json { border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
.gen-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.gen-title { font-weight: 600; font-size: 15px; }
.json-preview {
  background: var(--el-fill-color);
  border-radius: 10px;
  padding: 12px;
  max-height: 280px;
  overflow: auto;
  font-size: 13px;
  margin: 0;
}
.mono { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; }

.failed-list { display: flex; flex-direction: column; gap: 10px; max-height: 360px; overflow-y: auto; }
.failed-item { padding: 8px 10px; border-radius: 10px; background: var(--el-fill-color-light); }
.failed-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.failed-name { font-weight: 600; }
.failed-err { font-size: 13px; margin-top: 4px; }

.preview-body { max-height: 70vh; overflow-y: auto; }
.preview-meta { display: flex; gap: 8px; }
.preview-text { color: var(--el-text-color-regular); font-size: 14px; line-height: 1.6; }
.preview-imgs { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.preview-img {
  max-width: 100%;
  max-height: 68vh;
  object-fit: contain;
  border-radius: 8px;
  display: block;
}

/* 原始 JSON 查看弹窗 */
.raw-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.raw-select { width: 300px; }
.spacer { flex: 1; }
.raw-wrap { min-height: 200px; }
.raw-pre { max-height: 62vh; margin: 0; }

/* 重复检测弹窗 */
.dup-sec { margin-bottom: 14px; }
.dup-title { margin: 0 0 8px; font-size: 15px; color: var(--el-text-color-primary); }
.dup-group {
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  margin-bottom: 8px;
}
.dup-ids { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dup-img { font-size: 12px; color: var(--el-text-color-secondary); word-break: break-all; margin-top: 4px; }
.dup-md5 { font-size: 12px; }
.dup-tip { font-size: 13px; }

/* 系列管理弹窗 */
.ex-tag { margin-left: 6px; }
.series-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.series-sel-count { font-size: 13px; }
.series-list { max-height: 52vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.series-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  border-radius: 10px; background: var(--el-fill-color-light);
  cursor: pointer; transition: background 0.12s; flex-wrap: wrap;
}
.series-item:hover { background: var(--el-fill-color); }
.series-item.is-excluded { opacity: 0.65; }
.series-name { font-weight: 600; font-size: 14px; }
.series-count { font-size: 13px; }

/* 抓取弹窗：系列选择卡片 */
.crawl-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.crawl-stat { font-size: 13px; }
.crawl-group { margin-bottom: 16px; }
.crawl-group-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; color: var(--el-text-color-primary); }
.crawl-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
.crawl-card {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-blank);
  cursor: pointer; transition: border-color .12s, background .12s, opacity .12s;
}
.crawl-card:hover { border-color: var(--el-color-primary); }
.crawl-card.is-checked { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.crawl-card.is-excluded { opacity: .5; cursor: not-allowed; background: var(--el-fill-color-light); }
.crawl-card.is-excluded:hover { border-color: var(--el-border-color); }
.crawl-card-main { flex: 1; min-width: 0; }
.crawl-card-name { display: flex; align-items: center; gap: 6px; }
.crawl-card-title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.crawl-card-sub { font-size: 12px; margin-top: 2px; }
.crawl-count { font-size: 13px; color: var(--el-color-primary); font-weight: 700; white-space: nowrap; }
.crawl-count i { font-style: normal; font-weight: 400; color: var(--el-text-color-secondary); font-size: 12px; margin-left: 1px; }
.ex-badge {
  font-size: 12px; color: var(--el-color-danger);
  border: 1px solid var(--el-color-danger); border-radius: 4px;
  padding: 0 5px; white-space: nowrap; flex-shrink: 0;
}
.lang-tag {
  font-size: 11px; font-weight: 700; padding: 0 5px; border-radius: 4px; line-height: 18px;
  color: #fff; flex-shrink: 0;
}
.lang-jp { background: #409eff; }
.lang-gl { background: #9c27b0; }
.lang-cn { background: #67c23a; }
.lang-fan { background: #e6a23c; }
.lang-off { background: #7a6ff0; }
.lang-other { background: #909399; }
</style>
