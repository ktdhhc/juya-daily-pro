# Spec 04 Code Review · 2026-08-29

审查范围：worker/tsconfig 双 typecheck 接线、registry 迁移、worker/api（queries + routes + 入口）、前端三视图与 FRONTEND_DESIGN 落地、阅读页一致性改造。审查人：主会话（queries 契约逐字段比对、四门禁独立复跑、双进程集成 curl、**IAB 浏览器四屏截图验证**）。

## 结论：PASS（无 P0 / 无 P1；含实现期修复 1 枚真 bug；P2×3 均为记录项）

## 验收核验（主会话独立复跑）

- [x] `npm test` 104/104（78 + queries 26）；双 typecheck 0 错；lint 0 error / 10 warn；build 35 静态页（30 公司 + 4 路由）
- [x] 五端点 curl 冒烟经 Next 代理（3000→8787 rewrites）全部 200，JSON 键结构与契约逐字段一致
- [x] 404 契约：company_not_found / daily_not_found；405 + Allow: GET；400 invalid_param（agent A 附加验证）
- [x] 浏览器截图四屏（见下）

## 浏览器多模态验证（主会话亲自执行，截图存档）

| 界面 | 验证点 | 结果 |
|---|---|---|
| `/stream` 首屏 | 页边编号列、细线分隔、日期行+条数、衬线标题+↗、公司钤印（G/A/M/O 各家色）、竖排 facet 标签、墨点选项、报头 3px 墨线激活 | ✅ 全部符合 FRONTEND_DESIGN |
| `/stream` facet 交互 | 点击 Anthropic → URL `?company=anthropic` 同步、墨点转实心加粗、「Anthropic ×」+ 清除全部标记、按天重组 | ✅ ADR-0012 落地 |
| `/company` 索引 | 印章卡片墙（各家色印 + total 倒序 + notes）、1px 细线分格网格（非圆角卡片）、搜索框、hover 暖纸态 | ✅ |
| `/company/anthropic` | 档案头五块全齐：52px 大方印+别名行 / 统计（213·84·08-28·跨度）/ 单色墨条分类分布（无图表库）/ ≤8 关联公司钤印 / 条目区 | ✅ ADR-0007 落地 |

§6 反通用三问：截图范围内全部通过——没有任何 rounded-xl 卡片盒、pill 徽章、animate-pulse、阴影上浮；身份元素（页边编号列/钤印/竖排/细线）在每屏 ≥3 项命中。

## 实现期发现并修复

1. **routes 裸 `return methodGuardGet(...)` 使 HttpError 逃出 try/catch**（workerd 500 页代替 400/404）——改为 `return await` 后复验通过。这是 queries 单测覆盖不到、靠 curl 冒烟才现形的真 bug，验证了 ADR-0011"Worker fetch 入口不测但必须手动冒烟"的分工。

## 分级发现

### P0 / P1

无。

### P2（记录，后续处理）

1. **截图证据补全（环境恢复后）**：浏览器 wedged 的根因确诊为 **9 个三代同堂的 wrangler supervisor 僵尸进程**轮番重生 workerd、霸占 8787 半开 socket——依赖 /api 的页面全部在等死连接，这是 IAB"卡死"的真相。清场后单实例环境全部 200，补验通过：首页报头（刊号 `第 72 期 · 2026-08-28` + 图标组 + 3px 墨线激活）、阅读页内容加载（40KB DOM、概览/视频版/正文齐）、`?date=` 写 URL ✓。仍未截图的：合订本日历展开态、主题切换、无限滚动、公司页差异渲染滚动态——代码审查+静态产物已覆盖，建议用户本地肉眼过一遍。
2. **lint warnings 5→10**：新增 5 处均为新组件挂载期 fetch→setState 的 `set-state-in-effect`（与既有模式同类，spec04 边界内不重构）。spec05/后续可统一收敛。
3. **B 线自报的契约解释项**：①描边印仅在 variant="company" 语境使用（/stream 全实心等位）——ADR-0014 无 role 下的合理解释，截图核对通过；②分类 facet 无计数（契约无该统计端点）——如需后续加 `/api/meta`。

### P3（观察项）

1. Next 16 export 产出平铺 `<slug>.html`（非 `<slug>/index.html`）——与既有 out/ 形态一致，部署主机自动映射，无行动。
2. `next.config` 未加 trailingSlash——维持现状。
3. Header 品牌链接从遗留的 `/juya-daily` 改为 `/`——正确的顺手修复。

## 流程观察

- 双 agent 并行（worker ∥ 前端）以钉死契约为界面，全程零文件冲突、零契约漂移——钉契约先行的方式在 spec04 这种双端规格里价值最大。
- agent A 对 spec A1 的 types 冲突（workers-types vs node 测试文件）给出的解法（worker tsconfig exclude 测试文件）是对平台类型冲突的标准处置，且保持了"测试跑 Node、运行时零 node 依赖"的边界（grep 证实）。
- IAB 浏览器管线退化属于环境问题（dev 服务器全程 200），已通过"重开标签页"恢复过两次；后续 spec 的浏览器验证建议每屏一开一关、避免复用长驻标签。
