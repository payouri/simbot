// PROTOTYPE flow state + mock API. Parse and SimC status go through TanStack Query
// like the real API will; the run is a simulated SSE stream driven by timers.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { CHARACTER, SAMPLE_ADDON_STRING } from "./data";
import {
  countCombinations,
  DEFAULT_SETTINGS,
  estimateSeconds,
  generateCombinations,
  ITERATIONS_PER_SECOND,
  preselect,
  runStages,
  stagePlan,
  validate,
  verdict,
  COMBINATION_CAP,
  type Scenario,
  type Selection,
  type Settings,
  type SimOutcome,
  type StagePlan,
  type Verdict,
} from "./engine";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Step = "paste" | "setup" | "running" | "results";
export type ScenarioKey = Scenario | "queued" | "failed" | "drift";
export const SCENARIOS: { key: ScenarioKey; label: string }[] = [
  { key: "upgrade", label: "Clear upgrade" },
  { key: "equipped", label: "Equipped wins" },
  { key: "noise", label: "Within noise" },
  { key: "queued", label: "Queued behind a Sim" },
  { key: "failed", label: "SimC fails" },
  { key: "drift", label: "Unknown item ids" },
];

export interface ParsedImport {
  character: typeof CHARACTER;
  itemCount: number;
  unknownItemIds: number[];
}

export class ParseError extends Error {}

async function mockParse(text: string, drift: boolean): Promise<ParsedImport> {
  await sleep(450); // the packed json2 item pass
  const t = text.trim();
  if (!t) throw new ParseError("Paste the text the SimulationCraft addon shows with /simc.");
  if (!/^(warrior|paladin|hunter|rogue|priest|deathknight|shaman|mage|warlock|monk|druid|demonhunter|evoker)=/m.test(t))
    throw new ParseError("This does not look like an Addon String: there is no character line such as paladin=\"Name\". Copy the whole /simc window, including the first line.");
  return { character: CHARACTER, itemCount: 44, unknownItemIds: drift ? [243118, 243120] : [] };
}

