import { Menu, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getRole, setSession } from "@/lib/api";

const roleLabels: Record<string, string> = {
  ADMIN: "系统管理员",
  PRINCIPAL_LAWYER: "主办律师",
  LAWYER: "经办律师",
  ASSISTANT: "助理",
  FINANCE: "财务",
};

export function Topbar({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const navigate = useNavigate();
  const role = getRole();
  const roleLabel = role ? roleLabels[role] ?? role : "未登录";
  const initial = roleLabel.charAt(0) || "?";

  function logout() {
    setSession(null);
    navigate("/login");
  }

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2.5 border-b border-border bg-background px-4 sm:px-6">
      {onMobileMenuToggle && (
        <button
          onClick={onMobileMenuToggle}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
          aria-label="打开菜单"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      <div className="text-[15px] font-semibold tracking-tight">收案与利益冲突</div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <div className="flex h-8 items-center gap-2 rounded-md border border-border pl-1 pr-2.5">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-[13px] font-medium sm:inline">{roleLabel}</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="gap-1.5 text-destructive hover:text-destructive"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">退出登录</span>
        </Button>
      </div>
    </header>
  );
}
