// PROTOTYPE chrome: variant / step / scenario switcher. Never ships.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { SCENARIOS, type Step } from "./flow";

const STEPS: Step[] = ["paste", "setup", "running", "results"];

export function VariantSwitcher({
  variants,
  current,
}: {
  variants: { key: string; name: string }[];
  current: string;
}) {
  const [params, setParams] = useSearchParams();
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (d: number) => {
    const next = variants[(idx + d + variants.length) % variants.length];
    setParams((p) => {
      p.set("variant", next.key);
      return p;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      if (e.altKey && e.key === "ArrowLeft") go(-1);
      if (e.altKey && e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // a hard reload is the honest way to restart a flow in a new scenario/step
  const jump = (key: string, value: string) => {
    const p = new URLSearchParams(params);
    p.set(key, value);
    window.location.search = p.toString();
  };

  if (import.meta.env.PROD) return null;
  const pill =
    "flex items-center gap-1 rounded-full bg-[#111] px-1.5 py-1 text-[12px] text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)] ring-1 ring-white/15";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[100] flex flex-wrap items-center justify-center gap-2 px-3 font-sans">
      <div className={`pointer-events-auto ${pill}`}>
        <button
          className="grid size-6 place-items-center rounded-full hover:bg-white/15"
          onClick={() => go(-1)}
          aria-label="Previous variant"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="min-w-[180px] text-center font-medium">
          {variants[idx].key} · {variants[idx].name}
        </span>
        <button
          className="grid size-6 place-items-center rounded-full hover:bg-white/15"
          onClick={() => go(1)}
          aria-label="Next variant"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className={`pointer-events-auto ${pill} pr-2.5`}>
        <span className="pl-1.5 text-white/55">Step</span>
        <select
          className="bg-transparent outline-none"
          value={params.get("step") ?? "paste"}
          onChange={(e) => jump("step", e.target.value)}
        >
          {STEPS.map((s) => (
            <option key={s} value={s} className="bg-[#111]">
              {s}
            </option>
          ))}
        </select>
        <span className="pl-2 text-white/55">Scenario</span>
        <select
          className="bg-transparent outline-none"
          value={params.get("scenario") ?? "upgrade"}
          onChange={(e) => jump("scenario", e.target.value)}
        >
          {SCENARIOS.map((s) => (
            <option key={s.key} value={s.key} className="bg-[#111]">
              {s.label}
            </option>
          ))}
        </select>
        <span className="pl-2 text-white/40">mock data · run plays compressed</span>
      </div>
    </div>
  );
}
