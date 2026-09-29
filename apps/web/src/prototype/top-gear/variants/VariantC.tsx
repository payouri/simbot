// Variant C, "Run sheet": the Sim as one chronological document, like a deployment page.
// Import → Candidates → Settings → Run → Result, each collapsing to a line once behind you.
// Because it reads top to bottom as a record, the same page is the history view.
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import clsx from "clsx";
import { AlertTriangle, CornerDownLeft } from "lucide-react";
import { SLOTS } from "../data";
import { COMBINATION_CAP, candidatesIn, heaviestSlots } from "../engine";
import { fmtDuration, looksLikeAddonString, ParseError, type Flow } from "../flow";
import { Kbd, modKey, Tag } from "../kit";
import { Section, type SectionStatus } from "./C/Section";
import { CandidatesSkeleton, CandidatesTable } from "./C/Candidates";
import { describeSettings, SettingsSentence } from "./C/SettingsSentence";
import { RunLog } from "./C/RunLog";
import { Results } from "./C/Results";

export const NAME = "Run sheet";

type Key = "import" | "candidates" | "settings";

const STATUS_TAG: Record<Flow["run"]["status"], { label: string; tone: "neutral" | "action" | "gain" | "loss" | "noise" }> = {
  idle: { label: "Draft", tone: "neutral" },
  queued: { label: "Queued", tone: "action" },
  running: { label: "Running", tone: "action" },
  succeeded: { label: "Succeeded", tone: "neutral" },
  failed: { label: "Failed", tone: "loss" },
  cancelled: { label: "Cancelled", tone: "noise" },
};

