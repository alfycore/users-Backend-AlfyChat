// ==========================================
// ALFYCHAT - SERVICE EMAIL (SMTP)
// ==========================================

import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4000';
const APP_NAME = 'AlfyChat';
const FROM_EMAIL = process.env.SMTP_USER || 'no-reply@alfycore.org';
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || 'contact@alfycore.org';
const LOGO_URL = `${FRONTEND_URL}/logoicon/Logomark.png`;

/**
 * Palette calquée sur l'identité réelle de l'app (globals.css + logo officiel),
 * pas une palette "type Discord" générique :
 *  - violet de marque #7627FF (couleur exacte du logo, cf. public/logo/*.svg)
 *  - fond quasi noir #050505 (identique à AuthBrandPanel)
 *  - carte #121218, bordures translucides blanches (glass), comme les cards
 *    de l'appli (MiniChat/E2ECard dans auth-brand-panel.tsx)
 *  - émeraude #34D399 réservé aux messages liés à la sécurité/E2E, comme
 *    le badge "Chiffrement de bout en bout" de l'écran de connexion
 */
const BRAND = {
  violet: '#7627FF',
  bg: '#050505',
  card: '#121218',
  cardBorder: 'rgba(255,255,255,0.08)',
  text: '#E3E3E3',
  textDim: '#8a8a92',
  textFaint: '#5a5a62',
  emerald: '#34D399',
  danger: '#DC3B31',
  warning: '#F4B94B',
};

function createTransport() {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpUser || !smtpPass) {
    throw new Error('SMTP_USER and SMTP_PASS environment variables are required');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.infomaniak.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // STARTTLS
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    tls: {
      rejectUnauthorized: true,
    },
  });
}

/**
 * Layout commun : fond quasi noir, carte "glass" translucide, logo officiel
 * + wordmark en Krona One (police de titre de l'appli), bandeau de sécurité
 * en pied de page qui reprend le ton de l'écran de connexion.
 * `@import` Krona One se dégrade silencieusement vers la pile de secours sur
 * les clients qui ignorent les web fonts (Outlook desktop) — comportement
 * attendu, pas un bug.
 */
