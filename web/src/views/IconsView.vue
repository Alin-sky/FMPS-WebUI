<template>
  <div class="icons-page">
    <div class="back" @click="$router.push('/')">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </div>

    <div class="head">
      <div class="head-left">
        <h2>头像管理</h2>
        <span class="muted">
          三类头像的缺失检测 / 自动获取 / 人工补充 / 发布上传。本地目录
          <code>server/data/img/{{ '{stu_icon_db_png,stu_icon_db,gacha-img}' }}/</code>，与 COS key 一一对应。
        </span>
      </div>
      <div class="head-actions">
        <el-button :loading="loading" @click="load">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <el-dropdown trigger="click" @command="onMetaCmd">
          <el-button plain>
            <el-icon><Setting /></el-icon> 高级
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="meta">查看/编辑来源元数据 JSON</el-dropdown-item>
              <el-dropdown-item command="verify">全量校验（本地 ↔ COS ↔ wikiru）</el-dropdown-item>
              <el-dropdown-item command="wikiru-preview">wikiru 映射预览（不下载）</el-dropdown-item>
              <el-dropdown-item command="cos-inventory">COS 存量盘点</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <!-- 统计条 -->
    <div class="stat-bar glass">
      <div class="stat">
        <span class="stat-num">{{ overview.total || 0 }}</span>
        <span class="stat-label">学生总数</span>
      </div>
      <!-- 值为 0 时统一降为中性灰：零不该用橙色/红色报警，否则一眼看过去全是"异常" -->
      <div class="stat ok" :class="{ zero: !overview.completeCount }">
        <span class="stat-num">{{ overview.completeCount || 0 }}</span>
        <span class="stat-label">三类齐全</span>
      </div>
      <div class="stat warn" :class="{ zero: !overview.partialCount }">
        <span class="stat-num">{{ overview.partialCount || 0 }}</span>
        <span class="stat-label">部分缺失</span>
      </div>
      <div class="stat bad" :class="{ zero: !overview.emptyCount }">
        <span class="stat-num">{{ overview.emptyCount || 0 }}</span>
        <span class="stat-label">全部缺失</span>
      </div>
      <div class="stat" v-for="t in typeList" :key="'st-' + t.key">
        <span class="stat-num">{{ overview.inventory?.[t.key]?.count ?? 0 }}</span>
        <span class="stat-label">{{ t.label }}<br /><span class="muted">{{ overview.inventory?.[t.key]?.mb ?? 0 }} MB</span></span>
      </div>
      <div class="stat" v-if="overview.manualCount">
        <span class="stat-num manual-num">{{ overview.manualCount }}</span>
        <span class="stat-label">含人工指定</span>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="toolbar glass">
      <div class="tool-group">
        <el-button type="primary" plain :loading="isRunning('sync-cos')" @click="openSyncDialog">
          <el-icon><Download /></el-icon> 同步 COS 基线
        </el-button>
        <el-button type="success" plain :loading="isRunning('gen-schaledb')" @click="openGenDialog">
          <el-icon><Picture /></el-icon> 从 schaledb 生成
        </el-button>
        <el-button type="warning" plain :loading="isRunning('crawl-wikiru')" @click="openWikiruDialog">
          <el-icon><MagicStick /></el-icon> 抓取 wikiru
        </el-button>
      </div>
      <div class="tool-group">
        <el-input
          v-model="filter.keyword"
          placeholder="搜索名字 / Id"
          clearable
          class="kw-input"
          @input="debouncedLoad"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-input v-model="filter.idFrom" placeholder="Id ≥" class="id-input" clearable @change="load" />
        <el-input v-model="filter.idTo" placeholder="Id ≤" class="id-input" clearable @change="load" />
      </div>
    </div>

    <!-- 筛选 chips -->
    <div class="filters">
      <el-checkbox-group v-model="filterFlags" @change="load">
        <el-checkbox-button value="missing">只看缺图 ({{ overview.partialCount + overview.emptyCount }})</el-checkbox-button>
        <el-checkbox-button value="abnormal">只看异常</el-checkbox-button>
        <el-checkbox-button value="gacha-img">缺抽卡图</el-checkbox-button>
        <el-checkbox-button value="stu_icon_db_png">缺PNG</el-checkbox-button>
        <el-checkbox-button value="stu_icon_db">缺JPG</el-checkbox-button>
      </el-checkbox-group>
      <span class="muted result-count">显示 {{ overview.filtered || 0 }} / {{ overview.total || 0 }}</span>
    </div>

    <!-- 主表格 -->
    <el-table
      :data="overview.rows || []"
      v-loading="loading"
      class="icon-table glass"
      size="small"
      :row-class-name="rowClass"
      height="calc(100vh - 400px)"
      @selection-change="(v) => (selected = v)"
    >
      <el-table-column type="selection" width="42" />
      <el-table-column label="ID" width="90" sortable :sort-by="'Id_db'">
        <template #default="{ row }">
          <span class="mono id-cell">{{ row.Id_db }}</span>
        </template>
      </el-table-column>
      <el-table-column label="头像" width="240">
        <template #default="{ row }">
          <div class="thumb-row">
            <div
              v-for="t in typeList"
              :key="t.key"
              class="thumb-wrap"
              :class="{ empty: !row.status[t.key].exists, manual: row.status[t.key].source === 'manual' }"
              @click="openDetail(row)"
            >
              <img
                v-if="row.status[t.key].exists"
                :src="iconViewUrl(t.key, row.Id_db, row.status[t.key].mtime)"
                class="thumb"
                loading="lazy"
              />
              <div v-else class="thumb-empty">
                <el-icon><Close /></el-icon>
              </div>
              <span class="thumb-tag">{{ typeShort(t.key) }}</span>
              <span v-if="row.status[t.key].source === 'manual'" class="manual-dot" title="人工指定">手</span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="姓名" min-width="150">
        <template #default="{ row }">
          <div class="name-cell">
            <span class="name-cn">{{ row.Name_zh_cn || '—' }}</span>
            <span class="name-jp muted">{{ row.Name_jp }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="星级" width="80">
        <template #default="{ row }">
          <span v-if="row.StarGrade" class="star">{{ '★'.repeat(Math.min(row.StarGrade, 5)) }}</span>
          <span v-else class="muted">—</span>
          <el-tag v-if="row.IsLimited" size="small" type="warning" effect="plain" class="lim-tag">限</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <template v-if="row.complete">
            <el-tag size="small" type="success" effect="plain">齐全</el-tag>
          </template>
          <template v-else>
            <el-tag size="small" type="danger" effect="plain">缺 {{ row.missingCount }}</el-tag>
            <span class="muted missing-list">{{ row.missingTypes.map(typeShort).join(',') }}</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="120">
        <template #default="{ row }">
          <div class="src-cell">
            <el-tag
              v-for="t in typeList.filter((x) => row.status[x.key].source)"
              :key="'src-' + t.key"
              size="small"
              :type="srcTagType(row.status[t.key].source)"
              effect="plain"
            >
              {{ typeShort(t.key) }}:{{ srcShort(row.status[t.key].source) }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right" align="center">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <el-button
              size="small"
              text
              type="warning"
              v-if="row.missingCount > 0 || row.hasManual"
              @click="openCandidates(row)"
            >候选</el-button>
            <el-button size="small" text type="danger" @click="removeAll(row)">清空</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 批量操作 -->
    <div v-if="selected.length" class="batch-bar glass">
      <span>已选 <b>{{ selected.length }}</b> 个学生</span>
      <el-button size="small" plain @click="batchGen">
        <el-icon><Picture /></el-icon> 生成基础头像
      </el-button>
      <el-button size="small" plain @click="batchCrawl">
        <el-icon><MagicStick /></el-icon> 抓取抽卡头像
      </el-button>
      <el-button size="small" plain type="danger" @click="batchDelete">删除所选头像</el-button>
      <el-button size="small" text @click="selected = []">取消选择</el-button>
    </div>

    <!-- ===== 任务进度抽屉 ===== -->
    <el-drawer v-model="jobDrawer" :title="jobTitle" size="min(720px, 96vw)" append-to-body>
      <div class="job-body">
        <el-progress
          v-if="currentJob && currentJob.progress && currentJob.progress.total"
          :percentage="Math.round((currentJob.progress.done / currentJob.progress.total) * 100)"
          :status="currentJob.running ? '' : currentJob.error ? 'exception' : 'success'"
        />
        <div v-if="currentJob?.progress?.current" class="muted job-current">
          当前：{{ currentJob.progress.current }}
          （{{ currentJob.progress.done }} / {{ currentJob.progress.total }}）
        </div>

        <el-alert v-if="currentJob?.error" type="error" :closable="false" class="mb-12">
          {{ currentJob.error }}
        </el-alert>

        <div v-if="currentJob?.result" class="job-result">
          <div class="result-title">结果摘要</div>
          <pre class="result-json">{{ jobSummary(currentJob) }}</pre>
          <div v-if="jobDetailList(currentJob).length" class="detail-block">
            <div class="detail-title" v-for="(d, i) in jobDetailList(currentJob)" :key="i">
              <b>{{ d.label }}</b>
              <pre>{{ d.text }}</pre>
            </div>
          </div>
        </div>

        <div class="log-title">运行日志</div>
        <pre class="log-box">{{ (currentJob?.log || []).join('\n') || '（暂无日志）' }}</pre>
      </div>
    </el-drawer>

    <!-- ===== 详情/编辑抽屉 ===== -->
    <el-drawer v-model="detailDrawer" :title="detailTitle" size="min(820px, 96vw)" append-to-body>
      <div v-if="detailRow" class="detail-body">
        <div class="detail-types">
          <div v-for="t in typeList" :key="'d-' + t.key" class="detail-card glass">
            <div class="dc-head">
              <h4>{{ t.label }}</h4>
              <el-tag size="small" :type="detailRow.status[t.key].exists ? 'success' : 'danger'" effect="plain">
                {{ detailRow.status[t.key].exists ? '有图' : '缺失' }}
              </el-tag>
            </div>
            <div class="dc-img">
              <img
                v-if="detailRow.status[t.key].exists"
                :src="iconViewUrl(t.key, detailRow.Id_db, detailRow.status[t.key].mtime)"
                class="dc-thumb"
              />
              <el-empty v-else :image-size="60" description="暂无" />
            </div>
            <div class="dc-meta muted">
              <div v-if="detailRow.status[t.key].exists">
                大小 {{ fmtSize(detailRow.status[t.key].size) }}
                <br />来源
                <el-tag size="small" :type="srcTagType(detailRow.status[t.key].source)" effect="plain">
                  {{ srcShort(detailRow.status[t.key].source) }}
                </el-tag>
                <template v-if="detailRow.status[t.key].note"><br />备注：{{ detailRow.status[t.key].note }}</template>
              </div>
              <div v-else>—</div>
            </div>
            <div class="dc-actions">
              <el-upload
                :show-file-list="false"
                :before-upload="(f) => doUpload(t.key, f)"
                accept="image/*"
              >
                <el-button size="small" plain>{{ detailRow.status[t.key].exists ? '替换' : '上传' }}</el-button>
              </el-upload>
              <el-button
                size="small"
                text
                type="warning"
                @click="openCandidates(detailRow, t.key)"
              >从候选选</el-button>
              <el-button
                size="small"
                text
                type="danger"
                :disabled="!detailRow.status[t.key].exists"
                @click="removeOne(t.key)"
              >删除</el-button>
            </div>
            <div class="dc-src-target muted">COS key：{{ t.key }}/{{ detailRow.Id_db }}.{{ t.ext }}</div>
          </div>
        </div>

        <!-- 元数据直接改 -->
        <div class="meta-editor glass">
          <h4>来源标记（直接编辑，会写回 icons-meta.json）</h4>
          <div v-for="t in typeList" :key="'m-' + t.key" class="meta-row">
            <span class="meta-label">{{ t.label }}</span>
            <el-select v-model="metaDraft[t.key].source" size="small" class="meta-src" placeholder="未设置">
              <el-option label="auto（自动，可被覆盖）" value="auto" />
              <el-option label="manual（人工，受保护）" value="manual" />
              <el-option label="cos（COS 基线）" value="cos" />
            </el-select>
            <el-input v-model="metaDraft[t.key].note" size="small" placeholder="备注" class="meta-note" />
          </div>
          <el-button size="small" type="primary" plain @click="saveMeta">保存来源标记</el-button>
        </div>
      </div>
      <el-empty v-else description="未选择" />
    </el-drawer>

    <!-- ===== 候选选择弹窗 ===== -->
    <el-dialog v-model="candDialog" title="选择候选图" width="min(1000px, 96vw)" top="4vh" append-to-body>
      <div v-loading="candLoading" class="cand-body">
        <template v-if="candData">
          <el-alert type="info" :closable="false" class="mb-12">
            <template #title>
              <b>{{ candName }}</b> — 点选一张作为 <el-tag size="small" type="warning" effect="plain">{{ candTypeLabel }}</el-tag>
              的图。选定后会标记为「人工」，自动流程不再覆盖。
            </template>
          </el-alert>

          <div v-if="candData.related?.length" class="cand-section">
            <h4>名字相关的图（{{ candData.related.length }}）</h4>
            <div class="cand-grid">
              <div
                v-for="c in candData.related"
                :key="'r-' + c.file"
                class="cand-item"
                :class="{ taken: c.takenBy, current: c.takenBy && c.takenBy.id === candId }"
                @click="doAssign(c)"
              >
                <img :src="wikiruImgUrl(c.hex)" class="cand-img" loading="lazy" />
                <div class="cand-name mono">{{ c.file }}</div>
                <el-tag v-if="c.takenBy" size="small" type="info" effect="plain" class="cand-tag">
                  已归 #{{ c.takenBy.id }} {{ c.takenBy.name }}
                </el-tag>
                <el-tag v-if="c.isPlaceholder" size="small" type="warning" effect="plain" class="cand-tag">占位图</el-tag>
              </div>
            </div>
          </div>

          <div class="cand-section">
            <h4>
              全部 wikiru 图（{{ candData.all?.length || 0 }}）
              <el-button size="small" text @click="candShowAll = !candShowAll">
                {{ candShowAll ? '收起' : '展开' }}
              </el-button>
            </h4>
            <div v-if="candShowAll" class="cand-grid">
              <div
                v-for="c in candData.all"
                :key="'a-' + c.file"
                class="cand-item"
                :class="{ taken: c.takenBy }"
                @click="doAssign(c)"
              >
                <img :src="wikiruImgUrl(c.hex)" class="cand-img" loading="lazy" />
                <div class="cand-name mono">{{ c.file }}</div>
                <el-tag v-if="c.takenBy" size="small" type="info" effect="plain" class="cand-tag">
                  #{{ c.takenBy.id }}
                </el-tag>
              </div>
            </div>
          </div>
        </template>
      </div>
    </el-dialog>

    <!-- ===== 同步 COS 确认 ===== -->
    <el-dialog v-model="syncDialog" title="同步 COS 基线" width="min(700px, 94vw)" append-to-body>
      <div v-loading="syncPreviewLoading">
        <el-alert type="info" :closable="false" class="mb-12">
          把 COS 上已有的头像拉到本地当基线。<b>本地已有的文件不会被覆盖</b>；
          标为<b>「人工」</b>的图在任何情况下都不会被 COS 基线冲掉。
        </el-alert>
        <template v-if="syncPreview">
          <div class="preview-grid">
            <div v-for="(v, k) in syncPreview.perType" :key="k" class="preview-item">
              <b>{{ typeLabel(k) }}</b>
              <div class="muted">云端 {{ v.remote }} / 本地 {{ v.local }}</div>
              <div>待下载 <b class="hl">{{ v.missingLocal }}</b> · 仅本地有 {{ v.extraLocal }}</div>
            </div>
          </div>
          <div class="preview-total">
            合计待下载 <b class="hl">{{ syncPreview.totalToDownload }}</b> 张，约
            <b>{{ (syncPreview.totalBytes / 1048576).toFixed(1) }} MB</b>
          </div>
          <el-input v-model="syncTypes" placeholder="限定类型（留空=全部），如 gacha-img,stu_icon_db" class="mt-8">
            <template #prepend>类型</template>
          </el-input>
        </template>
      </div>
      <template #footer>
        <el-button @click="syncDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!syncPreview || !syncPreview.totalToDownload" @click="doSync">
          开始下载
        </el-button>
      </template>
    </el-dialog>

    <!-- ===== 生成 schaledb 确认 ===== -->
    <el-dialog v-model="genDialog" title="从 schaledb 生成基础头像" width="min(620px, 94vw)" append-to-body>
      <el-alert type="info" :closable="false" class="mb-12">
        拉 <code>schaledb.com/images/student/collection/{Id_db}.webp</code>，
        转成 200×226 的 PNG 与 JPG，写入 <code>stu_icon_db_png/</code> 与 <code>stu_icon_db/</code>。
      </el-alert>
      <el-radio-group v-model="genMode">
        <el-radio value="missing">只补缺失（推荐）</el-radio>
        <el-radio value="all">全部重生成</el-radio>
      </el-radio-group>
      <div class="mt-12">
        <el-checkbox v-model="genForce">
          覆盖已有的自动/COS 图（重新拉取生成，体积更大）
        </el-checkbox>
        <div class="hint-line">标为<b>「人工」</b>的图永远不会被自动流程覆盖，请放心。</div>
      </div>
      <div v-if="genPreview" class="preview-total mt-12">
        预计处理 <b class="hl">{{ genPreview.total }}</b> 个学生（共 {{ genPreview.students }} 个）
      </div>
      <template #footer>
        <el-button @click="genDialog = false">取消</el-button>
        <el-button type="primary" :loading="genStarting" @click="doGen">开始生成</el-button>
      </template>
    </el-dialog>

    <!-- ===== 抓 wikiri 确认 ===== -->
    <el-dialog v-model="wikiruDialog" title="抓取 wikiru 抽卡头像" width="min(760px, 94vw)" top="4vh" append-to-body>
      <div v-loading="wikiruPreviewLoading">
        <el-alert type="info" :closable="false" class="mb-12">
          从 <code>bluearchive.wikiru.jp</code> 的 ★1/★2/★3 页面解析 <code>&lt;日文名&gt;_icon.png</code>（200×200），
          按名字映射到 <code>Id_db</code> 后写入 <code>gacha-img/</code>。<b>原图直接存储，不重新编码。</b>
        </el-alert>

        <template v-if="wikiruPreview">
          <div class="preview-grid">
            <div class="preview-item"><b>wikiru 图总数</b><div class="hl">{{ wikiruPreview.stats.iconCount }}</div></div>
            <div class="preview-item"><b>匹配到学生</b><div class="hl ok">{{ wikiruPreview.stats.matched }}</div></div>
            <div class="preview-item"><b>本地已有抽卡图</b><div>{{ wikiruPreview.stats.localGacha }}</div></div>
            <div class="preview-item"><b>未匹配</b><div :class="wikiruPreview.stats.unmatched ? 'hl warn' : ''">{{ wikiruPreview.stats.unmatched }}</div></div>
            <div class="preview-item"><b>需人工确认</b><div :class="wikiruPreview.stats.ambiguous ? 'hl warn' : ''">{{ wikiruPreview.stats.ambiguous }}</div></div>
            <div class="preview-item"><b>抓不到图的学生</b><div>{{ wikiruPreview.stats.studentsWithoutSource }}</div></div>
          </div>

          <div v-if="wikiruPreview.pages?.some((p) => p.error)" class="mt-8">
            <el-alert type="warning" :closable="false">
              <div v-for="(p, i) in wikiruPreview.pages.filter((x) => x.error)" :key="i">
                {{ p.url }} — {{ p.error }}
              </div>
            </el-alert>
          </div>

          <div class="mt-12">
            <el-radio-group v-model="wikiruMode">
              <el-radio value="new">新增优先（已有图不覆盖，推荐）</el-radio>
              <el-radio value="full">全量重抓</el-radio>
            </el-radio-group>
          </div>
          <div class="mt-8">
            <el-checkbox v-model="wikiruPlaceholder">包含占位图（_仮icon，通常不要勾）</el-checkbox>
          </div>
          <div class="mt-8">
            <el-checkbox v-model="wikiruForce">覆盖已有的自动/COS 图（危险）</el-checkbox>
            <div class="hint-line">标为<b>「人工」</b>的图不会被覆盖。</div>
          </div>

          <div v-if="wikiruPreview.ambiguous?.length" class="mt-12">
            <h4>需人工确认（{{ wikiruPreview.ambiguous.length }}）</h4>
            <div v-for="(a, i) in wikiruPreview.ambiguous" :key="i" class="amb-item">
              <span class="mono">{{ a.name }}</span> → #{{ a.ids?.join(', #') }}
              <div class="muted">{{ a.hint }}</div>
            </div>
          </div>

          <div v-if="wikiruPreview.unmatched?.length" class="mt-12">
            <h4>未匹配（{{ wikiruPreview.unmatched.length }}）</h4>
            <div class="unmatch-list muted">
              <span v-for="(u, i) in wikiruPreview.unmatched" :key="i" class="unmatch-chip" :title="u.reason">
                {{ u.name }}
              </span>
            </div>
          </div>

          <div v-if="Object.keys(wikiruPreview.manualSkip || {}).length" class="mt-12">
            <h4>人工豁免（不自动处理）</h4>
            <div v-for="(v, k) in wikiruPreview.manualSkip" :key="k" class="amb-item">
              #{{ k }} — {{ v }}
            </div>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="wikiruDialog = false">取消</el-button>
        <el-button type="primary" :disabled="!wikiruPreview" @click="doWikiru">开始抓取</el-button>
      </template>
    </el-dialog>

    <!-- ===== 通用结果弹窗（校验/盘点/元数据） ===== -->
    <el-dialog v-model="reportDialog" :title="reportTitle" width="min(1000px, 96vw)" top="4vh" append-to-body>
      <div v-loading="reportLoading" class="report-body">
        <template v-if="reportType === 'meta'">
          <el-alert type="warning" :closable="false" class="mb-12">
            这是 <code>{{ reportData.path }}</code> 的内容。<b>source</b> 取
            <code>auto</code> / <code>manual</code> / <code>cos</code>；标为 <code>manual</code> 的不会被自动流程覆盖。
            保存后立即生效。
          </el-alert>
          <el-input v-model="reportText" type="textarea" :rows="22" class="meta-textarea" />
          <div class="mt-12">
            <el-button type="primary" @click="saveRawMeta">保存</el-button>
            <span class="muted">共 {{ reportMetaCount }} 条</span>
          </div>
        </template>

        <template v-else-if="reportType === 'verify'">
          <template v-if="reportData">
            <div class="preview-grid">
              <div class="preview-item"><b>仅本地有</b><div class="hl">{{ reportData.summary?.localOnly }}</div></div>
              <div class="preview-item"><b>仅 COS 有</b><div class="hl">{{ reportData.summary?.cosOnly }}</div></div>
              <div class="preview-item"><b>内容不一致</b><div class="hl warn">{{ reportData.summary?.mismatch }}</div></div>
              <div class="preview-item">
                <b>wikiru 匹配</b>
                <div>{{ reportData.wikiru?.matched ?? '—' }} / 未覆盖 {{ reportData.wikiru?.missingStudents?.length ?? '—' }}</div>
              </div>
            </div>
            <div class="muted mt-8" v-if="reportData.reportPath">报告已存盘：{{ reportData.reportPath }}</div>

            <div v-if="reportData.localOnly?.length" class="mt-12">
              <h4>仅本地有（{{ reportData.localOnly.length }}）</h4>
              <div class="unmatch-list">
                <span v-for="(x, i) in reportData.localOnly.slice(0, 200)" :key="i" class="unmatch-chip">
                  {{ typeShort(x.type) }}#{{ x.id }}
                </span>
              </div>
            </div>
            <div v-if="reportData.cosOnly?.length" class="mt-12">
              <h4>仅 COS 有（{{ reportData.cosOnly.length }}）</h4>
              <div class="unmatch-list">
                <span v-for="(x, i) in reportData.cosOnly.slice(0, 200)" :key="i" class="unmatch-chip">
                  {{ typeShort(x.type) }}#{{ x.id }}
                </span>
              </div>
            </div>
            <div v-if="reportData.mismatch?.length" class="mt-12">
              <h4>内容不一致（{{ reportData.mismatch.length }}）</h4>
              <el-table :data="reportData.mismatch" size="small" max-height="300">
                <el-table-column label="类型" width="130">
                  <template #default="{ row }">{{ typeShort(row.type) }}</template>
                </el-table-column>
                <el-table-column prop="id" label="Id" width="90" />
                <el-table-column prop="localSize" label="本地" width="100" />
                <el-table-column prop="cosSize" label="COS" width="100" />
                <el-table-column label="操作" width="100">
                  <template #default="{ row }">
                    <el-button size="small" text type="primary" @click="openDetailById(row.id)">查看</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
            <div v-if="reportData.wikiru?.unmatched?.length" class="mt-12">
              <h4>wikiru 未匹配（{{ reportData.wikiru.unmatched.length }}）</h4>
              <div class="unmatch-list muted">
                <span v-for="(u, i) in reportData.wikiru.unmatched" :key="i" class="unmatch-chip" :title="u.reason">
                  {{ u.name }}
                </span>
              </div>
            </div>
          </template>
        </template>

        <template v-else-if="reportType === 'wikiru-preview'">
          <pre class="result-json">{{ JSON.stringify(reportData, null, 2) }}</pre>
        </template>

        <template v-else-if="reportType === 'cos-inventory'">
          <div class="preview-grid">
            <div v-for="(v, k) in reportData?.inventory" :key="k" class="preview-item">
              <b>{{ typeLabel(k) }}</b>
              <div class="hl">{{ v.count }} 张</div>
              <div class="muted" v-if="v.extras?.length">另有 {{ v.extras.length }} 个非学生文件</div>
            </div>
          </div>
          <pre class="result-json mt-12">{{ JSON.stringify(reportData?.inventory, null, 2) }}</pre>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft, Refresh, Setting, ArrowDown, Download, Picture, MagicStick, Search, Close,
} from '@element-plus/icons-vue';
import * as api from '../api/index.js';

const router = useRouter();

const loading = ref(false);
const overview = ref({ rows: [], inventory: {} });
const selected = ref([]);
const filter = reactive({ keyword: '', idFrom: '', idTo: '' });
const filterFlags = ref([]);

const typeList = computed(() => overview.value.types || []);
const typeLabel = (k) => typeList.value.find((t) => t.key === k)?.label || k;

// ---------- 加载 ----------

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (filterFlags.value.includes('missing')) q.set('missing', '1');
    if (filterFlags.value.includes('abnormal')) q.set('abnormal', '1');
    const typeFlag = filterFlags.value.find((f) => ['gacha-img', 'stu_icon_db_png', 'stu_icon_db'].includes(f));
    if (typeFlag) q.set('type', typeFlag);
    if (filter.keyword) q.set('keyword', filter.keyword);
    if (filter.idFrom) q.set('idFrom', filter.idFrom);
    if (filter.idTo) q.set('idTo', filter.idTo);
    overview.value = await api.getIconsStatus(q.toString());
  } catch (e) {
    ElMessage.error(`加载失败：${e.message}`);
  } finally {
    loading.value = false;
  }
}

