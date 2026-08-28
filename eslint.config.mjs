import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const eslintConfig = [
  {
    ignores: ['.next/**', 'out/**', 'worker/**', '.wrangler/**'],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // 正确性规则：预设将其定为 warn，按票 03 要求保持 error（未用变量必须修，不允许靠降级过关）。
      '@typescript-eslint/no-unused-vars': 'error',
      // 降级为 warn：存量 4 处（DailyPage.tsx 72-86、ThemeToggle.tsx 13）是挂载期 props→state 同步与
      // URL 同步的既有模式；正确修法需重构状态流，违背本 spec「零行为变更」约束。
      // 该规则属于渲染级联的性能建议（非正确性缺陷），保留 warn 可见性，留待后续 spec 处理。
      'react-hooks/set-state-in-effect': 'warn',
      // 说明：no-undef 由 typescript-eslint 预设关闭（TS 编译器已覆盖该检查，TS 项目标准做法），
      // 本配置未额外改动；react-hooks/rules-of-hooks 保持预设 error，未被降级。
    },
  },
];

export default eslintConfig;
