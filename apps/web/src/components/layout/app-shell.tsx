import { useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar, type FirmBrand } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";

const FIRM: FirmBrand = {
  name: "LawLink",
  subtitle: "律师案件管理",
  logoDataUrl: null,
};

export function AppShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar firm={FIRM} />
      <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} firm={FIRM} />
      <div className="md:pl-60">
        <Topbar onMobileMenuToggle={() => setMobileNavOpen(true)} />
        <main className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
