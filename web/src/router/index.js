import { createRouter, createWebHistory } from 'vue-router';
import StudentList from '../views/StudentList.vue';
import StudentDetail from '../views/StudentDetail.vue';
import AliasConfig from '../views/AliasConfig.vue';
import SkipConfig from '../views/SkipConfig.vue';
import RevisionsConfig from '../views/RevisionsConfig.vue';
import VersionsView from '../views/VersionsView.vue';
import MangaView from '../views/MangaView.vue';
import JsonDiffView from '../views/JsonDiffView.vue';
import GachaView from '../views/GachaView.vue';

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'list', component: StudentList },
    { path: '/alias-config', name: 'alias-config', component: AliasConfig },
    { path: '/skip-config', name: 'skip-config', component: SkipConfig },
    { path: '/revisions-config', name: 'revisions-config', component: RevisionsConfig },
    { path: '/versions', name: 'versions', component: VersionsView },
    { path: '/manga', name: 'manga', component: MangaView },
    { path: '/json-diff', name: 'json-diff', component: JsonDiffView },
    { path: '/gacha', name: 'gacha', component: GachaView },
    { path: '/student/:id', name: 'detail', component: StudentDetail },
  ],
});
