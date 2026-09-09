<template>
  <div class="diff-page">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>

    <div class="head">
      <h2>JSON 对比模式</h2>
      <span class="muted">对比本地与云端（COS）的 JSON 更改，红色 = 删除，绿色 = 新增</span>
    </div>

    <!-- 文件选择 + 操作 -->
    <div class="toolbar glass">
      <el-select v-model="fname" placeholder="选择 JSON 文件" class="file-select">
        <el-option v-for="f in fileList" :key="f" :label="f" :value="f" />
      </el-select>
      <el-button type="primary" :loading="comparing" @click="doCompare">
        <el-icon><Switch /></el-icon> 开始对比
      </el-button>
      <div class="spacer"></div>
      <template v-if="result">
        <span class="chip add">+{{ result.added }}</span>
        <span class="chip mod">~{{ result.modified }}</span>
        <span class="chip del">-{{ result.removed }}</span>
      </template>
    </div>

    <!-- 对比结果 -->
    <div v-loading="comparing" class="result-wrap">
      <el-empty v-if="!result && !comparing" description="选择文件后点击「开始对比」" />

      <template v-if="result">
        <!-- 新增项（绿色） -->
        <section v-if="result.addList.length" class="sec">
          <h3 class="sec-title add">新增（{{ result.addList.length }}）</h3>
          <div v-for="(item, i) in result.addList" :key="'a' + i" class="diff-block add">
            <div class="diff-block-head">
              <span class="diff-tag add">+ 新增</span>
              <span class="mono muted">{{ itemKey(item) }}</span>
            </div>
            <pre class="json-pre mono">{{ pretty(item) }}</pre>
          </div>
        </section>

        <!-- 修改项（字段级红绿对比） -->
        <section v-if="result.modList.length" class="sec">
          <h3 class="sec-title mod">修改（{{ result.modList.length }}）</h3>
          <div v-for="(item, i) in result.modList" :key="'m' + i" class="diff-block mod">
            <div class="diff-block-head">
              <span class="diff-tag mod">~ 修改</span>
              <span class="mono muted">{{ itemKey(item.local) }}</span>
            </div>
            <div v-for="f in item.fields" :key="f.key" class="field-diff-line">
              <span class="diff-key mono">{{ f.key }}</span>
              <span class="diff-old">- {{ fmtVal(f.prev) }}</span>
              <span class="diff-new">+ {{ fmtVal(f.curr) }}</span>
            </div>
          </div>
        </section>

        <!-- 删除项（红色） -->
        <section v-if="result.delList.length" class="sec">
          <h3 class="sec-title del">删除（{{ result.delList.length }}）</h3>
          <div v-for="(item, i) in result.delList" :key="'d' + i" class="diff-block del">
            <div class="diff-block-head">
              <span class="diff-tag del">- 删除</span>
              <span class="mono muted">{{ itemKey(item) }}</span>
            </div>
            <pre class="json-pre mono">{{ pretty(item) }}</pre>
          </div>
        </section>

        <el-empty v-if="!result.addList.length && !result.modList.length && !result.delList.length" description="本地与云端完全一致" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ArrowLeft, Switch } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getRawJsonFile, getCloudJsonFile } from '../api';

const fileList = [
  'sms_studata_main.json',
  'sms_studata_toaro_stu.json',
  'favor_stu_tap.json',
  'favora_data.json',
  'gacha_data.json',
  'liwu_list_rep.json',
  'khrtalk_satellite.json',
  'sms_othersmatchlib.json',
  'sms_to_arona_data_revisions.json',
  'manga_main.json',
  'map_guide_shangxue.json',
];

const fname = ref(fileList[0]);
const comparing = ref(false);
const result = ref(null);

// 不同文件的主键字段
function primaryKey(fname) {
  if (fname === 'gacha_data.json') return 'id';
  if (fname === 'favora_data.json') return 'stuid';
  if (fname === 'sms_studata_main.json' || fname === 'sms_studata_toaro_stu.json' || fname === 'khrtalk_satellite.json') return 'Id_db';
  if (fname === 'sms_studata_toaro_stu.json') return 'Id_db';
  return 'id';
}

function itemKey(item) {
  if (!item || typeof item !== 'object') return '(标量)';
  for (const k of ['Id_db', 'id', 'stuid']) {
    if (item[k] !== undefined) return `#${item[k]}`;
  }
  return JSON.stringify(item).slice(0, 40);
}

function pretty(item) {
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
}

