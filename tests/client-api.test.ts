import { afterEach, expect, test } from "bun:test";
import { preselectDraft } from "../apps/client/src/setup/api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("preselectDraft surfaces the server's 409 message", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: "conflict",
        message: "A Sim's input is frozen once it leaves Draft.",
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  await expect(preselectDraft(1)).rejects.toThrow("A Sim's input is frozen once it leaves Draft.");
});
