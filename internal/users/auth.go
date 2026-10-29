// ==========================================
// ALFYCHAT - SERVICE AUTHENTIFICATION
// ==========================================

package users

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/alfychat/users/internal/platform"
	"github.com/golang-jwt/jwt/v5"
)

const (
	accessTokenTTL         = 15 * time.Minute
	refreshTokenTTL        = 365 * 24 * time.Hour
	accessTokenExpirySecs  = 15 * 60
	revokedMarkerRefresh   = 30 * 24 * 60 * 60
	revokedMarkerSessions  = 365 * 24 * 60 * 60
	banCheckFailureMessage = "Vérification du compte impossible pour le moment. Réessayez dans quelques instants."
)

// hashRefreshToken : seule l'empreinte SHA-256 du refresh token est stockée.
func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// disconnectUserSockets coupe les connexions temps réel d'un utilisateur.
func disconnectUserSockets(userID, secret string) {
	if secret == "" {
		return
	}
	body, _ := platform.O("userId", userID).MarshalJSON()
	req, err := http.NewRequest(http.MethodPost, platform.Env("GATEWAY_URL", "http://localhost:3000")+"/internal/users/disconnect", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", secret)
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		slog.Warn("Gateway injoignable pour couper les sockets de " + userID)
		return
	}
	res.Body.Close()
}

// authResult regroupe les issues possibles d'une authentification.
type authResult struct {
	success           bool
	err               string
	user              *platform.Object
	tokens            *platform.Object
	twoFactorRequired bool
	twoFactorToken    string
	keySalt           string
	encryptedPrivate  string
	emailNotVerified  bool
	keyMissing        bool
	banned            bool
}

// checkBan renvoie le message de bannissement, ou "" ; ok=false si la vérification est impossible.
func (h *handlers) checkBan(ctx context.Context, userID string) string {
	rows, err := h.db.Rows(ctx, `SELECT reason, expires_at FROM moderation_sanctions
         WHERE user_id = ? AND type = 'ban' AND revoked = FALSE
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY expires_at IS NULL DESC, expires_at DESC
         LIMIT 1`, userID)
	if err != nil {
		slog.Error("checkBan: vérification impossible, connexion refusée", "err", err)
		return banCheckFailureMessage
	}
	if len(rows) == 0 {
		return ""
	}
	reason := rows[0].Str("reason")
	exp := rows[0].Get("expires_at")
	if !platform.Truthy(exp) {
		return "Ce compte est banni définitivement. Motif : " + reason
	}
	until := "Invalid Date"
	if s, ok := exp.(string); ok {
		if t, ok := parseDate(s); ok {
			until = t.Local().Format("02/01/2006 15:04:05")
		}
	}
	return "Ce compte est suspendu jusqu'au " + until + ". Motif : " + reason
}

