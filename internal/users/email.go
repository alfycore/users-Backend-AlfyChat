// ==========================================
// ALFYCHAT - SERVICE EMAIL (SMTP)
// ==========================================

package users

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/smtp"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

const appName = "AlfyChat"

func frontendURL() string  { return platform.Env("FRONTEND_URL", "http://localhost:4000") }
func fromEmail() string    { return platform.Env("SMTP_USER", "no-reply@alfycore.org") }
func contactEmail() string { return platform.Env("CONTACT_EMAIL", "contact@alfycore.org") }

// Palette calquée sur l'identité de l'app.
const (
	brandViolet    = "#7627FF"
	brandBg        = "#050505"
	brandCard      = "#121218"
	brandBorder    = "rgba(255,255,255,0.08)"
	brandText      = "#E3E3E3"
	brandTextDim   = "#8a8a92"
	brandTextFaint = "#5a5a62"
	brandEmerald   = "#34D399"
	brandDanger    = "#DC3B31"
	brandWarning   = "#F4B94B"
)

var schemeRe = regexp.MustCompile(`^https?://`)

func baseTemplate(content, accent string) string {
	front := frontendURL()
	logo := front + "/logoicon/Logomark.png"
	r := strings.NewReplacer(
		"{{APP}}", appName, "{{BG}}", brandBg, "{{CARD}}", brandCard, "{{BORDER}}", brandBorder,
		"{{TEXT}}", brandText, "{{FAINT}}", brandTextFaint, "{{EMERALD}}", brandEmerald,
		"{{LOGO}}", logo, "{{CONTACT}}", contactEmail(), "{{ACCENT}}", accent, "{{FRONT}}", front,
		"{{FRONTSHORT}}", schemeRe.ReplaceAllString(front, ""), "{{YEAR}}", strconv.Itoa(time.Now().Year()),
	)
	// Le contenu est inséré après le remplacement des jetons pour ne jamais être réinterprété.
	return strings.Replace(r.Replace(baseHTML), "{{CONTENT}}", content, 1)
}

