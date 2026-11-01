import assert from "node:assert/strict";
import test from "node:test";
import { HttpJsonModelAdapter } from "../lib/editorial-workbench/live-adapters.ts";
import { editorialRoute } from "../app/api/editorial/_shared.ts";

test("provider credentials and response bodies do not leak through API failures", async () => {
  const canary = "herlit-canary-credential-do-not-export";
  for (const failure of ["http", "json", "network", "timeout"]) {
    const adapter = new HttpJsonModelAdapter({
      provider: "canary-provider", baseUrl: "https://provider.example", apiKey: canary, model: "test",
      fetchImpl: async (_input, init) => {
        assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${canary}`);
        assert.ok(!String(init?.body).includes(canary));
        if (failure === "http") return new Response(canary, { status: 503 });
        if (failure === "json") return new Response(canary);
        const error = new Error(`Upstream failed with ${canary}`);
        if (failure === "timeout") error.name = "TimeoutError";
        throw error;
      },
    });
    const response = await editorialRoute("production", () => adapter.generateJson("grounded_editorial_draft", {}));
    assert.ok(response.status >= 400);
    assert.ok(!(await response.text()).includes(canary));
  }
});
