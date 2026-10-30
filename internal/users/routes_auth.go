// ==========================================
// ALFYCHAT - ROUTES AUTHENTIFICATION
// ==========================================

package users

import (
	"context"
	"encoding/base64"
	"log/slog"
	"net/http"
	"regexp"

	"github.com/alfychat/users/internal/platform"
	qrcode "github.com/skip2/go-qrcode"
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)

func slogErr(msg string, err error) { slog.Error(msg, "err", err) }

// spreadKeys ajoute les champs de clés E2EE présents au corps de la réponse de connexion.
func spreadKeys(body *platform.Object, res authResult) {
	if res.keySalt != "" {
		body.Set("keySalt", res.keySalt)
	}
	if res.encryptedPrivate != "" {
		body.Set("encryptedPrivateKey", res.encryptedPrivate)
	}
	if res.keyMissing {
		body.Set("keyMissing", true)
	}
}

// turnstileGate applique le captcha s'il est activé ; faux si une réponse a déjà été envoyée.
func (h *handlers) turnstileGate(w http.ResponseWriter, ctx context.Context, token any, logMsg string) bool {
	enabled, err := h.isTurnstileEnabled(ctx)
	if err != nil {
		fail(w, logMsg, err)
		return false
	}
	if !enabled {
		return true
	}
	if !platform.Truthy(token) {
		platform.Error(w, 400, "Veuillez compléter le captcha")
		return false
	}
	if !verifyTurnstileToken(ctx, platform.JSString(token)) {
		platform.Error(w, 400, "Vérification captcha échouée. Réessayez.")
		return false
	}
	return true
}

func (h *handlers) apiRegisterSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.getSiteSettings(r.Context())
	if err != nil {
		slogErr("Erreur récupération paramètres inscription:", err)
		platform.JSON(w, 200, platform.O("registrationEnabled", true, "turnstileEnabled", false, "turnstileSiteKey", nil))
		return
	}
	var siteKey any
	if k := settings["turnstile_site_key"]; k != "" {
		siteKey = k
	}
	platform.JSON(w, 200, platform.O("registrationEnabled", settings["registration_enabled"] != "false",
		"turnstileEnabled", settings["turnstile_enabled"] == "true", "turnstileSiteKey", siteKey))
}

func (h *handlers) apiRegister(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("email").IsEmail().NormalizeEmail(),
		platform.BodyField("username").IsString().IsLength(3, 32).Matches(usernameRe),
		platform.BodyField("password").IsString().IsLength(8, 128),
		platform.BodyField("displayName").Optional().IsString().IsLength(0, 64),
		platform.BodyField("inviteCode").Optional().IsString(),
		platform.BodyField("turnstileToken").Optional().IsString(),
		platform.BodyField("publicKey").Optional().IsString(),
		platform.BodyField("encryptedPrivateKey").Optional().IsString(),
		platform.BodyField("keySalt").Optional().IsString().IsLength(0, 64),
	) {
		return
	}
	ctx := r.Context()
	email, _ := str(field(r, "email"))
	username, _ := str(field(r, "username"))
	password, _ := str(field(r, "password"))
	displayName := field(r, "displayName")
	inviteCode := field(r, "inviteCode")

	enabled, err := h.isRegistrationEnabled(ctx)
	if err != nil {
		fail(w, "Erreur inscription:", err)
		return
	}
	if !enabled {
		if !platform.Truthy(inviteCode) {
			platform.JSON(w, 403, platform.O("error", "Les inscriptions sont fermées. Un lien d'invitation est requis.", "registrationClosed", true))
			return
		}
		v, err := h.validateInviteCode(ctx, platform.JSString(inviteCode), email)
		if err != nil {
			fail(w, "Erreur inscription:", err)
			return
		}
		if !v.valid {
			platform.Error(w, 400, v.err)
			return
		}
	}
	if !h.turnstileGate(w, ctx, field(r, "turnstileToken"), "Erreur inscription:") {
		return
	}
	dn := username
	if platform.Truthy(displayName) {
		dn = platform.JSString(displayName)
	}
	res, err := h.registerUser(ctx, email, username, password, dn, field(r, "publicKey"), field(r, "encryptedPrivateKey"), field(r, "keySalt"))
	if err != nil {
		fail(w, "Erreur inscription:", err)
		return
	}
	if !res.success {
		platform.Error(w, 400, res.err)
		return
	}
	if platform.Truthy(inviteCode) && res.user != nil {
		v, err := h.validateInviteCode(ctx, platform.JSString(inviteCode), email)
		if err == nil && v.valid && v.linkID != "" {
			err = h.markInviteLinkUsed(ctx, v.linkID, res.user.Str("id"))
		}
		if err != nil {
			slogErr("Erreur marquage lien invitation:", err)
		}
	}
	platform.JSON(w, 201, platform.O("user", res.user))
}

