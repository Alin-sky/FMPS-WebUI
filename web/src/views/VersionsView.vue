<template>
  <div class="ver-page" v-loading="loading">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>
    <div class="head">
      <h2>版本管理</h2>
      <span class="muted">
        每次「发布推送」都会在本地归档一份、同时在云端记一份。
        <b>本地归档只存在这台机器上</b>；换设备发布时，只能靠云端记录看到。
      </span>
    </div>

    <div class="toolbar">
      <el-button type="primary" :loading="rebuilding" @click="doRebuild">
        <el-icon><Refresh /></el-icon> 从云端重建记录
      </el-button>
      <el-button :loading="loading" @click="loadAll">
        <el-icon><Refresh /></el-icon> 刷新
      </el-button>
      <span class="muted small">「重建」会扫描 COS 上 json/ 与 data/ 的对象时间，还原历史上发生过的每一次发布</span>
    </div>

    <!-- ============ 云端发布记录 ============ -->
    <div class="section-head">
      <h3>云端发布记录</h3>
      <span class="muted">跨设备可见 · 数据来自 COS 的 releases/ 目录</span>
    </div>

    <el-alert v-if="cloudError" type="warning" :closable="false" show-icon class="mb12">
      <template #title>读不到云端发布记录</template>
      {{ cloudError }}
    </el-alert>

    <div v-if="!loading && !cloudError && cloudReleases.length === 0" class="empty-box">
      <el-empty description="云端还没有任何发布记录，点上方「从云端重建记录」扫一次" :image-size="110" />
    </div>

    <div class="ver-list">
      <div v-for="(r, idx) in cloudReleases" :key="'c-' + r.ts" class="ver-card cloud">
        <div class="ver-head">
          <span class="ver-title">
            <el-tag v-if="idx === 0" type="success" size="small">云端最新</el-tag>
            <el-tag v-if="r.reconstructed" type="info" size="small">从时间重建</el-tag>
            <span class="ver-ts mono">{{ fmtTime(r.releasedAt) }}</span>
            <span class="muted small mono">{{ r.ts }}</span>
          </span>
          <div class="ver-actions">
            <el-button size="small" text type="primary" @click="toggleCloud(r.ts)">
              {{ expandedTs === r.ts ? '收起' : '查看详情' }}
            </el-button>
            <el-button
              size="small"
              text
              type="warning"
              @click="doApply(r)"
            >拉到本地</el-button>
          </div>
        </div>

        <div class="ver-stats">
          <span class="chip2">来源：{{ r.source?.host || '未知设备' }}</span>
          <span class="chip2" v-if="r.source?.platform">{{ r.source.platform }}</span>
          <span class="chip2">{{ r.totals?.files || 0 }} 个文件</span>
          <span class="chip2">{{ r.totals?.mb || 0 }} MB</span>
          <span class="chip2" v-if="r.students?.count">学生指纹 {{ r.students.count }}</span>
          <span class="chip2" v-if="r.origin === 'local-publish'">Web 发布</span>
        </div>

        <!-- 展开详情 -->
        <div v-if="expandedTs === r.ts" class="ver-detail">
          <div v-if="detailLoading" class="muted">读取中…</div>
          <template v-else-if="detail">
            <!-- 相对上一版本 -->
            <div class="detail-block">
              <div class="detail-title">相对上一版本</div>
              <div v-if="!detail.hasPrev" class="muted">
                {{ detail.students.reason || '没有可对比的前一版本' }}
              </div>
              <template v-else>
                <div class="ver-stats">
                  <span class="chip add">+{{ detail.students.added.length }} 新增</span>
                  <span class="chip mod">~{{ detail.students.modified.length }} 修改</span>
                  <span class="chip del">-{{ detail.students.removed.length }} 删除</span>
                  <span class="muted small">上一版本 {{ fmtTime(detail.prevReleasedAt) }}</span>
                </div>
                <div v-if="!detail.students.available" class="muted small mt6">
                  {{ detail.students.reason }}
                </div>
                <div v-if="hasAnyStudentChange" class="detail-items mt6">
                  <span v-for="s in detail.students.added" :key="'a' + s.Id_db" class="detail-item add">+ {{ s.Name || ('#' + s.Id_db) }} <i>#{{ s.Id_db }}</i></span>
                  <span v-for="s in detail.students.modified" :key="'m' + s.Id_db" class="detail-item mod">~ {{ s.Name || ('#' + s.Id_db) }} <i>#{{ s.Id_db }}</i></span>
                  <span v-for="s in detail.students.removed" :key="'r' + s.Id_db" class="detail-item del">- {{ s.Name || ('#' + s.Id_db) }} <i>#{{ s.Id_db }}</i></span>
                </div>
              </template>
            </div>

            <!-- 文件清单 -->
            <div class="detail-block">
              <div class="detail-title">文件清单（{{ detail.release.files.length }}）</div>
              <div class="file-list">
                <div v-for="f in detail.release.files" :key="f.key" class="file-row">
                  <span class="mono file-key">{{ f.key }}</span>
                  <span class="muted mono">{{ fmtSize(f.size) }}</span>
                  <span class="muted mono md5">{{ f.md5 ? f.md5.slice(0, 10) : '—' }}</span>
                </div>
              </div>
            </div>

            <!-- 与本地对比（按需加载，要下载云端文件，慢） -->
            <div class="detail-block">
              <div class="detail-title">
                与本地现状对比
                <el-button
                  v-if="!localCmp[r.ts]"
                  size="small"
                  text
                  type="primary"
                  :loading="localCmpLoading === r.ts"
                  @click="loadLocalCmp(r.ts)"
                >开始对比</el-button>
              </div>
              <div v-if="localCmp[r.ts]" class="cmp-box">
                <div class="ver-stats">
                  <span class="chip add">+{{ localCmp[r.ts].students.added.length }} 本地多出</span>
                  <span class="chip mod">~{{ localCmp[r.ts].students.modified.length }} 两边不同</span>
                  <span class="chip del">-{{ localCmp[r.ts].students.removed.length }} 仅云端有</span>
                </div>
                <div class="muted small mt6">
                  学生级：本地与云端该版本
                  <b>{{ localCmp[r.ts].students.available ? (hasLocalStudentChange(r.ts) ? '存在差异' : '完全一致') : '无法比对' }}</b>
                  ；文件级：一致 {{ localCmp[r.ts].files.same }} 个，
                  仅本地有 {{ localCmp[r.ts].files.added.length }} 个，
                  仅云端有 {{ localCmp[r.ts].files.removed.length }} 个，
                  真正不同 {{ localCmp[r.ts].files.modified.length }} 个
                  <template v-if="localCmp[r.ts].eolOnly?.length">
                    ，另 {{ localCmp[r.ts].eolOnly.length }} 个仅换行符不同（CRLF vs LF，数据一致）
                  </template>
                </div>
                <div v-if="localCmp[r.ts].files.modified.length" class="file-list mt6">
                  <div v-for="f in localCmp[r.ts].files.modified" :key="'cm' + f.key" class="file-row two">
                    <span class="mono file-key">{{ f.key }}</span>
                    <span class="muted mono cmp-note">本地 {{ fmtSize(f.size) }} ← 云端 {{ fmtSize(f.prevSize) }}</span>
                  </div>
                </div>
                <div v-if="localCmp[r.ts].eolOnly?.length" class="file-list mt6">
                  <div v-for="f in localCmp[r.ts].eolOnly" :key="'ce' + f.key" class="file-row two eol">
                    <span class="mono file-key">{{ f.key }}</span>
                    <span class="muted mono cmp-note">仅换行符不同，数据一致</span>
                  </div>
                </div>
                <div v-if="localCmp[r.ts].files.removed.length" class="file-list mt6">
                  <div v-for="k in localCmp[r.ts].files.removed" :key="'cr' + k" class="file-row two">
                    <span class="mono file-key">{{ k }}</span>
                    <span class="muted mono cmp-note">仅云端存在（本地没有这个文件）</span>
                  </div>
                </div>
                <div v-if="localCmp[r.ts].files.added.length" class="file-list mt6">
                  <div v-for="k in localCmp[r.ts].files.added" :key="'ca' + k" class="file-row two">
                    <span class="mono file-key">{{ k }}</span>
                    <span class="muted mono cmp-note">仅本地存在（云端该版本没有）</span>
                  </div>
                </div>
              </div>
              <div v-else class="muted small">点「开始对比」会下载云端该版本的文件逐个比 md5，稍慢</div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ============ 本地版本归档 ============ -->
    <div class="section-head">
      <h3>本地版本归档</h3>
      <span class="muted">只存在这台机器上 · 每次在本机点「发布推送」时生成</span>
    </div>

    <div v-if="!loading && versions.length === 0" class="empty-box">
      <el-empty description="本机还没有版本归档" :image-size="110" />
    </div>

    <div class="ver-list">
      <div v-for="(v, idx) in versions" :key="v.ts" class="ver-card">
        <div class="ver-head">
          <span class="ver-title">
            <el-tag v-if="idx === 0" type="success" size="small">最新</el-tag>
            <span class="ver-ts mono">{{ v.ts }}</span>
          </span>
          <div class="ver-actions">
            <el-button size="small" text type="primary" @click="toggleExpand(v.ts)">查看变更</el-button>
            <el-button size="small" text type="warning" @click="doRestore(v)">复原到此版本</el-button>
          </div>
        </div>
        <div class="ver-stats">
          <span class="chip add">+{{ v.added.length }} 新增</span>
          <span class="chip mod">~{{ v.modified.length }} 修改</span>
          <span class="chip del">-{{ v.removed.length }} 删除</span>
          <span v-if="v.prevTs" class="muted small">相对上一版本 {{ v.prevTs }}</span>
        </div>
        <div v-if="expandedTs === v.ts" class="ver-detail">
          <div v-if="v.added.length" class="detail-block">
            <div class="detail-title add">新增（{{ v.added.length }}）</div>
            <div class="detail-items">
              <span v-for="s in v.added" :key="s.Id_db" class="detail-item">#{{ s.Id_db }} {{ s.Name }}</span>
            </div>
          </div>
          <div v-if="v.modified.length" class="detail-block">
            <div class="detail-title mod">修改（{{ v.modified.length }}）</div>
            <div class="detail-items">
              <span v-for="s in v.modified" :key="s.Id_db" class="detail-item">#{{ s.Id_db }} {{ s.Name }}</span>
            </div>
          </div>
          <div v-if="v.removed.length" class="detail-block">
            <div class="detail-title del">删除（{{ v.removed.length }}）</div>
            <div class="detail-items">
              <span v-for="s in v.removed" :key="s.Id_db" class="detail-item">#{{ s.Id_db }} {{ s.Name }}</span>
            </div>
          </div>
          <div v-if="!v.added.length && !v.modified.length && !v.removed.length" class="muted">此版本无学生数据变更</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  getVersions,
  restoreVersion,
  getCloudReleases,
  rebuildCloudReleases,
  getCloudRelease,
  compareCloudReleaseLocal,
  applyCloudRelease,
} from '../api';

