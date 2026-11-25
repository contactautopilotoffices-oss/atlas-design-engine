/**
 * Server-side Higgsfield API client, implemented from the official docs:
 *  - Auth:      Authorization: Key <KEY_ID>:<KEY_SECRET>               (docs/authentication.md)
 *  - Submit:    POST {base}/{model endpoint} + Idempotency-Key          (model pages, concepts/requests.md)
 *  - Status:    GET  {base}/requests/{id}/status                        (api-reference)
 *  - Cancel:    POST {base}/requests/{id}/cancel  (202; 400 once started)
 *  - Uploads:   POST {base}/files/generate-upload-url, then PUT to upload_url with upload_headers
 *  - Errors:    429 honours Retry-After; 5xx/503 retried with backoff; 401/403/404/422 not retried
 *
 * `fetchImpl` is injectable so automated tests never call the paid API.
 */
export type HiggsfieldStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export type StatusResponse = {
  status: HiggsfieldStatus;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  error?: string | null;
  images?: Array<{ url: string }>;
  expires_at?: string | null;
};

export class HiggsfieldError extends Error {
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

export class HiggsfieldClient {
  constructor(
    private readonly credential: string,
    private readonly base = "https://api.higgsfield.ai",
    private readonly fetchImpl: Fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Key ${this.credential}`, "Content-Type": "application/json", Accept: "application/json", ...extra };
  }

  private async call(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}, maxAttempts = 4): Promise<Response> {
    let attempt = 0;
    for (;;) {
      attempt++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method, headers: this.headers(extraHeaders), body: body === undefined ? undefined : JSON.stringify(body) });
      } catch {
        if (attempt >= maxAttempts) throw new HiggsfieldError("Could not reach Higgsfield (network error).", 0, true);
        await this.sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 300);
        continue;
      }
      if (res.ok) return res;
      const text = await res.text().catch(() => "");
      let detail = "";
      let retryAfter: number | null = null;
      try {
        const j = JSON.parse(text);
        detail = typeof j.detail === "string" ? j.detail : typeof j.error === "string" ? j.error : typeof j.code === "string" ? j.code : "";
        if (typeof j.retry_after_seconds === "number") retryAfter = j.retry_after_seconds;
      } catch {
        /* non-JSON body */
      }
      const ra = res.headers.get("retry-after");
      if (ra && !Number.isNaN(Number(ra))) retryAfter = Number(ra);
      const retryable = res.status === 429 || res.status === 423 || res.status >= 500;
      const message = describe(res.status, detail);
      if (!retryable || attempt >= maxAttempts) throw new HiggsfieldError(message, res.status, retryable, retryAfter);
      await this.sleep(retryAfter != null ? retryAfter * 1000 : Math.min(10000, 1000 * 2 ** attempt) + Math.random() * 500);
    }
  }

  /** Uploads a reference image and returns the public_url to pass in image_urls. */
  async uploadImage(data: Buffer, contentType: string): Promise<string> {
    const res = await this.call("POST", `${this.base}/files/generate-upload-url`, { content_type: contentType });
    const j = (await res.json()) as { public_url: string; upload_url: string; upload_headers?: Record<string, string> };
    if (!j.upload_url || !j.public_url) throw new HiggsfieldError("Upload URL response was missing fields.", 502, false);
    // Do NOT send Higgsfield credentials to the presigned storage URL.
    const put = await this.fetchImpl(j.upload_url, { method: "PUT", headers: { ...(j.upload_headers ?? {}), "Content-Type": contentType }, body: new Uint8Array(data) });
    if (!put.ok) throw new HiggsfieldError(`Reference upload failed (${put.status}).`, put.status, put.status >= 500);
    return j.public_url;
  }

  async submit(endpoint: string, body: Record<string, unknown>, idempotencyKey: string): Promise<StatusResponse> {
    const res = await this.call("POST", `${this.base}${endpoint}`, body, { "Idempotency-Key": idempotencyKey });
    return (await res.json()) as StatusResponse;
  }

  async status(requestId: string): Promise<StatusResponse> {
    const res = await this.call("GET", `${this.base}/requests/${encodeURIComponent(requestId)}/status`, undefined, {}, 3);
    return (await res.json()) as StatusResponse;
  }

  /** Returns false when the provider says processing already started (HTTP 400). */
  async cancel(requestId: string): Promise<boolean> {
    try {
      await this.call("POST", `${this.base}/requests/${encodeURIComponent(requestId)}/cancel`, undefined, {}, 2);
      return true;
    } catch (e) {
      if (e instanceof HiggsfieldError && e.httpStatus === 400) return false;
      throw e;
    }
  }
}

function describe(status: number, detail: string) {
  const d = detail ? ` (${detail})` : "";
  switch (status) {
    case 400:
      return `Higgsfield rejected the request parameters${d}.`;
    case 401:
      return "Higgsfield did not accept the API credentials. Check the key in .env.";
    case 403:
      return "Higgsfield reports insufficient balance on the account.";
    case 404:
      return `Model or request not found for this Higgsfield account${d}.`;
    case 409:
      return "The request is still running.";
    case 422:
      return `Higgsfield validation failed${d}.`;
    case 423:
      return "This Higgsfield model is temporarily blocked. Try again later.";
    case 429:
      return "Higgsfield's generation queue is full. Try again shortly.";
    case 503:
      return "Higgsfield is temporarily unavailable.";
    default:
      return `Higgsfield error ${status}${d}.`;
  }
}

/** Maps provider status to the app's job statuses. */
export function mapStatus(s: HiggsfieldStatus): "queued" | "processing" | "completed" | "failed" | "cancelled" {
  switch (s) {
    case "queued":
      return "queued";
    case "in_progress":
      return "processing";
    case "completed":
      return "completed";
    case "canceled":
      return "cancelled";
    case "nsfw":
    case "failed":
    default:
      return "failed";
  }
}
