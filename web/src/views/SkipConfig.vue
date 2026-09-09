<template>
  <div class="skip-page" v-loading="loading">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>
    <div class="head">
      <h2>跳过爬取配置</h2>
      <span class="muted">勾选同一角色的不同形态，爬取生成时将完全跳过这些学生（不写入任何 JSON 文件，不爬取其任何数据）</span>
    </div>

    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索名字 / Id_db" clearable :prefix-icon="Search" class="search" />
      <div class="spacer"></div>
      <span class="muted">已选 {{ skipSet.size }} 个</span>
      <el-button type="primary" :loading="saving" @click="save">
        <el-icon><Check /></el-icon> 保存
      </el-button>
    </div>

    <div class="list">
      <div class="row header">
        <span class="col-check"></span>
        <span class="col-name">名字</span>
        <span class="col-id">Id</span>
        <span class="col-star">星级</span>
      </div>
      <div v-for="s in filtered" :key="s.Id_db" class="row" @click="toggle(s.Id_db)">
        <span class="col-check">
          <el-checkbox :model-value="skipSet.has(s.Id_db)" @click.stop="toggle(s.Id_db)" />
        </span>
        <span class="col-name">
          <span class="name-cn">{{ s.Name_zh_cn || s.Name_en }}</span>
        </span>
        <span class="col-id mono">#{{ s.Id_db }}</span>
        <span class="col-star star">{{ s.StarGrade ? '★' + s.StarGrade : '' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ArrowLeft, Check, Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getStudents, getSkipList, saveSkipList } from '../api';

const router = useRouter();
const students = ref([]);
const skipSet = ref(new Set());
const keyword = ref('');
const loading = ref(true);
const saving = ref(false);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return students.value;
  return students.value.filter((s) =>
    String(s.Id_db).includes(kw) || (s.Name_zh_cn && s.Name_zh_cn.toLowerCase().includes(kw))
  );
});

function toggle(id) {
  const set = new Set(skipSet.value);
  set.has(id) ? set.delete(id) : set.add(id);
  skipSet.value = set;
}

async function save() {
  saving.value = true;
  try {
    await saveSkipList([...skipSet.value]);
    ElMessage.success('已保存跳过配置');
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const [data, skip] = await Promise.all([getStudents(), getSkipList()]);
    students.value = data.students;
    skipSet.value = new Set(skip.skipIds);
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
  font-size: 14px;
  margin-bottom: 10px;
}
.head { margin-bottom: 14px; }
.head h2 { margin: 0 0 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 13px; }
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
  grid-template-columns: 48px 1.5fr 90px 70px;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
}
.row:last-child { border-bottom: none; }
.row:hover { background: var(--el-fill-color-light); }
.row.header { background: var(--el-fill-color); font-size: 13px; color: var(--el-text-color-secondary); cursor: default; font-weight: 600; }
.name-cn { font-size: 15px; font-weight: 600; }
.mono { font-family: monospace; font-size: 13px; color: var(--el-text-color-secondary); }
.star { color: #ffb800; }
</style>