const router = useRouter();

const versions = ref([]);
const cloudReleases = ref([]);
const cloudError = ref(null);
const loading = ref(true);
const rebuilding = ref(false);
const expandedTs = ref(null);
const detail = ref(null);
const detailLoading = ref(false);
const localCmp = ref({});
const localCmpLoading = ref(null);

const hasAnyStudentChange = computed(() => {
  const d = detail.value;
  if (!d) return false;
  return d.students.added.length + d.students.modified.length + d.students.removed.length > 0;
});

// ISO → 本地时间可读串（COS 的 LastModified 是 UTC，必须转成本机时区再显示）
function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtSize(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function hasLocalStudentChange(ts) {
  const c = localCmp.value[ts];
  if (!c || !c.students.available) return false;
  return c.students.added.length + c.students.modified.length + c.students.removed.length > 0;
}

async function loadAll() {
  loading.value = true;
  cloudError.value = null;
  const jobs = [
    getVersions()
      .then((r) => { versions.value = r.versions || []; })
      .catch((e) => { console.error('本地版本读取失败', e); }),
    getCloudReleases()
      .then((r) => { cloudReleases.value = r.releases || []; })
      .catch((e) => { cloudError.value = e.message; }),
  ];
  await Promise.all(jobs);
  loading.value = false;
}

async function toggleCloud(ts) {
  if (expandedTs.value === ts) {
    expandedTs.value = null;
    return;
  }
  expandedTs.value = ts;
  detail.value = null;
  detailLoading.value = true;
  try {
    detail.value = await getCloudRelease(ts);
  } catch (e) {
    ElMessage.error('读取云端发布详情失败：' + e.message);
    expandedTs.value = null;
  } finally {
    detailLoading.value = false;
  }
}

async function loadLocalCmp(ts) {
  localCmpLoading.value = ts;
  try {
    localCmp.value = { ...localCmp.value, [ts]: await compareCloudReleaseLocal(ts) };
  } catch (e) {
    ElMessage.error('对比失败：' + e.message);
  } finally {
    localCmpLoading.value = null;
  }
}

function toggleExpand(ts) {
  expandedTs.value = expandedTs.value === ts ? null : ts;
}

async function doRebuild() {
  rebuilding.value = true;
  try {
    const r = await rebuildCloudReleases();
    const parts = [];
    if (r.added) parts.push(`新增 ${r.added} 条`);
    if (r.updated) parts.push(`更新 ${r.updated} 条`);
    parts.push(`扫到 ${r.clusters} 次发布`);
    ElMessage.success('云端记录重建完成：' + parts.join('，'));
    await loadAll();
  } catch (e) {
    ElMessage.error('重建失败：' + e.message);
  } finally {
    rebuilding.value = false;
  }
}

async function doApply(r) {
  try {
    await ElMessageBox.confirm(
      `将把「${fmtTime(r.releasedAt)}」这次云端发布的 ${r.totals?.files || 0} 个文件下载并覆盖本地 json/ 与 data/。\n\n` +
        '本地现状会先自动归档成一个版本（之后可在下方「本地版本归档」里复原回来）。',
      '把云端版本拉到本地',
      { type: 'warning', confirmButtonText: '确认拉取', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    const res = await applyCloudRelease(r.ts);
    let msg = `已写入 ${res.written} 个文件到本地；本地现状已归档为 ${res.backupTs}`;
    if (res.newLocalVersion) msg += `，当前状态归档为 ${res.newLocalVersion}`;
    if (res.failed?.length) msg += `；${res.failed.length} 个文件在云端已不存在，未写入`;
    ElMessage.success(msg);
    await loadAll();
  } catch (e) {
    ElMessage.error('拉取失败：' + e.message);
  }
}

async function doRestore(v) {
  try {
    await ElMessageBox.confirm(`确定把当前数据整体复原到版本 ${v.ts} 吗？此操作会覆盖当前所有修改。`, '复原到版本', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await restoreVersion(v.ts);
    ElMessage.success(`已复原到版本 ${v.ts}`);
    router.push('/');
  } catch (e) {
    ElMessage.error('复原失败：' + e.message);
  }
}

onMounted(loadAll);
</script>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 16px;
  margin-bottom: 10px;
}
.head { margin-bottom: 14px; }
.head h2 { margin: 0 0 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 16px; }
.muted.small { font-size: 14px; }
.mt6 { margin-top: 6px; }
.mb12 { margin-bottom: 12px; }

.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }

.section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin: 22px 0 12px;
}
.section-head h3 { margin: 0; font-size: 19px; font-weight: 700; }

.empty-box { padding: 8px 0 4px; }

.ver-list { display: flex; flex-direction: column; gap: 14px; }
.ver-card {
  background: var(--fmps-panel-bg);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--fmps-panel-border);
  box-shadow: var(--fmps-panel-shadow);
  border-radius: 14px;
  padding: 16px 18px;
}
/* 云端卡片左侧给一道主色条，和本地归档一眼区分开 */
.ver-card.cloud { border-left: 3px solid var(--el-color-primary); }

