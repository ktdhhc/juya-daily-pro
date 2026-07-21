# Juya AI Daily Plus

把 [daily.juya.uk](https://daily.juya.uk) 每日发布的 AI 资讯合集，按"时间线"与"公司"两个维度重新整理，便于个人快速查找与捋清信息。

## Language

**Daily Issue**:
daily.juya.uk 每日发布的一期 AI 资讯合集，对应一个 `YYYY-MM-DD.md` 文件。
_Avoid_: 早报、post、batch

**Item**:
一条被 `#N` 编号标注的事件记录，是本项目重新整理后的数据原子单位。每个 Item 一对一对应日报里的一个 `#N` 条目，包含标题、主链接、摘要、正文、相关链接，并归属一个 Category。同日同主话题的补丁也独立成 Item（不折叠）。
_Avoid_: entry、article、news、条目

**Category**:
日报"概览"下的分组标签（如：要闻 / 模型发布 / 开发生态 / 产品应用 / 行业动态 / 前瞻与传闻 / 技术与洞察）。每个 Item 恰好归属一个 Category。
_Avoid_: section、group、分类标签

**Primary Link**:
Item 标题旁 `[↗]` 所指向的一手官方源（厂商公告、X 帖子、GitHub 仓库等）。日报里部分 `#N` 条目没有 Primary Link，这类条目通常是同日对上一条事件的自述后续。
_Avoid_: source link、main url、主源

**Related Links**:
Item 正文末"相关链接："列表里的 2–5 条补充材料（媒体报道、HF 页、辅助推文等），与 Primary Link 一起作为 Item 的完整信息保留。
_Avoid_: references、supplementary

**Company**:
一家活跃的科技或 AI 公司（厂商、平台方、开源组织等），登记在 Company Registry 中。一条 Item 归属一个或多个 Company；非科技/AI 主业的实体（投资方、传统行业合作方、媒体源）不计入。
_Avoid_: vendor、org、主体、机构

**Company Registry**:
本项目维护的"当前活跃的科技与 AI 公司"白名单，是 Item 公司归属的唯一闸门：只有登记在册的 Company 才会被标到 Item 上。可由 LLM 提议新增候选，最终入册需人工确认。
_Avoid_: 公司列表、white list、entity table

**Role**:
Item 上每个 Company 的参与身份：`primary`（事件主导方/发布方）、`partner`（合作方/共同参与方）、`subject`（被报道对象，非主动方）。单 Company 归属时无需 Role；多 Company 归属时每家各带一个 Role。
_Avoid_: 角色、参与类型