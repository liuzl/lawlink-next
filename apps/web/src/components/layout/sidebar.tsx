import { Link, useLocation } from "react-router-dom";
import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { primaryNav, secondaryNav, type NavItem } from "./nav-config";

/** 侧栏品牌（律所名 / 副标题 / Logo） */
export type FirmBrand = {
  name: string;
  subtitle: string;
  logoDataUrl: string | null;
};

/** 桌面侧边栏（md 以上显示） */
export function Sidebar({ firm }: { firm: FirmBrand }) {
  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-60 flex-col border-r border-border bg-sidebar md:flex">
      <NavContent firm={firm} />
    </aside>
  );
}

/** 导航内容 — 桌面侧边栏和移动 Sheet 共用 */
export function NavContent({ firm }: { firm: FirmBrand }) {
  const pathname = useLocation().pathname;

  return (
    <>
      <Link
        to="/"
        className="flex h-14 items-center gap-2.5 px-5 transition-colors hover:bg-muted/50"
        aria-label="返回收案台"
      >
        {firm.logoDataUrl ? (
          <img
            src={firm.logoDataUrl}
            alt={firm.name}
            className="h-8 w-8 shrink-0 rounded-md object-contain"
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Scale className="h-4 w-4" strokeWidth={1.8} />
          </div>
        )}
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[1.05rem] font-semibold tracking-tight">{firm.name}</span>
          {firm.subtitle ? (
            <span className="truncate text-[10px] text-muted-foreground">{firm.subtitle}</span>
          ) : null}
        </div>
      </Link>

      <div className="ll-rule mx-4" />

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </nav>

      <div className="ll-rule mx-4" />

      <div className="px-3 py-3">
        <div className="space-y-0.5">
          {secondaryNav.map((item) => (
            <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      </div>
    </>
  );
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  if (item.disabled) {
    return (
      <div
        aria-disabled
        className="group relative flex h-8 cursor-not-allowed items-center gap-2.5 rounded-md px-3 text-[0.82rem] text-muted-foreground/50"
      >
        <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground/40" strokeWidth={1.6} />
        <span className="flex-1 truncate">{item.label}</span>
        <span className="rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
          敬请期待
        </span>
      </div>
    );
  }

  return (
    <Link
      to={item.href}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-3 text-[0.82rem] transition-colors",
        active
          ? "text-primary font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r-sm bg-primary"
        />
      )}
      <Icon
        className={cn(
          "h-[15px] w-[15px] shrink-0",
          active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"
        )}
        strokeWidth={active ? 2 : 1.6}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? (
        <span
          className={cn(
            "rounded-sm px-1.5 py-px text-[10px] font-medium tabular",
            active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