export const looksLikeAddonString = (t: string) => /^\s*(#\s*SimC Addon|[a-z]+=")/m.test(t);

export function useSimcStatus() {
  return useQuery({
    queryKey: ["simc-status"],
    queryFn: async () => {
      await sleep(200);
      return CHARACTER.simcVersion;
    },
    staleTime: Infinity,
  });
}

// ---------- the run (simulated SSE) ----------

export type RunStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface StageProgress {
  plan: StagePlan;
  entered: number;
  done: number;
  survivors?: number;
  state: "pending" | "running" | "done" | "stopped";
}

export interface LogLine {
  id: number;
  t: number; // sim seconds since start
  kind: "info" | "stage" | "progress" | "cull" | "error" | "done" | "warn";
  text: string;
}

export interface RunState {
  status: RunStatus;
  queuePosition?: number;
  elapsed: number;
  eta: number;
  total: number;
  stages: StageProgress[];
  log: LogLine[];
  outcome?: SimOutcome;
  verdict?: Verdict;
  error?: string;
  discarded?: boolean;
}

const IDLE: RunState = { status: "idle", elapsed: 0, eta: 0, total: 0, stages: [], log: [] };

/** Real-time compression so the prototype run lasts ~14 s whatever the estimate. */
const TARGET_REAL_SECONDS = 14;

class Runner {
  state: RunState = IDLE;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private logId = 0;
  private stop?: (keep: boolean) => void;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  get = () => this.state;
  private set(patch: Partial<RunState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private push(t: number, kind: LogLine["kind"], text: string) {
    this.set({ log: [...this.state.log, { id: ++this.logId, t, kind, text }] });
  }
  reset() {
    clearInterval(this.timer);
    this.logId = 0;
    this.set({ ...IDLE });
  }

  start(sel: Selection, settings: Settings, scenario: ScenarioKey) {
    this.reset();
    const combos = generateCombinations(sel, settings);
    const shapeScenario: Scenario = scenario === "equipped" || scenario === "noise" ? scenario : "upgrade";
    const full = runStages(combos, settings.precision, shapeScenario);
    const plan = stagePlan(combos.length, settings.precision);
    const stageSecs = full.stages.map((s) => (s.entered * s.plan.iterations) / ITERATIONS_PER_SECOND);
    const queueSecs = scenario === "queued" ? Math.max(6, stageSecs.reduce((a, b) => a + b, 0) * 0.3) : 0;
    const boot = 2.5;
    const total = queueSecs + boot + stageSecs.reduce((a, b) => a + b, 0);
    const speed = Math.max(1, total / TARGET_REAL_SECONDS);
    const failAt = scenario === "failed" ? { stage: Math.min(2, plan.length), fraction: 0.42 } : undefined;

    this.set({
      status: queueSecs ? "queued" : "running",
      queuePosition: queueSecs ? 1 : undefined,
      total,
      eta: total,
      stages: full.stages.map((s) => ({ plan: s.plan, entered: s.entered, done: 0, state: "pending" })),
    });
    if (queueSecs) this.push(0, "info", "Queued behind “Kaelthra · Quick Sim”, position 1");

    let t = 0;
    let phase: "queue" | "boot" | number = queueSecs ? "queue" : "boot";
    let phaseT = 0;
    let finished = false;

    const bootLog = () => {
      this.push(t, "info", `SimC ${CHARACTER.simcVersion.running} · 16 threads · ${settings.fightStyle}, ${settings.duration}s, ${settings.targets} target`);
      this.push(t, "info", `${combos.length.toLocaleString("en-US")} combinations generated from ${Object.keys(sel).filter((k) => sel[k]).length} candidates`);
    };
    if (!queueSecs) bootLog();

    const finish = (status: RunStatus, extra: Partial<RunState>) => {
      finished = true;
      clearInterval(this.timer);
      this.stop = undefined;
      this.set({ status, eta: 0, ...extra });
    };

    this.stop = (keep) => {
      if (finished) return;
      const stage = typeof phase === "number" ? phase : 0;
      if (!keep || stage === 0) {
        this.push(t, "warn", keep ? "Stopped before any stage finished, nothing to keep" : "Stopped and discarded");
        finish("cancelled", { discarded: true });
        return;
      }
      const fraction = Math.min(0.99, phaseT / stageSecs[stage - 1]);
      const partial = runStages(combos, settings.precision, shapeScenario, { stage: stage, fraction });
      this.push(t, "warn", `Stopped during stage ${stage}. Kept ${partial.ranked.length.toLocaleString("en-US")} results`);
      finish("cancelled", {
        outcome: partial,
        verdict: verdict(partial),
        stages: this.state.stages.map((s) => (s.state === "running" ? { ...s, state: "stopped" } : s)),
      });
    };

    const TICK = 100;
    this.timer = setInterval(() => {
      const dt = (TICK / 1000) * speed;
      t += dt;
      phaseT += dt;
      if (phase === "queue") {
        if (phaseT >= queueSecs) {
          phase = "boot";
          phaseT = 0;
          this.set({ status: "running", queuePosition: undefined });
          this.push(t, "info", "Kaelthra's Sim finished, starting");
          bootLog();
        }
      } else if (phase === "boot") {
        if (phaseT >= boot) {
          phase = 1;
          phaseT = 0;
          this.markStage(0, "running");
          this.push(t, "stage", stageLine(full, 0));
        }
      } else {
        const i = phase - 1;
        const s = full.stages[i];
        const frac = Math.min(1, phaseT / stageSecs[i]);
        this.patchStage(i, { done: Math.floor(s.entered * frac) });
        if (failAt && phase === failAt.stage && frac >= failAt.fraction) {
          const msg = `Error: Player 'Aurelith' profileset 'Combo ${Math.max(2, Math.round(combos.length * 0.62))}': Item 'trinket2' has unknown bonus_id 12977. Your SimC build may be older than the game data.`;
          this.push(t, "error", msg);
          this.push(t, "error", "SimC exited with code 1 after 3 of 4 profileset batches");
          this.patchStage(i, { state: "stopped" });
          finish("failed", { error: msg });
          return;
        }
        if (frac >= 1) {
          const last = i === full.stages.length - 1;
          this.patchStage(i, { state: "done", survivors: s.survivors });
          if (!last) {
            const band = ((full.ranked[0].stages[i]?.error ?? 0) / full.baseline.last.mean) * 100;
            this.push(t, "cull", `Stage ${s.plan.index} done · kept ${s.survivors.toLocaleString("en-US")} of ${s.entered.toLocaleString("en-US")} (band ±${band.toFixed(2)}%)`);
            phase = phase + 1;
            phaseT = 0;
            this.markStage(i + 1, "running");
            this.push(t, "stage", stageLine(full, i + 1));
          } else {
            this.push(t, "done", `Done in ${fmtDuration(t)} · ${full.ranked.length.toLocaleString("en-US")} ranked`);
            finish("succeeded", { outcome: full, verdict: verdict(full), elapsed: t });
            return;
          }
        }
      }
      this.set({ elapsed: t, eta: Math.max(0, total - t) });
    }, TICK);
  }

  requestStop(keep: boolean) {
    this.stop?.(keep);
  }

  private markStage(i: number, state: StageProgress["state"]) {
    this.patchStage(i, { state });
  }
  private patchStage(i: number, patch: Partial<StageProgress>) {
    this.set({ stages: this.state.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  }
}

function stageLine(o: SimOutcome, i: number) {
  const s = o.stages[i];
  return `Stage ${s.plan.index} of ${o.stages.length} · ${s.plan.label} · ${s.entered.toLocaleString("en-US")} combinations × ${s.plan.iterations.toLocaleString("en-US")} iterations`;
}

export const fmtDuration = (s: number) => {
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
};

const runner = new Runner();

// ---------- the flow hook every variant renders from ----------

export function useTopGearFlow() {
  const [params, setParams] = useSearchParams();
  const scenario = (params.get("scenario") as ScenarioKey) ?? "upgrade";
  const urlStep = (params.get("step") as Step) ?? "paste";

  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [selection, setSelection] = useState<Selection>(() => preselect());
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const run = useSyncExternalStore(runner.subscribe, runner.get);
  const simc = useSimcStatus();

  const setStep = useCallback(
    (s: Step) =>
      setParams((p) => {
        p.set("step", s);
        return p;
      }, { replace: true }),
    [setParams],
  );

  const parse = useMutation({
    mutationFn: (t: string) => mockParse(t, scenario === "drift"),
    onSuccess: (data) => {
      setParsed(data);
      setSelection(preselect());
      setStep("setup");
    },
  });

  // deep links: jumping straight to a later step loads the sample import
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (urlStep !== "paste" && !parsed) {
      setText(SAMPLE_ADDON_STRING);
      setParsed({ character: CHARACTER, itemCount: 44, unknownItemIds: scenario === "drift" ? [243118, 243120] : [] });
      if (urlStep === "running" || urlStep === "results") runner.start(preselect(), DEFAULT_SETTINGS, scenario);
    }
  }, [urlStep, parsed, scenario]);

  useEffect(() => {
    if (urlStep === "running" && (run.status === "succeeded" || (run.status === "cancelled" && run.outcome))) setStep("results");
  }, [run.status, run.outcome, urlStep, setStep]);

  const count = useMemo(() => countCombinations(selection, settings.talentLoadouts.length), [selection, settings.talentLoadouts.length]);
  const issues = useMemo(() => validate(selection), [selection]);
  const overCap = count > COMBINATION_CAP;
  const estimate = useMemo(() => estimateSeconds(Math.min(count, COMBINATION_CAP), settings.precision), [count, settings.precision]);
  const canRun = !!parsed && !overCap && issues.length === 0;

  const start = useCallback(() => {
    if (!canRun) return;
    runner.start(selection, settings, scenario);
    setStep("running");
  }, [canRun, selection, settings, scenario, setStep]);

  // Cmd/Ctrl+Enter runs from anywhere in setup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && urlStep === "setup") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, urlStep]);

  return {
    scenario,
    step: urlStep,
    setStep,
    text,
    setText,
    pasteSample: () => setText(SAMPLE_ADDON_STRING),
    parse,
    parsed,
    selection,
    toggle: (uid: string) => setSelection((s) => ({ ...s, [uid]: !s[uid] })),
    setSelection,
    settings,
    setSettings,
    count,
    overCap,
    estimate,
    issues,
    canRun,
    start,
    stop: (keep: boolean) => runner.requestStop(keep),
    backToSetup: () => {
      runner.reset();
      setStep("setup");
    },
    newImport: () => {
      runner.reset();
      setParsed(null);
      setText("");
      parse.reset();
      setStep("paste");
    },
    run,
    simc: simc.data,
  };
}

export type Flow = ReturnType<typeof useTopGearFlow>;
