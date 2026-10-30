// ==========================================
// ALFYCHAT - SOCLE DU SERVICE UTILISATEURS
// ==========================================

package users

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/alfychat/users/internal/platform"
	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type handlers struct {
	srv  *platform.Server
	db   *platform.DB
	rdb  *redis.Client
	auth *platform.Auth

	jwtSecret        []byte
	jwtRefreshSecret []byte
	mail             emailService
}

func newID() string { return uuid.NewString() }

func serverError(w http.ResponseWriter) { platform.Error(w, 500, "Erreur serveur") }

// fail journalise l'erreur et répond 500 « Erreur serveur ».
func fail(w http.ResponseWriter, logMsg string, err error) {
	slog.Error(logMsg, "err", err)
	serverError(w)
}

func isDupEntry(err error) bool {
	var me *mysql.MySQLError
	return errors.As(err, &me) && me.Number == 1062
}

// ── Contexte de la requête (authentification) ─────────────────────────────

type ctxKey int

const (
	ctxIsInternal ctxKey = iota
	ctxSessionID
	ctxRole
	ctxHasUser
)

func withValue(r *http.Request, k ctxKey, v any) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), k, v))
}

// uid : req.userId (vide si absent).
func uid(r *http.Request) string { return platform.UserID(r) }

func isInternal(r *http.Request) bool {
	v, _ := r.Context().Value(ctxIsInternal).(bool)
	return v
}

func sessionID(r *http.Request) string {
	v, _ := r.Context().Value(ctxSessionID).(string)
	return v
}

func userRole(r *http.Request) string {
	v, _ := r.Context().Value(ctxRole).(string)
	return v
}

// field lit un champ du corps JSON (Undefined s'il est absent).
func field(r *http.Request, key string) any { return platform.GetPath(platform.Body(r), key) }

func undef(v any) bool { return v == platform.Undefined }

// str renvoie la valeur si c'est une chaîne.
func str(v any) (string, bool) { s, ok := v.(string); return s, ok }

// ── Redis (même contrat que le client ioredis d'origine) ──────────────────

func (h *handlers) rget(ctx context.Context, key string) (string, error) {
	v, err := h.rdb.Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return v, err
}

func (h *handlers) rset(ctx context.Context, key, value string, ttlSeconds int) error {
	return h.rdb.Set(ctx, key, value, time.Duration(ttlSeconds)*time.Second).Err()
}

func (h *handlers) rdel(ctx context.Context, key string) error { return h.rdb.Del(ctx, key).Err() }

// ── IP réelle du client ───────────────────────────────────────────────────

func normalizeIP(ip string) string {
	if ip == "" {
		return "inconnu"
	}
	if strings.HasPrefix(ip, "::ffff:") {
		return ip[7:]
	}
	if ip == "::1" {
		return "127.0.0.1"
	}
	return ip
}

// clientIP : IP signée par le gateway (x-client-ip + HMAC), sinon req.ip
// (trust proxy 1 : dernier élément de X-Forwarded-For, sinon l'adresse du socket).
func (h *handlers) clientIP(r *http.Request) string {
	ip, sig := r.Header.Get("X-Client-Ip"), r.Header.Get("X-Client-Ip-Sig")
	if ip != "" && sig != "" && len(ip) <= 64 {
		mac := hmac.New(sha256.New, []byte(h.auth.InternalSecret()))
		mac.Write([]byte("client-ip:" + ip))
		if platform.SafeCompare(sig, hex.EncodeToString(mac.Sum(nil))) {
			return normalizeIP(ip)
		}
	}
	return normalizeIP(reqIP(r))
}

func reqIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[len(parts)-1])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ── Limiteur de débit (express-rate-limit, magasin mémoire) ───────────────

type rateLimiter struct {
	window time.Duration
	max    int
	msg    string
	skip   func(r *http.Request) bool
	key    func(r *http.Request) string

	mu   sync.Mutex
	hits map[string]*rateEntry
}

type rateEntry struct {
	count int
	reset time.Time
}

func newLimiter(window time.Duration, max int, msg string, key func(*http.Request) string, skip func(*http.Request) bool) *rateLimiter {
	l := &rateLimiter{window: window, max: max, msg: msg, key: key, skip: skip, hits: map[string]*rateEntry{}}
	go func() {
		for range time.Tick(window) {
			l.mu.Lock()
			now := time.Now()
			for k, e := range l.hits {
				if !e.reset.After(now) {
					delete(l.hits, k)
				}
			}
			l.mu.Unlock()
		}
	}()
	return l
}

// allow compte la requête et répond 429 au-delà du plafond ; faux si une réponse a été envoyée.
func (l *rateLimiter) allow(w http.ResponseWriter, r *http.Request) bool {
	if l.skip != nil && l.skip(r) {
		return true
	}
	k := l.key(r)
	now := time.Now()
	l.mu.Lock()
	e := l.hits[k]
	if e == nil || !e.reset.After(now) {
		e = &rateEntry{reset: now.Add(l.window)}
		l.hits[k] = e
	}
	e.count++
	count, reset := e.count, e.reset
	l.mu.Unlock()

	remaining := l.max - count
	if remaining < 0 {
		remaining = 0
	}
	secs := itoa(int(reset.Sub(now).Seconds() + 0.999))
	hd := w.Header()
	hd.Set("X-RateLimit-Limit", itoa(l.max))
	hd.Set("X-RateLimit-Remaining", itoa(remaining))
	hd.Set("X-RateLimit-Reset", secs)
	if count > l.max {
		hd.Set("Retry-After", secs)
		platform.Error(w, 429, l.msg)
		return false
	}
	return true
}

