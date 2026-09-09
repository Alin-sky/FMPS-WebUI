<template>
  <div class="gacha-page">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>

    <div class="head">
      <div class="head-left">
        <h2>卡池管理模式</h2>
        <span class="muted">编辑 gacha_data.json 的当前卡池（各服 PickUp 学生 / FES / 复刻时间），保存后随「发布推送」同步到云端生效</span>
      </div>
      <div class="head-actions">
        <el-button :loading="loading" @click="load">重新读取</el-button>
        <el-button type="primary" plain :loading="autoLoading" @click="doAutoCrawl">
          <el-icon><MagicStick /></el-icon> 自动爬取卡池
        </el-button>
        <el-button type="success" :loading="saving" @click="doSave">
          <el-icon><Check /></el-icon> 保存卡池
        </el-button>
      </div>
    </div>

    <!-- 三服卡池卡片 -->
    <div class="server-grid" v-loading="loading">
      <div v-for="sv in SERVERS" :key="sv.key" class="server-card glass">
        <div class="server-head">
          <h3>{{ sv.label }}</h3>
          <div class="server-fes">
            <span class="fes-label">FES</span>
            <el-switch v-model="pool['fes_' + sv.key]" />
          </div>
          <el-tag :type="statusType(sv.key)" size="small" effect="plain">{{ statusText(sv.key) }}</el-tag>
        </div>

        <!-- 复刻时间 -->
        <div class="server-time">
          <el-date-picker
            v-model="timeRange[sv.key][0]"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="开始时间"
            class="time-picker"
          />
          <span class="muted">至</span>
          <el-date-picker
            v-model="timeRange[sv.key][1]"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="结束时间"
            class="time-picker"
          />
        </div>

        <!-- PickUp 学生多选 -->
        <el-select
          v-model="pool['now_pick_' + sv.key]"
          multiple
          filterable
          clearable
          placeholder="选择 PickUp 学生（可搜索名字 / 拼音 / Id）"
          class="pick-select"
          :loading="loading"
        >
          <el-option
            v-for="s in students"
            :key="s.id"
            :value="s.id"
            :label="`${s.name} (#${s.id})`"
          >
            <span class="opt-name">{{ s.name }}</span>
            <span class="muted opt-meta">#{{ s.id }}
              <template v-if="s.star">· {{ '★'.repeat(Math.min(s.star, 5)) }}</template>
              <template v-if="s.limited && s.limited !== 0">· 限定</template>
            </span>
          </el-option>
        </el-select>

        <!-- 已选学生卡片 -->
        <div class="picked-list">
          <div v-for="id in pool['now_pick_' + sv.key]" :key="id" class="picked-item">
            <img :src="avatarUrl(id)" class="picked-avatar" loading="lazy" @error="onAvatarErr" />
            <span class="picked-name">{{ studentName(id) }}</span>
            <span class="picked-id mono">#{{ id }}</span>
          </div>
          <div v-if="!(pool['now_pick_' + sv.key] || []).length" class="picked-empty muted">尚未选择 PickUp 学生</div>
        </div>
      </div>
    </div>

    <!-- 自动爬取结果弹窗 -->
    <el-dialog v-model="autoDialog" title="自动爬取结果（gamekee 卡池页面）" width="min(760px, 94vw)" top="4vh" append-to-body>
      <div v-loading="autoLoading" class="auto-body">
        <template v-if="autoResult && !autoLoading">
          <el-alert
            type="info" :closable="false" class="mb-12"
            title="以下为从 gamekee 卡池页面解析出的当前卡池。点击「应用到表单」填充下方编辑区（时间的小时/分钟为各服惯例值，可手动修正），确认无误后再手动「保存卡池」。"
          />
          <el-alert v-if="autoResult.warnings && autoResult.warnings.length" type="warning" :closable="false" class="mb-12">
            <div v-for="(w, i) in autoResult.warnings" :key="i">{{ w }}</div>
          </el-alert>
          <div v-for="sv in SERVERS" :key="'auto-' + sv.key" class="auto-server">
            <div class="auto-server-head">
              <h4>{{ sv.label }}</h4>
              <el-tag v-if="autoResult.servers[sv.key]" size="small" effect="plain" :type="autoStatus(sv.key)">
                {{ (autoResult.servers[sv.key].start || '').slice(0, 10) }} ~ {{ (autoResult.servers[sv.key].end || '').slice(0, 10) }}
              </el-tag>
              <el-tag v-if="autoResult.servers[sv.key] && autoResult.servers[sv.key].fes" size="small" type="warning">FES</el-tag>
            </div>
            <template v-if="autoResult.servers[sv.key]">
              <div class="auto-names">
                <span v-for="id in autoResult.servers[sv.key].ids" :key="id" class="auto-chip ok">{{ studentName(id) }} <span class="mono muted">#{{ id }}</span></span>
                <span v-for="n in autoResult.servers[sv.key].unmatched" :key="'u-' + n" class="auto-chip bad">{{ n }}（未匹配）</span>
              </div>
              <div class="muted auto-raw">原文：{{ autoResult.servers[sv.key].raw }}</div>
            </template>
            <div v-else class="muted auto-raw">（该服解析失败）</div>
          </div>
        </template>
        <el-empty v-else-if="!autoLoading" description="点击下方按钮开始爬取" />
      </div>
      <template #footer>
        <el-button @click="autoDialog = false">关闭</el-button>
        <el-button :loading="autoLoading" @click="doAutoCrawl">重新爬取</el-button>
        <el-button type="primary" :disabled="!autoResult || !Object.keys(autoResult.servers || {}).length" @click="applyAutoResult">应用到表单</el-button>
      </template>
    </el-dialog>

    <!-- JSON 预览 -->
    <div class="gen-json glass">
      <div class="gen-head">
        <span class="gen-title">生成结果预览（gacha_data.json → [0]，键名与接收端 ba-plugin 一致）</span>
        <el-button size="small" text type="primary" @click="copyJson">复制 JSON</el-button>
      </div>
      <pre class="json-preview mono">{{ jsonPreview }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ArrowLeft, Check, MagicStick } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getGacha, saveGacha, autoGacha, avatarUrl } from '../api';