.ver-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.ver-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ver-ts { font-size: 17px; font-weight: 600; }
.ver-actions { display: flex; gap: 4px; }
.ver-stats { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.chip { font-size: 15px; font-weight: 600; }
.chip.add { color: var(--el-color-success); }
.chip.mod { color: var(--el-color-warning); }
.chip.del { color: var(--el-color-danger); }
.chip2 {
  font-size: 14px;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}

.ver-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.detail-block { display: flex; flex-direction: column; gap: 0; }
.detail-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.detail-title.add { color: var(--el-color-success); }
.detail-title.mod { color: var(--el-color-warning); }
.detail-title.del { color: var(--el-color-danger); }
.detail-items { display: flex; flex-wrap: wrap; gap: 6px; }
.detail-item {
  font-size: 14px;
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--fmps-subtle-bg);
  color: var(--el-text-color-regular);
}
.detail-item i { font-style: normal; opacity: 0.6; font-size: 13px; }
.detail-item.add { color: var(--el-color-success); }
.detail-item.mod { color: var(--el-color-warning); }
.detail-item.del { color: var(--el-color-danger); }

.file-list {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--fmps-subtle-border);
}
.file-row {
  display: grid;
  grid-template-columns: 1fr 110px 90px;
  gap: 10px;
  align-items: center;
  padding: 7px 12px;
  font-size: 14px;
  background: var(--fmps-subtle-bg);
  border-bottom: 1px solid var(--fmps-subtle-border);
}
.file-row:last-child { border-bottom: none; }
/* 仅换行符差异的行淡一点，和真差异区分开 */
.file-row.eol .file-key,
.file-row.eol .cmp-note { opacity: 0.7; }
/* 只有「文件名 + 一句说明」两列的行（与本地对比那几个清单），
   复用三列栅格会把说明挤进 110px 里折行 */
.file-row.two { grid-template-columns: minmax(0, 1fr) max-content; }
.file-row.two .cmp-note { white-space: nowrap; }
.file-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.md5 { letter-spacing: 0.02em; }

.cmp-box {
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--fmps-subtle-bg);
  border: 1px solid var(--fmps-subtle-border);
}

@media (max-width: 720px) {
  /* .file-row.two 的权重比 .file-row 高，这里必须一并覆盖，否则手机上两列挤成一条 */
  .file-row,
  .file-row.two { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .file-row.two .cmp-note { white-space: normal; }
}
</style>
