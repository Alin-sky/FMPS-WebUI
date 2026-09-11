<template>
  <div class="detail-page" v-loading="loading" @dblclick="onDblClick">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>

    <div class="dbl-hint" v-if="student && !editing">
      <el-icon><Pointer /></el-icon> 双击任意字段可快速进入编辑模式
    </div>

    <template v-if="student">
      <!-- 头部 -->
      <div class="header">
        <img :src="avatarUrl(student.Id_db)" :alt="student.Name_zh_cn" class="big-avatar" />
        <div class="head-info">
          <div class="title">{{ student.Name_zh_cn || '未知' }}</div>
          <div class="sub">
            <el-tag size="small" type="primary">Id_db: {{ student.Id_db }}</el-tag>
            <el-tag size="small" type="info" effect="plain">Id: {{ student.Id }}</el-tag>
            <el-tag v-if="student.isSatellite" size="small" type="warning">卫星角色</el-tag>
            <el-tag v-if="student.complete" size="small" type="success">数据完整</el-tag>
            <el-tag v-else size="small" type="danger">缺失 {{ student.missing.length }} 项</el-tag>
          </div>
        </div>
        <div class="actions">
          <template v-if="!editing">
            <el-button type="primary" @click="startEdit">
              <el-icon><Edit /></el-icon> 编辑
            </el-button>
            <el-button @click="openRaw">
              <el-icon><Document /></el-icon> 原始JSON
            </el-button>
          </template>
          <template v-else>
            <el-button type="success" :loading="saving" @click="save">
              <el-icon><Check /></el-icon> 保存
            </el-button>
            <el-button @click="cancel">取消</el-button>
          </template>
        </div>
      </div>

      <!-- 头像管理（三类，均可单独替换/上传/删除） -->
      <div class="avatar-panel">
        <div class="ap-head">
          <h3>头像</h3>
          <el-button size="small" text type="primary" @click="$router.push('/icons')">
            打开头像管理 <el-icon><ArrowRight /></el-icon>
          </el-button>
        </div>
        <div class="ap-grid">
          <div v-for="t in ICON_TYPES" :key="t.key" class="ap-card">
            <div class="ap-title">
              <span>{{ t.label }}</span>
              <el-tag
                size="small"
                :type="iconMeta[t.key]?.source === 'manual' ? 'warning' : 'info'"
                effect="plain"
              >
                {{ srcShort(iconMeta[t.key]?.source) }}
              </el-tag>
            </div>
            <div class="ap-thumb">
              <img v-if="iconMeta[t.key]?.exists" :src="iconSrc(t, iconMeta[t.key])" :alt="t.label" />
              <div v-else class="ap-missing">缺图</div>
            </div>
            <div class="ap-size">{{ t.size[0] }}×{{ t.size[1] }}</div>
            <div class="ap-btns">
              <el-button size="small" :loading="iconBusy[t.key]" @click="uploadFor(t.key)">上传</el-button>
              <el-button
                size="small"
                :disabled="!iconMeta[t.key]?.exists"
                @click="deleteFor(t.key)"
              >
                删除
              </el-button>
            </div>
          </div>
        </div>
        <div class="ap-note">
          标为「人工」的图不会被自动流程（生成 / 抓取 / COS 同步）覆盖。
        </div>
      </div>

      <el-dialog v-model="rawDialog" :title="`原始 JSON 数据（本角色 #${student.Id_db}，可编辑）`" width="min(720px, 94vw)">
        <div v-loading="rawLoading" class="raw-files">
          <div v-for="(val, fname) in rawData" :key="fname" class="raw-file">
            <div class="raw-fname mono">{{ fname }}</div>
            <el-input
              v-model="rawData[fname]"
              type="textarea"
              :rows="6"
              class="raw-input"
              :placeholder="'(该文件无此角色数据)'"
            />
          </div>
        </div>
        <template #footer>
          <el-button @click="rawDialog = false">取消</el-button>
          <el-button type="primary" :loading="rawSaving" @click="saveRaw">保存</el-button>
        </template>
      </el-dialog>

      <el-alert
        v-if="student.missing.length"
        :title="'以下数据源缺失：' + student.missing.join('、')"
        type="error"
        :closable="false"
        class="missing-alert"
      />

      <!-- 相对云端的变更对比 -->
      <section class="sec" v-if="cloudFields.length">
        <h3>相对云端变更（{{ cloudFields.length }} 项）</h3>
        <div class="diff-line" v-for="f in cloudFields" :key="f.key">
          <span class="diff-key mono">{{ f.key }}</span>
          <span class="diff-old">- {{ fmtVal(f.prev) }}</span>
          <span class="diff-new">+ {{ fmtVal(f.curr) }}</span>
        </div>
      </section>

      <!-- 名称 -->
      <section class="sec">
        <h3>名称</h3>
        <div class="field-grid">
          <div v-for="f in nameFields" :key="f.key" class="field">
            <span class="k">{{ f.label }}</span>
            <el-input v-if="editing" v-model="form[f.key]" size="small" />
            <span v-else class="v">{{ student[f.key] || '—' }}</span>
          </div>
        </div>
      </section>

      <!-- 昵称 -->
      <section class="sec">
        <h3>昵称</h3>
        <el-select
          v-if="editing"
          v-model="form.NickName"
          multiple
          filterable
          allow-create
          default-first-option
          class="full-width"
          placeholder="输入昵称后回车添加"
        />
        <div v-else class="tag-cloud">
          <el-tag v-for="n in (student.NickName || [])" :key="n" effect="plain">{{ n }}</el-tag>
        </div>
      </section>

      <!-- 匹配与好感 -->
      <section class="sec">
        <h3>匹配与好感</h3>
        <div class="field-grid">
          <div class="field">
            <span class="k">Arona 匹配名</span>
            <el-input v-if="editing" v-model="form.MapName" size="small" />
            <span v-else class="v mapname-v">
              <span>{{ student.MapName || '—' }}</span>
              <el-button size="small" text type="primary" :loading="mapNameTesting" @click="testMapName">
                <el-icon><Position /></el-icon> 测试
              </el-button>
            </span>
          </div>
        </div>
        <div v-if="mapNameResult" class="match-result" :class="mapNameResult.exact ? 'hit' : 'miss'">
          <div class="match-head">
            <el-tag size="small" :type="mapNameResult.exact ? 'success' : 'danger'">
              {{ mapNameResult.exact ? '✓ 精确匹配' : '✗ 未精确匹配' }}
            </el-tag>
            <span class="muted">code {{ mapNameResult.code }}{{ mapNameResult.message ? ' · ' + mapNameResult.message : '' }}</span>
          </div>
          <!-- 精确匹配：展示大图（点击可预览） -->
          <div v-if="mapNameResult.exact && mapNameResult.data.length" class="match-imgs">
            <div v-for="(m, idx) in mapNameResult.data.slice(0, 4)" :key="m.name" class="match-card">
              <el-image
                v-if="m.imageUrl"
                :src="m.imageUrl"
                :preview-src-list="matchImgList"
                :initial-index="idx"
                preview-teleported
                fit="cover"
                class="match-img"
              />
              <div class="match-name">{{ m.name }}</div>
            </div>
          </div>
          <!-- 未精确匹配：展示候选（带小图） -->
          <template v-else-if="mapNameResult.data.length">
            <div class="match-hint">阿罗娜返回 {{ mapNameResult.data.length }} 个候选：</div>
            <div class="match-imgs">
              <div v-for="(m, idx) in mapNameResult.data.slice(0, 10)" :key="m.name" class="match-card small">
                <el-image
                  v-if="m.imageUrl"
                  :src="m.imageUrl"
                  :preview-src-list="candidateImgList"
                  :initial-index="idx"
                  preview-teleported
                  fit="cover"
                  class="match-img"
                  @click.stop
                />
                <div class="match-name">{{ m.name }}</div>
                <div class="match-use" @click="applyCandidate(m.name)">点击采用</div>
              </div>
            </div>
          </template>
        </div>
        <div class="tag-row">
          <span class="k">好感标签</span>
          <el-select v-if="editing" v-model="form.FavorItemTags" multiple filterable allow-create default-first-option class="tag-select" placeholder="添加标签" />
          <template v-else>
            <el-tag v-for="t in (student.FavorItemTags || [])" :key="t" type="success" effect="plain">{{ t }}</el-tag>
          </template>
        </div>
        <div class="tag-row">
          <span class="k">专属标签</span>
          <el-select v-if="editing" v-model="form.FavorItemUniqueTags" multiple filterable allow-create default-first-option class="tag-select" placeholder="添加标签" />
          <template v-else>
            <el-tag v-for="t in (student.FavorItemUniqueTags || [])" :key="t" type="warning" effect="plain">{{ t }}</el-tag>
          </template>
        </div>
      </section>

      <!-- 抽卡信息 -->
      <section class="sec">
        <h3>抽卡信息</h3>
        <div class="field-grid">
          <div class="field">
            <span class="k">星级</span>
            <el-input-number v-if="editing" v-model="form.StarGrade" :min="1" :max="5" size="small" />
            <span v-else class="v">{{ student.StarGrade ?? '—' }}</span>
          </div>
          <div class="field">
            <span class="k">限定</span>
            <el-input-number v-if="editing" v-model="form.IsLimited" :min="0" size="small" />
            <span v-else class="v">{{ student.IsLimited ?? '—' }}</span>
          </div>
          <div class="field">
            <span class="k">已实装</span>
            <span class="v" v-if="!editing">
              <el-tag size="small" :type="(student.IsReleased||[])[0] ? 'success' : 'info'" effect="plain">日服</el-tag>
              <el-tag size="small" :type="(student.IsReleased||[])[1] ? 'success' : 'info'" effect="plain">国际服</el-tag>
              <el-tag size="small" :type="(student.IsReleased||[])[2] ? 'success' : 'info'" effect="plain">国服</el-tag>
            </span>
            <span v-else class="v">
              <el-switch v-model="form.IsReleased[0]" active-text="日服" />
              <el-switch v-model="form.IsReleased[1]" active-text="国际服" />
              <el-switch v-model="form.IsReleased[2]" active-text="国服" />
            </span>
          </div>
        </div>
      </section>

      <!-- 好感礼物 -->
      <section class="sec" v-if="student.favorGifts && student.favorGifts.length">
        <h3>好感礼物（{{ student.favorGifts.length }}）</h3>
        <div class="gift-list">
          <div v-for="g in student.favorGifts" :key="g.preId" class="gift">
            <img :src="itemUrl(g.Icon)" :alt="g.giftName" class="gift-img" loading="lazy" />
            <div class="gift-info">
              <div class="gift-name">{{ g.giftName || g.Icon }}</div>
              <div class="gift-meta">
                <span class="gift-id mono">#{{ g.giftId }}</span>
                <el-tag size="small" :type="g.Rarity === 'SSR' ? 'warning' : 'info'">{{ g.Rarity }}</el-tag>
                <span class="gift-count">匹配 {{ g.matchCount }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, Edit, Check, Position, Document, Pointer, ArrowRight } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getStudent, getStudentRaw, updateStudentRaw, updateStudent, avatarUrl, itemUrl, testMatch, getCloudDiff, getStudentIcons, iconViewUrl, uploadIcon, deleteIcon } from '../api';

