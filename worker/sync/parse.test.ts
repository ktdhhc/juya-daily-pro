// parseIssue TDD 测试
// 规则真相源: docs/spec/spec01-issue-parser.md 2.1 / 2.2
// 快照防结构漂移（2 fixture × 投影摘要 + 首条完整对象）+ 边界 case inline 断言。
// fixture 计数 19 / 14 写死在断言里，防漏读。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIssue, type ParsedIssue } from "./parse";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), "utf8");

// spec 2.3：条目投影摘要
const project = (issue: ParsedIssue) =>
  issue.items.map((i) => ({
    id: i.id,
    tag: i.tag,
    sequenceInt: i.sequenceInt,
    category: i.category,
    title: i.title,
    hasLink: !!i.primaryLink,
    summaryLen: i.summary.length,
    links: i.relatedLinks.length,
    enrichState: i.enrichState,
  }));

// 带 2026-01-01 日期头的最小 issue 模板
const issueOf = (body: string): string => `# AI 早报 2026-01-01\n\n${body}`;

describe("fixture 快照 · 2026-08-27", () => {
  it("条目投影摘要 + 计数 19", () => {
    const issue = parseIssue(fixture("2026-08-27"));
    expect(issue.date).toBe("2026-08-27");
    expect(issue.items).toHaveLength(19); // 写死，防漏读
    expect(project(issue)).toMatchInlineSnapshot(`
      [
        {
          "category": "要闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-1",
          "links": 4,
          "sequenceInt": 1,
          "summaryLen": 280,
          "tag": "#1",
          "title": "智谱正式发布并开源 GLM-5.3-Flash",
        },
        {
          "category": "要闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-2",
          "links": 3,
          "sequenceInt": 2,
          "summaryLen": 171,
          "tag": "#2",
          "title": "阿里发布 Qwen3.8-Flash 模型",
        },
        {
          "category": "要闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-3",
          "links": 1,
          "sequenceInt": 3,
          "summaryLen": 79,
          "tag": "#3",
          "title": "OpenAI 称误路由 5.5-mini 问题已修复并致歉",
        },
        {
          "category": "模型发布",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-4",
          "links": 3,
          "sequenceInt": 4,
          "summaryLen": 118,
          "tag": "#4",
          "title": "Google 发布 Gemini 3.5 Transcribe 语音转文本模型",
        },
        {
          "category": "开发生态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-5",
          "links": 2,
          "sequenceInt": 5,
          "summaryLen": 63,
          "tag": "#5",
          "title": "Antigravity CLI 上线语音模式，可与 agent 对话",
        },
        {
          "category": "开发生态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-6",
          "links": 1,
          "sequenceInt": 6,
          "summaryLen": 54,
          "tag": "#6",
          "title": "Claude Code 现可自动起草反馈报告，用户批准后发送",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-7",
          "links": 1,
          "sequenceInt": 7,
          "summaryLen": 64,
          "tag": "#7",
          "title": "Claude in Chrome 正式面向所有付费订阅方案开放",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-8",
          "links": 1,
          "sequenceInt": 8,
          "summaryLen": 63,
          "tag": "#8",
          "title": "Claude 在 Cowork 中推出内置浏览器，未来一周内上线",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-9",
          "links": 2,
          "sequenceInt": 9,
          "summaryLen": 68,
          "tag": "#9",
          "title": "Grok Bot 向 SuperGrok 和 Cursor Pro 订阅用户开放并重置每周用量",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-10",
          "links": 2,
          "sequenceInt": 10,
          "summaryLen": 116,
          "tag": "#10",
          "title": "谷歌为 Gemini Live 推出重大生产力升级",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-11",
          "links": 1,
          "sequenceInt": 11,
          "summaryLen": 65,
          "tag": "#11",
          "title": "OpenAI 推介 $visualize：可在 ChatGPT Work 和 Codex 中生成可视化图表",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-12",
          "links": 1,
          "sequenceInt": 12,
          "summaryLen": 66,
          "tag": "#12",
          "title": "Manus 开放数据恢复，服务恢复正常稳定运行",
        },
        {
          "category": "技术与洞察",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-13",
          "links": 3,
          "sequenceInt": 13,
          "summaryLen": 152,
          "tag": "#13",
          "title": "OpenAI 公布 Hugging Face 入侵事件技术报告",
        },
        {
          "category": "技术与洞察",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-14",
          "links": 2,
          "sequenceInt": 14,
          "summaryLen": 54,
          "tag": "#14",
          "title": "Anthropic 开放 Claude 聚合对话研究",
        },
        {
          "category": "前瞻与传闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-15",
          "links": 1,
          "sequenceInt": 15,
          "summaryLen": 81,
          "tag": "#15",
          "title": "爆料称 Fable 5.1 或最快周四发布，已在网页版灰度",
        },
        {
          "category": "前瞻与传闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-16",
          "links": 1,
          "sequenceInt": 16,
          "summaryLen": 68,
          "tag": "#16",
          "title": "月之暗面传与三云巨头洽 Kimi K3 分成",
        },
        {
          "category": "前瞻与传闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-17",
          "links": 1,
          "sequenceInt": 17,
          "summaryLen": 69,
          "tag": "#17",
          "title": "MiniMax：M3 Pro 参数规模预计提升至约 3T",
        },
        {
          "category": "前瞻与传闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-18",
          "links": 2,
          "sequenceInt": 18,
          "summaryLen": 104,
          "tag": "#18",
          "title": "报道称 Anthropic 与 Nscale 签署约 450 亿美元算力租用协议",
        },
        {
          "category": "前瞻与传闻",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260827-19",
          "links": 2,
          "sequenceInt": 19,
          "summaryLen": 136,
          "tag": "#19",
          "title": "Altman 称 OpenAI 预计 2026 年底将拥有其可称为 AGI 的内部系统",
        },
      ]
    `);
  });

  it("首条 Item 完整对象", () => {
    const issue = parseIssue(fixture("2026-08-27"));
    expect(issue.items[0]).toMatchInlineSnapshot(`
      {
        "bodyMd": "智谱正式发布并开源原生多模态模型 GLM-5.3-Flash。该模型总参数 320B、激活参数 18B，原生支持文本、图片和视频输入，支持 1M 上下文。模型以 MIT License 开源，权重已在 HuggingFace 公开。发布前，智谱以代号 Ox Alpha 在 OpenCode 和 OpenRouter 上进行大规模测试。

      架构方面，GLM-5.3-Flash 是首个采用稀疏注意力与线性注意力混合架构的开源前沿模型，并采用流形约束超连接进一步提升 scaling 能力。官方通过 IndexPool 将索引器的 4 个缓存向量压缩为 1 个，以降低 1M 上下文下的时延与内存开销。

      性能方面，官方称 GLM-5.3-Flash 在 Artificial Analysis Intelligence Index v4.1.1 中取得 57 分；在六项 coding 和 agentic 基准中全面超越 GLM-5.2。官方基座模型评测显示，GLM-5.3-Flash-Base 整体超越 GLM-4.5-Base，在大多数基准上与 GLM-5-Base 相当。

      能力方面，视觉能力被原生融入 Coding 循环，模型可在代码、浏览器和图形界面之间协同工作，支持前端开发、游戏构建、Blender 3D 场景以及 BUA、CUA 驱动的真实环境操作。使用上，思考模式不可关闭，thinking.type 仅支持 enabled。

      推理服务方面，智谱称过去一周首次在大规模流量中使用国产芯片集群提供服务，芯片通过自研高带宽互联网络连接，Ox Alpha 测试期间的全部流量也由国产芯片提供算力。官方称与同一硬件上的初始基线相比，端到端服务性能提升 3 倍，硬件效率和单 token 成本已达到与主流英伟达 GPU 相当的水平。

      定价与可用性方面，在GLM Coding Plan 中调用 GLM-5.3-Flash 的可用额度是 GLM-5.3 的 3 倍，同时为庆祝模型发布，官方重置了GLM Coding Plan用户的额度。国内 API 定价原价为 GLM-5.3 的十分之一，并开启限时两周五折折扣。

      ![](https://assets.juya.uk/imagehub/aidaily/e10f520d-67ae-4ec8-8c0e-f0b608ed79a7/d9f63e95-c787-47f9-bc4d-7810ea632496/m001_401c7880.png)

      ![](https://assets.juya.uk/imagehub/aidaily/e10f520d-67ae-4ec8-8c0e-f0b608ed79a7/d9f63e95-c787-47f9-bc4d-7810ea632496/m002_d4255160.png)

      ![](https://assets.juya.uk/imagehub/aidaily/e10f520d-67ae-4ec8-8c0e-f0b608ed79a7/d9f63e95-c787-47f9-bc4d-7810ea632496/m003_c1eabcc9.png)

      ![](https://assets.juya.uk/imagehub/aidaily/e10f520d-67ae-4ec8-8c0e-f0b608ed79a7/d9f63e95-c787-47f9-bc4d-7810ea632496/m004_a9c60c85.png)

      ![](https://assets.juya.uk/imagehub/aidaily/e10f520d-67ae-4ec8-8c0e-f0b608ed79a7/d9f63e95-c787-47f9-bc4d-7810ea632496/m005_51b3425c.png)",
        "category": "要闻",
        "date": "2026-08-27",
        "enrichState": "ok",
        "id": "20260827-1",
        "owners": [],
        "primaryLink": "https://z.ai/blog/glm-5.3-flash",
        "relatedLinks": [
          "https://z.ai/blog/glm-5.3-flash",
          "https://mp.weixin.qq.com/s/O7RCVME1Kut-Z2oFYhgrkw?scene=1&click_id=837440420",
          "https://huggingface.co/zai-org/GLM-5.3-Flash",
          "https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash",
        ],
        "sequenceInt": 1,
        "summary": "智谱正式发布并开源原生多模态模型 GLM-5.3-Flash，该模型总参数 320B、激活参数 18B，采用稀疏注意力与线性注意力混合架构。官方称其在各项基准测试和实际使用中全面超越 GLM-5.2。发布前该模型以匿名名称 Ox Alpha 在 OpenCode 和 OpenRouter 免费测试。在GLM Coding Plan 中调用 GLM-5.3-Flash 的可用额度是 GLM-5.3 的 3 倍，同时为庆祝模型发布，官方重置了GLM Coding Plan用户的额度。国内 API 定价为 GLM-5.3 的十分之一，同时上线五折优惠限时两周。",
        "tag": "#1",
        "title": "智谱正式发布并开源 GLM-5.3-Flash",
      }
    `);
  });
});