func (h *handlers) apiLogin(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("email").IsEmail().NormalizeEmail(),
		platform.BodyField("password").IsString().IsLength(1, 128),
	) {
		return
	}
	ctx := r.Context()
	email, _ := str(field(r, "email"))
	password, _ := str(field(r, "password"))
	if !h.turnstileGate(w, ctx, field(r, "turnstileToken"), "Erreur connexion:") {
		return
	}
	res, err := h.loginUser(ctx, email, password, h.clientIP(r), r.Header.Get("User-Agent"))
	if err != nil {
		fail(w, "Erreur connexion:", err)
		return
	}
	if !res.success {
		switch {
		case res.emailNotVerified:
			platform.JSON(w, 403, platform.O("emailNotVerified", true))
		case res.banned:
			platform.JSON(w, 403, platform.O("error", res.err, "banned", true))
		default:
			platform.Error(w, 401, res.err)
		}
		return
	}
	if res.twoFactorRequired {
		platform.JSON(w, 200, platform.O("twoFactorRequired", true, "twoFactorToken", res.twoFactorToken))
		return
	}
	body := platform.O("user", res.user, "tokens", res.tokens)
	spreadKeys(body, res)
	platform.JSON(w, 200, body)
}

func (h *handlers) apiLoginWith2FA(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("twoFactorToken").IsString(),
		platform.BodyField("code").IsString().IsLength(6, 8),
	) {
		return
	}
	token, code := field(r, "twoFactorToken"), field(r, "code")
	if !platform.Truthy(token) || !platform.Truthy(code) {
		platform.Error(w, 400, "Données manquantes")
		return
	}
	res, err := h.loginWith2FA(r.Context(), platform.JSString(token), platform.JSString(code), h.clientIP(r), r.Header.Get("User-Agent"))
	if err != nil {
		fail(w, "Erreur connexion 2FA:", err)
		return
	}
	if !res.success {
		platform.Error(w, 401, res.err)
		return
	}
	body := platform.O("user", res.user, "tokens", res.tokens)
	spreadKeys(body, res)
	platform.JSON(w, 200, body)
}

func (h *handlers) apiRefresh(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("refreshToken").IsString()) {
		return
	}
	token := field(r, "refreshToken")
	if !platform.Truthy(token) {
		platform.Error(w, 400, "Refresh token requis")
		return
	}
	res := h.refreshTokens(r.Context(), platform.JSString(token))
	if !res.success && res.internal {
		platform.Error(w, 503, res.err)
		return
	}
	if !res.success {
		platform.Error(w, 401, res.err)
		return
	}
	platform.JSON(w, 200, res.tokens)
}

