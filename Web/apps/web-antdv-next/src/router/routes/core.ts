import type { RouteRecordRaw } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';

import { $t } from '#/locales';

const BasicLayout = () => import('#/layouts/basic.vue');
const AuthPageLayout = () => import('#/layouts/auth.vue');
/** 全局404页面 */
const fallbackNotFoundRoute: RouteRecordRaw = {
  component: () => import('#/views/_core/fallback/not-found.vue'),
  meta: {
    hideInBreadcrumb: true,
    hideInMenu: true,
    hideInTab: true,
    title: '404',
  },
  name: 'FallbackNotFound',
  path: '/:path(.*)*',
};

/** 基本路由，这些路由是必须存在的 */
const coreRoutes: RouteRecordRaw[] = [
  {
    name: 'LegacyUnauthorized',
    path: '/401',
    component: () => import('#/views/_core/fallback/forbidden.vue'),
    meta: { title: '权限不足', requiresAuth: true, hideInMenu: true, hideInTab: true },
  },
  {
    name: 'CallTel',
    path: '/$callTel',
    component: () => import('#/views/_core/call-tel/index.vue'),
    meta: { title: '拨号', hideInMenu: true, hideInTab: true },
  },
  {
    name: 'ProfileLayout',
    path: '/profile',
    component: BasicLayout,
    meta: { requiresAuth: true, hideInMenu: true, hideInBreadcrumb: true, title: '个人中心' },
    children: [{
      name: 'Profile',
      path: '',
      component: () => import('#/views/_core/profile/index.vue'),
      meta: { requiresAuth: true, hideInMenu: true, title: '个人中心' },
    }],
  },
  {
    name: 'LegacyHome',
    path: '/home',
    redirect: '/dashboard/home',
    meta: { title: '首页', hideInMenu: true, requiresAuth: true },
  },
  /**
   * 根路由
   * 使用基础布局，作为所有页面的父级容器，子级就不必配置BasicLayout。
   * 此路由必须存在，且不应修改
   */
  {
    name: 'LegacyLogin',
    path: '/login',
    redirect: (to) => ({ path: LOGIN_PATH, query: to.query }),
    meta: { title: '登录', hideInMenu: true },
  },
  {
    component: BasicLayout,
    meta: {
      hideInBreadcrumb: true,
      title: 'Root',
    },
    name: 'Root',
    path: '/',
    redirect: preferences.app.defaultHomePath,
    children: [
      {
        name: 'JobDashboard',
        path: '/platform/job/dashboard',
        component: () => import('#/views/system/job/dashboard.vue'),
        meta: { title: '任务看板', requiresAuth: true, hideInMenu: true },
      },
      {
        name: 'DatabaseVisual',
        path: '/develop/database/visual',
        component: () => import('#/views/system/database/visual.vue'),
        meta: { title: '库表关系图', requiresAuth: true, hideInMenu: true },
      },
      {
        name: 'HomeWorkbench',
        path: '/dashboard/home',
        component: () => import('#/views/home/index.vue'),
        meta: { title: '工作台', requiresAuth: true, hideInMenu: true },
      },
      {
        name: 'AdminAbout',
        path: '/about',
        component: () => import('#/views/home/about.vue'),
        meta: { title: '关于项目', requiresAuth: true, hideInMenu: true },
      },
      {
        name: 'ReceivedNoticeCenter',
        path: '/dashboard/notice',
        component: () => import('#/views/home/notice/index.vue'),
        meta: { title: '通知中心', hideInMenu: true, requiresAuth: true },
      },
    ],
  },
  {
    component: AuthPageLayout,
    meta: {
      hideInTab: true,
      title: 'Authentication',
    },
    name: 'Authentication',
    path: '/auth',
    redirect: LOGIN_PATH,
    children: [
      {
        name: 'Login',
        path: 'login',
        component: () => import('#/views/_core/authentication/login.vue'),
        meta: { title: $t('page.auth.login') },
      },
      {
        name: 'TokenLogin',
        path: 'token',
        component: () => import('#/views/_core/authentication/token-login.vue'),
        meta: { title: '第三方登录' },
      },
      {
        name: 'QrCodeLogin',
        path: 'qrcode-login',
        component: () => import('#/views/_core/authentication/qrcode-login.vue'),
        meta: { title: '扫码登录' },
      },
      {
        name: 'CodeLogin',
        path: 'code-login',
        component: () => import('#/views/_core/authentication/code-login.vue'),
        meta: {
          title: $t('page.auth.codeLogin'),
        },
      },
      {
        name: 'Register',
        path: 'register',
        component: () => import('#/views/_core/authentication/register.vue'),
        meta: {
          title: $t('page.auth.register'),
        },
      },
    ],
  },
];

export { coreRoutes, fallbackNotFoundRoute };