describe("fixture 快照 · 2026-08-25", () => {
  it("条目投影摘要 + 计数 14", () => {
    const issue = parseIssue(fixture("2026-08-25"));
    expect(issue.date).toBe("2026-08-25");
    expect(issue.items).toHaveLength(14); // 写死，防漏读
    expect(project(issue)).toMatchInlineSnapshot(`
      [
        {
          "category": "开发生态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-1",
          "links": 3,
          "sequenceInt": 1,
          "summaryLen": 66,
          "tag": "#1",
          "title": "MiniMax与GMI Cloud合作开放M3等模型14天免费访问",
        },
        {
          "category": "开发生态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-2",
          "links": 3,
          "sequenceInt": 2,
          "summaryLen": 64,
          "tag": "#2",
          "title": "阿里云云工开物面向高校学生发放Qoder CN专业版",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-3",
          "links": 1,
          "sequenceInt": 3,
          "summaryLen": 58,
          "tag": "#3",
          "title": "OpenAI 推出美国大学生四个月免费 ChatGPT Plus",
        },
        {
          "category": "产品应用",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-4",
          "links": 1,
          "sequenceInt": 4,
          "summaryLen": 67,
          "tag": "#4",
          "title": "Anthropic 升级 Claude 流式渲染器",
        },
        {
          "category": "模型发布",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-5",
          "links": 2,
          "sequenceInt": 5,
          "summaryLen": 69,
          "tag": "#5",
          "title": "Agnes AI 开源 Agnes 2.5 Pro Alpha 多模态推理模型",
        },
        {
          "category": "模型发布",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-6",
          "links": 1,
          "sequenceInt": 6,
          "summaryLen": 58,
          "tag": "#6",
          "title": "阿里视频模型Wan3.0正式上线 API限时7折",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-7",
          "links": 1,
          "sequenceInt": 7,
          "summaryLen": 116,
          "tag": "#7",
          "title": "字节整合TRAE与扣子至豆包体系",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-8",
          "links": 1,
          "sequenceInt": 8,
          "summaryLen": 130,
          "tag": "#8",
          "title": "小米发布玄戒三款自研芯片并展出AI Cube原型机",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-9",
          "links": 2,
          "sequenceInt": 9,
          "summaryLen": 81,
          "tag": "#9",
          "title": "SpaceXAI部署NVIDIA Vera CPU并计划发射太空版NVL72",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-10",
          "links": 1,
          "sequenceInt": 10,
          "summaryLen": 107,
          "tag": "#10",
          "title": "NVIDIA 发布 Vera Rubin NVL72 性能数据",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-11",
          "links": 2,
          "sequenceInt": 11,
          "summaryLen": 58,
          "tag": "#11",
          "title": "NVIDIA发布全面投产的Groq 3 LPX扩展Vera Rubin推理",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-12",
          "links": 1,
          "sequenceInt": 12,
          "summaryLen": 64,
          "tag": "#12",
          "title": "传Nvidia拟投资Perplexity AI数十亿美元",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-13",
          "links": 2,
          "sequenceInt": 13,
          "summaryLen": 59,
          "tag": "#13",
          "title": "Mistral AI 与 HUMAIN 布局中东主权 AI 基建",
        },
        {
          "category": "行业动态",
          "enrichState": "ok",
          "hasLink": true,
          "id": "20260825-14",
          "links": 2,
          "sequenceInt": 14,
          "summaryLen": 58,
          "tag": "#14",
          "title": "Thinking Machines Lab发布开源模型安全资助",
        },
      ]
    `);
  });

  it("首条 Item 完整对象", () => {
    const issue = parseIssue(fixture("2026-08-25"));
    expect(issue.items[0]).toMatchInlineSnapshot(`
      {
        "bodyMd": "MiniMax与GMI Cloud官方宣布，在8月24日至9月6日期间推出为期14天的免费无限制访问活动（有反滥用及速率限制机制）。此次活动涵盖MiniMax M3和M2.7模型，以及Speech 2.8和Music 3.0功能。开发者可通过GMI API密钥，活动期间内上述服务不设使用量限制。

      ![](https://assets.juya.uk/imagehub/aidaily/1f3785c5-e218-49af-951f-5b8f02f44f37/fb9b3ca3-3eec-437c-9e1b-471adab54af7/m001_85e03b17.png)",
        "category": "开发生态",
        "date": "2026-08-25",
        "enrichState": "ok",
        "id": "20260825-1",
        "owners": [],
        "primaryLink": "https://www.gmicloud.ai/minimax-week",
        "relatedLinks": [
          "https://www.gmicloud.ai/minimax-week",
          "https://x.com/MiniMax_AI/status/2091948930124947941",
          "https://x.com/gmi_cloud/status/2091925007756857368",
        ],
        "sequenceInt": 1,
        "summary": "MiniMax与GMI Cloud官方宣布，8月24日至9月6日提供14天免费无限制访问，涵盖MiniMax M3及M2.7等模型。",
        "tag": "#1",
        "title": "MiniMax与GMI Cloud合作开放M3等模型14天免费访问",
      }
    `);
  });
});