const SERVERS = [
  { key: 'cn', label: '国服 CN' },
  { key: 'jp', label: '日服 JP' },
  { key: 'in', label: '国际服 IN' },
];

const loading = ref(true);
const saving = ref(false);
const students = ref([]);
const extraPools = ref([]); // pools[1:] 原样保留
const pool = reactive({
  now_pick_cn: [], fes_cn: false, pick_cn_time: [],
  now_pick_jp: [], fes_jp: false, pick_jp_time: [],
  now_pick_in: [], fes_in: false, pick_in_time: [],
});
// 时间选择器值（无时区后缀，保存时补 +08:00）
const timeRange = reactive({
  cn: [null, null],
  jp: [null, null],
  in: [null, null],
});

const studentMap = computed(() => new Map(students.value.map((s) => [s.id, s])));
function studentName(id) {
  const s = studentMap.value.get(Number(id));
  return s ? s.name : `未知(#${id})`;
}

// 时间字符串处理：库格式 2025-07-03T14:00:00+08:00 ↔ 选择器格式 2025-07-03T14:00:00
function stripTz(t) {
  return (t || '').replace(/\+08:00$/, '').replace(/Z$/, '');
}
function addTz(t) {
  if (!t) return t;
  return /[+Z]/.test(t) ? t : `${t}+08:00`;
}

function applyPool(p) {
  for (const sv of SERVERS) {
    pool['now_pick_' + sv.key] = (p && p['now_pick_' + sv.key] || []).map(Number);
    pool['fes_' + sv.key] = !!(p && p['fes_' + sv.key]);
    const t = (p && p['pick_' + sv.key + '_time']) || [];
    timeRange[sv.key][0] = t[0] ? stripTz(t[0]) : null;
    timeRange[sv.key][1] = t[1] ? stripTz(t[1]) : null;
  }
}

// 组装保存用的 pools[0]
function buildPool0() {
  const out = {};
  for (const sv of SERVERS) {
    out['now_pick_' + sv.key] = (pool['now_pick_' + sv.key] || []).map(Number);
    out['fes_' + sv.key] = !!pool['fes_' + sv.key];
    out['pick_' + sv.key + '_time'] = [addTz(timeRange[sv.key][0]), addTz(timeRange[sv.key][1])];
  }
  return out;
}

const jsonPreview = computed(() => {
  return JSON.stringify([buildPool0()], null, 2);
});

// 卡池状态
function statusText(key) {
  const s = timeRange[key][0];
  const e = timeRange[key][1];
  if (!s || !e) return '未设置';
  const now = Date.now();
  const start = new Date(s + '+08:00').getTime();
  const end = new Date(e + '+08:00').getTime();
  if (now < start) return '未开始';
  if (now > end) return '已结束';
  return '进行中';
}
function statusType(key) {
  const t = statusText(key);
  return t === '进行中' ? 'success' : t === '未开始' ? 'info' : t === '已结束' ? 'danger' : 'warning';
}

async function load() {
  loading.value = true;
  try {
    const r = await getGacha();
    students.value = r.students || [];
    const pools = r.pools || [];
    applyPool(pools[0] || null);
    extraPools.value = pools.slice(1);
  } catch (e) {
    ElMessage.error('读取卡池失败：' + e.message);
  } finally {
    loading.value = false;
  }
}

