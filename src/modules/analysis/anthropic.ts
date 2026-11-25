import "server-only";
/**
 * Shared Anthropic Messages API helper with tool_use structured output and retries.
 * Never logs or echoes API credentials.
 */
import { AppError } from "@/modules/core/util";

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string } };

export async function callClaudeTool(args: {
  apiKey: string;
  model: string;
  maxTokens: number;
  tool: ClaudeTool;
  content: ClaudeContentBlock[];
  actionLabel: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<unknown> {
  const f = args.fetchImpl ?? fetch;
  const body = {
    model: args.model,
    max_tokens: args.maxTokens,
    tools: [args.tool],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: args.content }],
  };
  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await f("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": args.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
    });
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 3;
    await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
  }
  if (!res!.ok) {
    const detail = await res!.json().then((j: { error?: { message?: string } }) => j?.error?.message ?? "").catch(() => "");
    if (res!.status === 401) throw new AppError("The Claude API key was rejected. Check ANTHROPIC_API_KEY in .env.", 502, "auth");
    throw new AppError(`Claude could not ${args.actionLabel} (${res!.status})${detail ? `: ${detail}` : ""}.`, 502, "upstream");
  }
  const json = (await res!.json()) as { content?: Array<{ type: string; name?: string; input?: unknown }> };
  const call = json.content?.find((c) => c.type === "tool_use" && c.name === args.tool.name);
  if (!call) throw new AppError(`Claude did not return structured results while trying to ${args.actionLabel}.`, 502, "no_tool_use");
  return call.input;
}