export function VariantC({ flow }: { flow: Flow }) {
  const { step, run, parsed } = flow;
  const [override, setOverride] = useState<Partial<Record<Key, boolean>>>({});
  const [updateNote, setUpdateNote] = useState(false);
  useEffect(() => setOverride({}), [step]);

  const pending = flow.parse.isPending;
  const inSetup = step === "setup";
  const readOnly = !inSetup;
  const defaults: Record<Key, boolean> = {
    import: step === "paste" && !pending,
    candidates: inSetup || pending,
    settings: inSetup,
  };
  const isOpen = (k: Key) => override[k] ?? defaults[k];
  const toggle = (k: Key) => setOverride((o) => ({ ...o, [k]: !isOpen(k) }));

  // bring the newest section into view as the sheet grows
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step === "running") document.getElementById("c-run")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);
  useEffect(() => {
    if (run.outcome) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [run.outcome]);

  const selectedCount = SLOTS.flatMap((s) => candidatesIn(s.id)).filter((c) => flow.selection[c.uid]).length;
  const slotsWithPicks = SLOTS.filter((s) => candidatesIn(s.id).some((c) => flow.selection[c.uid])).length;
  const d = describeSettings(flow.settings);
  const c = parsed?.character;

  const runStatus: SectionStatus =
    run.status === "running" || run.status === "queued" ? "running" : run.status === "failed" ? "error" : run.status === "cancelled" ? "stopped" : "done";
  const tag = STATUS_TAG[run.status];

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const t = e.clipboardData.getData("text");
    if (looksLikeAddonString(t)) {
      e.preventDefault();
      flow.setText(t);
      flow.parse.mutate(t);
    }
  };
  const parseError = flow.parse.error instanceof ParseError ? flow.parse.error.message : flow.parse.error ? "Could not read that text." : null;

  return (
    <div className="min-h-full bg-bg">
      <header className="border-b border-line">
        <div className="mx-auto flex h-12 max-w-[1100px] items-center gap-3 px-6 max-md:px-4">
          <span className="text-[14px] font-semibold tracking-[-0.02em] text-fg">simbot</span>
          <span className="text-faint">/</span>
          <span className="text-[13px] text-muted">Sims</span>
          <span className="ml-auto flex items-center gap-2 text-[12px] text-muted">
            {flow.simc ? (
              <>
                <span className="num">SimC {flow.simc.running}</span>
                <button
                  type="button"
                  onClick={() => setUpdateNote((v) => !v)}
                  className="rounded-[4px] px-1.5 py-0.5 text-action hover:bg-action-wash"
                  aria-expanded={updateNote}
                >
                  <span className="num">{flow.simc.behind}</span> commits behind
                </button>
              </>
            ) : (
              <span className="h-3 w-40 animate-pulse rounded bg-raised" />
            )}
          </span>
        </div>
        {updateNote && flow.simc && (
          <div className="border-t border-line bg-panel">
            <p className="mx-auto max-w-[1100px] px-6 py-2 text-[12.5px] text-muted max-md:px-4">
              <span className="num">{flow.simc.latest}</span> is available. Updating pulls the new SimC image; it waits until no Sim is running.{" "}
              <button type="button" className="font-medium text-action hover:underline" onClick={() => setUpdateNote(false)}>
                Update SimC
              </button>
            </p>
          </div>
        )}
      </header>

      <main className={clsx("mx-auto max-w-[1100px] px-6 pt-8 max-md:px-4", inSetup ? "pb-44" : "pb-28")}>
        <div className="mb-8 flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-10 max-md:pl-0">
          <h1 className="text-[24px] font-semibold tracking-[-0.025em] text-fg">
            Top Gear{c && <span className="text-muted"> · {c.name}</span>}
          </h1>
          <Tag tone={tag.tone}>{tag.label}</Tag>
          {c && run.status === "idle" && <span className="text-[12.5px] text-faint">Draft saved automatically</span>}
          {run.status !== "idle" && <span className="text-[12.5px] text-faint">Input frozen when the Sim left Draft</span>}
        </div>

        {/* Import */}
        <Section
          id="import"
          title="Import"
          status={parsed ? "done" : pending ? "running" : "active"}
          open={isOpen("import")}
          onToggle={parsed ? () => toggle("import") : undefined}
          summary={
            c && (
              <>
                <span className="text-fg">{c.name}</span> · {c.spec} {c.className} · {c.realm} {c.region} · <span className="num">{parsed!.itemCount}</span> items · ilvl <span className="num">{c.equippedIlvl}</span>
              </>
            )
          }
          below={
            parsed && parsed.unknownItemIds.length > 0 ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[6px] border border-loss/35 bg-loss-wash px-3 py-2 text-[12.5px] text-fg">
                <AlertTriangle size={14} className="shrink-0 text-loss" />
                <span>
                  <span className="num">{parsed.unknownItemIds.length}</span> items use ids this SimC does not know (<span className="num">{parsed.unknownItemIds.join(", ")}</span>). They are left out of Top Gear until SimC is updated.
                </span>
                <button type="button" className="font-medium text-action hover:underline" onClick={() => setUpdateNote(true)}>
                  Review SimC Update
                </button>
              </p>
            ) : null
          }
        >
          {!parsed || step === "paste" ? (
            <div>
              <label htmlFor="c-addon" className="mb-2 block text-[13px] text-muted">
                Paste the text from <span className="num text-fg">/simc</span> in game. It is read as soon as it lands.
              </label>
              <textarea
                id="c-addon"
                value={flow.text}
                onChange={(e) => flow.setText(e.target.value)}
                onPaste={onPaste}
                rows={7}
                spellCheck={false}
                autoFocus
                aria-invalid={!!parseError}
                aria-describedby={parseError ? "c-addon-err" : undefined}
                placeholder={'# SimC Addon 12.1.0-04\npaladin="Aurelith"\nlevel=90\n…'}
                className={clsx(
                  "num w-full resize-y rounded-[8px] border bg-sunk p-3 text-[12.5px] leading-[20px] text-fg placeholder:text-faint focus:outline-none",
                  parseError ? "border-loss/60" : "border-line focus:border-action/60",
                )}
              />
              {parseError && (
                <p id="c-addon-err" role="alert" className="mt-2 flex items-start gap-1.5 text-[12.5px] text-loss">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  {parseError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => flow.parse.mutate(flow.text)}
                  className="h-8 rounded-[6px] bg-action px-3 text-[13px] font-medium text-action-ink transition-colors duration-150 hover:bg-action-strong disabled:opacity-60"
                >
                  {pending ? "Reading items…" : "Read Addon String"}
                </button>
                <button type="button" onClick={flow.pasteSample} className="h-8 rounded-[6px] px-3 text-[13px] font-medium text-muted hover:bg-raised hover:text-fg">
                  Use sample
                </button>
              </div>
            </div>
          ) : (
            <div>
              <pre className="num max-h-56 overflow-auto rounded-[8px] border border-line bg-sunk p-3 text-[12px] leading-[19px] text-muted">{flow.text}</pre>
              <button type="button" onClick={flow.newImport} className="mt-2 text-[12.5px] font-medium text-action hover:underline">
                Start from a new Addon String
              </button>
            </div>
          )}
        </Section>

        {/* Candidates */}
        {(parsed || pending) && (
          <Section
            id="candidates"
            title="Candidates"
            status={pending ? "pending" : inSetup ? "active" : "done"}
            open={isOpen("candidates")}
            onToggle={pending ? undefined : () => toggle("candidates")}
            summary={
              <>
                <span className="num">{selectedCount}</span> picked across <span className="num">{slotsWithPicks}</span> slots · <span className="num">{flow.count.toLocaleString("en-US")}</span> combinations
              </>
            }
          >
            {pending ? <CandidatesSkeleton /> : <CandidatesTable flow={flow} readOnly={readOnly} />}
          </Section>
        )}

        {/* Settings */}
        {parsed && !pending && (
          <Section
            id="settings"
            title="Settings"
            status={inSetup ? "active" : "done"}
            open={isOpen("settings")}
            onToggle={() => toggle("settings")}
            last={run.status === "idle"}
            summary={`${d.fight} · ${flow.settings.duration} s · ${flow.settings.targets} ${flow.settings.targets === 1 ? "target" : "targets"} · ${d.prec} precision · ${d.talents}`}
          >
            <SettingsSentence flow={flow} readOnly={readOnly} />
          </Section>
        )}

        {/* Run */}
        {run.status !== "idle" && (
          <Section id="run" title="Run" status={runStatus} open last={!run.outcome}>
            <RunLog flow={flow} />
          </Section>
        )}

        {/* Result */}
        {run.outcome && (
          <div ref={resultRef} className="scroll-mt-4">
            <Section id="result" title="Result" status={run.outcome.partial ? "stopped" : "done"} open last>
              <Results flow={flow} />
            </Section>
          </div>
        )}
      </main>

      {inSetup && parsed && <RunBar flow={flow} />}
    </div>
  );
}

