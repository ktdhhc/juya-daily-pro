// 数据面板纯计算辅助（spec08 Step 3.1）：无 React、无 I/O，全部可单测（chartMath.test.ts）。
// 约定：
// - 日期一律 "YYYY-MM-DD" 字符串；本地时区解析（不用 new Date(str)——它把纯日期按 UTC 解析）。
// - lastSyncAt 为 sync_log attempted_at（datetime('now') → UTC naive "YYYY-MM-DD HH:MM:SS"），
//   相对时间按 UTC 解析后再与客户端挂钟比较。
// - 配色不在本模块出现（返回档位/键名，颜色由组件映射到 CSS 变量）。

// ---------- 日期基础 ----------

/** "YYYY-MM-DD" → 本地零点 Date；非法输入返回 null */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD HH:MM:SS"（UTC naive）→ 绝对时刻 ms；解析失败返回 null */
function parseUtcNaive(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

/** 相对时间（挂载时算一次）：刚刚 / N 分钟前 / N 小时前 / N 天前；null 或解析失败 → 空串 */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const t = parseUtcNaive(iso);
  if (t === null) return "";
  const diffMin = Math.floor((now - t) / 60_000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} 小时前`;
  return `${Math.floor(diffH / 24)} 天前`;
}

/** "2026-08-29" → "08-29"（tooltip / 轴标签用） */
export function shortDate(date: string): string {
  return date.length >= 10 ? date.slice(5, 10) : date;
}

/** 比率 → 百分比文案：0.885 → "88.5%"、0.9 → "90%"（去尾零） */
export function pct(rate: number): string {
  const v = Math.round(rate * 1000) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

// ---------- 热力图 ----------

/** ok 格墨色深浅档位（1..4）：按当日条数 10/20/30 分界；无当日条数（undefined）或 0 → 最低档 */
export function heatmapLevel(count: number | undefined): number {
  if (count === undefined || count < 10) return 1;
  if (count < 20) return 2;
  if (count < 30) return 3;
  return 4;
}

export interface HeatCell {
  date: string; // "YYYY-MM-DD"
  status: "ok" | "fail" | "empty";
  /** 墨色档位 1..4（仅 status="ok" 有意义） */
  level: number;
  /** tooltip 文案；empty 格为空串（不挂 tooltip） */
  tip: string;
}

const HEATMAP_DAYS = 84; // 12 周 × 7

/**
 * 近 12 周热力图格子：恒 84 格，列=周（升序，末列=本周）、行=周一..周日（索引 = 周 × 7 + 星期）。
 * sync 同日多行时 ok 优先（先败后成视为成功），否则取首行失败档；
 * 数据里网格外的日期（2099 演练行、远古行）不进任何格子，直接忽略。
 */
export function buildHeatmapCells(
  sync: { date: string; status: string; error: string | null }[],
  daily: { date: string; items: number }[],
  today: Date
): HeatCell[] {
  const dailyByDate = new Map(daily.map((d) => [d.date, d.items]));
  const syncByDate = new Map<string, { status: string; error: string | null }>();
  for (const r of sync) {
    const prev = syncByDate.get(r.date);
    if (!prev || (prev.status !== "ok" && r.status === "ok")) {
      syncByDate.set(r.date, { status: r.status, error: r.error });
    }
  }

  // 窗口起点 = 本周一 - 77 天（末列=本周）
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const start = new Date(monday);
  start.setDate(start.getDate() - (HEATMAP_DAYS - 7));

  const todayMs = parseLocalDate(fmtDate(today))!.getTime();
  const cells: HeatCell[] = [];
  for (let i = 0; i < HEATMAP_DAYS; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const date = fmtDate(d);
    if (d.getTime() > todayMs) {
      cells.push({ date, status: "empty", level: 1, tip: "" }); // 未来格一律空
      continue;
    }
    const s = syncByDate.get(date);
    if (!s) {
      cells.push({ date, status: "empty", level: 1, tip: "" });
      continue;
    }
    if (s.status === "ok") {
      const count = dailyByDate.get(date);
      cells.push({
        date,
        status: "ok",
        level: heatmapLevel(count),
        tip: `${shortDate(date)} · ok · ${count ?? 0} 条`,
      });
    } else {
      const summary = s.error ? ` · ${s.error.length > 40 ? `${s.error.slice(0, 40)}…` : s.error}` : "";
      cells.push({ date, status: "fail", level: 1, tip: `${shortDate(date)} · ${s.status}${summary}` });
    }
  }
  return cells;
}

/** Date → "YYYY-MM-DD"（本地） */
function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- 折线 ----------

export interface LinePoint {
  date: string;
  items: number;
  x: number;
  y: number;
  /** tooltip 文案「MM-DD · N 条」 */
  tip: string;
  /** 是否末点（强调色） */
  last: boolean;
}

/**
 * 稀疏折线坐标换算：x 按日期在数据跨度 [min, max] 内线性映射，y 按 items 0..max 反向映射；
 * 无数据日不出点、线段直接连接相邻数据点（不插值不补零）。单点 → path 空串、x 居中。
 */
export function lineGeometry(
  daily: { date: string; items: number; issues: number }[],
  width: number,
  height: number,
  pad: number
): { points: LinePoint[]; path: string } {
  const pts = daily
    .map((d) => ({ date: d.date, items: d.items, t: parseLocalDate(d.date)?.getTime() }))
    .filter((d): d is { date: string; items: number; t: number } => d.t !== undefined);
  if (pts.length === 0) return { points: [], path: "" };

  const tMin = Math.min(...pts.map((p) => p.t));
  const tMax = Math.max(...pts.map((p) => p.t));
  const maxItems = Math.max(1, ...pts.map((p) => p.items));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const span = Math.max(1, tMax - tMin);

  const points: LinePoint[] = pts.map((p, i) => {
    const x = pts.length === 1 ? width / 2 : pad + ((p.t - tMin) / span) * innerW;
    const y = pad + (1 - p.items / maxItems) * innerH;
    return { date: p.date, items: p.items, x, y, tip: `${shortDate(p.date)} · ${p.items} 条`, last: i === pts.length - 1 };
  });
  const path =
    points.length >= 2
      ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${round2(p.x)} ${round2(p.y)}`).join(" ")
      : "";
  return { points, path };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- 环形 ----------

export interface DonutSeg {
  key: "ok" | "missing_owner" | "pending";
  value: number;
  /** 段长（pathLength=100 归一化，0..100） */
  len: number;
  /** stroke-dashoffset（负值顺时针推段） */
  offset: number;
  /** 段中角（度，-90=顶端、顺时针为正），tooltip 锚点用 */
  midAngle: number;
}

/** 环形三段几何：顶端 -90° 起步按 ok → missing_owner → pending 顺时针排布；总量 0 → 空数组 */
export function donutSegments(enrich: { ok: number; missing_owner: number; pending: number }): DonutSeg[] {
  const total = enrich.ok + enrich.missing_owner + enrich.pending;
  if (total <= 0) return [];
  const keys = ["ok", "missing_owner", "pending"] as const;
  const segs: DonutSeg[] = [];
  let acc = 0; // 已占比（0..100）
  for (const k of keys) {
    const len = (enrich[k] / total) * 100;
    segs.push({
      key: k,
      value: enrich[k],
      len,
      offset: acc === 0 ? 0 : -acc, // 首段归一化 -0（SVG 渲染等价，测试 Object.is 敏感）
      midAngle: -90 + (acc + len / 2) * 3.6,
    });
    acc += len;
  }
  return segs;
}
