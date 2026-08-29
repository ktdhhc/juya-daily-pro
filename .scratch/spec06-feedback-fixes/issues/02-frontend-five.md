# 02 · 前端五修：锚点 / top-12 折叠 / 统一搜索 / 同步按钮

Status: ready-for-agent

## What to build

按 `docs/spec/spec06-feedback-fixes.md` B 线（B1→B5）执行。视觉契约 = `docs/FRONTEND_DESIGN.md` 既有语言（icon-btn / control-input / rule-t / 墨点 / fade-up），数据契约 = spec「契约扩展」节（Worker 由并行 agent 实现，你只按契约写 fetch 与类型；fetch 失败走既有失败态）。

B1 锚点：DailyPage 数据就绪（initialData effect + handleSelect 完成）后消费 `location.hash`（`#article-\d+`），复用 ArticleView 的滚动逻辑（上移/导出 scrollToId，勿重复实现）；元素不存在静默留顶部。
B2 top-12：`/company` 默认渲染 total 前 12，其余进「其他 N 家」折叠（同款细线分格 + 文字链墨点展开/收起）；搜索输入时折叠自动全开。TOP_N=12 常量置顶可调。
B3 统一搜索：报头放大镜 icon-btn（全视图）→ 报头下方全宽搜索条（fade-up，Esc 收起）→ Enter 跳 `/stream?query=`；/stream 上 query 作为可清除 facet chip 并入双向同步与翻页请求。
B4 同步按钮：报头刷新箭头 icon-btn → `POST /api/sync` → 运行中旋转、完成细线小条「同步 N 期 · 失败 M」5s 自散；失败一行错误 + 重试文字链；403 提示「需要同步令牌」。
B5 build 验证（39 家静态页）。

约束：禁碰 worker/、package.json、tsconfig、scripts/、eslint.config.mjs；禁黑名单件（animate-pulse/pill/渐变/shadow-sm）；§6 三问自查新交互进汇报。

## Acceptance criteria

- [ ] 锚点：/stream 点「看原期」→ 阅读页滚到对应 h2（当日无该编号静默留顶）
- [ ] /company：top-12 + 「其他 N 家」折叠展开态正确；搜索时全开
- [ ] 搜索流：报头 → /stream?query= → chip 可清除 → 结果过滤正确
- [ ] 同步按钮：成功/失败/403 三态齐备；运行中旋转
- [ ] `npm run build` 绿（39 家静态页）；四门禁绿
- [ ] §6 三问自查表进汇报

## Blocked by

None - can start immediately（与票 01 并行；不碰 worker/ 与配置文件）
