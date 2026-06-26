import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ClipboardCheck,
  ShieldAlert,
  FolderOpen,
  Users,
  Wallet,
  Calendar,
  ScrollText,
  Settings,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  /** 无后端支撑的入口：渲染为灰色「敬请期待」，不可点击 */
  disabled?: boolean;
};

// 仅「收案」与「利益冲突」可导航；其余复刻旧版外观但置灰待开放
export const primaryNav: NavItem[] = [
  { label: "工作台", href: "/", icon: LayoutDashboard },
  { label: "收案", href: "/intakes", icon: ClipboardCheck },
  { label: "利益冲突", href: "/conflicts", icon: ShieldAlert },
  { label: "案件", href: "/matters", icon: FolderOpen },
  { label: "客户", href: "/clients", icon: Users },
  { label: "财务", href: "/finance", icon: Wallet, disabled: true },
  { label: "日程", href: "/schedule", icon: Calendar, disabled: true },
];

export const secondaryNav: NavItem[] = [
  { label: "审计", href: "/audit", icon: ScrollText },
  { label: "设置", href: "/settings", icon: Settings, disabled: true },
];
