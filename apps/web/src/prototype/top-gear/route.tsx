// PROTOTYPE: three variants of the Top Gear flow (issue #8), switchable via ?variant=A|B|C
// on /prototype/top-gear. Flow state and mock data are shared; layout is not.
import { useSearchParams } from "react-router";
import { useTopGearFlow } from "./flow";
import { VariantSwitcher } from "./Switcher";
import { VariantA, NAME as NAME_A } from "./variants/VariantA";
import { VariantB, NAME as NAME_B } from "./variants/VariantB";
import { VariantC, NAME as NAME_C } from "./variants/VariantC";

const VARIANTS = [
  { key: "A", name: NAME_A, C: VariantA },
  { key: "B", name: NAME_B, C: VariantB },
  { key: "C", name: NAME_C, C: VariantC },
];

export function TopGearPrototypeRoute() {
  const [params] = useSearchParams();
  const flow = useTopGearFlow();
  const current = params.get("variant") ?? "A";
  const V = (VARIANTS.find((v) => v.key === current) ?? VARIANTS[0]).C;
  return (
    <>
      <V flow={flow} />
      <VariantSwitcher variants={VARIANTS} current={current} />
    </>
  );
}
