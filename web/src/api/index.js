const BASE = '/api';

async function req(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    cache: 'no-store',
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const getStudents = () => req('/students');
export const getStudent = (id) => req(`/students/${id}`);
export const getStudentRaw = (id) => req(`/students/${id}/raw`);
export const updateStudentRaw = (id, fileName, data) =>
  req(`/students/${id}/raw`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, data }),
  });
export const getStats = () => req('/stats');
export const avatarUrl = (id) => `${BASE}/avatar/${id}?v=col2`;
export const itemUrl = (icon) => `${BASE}/item/${icon}`;

export const crawl = () => req('/crawl', { method: 'POST' });
export const crawlCloud = () => req('/crawl/cloud', { method: 'POST' });
export const revertAll = () => req('/revert/all', { method: 'POST' });
export const revertExceptId = () => req('/revert/except-id', { method: 'POST' });
export const revertStudentAll = (id) => req(`/revert/student/${id}/all`, { method: 'POST' });
export const revertStudentExceptId = (id) => req(`/revert/student/${id}/except-id`, { method: 'POST' });
export const getVersions = () => req('/versions');
export const restoreVersion = (ts) => req(`/versions/${encodeURIComponent(ts)}/restore`, { method: 'POST' });

// 云端发布记录（跨设备可见；本地归档只存在本机）
export const getCloudReleases = () => req('/cloud-releases');
export const rebuildCloudReleases = () => req('/cloud-releases/rebuild', { method: 'POST' });
export const getCloudRelease = (ts) => req(`/cloud-releases/${encodeURIComponent(ts)}`);
export const compareCloudReleaseLocal = (ts) => req(`/cloud-releases/${encodeURIComponent(ts)}/compare-local`);
export const applyCloudRelease = (ts) =>
  req(`/cloud-releases/${encodeURIComponent(ts)}/apply`, { method: 'POST' });

export const getDiff = () => req('/diff');
export const getStudentDiff = (id) => req(`/diff/student/${id}`);
export const getSnapshots = () => req('/snapshots');

export const getCloudDiff = () => req('/cloud/diff');
export const getRawJson = (fname) => req(`/raw/${fname}`);
export const importJson = (fname, data) =>
  req('/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fname, data }),
  });
export const publish = (password, opts = {}) =>
  req('/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, ...opts }),
  });
export const previewPublish = (password) =>
  req('/publish/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
export const getSkipList = () => req('/skip-list');
export const saveSkipList = (skipIds) =>
  req('/skip-list', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipIds }),
  });
export const toggleSkip = (idDb) =>
  req(`/skip/${idDb}`, { method: 'PUT' });
export const testMatch = (text) =>
  req(`/match-test?text=${encodeURIComponent(text)}`);

export const updateStudent = (id, changes) =>
  req(`/students/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes }),
  });

export const getAliasConfig = () => req('/alias-config');
export const saveAliasConfig = (groups) =>
  req('/alias-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups }),
  });

export const exportJson = () => req('/export', { method: 'POST' });

// 漫画
export const getManga = () => req('/manga');
export const getMangaTree = () => req('/manga/tree');
export const fetchCosManga = () => req('/manga/cos', { method: 'POST' });
export const crawlManga = (entryIds) =>
  req('/manga/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryIds }),
  });
export const retryManga = () => req('/manga/retry', { method: 'POST' });
export const checkMangaDuplicates = (withMd5 = true) =>
  req(`/manga/duplicates?md5=${withMd5 ? 1 : 0}`);
export const dedupManga = () => req('/manga/dedup', { method: 'POST' });
export const fixMangaImages = () => req('/manga/fix-images', { method: 'POST' });
export const getJsonFiles = () => req('/json-files');
export const getMangaExclude = () => req('/manga/exclude');
export const setMangaExclude = (series) =>
  req('/manga/exclude', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ series }),
  });
export const deleteMangaSeries = (series) =>
  req('/manga/delete-series', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ series }),
  });
export const manualMangaEpisode = (contentId) =>
  req('/manga/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentId }),
  });
export const mangaImageUrl = (url) => `${BASE}/manga/image?url=${encodeURIComponent(url)}`;

// JSON 对比
export const getRawJsonFile = (fname) => req(`/raw/${fname}`);
export const getCloudJsonFile = (fname) => req(`/cloud/raw/${fname}`);

// 卡池管理
export const getGacha = () => req('/gacha');
export const saveGacha = (pools) =>
  req('/gacha', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pools }),
  });
export const autoGacha = () => req('/gacha/auto');
export const getRevisions = () => req('/revisions');
export const saveRevisions = (revisions) =>
  req('/revisions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revisions }),
  });

// ===== 头像管理 =====

// 状态总览（表格数据源）：q 为 query string（可带 missing/abnormal/type/idFrom/idTo/keyword）
export const getIconsStatus = (q = '') => req(`/icons/status${q ? `?${q}` : ''}`);
export const getIconsInventory = () => req('/icons/inventory');
export const getIconsCosInventory = () => req('/icons/cos-inventory');
export const cosInventory = getIconsCosInventory;

// 元数据（可直接编辑的 JSON）
export const getIconsMeta = () => req('/icons/meta');
export const setIconMeta = (type, id, patch) =>
  req(`/icons/meta/${type}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
export const saveIconsMeta = (items) =>
  req('/icons/meta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

// 生成 / 抓取 / 同步 / 校验
export const genSchaledb = (ids, opts = {}) =>
  req('/icons/gen-schaledb', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, ...opts }),
  });
export const crawlWikiru = (opts = {}) =>
  req('/icons/crawl-wikiru', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
export const wikiruPreview = () => req('/icons/wikiru-preview');
export const syncCos = (opts = {}) =>
  req('/icons/sync-cos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
export const verifyIcons = (opts = {}) =>
  req('/icons/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });

// 任务进度
export const getIconsJob = (name) => req(`/icons/job/${name}`);
export const getIconsJobs = () => req('/icons/jobs');
export const cancelIconsJob = (name) => req(`/icons/job/${name}/cancel`, { method: 'POST' });

// 候选点选 / 上传 / 删除
export const getIconCandidates = (id) => req(`/icons/candidates/${id}`);
export const assignIcon = (payload) =>
  req('/icons/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
export const copyIcon = (payload) =>
  req('/icons/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
export const deleteIcon = (type, id) => req(`/icons/${type}/${id}`, { method: 'DELETE' });
export const uploadIcon = (type, id, file, note = '') => {
  const qs = new URLSearchParams({ type, id });
  if (note) qs.set('note', note);
  return req(`/icons/upload?${qs.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
};
export const deleteIconsBatch = (items) =>
  req('/icons/delete-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

// 单学生三类头像状态
export const getStudentIcons = (id) => req(`/icons/student/${id}`);
// 图片预览地址
export const iconViewUrl = (type, id, v) => `${BASE}/iconview/${type}/${id}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
export const wikiruImgUrl = (hex) => `${BASE}/iconview-wikiru?hex=${hex}`;

// 历次头像发布记录
export const getIconReleases = () => req('/icons/releases');
