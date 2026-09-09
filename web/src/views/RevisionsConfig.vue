<template>
  <div class="rev-page" v-loading="loading">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>
    <div class="head">
      <h2>Arona 匹配名修正表（revisions）</h2>
      <span class="muted">自动生成的匹配名在阿罗娜里匹配不到时，在这里手动指定正确的匹配名</span>
    </div>

    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索 Id_db / 匹配名" clearable :prefix-icon="Search" class="search" />
      <div class="spacer"></div>
      <span class="muted">共 {{ list.length }} 条</span>
      <el-button type="primary" :loading="saving" @click="save">
        <el-icon><Check /></el-icon> 保存
      </el-button>
    </div>

    <div class="list">
      <div class="row header">
        <span class="col-id">Id_db</span>
        <span class="col-map">匹配名（MapName）</span>
        <span class="col-op"></span>
      </div>
      <div v-for="(item, idx) in filtered" :key="idx" class="row">
        <span class="col-id">
          <el-input v-model="item.Id_db" size="small" placeholder="如 10008" />
        </span>
        <span class="col-map">
          <el-input v-model="item.MapName" size="small" placeholder="如 尼禄" />
        </span>
        <span class="col-op">
          <el-button size="small" type="danger" text @click="remove(idx)">删除</el-button>
        </span>
      </div>
      <div class="add-row">
        <el-button text type="primary" @click="add">
          <el-icon><Plus /></el-icon> 添加一条修正
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Check, Search, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getRevisions, saveRevisions } from '../api';

const router = useRouter();
const list = ref([]);
const keyword = ref('');
const loading = ref(true);
const saving = ref(false);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return list.value;
  return list.value.filter((r) =>
    String(r.Id_db).includes(kw) || (r.MapName && r.MapName.toLowerCase().includes(kw))
  );
});

function add() {
  list.value.push({ Id_db: '', MapName: '' });
}
function remove(idx) {
  list.value.splice(idx, 1);
}
async function save() {
  saving.value = true;
  try {
    // 过滤空行 + 规范化 Id_db 为字符串
    const clean = list.value
      .filter((r) => String(r.Id_db).trim() && String(r.MapName).trim())
      .map((r) => ({ Id_db: String(r.Id_db).trim(), MapName: String(r.MapName).trim() }));
    const result = await saveRevisions(clean);
    list.value = clean;
    ElMessage.success(`已保存 ${result.count} 条修正`);
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const result = await getRevisions();
    list.value = result.revisions;
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
.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.search { max-width: 320px; }
.spacer { flex: 1; }
.list {
  background: rgba(30, 31, 43, 0.55);
  backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  overflow: hidden;
}
html:not(.dark) .list {
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.row {
  display: grid;
  grid-template-columns: 200px 1fr 90px;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}
.row:last-of-type { border-bottom: none; }
.row.header { background: var(--el-fill-color); font-size: 14px; color: var(--el-text-color-secondary); font-weight: 600; }
.add-row { padding: 12px 14px; }
</style>
