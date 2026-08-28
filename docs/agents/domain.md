# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

**Single-context repo.**

```
/
├── CONTEXT.md            # 术语表：Daily Issue / Item / Category / Primary Link / Related Links / Company / Company Registry / Role
├── docs/
│   ├── adr/              # 0001-0014 架构决策记录（0013 本地优先、0014 v1 简化为最新口径）
│   ├── CURRENT_STATE.md  # 当前真相快照（先读）
│   └── spec/             # 各阶段工程 spec
└── src/
```

## Before exploring, read these

- **`docs/CURRENT_STATE.md`** first — 精简事实快照，本仓库约定它是 agent 会话默认首读文件
- **`CONTEXT.md`** — 术语表；命名输出（issue 标题、测试名、组件名）必须用它定义的词，避开 `_Avoid_` 同义词
- **`docs/adr/`** — 只按需读与当前工作区域相关的 ADR；v1 裁剪口径以 ADR-0013 / 0014 为准

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids (entry/article/section/vendor/white list/时间线视图 etc.).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for review).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0013 (本地优先、D1 单存储) — but worth reopening because…_