async function doSave() {
  // 校验：设置了学生就必须设置时间，反之亦然
  for (const sv of SERVERS) {
    const picks = pool['now_pick_' + sv.key] || [];
    const hasTime = timeRange[sv.key][0] && timeRange[sv.key][1];
    if (picks.length && !hasTime) {
      return ElMessage.warning(`${sv.label}：已选择 PickUp 学生但未设置完整时间`);
    }
    if (hasTime && timeRange[sv.key][0] >= timeRange[sv.key][1]) {
      return ElMessage.warning(`${sv.label}：开始时间必须早于结束时间`);
    }
  }
  try {
    await ElMessageBox.confirm('将保存当前卡池配置到 gacha_data.json（可通过「发布推送」同步到 COS）。确认保存？', '保存卡池', {
      type: 'info', confirmButtonText: '确认保存', cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  saving.value = true;
  try {
    await saveGacha([buildPool0(), ...extraPools.value]);
    ElMessage.success('卡池已保存');
    await load();
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    saving.value = false;
  }
}

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonPreview.value);
    ElMessage.success('已复制卡池 JSON');
  } catch {
    ElMessage.error('复制失败');
  }
}

function onAvatarErr(e) {
  e.target.style.visibility = 'hidden';
}

// ===== 自动爬取卡池（gamekee） =====
const autoDialog = ref(false);
const autoLoading = ref(false);
const autoResult = ref(null);

function autoStatus(key) {
  const d = autoResult.value && autoResult.value.servers[key];
  if (!d) return 'info';
  const now = Date.now();
  const s = new Date(d.start).getTime();
  const e = new Date(d.end).getTime();
  if (now < s) return 'info';
  if (now > e) return 'danger';
  return 'success';
}

async function doAutoCrawl() {
  autoLoading.value = true;
  autoResult.value = null;
  autoDialog.value = true;
  try {
    const r = await autoGacha();
    autoResult.value = r;
    if (!Object.keys(r.servers || {}).length) {
      ElMessage.warning('三服均解析失败，请查看警告信息');
    }
  } catch (e) {
    ElMessage.error('自动爬取失败：' + e.message);
  } finally {
    autoLoading.value = false;
  }
}

// 应用爬取结果到编辑表单（不直接保存，用户确认后手动保存）
function applyAutoResult() {
  const servers = (autoResult.value && autoResult.value.servers) || {};
  let applied = 0;
  let unmatched = 0;
  for (const sv of SERVERS) {
    const d = servers[sv.key];
    if (!d) continue;
    applied++;
    unmatched += (d.unmatched || []).length;
    pool['now_pick_' + sv.key] = [...(d.ids || [])];
    pool['fes_' + sv.key] = !!d.fes;
    if (d.start) timeRange[sv.key][0] = d.start.replace('+08:00', '');
    if (d.end) timeRange[sv.key][1] = d.end.replace('+08:00', '');
  }
  autoDialog.value = false;
  if (unmatched > 0) {
    ElMessage.warning(`已填充 ${applied} 个服务器（有 ${unmatched} 个名字未匹配到学生，请手动补选）`);
  } else {
    ElMessage.success(`已填充 ${applied} 个服务器的卡池，确认无误后点击「保存卡池」`);
  }
}

onMounted(load);
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
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; }

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

.server-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}
.server-card { border-radius: 14px; padding: 16px 18px; }
.server-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.server-head h3 { margin: 0; font-size: 17px; flex: 1; }
.server-fes { display: flex; align-items: center; gap: 6px; }
.fes-label { font-size: 13px; font-weight: 700; color: var(--el-color-warning); }

.server-time { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.time-picker { width: 200px; }

.pick-select { width: 100%; margin-bottom: 12px; }
.opt-name { font-weight: 600; }
.opt-meta { font-size: 12px; margin-left: 8px; }

.picked-list { display: flex; flex-wrap: wrap; gap: 8px; }
.picked-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
}
.picked-avatar {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--el-fill-color);
}
.picked-name { font-weight: 600; font-size: 14px; }
.picked-id { font-size: 12px; color: var(--el-text-color-secondary); }
.picked-empty { font-size: 13px; }

/* 自动爬取弹窗 */
.auto-body { min-height: 160px; max-height: 64vh; overflow-y: auto; }
.auto-server { margin-bottom: 14px; padding: 12px 14px; border-radius: 12px; background: var(--el-fill-color-light); }
.auto-server-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.auto-server-head h4 { margin: 0; font-size: 15px; flex: 1; }
.auto-names { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.auto-chip { padding: 3px 10px; border-radius: 8px; font-size: 13px; }
.auto-chip.ok { background: rgba(74, 222, 128, 0.12); color: var(--el-color-success); }
.auto-chip.bad { background: rgba(248, 113, 113, 0.12); color: var(--el-color-danger); }
.auto-raw { font-size: 12px; word-break: break-all; }

.gen-json { border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
.gen-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 10px; flex-wrap: wrap; }
.gen-title { font-weight: 600; font-size: 15px; }
.json-preview {
  background: var(--el-fill-color);
  border-radius: 10px;
  padding: 12px;
  max-height: 340px;
  overflow: auto;
  font-size: 13px;
  margin: 0;
}
.mono { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; }
</style>