let kwTimer = null;
function debouncedLoad() {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(load, 300);
}

function rowClass({ row }) {
  if (row.missingCount === typeList.value.length) return 'row-bad';
  if (row.missingCount > 0) return 'row-warn';
  if (row.hasManual) return 'row-manual';
  return '';
}

// ---------- 图片 URL ----------

// 用 mtime 做 cache buster，替换后能立刻看到新图
const iconViewUrl = (type, id, mtime) =>
  `/api/iconview/${type}/${id}?v=${encodeURIComponent(mtime || '0')}`;
const wikiruImgUrl = (hex) => `/api/iconview-wikiru?hex=${hex}`;

const typeShort = (k) => ({ stu_icon_db_png: 'PNG', stu_icon_db: 'JPG', 'gacha-img': '抽卡' }[k] || k);
const srcShort = (s) => ({ auto: '自动', manual: '人工', cos: 'COS', unknown: '?' }[s] || s);
const srcTagType = (s) => ({ auto: '', manual: 'warning', cos: 'info' }[s] || 'info');
const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);

// ---------- 任务轮询 ----------

const jobDrawer = ref(false);
const jobName = ref('');
const currentJob = ref(null);
let jobTimer = null;

const jobTitle = computed(() => ({ 'gen-schaledb': '生成基础头像', 'crawl-wikiru': '抓取 wikiru', 'sync-cos': '同步 COS 基线', verify: '全量校验' }[jobName.value] || '任务运行中'));

