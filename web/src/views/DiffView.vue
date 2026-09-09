<template>
  <div class="diff-page" v-loading="loading">
    <div class="head">
      <div class="back" @click="$router.push('/')">
        <el-icon><ArrowLeft /></el-icon> 返回列表
      </div>
      <h2>数据变更对比</h2>
      <div class="snapshot-info" v-if="diff">
        <template v-if="diff.hasSnapshot">
          <span class="muted">对比快照：</span>{{ diff.snapshotTs }}
        </template>
        <el-alert v-else type="info" :closable="false" title="暂无历史快照，首次爬取后才会产生对比" />
      </div>
    </div>

    <template v-if="diff && diff.hasSnapshot">
      <!-- 统计 -->
      <div class="summary">
        <div class="chip add">新增 {{ diff.added.length }}</div>
        <div class="chip del">删除 {{ diff.removed.length }}</div>
        <div class="chip mod">修改 {{ diff.modified.length }}</div>
      </div>

      <!-- 新增 -->
      <section v-if="diff.added.length" class="sec">
        <h3 class="sec-title add">新增学生（绿）</h3>
        <div class="grid">
          <div v-for="s in diff.added" :key="s.Id_db" class="card add-card" @click="$router.push(`/student/${s.Id_db}`)">
            <img :src="avatarUrl(s.Id_db)" class="avatar" loading="lazy" />
            <div class="info">
              <div class="name">{{ s.Name_zh_cn || s.Name_en }}</div>
              <div class="id">#{{ s.Id_db }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 删除 -->
      <section v-if="diff.removed.length" class="sec">
        <h3 class="sec-title del">删除学生（红）</h3>
        <div class="grid">
          <div v-for="s in diff.removed" :key="s.Id_db" class="card del-card">
            <img :src="avatarUrl(s.Id_db)" class="avatar" loading="lazy" />
            <div class="info">
              <div class="name">{{ s.Name_zh_cn || s.Name_en }}</div>
              <div class="id">#{{ s.Id_db }}</div>
            </div>
          </div>
        </div>
      </section>

      <!-- 修改 -->
      <section v-if="diff.modified.length" class="sec">
        <h3 class="sec-title mod">修改学生（黄）</h3>
        <div class="mod-list">
          <template v-for="m in diff.modified" :key="m.id">
            <div class="mod-item" @click="toggleExpand(m.id)">
              <img :src="avatarUrl(m.id)" class="avatar" loading="lazy" />
              <div class="mod-info">
                <div class="name">{{ m.curr.Name_zh_cn || m.curr.Name_en }} <span class="id">#{{ m.id }}</span></div>
                <div class="changed">
                  <span v-for="f in changedFields(m)" :key="f" class="field-tag">{{ f }}</span>
                </div>
              </div>
            </div>
            <div v-if="expandedId === m.id" class="field-diff">
              <div v-for="f in diffFields(m)" :key="f.key" class="diff-line">
                <span class="diff-key">{{ f.key }}</span>
                <span class="diff-old">- {{ fmtVal(f.prev) }}</span>
                <span class="diff-new">+ {{ fmtVal(f.curr) }}</span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <el-empty v-if="!diff.added.length && !diff.removed.length && !diff.modified.length" description="数据无变化" />
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ArrowLeft } from '@element-plus/icons-vue';
import { getDiff, avatarUrl } from '../api';

const diff = ref(null);
const loading = ref(true);
const expandedId = ref(null);

function toggleExpand(id) {
  expandedId.value = expandedId.value === id ? null : id;
}
function fmtVal(v) {
  if (v === undefined || v === null) return '(空)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(空数组)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function changedFields(m) {
  const keys = new Set([...Object.keys(m.prev), ...Object.keys(m.curr)]);
  const fields = [];
  for (const k of keys) {
    if (JSON.stringify(m.prev[k]) !== JSON.stringify(m.curr[k])) fields.push(k);
  }
  return fields;
}
function diffFields(m) {
  const keys = new Set([...Object.keys(m.prev), ...Object.keys(m.curr)]);
  const fields = [];
  for (const k of keys) {
    if (JSON.stringify(m.prev[k]) !== JSON.stringify(m.curr[k])) {
      fields.push({ key: k, prev: m.prev[k], curr: m.curr[k] });
    }
  }
  return fields;
}

onMounted(async () => {
  try {
    diff.value = await getDiff();
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.head { margin-bottom: 16px; }
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 14px;
  margin-bottom: 8px;
}
.head h2 { margin: 0 0 8px; }
.snapshot-info { font-size: 13px; color: var(--el-text-color-secondary); }
.muted { color: var(--el-text-color-secondary); }
.summary { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
.chip {
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
}
.chip.add { background: rgba(74, 222, 128, 0.15); color: var(--el-color-success); }
.chip.del { background: rgba(248, 113, 113, 0.15); color: var(--el-color-danger); }
.chip.mod { background: rgba(251, 191, 36, 0.15); color: var(--el-color-warning); }
.sec { margin-bottom: 20px; }
.sec-title { font-size: 15px; margin: 0 0 10px; }
.sec-title.add { color: var(--el-color-success); }
.sec-title.del { color: var(--el-color-danger); }
.sec-title.mod { color: var(--el-color-warning); }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 10px;
}
.card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  padding: 10px;
  cursor: pointer;
}
.add-card { border-left: 3px solid var(--el-color-success); }
.del-card { border-left: 3px solid var(--el-color-danger); opacity: 0.7; }
.avatar { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; }
.info { text-align: center; margin-top: 6px; }
.name { font-size: 13px; font-weight: 600; }
.id { font-size: 12px; color: var(--el-text-color-secondary); }
.mod-list { display: flex; flex-direction: column; gap: 8px; }
.mod-item {
  display: flex;
  gap: 10px;
  align-items: center;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-left: 3px solid var(--el-color-warning);
  border-radius: 10px;
  padding: 8px 12px;
  cursor: pointer;
}
.mod-item .avatar { width: 48px; height: 48px; }
.mod-info { flex: 1; }
.changed { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.field-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  font-family: monospace;
}
.field-diff {
  padding: 10px 14px;
  background: rgba(251, 191, 36, 0.06);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.diff-line {
  display: flex;
  gap: 12px;
  font-size: 13px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  flex-wrap: wrap;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
}
.diff-key { font-weight: 600; min-width: 130px; }
.diff-old { color: var(--el-color-danger); word-break: break-all; }
.diff-new { color: var(--el-color-success); word-break: break-all; }
</style>
