import { defineConfig } from '@vben/eslint-config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

// 格式由仓库现有的 Prettier 管理，ESLint 继续检查代码质量。
// 自动生成 SDK 由生成链和 TypeScript 验证，不执行手写代码的格式规则。
export default defineConfig([
  { ignores: ['apps/web-antdv-next/src/api-services/**'] },
  eslintConfigPrettier,
]);