function isRunning(name) {
  return currentJob.value?.name === name && currentJob.value?.running;
}

async function watchJob(name) {
  jobName.value = name;
  jobDrawer.value = true;
  clearInterval(jobTimer);
  const poll = async () => {
    try {
      const j = await api.getIconsJob(name);
      currentJob.value = j;
      if (!j.running) {
        clearInterval(jobTimer);
        await load();
        if (j.error) ElMessage.error(j.error);
        else ElMessage.success('任务完成');
      }
    } catch (e) {
      clearInterval(jobTimer);
    }
  };
  await poll();
  jobTimer = setInterval(poll, 1200);
}

function jobSummary(job) {
  const r = job.result;
  if (!r) return '（无结果）';
  const parts = [];
  if (jobName.value === 'gen-schaledb') {
    parts.push(`成功 ${r.ok}`, `跳过 ${r.skipped}`, `失败 ${r.failed?.length || 0}`);
    if (r.bytes) parts.push(`产出 ${(r.bytes / 1048576).toFixed(1)} MB`);
  } else if (jobName.value === 'crawl-wikiru') {
    parts.push(`新增 ${r.added?.length || 0}`, `跳过 ${r.skipped?.length || 0}`, `失败 ${r.failed?.length || 0}`);
    parts.push(`未匹配 ${r.unmatched?.length || 0}`, `歧义 ${r.ambiguous?.length || 0}`);
    if (r.manualSkipped?.length) parts.push(`人工豁免 ${r.manualSkipped.length}`);
  } else if (jobName.value === 'sync-cos') {
    parts.push(`下载 ${r.downloaded}`, `跳过已有 ${r.skippedExisting}`, `保护人工 ${r.skippedManual}`, `失败 ${r.failed?.length || 0}`);
    if (r.bytes) parts.push(`共 ${(r.bytes / 1048576).toFixed(1)} MB`);
  } else if (jobName.value === 'verify') {
    parts.push(`仅本地 ${r.summary?.localOnly}`, `仅COS ${r.summary?.cosOnly}`, `不一致 ${r.summary?.mismatch}`);
  }
  return parts.join(' · ');
}

