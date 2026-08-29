# Spec 06 Code Review · 2026-08-29

审查范围：registry 治理应用（D1）、/api/items `q` 参数、POST /api/sync、companiesPruneSql、前端五修（锚点/top-12 折叠/统一搜索/同步按钮）、公司 Logo 印。审查人：主会话（四门禁独立复跑 + **IAB 浏览器全流程实测**，含 C 线揪出的 P0 修复）。

## 结论：PASS（无未决 P0/P1；P0×1 与 P1×2 均已修复并复验）

## 验收核验（主会话独立复跑）

- [x] `npm test` 126/126；双 typecheck 0 错；lint 0 error / 11 warn；build 44 静态页（39 公司 + 4 路由 + logos 资产）
- [x] D1：companies=39、旧 id（trae/workbuddy/amp/internlm/modelscope/happyoyster）零残留；**missing_owner 242→128**；items 1105→1116（新期 2026-08-29 顺带同步）
- [x] 浏览器实测（IAB + evaluate 逐项）：
  - `/company`：**真实 logo 墙**（34/39，纸底细边 chip）+ top-12 + 「其他 27 家」折叠/展开（● 收起态实测）
  - `/stream?query=TRAE`：结果全部挂**字节跳动 logo**（bytedance.ico ×7）——反馈 #1 的直观闭环
  - 报头搜索：放大镜 → 输入条 → Enter「DeepSeek」→ `/stream?query=DeepSeek` + 9 个 DeepSeek logo + 清除 chip
  - 同步按钮：旋转运行态 → 「● 同步 4 期」状态条（窗口期数正确）→ 自散
  - 锚点：/stream 点卡片 → `/?date=2026-08-25#article-7` → **scrollTop 5890、目标 h3 距视口顶 64px**

## C 线揪出并修复的问题

### P0（不修则功能完全不可用）

1. **条目锚点自始不存在**：日报正文的条目标题是 `###`（h3），而 react-markdown components 只给 h2 挂了 `article-N` id——**所有**看原期/TOC 跳转自原始版本起就静默落空（spec04 review 也漏了这层）。修复：components 映射补 `h3: ArticleH2`（一行）。浏览器复验：目标 h3 找到且滚动到位。

### P1

1. **IAB/部分环境 smooth 滚动被吞**（实测 `behavior:"smooth"` 800ms 后仍为 0，瞬时滚动正常）：深链锚点落位改为 `"auto"` 瞬时——本就是原生 #锚点语义；`scrollToId` 加 behavior 参数，站内 TOC/标签点击保留 smooth。修复后复验 5890/64px。
2. **`gen:registry` 会把 yaml 新增的 `domain` 字段泄漏进 registry.generated.ts**（下一次任何人重跑 gen 就触发，excess property 直接炸 typecheck）。修复：renderRegistry 只 pick Company 契约六字段；复验生成物 `domain` 零命中。

## 分级发现（未决）

### P2

1. lint warnings 10→11：LogoSeal 的 `no-img-element`（票面明确要求 `<img>`，仓库无 disable 先例，如实保留）。
2. 5 家公司 logo 拉取失败走首字回退（stepfun/mistral/kunlun/thinkingmachines/antgroup——unavatar 源图 ≤500B 或 404，clearbit 被本网络墙）；`npm run logos:fetch` 可随时重跑补齐。
3. 搜索条收起方式仅 Esc/再点放大镜；从其他视图跳转后词不回填输入框。可用性可接受，留观察。

### P3

1. `POST /api/sync` 首测发现 `env.DB.exec` 按裸换行拆句、不容字面量换行——已改 `env.DB.batch(prepare())`（引号感知 + 隐式事务）。该平台特性已记入 CURRENT_STATE。
2. 同步脚本 registry 镜像刷新（upsert+prune）置于运行开头而非末尾——保证匹配读到新镜像，语义更正确。
3. 蚂蚁 alias 用 `Ling-`（带连字符）规避英文子串误伤，是 alias 纪律的好样本。

## 流程观察

- 用户反馈→工程问题的映射质量取决于**用数据说话**：missing_owner 样本标题直接点名列出该补的公司（智谱/DeepSeek/豆包…），治理不再靠猜。
- happyoyster 的归属判定（spec 猜快手系，实证阿里系）说明：registry 治理必须回到 Item 原文找证据，凭印象会错。
- IAB 浏览器验证的可靠姿势已摸索成熟：**截图看视觉、snapshot/evaluate 看结构与行为、坐标点击不可靠时用页面内 evaluate 直接触发**。
