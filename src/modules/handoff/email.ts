import "server-only";
/**
 * Email delivery is a later-stage feature. The interface is ready; sending is only enabled
 * when an email provider is configured (RESEND_API_KEY + ATLAS_EMAIL_FROM). Delivery is never
 * simulated: if sending is not configured the API says so and nothing is marked as sent.
 */
import { env } from "@/modules/core/env";

export interface EmailProvider {
  readonly id: string;
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ providerMessageId: string }>;
}

class ResendProvider implements EmailProvider {
  readonly id = "resend";
  constructor(
    private key: string,
    private from: string,
  ) {}
  async send(msg: { to: string; subject: string; html: string; text: string }) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`Email provider returned ${res.status}.`);
    const j = (await res.json()) as { id: string };
    return { providerMessageId: j.id };
  }
}

export function emailProvider(): EmailProvider | null {
  const e = env();
  return e.RESEND_API_KEY && e.ATLAS_EMAIL_FROM ? new ResendProvider(e.RESEND_API_KEY, e.ATLAS_EMAIL_FROM) : null;
}

export const emailStatus = () =>
  emailProvider()
    ? { configured: true, provider: "resend" }
    : { configured: false, provider: null, reason: "Email sending is not configured (needs RESEND_API_KEY and ATLAS_EMAIL_FROM). The summary can be printed or saved as PDF instead." };