func (l *rateLimiter) wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if l.allow(w, r) {
			next(w, r)
		}
	}
}

// ── Jetons ────────────────────────────────────────────────────────────────

func (h *handlers) signToken(secret []byte, claims jwt.MapClaims, ttl time.Duration) (string, error) {
	now := time.Now()
	claims["iat"] = now.Unix()
	claims["exp"] = now.Add(ttl).Unix()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
}

func (h *handlers) verifyJWT(token string, secret []byte) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(*jwt.Token) (any, error) { return secret, nil },
		jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		return nil, err
	}
	return claims, nil
}

// ── Middlewares ───────────────────────────────────────────────────────────

func (h *handlers) isInternalRequest(r *http.Request) bool { return h.auth.IsInternal(r) }

// requireAuth : authMiddleware d'origine (blacklist Redis, jeton d'accès HS256).
func (h *handlers) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.isInternalRequest(r) {
			if x := r.Header.Get("X-User-Id"); x != "" {
				r = platform.WithUserID(r, x)
				r = withValue(r, ctxIsInternal, true)
				next(w, r)
				return
			}
		}
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			platform.Error(w, 401, "Token d'authentification requis")
			return
		}
		token := strings.Replace(header, "Bearer ", "", 1)
		blacklisted, err := h.rget(r.Context(), "blacklist:"+token)
		if err != nil {
			platform.Error(w, 401, "Token invalide")
			return
		}
		if blacklisted != "" {
			platform.Error(w, 401, "Token invalide")
			return
		}
		claims, err := h.verifyJWT(token, h.jwtSecret)
		if err != nil {
			if errors.Is(err, jwt.ErrTokenExpired) {
				platform.Error(w, 401, "Token expiré")
				return
			}
			platform.Error(w, 401, "Token invalide")
			return
		}
		if t, ok := claims["type"]; ok && platform.Truthy(t) && t != "access" {
			platform.Error(w, 401, "Token invalide")
			return
		}
		userID, _ := claims["userId"].(string)
		r = platform.WithUserID(r, userID)
		if sid, _ := claims["sid"].(string); sid != "" {
			r = withValue(r, ctxSessionID, sid)
		}
		next(w, r)
	}
}

// optionalAuth renseigne l'utilisateur si un jeton valide est présent, sans jamais refuser.
func (h *handlers) optionalAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if h.isInternalRequest(r) {
			r = withValue(r, ctxIsInternal, true)
			if x := r.Header.Get("X-User-Id"); x != "" {
				r = platform.WithUserID(r, x)
			}
			next(w, r)
			return
		}
		if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
			if claims, err := h.verifyJWT(header[7:], h.jwtSecret); err == nil {
				if t, ok := claims["type"]; !(ok && platform.Truthy(t) && t != "access") {
					userID, _ := claims["userId"].(string)
					r = platform.WithUserID(r, userID)
				}
			}
		}
		next(w, r)
	}
}

func (h *handlers) roleGate(roles []string, denyMsg, logTag string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			userID := uid(r)
			if userID == "" {
				platform.Error(w, 401, "Non authentifié")
				return
			}
			row, err := h.db.First(r.Context(), "SELECT id, username, role FROM users WHERE id = ?", userID)
			if err != nil {
				fail(w, "Erreur middleware "+logTag+":", err)
				return
			}
			if row == nil {
				platform.Error(w, 401, "Utilisateur non trouvé")
				return
			}
			role := row.Str("role")
			ok := false
			for _, a := range roles {
				if a == role {
					ok = true
				}
			}
			if !ok {
				slog.Warn("Tentative d'accès " + logTag + " non autorisée: " + row.Str("username") + " (" + row.Str("id") + ")")
				platform.Error(w, 403, denyMsg)
				return
			}
			next(w, withValue(r, ctxRole, role))
		}
	}
}

func (h *handlers) adminOnly(next http.HandlerFunc) http.HandlerFunc {
	return h.roleGate([]string{"admin"}, "Accès réservé aux administrateurs", "admin")(next)
}

func (h *handlers) staffOnly(next http.HandlerFunc) http.HandlerFunc {
	return h.roleGate([]string{"admin", "support_l1", "support_l2", "technician", "moderator"}, "Accès réservé au staff", "staff")(next)
}

type mw = func(http.HandlerFunc) http.HandlerFunc

// chain applique les middlewares de l'extérieur vers l'intérieur.
func chain(h http.HandlerFunc, mws ...mw) http.HandlerFunc {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// ── Validation (validateRequest) ──────────────────────────────────────────

// validated applique les chaînes et répond 400 « Données invalides » au premier échec.
func validated(w http.ResponseWriter, r *http.Request, chains ...*platform.Chain) bool {
	errs := platform.Validate(r, chains...)
	if len(errs) == 0 {
		return true
	}
	details := make([]any, len(errs))
	for i, e := range errs {
		field := e.Get("path")
		if field == nil {
			field = e.Get("param")
		}
		details[i] = platform.O("field", field, "message", e.Get("msg"))
	}
	platform.JSON(w, 400, platform.O("error", "Données invalides", "details", details))
	return false
}

func itoa(n int) string { return platform.JSNumber(float64(n)) }

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// safeEqualHex compare deux empreintes hexadécimales à temps constant.
func safeEqualHex(a, b string) bool {
	ba, err1 := hex.DecodeString(a)
	bb, err2 := hex.DecodeString(b)
	if err1 != nil || err2 != nil || len(ba) == 0 || len(ba) != len(bb) {
		return false
	}
	return hmac.Equal(ba, bb)
}
