/**
 * Report period resolution (报表). Pure date math: presets (this month/quarter/
 * year, last year) or a custom [start, end] range. `end` is EXCLUSIVE (half-open
 * interval) so "in period" is a clean `>= start AND < end`.
 */
export interface ReportPeriod {
  start: Date;
  end: Date; // exclusive
  label: string;
}

export type ReportPreset = "month" | "quarter" | "year" | "lastYear";

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Resolve a preset against `now`. */
export function presetPeriod(now: Date, preset: ReportPreset): ReportPeriod {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "month":
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: `${y}年${m + 1}月` };
    case "quarter": {
      const q = Math.floor(m / 3);
      return { start: new Date(y, q * 3, 1), end: new Date(y, q * 3 + 3, 1), label: `${y}年Q${q + 1}` };
    }
    case "year":
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: `${y}年` };
    case "lastYear":
      return { start: new Date(y - 1, 0, 1), end: new Date(y, 0, 1), label: `${y - 1}年` };
  }
}

/** Resolve a custom [startStr, endStr] (YYYY-MM-DD), end inclusive of its day. */
export function customPeriod(startStr: string, endStr: string): ReportPeriod {
  const parse = (s: string): Date | null => {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    // Reject impossible dates that JS would silently normalize (2026-02-31 →
    // March, 2026-13-01 → next year) so the report period matches the request.
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return dt;
  };
  const start = parse(startStr);
  const endDay = parse(endStr);
  if (!start || !endDay) throw new Error("日期格式应为 YYYY-MM-DD");
  // end is exclusive → the day AFTER the requested end day.
  const end = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);
  if (end <= start) throw new Error("结束日期必须不早于开始日期");
  return { start: startOfDay(start), end, label: `${startStr} ~ ${endStr}` };
}

/** Resolve a period from a request: explicit custom range wins, else preset,
 * else the current month. */
export function resolvePeriod(
  now: Date,
  input?: { preset?: ReportPreset; start?: string; end?: string },
): ReportPeriod {
  if (input?.start && input?.end) return customPeriod(input.start, input.end);
  return presetPeriod(now, input?.preset ?? "month");
}
