// 由 `npm run gen:registry` 从 data/companies.yaml 生成（spec02 3.2，真相源 ADR-0001）。勿手改。
import type { Company } from "../src/lib/schema";

export const REGISTRY: Company[] = [
  {
    "id": "anthropic",
    "name": "Anthropic",
    "aliases": [
      "Anthropic",
      "Claude",
      "ClaudeDevs",
      "Fable"
    ],
    "color": "#D97757",
    "status": "active",
    "notes": "Claude 厂商"
  },
  {
    "id": "openai",
    "name": "OpenAI",
    "aliases": [
      "OpenAI",
      "ChatGPT",
      "Codex",
      "GPT",
      "Sora"
    ],
    "color": "#10A37F",
    "status": "active",
    "notes": "ChatGPT / GPT 厂商"
  },
  {
    "id": "google",
    "name": "Google",
    "aliases": [
      "Google",
      "Google DeepMind",
      "DeepMind",
      "Gemini",
      "Gemma",
      "Google WeatherLab",
      "WeatherNext",
      "MetNet"
    ],
    "color": "#4285F4",
    "status": "active",
    "notes": "Gemini / DeepMind"
  },
  {
    "id": "alibaba",
    "name": "阿里巴巴",
    "aliases": [
      "阿里",
      "阿里云",
      "阿里千问",
      "千问",
      "Qwen",
      "Qoder",
      "百炼",
      "阿里云百炼",
      "Token Plan",
      "千问AI平台",
      "灵骏"
    ],
    "color": "#FF6A00",
    "status": "active",
    "notes": "千问 / 阿里云"
  },
  {
    "id": "moonshot",
    "name": "月之暗面",
    "aliases": [
      "月之暗面",
      "Kimi",
      "Moonshot"
    ],
    "color": "#7C5CFF",
    "status": "active",
    "notes": "Kimi 厂商"
  },
  {
    "id": "nvidia",
    "name": "NVIDIA",
    "aliases": [
      "Nvidia",
      "NVIDIA"
    ],
    "color": "#76B900",
    "status": "active",
    "notes": "GPU / 物理 AI 平台"
  },
  {
    "id": "kuaishou",
    "name": "快手",
    "aliases": [
      "快手",
      "可灵",
      "Kling"
    ],
    "color": "#FF4906",
    "status": "active",
    "notes": "可灵视频模型"
  },
  {
    "id": "meta",
    "name": "Meta",
    "aliases": [
      "Meta",
      "Facebook",
      "Llama"
    ],
    "color": "#0668E1",
    "status": "active",
    "notes": "Llama / FAIR"
  },
  {
    "id": "microsoft",
    "name": "Microsoft",
    "aliases": [
      "Microsoft",
      "微软",
      "Copilot",
      "Azure",
      "Phi"
    ],
    "color": "#00A4EF",
    "status": "active",
    "notes": "Azure / Copilot"
  },
  {
    "id": "xai",
    "name": "xAI",
    "aliases": [
      "xAI",
      "SpaceXAI",
      "Grok"
    ],
    "color": "#111111",
    "status": "active",
    "notes": "Grok 厂商"
  },
  {
    "id": "mistral",
    "name": "Mistral AI",
    "aliases": [
      "Mistral",
      "Mistral AI",
      "Leanstral"
    ],
    "color": "#FF7000",
    "status": "active",
    "notes": "欧洲开源模型厂商"
  },
  {
    "id": "stepfun",
    "name": "阶跃星辰",
    "aliases": [
      "阶跃",
      "阶跃星辰",
      "StepFun",
      "STEPX",
      "Step AOS",
      "StepStar"
    ],
    "color": "#1E2B8C",
    "status": "active",
    "notes": "多模态模型厂商"
  },
  {
    "id": "minimax",
    "name": "MiniMax",
    "aliases": [
      "MiniMax",
      "海螺"
    ],
    "color": "#FF5C35",
    "status": "active",
    "notes": "海螺 / MiniMax"
  },
  {
    "id": "modelscope",
    "name": "面壁智能",
    "aliases": [
      "面壁",
      "面壁智能",
      "MiniCPM",
      "OpenBMB"
    ],
    "color": "#00B4A0",
    "status": "active",
    "notes": "MiniCPM 端侧模型"
  },
  {
    "id": "sensetime",
    "name": "商汤",
    "aliases": [
      "商汤",
      "SenseTime",
      "SenseNova"
    ],
    "color": "#0091FF",
    "status": "active",
    "notes": "日日新大模型"
  },
  {
    "id": "kunlun",
    "name": "昆仑万维",
    "aliases": [
      "昆仑万维",
      "Riemann Dynamics",
      "Matrix-Game"
    ],
    "color": "#E60012",
    "status": "active",
    "notes": "Matrix-Game 世界模型"
  },
  {
    "id": "jd",
    "name": "京东",
    "aliases": [
      "京东",
      "JoyAI"
    ],
    "color": "#E1251B",
    "status": "active",
    "notes": "JoyAI 模型矩阵"
  },
  {
    "id": "tencent",
    "name": "腾讯",
    "aliases": [
      "腾讯",
      "Tencent",
      "Tencent Hunyuan",
      "Hy3"
    ],
    "color": "#00C9FF",
    "status": "active",
    "notes": "混元"
  },
  {
    "id": "internlm",
    "name": "InternLM",
    "aliases": [
      "InternLM",
      "Intern-S2",
      "上海AI实验室"
    ],
    "color": "#1B1B3A",
    "status": "active",
    "notes": "书生多模态模型"
  },
  {
    "id": "databricks",
    "name": "Databricks",
    "aliases": [
      "Databricks",
      "Omnigent"
    ],
    "color": "#FF3621",
    "status": "active",
    "notes": "数据/AI 平台"
  },
  {
    "id": "cerebras",
    "name": "Cerebras",
    "aliases": [
      "Cerebras"
    ],
    "color": "#F0502A",
    "status": "active",
    "notes": "晶圆级推理芯片"
  },
  {
    "id": "vercel",
    "name": "Vercel",
    "aliases": [
      "Vercel",
      "eve"
    ],
    "color": "#000000",
    "status": "active",
    "notes": "前端云 / Agent 平台"
  },
  {
    "id": "github",
    "name": "GitHub",
    "aliases": [
      "GitHub",
      "Copilot",
      "OpenClaw"
    ],
    "color": "#24292F",
    "status": "active",
    "notes": "Copilot / 开发者平台"
  },
  {
    "id": "openrouter",
    "name": "OpenRouter",
    "aliases": [
      "OpenRouter"
    ],
    "color": "#6366F1",
    "status": "active",
    "notes": "模型聚合 API"
  },
  {
    "id": "amp",
    "name": "Amp",
    "aliases": [
      "Amp",
      "ampcode"
    ],
    "color": "#0EA5E9",
    "status": "active",
    "notes": "Agent 编程工具"
  },
  {
    "id": "trae",
    "name": "TRAE",
    "aliases": [
      "TRAE"
    ],
    "color": "#A855F7",
    "status": "active",
    "notes": "字节系 AI IDE"
  },
  {
    "id": "firecrawl",
    "name": "Firecrawl",
    "aliases": [
      "Firecrawl"
    ],
    "color": "#FF8000",
    "status": "active",
    "notes": "爬虫/检索 API"
  },
  {
    "id": "exa",
    "name": "Exa",
    "aliases": [
      "Exa",
      "Exa Agent"
    ],
    "color": "#22C55E",
    "status": "active",
    "notes": "Web 研究 API"
  },
  {
    "id": "happyoyster",
    "name": "HappyOyster",
    "aliases": [
      "HappyOyster"
    ],
    "color": "#F97316",
    "status": "active",
    "notes": "实时交互世界模型"
  },
  {
    "id": "workbuddy",
    "name": "WorkBuddy",
    "aliases": [
      "WorkBuddy"
    ],
    "color": "#F59E0B",
    "status": "active",
    "notes": "通用智能体"
  }
];