const route = useRoute();
const student = ref(null);
const loading = ref(true);
const editing = ref(false);
const saving = ref(false);
const form = ref({});
const mapNameTesting = ref(false);
const mapNameResult = ref(null);
const cloudFields = ref([]);
const matchImgList = computed(() =>
  (mapNameResult.value?.data || []).slice(0, 4).map((m) => m.imageUrl).filter(Boolean)
);
const candidateImgList = computed(() =>
  (mapNameResult.value?.data || []).slice(0, 10).map((m) => m.imageUrl).filter(Boolean)
);

const rawDialog = ref(false);
const rawData = ref(null);
const rawLoading = ref(false);
const rawSaving = ref(false);

// ---------- 三类头像（可单独替换/上传/删除） ----------
const ICON_TYPES = [
  { key: 'stu_icon_db_png', label: '基础头像 PNG', size: [200, 226], ext: 'png' },
  { key: 'stu_icon_db', label: '基础头像 JPG', size: [200, 226], ext: 'jpg' },
  { key: 'gacha-img', label: '抽卡头像 PNG', size: [200, 200], ext: 'png' },
];
const iconMeta = ref({});
const iconBusy = ref({});
const iconStamp = ref(Date.now());

const srcShort = (s) => ({ auto: '自动', manual: '人工', cos: 'COS' }[s] || '未知');