const baseHTML = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>{{APP}}</title>
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
<body style="margin:0;padding:0;background:{{BG}};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" bgcolor="{{BG}}" style="background:{{BG}};padding:48px 16px">
    <tr>
      <td align="center">
        <table class="container" width="560" cellpadding="0" cellspacing="0" role="presentation" style="width:560px;max-width:100%">

          <!-- Wordmark : logo officiel + nom en Krona One -->
          <tr>
            <td align="center" style="padding:0 0 28px">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-right:9px;vertical-align:middle">
                    <img src="{{LOGO}}" width="26" height="26" alt="{{APP}}" style="display:block;border-radius:7px" />
                  </td>
                  <td style="vertical-align:middle">
                    <span style="font-family:'Krona One',-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;color:{{TEXT}};letter-spacing:0.5px">{{APP}}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Carte -->
          <tr>
            <td class="fade-up" style="background:{{CARD}};border-radius:22px;overflow:hidden;border:1px solid {{BORDER}}">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td class="px" style="padding:40px 36px 8px">
                    {{CONTENT}}
                  </td>
                </tr>
                <tr>
                  <td class="px" style="padding:8px 36px 32px">
                    <div style="height:1px;background:rgba(255,255,255,0.06);margin:20px 0 18px"></div>
                    <p style="margin:0;color:{{FAINT}};font-size:12px;line-height:1.6">
                      Envoyé automatiquement, merci de ne pas répondre directement.<br/>
                      Besoin d'aide ? <a href="mailto:{{CONTACT}}" style="color:{{ACCENT}};text-decoration:none">{{CONTACT}}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Bandeau sécurité, même ton que l'écran de connexion -->
          <tr>
            <td align="center" style="padding:22px 20px 0">
              <p style="margin:0;color:{{FAINT}};font-size:11px;letter-spacing:0.2px">
                <span style="color:{{EMERALD}}">●</span>&nbsp;Chiffrement de bout en bout&nbsp;&nbsp;·&nbsp;&nbsp;Hébergé en France&nbsp;&nbsp;·&nbsp;&nbsp;<a href="{{FRONT}}" style="color:{{FAINT}};text-decoration:none">{{FRONTSHORT}}</a>
              </p>
              <p style="margin:10px 0 0;color:#3a3a40;font-size:10.5px">© {{YEAR}} {{APP}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

func heading(text string) string {
	return `<h2 style="margin:0 0 10px;color:` + brandText + `;font-size:20px;font-weight:700;letter-spacing:-0.2px;line-height:1.3">` + text + `</h2>`
}

func paragraph(html string) string {
	return `<p style="margin:0 0 20px;color:` + brandTextDim + `;font-size:14.5px;line-height:1.65">` + html + `</p>`
}

func infoBox(text, accent string) string {
	return `<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-left:3px solid ` + accent + `;padding:13px 16px;border-radius:10px;margin:0 0 4px">
    <p style="margin:0;color:` + brandTextDim + `;font-size:12.5px;line-height:1.55">` + text + `</p>
  </div>`
}

func ctaButton(url, label, accent string) string {
	return `<div style="margin:26px 0">
    <a href="` + url + `" class="btn"
       style="display:inline-block;background:` + accent + `;color:#fff;text-decoration:none;padding:14px 34px;border-radius:12px;font-size:14.5px;font-weight:600">
      ` + label + `
    </a>
  </div>`
}

func strong(s string) string { return `<strong style="color:` + brandText + `">` + s + `</strong>` }

func buildVerificationHTML(username, token string) string {
	verifyURL := frontendURL() + "/verify-email?token=" + token
	accent := brandViolet
	return baseTemplate(`
      `+heading("Vérifiez votre adresse email")+`
      `+paragraph("Bonjour "+strong(username)+", bienvenue sur "+appName+" ! Confirmez votre adresse email pour activer votre compte et débloquer toutes les fonctionnalités.")+`
      `+ctaButton(verifyURL, "Vérifier mon email", accent)+`
      <p style="margin:0 0 6px;color:`+brandTextFaint+`;font-size:12.5px">Ou copiez ce lien dans votre navigateur :</p>
      <p style="margin:0 0 22px;word-break:break-all">
        <a href="`+verifyURL+`" style="color:`+accent+`;font-size:12.5px;text-decoration:none">`+verifyURL+`</a>
      </p>
      `+infoBox("Ce lien expire dans "+strong("24 heures")+".", accent)+`
      <p style="margin:20px 0 0;color:`+brandTextFaint+`;font-size:12.5px;line-height:1.6">
        Si vous n'avez pas créé de compte sur `+appName+`, vous pouvez ignorer cet email en toute sécurité.
      </p>
      `, accent)
}

func buildTwoFactorHTML(username, code string) string {
	accent := brandViolet
	return baseTemplate(`
      `+heading("Code de vérification")+`
      `+paragraph("Bonjour "+strong(username)+", voici votre code à usage unique pour vous connecter à "+appName+" :")+`
      <div class="pop-in" style="margin:26px 0">
        <div style="display:inline-block;background:rgba(255,255,255,0.025);border:1px solid `+accent+`55;border-radius:14px;padding:20px 40px">
          <span style="font-size:36px;font-weight:800;letter-spacing:9px;color:`+brandText+`;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">`+code+`</span>
        </div>
      </div>
      `+infoBox("Ce code expire dans "+strong("10 minutes")+".", brandWarning)+`
      <p style="margin:20px 0 0;color:`+brandTextFaint+`;font-size:12.5px;line-height:1.6">
        Vous n'êtes pas à l'origine de cette tentative de connexion ? Changez votre mot de passe immédiatement, votre compte est peut-être compromis.
      </p>
      `, accent)
}

func buildPasswordResetHTML(username, token string) string {
	resetURL := frontendURL() + "/reset-password?token=" + token
	accent := brandDanger
	return baseTemplate(`
      `+heading("Réinitialisation de mot de passe")+`
      `+paragraph("Bonjour "+strong(username)+", vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en définir un nouveau.")+`
      `+ctaButton(resetURL, "Réinitialiser mon mot de passe", accent)+`
      `+infoBox("Ce lien expire dans "+strong("1 heure")+".", accent)+`
      <p style="margin:20px 0 0;color:`+brandTextFaint+`;font-size:12.5px;line-height:1.6">
        Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe restera inchangé.
      </p>
      `, accent)
}

func buildTicketHTML(ticketNumber, ticketSubject, category string) string {
	supportURL := frontendURL() + "/support/mes-tickets"
	accent := brandViolet
	return baseTemplate(`
      `+heading("Demande de support reçue")+`
      `+paragraph("Votre demande a bien été enregistrée. Notre équipe vous répondra sous "+strong("24 heures ouvrées")+" (lun–ven, 9h–18h).")+`
      <div class="pop-in" style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.07);border-radius:14px;padding:20px 22px;margin:0 0 26px">
        <p style="margin:0 0 6px;color:`+brandTextFaint+`;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Numéro de ticket</p>
        <p style="margin:0 0 16px;color:`+accent+`;font-size:22px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">#`+ticketNumber+`</p>
        <p style="margin:0 0 4px;color:`+brandTextFaint+`;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Sujet</p>
        <p style="margin:0 0 16px;color:`+brandText+`;font-size:14.5px;font-weight:500">`+ticketSubject+`</p>
        <p style="margin:0 0 4px;color:`+brandTextFaint+`;font-size:11px;text-transform:uppercase;letter-spacing:0.6px;font-weight:600">Catégorie</p>
        <p style="margin:0;color:`+brandTextDim+`;font-size:14px">`+category+`</p>
      </div>
      `+ctaButton(supportURL, "Suivre mes tickets", accent)+`
      <p style="margin:20px 0 0;color:`+brandTextFaint+`;font-size:12.5px;line-height:1.6">
        Conservez ce numéro de ticket pour toute référence future. Vous serez notifié par email de chaque réponse.
      </p>
      `, accent)
}

// Types d'email pilotables depuis la page de test admin.
var emailPreviewTypes = []struct{ ID, Label string }{
	{"verification", "Vérification email"},
	{"2fa", "Code de vérification (2FA)"},
	{"password-reset", "Réinitialisation mot de passe"},
	{"ticket", "Confirmation de ticket support"},
}

func previewHTML(typ string) (string, bool) {
	switch typ {
	case "verification":
		return buildVerificationHTML("Alex", "preview-token-abc123"), true
	case "2fa":
		return buildTwoFactorHTML("Alex", "482913"), true
	case "password-reset":
		return buildPasswordResetHTML("Alex", "preview-token-def456"), true
	case "ticket":
		return buildTicketHTML("1042", "Impossible de me connecter à mon compte", "Compte & connexion"), true
	}
	return "", false
}

var previewSubjects = map[string]string{
	"verification":   "Vérifiez votre email — " + appName,
	"2fa":            "Code de vérification — " + appName,
	"password-reset": "Réinitialisation de mot de passe — " + appName,
	"ticket":         "Ticket #1042 reçu — " + appName + " Support",
}

type emailService struct{}

func (emailService) sendVerificationEmail(to, username, token string) bool {
	return sendMail(to, "Vérifiez votre email — "+appName, buildVerificationHTML(username, token))
}

func (emailService) sendTwoFactorCode(to, username, code string) bool {
	return sendMail(to, "Code de vérification — "+appName, buildTwoFactorHTML(username, code))
}

func (emailService) sendPasswordResetEmail(to, username, token string) bool {
	return sendMail(to, "Réinitialisation de mot de passe — "+appName, buildPasswordResetHTML(username, token))
}

func (emailService) sendTicketConfirmation(to string, ticketNumber int64, subject, category string) bool {
	return sendMail(to, "Ticket #"+strconv.FormatInt(ticketNumber, 10)+" reçu — "+appName+" Support",
		buildTicketHTML(strconv.FormatInt(ticketNumber, 10), subject, category))
}

func (emailService) sendPreviewEmail(typ, to string) bool {
	html, ok := previewHTML(typ)
	if !ok {
		return false
	}
	return sendMail(to, "[TEST] "+previewSubjects[typ], html)
}

// sendMail envoie un email HTML par SMTP (STARTTLS) ; renvoie faux en cas d'échec.
func sendMail(to, subject, html string) bool {
	user, pass := os.Getenv("SMTP_USER"), os.Getenv("SMTP_PASS")
	if user == "" || pass == "" {
		slog.Error("Erreur envoi email à "+to, "err", "SMTP_USER and SMTP_PASS environment variables are required")
		return false
	}
	host := platform.Env("SMTP_HOST", "mail.infomaniak.com")
	port := platform.EnvInt("SMTP_PORT", 587)
	if port == 0 {
		port = 587
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))

	var msg strings.Builder
	msg.WriteString("From: " + mime.QEncoding.Encode("utf-8", appName) + " <" + fromEmail() + ">\r\n")
	msg.WriteString("To: " + to + "\r\n")
	msg.WriteString("Subject: " + mime.BEncoding.Encode("utf-8", subject) + "\r\n")
	msg.WriteString("MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")
	enc := base64.StdEncoding.EncodeToString([]byte(html))
	for len(enc) > 76 {
		msg.WriteString(enc[:76] + "\r\n")
		enc = enc[76:]
	}
	msg.WriteString(enc + "\r\n")

	if err := smtpSend(addr, host, user, pass, fromEmail(), to, msg.String()); err != nil {
		slog.Error("Erreur envoi email à "+to, "err", err)
		return false
	}
	slog.Info("Email envoyé à " + to + " : " + subject)
	return true
}

func smtpSend(addr, host, user, pass, from, to, msg string) error {
	conn, err := net.DialTimeout("tcp", addr, 30*time.Second)
	if err != nil {
		return err
	}
	_ = conn.SetDeadline(time.Now().Add(60 * time.Second))
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	if err := c.Auth(smtp.PlainAuth("", user, pass, host)); err != nil {
		return err
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := fmt.Fprint(w, msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}