function jobDetailList(job) {
  const r = job.result;
  if (!r) return [];
  const out = [];
  const list2str = (arr, fmt) => (arr || []).slice(0, 60).map(fmt).join('\n') + ((arr || []).length > 60 ? `\n… 共 ${arr.length} 条` : '');

  if (jobName.value === 'gen-schaledb' && r.failed?.length) {
    out.push({ label: `失败（${r.failed.length}）`, text: list2str(r.failed, (f) => `#${f.id} ${f.error}`) });
  }
  if (jobName.value === 'crawl-wikiru') {
    if (r.added?.length) out.push({ label: `新增（${r.added.length}）`, text: list2str(r.added, (a) => `#${a.id} ${a.name} ← ${a.file}`) });
    if (r.failed?.length) out.push({ label: `失败（${r.failed.length}）`, text: list2str(r.failed, (f) => `#${f.id} ${f.file}: ${f.error}`) });
    if (r.unmatched?.length) out.push({ label: `未匹配（${r.unmatched.length}）`, text: list2str(r.unmatched, (u) => `${u.name} — ${u.reason}`) });
    if (r.ambiguous?.length) out.push({ label: `歧义（${r.ambiguous.length}）`, text: list2str(r.ambiguous, (a) => `${a.name} → #${a.ids?.join(',#')}`) });
    if (r.manualSkipped?.length) out.push({ label: `人工豁免（${r.manualSkipped.length}）`, text: list2str(r.manualSkipped, (m) => `#${m.id} ${m.name} — ${m.reason}`) });
  }
  if (jobName.value === 'sync-cos' && r.failed?.length) {
    out.push({ label: `失败（${r.failed.length}）`, text: list2str(r.failed, (f) => `${f.key}: ${f.error}`) });
  }
  if (jobName.value === 'verify') {
    if (r.mismatch?.length) out.push({ label: `内容不一致（${r.mismatch.length}）`, text: list2str(r.mismatch, (m) => `${m.type}/${m.id} 本地${m.localSize}B vs COS${m.cosSize}B`) });
    if (r.cosOnly?.length) out.push({ label: `仅 COS 有（${r.cosOnly.length}）`, text: list2str(r.cosOnly, (x) => `${x.type}/${x.id}`) });
    if (r.localOnly?.length) out.push({ label: `仅本地有（${r.localOnly.length}）`, text: list2str(r.localOnly, (x) => `${x.type}/${x.id}`) });
  }
  return out;
}

