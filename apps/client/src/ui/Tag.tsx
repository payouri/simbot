import clsx from "clsx";

/** A tag in the design system's tones. */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "action" | "loss" | "noise";
}) {
  const tones = {
    neutral: "border-line text-muted",
    action: "border-action/40 bg-action-wash text-action",
    loss: "border-loss/40 bg-loss-wash text-loss",
    noise: "border-noise/40 bg-noise-wash text-muted",
  };
  return (
    <span
      className={clsx(
        "inline-flex h-[18px] items-center rounded-[4px] border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
