import { Link, Outlet } from "react-router";
import { useSimcLiveUpdates } from "../simc/api";
import { SimcChip } from "../simc/SimcChip";

/** The app frame: a sticky top bar with the product name and the SimC status chip. */
export function AppShell() {
  useSimcLiveUpdates();
  return (
    <>
      <header className="sticky top-0 z-20 flex h-[56px] items-center justify-between gap-4 border-b border-line bg-bg/95 px-4 md:px-6">
        <Link to="/" className="text-[14px] font-semibold tracking-tight">
          simbot
        </Link>
        <SimcChip />
      </header>
      <Outlet />
    </>
  );
}
