<template>
  <div class="list-page">
    <!-- 页头统计 -->
    <div class="page-head">
      <div class="page-title">
        <h1>学生数据</h1>
        <span class="muted">管理 Blue Archive 学生昵称库，爬取 · 校对 · 发布</span>
      </div>
      <div class="stat-chips" v-if="stats">
        <span class="stat-chip"><b>{{ stats.completeCount }}</b>完整</span>
        <span
          class="stat-chip"
          :class="stats.incompleteCount > 0 ? 'warn' : 'ok'"
        ><b>{{ stats.incompleteCount }}</b>缺失</span>
        <span class="stat-chip"><b>{{ stats.giftCount }}</b>礼物</span>
        <span class="stat-chip"><b>{{ stats.mangaCount }}</b>漫画</span>
      </div>
    </div>

    <!-- 模式切换 + 统计（单选按钮组：全览/更新/漫画更新/JSON对比 贴合为一体） -->
    <div class="top-row">
      <el-radio-group :model-value="viewMode" size="default" @update:model-value="onModeChange">
        <el-radio-button value="all">全览模式</el-radio-button>
        <el-radio-button value="update">更新模式</el-radio-button>
        <el-radio-button value="manga">漫画更新</el-radio-button>
        <el-radio-button value="gacha">卡池管理</el-radio-button>
        <el-radio-button value="icons">头像管理</el-radio-button>
        <el-radio-button value="json">JSON对比</el-radio-button>
      </el-radio-group>
      <div class="mode-hint">
        <template v-if="mode === 'all'">
          <span class="muted">{{ students.length }} 名本地学生</span>
          <el-tooltip content="跳转到头像管理页，处理缺失的头像图" placement="bottom">
            <el-button
              v-if="iconBadge.total > 0"
              size="small"
              type="warning"
              plain
              @click="goIcons('missing')"
            >
              <el-icon><Picture /></el-icon>
              缺头像 {{ iconBadge.total }}
            </el-button>
          </el-tooltip>
        </template>
        <template v-else>
          <span class="muted">对比云端：</span>
          <span class="chip add">+{{ cloudDiff.added.length }}</span>
          <span class="chip mod">~{{ cloudDiff.modified.length }}</span>
          <span class="chip del">-{{ cloudDiff.removed.length }}</span>
          <span class="chip un">={{ (cloudDiff.unchanged || []).length }}</span>
        </template>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="搜索名字 / 昵称 / Id_db"
        clearable
        :prefix-icon="Search"
        class="search"
      />
      <el-button-group>
        <el-button :type="sortOrder === 'asc' ? 'primary' : ''" size="default" @click="sortOrder = 'asc'">正序</el-button>
        <el-button :type="sortOrder === 'desc' ? 'primary' : ''" size="default" @click="sortOrder = 'desc'">倒序</el-button>
      </el-button-group>
      <div class="spacer"></div>
      <el-button type="primary" :loading="crawling" @click="crawlDialog = true">
        <el-icon v-if="!crawling"><Refresh /></el-icon> 获取更新
      </el-button>
      <el-button type="success" @click="publishDialog = true">
        <el-icon><Upload /></el-icon> 发布推送
      </el-button>
      <el-button :loading="exporting" @click="doExport">
        <el-icon><Download /></el-icon> 导出 JSON
      </el-button>
    </div>

    <!-- 获取更新弹窗（本地 / 云端） -->
    <el-dialog v-model="crawlDialog" title="选择更新方式" width="min(520px, 92vw)">
      <el-radio-group v-model="crawlMode" class="crawl-modes">
        <el-radio label="local" border>
          <div class="mode-title">本地算法更新</div>
          <div class="mode-desc">运行 schaledb 爬取 + 别名/昵称/匹配名生成算法（和 FMPS 可能略有出入）</div>
        </el-radio>
        <el-radio label="cloud" border>
          <div class="mode-title">云端数据更新</div>
          <div class="mode-desc">从 COS 复制所有 JSON 到本地，不做任何算法更改，并和上一版本校验</div>
        </el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="crawlDialog = false">取消</el-button>
        <el-button type="primary" :loading="crawling" @click="doCrawl">开始更新</el-button>
      </template>
    </el-dialog>

    <!-- 列表 -->
    <div class="list" v-loading="loading">
      <!-- 表头 -->
      <div class="row header">
        <span class="col-avatar"></span>
        <span class="col-name">名字</span>
        <span class="col-id">Id</span>
        <span class="col-star">星级</span>
        <span class="col-map">匹配名</span>
        <span class="col-favor">好感标签</span>
        <span class="col-nick">昵称</span>
        <span class="col-status">状态</span>
      </div>

      <!-- 全览模式 -->
      <template v-if="mode === 'all'">
        <div
          v-for="s in filtered"
          :key="s.Id_db"
          class="row"
          :class="{ skipped: skipSet.has(s.Id_db) }"
          @click="$router.push(`/student/${s.Id_db}`)"
        >
          <span class="col-avatar"><img :src="avatarUrl(s.Id_db)" class="avatar" loading="lazy" /></span>
          <span class="col-name">
            <span class="name-cn">{{ s.Name_zh_cn || s.Name_en || '未知' }}</span>
            <span class="name-en">{{ s.Name_en }}</span>
          </span>
          <span class="col-id mono">#{{ s.Id_db }}</span>
          <span class="col-star star">{{ starText(s.StarGrade) }}</span>
          <span class="col-map">{{ s.MapName || '—' }}</span>
          <span class="col-favor">
            <el-tag v-for="t in (s.FavorItemTags || []).slice(0, 3)" :key="t" size="small" effect="plain" class="mini-tag">{{ t }}</el-tag>
          </span>
          <span class="col-nick nick">{{ (s.NickName || []).slice(0, 4).join(' · ') }}</span>
          <span class="col-status">
            <el-tag v-if="s.complete" size="small" type="success" effect="plain">完整</el-tag>
            <el-tag v-else size="small" type="danger" effect="plain">缺 {{ s.missing.length }}</el-tag>
          </span>
        </div>
      </template>

      <!-- 更新模式 -->
      <template v-else>
        <template v-for="item in diffList" :key="item.student.Id_db">
          <div
            class="row"
            :class="[item.type, { skipped: skipSet.has(item.student.Id_db) }]"
            @click="item.type === 'modified' ? toggleExpand(item.student.Id_db) : (item.type !== 'removed' && $router.push(`/student/${item.student.Id_db}`))"
            @dblclick="item.type !== 'removed' && $router.push(`/student/${item.student.Id_db}?edit=1`)"
          >
            <span class="col-avatar" @click.stop="item.type !== 'removed' && $router.push(`/student/${item.student.Id_db}`)">
              <img :src="avatarUrl(item.student.Id_db)" class="avatar" loading="lazy" />
            </span>
            <span class="col-name">
              <span class="name-cn">{{ item.student.Name_zh_cn || item.student.Name_en || '未知' }}</span>
              <span class="name-en">{{ item.student.Name_en }}</span>
            </span>
            <span class="col-id mono">#{{ item.student.Id_db }}</span>
            <span class="col-star star">{{ starText(item.student.StarGrade) }}</span>
            <span class="col-map">{{ item.student.MapName || '—' }}</span>
            <span class="col-favor">
              <el-tag v-for="t in (item.student.FavorItemTags || []).slice(0, 3)" :key="t" size="small" effect="plain" class="mini-tag">{{ t }}</el-tag>
            </span>
            <span class="col-nick nick">{{ (item.student.NickName || []).slice(0, 4).join(' · ') }}</span>
            <span class="col-status">
              <el-tag v-if="item.type === 'added'" size="small" type="success">新增</el-tag>
              <el-tag v-else-if="item.type === 'modified'" size="small" type="warning">修改 {{ item.fields?.length || 0 }} 项</el-tag>
              <el-tag v-else-if="item.type === 'removed'" size="small" type="danger">删除</el-tag>
              <el-tag v-else size="small" type="info" effect="plain">无变更</el-tag>
            </span>
          </div>
          <!-- 字段级 diff 展开 -->
          <div v-if="item.type === 'modified' && expandedId === item.student.Id_db" class="field-diff">
            <div v-for="f in (item.fields || [])" :key="f.key" class="diff-line">
              <span class="diff-key mono">{{ f.key }}</span>
              <span class="diff-old">- {{ fmtVal(f.prev) }}</span>
              <span class="diff-new">+ {{ fmtVal(f.curr) }}</span>
            </div>
            <div class="diff-actions">
              <el-button size="small" type="warning" plain :loading="revertingId === item.student.Id_db" @click.stop="revertStudent(item.student.Id_db, 'all')">
                <el-icon><RefreshLeft /></el-icon> 复原此角色
              </el-button>
              <el-button size="small" type="warning" plain :loading="revertingId === item.student.Id_db" @click.stop="revertStudent(item.student.Id_db, 'except-id')">
                <el-icon><RefreshRight /></el-icon> 除ID外复原
              </el-button>
            </div>
          </div>
        </template>
      </template>
    </div>

    <el-empty
      v-if="!loading && ((mode === 'all' && filtered.length === 0) || (mode === 'update' && diffList.length === 0))"
      :description="mode === 'all' ? '没有匹配的学生' : '本地与云端无差异'"
    />

    <!-- 爬取日志弹窗 -->
    <el-dialog v-model="logVisible" title="爬取日志" width="min(560px, 92vw)" :close-on-click-modal="false">
      <div class="log-box" ref="logBox">
        <div v-for="(line, i) in logs" :key="i" class="log-line" :class="{ dim: line.startsWith('   ') }">{{ line }}</div>
        <div v-if="crawling" class="log-line dim">...</div>
      </div>
      <template #footer>
        <el-button v-if="crawling" disabled>爬取中...</el-button>
        <el-button v-else type="primary" @click="logVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 发布推送弹窗（第一步：密码 → 对比预览） -->
    <el-dialog v-model="publishDialog" title="发布推送到腾讯 COS" width="min(420px, 92vw)">
      <el-alert type="info" :closable="false" class="mb-12" title="将对比本地与云端的所有 JSON 变更，确认后生成 hash.json 并上传到腾讯云 COS" />
      <el-input v-model="publishPassword" type="password" placeholder="输入发布密码" show-password @keyup.enter="doPreviewPublish" />
      <template #footer>
        <el-button @click="publishDialog = false">取消</el-button>
        <el-button type="primary" :loading="previewing" @click="doPreviewPublish">对比预览</el-button>
      </template>
    </el-dialog>

    <!-- 发布推送弹窗（第二步：变更预览 → 确认推送） -->
    <el-dialog v-model="publishPreviewDialog" title="推送变更预览（本地 vs 云端）" width="min(900px, 94vw)" top="3vh">
      <div v-loading="previewing" class="pub-preview-body">
        <template v-if="publishPreview">
          <!-- ① 数量统计总览 -->
          <div class="pub-summary glass">
            <div class="ps-item">
              <span class="ps-num">{{ publishPreview.jsonCount }}</span>
              <span class="ps-label">JSON 文件</span>
            </div>
            <div class="ps-item">
              <span class="ps-num">{{ pubTotals.filesChanged }}</span>
              <span class="ps-label">有变更的文件</span>
            </div>
            <div class="ps-item add">
              <span class="ps-num">+{{ pubTotals.added }}</span>
              <span class="ps-label">新增条目</span>
            </div>
            <div class="ps-item mod">
              <span class="ps-num">~{{ pubTotals.modified }}</span>
              <span class="ps-label">修改条目</span>
            </div>
            <div class="ps-item del">
              <span class="ps-num">-{{ pubTotals.removed }}</span>
              <span class="ps-label">删除条目</span>
            </div>
            <div class="ps-item">
              <span class="ps-num">{{ pubTotals.fields }}</span>
              <span class="ps-label">变更字段数</span>
            </div>
            <div class="ps-item" :class="{ warn: (publishPreview.iconDiff?.totals?.add || 0) + (publishPreview.iconDiff?.totals?.modify || 0) > 0 }">
              <span class="ps-num">{{ (publishPreview.iconDiff?.totals?.add || 0) + (publishPreview.iconDiff?.totals?.modify || 0) }}</span>
              <span class="ps-label">头像图待传</span>
            </div>
          </div>

          <el-alert type="info" :closable="false" class="mb-12"
            :title="`将推送 ${publishPreview.jsonCount} 个 JSON 文件（json/ 前缀）${publishPreview.dataFiles.length ? ` + ${publishPreview.dataFiles.length} 个数据文件（data/ 前缀：${publishPreview.dataFiles.join('、')}）` : ''}，并更新 hash.json`" />

          <!-- ② JSON 文件清单（可折叠 → 字段级红绿 diff） -->
          <div class="pub-section-title">
            <el-icon><Document /></el-icon> JSON 变更明细
            <span class="muted">（点击文件名展开字段级对比）</span>
          </div>
          <div class="pub-file-list">
            <div v-for="f in publishPreview.files" :key="f.fname" class="pub-file-item">
              <div class="pub-file-head" @click="togglePubFile(f.fname)">
                <el-icon class="pub-caret" :class="{ open: expandedPubFiles.has(f.fname) }"><CaretRight /></el-icon>
                <span class="pub-fname mono">{{ f.fname }}</span>
                <el-tag v-if="f.isNew" size="small" type="success">新文件</el-tag>
                <el-tag v-else-if="!f.cloudAvailable" size="small" type="info" effect="plain">云端无此文件</el-tag>
                <template v-if="f.added || f.modified || f.removed">
                  <span class="chip add">+{{ f.added }}</span>
                  <span class="chip mod">~{{ f.modified }}</span>
                  <span class="chip del">-{{ f.removed }}</span>
                </template>
                <el-tag v-else size="small" type="info" effect="plain">无变化</el-tag>
                <span v-if="f.unchanged" class="muted pub-unchanged">={{ f.unchanged }}</span>
              </div>
              <!-- 展开的明细 -->
              <div v-if="expandedPubFiles.has(f.fname)" class="pub-file-detail">
                <div v-if="f.addList && f.addList.length" class="pub-detail-sec">
                  <div class="pub-detail-title add">新增（{{ f.added }}）</div>
                  <div v-for="(it, i) in f.addList" :key="'a' + i" class="pub-detail-line add">#{{ it.id }} {{ it.label }}</div>
                </div>
                <div v-if="f.modList && f.modList.length" class="pub-detail-sec">
                  <div class="pub-detail-title mod">修改（{{ f.modified }}）</div>
                  <div v-for="(it, i) in f.modList" :key="'m' + i" class="pub-detail-line mod">
                    <span class="pub-line-head">#{{ it.id }} {{ it.label }}</span>
                    <div v-for="fd in it.fields" :key="fd.key" class="pub-field-line">
                      <span class="mono pub-field-key">{{ fd.key }}</span>
                      <span class="pub-old">- {{ fd.prev }}</span>
                      <span class="pub-new">+ {{ fd.curr }}</span>
                    </div>
                  </div>
                </div>
                <div v-if="f.delList && f.delList.length" class="pub-detail-sec">
                  <div class="pub-detail-title del">删除（{{ f.removed }}）</div>
                  <div v-for="(it, i) in f.delList" :key="'d' + i" class="pub-detail-line del">#{{ it.id }} {{ it.label }}</div>
                </div>
                <el-empty v-if="!(f.addList || []).length && !(f.modList || []).length && !(f.delList || []).length" description="无变更明细" :image-size="48" />
              </div>
            </div>
          </div>

          <!-- ③ 图片清单与体积 -->
          <div class="pub-section-title" style="margin-top: 18px">
            <el-icon><Picture /></el-icon> 头像图片（随本次发布上传）
            <span class="muted" v-if="publishPreview.iconDiff?.totals">
              — 新增 {{ publishPreview.iconDiff.totals.add }} / 变更 {{ publishPreview.iconDiff.totals.modify }} /
              未变 {{ publishPreview.iconDiff.totals.same }}，共 {{ publishPreview.iconDiff.totals.mb }} MB
            </span>
          </div>

          <el-alert v-if="publishPreview.iconDiff?.error" type="warning" :closable="false">
            头像差异计算失败：{{ publishPreview.iconDiff.error }}（发布时仍会尝试上传）
          </el-alert>

          <template v-else-if="publishPreview.iconDiff?.totals">
            <div class="pub-summary icon-summary">
              <div class="ps-item add">
                <span class="ps-num">{{ publishPreview.iconDiff.totals.add }}</span>
                <span class="ps-label">新增图</span>
              </div>
              <div class="ps-item mod">
                <span class="ps-num">{{ publishPreview.iconDiff.totals.modify }}</span>
                <span class="ps-label">变更图</span>
              </div>
              <div class="ps-item">
                <span class="ps-num">{{ publishPreview.iconDiff.totals.same }}</span>
                <span class="ps-label">未变化</span>
              </div>
              <div class="ps-item warn">
                <span class="ps-num">{{ publishPreview.iconDiff.totals.cloudOnly }}</span>
                <span class="ps-label">仅云端有</span>
              </div>
              <div class="ps-item">
                <span class="ps-num">{{ publishPreview.iconDiff.totals.mb }}</span>
                <span class="ps-label">本次上传 MB</span>
              </div>
            </div>

            <div v-if="publishPreview.iconDiff.files?.length" class="icon-list-toggle">
              <el-button size="small" text @click="showIconFiles = !showIconFiles">
                {{ showIconFiles ? '收起' : '展开' }}图片清单（{{ publishPreview.iconDiff.files.length }} 条）
              </el-button>
              <div class="icon-filter">
                <el-input v-model="iconFileFilter" size="small" placeholder="过滤 Id / 类型" clearable />
              </div>
            </div>
            <div v-if="showIconFiles" class="icon-file-list">
              <div
                v-for="(it, i) in filteredIconFiles.slice(0, 400)"
                :key="i"
                class="icon-file-line"
                :class="it.action"
              >
                <el-tag size="small" :type="iconActionType(it.action)" effect="plain">{{ iconActionLabel(it.action) }}</el-tag>
                <img :src="`/api/iconview/${it.type}/${it.id}`" class="icon-mini" loading="lazy" @error="(e) => (e.target.style.visibility = 'hidden')" />
                <span class="mono">{{ it.type }}/{{ it.id }}.{{ it.type === 'stu_icon_db' ? 'jpg' : 'png' }}</span>
                <span class="muted">{{ (it.size / 1024).toFixed(0) }} KB</span>
              </div>
              <div v-if="filteredIconFiles.length > 400" class="muted" style="padding: 6px">
                … 仅显示前 400 条，共 {{ filteredIconFiles.length }} 条
              </div>
              <el-empty v-if="!filteredIconFiles.length" description="没有待上传的图片" :image-size="42" />
            </div>
            <el-empty v-else-if="!publishPreview.iconDiff.files?.length" description="图片与云端一致，无需上传" :image-size="42" />
          </template>

          <!-- ④ 历次发布记录 -->
          <div class="pub-section-title" style="margin-top: 18px">
            <el-icon><Clock /></el-icon> 历次发布记录
            <el-button size="small" text @click="loadIconReleases">刷新</el-button>
          </div>
          <div v-if="iconReleases.length" class="release-list">
            <div v-for="r in iconReleases.slice(0, 8)" :key="r.file" class="release-item">
              <span class="release-ts mono">{{ (r.releasedAt || '').replace('T', ' ').slice(0, 19) }}</span>
              <span class="muted">
                新增 {{ r.totals?.add || 0 }} / 变更 {{ r.totals?.modify || 0 }} / 共 {{ r.totals?.mb || 0 }} MB
              </span>
            </div>
          </div>
          <div v-else class="muted" style="padding: 4px 0">（暂无头像发布记录）</div>
        </template>
      </div>
      <template #footer>
        <el-button @click="publishPreviewDialog = false">返回修改</el-button>
        <el-checkbox v-model="iconPublishEnabled" style="margin-right: 12px">同时上传头像图</el-checkbox>
        <el-button type="success" :loading="publishing" @click="doPublish">确认推送</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { Search, Refresh, Upload, Download, RefreshLeft, RefreshRight, CaretRight, Picture, Document, Clock } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getStudents, getCloudDiff, avatarUrl, crawl, crawlCloud, revertStudentAll, revertStudentExceptId, publish, previewPublish, getSkipList, exportJson, getIconsStatus, getIconReleases } from '../api';

