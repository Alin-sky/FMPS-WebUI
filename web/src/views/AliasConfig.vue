<template>
  <div class="alias-page" v-loading="loading">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>
    <div class="head">
      <h2>别名自动补全配置</h2>
      <span class="muted">自定义换皮类型的「匹配词」和「生成别名」，保存后下次爬取生效</span>
    </div>

    <div class="group-list">
      <div v-for="(g, i) in groups" :key="i" class="group-card">
        <div class="group-header">
          <span class="group-title">类型 {{ i + 1 }}</span>
          <el-button type="danger" text size="small" @click="removeGroup(i)">删除</el-button>
        </div>
        <div class="row">
          <span class="k">匹配词（名字括号里的文本）</span>
          <el-select
            v-model="g.match"
            multiple
            filterable
            allow-create
            default-first-option
            class="sel"
            placeholder="输入后回车添加"
          />
        </div>
        <div class="row">
          <span class="k">生成别名</span>
          <el-select
            v-model="g.alias"
            multiple
            filterable
            allow-create
            default-first-option
            class="sel"
            placeholder="输入后回车添加"
          />
        </div>
      </div>
    </div>

    <div class="actions">
      <el-button @click="addGroup">
        <el-icon><Plus /></el-icon> 添加类型
      </el-button>
      <el-button type="primary" :loading="saving" @click="save">
        <el-icon><Check /></el-icon> 保存
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ArrowLeft, Plus, Check } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getAliasConfig, saveAliasConfig } from '../api';

const groups = ref([]);
const loading = ref(true);
const saving = ref(false);

function addGroup() {
  groups.value.push({ match: [], alias: [] });
}

function removeGroup(i) {
  groups.value.splice(i, 1);
}

async function save() {
  // 过滤空组
  const cleaned = groups.value.filter((g) => g.match.length > 0 && g.alias.length > 0);
  if (cleaned.length === 0) {
    ElMessage.warning('至少保留一个有效类型');
    return;
  }
  saving.value = true;
  try {
    await saveAliasConfig(cleaned);
    groups.value = cleaned;
    ElMessage.success('已保存，下次爬取生效');
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await getAliasConfig();
    groups.value = data.groups;
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
.head { margin-bottom: 16px; }
.head h2 { margin: 0 0 4px; }
.muted { color: var(--el-text-color-secondary); font-size: 13px; }
.group-list { display: flex; flex-direction: column; gap: 12px; }
.group-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  padding: 14px 16px;
}
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.group-title { font-weight: 600; font-size: 14px; }
.row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.row .k { color: var(--el-text-color-secondary); font-size: 13px; flex: 0 0 auto; }
.sel { flex: 1; min-width: 260px; }
.actions { display: flex; gap: 10px; margin-top: 16px; }
</style>