describe("边界 case", () => {
  it("无主链接条目：title 不含 []，primaryLink 缺省", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### 某产品发布 `#1`\n> 摘要文字\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n",
      ),
    );
    expect(issue.items).toHaveLength(1);
    expect(issue.items[0].title).toBe("某产品发布");
    expect(issue.items[0].primaryLink).toBeUndefined();
    expect(issue.items[0].id).toBe("20260101-1");
    expect(issue.items[0].enrichState).toBe("ok");
  });

  it("缺 #N：id 落 -x<k>，sequenceInt 0，tag 空，pending", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [无编号条目](https://a.com)\n> 摘要\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n",
      ),
    );
    expect(issue.items).toHaveLength(1);
    expect(issue.items[0].id).toBe("20260101-x1");
    expect(issue.items[0].tag).toBe("");
    expect(issue.items[0].sequenceInt).toBe(0);
    expect(issue.items[0].enrichState).toBe("pending");
  });

  it("缺 > 摘要：summary 空，正文保留进 bodyMd，pending", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [有正文无摘要](https://a.com) `#1`\n\n正文段落，没有引用摘要行。\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n",
      ),
    );
    expect(issue.items[0].summary).toBe("");
    expect(issue.items[0].bodyMd).toBe("正文段落，没有引用摘要行。");
    expect(issue.items[0].enrichState).toBe("pending");
  });

  it("缺相关链接块：relatedLinks []，pending", () => {
    const issue = parseIssue(
      issueOf("## 科技\n### [无相关链接](https://a.com) `#1`\n> 摘要\n\n---\n"),
    );
    expect(issue.items[0].relatedLinks).toEqual([]);
    expect(issue.items[0].enrichState).toBe("pending");
  });

  it("重复 #N：第二个落 -x<k>", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [第一条](https://a.com) `#3`\n> 摘要一\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n\n### [第二条](https://b.com) `#3`\n> 摘要二\n\n相关链接：\n- [https://b.com](https://b.com)\n\n---\n",
      ),
    );
    expect(issue.items).toHaveLength(2);
    expect(issue.items[0].id).toBe("20260101-3");
    expect(issue.items[1].id).toBe("20260101-x1");
    expect(issue.items[1].tag).toBe("#3");
    expect(issue.items[1].sequenceInt).toBe(3);
  });

  it("文末提示尾行不产出 Item", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [唯一条目](https://a.com) `#1`\n> 摘要\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n\n**提示**：内容由AI辅助创作，可能存在**幻觉**和**错误**。\n",
      ),
    );
    expect(issue.items).toHaveLength(1);
    expect(issue.items[0].title).toBe("唯一条目");
    expect(issue.items[0].enrichState).toBe("ok");
    expect(issue.items.some((i) => i.title.includes("提示"))).toBe(false);
  });

  it("无概览区 / 无 --- 时正文仍可解析", () => {
    const issue = parseIssue(
      "# AI 早报 2026-01-01\n\n## 科技\n### [裸条目](https://a.com) `#1`\n> 摘要\n",
    );
    expect(issue.items).toHaveLength(1);
    expect(issue.items[0].category).toBe("科技");
    expect(issue.items[0].id).toBe("20260101-1");
    expect(issue.items[0].summary).toBe("摘要");
  });

  it("无日期抛 Error(\"issue date not found\")", () => {
    expect(() =>
      parseIssue("## 科技\n### [t](https://a.com) `#1`\n> s\n"),
    ).toThrow("issue date not found");
    expect(() =>
      parseIssue("# AI 早报\n## 科技\n### [t](https://a.com) `#1`\n> s\n"),
    ).toThrow("issue date not found");
  });

  it("#N 前导零：id 去零、tag 保留原文", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [零填充编号](https://a.com) `#03`\n> 摘要\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n",
      ),
    );
    expect(issue.items[0].id).toBe("20260101-3");
    expect(issue.items[0].tag).toBe("#03");
    expect(issue.items[0].sequenceInt).toBe(3);
  });

  it("相关链接半角冒号 + 裸 - url 形态", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [半角冒号条目](https://a.com) `#1`\n> 摘要\n\n相关链接:\n- https://b.com\n- [c](https://c.com)\n\n---\n",
      ),
    );
    expect(issue.items[0].relatedLinks).toEqual(["https://b.com", "https://c.com"]);
  });

  it("bodyMd 保留图片行并 trim 首尾空行与 ---", () => {
    const issue = parseIssue(
      issueOf(
        "## 科技\n### [图文条目](https://a.com) `#1`\n> 摘要\n\n第一段。\n\n![](https://img.example/pic.png)\n\n相关链接：\n- [https://a.com](https://a.com)\n\n---\n",
      ),
    );
    expect(issue.items[0].bodyMd).toBe("第一段。\n\n![](https://img.example/pic.png)");
  });

  it("节外条目（防御）：category 为空串", () => {
    const issue = parseIssue(
      issueOf(
        "### [游离条目](https://a.com) `#1`\n> 摘要\n\n## 科技\n### [正常条目](https://b.com) `#2`\n> 摘要\n",
      ),
    );
    expect(issue.items).toHaveLength(2);
    expect(issue.items[0].category).toBe("");
    expect(issue.items[1].category).toBe("科技");
  });
});
