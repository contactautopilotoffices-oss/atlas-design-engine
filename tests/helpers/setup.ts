import { vi } from "vitest";

/** In-memory cookie jar standing in for next/headers in tests. Switch browsers with useBrowser(). */
const jars = new Map<string, Map<string, string>>();
let current = "browser-a";
export const useBrowser = (name: string) => {
  current = name;
};
const jar = () => {
  if (!jars.has(current)) jars.set(current, new Map());
  return jars.get(current)!;
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar().has(k) ? { name: k, value: jar().get(k)! } : undefined),
    set: (k: string, v: string) => void jar().set(k, v),
    delete: (k: string) => void jar().delete(k),
  }),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));

// Never let tests reach the real Higgsfield API.
process.env.HF_API_KEY_ID = "";
process.env.HF_API_KEY_SECRET = "";
process.env.HIGGSFIELD_API_KEY = "";
process.env.HIGGSFIELF_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ATLAS_ADMIN_PASSCODE = "";
// Never let tests reach the real Claude API either.
process.env.ANTHROPIC_API_KEY = "";
process.env.ATLAS_DESIGNER_PASSCODE = "";
(globalThis as { __useBrowser?: typeof useBrowser }).__useBrowser = useBrowser;