// ---------- 详情抽屉 ----------

const detailDrawer = ref(false);
const detailRow = ref(null);
const metaDraft = reactive({});

const detailTitle = computed(() =>
  detailRow.value ? `#${detailRow.value.Id_db} ${detailRow.value.Name_zh_cn || detailRow.value.Name_jp}` : '详情'
);

function openDetail(row) {
  detailRow.value = row;
  for (const t of typeList.value) {
    metaDraft[t.key] = { source: row.status[t.key].source || '', note: row.status[t.key].note || '' };
  }
  detailDrawer.value = true;
}

function openDetailById(id) {
  const row = overview.value.rows.find((r) => r.Id_db === Number(id));
  if (row) openDetail(row);
}

async function saveMeta() {
  try {
    for (const t of typeList.value) {
      const d = metaDraft[t.key];
      if (!d.source && !d.note) continue;
      await api.setIconMeta(t.key, detailRow.value.Id_db, {
        source: d.source || undefined,
        note: d.note || '',
      });
    }
    ElMessage.success('来源标记已保存');
    await load();
    // 刷新详情里的状态
    const fresh = overview.value.rows.find((r) => r.Id_db === detailRow.value.Id_db);
    if (fresh) detailRow.value = fresh;
  } catch (e) {
    ElMessage.error(`保存失败：${e.message}`);
  }
}

