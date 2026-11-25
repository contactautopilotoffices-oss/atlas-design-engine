/**
 * Server-side OpenAI Images API client:
 *  - Auth:        Authorization: Bearer <OPENAI_API_KEY>
 *  - Text-only:   POST {base}/v1/images/generations (JSON)
 *  - References:  POST {base}/v1/images/edits (multipart/form-data with image / image[])
 *  - Output:      GPT Image models always return base64 (`b64_json`); do not pass `response_format`.
 *  - Errors:      429 honours Retry-After; 5xx/503 retried with backoff; 400/401/403/404/422 not retried.
 *
 * `fetchImpl` is injectable so automated tests never call the paid API.
 */
export type OpenAIImageInput = { data: Buffer; contentType: string; filename: string };

export type OpenAIImageRequest = {
  model: string;
  prompt: string;
  n?: number;
  size?: string;
  quality?: string;
  outputFormat?: "png" | "jpeg" | "webp";
};

export type OpenAIImageResponse = {
  created?: number;
  data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

export class OpenAIError extends Error {
  constructor(
    message: string,
    public httpStatus: number,
    public retryable: boolean,
    public retryAfterSeconds: number | null = null,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export class OpenAIClient {
  constructor(
    private readonly apiKey: string,
    private readonly base = "https://api.openai.com",
    private readonly fetchImpl: Fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private async request(path: string, buildInit: () => RequestInit, maxAttempts = 3): Promise<OpenAIImageResponse> {
    const url = `${this.base.replace(/\/$/, "")}${path}`;
    let attempt = 0;
    for (;;) {
      attempt++;
      let res: Response;
      try {
        const init = buildInit();
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.apiKey}`);
        headers.set("Accept", "application/json");
        res = await this.fetchImpl(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(115_000) });
      } catch (e) {
        if (attempt >= maxAttempts) {
          const msg = e instanceof Error && e.name === "TimeoutError" ? "OpenAI image request timed out." : "Could not reach OpenAI (network error).";
          throw new OpenAIError(msg, 0, true);
        }
        await this.sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300);
        continue;
      }
      if (res.ok) return (await res.json()) as OpenAIImageResponse;
      const text = await res.text().catch(() => "");
      let detail = "";
      let code = "";
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
        detail = j.error?.message ?? "";
        code = j.error?.code ?? "";
      } catch {
        /* non-JSON body */
      }
      const ra = res.headers.get("retry-after");
      const retryAfter = ra && !Number.isNaN(Number(ra)) ? Number(ra) : null;
      const quotaError = code === "insufficient_quota" || /quota|billing/i.test(detail);
      const retryable = !quotaError && (res.status === 429 || res.status >= 500);
      const message = describe(res.status, detail, quotaError);
      if (!retryable || attempt >= maxAttempts) throw new OpenAIError(message, res.status, retryable, retryAfter);
      await this.sleep(retryAfter != null ? retryAfter * 1000 : Math.min(10_000, 1000 * 2 ** attempt) + Math.random() * 500);
    }
  }

  /** Text-only generation via /v1/images/generations. */
  async generate(req: OpenAIImageRequest): Promise<OpenAIImageResponse> {
    const body: Record<string, unknown> = { model: req.model, prompt: req.prompt };
    if (req.n !== undefined) body.n = req.n;
    if (req.size) body.size = req.size;
    if (req.quality) body.quality = req.quality;
    if (req.outputFormat) body.output_format = req.outputFormat;
    return this.request("/v1/images/generations", () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  /** Reference-guided generation/editing via /v1/images/edits (multipart/form-data). */
  async edit(req: OpenAIImageRequest & { images: OpenAIImageInput[] }): Promise<OpenAIImageResponse> {
    if (!req.images.length) return this.generate(req);
    return this.request("/v1/images/edits", () => {
      const form = new FormData();
      form.append("model", req.model);
      form.append("prompt", req.prompt);
      if (req.n !== undefined) form.append("n", String(req.n));
      if (req.size) form.append("size", req.size);
      if (req.quality) form.append("quality", req.quality);
      if (req.outputFormat) form.append("output_format", req.outputFormat);
      const field = req.images.length === 1 ? "image" : "image[]";
      for (const img of req.images) {
        form.append(field, new Blob([new Uint8Array(img.data)], { type: img.contentType }), img.filename);
      }
      return { method: "POST", body: form };
    });
  }
}

function describe(status: number, detail: string, quotaError: boolean) {
  const safeDetail = detail ? ` (${detail})` : "";
  if (quotaError) return `OpenAI reports insufficient quota or billing credit${safeDetail}.`;
  switch (status) {
    case 400:
    case 422:
      return `OpenAI rejected the request parameters${safeDetail}.`;
    case 401:
      return "OpenAI did not accept the API key. Check OPENAI_API_KEY in .env.";
    case 402:
    case 403:
      return `OpenAI denied access for this key or model${safeDetail}.`;
    case 404:
      return `OpenAI image model not found for this account${safeDetail}.`;
    case 429:
      return `OpenAI rate limit reached${safeDetail}. Try again shortly.`;
    case 500:
    case 502:
    case 503:
      return "OpenAI image service is temporarily unavailable.";
    default:
      return `OpenAI error ${status}${safeDetail}.`;
  }
}
