// ==========================================
// ALFYCHAT - SSO VERS LE SITE (alfychat.com)
// L'app (connectée) demande un code à usage unique lié à l'origine du site ;
// le site l'échange contre SA propre session (jetons distincts de ceux de
// l'app). Le code vit 60 s dans Redis et ne sert qu'une fois.
// ==========================================

package users

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/alfychat/users/internal/platform"
)

const ssoCodeTTL = 60

// siteOrigins : origines autorisées à recevoir un code (SITE_URL, séparées par des virgules).
func siteOrigins() []string {
	var out []string
	for _, raw := range strings.Split(platform.Env("SITE_URL", "https://alfychat.com"), ",") {
		if u, err := url.Parse(strings.TrimSpace(raw)); err == nil && u.Scheme != "" && u.Host != "" {
			out = append(out, u.Scheme+"://"+u.Host)
		}
	}
	return out
}

// apiSsoCode : POST /auth/sso/code { returnUrl } → { redirect }.
func (h *handlers) apiSsoCode(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("returnUrl").IsString().IsLength(1, 2048)) {
		return
	}
	userID := uid(r)
	if userID == "" {
		platform.Error(w, 401, "Authentification requise")
		return
	}
	raw, _ := str(field(r, "returnUrl"))
	ret, err := url.Parse(raw)
	if err != nil || ret.Scheme == "" || ret.Host == "" {
		platform.Error(w, 400, "URL de retour invalide")
		return
	}
	origin := ret.Scheme + "://" + ret.Host
	allowed := false
	for _, o := range siteOrigins() {
		if strings.EqualFold(o, origin) {
			allowed = true
			break
		}
	}
	if !allowed {
		platform.Error(w, 403, "Origine non autorisée")
		return
	}

	code := randomHex(32)
	if err := h.rset(r.Context(), "sso:"+code, userID, ssoCodeTTL); err != nil {
		fail(w, "Erreur SSO code:", err)
		return
	}
	next := ret.EscapedPath()
	if next == "" {
		next = "/"
	}
	if ret.RawQuery != "" {
		next += "?" + ret.RawQuery
	}
	q := url.Values{"code": {code}, "next": {next}}
	platform.JSON(w, 200, platform.O("redirect", origin+"/sso/callback?"+q.Encode()))
}

// apiSsoExchange : POST /auth/sso/exchange { code } → { accessToken, refreshToken, expiresIn, sessionId, user }.
func (h *handlers) apiSsoExchange(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("code").IsString().IsLength(64, 64)) {
		return
	}
	code, _ := str(field(r, "code"))
	ctx := r.Context()
	// GETDEL : le code est consommé même si la suite échoue (usage unique strict).
	userID, err := h.rdb.GetDel(ctx, "sso:"+code).Result()
	if err != nil || userID == "" {
		platform.Error(w, 401, "Lien de connexion invalide ou expiré")
		return
	}
	if msg := h.checkBan(ctx, userID); msg != "" {
		platform.Error(w, 403, msg)
		return
	}
	user, err := h.findByID(ctx, userID)
	if err != nil {
		fail(w, "Erreur SSO exchange:", err)
		return
	}
	if user == nil {
		platform.Error(w, 401, "Utilisateur introuvable")
		return
	}
	tokens, err := h.generateTokens(ctx, userID, h.clientIP(r), r.Header.Get("User-Agent"))
	if err != nil {
		fail(w, "Erreur SSO exchange:", err)
		return
	}
	tokens.Set("user", user)
	platform.JSON(w, 200, tokens)
}
