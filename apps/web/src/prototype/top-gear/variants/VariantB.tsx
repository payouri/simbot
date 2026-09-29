// Variant B, "Paperdoll": the character sheet is the interface. Setup picks on the
// sheet, the run plays in its centre, and results re-dress it in the chosen combination.
import clsx from "clsx";
import { CircleAlert } from "lucide-react";
import { CHARACTER } from "../data";
import { looksLikeAddonString, ParseError, type Flow, type Step } from "../flow";
import { SkeletonSheet, useIsPhone } from "./B/doll";
import { Results } from "./B/results";
import { Running } from "./B/run";
import { Setup } from "./B/setup";

export const NAME = "Paperdoll";

const STEPS: { key: Step; label: string }[] = [
  { key: "paste", label: "Import" },
  { key: "setup", label: "Setup" },
  { key: "running", label: "Run" },
  { key: "results", label: "Results" },
];

export function VariantB({ flow }: { flow: Flow }) {
  const phone = useIsPhone();
  const step = flow.step === "setup" && !flow.parsed ? "paste" : flow.step;
  return (
    <div className="min-h-full bg-bg">
      <TopBar flow={flow} step={step} />
      {step === "results" ? (
        <Results flow={flow} />
      ) : (
        <main className={clsx("mx-auto w-full max-w-[1440px] px-4 pt-5 pb-28 md:px-6", phone && "pt-4")}>
          {step === "paste" && (flow.parse.isPending ? <SkeletonSheet phone={phone} /> : <Paste flow={flow} />)}
          {step === "setup" && <Setup flow={flow} />}
          {step === "running" && <Running flow={flow} />}
        </main>
      )}
    </div>
  );
}

function TopBar({ flow, step }: { flow: Flow; step: Step }) {
  const at = STEPS.findIndex((s) => s.key === step);
  const simc = flow.simc;
  return (
    <header className="sticky top-0 z-20 flex h-[56px] items-center justify-between gap-4 border-b border-line bg-bg/95 px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">simbot</span>
        <span className="hidden text-[13px] text-faint sm:inline">Top Gear</span>
        {flow.parsed && (
          <span className="hidden truncate text-[13px] text-muted md:inline">
            {CHARACTER.name} · {CHARACTER.spec}
          </span>
        )}
      </div>
      <ol className="hidden items-center gap-1 text-[12.5px] md:flex" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            <span className={clsx("rounded-[5px] px-2 py-0.5", i === at ? "bg-raised text-fg" : i < at ? "text-muted" : "text-faint")} aria-current={i === at ? "step" : undefined}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="text-line-strong">/</span>}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3 text-[12px]">
        {simc && (
          <span className="num hidden text-faint lg:inline" title={`Latest on midnight: ${simc.latest}`}>
            SimC {simc.running}
            {simc.behind > 0 && <span className="text-action"> · {simc.behind} newer</span>}
          </span>
        )}
        {flow.parsed && step !== "running" && (
          <button className="rounded-[5px] px-2 py-1 text-muted hover:bg-panel hover:text-fg" onClick={flow.newImport}>
            New import
          </button>
        )}
      </div>
    </header>
  );
}

function Paste({ flow }: { flow: Flow }) {
  const err = flow.parse.error;
  return (
    <section className="mx-auto flex max-w-[760px] flex-col gap-4 pt-[6vh]">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[24px] leading-tight font-semibold tracking-[-0.015em]">Paste your Addon String</h1>
        <p className="text-[13.5px] text-muted">
          In game, type <span className="num text-fg">/simc</span>, then copy everything in the window. Your bags, bank and Great Vault come with it.
        </p>
      </div>
      <textarea
        autoFocus
        value={flow.text}
        spellCheck={false}
        aria-invalid={!!err}
        aria-describedby={err ? "b-parse-error" : undefined}
        onChange={(e) => flow.setText(e.target.value)}
        onPaste={(e) => {
          const t = e.clipboardData.getData("text");
          if (looksLikeAddonString(t)) {
            flow.setText(t);
            e.preventDefault();
            flow.parse.mutate(t);
          }
        }}
        placeholder={'# SimC Addon 12.1.0-04\npaladin="Aurelith"\nlevel=90\n…'}
        rows={14}
        className={clsx(
          "num w-full resize-y rounded-[10px] border bg-sunk px-4 py-3.5 text-[12.5px] leading-relaxed outline-none placeholder:text-faint",
          err ? "border-loss/60" : "border-line focus:border-action",
        )}
      />
      {err && (
        <p id="b-parse-error" className="flex gap-2 text-[13px] text-fg">
          <CircleAlert size={15} className="mt-0.5 shrink-0 text-loss" />
          {err instanceof ParseError ? err.message : "Something went wrong reading that string."}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          className="h-9 rounded-[7px] bg-action px-4 text-[13.5px] font-semibold text-action-ink transition-colors duration-150 hover:bg-action-strong disabled:bg-raised disabled:text-faint"
          disabled={!flow.text.trim()}
          onClick={() => flow.parse.mutate(flow.text)}
        >
          Read string
        </button>
        <button className="h-9 rounded-[7px] px-3 text-[13px] text-muted hover:bg-panel hover:text-fg" onClick={flow.pasteSample}>
          Use sample
        </button>
        <span className="ml-auto text-[12px] text-faint">Pasting a full string reads it right away.</span>
      </div>
    </section>
  );
}
