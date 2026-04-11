import nodemailer from "nodemailer";
import { ENV } from "./env";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (_transporter) return _transporter;
  if (!ENV.smtpHost || !ENV.smtpUser) return null;
  _transporter = nodemailer.createTransport({
    host: ENV.smtpHost,
    port: ENV.smtpPort,
    secure: ENV.smtpPort === 465,
    auth: { user: ENV.smtpUser, pass: ENV.smtpPass },
  });
  return _transporter;
}

export function isMailerConfigured(): boolean {
  return Boolean(ENV.smtpHost && ENV.smtpUser);
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn("[Mailer] SMTP not configured, skip sending");
    return false;
  }
  try {
    await t.sendMail({
      from: ENV.smtpFrom || ENV.smtpUser,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return true;
  } catch (e) {
    console.error("[Mailer] Send failed:", e);
    return false;
  }
}