function iconSrc(t, meta) {
  // 用 mtime 做版本参数，替换后立即刷新
  return iconViewUrl(t.key, student.value.Id_db, meta?.mtime || iconStamp.value);
}

async function loadIconMeta() {
  if (!student.value) return;
  try {
    const r = await getStudentIcons(student.value.Id_db);
    const out = {};
    for (const t of ICON_TYPES) {
      out[t.key] = r.types?.[t.key] || { exists: false, source: null };
    }
    iconMeta.value = out;
  } catch (e) {
    // 头像状态失败不阻塞详情页
    console.warn('头像状态加载失败：', e.message);
  }
}

async function refreshIcons() {
  iconStamp.value = Date.now();
  await loadIconMeta();
}

function uploadFor(typeKey) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    iconBusy.value = { ...iconBusy.value, [typeKey]: true };
    try {
      await uploadIcon(typeKey, student.value.Id_db, file, '详情页人工上传');
      ElMessage.success('已上传并标记为「人工」，自动流程不会再覆盖');
      await refreshIcons();
    } catch (e) {
      ElMessage.error('上传失败：' + e.message);
    } finally {
      iconBusy.value = { ...iconBusy.value, [typeKey]: false };
    }
  };
  input.click();
}

async function deleteFor(typeKey) {
  try {
    await ElMessageBox.confirm('删除这张头像？删除后需要重新生成或上传。', '确认删除', {
      type: 'warning',
    });
  } catch {
    return;
  }
  iconBusy.value = { ...iconBusy.value, [typeKey]: true };
  try {
    await deleteIcon(typeKey, student.value.Id_db);
    ElMessage.success('已删除');
    await refreshIcons();
  } catch (e) {
    ElMessage.error('删除失败：' + e.message);
  } finally {
    iconBusy.value = { ...iconBusy.value, [typeKey]: false };
  }
}

