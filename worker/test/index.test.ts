import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("worker routes", () => {
  it("health endpoint", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://bot.example/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("running");
  });

  it("webhook rejects requests without the Telegram secret header", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://bot.example/webhook", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
      env,
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it("unknown path is 404", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://bot.example/nope"), env, ctx);
    expect(res.status).toBe(404);
  });
});
