// Variant C: Sim Settings as a sentence of editable tokens; each opens an inline disclosure.

import clsx from "clsx";
import { type ReactNode, useState } from "react";
import { CHARACTER, CONSUMABLES, FIGHT_STYLES, PRECISIONS } from "../../data";
import type { Settings } from "../../engine";
import type { Flow } from "../../flow";

type TokenId = "fight" | "duration" | "targets" | "precision" | "talents" | "consumables" | "raw";

function Token({
  id,
  open,
  onOpen,
  children,
  readOnly,
}: {
  id: TokenId;
  open: TokenId | null;
  onOpen: (t: TokenId | null) => void;
  children: ReactNode;
  readOnly: boolean;
}) {
  const active = open === id;
  return (
    <button
      type="button"
      aria-expanded={active}
      aria-controls="c-settings-disclosure"
      onClick={() => onOpen(active ? null : id)}
      className={clsx(
        "rounded-[4px] px-1 py-0.5 font-medium underline decoration-dotted decoration-1 underline-offset-[5px] transition-colors duration-150",
        active
          ? "bg-action-wash text-action decoration-action"
          : "text-fg decoration-line-strong hover:decoration-action hover:text-action",
        readOnly && "decoration-transparent",
      )}
    >
      {children}
    </button>
  );
}

function Options<T extends string | number>({
  value,
  options,
  onChange,
  readOnly,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={readOnly && o.value !== value}
          onClick={() => !readOnly && onChange(o.value)}
          className={clsx(
            "flex flex-col items-start rounded-[6px] border px-2.5 py-1.5 text-left transition-colors duration-150 disabled:opacity-40",
            o.value === value
              ? "border-action/60 bg-action-wash"
              : "border-line hover:border-line-strong",
          )}
        >
          <span
            className={clsx(
              "text-[13px] font-medium",
              o.value === value ? "text-action" : "text-fg",
            )}
          >
            {o.label}
          </span>
          {o.hint && <span className="text-[11.5px] text-faint">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function describeSettings(s: Settings) {
  const fight = FIGHT_STYLES.find((f) => f.id === s.fightStyle)?.label ?? s.fightStyle;
  const prec = PRECISIONS.find((p) => p.id === s.precision)!.label;
  const talents = s.talentLoadouts
    .map((id) => CHARACTER.talentLoadouts.find((l) => l.id === id)!.name)
    .join(" + ");
  const raw = s.rawOptions.trim() ? s.rawOptions.trim().split("\n").length : 0;
  return { fight, prec, talents, raw };
}

export function SettingsSentence({ flow, readOnly }: { flow: Flow; readOnly: boolean }) {
  const [open, setOpen] = useState<TokenId | null>(null);
  const s = flow.settings;
  const set = (patch: Partial<Settings>) => !readOnly && flow.setSettings({ ...s, ...patch });
  const d = describeSettings(s);
  const sep = <span className="px-1 text-faint">·</span>;

  return (
    <div>
      <p className="text-[15px] leading-8 text-muted">
        <Token id="fight" open={open} onOpen={setOpen} readOnly={readOnly}>
          {d.fight}
        </Token>
        {sep}
        <Token id="duration" open={open} onOpen={setOpen} readOnly={readOnly}>
          <span className="num">{s.duration}</span> s
        </Token>
        {sep}
        <Token id="targets" open={open} onOpen={setOpen} readOnly={readOnly}>
          <span className="num">{s.targets}</span> {s.targets === 1 ? "target" : "targets"}
        </Token>
        {sep}
        <Token id="precision" open={open} onOpen={setOpen} readOnly={readOnly}>
          {d.prec} precision
        </Token>
        {sep}
        <Token id="talents" open={open} onOpen={setOpen} readOnly={readOnly}>
          {d.talents}
        </Token>
        <span> talents</span>
        {sep}
        <Token id="consumables" open={open} onOpen={setOpen} readOnly={readOnly}>
          default consumables
        </Token>
        {sep}
        <Token id="raw" open={open} onOpen={setOpen} readOnly={readOnly}>
          raw SimC options (<span className="num">{d.raw}</span> {d.raw === 1 ? "line" : "lines"})
        </Token>
      </p>

      {open && (
        <div
          id="c-settings-disclosure"
          className="mt-3 rounded-[8px] border border-line bg-panel p-3"
        >
          {open === "fight" && (
            <Options
              value={s.fightStyle}
              readOnly={readOnly}
              onChange={(v) => set({ fightStyle: v })}
              options={FIGHT_STYLES.map((f) => ({
                value: f.id as string,
                label: f.label,
                hint: f.hint,
              }))}
            />
          )}
          {open === "duration" && (
            <Options
              value={s.duration}
              readOnly={readOnly}
              onChange={(v) => set({ duration: v })}
              options={[120, 180, 300, 450].map((v) => ({
                value: v,
                label: `${v} s`,
                hint: v === 300 ? "Default" : undefined,
              }))}
            />
          )}
          {open === "targets" && (
            <Options
              value={s.targets}
              readOnly={readOnly}
              onChange={(v) => set({ targets: v })}
              options={[1, 3, 5, 8].map((v) => ({
                value: v,
                label: `${v} ${v === 1 ? "target" : "targets"}`,
              }))}
            />
          )}
          {open === "precision" && (
            <Options
              value={s.precision}
              readOnly={readOnly}
              onChange={(v) => set({ precision: v })}
              options={
                PRECISIONS.map((p) => ({
                  value: p.id as string,
                  label: p.label,
                  hint: `${p.hint} · target error ${p.targetError}%`,
                })) as { value: Settings["precision"]; label: string; hint: string }[]
              }
            />
          )}
          {open === "talents" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {CHARACTER.talentLoadouts.map((l) => {
                  const on = s.talentLoadouts.includes(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={on}
                      disabled={readOnly}
                      onClick={() => {
                        const next = on
                          ? s.talentLoadouts.filter((x) => x !== l.id)
                          : [...s.talentLoadouts, l.id];
                        if (next.length) set({ talentLoadouts: next });
                      }}
                      className={clsx(
                        "rounded-[6px] border px-2.5 py-1.5 text-left",
                        on
                          ? "border-action/60 bg-action-wash"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <span
                        className={clsx(
                          "block text-[13px] font-medium",
                          on ? "text-action" : "text-fg",
                        )}
                      >
                        {l.name}
                      </span>
                      <span className="num block max-w-[260px] truncate text-[11px] text-faint">
                        {l.code}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[12px] text-faint">
                Loadouts from the Addon String. Each extra loadout multiplies the combination count.
              </p>
            </div>
          )}
          {open === "consumables" && (
            <div>
              <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-[13px]">
                {Object.entries(CONSUMABLES).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-faint capitalize">
                      {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </dt>
                    <dd className="text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[12px] text-faint">
                One set applies to every combination in this version.
              </p>
            </div>
          )}
          {open === "raw" && (
            <div>
              <label htmlFor="c-raw" className="mb-1.5 block text-[12px] text-faint">
                Appended to every profile, one SimC option per line
              </label>
              <textarea
                id="c-raw"
                readOnly={readOnly}
                value={s.rawOptions}
                onChange={(e) => set({ rawOptions: e.target.value })}
                rows={4}
                spellCheck={false}
                placeholder={"desired_targets=1\noverride.bloodlust=0"}
                className="num w-full resize-y rounded-[6px] border border-line bg-sunk p-2 text-[12.5px] text-fg placeholder:text-faint focus:border-action/60 focus:outline-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
