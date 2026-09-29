import { Link, Outlet } from "react-router";
import { useQueueQuery } from "../queue/api";
import { SimcChip } from "../simc/SimcChip";

/** The app frame: a sticky top bar with the product name and the SimC status chip. */
export function AppShell() {
  const waiting = useQueueQuery().data?.entries.length ?? 0;
  return (
    <>
      <header className="sticky top-0 z-20 flex h-[56px] items-center justify-between gap-4 border-b border-line bg-bg/95 px-4 md:px-6">
        <Link to="/" className="text-[14px] font-semibold tracking-tight">
          simbot
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/queue" className="text-[12.5px] text-muted hover:text-fg">
            Queue
            {waiting > 0 && <span className="num ml-1.5 text-fg">{waiting}</span>}
          </Link>
          <SimcChip />
        </div>
      </header>
      <Outlet />
    </>
  );
}
