import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * Provider-agnostic SMTP transport. All configuration comes from env vars at
 * send/verify time — no provider hostname is hardcoded. The same code path
 * works for any SMTP server (only env values change between providers).
 */

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

let transporter: Transporter | null = null;

function readConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  const missing: string[] = [];
  if (!host) missing.push("SMTP_HOST");
  if (!port) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!from) missing.push("SMTP_FROM");

  if (missing.length > 0) {
    throw new Error(
      `Email transport is not configured. Missing env var(s): ${missing.join(", ")}`,
    );
  }

  return {
    host: host as string,
    port: Number(port),
    secure: port === "465",
    user: user as string,
    pass: pass as string,
    from: from as string,
  };
}

function getTransporter(): { transport: Transporter; from: string } {
  const config = readConfig();
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }
  return { transport: transporter, from: config.from };
}

/** Derive a minimal plaintext fallback from an HTML string. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A single in-memory file attachment. `content` is a Buffer that the caller
 * already has in hand — this module never reads from disk or fetches a URL, so
 * an attachment can only ever be something the application itself produced.
 */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  /**
   * Content-ID for embedding via <img src="cid:…">. Setting this moves the
   * part into a multipart/related node so the image renders inside the message
   * body instead of appearing only as a download.
   */
  cid?: string;
  /** Nodemailer already defaults to "inline" when cid is set; be explicit. */
  contentDisposition?: "attachment" | "inline";
}

export async function sendEmail(params: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /**
   * Optional. Omitted entirely when undefined, so every existing caller (e.g.
   * the funding alerts) produces byte-for-byte the same message as before.
   */
  attachments?: EmailAttachment[];
}): Promise<{ messageId: string }> {
  const { transport, from } = getTransporter();
  const info = await transport.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text ?? htmlToText(params.html),
    attachments: params.attachments,
  });
  return { messageId: info.messageId };
}

export async function verifyEmailTransport(): Promise<{ ok: true }> {
  const { transport } = getTransporter();
  await transport.verify();
  return { ok: true };
}
