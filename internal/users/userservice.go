// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// ==========================================

package users

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

// col renvoie la valeur d'une colonne, ou undefined si la colonne n'a pas été sélectionnée.
func col(row *platform.Object, key string) any {
	if !row.Has(key) {
		return platform.Undefined
	}
	return row.Get(key)
}

// jsonList : valeur de colonne JSON → tableau (vide si absente ou illisible).
func jsonList(v any) any {
	if !platform.Truthy(v) {
		return []any{}
	}
	switch x := v.(type) {
	case []any:
		return x
	case string:
		if parsed, err := platform.ParseJSON([]byte(x)); err == nil {
			return parsed
		}
	}
	return []any{}
}

func (h *handlers) formatUser(row *platform.Object) *platform.Object {
	var badges any = []any{}
	if platform.Truthy(row.Get("badges")) {
		switch b := row.Get("badges").(type) {
		case string:
			if parsed, err := platform.ParseJSON([]byte(b)); err == nil {
				badges = parsed
			}
		default:
			badges = b
		}
	}
	showBadges := any(true)
	if row.Has("show_badges") {
		showBadges = row.Bool("show_badges")
	}
	return platform.O(
		"id", col(row, "id"),
		"email", col(row, "email"),
		"username", col(row, "username"),
		"displayName", col(row, "display_name"),
		"avatarUrl", col(row, "avatar_url"),
		"bannerUrl", col(row, "banner_url"),
		"bio", col(row, "bio"),
		"cardColor", col(row, "card_color"),
		"badges", badges,
		"showBadges", showBadges,
		"hiddenBadgeIds", jsonList(row.Get("hidden_badge_ids")),
		"tutorialCompleted", row.Bool("tutorial_completed"),
		"role", platform.Or(row.Get("role"), "user"),
		"status", col(row, "status"),
		"customStatus", orNil(row.Get("custom_status")),
		"statusEmoji", orNil(row.Get("status_emoji")),
		"isOnline", row.Bool("is_online"),
		"createdAt", col(row, "created_at"),
		"lastSeenAt", col(row, "last_seen_at"),
		"interests", jsonList(row.Get("interests")),
	)
}

// orNil : valeur || null
func orNil(v any) any {
	if platform.Truthy(v) {
		return v
	}
	return nil
}

func (h *handlers) invalidateCache(ctx context.Context, userID string) error {
	return h.rdel(ctx, "user:"+userID)
}

func (h *handlers) findByID(ctx context.Context, userID string) (*platform.Object, error) {
	cached, err := h.rget(ctx, "user:"+userID)
	if err != nil {
		return nil, err
	}
	if cached != "" {
		if parsed, perr := platform.ParseJSON([]byte(cached)); perr == nil {
			if o, ok := parsed.(*platform.Object); ok {
				return o, nil
			}
		}
	}
	row, err := h.db.First(ctx, `SELECT u.id, u.username, u.email, u.display_name, u.avatar_url, u.banner_url, u.bio,
              u.card_color, u.badges, u.show_badges, u.hidden_badge_ids, u.role, u.status, u.is_online,
              u.tutorial_completed, u.created_at, u.last_seen_at, u.custom_status, u.status_emoji,
              up.interests
       FROM users u
       LEFT JOIN user_preferences up ON up.user_id = u.id
       WHERE u.id = ?`, userID)
	if err != nil || row == nil {
		return nil, err
	}
	user := h.formatUser(row)
	if err := h.rset(ctx, "user:"+userID, platform.JSONString(user), 300); err != nil {
		return nil, err
	}
	return user, nil
}

func (h *handlers) findByIDs(ctx context.Context, ids []string) ([]*platform.Object, error) {
	if len(ids) == 0 {
		return []*platform.Object{}, nil
	}
	rows, err := h.db.Rows(ctx, `SELECT id, username, display_name, avatar_url, banner_url, bio,
              card_color, badges, show_badges, hidden_badge_ids, role, status, is_online,
              created_at, last_seen_at, custom_status, status_emoji
       FROM users WHERE id IN (`+platform.Placeholders(len(ids))+`)`, platform.Args(ids)...)
	if err != nil {
		return nil, err
	}
	out := make([]*platform.Object, len(rows))
	for i, r := range rows {
		out[i] = h.formatUser(r)
	}
	return out, nil
}

