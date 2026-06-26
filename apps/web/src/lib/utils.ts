import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, options?: { compact?: boolean }) {
  if (options?.compact && Math.abs(amount) >= 10000) {
    return `¥${(amount / 10000).toFixed(1)}万`;
  }
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatDate(date: Date | string, fmt: "full" | "short" | "month-day" = "short") {
  const d = typeof date === "string" ? new Date(date) : date;
  if (fmt === "full") {
    return d.toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    });
  }
  if (fmt === "month-day") {
    return d.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
  }
  return d.toLocaleDateString("zh-CN");
}

export function daysUntil(date: Date | string): number {
  const target = typeof date === "string" ? new Date(date) : date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
