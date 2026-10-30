// ==========================================
// ALFYCHAT - SERVICE ADMIN (couche données)
// ==========================================

package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

func formatBadge(row *platform.Object) *platform.Object {
	return platform.O("id", row.Get("id"), "name", row.Get("name"), "description", row.Get("description"),
		"iconType", row.Get("icon_type"), "iconValue", row.Get("icon_value"), "color", row.Get("color"),
		"displayOrder", row.Get("display_order"), "isActive", row.Bool("is_active"), "createdBy", row.Get("created_by"),
		"createdAt", row.Get("created_at"), "updatedAt", row.Get("updated_at"))
}

func (h *handlers) getAllCustomBadges(ctx context.Context) ([]any, error) {
	rows, err := h.db.Rows(ctx, "SELECT * FROM custom_badges ORDER BY display_order ASC, name ASC")
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = formatBadge(r)
	}
	return out, nil
}

func (h *handlers) getCustomBadge(ctx context.Context, id string) (*platform.Object, error) {
	row, err := h.db.First(ctx, "SELECT * FROM custom_badges WHERE id = ?", id)
	if err != nil || row == nil {
		return nil, err
	}
	return formatBadge(row), nil
}

// badgesOf lit la colonne JSON `badges` d'une ligne (tableau vide si absente/illisible).
func badgesOf(v any) []any {
	switch b := jsonList(v).(type) {
	case []any:
		return b
	}
	return []any{}
}

// syncBadgeToUsers propage un badge modifié aux utilisateurs qui le possèdent.
func (h *handlers) syncBadgeToUsers(ctx context.Context, badgeID string) error {
	badge, err := h.getCustomBadge(ctx, badgeID)
	if err != nil || badge == nil {
		return err
	}
	rows, err := h.db.Rows(ctx, "SELECT id, badges FROM users WHERE JSON_CONTAINS(badges, JSON_OBJECT('id', ?))", badgeID)
	if err != nil {
		return err
	}
	for _, user := range rows {
		list := badgesOf(user.Get("badges"))
		updated := make([]any, len(list))
		for i, b := range list {
			if o, ok := b.(*platform.Object); ok && platform.StrictEqual(o.Get("id"), badgeID) {
				c := o.Clone()
				c.Set("name", badge.Get("name")).Set("icon", badge.Get("iconValue")).Set("iconType", badge.Get("iconType")).
					Set("iconValue", badge.Get("iconValue")).Set("color", badge.Get("color"))
				updated[i] = c
			} else {
				updated[i] = b
			}
		}
		if _, err := h.db.Exec(ctx, "UPDATE users SET badges = ? WHERE id = ?", platform.JSONString(updated), user.Get("id")); err != nil {
			return err
		}
		_ = h.rdel(ctx, "user:"+user.Str("id"))
	}
	return nil
}

func (h *handlers) assignBadgeToUser(ctx context.Context, userID, badgeID string) error {
	badge, err := h.getCustomBadge(ctx, badgeID)
	if err != nil {
		return err
	}
	if badge == nil {
		return errPlain("Badge non trouvé")
	}
	row, err := h.db.First(ctx, "SELECT badges FROM users WHERE id = ?", userID)
	if err != nil {
		return err
	}
	if row == nil {
		return errPlain("Utilisateur non trouvé")
	}
	list := badgesOf(row.Get("badges"))
	for _, b := range list {
		if o, ok := b.(*platform.Object); ok && platform.StrictEqual(o.Get("id"), badgeID) {
			return nil
		}
	}
	list = append(list, platform.O("id", badge.Get("id"), "name", badge.Get("name"), "icon", badge.Get("iconValue"),
		"iconType", badge.Get("iconType"), "iconValue", badge.Get("iconValue"), "color", badge.Get("color"),
		"earnedAt", isoNow()))
	if _, err := h.db.Exec(ctx, "UPDATE users SET badges = ? WHERE id = ?", platform.JSONString(list), userID); err != nil {
		return err
	}
	_ = h.rdel(ctx, "user:"+userID)
	return nil
}

func (h *handlers) removeBadgeFromUser(ctx context.Context, userID, badgeID string) error {
	row, err := h.db.First(ctx, "SELECT badges FROM users WHERE id = ?", userID)
	if err != nil || row == nil {
		return err
	}
	filtered := []any{}
	for _, b := range badgesOf(row.Get("badges")) {
		if o, ok := b.(*platform.Object); ok && platform.StrictEqual(o.Get("id"), badgeID) {
			continue
		}
		filtered = append(filtered, b)
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET badges = ? WHERE id = ?", platform.JSONString(filtered), userID); err != nil {
		return err
	}
	_ = h.rdel(ctx, "user:"+userID)
	return nil
}

