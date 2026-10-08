import { defineConfig } from '@vben/eslint-config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

// 格式由仓库现有的 Prettier 管理，ESLint 继续检查代码质量。
export default defineConfig([eslintConfigPrettier]);