function RunBar({ flow }: { flow: Flow }) {
  const heavy = flow.overCap ? heaviestSlots(flow.selection) : [];
  const blocked = flow.issues.length > 0;
  return (
    <div className={clsx("sticky z-40 px-6 max-md:px-3", import.meta.env.DEV ? "bottom-14" : "bottom-4")}>
      <div className="mx-auto flex max-w-[1052px] flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] border border-line-strong bg-raised px-4 py-3 shadow-pop max-md:ml-0">
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">
            <span className={clsx("num font-semibold", flow.overCap ? "text-loss" : "text-fg")}>{flow.count.toLocaleString("en-US")}</span>
            <span className="text-muted"> combinations</span>
            {!flow.overCap && !blocked && (
              <span className="text-muted">
                {" "}· about <span className="num text-fg">{fmtDuration(flow.estimate)}</span> on 16 threads
              </span>
            )}
          </p>
          <p className="truncate text-[12px] text-faint">
            {flow.overCap ? (
              <span className="text-loss">
                Over the {COMBINATION_CAP.toLocaleString("en-US")} cap. Most comes from {heavy.map((h) => `${h.slot.label} (${h.options.toLocaleString("en-US")} options)`).join(", ")}.
              </span>
            ) : blocked ? (
              <span className="text-loss">Main Hand has an item no combination can use. Fix it above to run.</span>
            ) : (
              <>3 stages: scout, narrow, final. Equipped set stays in every stage as the baseline.</>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={flow.start}
          disabled={!flow.canRun}
          className="flex h-9 items-center gap-2.5 rounded-[7px] bg-action px-4 text-[14px] font-semibold text-action-ink transition-colors duration-150 hover:bg-action-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-faint"
        >
          Run Top Gear
          <span className="flex items-center gap-0.5 opacity-70 max-md:hidden" aria-hidden>
            <Kbd>{modKey}</Kbd>
            <CornerDownLeft size={12} />
          </span>
        </button>
      </div>
    </div>
  );
}
