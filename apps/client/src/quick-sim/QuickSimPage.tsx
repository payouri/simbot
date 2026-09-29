import {
  defaultSimSettings,
  type FightStyle,
  fightStyleSchema,
  type Precision,
  precisionSchema,
  type SimSettings,
} from "@simbot/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { createImport, createSim, queueSim } from "./api";

const PRECISION_LABEL: Record<Precision, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const inputClass =
  "h-7 rounded-[5px] border border-line bg-panel px-2 font-mono text-[12.5px] text-fg focus:border-action";

/** Paste an Addon String, pick Sim Settings, run a Quick Sim. */
export function QuickSimPage() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [settings, setSettings] = useState<SimSettings>(defaultSimSettings);
  const patch = (next: Partial<SimSettings>) => setSettings((s) => ({ ...s, ...next }));

  const run = useMutation({
    mutationFn: async () => {
      const imp = await createImport(text);
      const draft = await createSim({ importId: imp.id, settings });
      return queueSim(draft.id);
    },
    onSuccess: (sim) => navigate(`/sims/${sim.id}`),
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 md:px-6">
      <h1 className="text-[24px] font-semibold tracking-tight">Quick Sim</h1>
      <p className="mt-1 text-[12.5px] text-muted">
        Paste the Addon String from the in-game SimulationCraft addon.
      </p>

      <form
        className="mt-6 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <textarea
          aria-label="Addon String"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={12}
          placeholder={'# Name - Spec - 2026-09-29 22:41 - EU/Realm\n\ndeathknight="Name"\n…'}
          className={`w-full resize-y rounded-[10px] border bg-sunk px-4 py-3.5 font-mono text-[12.5px] text-fg focus:border-action ${
            run.isError ? "border-loss/60" : "border-line"
          }`}
        />

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="sr-only">Sim Settings</legend>
          <label className="flex flex-col gap-1.5 text-[11.5px] text-faint">
            Fight style
            <select
              className={inputClass}
              value={settings.fightStyle}
              onChange={(e) => patch({ fightStyle: e.target.value as FightStyle })}
            >
              {fightStyleSchema.options.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1.5 text-[11.5px] text-faint">
            Precision
            <div className="flex gap-1">
              {precisionSchema.options.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={settings.precision === p}
                  onClick={() => patch({ precision: p })}
                  className={`rounded-[5px] px-2.5 py-1 text-[12.5px] ${
                    settings.precision === p
                      ? "bg-raised text-fg ring-1 ring-line-strong"
                      : "text-muted hover:text-fg"
                  }`}
                >
                  {PRECISION_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5 text-[11.5px] text-faint">
            Duration (seconds)
            <input
              type="number"
              min={10}
              max={1800}
              className={inputClass}
              value={settings.durationSeconds}
              onChange={(e) => patch({ durationSeconds: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[11.5px] text-faint">
            Targets
            <input
              type="number"
              min={1}
              max={20}
              className={inputClass}
              value={settings.targets}
              onChange={(e) => patch({ targets: Number(e.target.value) })}
            />
          </label>
        </fieldset>

        <details className="text-[12.5px] text-muted">
          <summary className="cursor-pointer">Advanced SimC options</summary>
          <textarea
            aria-label="Raw SimC options"
            value={settings.rawOptions}
            onChange={(e) => patch({ rawOptions: e.target.value })}
            spellCheck={false}
            rows={3}
            placeholder="one_option=value"
            className="mt-2 w-full rounded-[8px] border border-line bg-sunk px-3 py-2 font-mono text-[12.5px] text-fg focus:border-action"
          />
        </details>

        {run.isError && (
          <p
            role="alert"
            className="rounded-lg border border-loss/35 bg-loss-wash p-3 text-[12.5px]"
          >
            {run.error.message}
          </p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={text.trim() === "" || run.isPending}
            className="h-9 rounded-[7px] bg-action px-5 text-[14px] font-semibold text-action-ink transition-colors duration-150 hover:bg-action-strong disabled:bg-raised disabled:text-faint"
          >
            {run.isPending ? "Queuing…" : "Run Quick Sim"}
          </button>
          <Link to="/simc" className="text-[12.5px] text-muted hover:text-fg">
            SimC
          </Link>
        </div>
      </form>
    </main>
  );
}