async function openRaw() {
  rawDialog.value = true;
  rawData.value = null;
  await loadRaw();
}
async function loadRaw() {
  rawLoading.value = true;
  try {
    const result = await getStudentRaw(student.value.Id_db);
    // 转成 JSON 文本（供 textarea 编辑）
    const textMap = {};
    for (const [fname, val] of Object.entries(result.raw)) {
      textMap[fname] = val ? JSON.stringify(val, null, 2) : '';
    }
    rawData.value = textMap;
  } catch (e) {
    ElMessage.error('读取失败：' + e.message);
  } finally {
    rawLoading.value = false;
  }
}
async function saveRaw() {
  rawSaving.value = true;
  try {
    for (const [fname, text] of Object.entries(rawData.value || {})) {
      if (!text.trim()) continue;
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        ElMessage.error(`${fname} 不是合法 JSON`);
        return;
      }
      await updateStudentRaw(student.value.Id_db, fname, data);
    }
    ElMessage.success('原始数据已保存');
    rawDialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    rawSaving.value = false;
  }
}

function fmtVal(v) {
  if (v === undefined || v === null) return '(空)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(空数组)';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function loadCloudFields() {
  try {
    const diff = await getCloudDiff();
    const m = diff.modified.find((x) => x.id === Number(route.params.id));
    cloudFields.value = m ? m.fields : [];
  } catch {}
}

async function testMapName() {
  if (!student.value.MapName) return;
  mapNameTesting.value = true;
  try {
    mapNameResult.value = await testMatch(student.value.MapName);
  } catch (e) {
    ElMessage.error('匹配测试失败：' + e.message);
  } finally {
    mapNameTesting.value = false;
  }
}

async function applyCandidate(name) {
  // 未精确匹配时，点击候选采用该名字作为 MapName 并保存
  try {
    await ElMessageBox.confirm(`把匹配名改为「${name}」并保存？`, '采用候选', { type: 'info' });
  } catch {
    return;
  }
  try {
    await updateStudent(student.value.Id_db, { MapName: name });
    ElMessage.success(`已采用「${name}」`);
    await load();
    // 用新名字重新测试
    mapNameResult.value = await testMatch(name);
  } catch (e) {
    ElMessage.error('采用失败：' + e.message);
  }
}

const nameFields = [
  { key: 'Name_zh_cn', label: '简体名' },
  { key: 'Name_zh_tw', label: '繁体名' },
  { key: 'Name_jp', label: '日文名' },
  { key: 'Name_en', label: '英文名' },
  { key: 'Name_kr', label: '韩文名' },
  { key: 'Name_zh_ft', label: '繁转简' },
  { key: 'FirstName_jp', label: '姓氏(日)' },
  { key: 'FirstName_zh', label: '姓氏(中)' },
];

const editableKeys = [
  ...nameFields.map((f) => f.key),
  'NickName', 'MapName', 'FavorItemTags', 'FavorItemUniqueTags', 'StarGrade', 'IsLimited', 'IsReleased',
];

async function load() {
  loading.value = true;
  try {
    student.value = await getStudent(route.params.id);
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function onDblClick(e) {
  if (editing.value) return;
  if (e.target.closest('.field')) {
    startEdit();
  }
}

function startEdit() {
  form.value = {};
  for (const k of editableKeys) {
    const val = student.value[k];
    if (k === 'IsReleased') {
      form.value[k] = Array.isArray(val) ? [...val] : [false, false, false];
    } else {
      form.value[k] = JSON.parse(JSON.stringify(val ?? (Array.isArray(val) ? [] : '')));
    }
  }
  editing.value = true;
}

function cancel() {  editing.value = false;
  form.value = {};
}

async function save() {
  // 找出修改的字段
  const changes = {};
  for (const k of editableKeys) {
    const before = student.value[k];
    const after = form.value[k];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[k] = after;
    }
  }
  if (Object.keys(changes).length === 0) {
    ElMessage.info('没有修改');
    editing.value = false;
    return;
  }
  saving.value = true;
  try {
    await updateStudent(student.value.Id_db, changes);
    ElMessage.success('保存成功');
    editing.value = false;
    await load();
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await load();
  loadCloudFields();
  loadIconMeta();
  // 支持 ?edit=1 自动进入编辑模式（从更新模式双击跳转）
  if (route.query.edit === '1') {
    startEdit();
  }
});
</script>

<style scoped>
.avatar-panel {
  margin: 16px 0 20px;
  padding: 14px 16px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
}
.ap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.ap-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.ap-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.ap-card {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px;
  background: var(--el-bg-color);
}
.ap-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 14px;
  margin-bottom: 8px;
}
.ap-thumb {
  height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  overflow: hidden;
}
.ap-thumb img {
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
}
.ap-missing {
  font-size: 13.5px;
  color: var(--el-text-color-placeholder);
}
.ap-size {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.ap-btns {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  justify-content: center;
}
.ap-note {
  margin-top: 10px;
  font-size: 13.5px;
  color: var(--el-text-color-secondary);
}
@media (max-width: 720px) {
  .ap-grid {
    grid-template-columns: 1fr;
  }
}

.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--el-color-primary);
  font-size: 15px;
  margin-bottom: 12px;
}
.dbl-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  color: var(--el-color-primary);
  margin-bottom: 12px;
  padding: 8px 14px;
  border-radius: 10px;
  background: rgba(64, 158, 255, 0.1);
  border: 1px dashed rgba(64, 158, 255, 0.35);
  width: fit-content;
}
.header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
  margin-bottom: 20px;
}
.big-avatar {
  width: 120px;
  height: 152px;
  object-fit: cover;
  object-position: center 18%;
  border-radius: 14px;
  border: 1px solid var(--fmps-panel-border);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
}
.head-info { display: flex; flex-direction: column; align-items: center; }
.head-info .sub { justify-content: center; }
.title { font-size: 22px; font-weight: 600; }
.sub { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.actions { display: flex; gap: 8px; }
.missing-alert { margin-bottom: 16px; }
.sections, .sec { display: flex; flex-direction: column; gap: 24px; }
.sec {
  position: relative;
  background: var(--fmps-panel-bg);
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  border: 1px solid var(--fmps-panel-border);
  border-radius: 16px;
  padding: 22px;
  box-shadow: var(--fmps-panel-shadow-lg);
}
/* 渐变边框（毛玻璃质感） */
.sec::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 16px;
  padding: 1.5px;
  background: var(--fmps-ring);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
.sec::after {
  content: '';
  position: absolute;
  top: 0;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(150, 160, 250, 0.7), transparent);
  pointer-events: none;
}
.sec h3 { margin: 0 0 14px; font-size: 17px; font-weight: 600; }
.field-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 17px;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--fmps-card-bg);
  border: 1px solid var(--fmps-card-border);
  box-shadow: var(--fmps-card-shadow);
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.field:hover {
  transform: translateY(-2px);
  border-color: rgba(120, 140, 240, 0.45);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(120, 140, 240, 0.2);
  background: linear-gradient(145deg, rgba(120, 140, 240, 0.1), rgba(120, 140, 240, 0.03));
}
.field .k { color: var(--el-text-color-secondary); flex: 0 0 100px; font-weight: 600; }
.field .v { color: var(--el-text-color-primary); word-break: break-all; }
.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; }
.tag-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
.tag-row .k { color: var(--el-text-color-secondary); font-size: 14px; }
.tag-select { flex: 1; min-width: 240px; }
.full-width { width: 100%; }
.gift-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.gift {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}
.gift-img {
  width: 44px;
  height: 44px;
  object-fit: contain;
  flex: 0 0 auto;
}
.gift-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gift-name { font-size: 13.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gift-meta { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.gift-id { font-size: 12.5px; color: var(--el-text-color-secondary); }
.gift-count { font-size: 12.5px; color: var(--el-text-color-secondary); }
.match-row { display: flex; gap: 10px; }
.match-input { flex: 1; max-width: 420px; }
.match-result {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  font-size: 15px;
}
.match-result.hit { background: rgba(74, 222, 128, 0.1); border: 1px solid rgba(74, 222, 128, 0.25); }
.match-result.miss { background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); }
.match-head { display: flex; align-items: center; gap: 8px; }
.match-hint { font-size: 14px; color: var(--el-text-color-secondary); }
.match-imgs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.match-card {
  background: var(--el-fill-color-light);
  border-radius: 10px;
  overflow: hidden;
  text-align: center;
  border: 1px solid var(--el-border-color-lighter);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.match-card.small { cursor: pointer; }
.match-card.small:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(64, 158, 255, 0.2);
  border-color: var(--el-color-primary);
}
.match-img {
  width: 100%;
  height: 130px;
}
.match-img :deep(img) {
  object-fit: cover;
  object-position: center top;
}
.match-card.small .match-img { height: 100px; }
.match-name { font-size: 14px; font-weight: 600; padding: 6px 4px 2px; }
.match-use { font-size: 12.5px; color: var(--el-color-primary); padding-bottom: 6px; }
.candidate {
  font-size: 14px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
}
.mr-8 { margin-right: 8px; }
.field { font-size: 15px; }
.mapname-v { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mb-12 { margin-bottom: 12px; }
.raw-files { display: flex; flex-direction: column; gap: 16px; }
.raw-file { display: flex; flex-direction: column; gap: 6px; }
.raw-fname {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
  font-family: 'SFMono-Regular', Consolas, monospace;
}
.raw-input :deep(textarea) {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
}
.raw-box {
  background: #0d1117;
  color: #c9d1d9;
  border-radius: 8px;
  padding: 14px;
  max-height: 40vh;
  overflow: auto;
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.diff-line {
  display: flex;
  gap: 12px;
  font-size: 14px;
  font-family: 'SFMono-Regular', Consolas, monospace;
  flex-wrap: wrap;
  padding: 10px 14px;
  margin-bottom: 8px;
  border-radius: 8px;
  background: var(--fmps-subtle-bg);
  border: 1px solid var(--fmps-subtle-border);
  align-items: flex-start;
}
.diff-key { font-weight: 600; color: var(--el-text-color-primary); min-width: 130px; }
.diff-old { color: var(--el-color-danger); word-break: break-all; }
.diff-new { color: var(--el-color-success); word-break: break-all; }
.title { font-size: 24px; }
.sec h3 { font-size: 17px; }
</style>