async function doUpload(type, file) {
  try {
    const buf = await file.arrayBuffer();
    const r = await fetch(`/api/icons/upload?type=${type}&id=${detailRow.value.Id_db}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: buf,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    ElMessage.success(`已上传（${fmtSize(j.size)}）`);
    await load();
    const fresh = overview.value.rows.find((r) => r.Id_db === detailRow.value.Id_db);
    if (fresh) detailRow.value = fresh;
  } catch (e) {
    ElMessage.error(`上传失败：${e.message}`);
  }
  return false; // 阻止 el-upload 自动上传
}

async function removeOne(type) {
  try {
    await ElMessageBox.confirm(
      `确认删除 #${detailRow.value.Id_db} 的「${typeLabel(type)}」？该操作立即生效（不随发布自动恢复）。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    await api.deleteIcon(type, detailRow.value.Id_db);
    ElMessage.success('已删除');
    await load();
    const fresh = overview.value.rows.find((r) => r.Id_db === detailRow.value.Id_db);
    if (fresh) detailRow.value = fresh;
  } catch (e) {
    ElMessage.error(`删除失败：${e.message}`);
  }
}

async function removeAll(row) {
  try {
    await ElMessageBox.confirm(
      `确认清空 #${row.Id_db} ${row.Name_zh_cn || row.Name_jp} 的<b>全部三类头像</b>？`,
      '清空确认',
      { type: 'warning', dangerouslyUseHTMLString: true, confirmButtonText: '清空', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    const r = await api.deleteIconsBatch(typeList.value.map((t) => ({ type: t.key, id: row.Id_db })));
    ElMessage.success(`已删除 ${r.deleted} 张`);
    await load();
  } catch (e) {
    ElMessage.error(`失败：${e.message}`);
  }
}

// ---------- 批量 ----------

async function batchGen() {
  const ids = selected.value.map((r) => r.Id_db);
  try {
    await api.genSchaledb(ids, { mode: 'all', force: false });
    watchJob('gen-schaledb');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function batchCrawl() {
  const ids = selected.value.map((r) => r.Id_db);
  try {
    await api.crawlWikiru({ mode: 'new' });
    watchJob('crawl-wikiru');
    ElMessage.info('抓取按全量进行（wikiru 一次性返回全部图），已选学生的图会被优先补齐');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function batchDelete() {
  const items = [];
  for (const r of selected.value) {
    for (const t of typeList.value) {
      if (r.status[t.key].exists) items.push({ type: t.key, id: r.Id_db });
    }
  }
  try {
    await ElMessageBox.confirm(`确认删除所选 ${selected.value.length} 个学生的 ${items.length} 张头像图？`, '批量删除', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    const r = await api.deleteIconsBatch(items);
    ElMessage.success(`已删除 ${r.deleted} 张`);
    selected.value = [];
    await load();
  } catch (e) {
    ElMessage.error(`失败：${e.message}`);
  }
}

// ---------- 候选 ----------

const candDialog = ref(false);
const candLoading = ref(false);
const candData = ref(null);
const candShowAll = ref(false);
const candId = ref(null);
const candType = ref('gacha-img');
const candName = ref('');
const candTypeLabel = computed(() => typeLabel(candType.value));

async function openCandidates(row, type) {
  candType.value = type || 'gacha-img';
  candId.value = row.Id_db;
  candName.value = `#${row.Id_db} ${row.Name_zh_cn || row.Name_jp}`;
  candDialog.value = true;
  candLoading.value = true;
  candData.value = null;
  try {
    candData.value = await api.getIconCandidates(row.Id_db);
  } catch (e) {
    ElMessage.error(`获取候选失败：${e.message}`);
  } finally {
    candLoading.value = false;
  }
}

async function doAssign(c) {
  try {
    await ElMessageBox.confirm(
      `把「${c.file}」指定为 ${candName.value} 的「${candTypeLabel.value}」？<br/>来源会标记为<b>人工</b>，自动流程不再覆盖。`,
      '确认指定',
      { type: 'info', dangerouslyUseHTMLString: true, confirmButtonText: '确定', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  try {
    const r = await api.assignIcon({ type: candType.value, id: candId.value, wikiruFile: c.file });
    ElMessage.success(`已指定（${fmtSize(r.size)}）`);
    candDialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error(`失败：${e.message}`);
  }
}

// ---------- 同步 COS ----------

const syncDialog = ref(false);
const syncPreview = ref(null);
const syncPreviewLoading = ref(false);
const syncTypes = ref('');

async function openSyncDialog() {
  syncDialog.value = true;
  syncPreviewLoading.value = true;
  syncPreview.value = null;
  try {
    syncPreview.value = await api.syncCos({ dryRun: true });
  } catch (e) {
    ElMessage.error(`预览失败：${e.message}`);
    syncDialog.value = false;
  } finally {
    syncPreviewLoading.value = false;
  }
}

async function doSync() {
  try {
    const types = syncTypes.value.split(',').map((s) => s.trim()).filter(Boolean);
    await api.syncCos({ types: types.length ? types : undefined });
    syncDialog.value = false;
    watchJob('sync-cos');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

// ---------- 生成 ----------

const genDialog = ref(false);
const genMode = ref('missing');
const genForce = ref(false);
const genPreview = ref(null);
const genStarting = ref(false);

async function openGenDialog() {
  genDialog.value = true;
  genPreview.value = null;
  try {
    genPreview.value = await api.genSchaledb(undefined, { mode: genMode.value, dryRun: true });
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function doGen() {
  genStarting.value = true;
  try {
    await api.genSchaledb(undefined, { mode: genMode.value, force: genForce.value });
    genDialog.value = false;
    watchJob('gen-schaledb');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    genStarting.value = false;
  }
}

// ---------- wikiru ----------

const wikiruDialog = ref(false);
const wikiruPreview = ref(null);
const wikiruPreviewLoading = ref(false);
const wikiruMode = ref('new');
const wikiruPlaceholder = ref(false);
const wikiruForce = ref(false);

async function openWikiruDialog() {
  wikiruDialog.value = true;
  wikiruPreviewLoading.value = true;
  wikiruPreview.value = null;
  try {
    wikiruPreview.value = await api.wikiruPreview();
  } catch (e) {
    ElMessage.error(`预览失败：${e.message}（检查网络或设置代理）`);
  } finally {
    wikiruPreviewLoading.value = false;
  }
}

async function doWikiru() {
  try {
    await api.crawlWikiru({
      mode: wikiruMode.value,
      includePlaceholder: wikiruPlaceholder.value,
      force: wikiruForce.value,
    });
    wikiruDialog.value = false;
    watchJob('crawl-wikiru');
  } catch (e) {
    ElMessage.error(e.message);
  }
}

// ---------- 报告弹窗 ----------

const reportDialog = ref(false);
const reportTitle = ref('');
const reportType = ref('');
const reportData = ref(null);
const reportLoading = ref(false);
const reportText = ref('');
const reportMetaCount = ref(0);

async function onMetaCmd(cmd) {
  if (cmd === 'verify') {
    reportType.value = 'verify';
    reportTitle.value = '全量校验';
    reportDialog.value = true;
    reportLoading.value = true;
    reportData.value = null;
    try {
      await api.verifyIcons({ includeWikiru: true });
      watchJob('verify');
      reportDialog.value = false;
    } catch (e) {
      ElMessage.error(e.message);
    } finally {
      reportLoading.value = false;
    }
    return;
  }
  if (cmd === 'meta') {
    reportType.value = 'meta';
    reportTitle.value = '来源元数据（可直接编辑）';
    reportDialog.value = true;
    reportLoading.value = true;
    try {
      const r = await api.getIconsMeta();
      reportText.value = JSON.stringify(r.meta, null, 2);
      reportMetaCount.value = Object.keys(r.meta.items || {}).length;
    } catch (e) {
      ElMessage.error(e.message);
    } finally {
      reportLoading.value = false;
    }
    return;
  }
  reportType.value = cmd;
  reportTitle.value = cmd === 'wikiru-preview' ? 'wikiru 映射预览' : 'COS 存量盘点';
  reportDialog.value = true;
  reportLoading.value = true;
  reportData.value = null;
  try {
    reportData.value = cmd === 'wikiru-preview' ? await api.wikiruPreview() : await api.cosInventory();
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    reportLoading.value = false;
  }
}

async function saveRawMeta() {
  try {
    const parsed = JSON.parse(reportText.value);
    await api.saveIconsMeta(parsed.items || {});
    ElMessage.success('元数据已保存');
    reportDialog.value = false;
    await load();
  } catch (e) {
    ElMessage.error(`保存失败：${e.message}`);
  }
}

onMounted(load);
onUnmounted(() => clearInterval(jobTimer));
</script>

<style scoped>
.icons-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--el-text-color-secondary);
  font-size: 16px;
  width: fit-content;
}
.back:hover {
  color: var(--el-color-primary);
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.head h2 {
  margin: 0 0 4px;
  font-size: 24px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 15px;
}
code {
  background: var(--el-fill-color-light);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.92em;
}
.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* 统计条 */
.stat-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 0;
  padding: 18px 20px;
  border-radius: 18px;
}
.stat {
  flex: 1;
  min-width: 104px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  border-right: 1px solid var(--fmps-divider);
}
.stat:last-child {
  border-right: none;
}
.stat-num {
  font-size: 27px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.01em;
}
.stat-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  text-align: center;
  line-height: 1.4;
}
.stat.ok .stat-num {
  color: var(--el-color-success);
}
.stat.warn .stat-num {
  color: var(--el-color-warning);
}
.stat.bad .stat-num {
  color: var(--el-color-danger);
}
/* 零值中性化：必须放在 ok/warn/bad 之后，同为 (0,3,0) 权重时后者生效 */
.stat.zero .stat-num {
  color: var(--el-text-color-placeholder);
  font-weight: 600;
}
.manual-num {
  color: var(--el-color-primary);
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 16px;
}
.tool-group {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.kw-input {
  width: 220px;
}
.id-input {
  width: 100px;
}

.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.result-count {
  margin-left: auto;
}

/* 表格 */
.icon-table {
  border-radius: 16px;
  overflow: hidden;
  background: var(--fmps-panel-bg);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--fmps-panel-border);
  box-shadow: var(--fmps-panel-shadow);
  /* 让表格本体透出面板底色，避免"灰框里套深色表格"的割裂感 */
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: var(--fmps-inset-bg);
  --el-table-border-color: var(--fmps-divider);
  --el-table-row-hover-bg-color: rgba(91, 141, 239, 0.12);
}
.id-cell {
  font-weight: 700;
  font-size: 17px;
}
/* 行内操作按钮：用 flex 统一对齐，避免 inline-block 之间的基线/换行错位 */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  white-space: nowrap;
}
.row-actions .el-button + .el-button {
  margin-left: 0;
}
.row-actions .el-button {
  padding: 6px 8px;
  font-size: 16px;
}
.thumb-row {
  display: flex;
  gap: 8px;
}
.thumb-wrap {
  position: relative;
  width: 66px;
  height: 74px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  cursor: pointer;
  transition: all 0.18s;
  background: var(--el-fill-color-lighter);
}
.thumb-wrap:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(40, 60, 130, 0.18);
  border-color: var(--el-color-primary-light-5);
}
.thumb-wrap.empty {
  border-style: dashed;
  border-color: var(--el-color-danger-light-5);
}
.thumb-wrap.manual {
  border-color: var(--el-color-warning);
  border-width: 2px;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-danger);
  opacity: 0.45;
}
.thumb-tag {
  position: absolute;
  left: 0;
  bottom: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 12.5px;
  text-align: center;
  line-height: 14px;
}
.manual-dot {
  position: absolute;
  right: 2px;
  top: 2px;
  background: var(--el-color-warning);
  color: #fff;
  font-size: 11.5px;
  border-radius: 4px;
  padding: 0 3px;
  line-height: 14px;
}
.name-cell {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.name-cn {
  font-weight: 600;
}
.name-jp {
  font-size: 13.5px;
}
.star {
  color: #f7ba2a;
  font-size: 14px;
}
.lim-tag {
  margin-left: 4px;
}
.missing-list {
  margin-left: 4px;
  font-size: 13.5px;
}
.src-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

/* 批量条 */
.batch-bar {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-radius: 14px;
  z-index: 5;
}

/* 行高亮 */
:deep(.row-bad) {
  background: rgba(248, 113, 113, 0.09);
}
:deep(.row-warn) {
  background: rgba(251, 191, 36, 0.08);
}
:deep(.row-manual) {
  background: rgba(64, 158, 255, 0.06);
}

/* 抽屉 */
.job-body,
.detail-body,
.cand-body,
.report-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.job-current {
  margin-top: 6px;
}
.log-title,
.result-title,
.detail-title {
  font-weight: 700;
  margin-top: 8px;
}
.log-box,
.result-json {
  background: var(--el-fill-color-light);
  border-radius: 10px;
  padding: 12px;
  font-size: 13.5px;
  line-height: 1.55;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  font-family: 'Cascadia Code', Consolas, monospace;
}
.detail-block pre {
  background: var(--el-fill-color-light);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13.5px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 4px 0 0;
}

/* 详情三卡 */
.detail-types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
}
.detail-card {
  border-radius: 14px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.dc-head h4 {
  margin: 0;
  font-size: 16px;
}
.dc-img {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 130px;
  background: var(--el-fill-color-lighter);
  border-radius: 10px;
}
.dc-thumb {
  max-width: 100%;
  max-height: 150px;
  object-fit: contain;
  border-radius: 8px;
}
.dc-meta {
  font-size: 13.5px;
  line-height: 1.6;
}
.dc-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.dc-src-target {
  font-size: 12.5px;
  font-family: monospace;
}

/* 元数据编辑器 */
.meta-editor {
  border-radius: 14px;
  padding: 14px;
}
.meta-editor h4 {
  margin: 0 0 10px;
  font-size: 16px;
}
.meta-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.meta-label {
  width: 110px;
  font-size: 14px;
  flex-shrink: 0;
}
.meta-src {
  width: 190px;
  flex-shrink: 0;
}
.meta-textarea :deep(textarea) {
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 13.5px;
}

/* 候选网格 */
.cand-section h4 {
  margin: 14px 0 8px;
  font-size: 16px;
}
.cand-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 10px;
}
.cand-item {
  position: relative;
  border: 2px solid var(--el-border-color-lighter);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.16s;
  background: var(--el-fill-color-lighter);
}
.cand-item:hover {
  border-color: var(--el-color-primary);
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(40, 60, 130, 0.2);
}
.cand-item.taken {
  opacity: 0.62;
}
.cand-item.current {
  border-color: var(--el-color-success);
}
.cand-img {
  width: 100%;
  display: block;
  aspect-ratio: 1;
  object-fit: cover;
}
.cand-name {
  font-size: 9px;
  padding: 3px 4px;
  word-break: break-all;
  line-height: 1.25;
  text-align: center;
  background: var(--el-fill-color);
}
.cand-tag {
  position: absolute;
  top: 3px;
  left: 3px;
  transform: scale(0.85);
  transform-origin: left top;
}

/* 面板统一走 App.vue 里的主题 token。
   注意：这里**不能**用 `:global(html.dark) .foo` —— Vue 的 scoped CSS 会把
   整条规则丢掉，浅色背景就会一路带到深色模式去（曾经的"一片灰"）。 */
.toolbar,
.stat-bar,
.batch-bar,
.meta-editor,
.detail-card {
  background: var(--fmps-panel-bg);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border: 1px solid var(--fmps-panel-border);
  box-shadow: var(--fmps-panel-shadow);
}
.meta-editor,
.detail-card {
  box-shadow: var(--fmps-panel-shadow-lg);
}

/* 预览网格 */
.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.preview-item {
  background: var(--el-fill-color-lighter);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14px;
}
.preview-total {
  margin-top: 12px;
  font-size: 15px;
}
.hint-line {
  margin-top: 4px;
  font-size: 13.5px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}
.hint-line b {
  color: #e6a23c;
}
.hl {
  color: var(--el-color-primary);
  font-weight: 700;
}
.hl.ok {
  color: var(--el-color-success);
}
.hl.warn {
  color: var(--el-color-warning);
}
.mt-8 {
  margin-top: 8px;
}
.mt-12 {
  margin-top: 12px;
}
.mb-12 {
  margin-bottom: 12px;
}

.amb-item,
.unmatch-chip {
  font-size: 13.5px;
  line-height: 1.5;
}
.unmatch-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.unmatch-chip {
  background: var(--el-fill-color-light);
  border-radius: 6px;
  padding: 2px 7px;
  font-family: monospace;
}

@media (max-width: 700px) {
  .head h2 {
    font-size: 20px;
  }
  .stat {
    min-width: 72px;
  }
  .stat-num {
    font-size: 18px;
  }
  .kw-input {
    width: 140px;
  }
  .thumb-wrap {
    width: 54px;
    height: 61px;
  }
}
</style>