// findByEmail renvoie la ligne brute (colonnes snake_case) ou nil.
func (h *handlers) findByEmail(ctx context.Context, email string) (*platform.Object, error) {
	return h.db.First(ctx, "SELECT * FROM users WHERE email = ?", email)
}

func (h *handlers) findByUsername(ctx context.Context, username string) (*platform.Object, error) {
	row, err := h.db.First(ctx, "SELECT * FROM users WHERE username = ?", username)
	if err != nil || row == nil {
		return nil, err
	}
	return h.formatUser(row), nil
}

func escapeLike(q string) string {
	var b strings.Builder
	for _, r := range q {
		if r == '\\' || r == '%' || r == '_' {
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

func (h *handlers) searchUsers(ctx context.Context, query string, limit int) ([]*platform.Object, error) {
	esc := escapeLike(query)
	rows, err := h.db.Rows(ctx, `SELECT id, username, display_name, avatar_url, banner_url, card_color,
              badges, show_badges, hidden_badge_ids, role, status, is_online
       FROM users
       WHERE (username LIKE ? OR display_name LIKE ?) AND email NOT LIKE 'deleted\\_%@anonymous.local'
       LIMIT `+itoa(limit), "%"+esc+"%", "%"+esc+"%")
	if err != nil {
		return nil, err
	}
	out := make([]*platform.Object, len(rows))
	for i, r := range rows {
		out[i] = h.formatUser(r)
	}
	return out, nil
}

func (h *handlers) createUser(ctx context.Context, id, email, username, displayName, passwordHash string) (*platform.Object, error) {
	if _, err := h.db.Exec(ctx, "INSERT INTO users (id, email, username, display_name, password_hash) VALUES (?, ?, ?, ?, ?)",
		id, email, username, displayName, passwordHash); err != nil {
		return nil, err
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO user_preferences (user_id) VALUES (?)", id); err != nil {
		return nil, err
	}
	return platform.O("id", id, "email", email, "username", username, "displayName", displayName,
		"status", "offline", "isOnline", false, "createdAt", platform.JSDate(time.Now())), nil
}

// profileError : texte de profil refusé par le filtre (ProfanityError).
type profileError struct{ msg string }

func (e *profileError) Error() string { return e.msg }

func (h *handlers) updateStatus(ctx context.Context, userID, status string, customStatus, emoji any) error {
	isOnline := status != "offline" && status != "invisible"
	if !undef(customStatus) || !undef(emoji) {
		var cs, em any
		if !undef(customStatus) {
			if s, ok := customStatus.(string); ok {
				cs = jsSlice(s, 100)
			}
		}
		if !undef(emoji) {
			if s, ok := emoji.(string); ok {
				em = jsSlice(s, 10)
			}
		}
		if _, err := h.db.Exec(ctx, "UPDATE users SET status = ?, is_online = ?, custom_status = ?, status_emoji = ? WHERE id = ?",
			status, isOnline, cs, em, userID); err != nil {
			return err
		}
	} else if _, err := h.db.Exec(ctx, "UPDATE users SET status = ?, is_online = ? WHERE id = ?", status, isOnline, userID); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

// jsSlice : String.prototype.slice(0, n) sur des unités UTF-16.
func jsSlice(s string, n int) string {
	u := platform.UTF16(s)
	if len(u) <= n {
		return s
	}
	return platform.FromUTF16(u[:n])
}

func (h *handlers) checkUsernameAvailable(ctx context.Context, username string) (bool, error) {
	rows, err := h.db.Rows(ctx, "SELECT id FROM users WHERE username = ?", username)
	return len(rows) == 0, err
}

var _ = math.Floor