function fmtVal(v) {
  if (v === undefined || v === null) return '(空)';
  if (Array.isArray(v)) return v.length ? JSON.stringify(v) : '(空数组)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function fieldDiff(prev, curr) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  const fields = [];
  for (const k of keys) {
    const p = JSON.stringify(prev?.[k]);
    const c = JSON.stringify(curr?.[k]);
    if (p !== c) fields.push({ key: k, prev: prev?.[k], curr: curr?.[k] });
  }
  return fields;
}

async function doCompare() {
  if (!fname.value) return ElMessage.warning('请先选择文件');
  comparing.value = true;
  result.value = null;
  try {
    const [localRes, cloudRes] = await Promise.all([
      getRawJsonFile(fname.value),
      getCloudJsonFile(fname.value),
    ]);
    let local = localRes.data;
    let cloud = cloudRes.data;
    const key = primaryKey(fname.value);

    // gacha_data.json 是 [meta, [students]] 结构
    if (fname.value === 'gacha_data.json') {
      local = Array.isArray(local) ? local[1] : local;
      cloud = Array.isArray(cloud) ? cloud[1] : cloud;
    }
    if (!Array.isArray(local) || !Array.isArray(cloud)) {
      // 非标量数组：直接文本 diff
      const localText = JSON.stringify(local, null, 2);
      const cloudText = JSON.stringify(cloud, null, 2);
      if (localText === cloudText) {
        result.value = { added: 0, removed: 0, modified: 0, addList: [], modList: [], delList: [] };
      } else {
        result.value = {
          added: 0, removed: 0, modified: 1,
          addList: [],
          modList: [{ local, cloud, fields: [{ key: '(整体)', prev: cloud, curr: local }] }],
          delList: [],
        };
      }
      return;
    }

    const localMap = new Map(local.map((s) => [s?.[key], s]));
    const cloudMap = new Map(cloud.map((s) => [s?.[key], s]));
    const addList = [];
    const delList = [];
    const modList = [];
    for (const [k, s] of localMap) {
      if (!cloudMap.has(k)) addList.push(s);
      else if (JSON.stringify(cloudMap.get(k)) !== JSON.stringify(s)) {
        modList.push({ local: s, cloud: cloudMap.get(k), fields: fieldDiff(cloudMap.get(k), s) });
      }
    }
    for (const [k, s] of cloudMap) {
      if (!localMap.has(k)) delList.push(s);
    }
    result.value = {
      added: addList.length,
      removed: delList.length,
      modified: modList.length,
      addList, modList, delList,
    };
  } catch (e) {
    ElMessage.error('对比失败：' + e.message);
  } finally {
    comparing.value = false;
  }
}
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
.head { margin-bottom: 16px; }
.head h2 { margin: 0 0 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 14px; }

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.file-select { width: 260px; }
.spacer { flex: 1; }
.chip { font-size: 15px; font-weight: 700; }
.chip.add { color: var(--el-color-success); }
.chip.mod { color: var(--el-color-warning); }
.chip.del { color: var(--el-color-danger); }

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

.sec { margin-bottom: 18px; }
.sec-title { margin: 0 0 10px; font-size: 16px; }
.sec-title.add { color: var(--el-color-success); }
.sec-title.mod { color: var(--el-color-warning); }
.sec-title.del { color: var(--el-color-danger); }

.diff-block {
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 10px;
  border: 1px solid transparent;
}
.diff-block.add { background: rgba(74, 222, 128, 0.09); border-color: rgba(74, 222, 128, 0.35); }
.diff-block.del { background: rgba(248, 113, 113, 0.09); border-color: rgba(248, 113, 113, 0.35); }
.diff-block.mod { background: rgba(251, 191, 36, 0.08); border-color: rgba(251, 191, 36, 0.3); }

.diff-block-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.diff-tag { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
.diff-tag.add { background: rgba(74, 222, 128, 0.2); color: var(--el-color-success); }
.diff-tag.mod { background: rgba(251, 191, 36, 0.2); color: var(--el-color-warning); }
.diff-tag.del { background: rgba(248, 113, 113, 0.2); color: var(--el-color-danger); }

.json-pre {
  margin: 0;
  font-size: 12.5px;
  max-height: 200px;
  overflow: auto;
  background: var(--el-fill-color);
  border-radius: 8px;
  padding: 10px;
}
.mono { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; }

.field-diff-line {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 4px 0;
  border-bottom: 1px dashed var(--el-border-color-lighter);
  flex-wrap: wrap;
}
.diff-key { min-width: 150px; font-weight: 600; font-size: 13px; }
.diff-old { color: var(--el-color-danger); font-size: 13px; word-break: break-all; }
.diff-new { color: var(--el-color-success); font-size: 13px; word-break: break-all; }
</style>