const router = useRouter();
const mode = ref('all');

// 统一模式切换：全览/更新切换本页，漫画更新/卡池管理/JSON对比 跳转对应页面
const viewMode = computed(() => mode.value);
function onModeChange(val) {
  if (val === 'manga') { router.push('/manga'); return; }
  if (val === 'gacha') { router.push('/gacha'); return; }
  if (val === 'icons') { router.push('/icons'); return; }
  if (val === 'json') { router.push('/json-diff'); return; }
  mode.value = val;
}

// 缺头像角标（列表页给个入口，不用专门点头像管理才发现）
const iconBadge = ref({ total: 0 });
async function loadIconBadge() {
  try {
    const r = await getIconsStatus('missing=1');
    iconBadge.value = { total: r.filtered || 0 };
  } catch {}
}
function goIcons(flag) {
  router.push(flag === 'missing' ? '/icons' : '/icons');
}
const students = ref([]);
const stats = ref(null);
const keyword = ref('');
const sortOrder = ref('asc');
const loading = ref(true);
const crawling = ref(false);
const exporting = ref(false);
const revertingId = ref(null);
const crawlDialog = ref(false);
const crawlMode = ref('local');
const skipSet = ref(new Set());

const cloudDiff = ref({ added: [], removed: [], modified: [], cloudAvailable: false });
const logVisible = ref(false);
const logs = ref([]);
const logBox = ref(null);
const expandedId = ref(null);
let es = null;

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id;
}
function fmtVal(v) {
  if (v === undefined || v === null) return '(空)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(空数组)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const publishDialog = ref(false);
const publishPassword = ref('');
const publishing = ref(false);

function starText(grade) {
  return grade ? '★' + grade : '';
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const result = students.value.filter((s) => {
    if (!kw) return true;
    if (String(s.Id_db).includes(kw)) return true;
    if (s.Name_zh_cn && s.Name_zh_cn.toLowerCase().includes(kw)) return true;
    if (s.Name_en && s.Name_en.toLowerCase().includes(kw)) return true;
    if (s.NickName && s.NickName.some((n) => n.toLowerCase().includes(kw))) return true;
    return false;
  });
  return sortOrder.value === 'desc' ? [...result].reverse() : result;
});

