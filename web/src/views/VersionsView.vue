<template>
  <div class="ver-page" v-loading="loading">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>
    <div class="head">
      <h2>版本管理</h2>
      <span class="muted">每次「发布推送」成功后会自动归档一个版本，这里可以查看每个版本更新了什么，以及复原到某个版本</span>
    </div>

    <el-empty v-if="!loading && versions.length === 0" description="还没有版本归档，去「发布推送」一次后会生成第一个版本" />

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
          <span v-if="v.prevTs" class="muted">相对上一版本 {{ v.prevTs }}</span>
        </div>
        <div v-if="expandedTs === v.ts" class="ver-detail">
          <div v-if="v.added.length" class="detail-group">
            <div class="detail-title add">新增（{{ v.added.length }}）</div>
            <div class="detail-items">
              <span v-for="s in v.added" :key="s.Id_db" class="detail-item">#{{ s.Id_db }} {{ s.Name }}</span>
            </div>
          </div>
          <div v-if="v.modified.length" class="detail-group">
            <div class="detail-title mod">修改（{{ v.modified.length }}）</div>
            <div class="detail-items">
              <span v-for="s in v.modified" :key="s.Id_db" class="detail-item">#{{ s.Id_db }} {{ s.Name }}</span>
            </div>
          </div>
          <div v-if="v.removed.length" class="detail-group">
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
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getVersions, restoreVersion } from '../api';

const router = useRouter();
const versions = ref([]);
const loading = ref(true);
const expandedTs = ref(null);

function toggleExpand(ts) {
  expandedTs.value = expandedTs.value === ts ? null : ts;
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

onMounted(async () => {
  try {
    const result = await getVersions();
    versions.value = result.versions;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});
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
.head { margin-bottom: 14px; }
.head h2 { margin: 0 0 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 15px; }
.ver-list { display: flex; flex-direction: column; gap: 14px; }
.ver-card {
  background: rgba(30, 31, 43, 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 16px 18px;
}
html:not(.dark) .ver-card {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.ver-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.ver-title { display: flex; align-items: center; gap: 8px; }
.ver-ts { font-size: 15px; font-weight: 600; }
.ver-actions { display: flex; gap: 4px; }
.ver-stats { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.chip { font-size: 14px; font-weight: 600; }
.chip.add { color: var(--el-color-success); }
.chip.mod { color: var(--el-color-warning); }
.chip.del { color: var(--el-color-danger); }
.ver-detail { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--el-border-color-lighter); display: flex; flex-direction: column; gap: 12px; }
.detail-title { font-size: 14px; font-weight: 600; margin-bottom: 6px; }
.detail-title.add { color: var(--el-color-success); }
.detail-title.mod { color: var(--el-color-warning); }
.detail-title.del { color: var(--el-color-danger); }
.detail-items { display: flex; flex-wrap: wrap; gap: 6px; }
.detail-item {
  font-size: 13px;
  padding: 3px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
}
</style>