func (h *handlers) apiLogout(w http.ResponseWriter, r *http.Request) {
	if token, ok := field(r, "refreshToken").(string); ok && uid(r) != "" {
		if err := h.logoutSession(r.Context(), token, uid(r)); err != nil {
			fail(w, "Erreur déconnexion:", err)
			return
		}
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiLogoutAll(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	if err := h.logoutAll(r.Context(), uid(r)); err != nil {
		fail(w, "Erreur déconnexion globale:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiVerify(w http.ResponseWriter, r *http.Request) {
	var userID any = platform.Undefined
	if uid(r) != "" {
		userID = uid(r)
	}
	platform.JSON(w, 200, platform.O("valid", true, "userId", userID))
}

func (h *handlers) apiMe(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	user, err := h.findByID(r.Context(), uid(r))
	if err != nil {
		fail(w, "Erreur récupération utilisateur courant:", err)
		return
	}
	if user == nil {
		platform.Error(w, 404, "Utilisateur non trouvé")
		return
	}
	platform.JSON(w, 200, user)
}

func (h *handlers) apiVerifyEmail(w http.ResponseWriter, r *http.Request) {
	token, ok := platform.Query(r).Get("token").(string)
	if !ok || token == "" {
		platform.Error(w, 400, "Token manquant")
		return
	}
	res, err := h.verifyEmail(r.Context(), token)
	if err != nil {
		fail(w, "Erreur vérification email:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "message", "Email vérifié avec succès."))
}

func (h *handlers) apiResendVerificationByEmail(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("email").IsEmail().NormalizeEmail()) {
		return
	}
	email, _ := str(field(r, "email"))
	if email == "" {
		platform.Error(w, 400, "Email requis")
		return
	}
	if _, err := h.resendVerificationByAddress(r.Context(), email); err != nil {
		fail(w, "Erreur renvoi vérification par email:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiResendVerification(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	res, err := h.resendVerificationEmail(r.Context(), uid(r))
	if err != nil {
		fail(w, "Erreur renvoi vérification:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "message", "Email de vérification envoyé."))
}

func (h *handlers) apiGetKeys(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	keys, err := h.getUserE2EEKeys(r.Context(), uid(r))
	if err != nil {
		fail(w, "Erreur récupération clés E2EE:", err)
		return
	}
	platform.JSON(w, 200, keys)
}

func (h *handlers) apiSaveKeys(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("publicKey").IsString(),
		platform.BodyField("encryptedPrivateKey").IsString(),
		platform.BodyField("keySalt").IsString().IsLength(0, 64),
	) {
		return
	}
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	pk, ek, ks := field(r, "publicKey"), field(r, "encryptedPrivateKey"), field(r, "keySalt")
	if !platform.Truthy(pk) || !platform.Truthy(ek) || !platform.Truthy(ks) {
		platform.Error(w, 400, "Données manquantes")
		return
	}
	res, err := h.saveUserKeys(r.Context(), uid(r), platform.JSString(pk), platform.JSString(ek), platform.JSString(ks), field(r, "password"))
	if err != nil {
		fail(w, "Erreur sauvegarde clés E2EE:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 403, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiSetup2FA(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	ctx := r.Context()
	user, err := h.findByID(ctx, uid(r))
	if err != nil {
		fail(w, "Erreur setup 2FA:", err)
		return
	}
	if user == nil {
		platform.Error(w, 404, "Utilisateur non trouvé")
		return
	}
	email := ""
	if e, ok := user.Get("email").(string); ok {
		email = e
	}
	secret, otpauth, qr, err := h.generate2FASecret(ctx, uid(r), email)
	if err != nil {
		fail(w, "Erreur setup 2FA:", err)
		return
	}
	platform.JSON(w, 200, platform.O("secret", secret, "qrCodeDataUrl", qr, "otpauthUrl", otpauth))
}

func (h *handlers) apiEnable2FA(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("code").IsString().IsLength(6, 6)) {
		return
	}
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	code := field(r, "code")
	if !platform.Truthy(code) {
		platform.Error(w, 400, "Code requis")
		return
	}
	res, backup, err := h.enable2FA(r.Context(), uid(r), platform.JSString(code))
	if err != nil {
		fail(w, "Erreur activation 2FA:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "backupCodes", stringList(backup)))
}

func stringList(list []string) []any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

func (h *handlers) apiDisable2FA(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("code").IsString().IsLength(6, 8)) {
		return
	}
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	code := field(r, "code")
	if !platform.Truthy(code) {
		platform.Error(w, 400, "Code requis")
		return
	}
	res, err := h.disable2FA(r.Context(), uid(r), platform.JSString(code))
	if err != nil {
		fail(w, "Erreur désactivation 2FA:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiGet2FAStatus(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	enabled, err := h.is2FAEnabled(r.Context(), uid(r))
	if err != nil {
		fail(w, "Erreur statut 2FA:", err)
		return
	}
	platform.JSON(w, 200, platform.O("enabled", enabled))
}

func (h *handlers) apiForgotPassword(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("email").IsEmail().NormalizeEmail()) {
		return
	}
	email, _ := str(field(r, "email"))
	if email == "" {
		platform.Error(w, 400, "Email requis")
		return
	}
	h.requestPasswordReset(r.Context(), email)
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiResetPassword(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("token").IsString().IsLength(1, -1),
		platform.BodyField("password").IsString().IsLength(8, 128),
	) {
		return
	}
	token, password := field(r, "token"), field(r, "password")
	if !platform.Truthy(token) || !platform.Truthy(password) {
		platform.Error(w, 400, "Token et mot de passe requis")
		return
	}
	if platform.JSLength(platform.JSString(password)) < 8 {
		platform.Error(w, 400, "Le mot de passe doit comporter au moins 8 caractères")
		return
	}
	res, err := h.resetPassword(r.Context(), platform.JSString(token), platform.JSString(password))
	if err != nil {
		fail(w, "Erreur reset mot de passe:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiSessions(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	sessions, err := h.getSessions(r.Context(), uid(r))
	if err != nil {
		fail(w, "Erreur récupération sessions:", err)
		return
	}
	platform.JSON(w, 200, platform.O("sessions", sessions))
}

func (h *handlers) apiRevokeSession(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return
	}
	res, err := h.revokeSession(r.Context(), uid(r), r.PathValue("id"))
	if err != nil {
		fail(w, "Erreur révocation session:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 404, res.err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Connexion par QR code ─────────────────────────────────────────────────

const (
	remoteTTL       = 120
	maxKeyPayload   = 8192
	maxEphemeralKey = 2048
)

var deviceCodeRe = regexp.MustCompile(`^[a-f0-9]{32}$`)

func redisRemoteKey(code string) string { return "remote-auth:" + code }

func (h *handlers) remoteRead(ctx context.Context, code string) (*platform.Object, error) {
	if !deviceCodeRe.MatchString(code) {
		return nil, nil
	}
	raw, err := h.rget(ctx, redisRemoteKey(code))
	if err != nil || raw == "" {
		return nil, err
	}
	parsed, perr := platform.ParseJSON([]byte(raw))
	if o, ok := parsed.(*platform.Object); ok && perr == nil {
		return o, nil
	}
	return nil, nil
}

func (h *handlers) remoteWrite(ctx context.Context, code string, entry *platform.Object) error {
	return h.rset(ctx, redisRemoteKey(code), platform.JSONString(entry), remoteTTL)
}

func (h *handlers) apiRemoteInit(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("ephemeralPublicKey").IsString().IsLength(1, 2048)) {
		return
	}
	eph, _ := str(field(r, "ephemeralPublicKey"))
	if eph == "" {
		platform.Error(w, 400, "Clé éphémère requise")
		return
	}
	cannot := func(err error) {
		slogErr("Erreur remote-auth init:", err)
		platform.Error(w, 400, "Impossible de générer le code")
	}
	if platform.JSLength(eph) > maxEphemeralKey {
		cannot(errPlain("Clé éphémère invalide"))
		return
	}
	ctx := r.Context()
	deviceCode, pollSecret := randomHex(16), randomHex(32)
	var ua any
	if u := r.Header.Get("User-Agent"); u != "" {
		ua = u
	}
	entry := platform.O("status", "pending", "secretHash", sha256Hex(pollSecret), "ephemeralPublicKey", eph,
		"origin", platform.O("ip", h.clientIP(r), "userAgent", ua, "requestedAt", isoNow()))
	if err := h.remoteWrite(ctx, deviceCode, entry); err != nil {
		cannot(err)
		return
	}
	qrPayload := "alfychat://remote-auth?code=" + deviceCode
	png, err := qrcode.Encode(qrPayload, qrcode.Medium, 320)
	if err != nil {
		cannot(err)
		return
	}
	platform.JSON(w, 200, platform.O("deviceCode", deviceCode, "pollSecret", pollSecret, "qrPayload", qrPayload,
		"qrCodeDataUrl", "data:image/png;base64,"+base64.StdEncoding.EncodeToString(png), "expiresIn", remoteTTL))
}

func (h *handlers) apiRemoteClaim(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("deviceCode").IsString().IsLength(32, 32)) {
		return
	}
	code, _ := str(field(r, "deviceCode"))
	if code == "" {
		platform.Error(w, 400, "Code requis")
		return
	}
	if uid(r) == "" {
		platform.Error(w, 401, "Authentification requise")
		return
	}
	ctx := r.Context()
	entry, err := h.remoteRead(ctx, code)
	if err != nil {
		fail(w, "Erreur remote-auth claim:", err)
		return
	}
	if entry == nil {
		platform.Error(w, 410, "Code inconnu ou expiré")
		return
	}
	if entry.Get("status") != "pending" {
		platform.Error(w, 410, "Ce code a déjà été utilisé")
		return
	}
	entry.Set("status", "scanned").Set("userId", uid(r))
	if err := h.remoteWrite(ctx, code, entry); err != nil {
		fail(w, "Erreur remote-auth claim:", err)
		return
	}
	platform.JSON(w, 200, platform.O("origin", entry.Get("origin"), "ephemeralPublicKey", entry.Get("ephemeralPublicKey")))
}

func (h *handlers) apiRemoteApprove(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("deviceCode").IsString().IsLength(32, 32),
		platform.BodyField("encryptedKeyPayload").Optional().IsString().IsLength(0, 8192),
	) {
		return
	}
	code, _ := str(field(r, "deviceCode"))
	payload, _ := str(field(r, "encryptedKeyPayload"))
	if code == "" {
		platform.Error(w, 400, "Code requis")
		return
	}
	if uid(r) == "" {
		platform.Error(w, 401, "Authentification requise")
		return
	}
	ctx := r.Context()
	entry, err := h.remoteRead(ctx, code)
	if err != nil {
		fail(w, "Erreur remote-auth approve:", err)
		return
	}
	switch {
	case entry == nil:
		platform.Error(w, 410, "Code inconnu ou expiré")
		return
	case entry.Get("status") != "scanned":
		platform.Error(w, 410, "Ce code doit d’abord être scanné")
		return
	case entry.Get("userId") != uid(r):
		platform.Error(w, 410, "Ce code appartient à une autre session")
		return
	case payload != "" && platform.JSLength(payload) > maxKeyPayload:
		platform.Error(w, 410, "Charge de clé trop volumineuse")
		return
	}
	user, err := h.findByID(ctx, uid(r))
	if err != nil {
		fail(w, "Erreur remote-auth approve:", err)
		return
	}
	if user == nil {
		platform.Error(w, 410, "Utilisateur introuvable")
		return
	}
	origin, _ := entry.Get("origin").(*platform.Object)
	var ip, ua any
	if origin != nil {
		ip, ua = origin.Get("ip"), origin.Get("userAgent")
	}
	tokens, err := h.generateTokens(ctx, uid(r), ip, ua)
	if err != nil {
		fail(w, "Erreur remote-auth approve:", err)
		return
	}
	entry.Set("status", "approved").Set("tokens", tokens).Set("user", user)
	if payload != "" {
		entry.Set("encryptedKeyPayload", payload)
	}
	if err := h.remoteWrite(ctx, code, entry); err != nil {
		fail(w, "Erreur remote-auth approve:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiRemoteDeny(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("deviceCode").IsString().IsLength(32, 32)) {
		return
	}
	code, _ := str(field(r, "deviceCode"))
	if code == "" {
		platform.Error(w, 400, "Code requis")
		return
	}
	if uid(r) == "" {
		platform.Error(w, 401, "Authentification requise")
		return
	}
	ctx := r.Context()
	entry, err := h.remoteRead(ctx, code)
	if err != nil {
		fail(w, "Erreur remote-auth deny:", err)
		return
	}
	switch {
	case entry == nil:
		platform.Error(w, 410, "Code inconnu ou expiré")
		return
	case entry.Get("status") == "approved":
		platform.Error(w, 410, "Ce code a déjà été approuvé")
		return
	case platform.Truthy(entry.Get("userId")) && entry.Get("userId") != uid(r):
		platform.Error(w, 410, "Ce code appartient à une autre session")
		return
	}
	entry.Set("status", "denied").Set("userId", uid(r))
	if err := h.remoteWrite(ctx, code, entry); err != nil {
		fail(w, "Erreur remote-auth deny:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiRemotePoll(w http.ResponseWriter, r *http.Request) {
	q := platform.Query(r)
	code, secret := queryString(q.Get("code")), queryString(q.Get("secret"))
	if code == "" || secret == "" {
		platform.Error(w, 400, "Paramètres manquants")
		return
	}
	ctx := r.Context()
	expired := platform.O("status", "expired")
	entry, err := h.remoteRead(ctx, code)
	if err != nil {
		fail(w, "Erreur remote-auth poll:", err)
		return
	}
	if entry == nil {
		platform.JSON(w, 200, expired)
		return
	}
	if !safeEqualHex(sha256Hex(secret), platform.JSString(entry.Get("secretHash"))) {
		platform.JSON(w, 200, expired)
		return
	}
	if entry.Get("status") != "approved" {
		platform.JSON(w, 200, platform.O("status", entry.Get("status")))
		return
	}
	if !platform.Truthy(entry.Get("tokens")) || !platform.Truthy(entry.Get("user")) {
		platform.JSON(w, 200, expired)
		return
	}
	if err := h.rdel(ctx, redisRemoteKey(code)); err != nil {
		fail(w, "Erreur remote-auth poll:", err)
		return
	}
	body := platform.O("status", "approved", "tokens", entry.Get("tokens"), "user", entry.Get("user"))
	if p := entry.Get("encryptedKeyPayload"); platform.Truthy(p) {
		body.Set("encryptedKeyPayload", p)
	}
	platform.JSON(w, 200, body)
}

// queryString : String(req.query.x ?? ”) — un tableau devient sa jointure par virgule.
func queryString(v any) string {
	if v == nil || v == platform.Undefined {
		return ""
	}
	return platform.JSString(v)
}