const diffList = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const match = (s) => {
    if (!kw) return true;
    if (String(s.Id_db).includes(kw)) return true;
    if (s.Name_zh_cn && s.Name_zh_cn.toLowerCase().includes(kw)) return true;
    if (s.Name_en && s.Name_en.toLowerCase().includes(kw)) return true;
    return false;
  };
  const list = [
    ...cloudDiff.value.added.filter(match).map((s) => ({ student: s, type: 'added' })),
    ...cloudDiff.value.modified.filter((m) => match(m.local)).map((m) => ({ student: m.local, type: 'modified', fields: m.fields })),
    ...cloudDiff.value.removed.filter(match).map((s) => ({ student: s, type: 'removed' })),
    ...(cloudDiff.value.unchanged || []).filter(match).map((s) => ({ student: s, type: 'unchanged' })),
  ];
  return list;
});

async function load() {
  loading.value = true;
  try {
    const [data, skip] = await Promise.all([getStudents(), getSkipList()]);
    students.value = data.students;
    stats.value = data.stats;
    skipSet.value = new Set(skip.skipIds || []);
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function loadCloudDiff() {
  try {
    cloudDiff.value = await getCloudDiff();
  } catch (e) {
    ElMessage.warning('拉取云端数据失败：' + e.message);
  }
}

async function scrollLog() {
  await nextTick();
  if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
}

async function doCrawl() {
  crawlDialog.value = false;
  crawling.value = true;
  logs.value = [];
  logVisible.value = true;
  es = new EventSource('/api/crawl/log');
  es.onmessage = (e) => {
    try {
      const { msg } = JSON.parse(e.data);
      logs.value.push(msg);
      scrollLog();
    } catch {}
  };
  try {
    if (crawlMode.value === 'cloud') {
      await crawlCloud();
      ElMessage.success('云端数据更新完成，正在刷新...');
    } else {
      await crawl();
      ElMessage.success('本地更新完成，正在刷新...');
    }
    await load();
    await loadCloudDiff();
  } catch (e) {
    logs.value.push('❌ 更新失败：' + e.message);
    ElMessage.error('更新失败：' + e.message);
  } finally {
    crawling.value = false;
    es && es.close();
    es = null;
    scrollLog();
  }
}

async function revertStudent(id, mode) {
  const label = mode === 'all' ? '复原此角色到快照' : '除ID外复原此角色到快照';
  try {
    await ElMessageBox.confirm(`确定${mode === 'all' ? '把该角色完全恢复' : '除 ID 外把该角色恢复'}到上一个版本快照吗？`, label, { type: 'warning' });
  } catch {
    return;
  }
  revertingId.value = id;
  try {
    if (mode === 'all') {
      await revertStudentAll(id);
    } else {
      await revertStudentExceptId(id);
    }
    ElMessage.success('已复原');
    expandedId.value = null;
    await load();
    await loadCloudDiff();
  } catch (e) {
    ElMessage.error('复原失败：' + e.message);
  } finally {
    revertingId.value = null;
  }
}

// ===== 发布推送：密码 → 对比预览 → 确认推送 =====
const publishPreviewDialog = ref(false);
const publishPreview = ref(null);
const previewing = ref(false);
const expandedPubFiles = ref(new Set());

// 图片清单与历次记录
const showIconFiles = ref(false);
const iconFileFilter = ref('');
const iconReleases = ref([]);
const iconPublishEnabled = ref(true);

// 数量统计总览（新增/删除/修改的文件数、条目数、字段数）
const pubTotals = computed(() => {
  const files = publishPreview.value?.files || [];
  let added = 0, modified = 0, removed = 0, fields = 0, filesChanged = 0;
  for (const f of files) {
    added += f.added || 0;
    modified += f.modified || 0;
    removed += f.removed || 0;
    for (const m of f.modList || []) fields += (m.fields || []).length;
    if (f.added || f.modified || f.removed || f.isNew) filesChanged++;
  }
  return { added, modified, removed, fields, filesChanged };
});

const filteredIconFiles = computed(() => {
  const list = publishPreview.value?.iconDiff?.files || [];
  const kw = iconFileFilter.value.trim().toLowerCase();
  if (!kw) return list;
  return list.filter((f) => `${f.type}/${f.id}`.toLowerCase().includes(kw) || String(f.id).includes(kw));
});

const iconActionLabel = (a) => ({ add: '新增', modify: '变更', 'cloud-only': '仅云端' }[a] || a);
const iconActionType = (a) => ({ add: 'success', modify: 'warning', 'cloud-only': 'info' }[a] || 'info');

function togglePubFile(fname) {
  const s = new Set(expandedPubFiles.value);
  s.has(fname) ? s.delete(fname) : s.add(fname);
  expandedPubFiles.value = s;
}

async function loadIconReleases() {
  try {
    const r = await getIconReleases();
    iconReleases.value = r.releases || [];
  } catch {}
}

async function doPreviewPublish() {
  if (!publishPassword.value) return ElMessage.warning('请先输入发布密码');
  previewing.value = true;
  publishPreview.value = null;
  try {
    const r = await previewPublish(publishPassword.value);
    publishPreview.value = r;
    // 默认展开有变更的文件
    const s = new Set();
    for (const f of r.files || []) {
      if (f.added || f.modified || f.removed) s.add(f.fname);
    }
    expandedPubFiles.value = s;
    publishDialog.value = false;
    publishPreviewDialog.value = true;
    loadIconReleases();
  } catch (e) {
    ElMessage.error(e.message || '预览失败');
  } finally {
    previewing.value = false;
  }
}

async function doPublish() {
  publishing.value = true;
  try {
    const result = await publish(publishPassword.value, { iconPublish: iconPublishEnabled.value });
    if (result.cosError) {
      ElMessage.warning(`Hash 已生成（${result.hashCount} 个），但 COS 上传出错：${result.cosError}`);
    } else {
      const ic = result.iconResult;
      const iconMsg = ic && !ic.error
        ? `，头像图 ${ic.uploaded} 张（${((ic.bytes || 0) / 1048576).toFixed(1)} MB）`
        : ic?.error
          ? `，头像图上传统计失败：${ic.error}`
          : '';
      ElMessage.success(`发布成功！JSON 已上传 ${result.uploaded} 个文件${iconMsg}`);
      publishPreviewDialog.value = false;
      publishPassword.value = '';
      await load();
      await loadCloudDiff();
      await loadIconBadge();
      await loadIconReleases();
    }
  } catch (e) {
    ElMessage.error('发布失败：' + e.message);
  } finally {
    publishing.value = false;
  }
}

async function doExport() {
  exporting.value = true;
  try {
    const result = await exportJson();
    ElMessage.success(`已导出 ${result.count} 个 JSON 到：\n${result.dir}`);
  } catch (e) {
    ElMessage.error('导出失败：' + e.message);
  } finally {
    exporting.value = false;
  }
}

onMounted(() => {
  load();
  loadCloudDiff();
  loadIconBadge();
});
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}
.page-title h1 {
  margin: 0 0 2px;
  font-size: 26px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--el-color-primary), #7a6ff0);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.stat-chips { display: flex; gap: 8px; }
.stat-chip {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  background: rgba(91, 141, 239, 0.08);
  border: 1px solid rgba(91, 141, 239, 0.2);
}
.stat-chip b { color: var(--el-color-primary); font-size: 16px; margin-right: 4px; }
.stat-chip.warn { background: rgba(248, 113, 113, 0.08); border-color: rgba(248, 113, 113, 0.25); }
.stat-chip.warn b { color: var(--el-color-danger); }
/* 没有缺失时不该报红，用成功色收尾 */
.stat-chip.ok { background: rgba(74, 222, 128, 0.09); border-color: rgba(74, 222, 128, 0.25); }
.stat-chip.ok b { color: var(--el-color-success); }
.top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

/* 发布推送变更预览 */
.pub-preview-body { min-height: 200px; max-height: 64vh; overflow-y: auto; }

/* ① 数量统计总览 */
.pub-summary {
  display: flex; flex-wrap: wrap; gap: 6px 0;
  padding: 10px 14px; border-radius: 12px; margin-bottom: 12px;
  background: var(--el-fill-color-lighter);
}
.pub-summary.icon-summary { margin-bottom: 10px; }
.ps-item {
  flex: 1; min-width: 82px; display: flex; flex-direction: column;
  align-items: center; border-right: 1px solid var(--el-border-color-lighter);
}
.ps-item:last-child { border-right: none; }
.ps-num { font-size: 19px; font-weight: 700; line-height: 1.25; font-variant-numeric: tabular-nums; }
.ps-label { font-size: 12.5px; color: var(--el-text-color-secondary); }
.ps-item.add .ps-num { color: var(--el-color-success); }
.ps-item.mod .ps-num { color: var(--el-color-warning); }
.ps-item.del .ps-num { color: var(--el-color-danger); }
.ps-item.warn .ps-num { color: var(--el-color-warning); }

.pub-section-title {
  display: flex; align-items: center; gap: 6px;
  font-weight: 700; font-size: 16px; margin-bottom: 8px;
}
.pub-section-title .muted { font-weight: 400; font-size: 13.5px; }

/* ③ 图片清单 */
.icon-list-toggle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.icon-filter { width: 170px; }
.icon-file-list {
  max-height: 240px; overflow-y: auto; margin-top: 6px;
  border: 1px solid var(--el-border-color-lighter); border-radius: 10px;
}
.icon-file-line {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 10px; font-size: 13.5px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.icon-file-line:last-child { border-bottom: none; }
.icon-file-line.add { background: rgba(74, 222, 128, 0.06); }
.icon-file-line.modify { background: rgba(251, 191, 36, 0.07); }
.icon-file-line.cloud-only { opacity: 0.6; }
.icon-mini {
  width: 24px; height: 24px; object-fit: cover;
  border-radius: 4px; border: 1px solid var(--el-border-color-lighter);
}

/* ④ 历次发布记录 */
.release-list { display: flex; flex-direction: column; gap: 4px; }
.release-item {
  display: flex; align-items: center; gap: 12px;
  padding: 5px 10px; border-radius: 8px;
  background: var(--el-fill-color-lighter); font-size: 13.5px;
}
.release-ts { font-weight: 600; }

.pub-file-list { display: flex; flex-direction: column; gap: 6px; }
.pub-file-item { border: 1px solid var(--el-border-color-lighter); border-radius: 10px; overflow: hidden; }
.pub-file-head {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  cursor: pointer; background: var(--el-fill-color-light); flex-wrap: wrap;
}
.pub-file-head:hover { background: var(--el-fill-color); }
.pub-caret { transition: transform 0.15s; color: var(--el-text-color-secondary); }
.pub-caret.open { transform: rotate(90deg); }
.pub-fname { font-weight: 600; font-size: 14px; }
.pub-unchanged { font-size: 13.5px; }
.pub-file-detail { padding: 10px 14px; border-top: 1px dashed var(--el-border-color-lighter); }
.pub-detail-sec { margin-bottom: 10px; }
.pub-detail-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.pub-detail-title.add { color: var(--el-color-success); }
.pub-detail-title.mod { color: var(--el-color-warning); }
.pub-detail-title.del { color: var(--el-color-danger); }
.pub-detail-line { font-size: 14px; padding: 2px 0; }
.pub-detail-line.add { color: var(--el-color-success); }
.pub-detail-line.del { color: var(--el-color-danger); }
.pub-line-head { font-weight: 600; display: block; margin: 4px 0 2px; }
.pub-field-line { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12.5px; padding: 1px 0 1px 12px; }
.pub-field-key { min-width: 120px; font-weight: 600; color: var(--el-text-color-regular); }
.pub-old { color: var(--el-color-danger); word-break: break-all; }
.pub-new { color: var(--el-color-success); word-break: break-all; }
.mode-hint { display: flex; align-items: center; gap: 8px; font-size: 14px; flex-wrap: wrap; }
.mb-12 { margin-bottom: 12px; }
.mt-8 { margin-top: 8px; }
.raw-box {
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 8px;
  padding: 14px;
  max-height: 55vh;
  overflow: auto;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.field-diff {
  padding: 14px 16px 16px 52px;
  margin: 6px 10px 10px;
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.diff-line {
  display: flex;
  gap: 12px;
  font-size: 14px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--fmps-subtle-bg);
}
.diff-key {
  font-weight: 600;
  color: var(--el-text-color-primary);
  min-width: 130px;
}
.diff-old {
  color: var(--el-color-danger);
  word-break: break-all;
}
.diff-new {
  color: var(--el-color-success);
  word-break: break-all;
}
.muted { color: var(--el-text-color-secondary); }
.chip { padding: 2px 10px; border-radius: 12px; font-size: 13.5px; font-weight: 500; }
.chip.add { background: rgba(74, 222, 128, 0.15); color: var(--el-color-success); }
.chip.mod { background: rgba(251, 191, 36, 0.15); color: var(--el-color-warning); }
.chip.del { background: rgba(248, 113, 113, 0.15); color: var(--el-color-danger); }
.chip.un { background: rgba(122, 111, 240, 0.12); color: #7a6ff0; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.search { max-width: 320px; }
.spacer { flex: 1; }

/* 列表 */
.list {
  background: var(--fmps-panel-bg);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--fmps-panel-border);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: var(--fmps-panel-shadow);
}
.row {
  position: relative;
  display: grid;
  grid-template-columns: 52px 1.5fr 80px 60px 1fr 1.3fr 1.6fr 80px;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: background 0.12s;
}
.row:last-child { border-bottom: none; }
.row:not(.header):hover { background: var(--el-fill-color-light); }
.row:not(.header):hover::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--el-color-primary);
}
.row.header {
  background: var(--el-fill-color);
  font-size: 14px;
  color: var(--el-text-color-secondary);
  cursor: default;
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color-light);
}
.row.added { background: rgba(74, 222, 128, 0.06); }
.row.modified { background: rgba(251, 191, 36, 0.06); }
.row.removed { background: rgba(248, 113, 113, 0.06); opacity: 0.75; }
.row.skipped { opacity: 0.45; }
.row.skipped .avatar { filter: grayscale(100%); }
.crawl-modes { display: flex; flex-direction: column; gap: 12px; width: 100%; }
.crawl-modes :deep(.el-radio) { height: auto; padding: 14px 16px; margin: 0; }
.mode-title { font-size: 17px; font-weight: 600; }
.mode-desc { font-size: 15px; color: var(--el-text-color-secondary); margin-top: 4px; white-space: normal; }
.diff-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter);
  flex-wrap: wrap;
}

.col-avatar { display: flex; }
.avatar {
  width: 44px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}
.col-name { display: flex; flex-direction: column; min-width: 0; }
.name-cn { font-size: 19px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name-en { font-size: 15px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: monospace; font-size: 16px; color: var(--el-text-color-secondary); }
.star { color: #ffb800; font-size: 17px; font-weight: 600; }
.col-map { font-size: 17px; font-weight: 500; color: var(--el-text-color-regular); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-favor { display: flex; gap: 3px; flex-wrap: wrap; }
.mini-tag { margin: 0; }
.nick { font-size: 16px; color: var(--el-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-status { text-align: center; }

/* 日志 */
.log-box {
  background: #0d1117;
  border-radius: 8px;
  padding: 12px;
  max-height: 50vh;
  overflow-y: auto;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.8;
}
.log-line { color: #c9d1d9; white-space: pre-wrap; word-break: break-all; }
.log-line.dim { color: #8b949e; }

/* 移动端：隐藏次要列 */
@media (max-width: 768px) {
  .row { grid-template-columns: 44px 1.5fr 60px 80px; }
  .col-star, .col-map, .col-favor, .col-nick { display: none; }
}
</style>
