// ==========================================
// ALFYCHAT - SERVICE 2FA (TOTP)
// ==========================================

package users

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
	qrcode "github.com/skip2/go-qrcode"
	"golang.org/x/crypto/bcrypt"
)

func totpKeyFrom(raw string) []byte {
	sum := sha256.Sum256([]byte("alfychat:totp-key:" + raw))
	return sum[:]
}

func primaryTotpKey() ([]byte, error) {
	raw := os.Getenv("TWOFA_ENCRYPTION_KEY")
	if raw == "" {
		raw = os.Getenv("JWT_SECRET")
	}
	if raw == "" {
		return nil, errors.New("TWOFA_ENCRYPTION_KEY ou JWT_SECRET doit être défini pour chiffrer le secret TOTP")
	}
	return totpKeyFrom(raw), nil
}

func candidateTotpKeys() [][]byte {
	keys := [][]byte{}
	if k, err := primaryTotpKey(); err == nil {
		keys = append(keys, k)
	}
	if os.Getenv("TWOFA_ENCRYPTION_KEY") != "" && os.Getenv("JWT_SECRET") != "" {
		keys = append(keys, totpKeyFrom(os.Getenv("JWT_SECRET")))
	}
	return keys
}

// encryptTotpSecret : AES-256-GCM, format v1:base64(iv|tag|ct).
func encryptTotpSecret(plain string) (string, error) {
	key, err := primaryTotpKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	iv := make([]byte, 12)
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, iv, []byte(plain), nil) // ct|tag
	ct, tag := sealed[:len(sealed)-16], sealed[len(sealed)-16:]
	out := append(append(append([]byte{}, iv...), tag...), ct...)
	return "v1:" + base64.StdEncoding.EncodeToString(out), nil
}

func decryptTotpSecret(stored string) (string, error) {
	if !strings.HasPrefix(stored, "v1:") {
		return stored, nil
	}
	raw, err := base64.StdEncoding.DecodeString(stored[3:])
	if err != nil || len(raw) < 28 {
		return "", errors.New("secret TOTP illisible")
	}
	iv, tag, ct := raw[:12], raw[12:28], raw[28:]
	var lastErr error = errors.New("aucune clé")
	for _, key := range candidateTotpKeys() {
		block, err := aes.NewCipher(key)
		if err != nil {
			lastErr = err
			continue
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			lastErr = err
			continue
		}
		plain, err := gcm.Open(nil, iv, append(append([]byte{}, ct...), tag...), nil)
		if err == nil {
			return string(plain), nil
		}
		lastErr = err
	}
	return "", lastErr
}

// ── TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s) ───────────────────────

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func generateTotpSecret() string {
	b := make([]byte, 10)
	_, _ = rand.Read(b)
	return b32.EncodeToString(b)
}

func totpAt(secret []byte, counter int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))
	mac := hmac.New(sha1.New, secret)
	mac.Write(msg[:])
	sum := mac.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	code := (binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff) % 1_000_000
	return fmt.Sprintf("%06d", code)
}

// totpVerify vérifie le code sur la fenêtre ±window pas.
func totpVerify(token, secret string, window int) bool {
	if len(token) != 6 {
		return false
	}
	key, err := b32.DecodeString(strings.ToUpper(strings.TrimRight(secret, "=")))
	if err != nil {
		return false
	}
	step := time.Now().Unix() / 30
	for i := -window; i <= window; i++ {
		if hmac.Equal([]byte(totpAt(key, step+int64(i))), []byte(token)) {
			return true
		}
	}
	return false
}

func keyURI(account, issuer, secret string) string {
	return "otpauth://totp/" + encodeURIComponent(issuer) + ":" + encodeURIComponent(account) +
		"?secret=" + secret + "&period=30&digits=6&algorithm=SHA1&issuer=" + encodeURIComponent(issuer)
}

// ── Service ───────────────────────────────────────────────────────────────

var bcryptHashRe = regexp.MustCompile(`^\$2[aby]\$`)

func (h *handlers) generate2FASecret(ctx context.Context, userID, email string) (secret, otpauthURL, qrDataURL string, err error) {
	secret = generateTotpSecret()
	otpauthURL = keyURI(email, appName, secret)
	png, err := qrcode.Encode(otpauthURL, qrcode.Medium, 256)
	if err != nil {
		return "", "", "", err
	}
	qrDataURL = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	if err := h.rset(ctx, "2fa:pending:"+userID, secret, 10*60); err != nil {
		return "", "", "", err
	}
	return secret, otpauthURL, qrDataURL, nil
}

type result struct {
	ok  bool
	err string
}