// generateTokens émet une session (access + refresh) et l'enregistre.
func (h *handlers) generateTokens(ctx context.Context, userID string, ip, userAgent any) (*platform.Object, error) {
	role := "user"
	if row, err := h.db.First(ctx, "SELECT role FROM users WHERE id = ?", userID); err == nil && row != nil {
		if r := row.Get("role"); platform.Truthy(r) {
			role = row.Str("role")
		}
	}
	sessionID := newID()
	access, err := h.signToken(h.jwtSecret, jwt.MapClaims{"userId": userID, "type": "access", "role": role, "sid": sessionID}, accessTokenTTL)
	if err != nil {
		return nil, err
	}
	refresh, err := h.signToken(h.jwtRefreshSecret, jwt.MapClaims{"userId": userID, "type": "refresh", "sid": sessionID, "jti": newID()}, refreshTokenTTL)
	if err != nil {
		return nil, err
	}
	var ua any
	if s, ok := userAgent.(string); ok && s != "" {
		if sl := jsSlice(s, 512); sl != "" {
			ua = sl
		}
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO sessions (id, user_id, refresh_token, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
		sessionID, userID, hashRefreshToken(refresh), time.Now().Add(refreshTokenTTL), ip, ua); err != nil {
		return nil, err
	}
	return platform.O("accessToken", access, "refreshToken", refresh, "expiresIn", accessTokenExpirySecs, "sessionId", sessionID), nil
}

func (h *handlers) createDefaultConsents(ctx context.Context, userID string) error {
	for _, t := range []string{"necessary", "analytics", "marketing"} {
		if _, err := h.db.Exec(ctx, "INSERT INTO rgpd_consents (id, user_id, consent_type, granted, granted_at) VALUES (?, ?, ?, ?, NOW())",
			newID(), userID, t, t == "necessary"); err != nil {
			return err
		}
	}
	return nil
}

func (h *handlers) sendEmailVerification(ctx context.Context, userID, email, username string) (bool, error) {
	token := randomHex(48)
	expiresAt := time.Now().Add(24 * time.Hour)
	if _, err := h.db.Exec(ctx, "DELETE FROM email_verification_tokens WHERE user_id = ? AND used = FALSE", userID); err != nil {
		return false, err
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO email_verification_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
		newID(), userID, token, expiresAt); err != nil {
		return false, err
	}
	return h.mail.sendVerificationEmail(email, username, token), nil
}

// register crée le compte (aucune session : l'email doit être vérifié).
func (h *handlers) registerUser(ctx context.Context, email, username, password, displayName string, publicKey, encPriv, keySalt any) (authResult, error) {
	if c := checkUsername(username, false); !c.ok {
		return authResult{err: c.reason}, nil
	}
	if displayName != "" && displayName != username {
		if c := checkUsername(displayName, false); !c.ok {
			return authResult{err: c.reason}, nil
		}
	}
	existing, err := h.findByEmail(ctx, email)
	if err != nil {
		return authResult{}, err
	}
	if existing != nil {
		return authResult{err: "Cet email est déjà utilisé"}, nil
	}
	byName, err := h.findByUsername(ctx, username)
	if err != nil {
		return authResult{}, err
	}
	if byName != nil {
		return authResult{err: "Ce nom d'utilisateur est déjà pris"}, nil
	}
	hash, err := hashPassword(password)
	if err != nil {
		return authResult{}, err
	}
	userID := newID()
	user, err := h.createUser(ctx, userID, email, username, displayName, hash)
	if err != nil {
		return authResult{}, err
	}
	if platform.Truthy(publicKey) && platform.Truthy(encPriv) && platform.Truthy(keySalt) {
		if _, err := h.db.Exec(ctx, "UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?",
			platform.SQLParam(publicKey), platform.SQLParam(encPriv), platform.SQLParam(keySalt), userID); err != nil {
			return authResult{}, err
		}
	}
	if err := h.createDefaultConsents(ctx, userID); err != nil {
		return authResult{}, err
	}
	name := username
	if name == "" {
		name = displayName
	}
	go func() { _, _ = h.sendEmailVerification(context.Background(), userID, email, name) }()
	return authResult{success: true, user: user, emailNotVerified: true}, nil
}

func loginUserObject(row *platform.Object) *platform.Object {
	return platform.O("id", row.Get("id"), "email", col(row, "email"), "username", row.Get("username"),
		"displayName", row.Get("display_name"), "avatarUrl", row.Get("avatar_url"),
		"status", platform.Or(row.Get("status"), "offline"), "isOnline", true)
}

func (h *handlers) applyKeyFields(res *authResult, row *platform.Object) {
	if platform.Truthy(row.Get("key_salt")) {
		res.keySalt = row.Str("key_salt")
	}
	if platform.Truthy(row.Get("encrypted_private_key")) {
		res.encryptedPrivate = row.Str("encrypted_private_key")
	}
	res.keyMissing = !platform.Truthy(row.Get("public_key"))
}

func (h *handlers) loginUser(ctx context.Context, email, password, ip, userAgent string) (authResult, error) {
	row, err := h.db.First(ctx, "SELECT id, email, username, display_name, avatar_url, status, password_hash, totp_enabled, email_verified, key_salt, encrypted_private_key, public_key FROM users WHERE email = ?", email)
	if err != nil {
		return authResult{}, err
	}
	if row == nil {
		burnPasswordComparison(password)
		return authResult{err: "Email ou mot de passe incorrect"}, nil
	}
	if !verifyPassword(password, row.Str("password_hash")) {
		return authResult{err: "Email ou mot de passe incorrect"}, nil
	}
	if msg := h.checkBan(ctx, row.Str("id")); msg != "" {
		return authResult{err: msg, banned: true}, nil
	}
	if row.Int("email_verified") != 1 {
		return authResult{emailNotVerified: true}, nil
	}
	if row.Int("totp_enabled") == 1 {
		token, err := h.createPendingSession(ctx, row.Str("id"))
		if err != nil {
			return authResult{}, err
		}
		return authResult{success: true, twoFactorRequired: true, twoFactorToken: token}, nil
	}
	tokens, err := h.generateTokens(ctx, row.Str("id"), ip, userAgent)
	if err != nil {
		return authResult{}, err
	}
	res := authResult{success: true, user: loginUserObject(row), tokens: tokens}
	h.applyKeyFields(&res, row)
	return res, nil
}

func (h *handlers) loginWith2FA(ctx context.Context, twoFactorToken, code, ip, userAgent string) (authResult, error) {
	userID, err := h.resolvePendingSession(ctx, twoFactorToken)
	if err != nil {
		return authResult{}, err
	}
	if userID == "" {
		return authResult{err: "Session expirée. Veuillez vous reconnecter."}, nil
	}
	ok, err := h.verify2FA(ctx, userID, code)
	if err != nil {
		return authResult{}, err
	}
	if !ok {
		return authResult{err: "Code 2FA invalide."}, nil
	}
	row, err := h.db.First(ctx, "SELECT id, email, username, display_name, avatar_url, status, key_salt, encrypted_private_key, public_key FROM users WHERE id = ?", userID)
	if err != nil {
		return authResult{}, err
	}
	if row == nil {
		return authResult{err: "Utilisateur introuvable."}, nil
	}
	if msg := h.checkBan(ctx, row.Str("id")); msg != "" {
		return authResult{err: msg, banned: true}, nil
	}
	tokens, err := h.generateTokens(ctx, row.Str("id"), ip, userAgent)
	if err != nil {
		return authResult{}, err
	}
	res := authResult{success: true, user: loginUserObject(row), tokens: tokens}
	h.applyKeyFields(&res, row)
	return res, nil
}

func (h *handlers) refreshTokens(ctx context.Context, refreshToken string) authResult {
	claims, err := h.verifyJWT(refreshToken, h.jwtRefreshSecret)
	if err != nil || claims["type"] != "refresh" {
		if err == nil {
			return authResult{err: "Token invalide"}
		}
		return authResult{err: "Token invalide ou expiré"}
	}
	fail := authResult{err: "Token invalide ou expiré"}
	userID, _ := claims["userId"].(string)
	tokenHash := hashRefreshToken(refreshToken)

	revoked, err := h.rget(ctx, "revoked:"+tokenHash)
	if err != nil {
		return fail
	}
	if revoked != "" {
		slog.Warn("Réutilisation d'un refresh token révoqué pour " + userID + " — toutes les sessions sont révoquées")
		if err := h.logoutAll(ctx, userID); err != nil {
			return fail
		}
		return authResult{err: "Token révoqué"}
	}
	rows, err := h.db.Rows(ctx, "SELECT * FROM sessions WHERE refresh_token = ? AND expires_at > NOW()", tokenHash)
	if err != nil {
		return fail
	}
	if len(rows) == 0 {
		return authResult{err: "Session expirée"}
	}
	old := rows[0]
	if msg := h.checkBan(ctx, userID); msg != "" {
		return authResult{err: msg, banned: true}
	}
	if err := h.rset(ctx, "revoked:"+tokenHash, "1", revokedMarkerRefresh); err != nil {
		return fail
	}
	if _, err := h.db.Exec(ctx, "DELETE FROM sessions WHERE refresh_token = ?", tokenHash); err != nil {
		return fail
	}
	tokens, err := h.generateTokens(ctx, userID, old.Get("ip_address"), old.Get("user_agent"))
	if err != nil {
		return fail
	}
	return authResult{success: true, tokens: tokens}
}

func (h *handlers) logoutSession(ctx context.Context, refreshToken, userID string) error {
	tokenHash := hashRefreshToken(refreshToken)
	rows, err := h.db.Rows(ctx, "SELECT id FROM sessions WHERE refresh_token = ? AND user_id = ?", tokenHash, userID)
	if err != nil || len(rows) == 0 {
		return err
	}
	if err := h.rset(ctx, "revoked:"+tokenHash, "1", revokedMarkerSessions); err != nil {
		return err
	}
	_, err = h.db.Exec(ctx, "DELETE FROM sessions WHERE refresh_token = ? AND user_id = ?", tokenHash, userID)
	return err
}

// revokeSessions révoque toutes les sessions, sauf éventuellement keepSessionID.
func (h *handlers) revokeSessions(ctx context.Context, userID, keepSessionID string) error {
	var rows []platform.Row
	var err error
	if keepSessionID != "" {
		rows, err = h.db.Rows(ctx, "SELECT refresh_token FROM sessions WHERE user_id = ? AND id <> ?", userID, keepSessionID)
	} else {
		rows, err = h.db.Rows(ctx, "SELECT refresh_token FROM sessions WHERE user_id = ?", userID)
	}
	if err != nil {
		return err
	}
	for _, r := range rows {
		if err := h.rset(ctx, "revoked:"+r.Str("refresh_token"), "1", revokedMarkerSessions); err != nil {
			return err
		}
	}
	if keepSessionID != "" {
		_, err = h.db.Exec(ctx, "DELETE FROM sessions WHERE user_id = ? AND id <> ?", userID, keepSessionID)
	} else {
		_, err = h.db.Exec(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	}
	if err != nil {
		return err
	}
	disconnectUserSockets(userID, h.auth.InternalSecret())
	return nil
}

func (h *handlers) logoutAll(ctx context.Context, userID string) error {
	if err := h.revokeSessions(ctx, userID, ""); err != nil {
		return err
	}
	return h.updateStatus(ctx, userID, "offline", platform.Undefined, platform.Undefined)
}

func (h *handlers) verifyEmail(ctx context.Context, token string) (result, error) {
	rows, err := h.db.Rows(ctx, `SELECT evt.*, u.username FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = ? AND evt.used = FALSE AND evt.expires_at > NOW()`, token)
	if err != nil {
		return result{}, err
	}
	if len(rows) == 0 {
		return result{err: "Lien de vérification invalide ou expiré."}, nil
	}
	rec := rows[0]
	if _, err := h.db.Exec(ctx, "UPDATE email_verification_tokens SET used = TRUE WHERE id = ?", rec.Get("id")); err != nil {
		return result{}, err
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET email_verified = TRUE WHERE id = ?", rec.Get("user_id")); err != nil {
		return result{}, err
	}
	return result{ok: true}, nil
}

func (h *handlers) resendVerificationEmail(ctx context.Context, userID string) (result, error) {
	row, err := h.db.First(ctx, "SELECT id, email, username, email_verified FROM users WHERE id = ?", userID)
	if err != nil {
		return result{}, err
	}
	if row == nil {
		return result{err: "Utilisateur introuvable."}, nil
	}
	if row.Bool("email_verified") {
		return result{err: "Email déjà vérifié."}, nil
	}
	sent, err := h.sendEmailVerification(ctx, userID, row.Str("email"), row.Str("username"))
	if err != nil {
		return result{}, err
	}
	if sent {
		return result{ok: true}, nil
	}
	return result{err: "Impossible d'envoyer l'email."}, nil
}

func (h *handlers) resendVerificationByAddress(ctx context.Context, email string) (result, error) {
	row, err := h.db.First(ctx, "SELECT id, email, username, email_verified FROM users WHERE email = ?", email)
	if err != nil {
		return result{}, err
	}
	if row == nil || row.Int("email_verified") == 1 {
		return result{ok: true}, nil
	}
	sent, err := h.sendEmailVerification(ctx, row.Str("id"), row.Str("email"), row.Str("username"))
	if err != nil {
		return result{}, err
	}
	if sent {
		return result{ok: true}, nil
	}
	return result{err: "Impossible d'envoyer l'email."}, nil
}

func (h *handlers) getUserE2EEKeys(ctx context.Context, userID string) (*platform.Object, error) {
	row, err := h.db.First(ctx, "SELECT key_salt, encrypted_private_key, public_key FROM users WHERE id = ?", userID)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return platform.O("keySalt", nil, "encryptedPrivateKey", nil, "publicKey", nil), nil
	}
	return platform.O("keySalt", orNil(row.Get("key_salt")), "encryptedPrivateKey", orNil(row.Get("encrypted_private_key")),
		"publicKey", orNil(row.Get("public_key"))), nil
}

func (h *handlers) saveUserKeys(ctx context.Context, userID, publicKey, encPriv, keySalt string, password any) (result, error) {
	row, err := h.db.First(ctx, "SELECT public_key, password_hash FROM users WHERE id = ?", userID)
	if err != nil {
		return result{}, err
	}
	if row == nil {
		return result{err: "Utilisateur introuvable"}, nil
	}
	if platform.Truthy(row.Get("public_key")) {
		pw, isStr := password.(string)
		if !isStr || pw == "" || !verifyPassword(pw, row.Str("password_hash")) {
			return result{err: "Mot de passe requis pour remplacer vos clés de chiffrement"}, nil
		}
	}
	_, err = h.db.Exec(ctx, "UPDATE users SET public_key = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?", publicKey, encPriv, keySalt, userID)
	return result{ok: err == nil}, err
}

func (h *handlers) requestPasswordReset(ctx context.Context, email string) {
	defer func() { _ = recover() }()
	row, err := h.db.First(ctx, "SELECT id, username FROM users WHERE email = ?", email)
	if err != nil || row == nil {
		return
	}
	id := row.Str("id")
	prev, err := h.rget(ctx, "pwreset:user:"+id)
	if err != nil {
		return
	}
	if prev != "" {
		if err := h.rdel(ctx, "pwreset:"+prev); err != nil {
			return
		}
	}
	token := randomHex(48)
	if h.rset(ctx, "pwreset:"+token, id, 3600) != nil || h.rset(ctx, "pwreset:user:"+id, token, 3600) != nil {
		return
	}
	h.mail.sendPasswordResetEmail(email, row.Str("username"), token)
}

func (h *handlers) resetPassword(ctx context.Context, token, newPassword string) (result, error) {
	userID, err := h.rget(ctx, "pwreset:"+token)
	if err != nil {
		return result{}, err
	}
	if userID == "" {
		return result{err: "Lien invalide ou expiré."}, nil
	}
	hash, err := hashPassword(newPassword)
	if err != nil {
		return result{}, err
	}
	if _, err := h.db.Exec(ctx, `UPDATE users SET
         password_hash = ?,
         encrypted_private_key = NULL,
         key_salt = NULL,
         public_key = NULL
       WHERE id = ?`, hash, userID); err != nil {
		return result{}, err
	}
	if err := h.rdel(ctx, "pwreset:"+token); err != nil {
		return result{}, err
	}
	if err := h.rdel(ctx, "pwreset:user:"+userID); err != nil {
		return result{}, err
	}
	if err := h.logoutAll(ctx, userID); err != nil {
		return result{}, err
	}
	return result{ok: true}, nil
}

func (h *handlers) getSessions(ctx context.Context, userID string) ([]any, error) {
	rows, err := h.db.Rows(ctx, "SELECT id, user_agent, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > NOW() ORDER BY created_at DESC", userID)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = platform.O("id", r.Get("id"), "userAgent", nilIfUndef(r.Get("user_agent")), "ipAddress", nilIfUndef(r.Get("ip_address")),
			"createdAt", r.Get("created_at"), "expiresAt", r.Get("expires_at"))
	}
	return out, nil
}

func nilIfUndef(v any) any {
	if v == platform.Undefined {
		return nil
	}
	return v
}

func (h *handlers) revokeSession(ctx context.Context, userID, sessionID string) (result, error) {
	rows, err := h.db.Rows(ctx, "SELECT refresh_token FROM sessions WHERE id = ? AND user_id = ?", sessionID, userID)
	if err != nil {
		return result{}, err
	}
	if len(rows) == 0 {
		return result{err: "Session introuvable"}, nil
	}
	if err := h.rset(ctx, "revoked:"+rows[0].Str("refresh_token"), "1", revokedMarkerSessions); err != nil {
		return result{}, err
	}
	_, err = h.db.Exec(ctx, "DELETE FROM sessions WHERE id = ? AND user_id = ?", sessionID, userID)
	return result{ok: err == nil}, err
}

var errUnused = errors.New("unused")
