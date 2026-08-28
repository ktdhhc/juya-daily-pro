# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in this repository.

## Conventions

- **Specs** live in `docs/spec/` as `spec<NN>[-<suffix>]-<slug>.md`（工程性文档、可线性执行，非产品 PRD）
- One spec per work directory: `.scratch/<spec-name>/`（spec-name 与 docs/spec/ 下文件名一致，如 `spec00-stage0-cleanup`）
- Implementation issues are `.scratch/<spec-name>/issues/<NN>-<slug>.md`, numbered from `01`
- Review findings for a spec are recorded in `.scratch/<spec-name>/review.md`（P0-P3 分级）
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<spec-name>/issues/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