func (h *handlers) enable2FA(ctx context.Context, userID, code string) (result, []string, error) {
	enabled, err := h.is2FAEnabled(ctx, userID)
	if err != nil {
		return result{}, nil, err
	}
	if enabled {
		return result{err: "La double authentification est déjà active. Désactivez-la d'abord."}, nil, nil
	}
	pending, err := h.rget(ctx, "2fa:pending:"+userID)
	if err != nil {
		return result{}, nil, err
	}
	if pending == "" {
		return result{err: "Session expirée. Veuillez recommencer la configuration."}, nil, nil
	}
	if !totpVerify(code, pending, 0) {
		return result{err: "Code invalide. Vérifiez votre application d'authentification."}, nil, nil
	}
	if _, err := h.markCodeUsed(ctx, userID, code); err != nil {
		return result{}, nil, err
	}
	backup := generateBackupCodes(8)
	hashed := make([]any, len(backup))
	for i, c := range backup {
		hb, err := bcrypt.GenerateFromPassword([]byte(c), 10)
		if err != nil {
			return result{}, nil, err
		}
		hashed[i] = string(hb)
	}
	encSecret, err := encryptTotpSecret(pending)
	if err != nil {
		return result{}, nil, err
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET totp_secret = ?, totp_enabled = TRUE, totp_backup_codes = ? WHERE id = ?",
		encSecret, platform.JSONString(hashed), userID); err != nil {
		return result{}, nil, err
	}
	if err := h.rdel(ctx, "2fa:pending:"+userID); err != nil {
		return result{}, nil, err
	}
	slog.Info("2FA activé pour l'utilisateur " + userID)
	return result{ok: true}, backup, nil
}

func (h *handlers) disable2FA(ctx context.Context, userID, code string) (result, error) {
	row, err := h.db.First(ctx, "SELECT totp_secret FROM users WHERE id = ? AND totp_enabled = TRUE", userID)
	if err != nil {
		return result{}, err
	}
	if row == nil {
		return result{err: "2FA non activé sur ce compte."}, nil
	}
	secret, err := decryptTotpSecret(row.Str("totp_secret"))
	if err != nil {
		return result{}, err
	}
	if !totpVerify(code, secret, 1) {
		return result{err: "Code invalide."}, nil
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, totp_backup_codes = NULL WHERE id = ?", userID); err != nil {
		return result{}, err
	}
	slog.Info("2FA désactivé pour l'utilisateur " + userID)
	return result{ok: true}, nil
}

// verify2FA vérifie un code TOTP ou un code de secours (usage unique).
func (h *handlers) verify2FA(ctx context.Context, userID, code string) (bool, error) {
	row, err := h.db.First(ctx, "SELECT totp_secret, totp_backup_codes FROM users WHERE id = ? AND totp_enabled = TRUE", userID)
	if err != nil || row == nil {
		return false, err
	}
	secret, err := decryptTotpSecret(row.Str("totp_secret"))
	if err != nil {
		return false, err
	}
	if totpVerify(code, secret, 1) {
		return h.markCodeUsed(ctx, userID, code)
	}
	if raw := row.Get("totp_backup_codes"); platform.Truthy(raw) {
		var stored []any
		if s, ok := raw.(string); ok {
			if parsed, perr := platform.ParseJSON([]byte(s)); perr == nil {
				stored, _ = parsed.([]any)
			}
		} else if list, ok := raw.([]any); ok {
			stored = list
		}
		normalized := strings.ToUpper(jsTrim(code))
		for i, entry := range stored {
			es, isStr := entry.(string)
			var match bool
			if isStr && bcryptHashRe.MatchString(es) {
				match = bcrypt.CompareHashAndPassword([]byte(es), []byte(normalized)) == nil
			} else {
				match = isStr && es == normalized
			}
			if match {
				stored = append(stored[:i:i], stored[i+1:]...)
				if _, err := h.db.Exec(ctx, "UPDATE users SET totp_backup_codes = ? WHERE id = ?", platform.JSONString(stored), userID); err != nil {
					return false, err
				}
				slog.Info("Code de secours 2FA utilisé pour " + userID)
				return true, nil
			}
		}
	}
	return false, nil
}

// markCodeUsed marque un code TOTP comme consommé ; faux s'il l'était déjà.
func (h *handlers) markCodeUsed(ctx context.Context, userID, code string) (bool, error) {
	key := "2fa:used:" + userID + ":" + code
	v, err := h.rget(ctx, key)
	if err != nil {
		return false, err
	}
	if v != "" {
		return false, nil
	}
	return true, h.rset(ctx, key, "1", 120)
}

func (h *handlers) is2FAEnabled(ctx context.Context, userID string) (bool, error) {
	row, err := h.db.First(ctx, "SELECT totp_enabled FROM users WHERE id = ?", userID)
	if err != nil || row == nil {
		return false, err
	}
	return row.Int("totp_enabled") == 1, nil
}

func (h *handlers) createPendingSession(ctx context.Context, userID string) (string, error) {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	return token, h.rset(ctx, "2fa:session:"+token, userID, 5*60)
}

func (h *handlers) resolvePendingSession(ctx context.Context, token string) (string, error) {
	userID, err := h.rget(ctx, "2fa:session:"+token)
	if err != nil || userID == "" {
		return "", err
	}
	return userID, h.rdel(ctx, "2fa:session:"+token)
}

func generateBackupCodes(count int) []string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	codes := make([]string, count)
	for i := range codes {
		b := make([]byte, 8)
		_, _ = rand.Read(b)
		code := make([]byte, 8)
		for j := range code {
			code[j] = chars[int(b[j])%len(chars)]
		}
		codes[i] = string(code)
	}
	return codes
}