function baseTemplate(content: string, opts: { accent: string }): string {
  const { accent } = opts;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${APP_NAME}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Krona+One&display=swap');
    @keyframes fadeUp {
      from { opacity:0; transform:translateY(8px); }
      to { opacity:1; transform:translateY(0); }
    }
    @keyframes popIn {
      0% { opacity:0; transform:scale(0.9); }
      100% { opacity:1; transform:scale(1); }
    }
    .fade-up { animation: fadeUp .55s cubic-bezier(.22,1,.36,1) both; }
    .pop-in { animation: popIn .5s cubic-bezier(.22,1,.36,1) both; animation-delay:.12s; }
    a.btn:hover { filter:brightness(1.1); }
    @media screen and (max-width:600px) {
      .container { width:100% !important; }
      .px { padding-left:24px !important; padding-right:24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" bgcolor="${BRAND.bg}" style="background:${BRAND.bg};padding:48px 16px">
    <tr>
      <td align="center">
        <table class="container" width="560" cellpadding="0" cellspacing="0" role="presentation" style="width:560px;max-width:100%">

          <!-- Wordmark : logo officiel + nom en Krona One -->
          <tr>
            <td align="center" style="padding:0 0 28px">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-right:9px;vertical-align:middle">
                    <img src="${LOGO_URL}" width="26" height="26" alt="${APP_NAME}" style="display:block;border-radius:7px" />
                  </td>
                  <td style="vertical-align:middle">
                    <span style="font-family:'Krona One',-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;color:${BRAND.text};letter-spacing:0.5px">${APP_NAME}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Carte -->
          <tr>
            <td class="fade-up" style="background:${BRAND.card};border-radius:22px;overflow:hidden;border:1px solid ${BRAND.cardBorder}">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td class="px" style="padding:40px 36px 8px">
                    ${content}
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:8px 36px 32px">
                    <div style="height:1px;background:rgba(255,255,255,0.06);margin:20px 0 18px"></div>
                    <p style="margin:0;color:${BRAND.textFaint};font-size:12px;line-height:1.6">
                      Envoyé automatiquement, merci de ne pas répondre directement.<br/>
                      Besoin d'aide ? <a href="mailto:${CONTACT_EMAIL}" style="color:${accent};text-decoration:none">${CONTACT_EMAIL}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Bandeau sécurité, même ton que l'écran de connexion -->
          <tr>
            <td align="center" style="padding:22px 20px 0">
              <p style="margin:0;color:${BRAND.textFaint};font-size:11px;letter-spacing:0.2px">
                <span style="color:${BRAND.emerald}">●</span>&nbsp;Chiffrement de bout en bout&nbsp;&nbsp;·&nbsp;&nbsp;Hébergé en France&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${FRONTEND_URL}" style="color:${BRAND.textFaint};text-decoration:none">${FRONTEND_URL.replace(/^https?:\/\//, '')}</a>
              </p>
              <p style="margin:10px 0 0;color:#3a3a40;font-size:10.5px">© ${new Date().getFullYear()} ${APP_NAME}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 10px;color:${BRAND.text};font-size:20px;font-weight:700;letter-spacing:-0.2px;line-height:1.3">${text}</h2>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 20px;color:${BRAND.textDim};font-size:14.5px;line-height:1.65">${html}</p>`;
}

function infoBox(text: string, accent: string): string {
  return `<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ${accent};padding:13px 16px;border-radius:10px;margin:0 0 4px">
    <p style="margin:0;color:${BRAND.textDim};font-size:12.5px;line-height:1.55">${text}</p>
  </div>`;
}

function ctaButton(url: string, label: string, accent: string): string {
  return `<div style="margin:26px 0">
    <a href="${url}" class="btn"
       style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:14px 34px;border-radius:12px;font-size:14.5px;font-weight:600">
      ${label}
    </a>
  </div>`;
}

/** Identifiants des types d'email pilotables depuis la page de test admin. */
export type EmailPreviewType = 'verification' | '2fa' | 'password-reset' | 'ticket';

export const EMAIL_PREVIEW_TYPES: { id: EmailPreviewType; label: string }[] = [
  { id: 'verification', label: 'Vérification email' },
  { id: '2fa', label: 'Code de vérification (2FA)' },
  { id: 'password-reset', label: 'Réinitialisation mot de passe' },
  { id: 'ticket', label: 'Confirmation de ticket support' },
];

export class EmailService {
  private buildVerificationHtml(username: string, token: string): string {
    const verifyUrl = `${FRONTEND_URL}/verify-email?token=${token}`;
    const accent = BRAND.violet;
    return baseTemplate(
      `
      ${heading('Vérifiez votre adresse email')}
      ${paragraph(`Bonjour <strong style="color:${BRAND.text}">${username}</strong>, bienvenue sur ${APP_NAME} ! Confirmez votre adresse email pour activer votre compte et débloquer toutes les fonctionnalités.`)}
      ${ctaButton(verifyUrl, 'Vérifier mon email', accent)}
      <p style="margin:0 0 6px;color:${BRAND.textFaint};font-size:12.5px">Ou copiez ce lien dans votre navigateur :</p>
      <p style="margin:0 0 22px;word-break:break-all">
        <a href="${verifyUrl}" style="color:${accent};font-size:12.5px;text-decoration:none">${verifyUrl}</a>
      </p>
      ${infoBox(`Ce lien expire dans <strong style="color:${BRAND.text}">24 heures</strong>.`, accent)}
      <p style="margin:20px 0 0;color:${BRAND.textFaint};font-size:12.5px;line-height:1.6">
        Si vous n'avez pas créé de compte sur ${APP_NAME}, vous pouvez ignorer cet email en toute sécurité.
      </p>
      `,
      { accent },
    );
  }

  private buildTwoFactorHtml(username: string, code: string): string {
    const accent = BRAND.violet;
    return baseTemplate(
      `
      ${heading('Code de vérification')}
      ${paragraph(`Bonjour <strong style="color:${BRAND.text}">${username}</strong>, voici votre code à usage unique pour vous connecter à ${APP_NAME} :`)}
      <div class="pop-in" style="margin:26px 0">
        <div style="display:inline-block;background:rgba(255,255,255,0.025);border:1px solid ${accent}55;border-radius:14px;padding:20px 40px">
          <span style="font-size:36px;font-weight:800;letter-spacing:9px;color:${BRAND.text};font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</span>
        </div>
      </div>
      ${infoBox(`Ce code expire dans <strong style="color:${BRAND.text}">10 minutes</strong>.`, BRAND.warning)}
      <p style="margin:20px 0 0;color:${BRAND.textFaint};font-size:12.5px;line-height:1.6">
        Vous n'êtes pas à l'origine de cette tentative de connexion ? Changez votre mot de passe immédiatement, votre compte est peut-être compromis.
      </p>
      `,
      { accent },
    );
  }

  private buildPasswordResetHtml(username: string, token: string): string {
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`;
    const accent = BRAND.danger;
    return baseTemplate(
      `
      ${heading('Réinitialisation de mot de passe')}
      ${paragraph(`Bonjour <strong style="color:${BRAND.text}">${username}</strong>, vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en définir un nouveau.`)}
      ${ctaButton(resetUrl, 'Réinitialiser mon mot de passe', accent)}
      ${infoBox(`Ce lien expire dans <strong style="color:${BRAND.text}">1 heure</strong>.`, accent)}
      <p style="margin:20px 0 0;color:${BRAND.textFaint};font-size:12.5px;line-height:1.6">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe restera inchangé.
      </p>
      `,
      { accent },
    );
  }

  private buildTicketHtml(ticketNumber: number, ticketSubject: string, category: string): string {
    const supportUrl = `${FRONTEND_URL}/support/mes-tickets`;
    const accent = BRAND.violet;
    return baseTemplate(
      `
      ${heading('Demande de support reçue')}
      ${paragraph(`Votre demande a bien été enregistrée. Notre équipe vous répondra sous <strong style="color:${BRAND.text}">24 heures ouvrées</strong> (lun–ven, 9h–18h).`)}
      <div class="pop-in" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px 22px;margin:0 0 26px">
        <p style="margin:0 0 6px;color:${BRAND.textFaint};font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Numéro de ticket</p>
        <p style="margin:0 0 16px;color:${accent};font-size:22px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">#${ticketNumber}</p>
        <p style="margin:0 0 4px;color:${BRAND.textFaint};font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Sujet</p>
        <p style="margin:0 0 16px;color:${BRAND.text};font-size:14.5px;font-weight:500">${ticketSubject}</p>
        <p style="margin:0 0 4px;color:${BRAND.textFaint};font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Catégorie</p>
        <p style="margin:0;color:${BRAND.textDim};font-size:14px">${category}</p>
      </div>
      ${ctaButton(supportUrl, 'Suivre mes tickets', accent)}
      <p style="margin:20px 0 0;color:${BRAND.textFaint};font-size:12.5px;line-height:1.6">
        Conservez ce numéro de ticket pour toute référence future. Vous serez notifié par email de chaque réponse.
      </p>
      `,
      { accent },
    );
  }

  async sendVerificationEmail(to: string, username: string, token: string): Promise<boolean> {
    return this.send(to, `Vérifiez votre email — ${APP_NAME}`, this.buildVerificationHtml(username, token));
  }

  async sendTwoFactorCode(to: string, username: string, code: string): Promise<boolean> {
    return this.send(to, `Code de vérification — ${APP_NAME}`, this.buildTwoFactorHtml(username, code));
  }

  async sendPasswordResetEmail(to: string, username: string, token: string): Promise<boolean> {
    return this.send(to, `Réinitialisation de mot de passe — ${APP_NAME}`, this.buildPasswordResetHtml(username, token));
  }

  async sendTicketConfirmation(
    to: string,
    ticketNumber: number,
    ticketSubject: string,
    category: string,
  ): Promise<boolean> {
    return this.send(
      to,
      `Ticket #${ticketNumber} reçu — ${APP_NAME} Support`,
      this.buildTicketHtml(ticketNumber, ticketSubject, category),
    );
  }

  /** Rendu HTML avec des données fictives, pour la page de test admin (aucun envoi). */
  previewHtml(type: EmailPreviewType): string {
    const builders: Record<EmailPreviewType, () => string> = {
      verification: () => this.buildVerificationHtml('Alex', 'preview-token-abc123'),
      '2fa': () => this.buildTwoFactorHtml('Alex', '482913'),
      'password-reset': () => this.buildPasswordResetHtml('Alex', 'preview-token-def456'),
      ticket: () => this.buildTicketHtml(1042, 'Impossible de me connecter à mon compte', 'Compte & connexion'),
    };
    return builders[type]();
  }

  /** Envoie un vrai email de test (données fictives) à l'adresse donnée. */
  async sendPreviewEmail(type: EmailPreviewType, to: string): Promise<boolean> {
    const subjects: Record<EmailPreviewType, string> = {
      verification: `Vérifiez votre email — ${APP_NAME}`,
      '2fa': `Code de vérification — ${APP_NAME}`,
      'password-reset': `Réinitialisation de mot de passe — ${APP_NAME}`,
      ticket: `Ticket #1042 reçu — ${APP_NAME} Support`,
    };
    return this.send(to, `[TEST] ${subjects[type]}`, this.previewHtml(type));
  }

  private async send(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const transporter = createTransport();
      await transporter.sendMail({
        from: `"${APP_NAME}" <${FROM_EMAIL}>`,
        to,
        subject,
        html,
      });
      logger.info(`Email envoyé à ${to} : ${subject}`);
      return true;
    } catch (error) {
      logger.error(`Erreur envoi email à ${to}:`, error);
      return false;
    }
  }
}

export const emailService = new EmailService();
