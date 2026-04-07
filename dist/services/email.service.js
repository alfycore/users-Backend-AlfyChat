"use strict";
// ==========================================
// ALFYCHAT - SERVICE EMAIL (SMTP)
// ==========================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailService = exports.EmailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const logger_1 = require("../utils/logger");
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4000';
const APP_NAME = 'AlfyChat';
const FROM_EMAIL = process.env.SMTP_USER || 'no-reply@alfycore.org';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@alfycore.org';
function createTransport() {
    return nodemailer_1.default.createTransport({
        host: process.env.SMTP_HOST || 'mail.infomaniak.com',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false, // STARTTLS
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        tls: {
            rejectUnauthorized: true,
        },
    });
}
function baseTemplate(content) {
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${APP_NAME}</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 20px">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#5865F2,#3b4dce);padding:32px 40px;text-align:center">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px">${APP_NAME}</h1>
              <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:14px">Communication sécurisée</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #2a2a2a;text-align:center">
              <p style="margin:0;color:#555;font-size:12px">
                Cet email a été envoyé automatiquement, ne pas répondre directement.<br/>
                Pour toute question : <a href="mailto:${CONTACT_EMAIL}" style="color:#5865F2">${CONTACT_EMAIL}</a>
              </p>
              <p style="margin:8px 0 0;color:#444;font-size:11px">© ${new Date().getFullYear()} ${APP_NAME} — Tous droits réservés</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
class EmailService {
    async sendVerificationEmail(to, username, token) {
        const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;
        const html = baseTemplate(`
      <h2 style="margin:0 0 8px;color:#ffffff;font-size:22px">Vérifiez votre adresse email</h2>
      <p style="margin:0 0 24px;color:#aaa;font-size:15px">Bonjour <strong style="color:#fff">${username}</strong>,</p>
      <p style="margin:0 0 24px;color:#aaa;font-size:15px">
        Bienvenue sur ${APP_NAME} ! Pour activer votre compte et profiter de toutes les fonctionnalités,
        veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous.
      </p>
      <div style="text-align:center;margin:32px 0">
        <a href="${verifyUrl}"
           style="display:inline-block;background:#5865F2;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600">
          Vérifier mon email
        </a>
      </div>
      <p style="margin:0 0 8px;color:#666;font-size:13px">
        Ou copiez ce lien dans votre navigateur :
      </p>
      <p style="margin:0 0 24px;word-break:break-all">
        <a href="${verifyUrl}" style="color:#5865F2;font-size:13px">${verifyUrl}</a>
      </p>
      <div style="background:#111;border-left:3px solid #5865F2;padding:12px 16px;border-radius:4px">
        <p style="margin:0;color:#888;font-size:13px">⏰ Ce lien expire dans <strong style="color:#fff">24 heures</strong>.</p>
      </div>
      <p style="margin:24px 0 0;color:#555;font-size:13px">
        Si vous n'avez pas créé de compte sur ${APP_NAME}, ignorez cet email.
      </p>
    `);
        return this.send(to, `Vérifiez votre email — ${APP_NAME}`, html);
    }
    async sendTwoFactorCode(to, username, code) {
        const html = baseTemplate(`
      <h2 style="margin:0 0 8px;color:#ffffff;font-size:22px">Code de vérification</h2>
      <p style="margin:0 0 24px;color:#aaa;font-size:15px">Bonjour <strong style="color:#fff">${username}</strong>,</p>
      <p style="margin:0 0 24px;color:#aaa;font-size:15px">
        Voici votre code de vérification à usage unique pour vous connecter à ${APP_NAME} :
      </p>
      <div style="text-align:center;margin:32px 0">
        <div style="display:inline-block;background:#111;border:1px solid #5865F2;border-radius:12px;padding:20px 40px">
          <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#5865F2;font-family:monospace">${code}</span>
        </div>
      </div>
      <div style="background:#111;border-left:3px solid #f0a500;padding:12px 16px;border-radius:4px">
        <p style="margin:0;color:#888;font-size:13px">⏰ Ce code expire dans <strong style="color:#fff">10 minutes</strong>.</p>
      </div>
      <p style="margin:24px 0 0;color:#555;font-size:13px">
        Si vous n'avez pas tenté de vous connecter, votre compte est peut-être compromis.
        Changez votre mot de passe immédiatement.
      </p>
    `);
        return this.send(to, `Code de vérification — ${APP_NAME}`, html);
    }
    async sendPasswordResetEmail(to, username, token) {
        const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
        const html = baseTemplate(`
      <h2 style="margin:0 0 8px;color:#ffffff;font-size:22px">Réinitialisation de mot de passe</h2>
      <p style="margin:0 0 24px;color:#aaa;font-size:15px">Bonjour <strong style="color:#fff">${username}</strong>,</p>
      <p style="margin:0 0 24px;color:#aaa;font-size:15px">
        Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en définir un nouveau.
      </p>
      <div style="text-align:center;margin:32px 0">
        <a href="${resetUrl}"
           style="display:inline-block;background:#ed4245;color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600">
          Réinitialiser mon mot de passe
        </a>
      </div>
      <div style="background:#111;border-left:3px solid #ed4245;padding:12px 16px;border-radius:4px">
        <p style="margin:0;color:#888;font-size:13px">⏰ Ce lien expire dans <strong style="color:#fff">1 heure</strong>.</p>
      </div>
      <p style="margin:24px 0 0;color:#555;font-size:13px">
        Si vous n'avez pas demandé de réinitialisation, ignorez cet email. Votre mot de passe ne sera pas modifié.
      </p>
    `);
        return this.send(to, `Réinitialisation de mot de passe — ${APP_NAME}`, html);
    }
    async send(to, subject, html) {
        try {
            const transporter = createTransport();
            await transporter.sendMail({
                from: `"${APP_NAME}" <${FROM_EMAIL}>`,
                to,
                subject,
                html,
            });
            logger_1.logger.info(`Email envoyé à ${to} : ${subject}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`Erreur envoi email à ${to}:`, error);
            return false;
        }
    }
}
exports.EmailService = EmailService;
exports.emailService = new EmailService();
//# sourceMappingURL=email.service.js.map