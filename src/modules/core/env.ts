import "server-only";
/**
 * Server-only environment access. Never import this from a client component.
 * Values are validated here and only booleans / non-secret settings leave this module.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  VERCEL: z.string().optional(),
  ATLAS_DATA_DIR: z.string().optional(),
  ATLAS_MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
  ATLAS_ADMIN_PASSCODE: z.string().optional(),
  ATLAS_DESIGNER_PASSCODE: z.string().optional(),
  ATLAS_SESSION_SECRET: z.string().optional(),
  ATLAS_PERSISTENCE: z.enum(["auto", "local", "supabase"]).default("auto"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  HIGGSFIELD_API_BASE: z.string().url().default("https://api.higgsfield.ai"),
  HF_API_KEY_ID: z.string().optional(),
  HF_API_KEY_SECRET: z.string().optional(),
  HIGGSFIELD_API_KEY: z.string().optional(),
  /** Legacy misspelt name found in an existing .env. Still accepted. */
  HIGGSFIELF_API_KEY: z.string().optional(),
  /** OpenAI API key for GPT Image generation and editing models. */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_API_BASE: z.string().url().default("https://api.openai.com"),
  /** Claude API key. Used to read rooms off PDF/image floor plans and run AI vision analysis. */
  ANTHROPIC_API_KEY: z.string().optional(),
  ATLAS_PLAN_MODEL: z.string().default("claude-opus-5-5"),
  ATLAS_VISION_MODEL: z.string().default("claude-sonnet-5-5"),
  RESEND_API_KEY: z.string().optional(),
  ATLAS_EMAIL_FROM: z.string().optional(),
  ATLAS_ENABLE_LIVE_HIGGSFIELD_TEST: z.string().optional(),
});

const blankToUndefined = (src: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(src).map(([k, v]) => [k, v === "" ? undefined : v]));

let cached: z.infer<typeof EnvSchema> | null = null;
export function env() {
  if (!cached || process.env.NODE_ENV === "test") cached = EnvSchema.parse(blankToUndefined(process.env));
  return cached;
}

export const isProduction = () => env().NODE_ENV === "production";
export const isVercel = () => Boolean(env().VERCEL);
export const supabaseConfigured = () => Boolean(env().NEXT_PUBLIC_SUPABASE_URL && env().SUPABASE_SERVICE_ROLE_KEY);