type plainError string

func (e plainError) Error() string { return string(e) }
func errPlain(s string) error      { return plainError(s) }

func isoNow() string { return platform.JSDate(time.Now()) }

// ── Paramètres du site ────────────────────────────────────────────────────

func (h *handlers) getSiteSettings(ctx context.Context) (map[string]string, error) {
	rows, err := h.db.Rows(ctx, "SELECT setting_key, setting_value FROM site_settings")
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, r := range rows {
		out[r.Str("setting_key")] = r.Str("setting_value")
	}
	return out, nil
}

func (h *handlers) settingEnabled(ctx context.Context, key string, def bool) (bool, error) {
	row, err := h.db.First(ctx, "SELECT setting_value FROM site_settings WHERE setting_key = ?", key)
	if err != nil {
		return false, err
	}
	if row == nil {
		return def, nil
	}
	return row.Get("setting_value") == "true", nil
}

func (h *handlers) isRegistrationEnabled(ctx context.Context) (bool, error) {
	return h.settingEnabled(ctx, "registration_enabled", true)
}

func (h *handlers) isTurnstileEnabled(ctx context.Context) (bool, error) {
	return h.settingEnabled(ctx, "turnstile_enabled", false)
}

// ── Liens d'inscription ───────────────────────────────────────────────────

type inviteValidation struct {
	valid  bool
	err    string
	linkID string
}

func (h *handlers) validateInviteCode(ctx context.Context, code, email string) (inviteValidation, error) {
	row, err := h.db.First(ctx, "SELECT * FROM invite_links WHERE code = ?", code)
	if err != nil {
		return inviteValidation{}, err
	}
	if row == nil {
		return inviteValidation{err: "Lien d'invitation invalide"}, nil
	}
	if row.Bool("used") {
		return inviteValidation{err: "Ce lien d'invitation a déjà été utilisé"}, nil
	}
	if s, ok := row.Get("expires_at").(string); ok {
		if t, ok := parseDate(s); ok && t.Before(time.Now()) {
			return inviteValidation{err: "Ce lien d'invitation a expiré"}, nil
		}
	}
	if strings.ToLower(row.Str("email")) != strings.ToLower(email) {
		return inviteValidation{err: "Cet email ne correspond pas au lien d'invitation"}, nil
	}
	return inviteValidation{valid: true, linkID: row.Str("id")}, nil
}

// parseDate : new Date(s) pour les formats ISO courants (ok=false si invalide).
func parseDate(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func (h *handlers) markInviteLinkUsed(ctx context.Context, linkID, usedBy string) error {
	_, err := h.db.Exec(ctx, "UPDATE invite_links SET used = TRUE, used_by = ?, used_at = NOW() WHERE id = ?", usedBy, linkID)
	return err
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ── Turnstile ─────────────────────────────────────────────────────────────

func verifyTurnstileToken(ctx context.Context, token string) bool {
	secret := platform.Env("TURNSTILE_SECRET_KEY", "")
	if secret == "" {
		return true
	}
	form := url.Values{"secret": {secret}, "response": {token}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var buf strings.Builder
	b := make([]byte, 4096)
	for {
		n, err := res.Body.Read(b)
		buf.Write(b[:n])
		if err != nil {
			break
		}
	}
	parsed, err := platform.ParseJSON([]byte(buf.String()))
	if err != nil {
		return false
	}
	return platform.GetPath(parsed, "success") == true
}

// ── Liens courts ──────────────────────────────────────────────────────────

func (h *handlers) resolveShortLink(ctx context.Context, slug string) (string, bool, error) {
	row, err := h.db.First(ctx, "SELECT target_url FROM short_links WHERE slug = ?", slug)
	if err != nil || row == nil {
		return "", false, err
	}
	if _, err := h.db.Exec(ctx, "UPDATE short_links SET clicks = clicks + 1 WHERE slug = ?", slug); err != nil {
		return "", false, err
	}
	return row.Str("target_url"), true, nil
}

// ── Changelogs ────────────────────────────────────────────────────────────

func (h *handlers) getChangelogs(ctx context.Context, limit, offset int64) ([]platform.Row, error) {
	return h.db.Rows(ctx, `SELECT c.*, u.username as author_username, u.display_name as author_display_name
       FROM changelogs c
       LEFT JOIN users u ON c.created_by = u.id
       ORDER BY c.created_at DESC
       LIMIT `+itoa(int(limit))+` OFFSET `+itoa(int(offset)))
}
