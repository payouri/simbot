export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RegistryDeps = {
  fetch: Fetch;
  /** Injected so tests don't wait out backoff. */
  sleep?: (ms: number) => Promise<void>;
};

const REPO = "simulationcraftorg/simc";
const AUTH_URL = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${REPO}:pull`;
const REGISTRY = `https://registry-1.docker.io/v2/${REPO}`;
const TAGS_URL = `https://hub.docker.com/v2/repositories/${REPO}/tags?ordering=last_updated&page_size=50`;

const MANIFEST_ACCEPT = [
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.oci.image.index.v1+json",
].join(", ");

/** `<simc version>-<date>-<short sha>`; excludes `latest` and anything else that isn't a nightly. */
export const NIGHTLY_TAG = /^\d+-\d{4}-\d{2}-\d{2}-[0-9a-f]{7,40}$/;

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 500;
const MAX_RETRY_AFTER_MS = 60_000;

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export function retryAfterMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
    : undefined;
}

/** Network errors, 5xx and 429 get 3 tries with backoff. Anything else fails at once. */
export function createRetry(sleep: (ms: number) => Promise<void>) {
  return async function withRetry<T>(what: string, run: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await run();
      } catch (err) {
        const retryable = err instanceof RegistryError ? err.retryable : true;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new Error(`${what} failed after ${attempt} attempt(s): ${reason}`, { cause: err });
        }
        const wait = err instanceof RegistryError ? err.retryAfterMs : undefined;
        await sleep(wait ?? BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  };
}

export type Manifest = { layers: { digest: string; size: number }[] };

export function createRegistryClient({ fetch, sleep = Bun.sleep }: RegistryDeps) {
  const withRetry = createRetry(sleep);

  async function request(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    if (res.ok) return res;
    const retryable = res.status >= 500 || res.status === 429 || res.status === 401;
    throw new RegistryError(
      `HTTP ${res.status} from ${new URL(url).host}`,
      retryable,
      retryAfterMs(res),
    );
  }

  let token: string | undefined;
  async function authed(url: string, accept?: string): Promise<Response> {
    if (!token) {
      const auth = await request(AUTH_URL);
      const body = (await auth.json()) as { token?: unknown };
      if (typeof body.token !== "string")
        throw new RegistryError("no token in auth response", false);
      token = body.token;
    }
    try {
      return await request(url, {
        headers: { authorization: `Bearer ${token}`, ...(accept ? { accept } : {}) },
      });
    } catch (err) {
      token = undefined; // expired or rejected: fetch a fresh one on the retry
      throw err;
    }
  }

  return {
    /** Nightly tags, most recently pushed first. Not rate-limited like registry pulls. */
    listNightlyTags(): Promise<string[]> {
      return withRetry("listing SimC nightly tags", async () => {
        const res = await request(TAGS_URL);
        const body = (await res.json()) as { results?: { name?: unknown }[] };
        return (body.results ?? [])
          .map((r) => r.name)
          .filter((n): n is string => typeof n === "string" && NIGHTLY_TAG.test(n));
      });
    },

    /** The amd64 image manifest for `tag`. Counts as a registry pull, so call it only when applying. */
    fetchManifest(tag: string): Promise<Manifest> {
      return withRetry(`fetching manifest ${tag}`, async () => {
        let res = await authed(`${REGISTRY}/manifests/${tag}`, MANIFEST_ACCEPT);
        let body = (await res.json()) as Record<string, unknown>;
        if (Array.isArray(body.manifests)) {
          const amd64 = (
            body.manifests as {
              digest?: string;
              platform?: { architecture?: string; os?: string };
            }[]
          ).find((m) => m.platform?.architecture === "amd64" && m.platform.os === "linux");
          if (!amd64?.digest) throw new RegistryError(`no linux/amd64 image for ${tag}`, false);
          res = await authed(`${REGISTRY}/manifests/${amd64.digest}`, MANIFEST_ACCEPT);
          body = (await res.json()) as Record<string, unknown>;
        }
        const layers = body.layers;
        if (!Array.isArray(layers) || layers.length === 0) {
          throw new RegistryError(`manifest for ${tag} has no layers`, false);
        }
        return {
          layers: layers.map((l: { digest: string; size: number }) => ({
            digest: String(l.digest),
            size: Number(l.size),
          })),
        };
      });
    },

    /** A layer blob, checked against its digest. */
    fetchBlob(digest: string): Promise<Uint8Array> {
      return withRetry(`fetching layer ${digest.slice(7, 19)}`, async () => {
        const res = await authed(`${REGISTRY}/blobs/${digest}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const actual = `sha256:${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
        if (actual !== digest)
          throw new RegistryError(`layer digest mismatch (got ${actual})`, true);
        return bytes;
      });
    },
  };
}

export type RegistryClient = ReturnType<typeof createRegistryClient>;
