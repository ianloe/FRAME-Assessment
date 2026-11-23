import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class SmtpEmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth:
        config.smtpUser && config.smtpPass
          ? { user: config.smtpUser, pass: config.smtpPass }
          : undefined
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: config.smtpFrom,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html
      });
    } catch (err) {
      // Log without leaking tokens or secrets
      console.warn(`Email delivery failed to ${message.to}:`, (err as Error).message);
    }
  }
}

export const emailProvider: EmailProvider = new SmtpEmailProvider();
