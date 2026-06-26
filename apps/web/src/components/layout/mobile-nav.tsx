import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NavContent, type FirmBrand } from "./sidebar";

export function MobileNav({
  open,
  onOpenChange,
  firm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  firm: FirmBrand;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-60 p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>导航菜单</SheetTitle>
        </SheetHeader>
        {/* 点击任意导航项后关闭抽屉 */}
        <div className="flex h-full flex-col" onClick={() => onOpenChange(false)}>
          <NavContent firm={firm} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
