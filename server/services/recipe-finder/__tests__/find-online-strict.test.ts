// findOnline against the REAL searchCatalogRecipes (only fetch is stubbed):
// a Spoonacular reply that is not a search result must read "unavailable",
// never "no matches" (spec §6; #1151 review follow-up item 2).
import { describe, it, expect, vi, afterEach } from "vitest";

const originalFetch = globalThis.fetch;

function stubFetchJson(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  globalThis.fetch = fetchMock;
  return fetchMock;
}

/** recipe-catalog captures SPOONACULAR_API_KEY at module load. */
async function importFindOnline(keyAtLoad: string | undefined) {
  vi.resetModules();
  if (keyAtLoad === undefined) delete process.env.SPOONACULAR_API_KEY;
  else process.env.SPOONACULAR_API_KEY = keyAtLoad;
  return (await import("../find-online")).findOnline;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.resetModules();
  delete process.env.SPOONACULAR_API_KEY;
});

describe("findOnline — strict catalog search", () => {
  it("control: a real search result comes back as items", async () => {
    const findOnline = await importFindOnline("test-key");
    const fetchMock = stubFetchJson({
      results: [{ id: 715538, title: "Bowl", readyInMinutes: 25 }],
      offset: 0,
      number: 5,
      totalResults: 1,
    });
    const result = await findOnline({ q: "bowl" }, []);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "ok",
      items: [expect.objectContaining({ id: 715538, title: "Bowl" })],
    });
  });

  it("a malformed 200 (Spoonacular's error envelope) is unavailable, not no-matches", async () => {
    const findOnline = await importFindOnline("test-key");
    const fetchMock = stubFetchJson({ status: "failure", code: 401 });
    const result = await findOnline({ q: "bowl" }, []);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "unavailable" });
  });

  it("a key missing at module load is unavailable, not no-matches", async () => {
    const findOnline = await importFindOnline(undefined);
    // Set after load: isOnlineCatalogConfigured() passes, the catalog's
    // module-load capture does not.
    process.env.SPOONACULAR_API_KEY = "late-key";
    const fetchMock = stubFetchJson({ results: [] });
    const result = await findOnline({ q: "bowl" }, []);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "unavailable" });
  });
});
