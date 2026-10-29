// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS (profil, préférences, badges, favoris…)
// ==========================================

package users

import (
	"context"
	_ "embed"
	"sort"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

//go:embed badges.json
var badgesJSON []byte

type badgeDef struct {
	ID, Name, Icon, Color string
	Order                 float64
}

var badgeDefs = loadBadgeDefs()

func loadBadgeDefs() map[string]badgeDef {
	out := map[string]badgeDef{}
	parsed, err := platform.ParseJSON(badgesJSON)
	if err != nil {
		panic(err)
	}
	for _, v := range parsed.([]any) {
		o := v.(*platform.Object)
		out[o.Str("id")] = badgeDef{o.Str("id"), o.Str("name"), o.Str("icon"), o.Str("color"), num(o.Get("order"))}
	}
	return out
}

func num(v any) float64 {
	n := platform.ToNumber(v)
	if n != n {
		return 0
	}
	return n
}

// ── Profil ────────────────────────────────────────────────────────────────

type profileUpdate struct {
	displayName, avatarURL, bannerURL, bio, cardColor, showBadges, hiddenBadgeIDs, tutorialCompleted any
}

func (h *handlers) updateProfile(ctx context.Context, userID string, d profileUpdate) error {
	var updates []string
	var params []any
	add := func(col string, v any) { updates, params = append(updates, col+" = ?"), append(params, v) }
	if !undef(d.displayName) {
		name, _ := d.displayName.(string)
		if c := checkUsername(name, false); !c.ok {
			reason := c.reason
			if reason == "" {
				reason = "Nom affiché refusé"
			}
			return &profileError{reason}
		}
		add("display_name", platform.SQLParam(d.displayName))
	}
	if !undef(d.avatarURL) {
		add("avatar_url", platform.SQLParam(d.avatarURL))
	}
	if !undef(d.bannerURL) {
		add("banner_url", platform.SQLParam(d.bannerURL))
	}
	if !undef(d.bio) {
		add("bio", platform.SQLParam(d.bio))
	}
	if !undef(d.cardColor) {
		add("card_color", platform.SQLParam(d.cardColor))
	}
	if !undef(d.showBadges) {
		add("show_badges", bit(d.showBadges))
	}
	if !undef(d.hiddenBadgeIDs) {
		add("hidden_badge_ids", platform.JSONString(d.hiddenBadgeIDs))
	}
	if !undef(d.tutorialCompleted) {
		add("tutorial_completed", bit(d.tutorialCompleted))
	}
	if len(updates) == 0 {
		return nil
	}
	params = append(params, userID)
	if _, err := h.db.Exec(ctx, "UPDATE users SET "+strings.Join(updates, ", ")+" WHERE id = ?", params...); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

func bit(v any) int {
	if platform.Truthy(v) {
		return 1
	}
	return 0
}

func (h *handlers) updateCustomStatus(ctx context.Context, userID string, customStatus any) error {
	var v any
	if s, ok := customStatus.(string); ok && s != "" {
		v = jsSlice(s, 100)
	} else if platform.Truthy(customStatus) {
		v = platform.JSString(customStatus)
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET custom_status = ? WHERE id = ?", v, userID); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

func (h *handlers) updateLastSeen(ctx context.Context, userID string) error {
	if _, err := h.db.Exec(ctx, "UPDATE users SET last_seen_at = NOW(), is_online = FALSE WHERE id = ?", userID); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

// ── Préférences ───────────────────────────────────────────────────────────

func parseJSONField(v any) any {
	if !platform.Truthy(v) {
		return platform.Undefined
	}
	if s, ok := v.(string); ok {
		if parsed, err := platform.ParseJSON([]byte(s)); err == nil {
			return parsed
		}
		return platform.Undefined
	}
	return v
}

func formatDateOnly(v any) any {
	if !platform.Truthy(v) {
		return platform.Undefined
	}
	s := platform.JSString(v)
	if i := strings.Index(s, "T"); i >= 0 {
		s = s[:i]
	}
	return s
}

func undefIfFalsy(v any) any {
	if platform.Truthy(v) {
		return v
	}
	return platform.Undefined
}

func (h *handlers) getPreferences(ctx context.Context, userID string) (*platform.Object, error) {
	row, err := h.db.First(ctx, "SELECT * FROM user_preferences WHERE user_id = ?", userID)
	if err != nil || row == nil {
		return nil, err
	}
	showOnline := true
	if v := row.Get("privacy_show_online"); v != nil {
		showOnline = row.Bool("privacy_show_online")
	}
	allowFR := true
	if v := row.Get("privacy_allow_friend_requests"); v != nil {
		allowFR = row.Bool("privacy_allow_friend_requests")
	}
	pdm := row.Get("privacy_allow_dm")
	mode := "everyone"
	if pdm == "everyone" || pdm == "friends" || pdm == "none" {
		mode = pdm.(string)
	}
	var dnd any = platform.Undefined
	if row.Get("dnd_enabled") != nil {
		dnd = row.Bool("dnd_enabled")
	}
	var wallpaper any
	if w := row.Get("wallpaper"); w != nil {
		wallpaper = w
	}
	return platform.O(
		"theme", row.Get("theme"), "language", row.Get("language"), "encryptionLevel", row.Get("encryption_level"),
		"notificationsDesktop", row.Bool("notifications_desktop"), "notificationsSound", row.Bool("notifications_sound"),
		"notificationsMentions", row.Bool("notifications_mentions"), "notificationsDm", row.Bool("notifications_dm"),
		"privacyShowOnline", showOnline, "privacyAllowDm", pdm == "everyone", "privacyAllowDmMode", mode,
		"privacyAllowFriendRequests", allowFR,
		"birthday", formatDateOnly(row.Get("birthday")), "timezone", undefIfFalsy(row.Get("timezone")),
		"interests", parseJSONField(row.Get("interests")), "micMode", undefIfFalsy(row.Get("mic_mode")),
		"fontFamily", undefIfFalsy(row.Get("font_family")), "dndEnabled", dnd,
		"notifKeywords", parseJSONField(row.Get("notif_keywords")), "quietStart", undefIfFalsy(row.Get("quiet_start")),
		"quietEnd", undefIfFalsy(row.Get("quiet_end")), "vacationStart", formatDateOnly(row.Get("vacation_start")),
		"vacationEnd", formatDateOnly(row.Get("vacation_end")), "layoutPrefs", parseJSONField(row.Get("layout_prefs")),
		"wallpaper", wallpaper, "appPrefs", parseJSONField(row.Get("app_prefs")),
	), nil
}

var prefFields = []struct{ key, column string }{
	{"theme", "theme"}, {"language", "language"}, {"encryptionLevel", "encryption_level"},
	{"notificationsDesktop", "notifications_desktop"}, {"notificationsSound", "notifications_sound"},
	{"notificationsMentions", "notifications_mentions"}, {"notificationsDm", "notifications_dm"},
	{"privacyShowOnline", "privacy_show_online"}, {"privacyAllowDm", "privacy_allow_dm"},
	{"privacyAllowFriendRequests", "privacy_allow_friend_requests"}, {"birthday", "birthday"},
	{"timezone", "timezone"}, {"interests", "interests"}, {"micMode", "mic_mode"}, {"fontFamily", "font_family"},
	{"dndEnabled", "dnd_enabled"}, {"notifKeywords", "notif_keywords"}, {"quietStart", "quiet_start"},
	{"quietEnd", "quiet_end"}, {"vacationStart", "vacation_start"}, {"vacationEnd", "vacation_end"},
	{"layoutPrefs", "layout_prefs"}, {"wallpaper", "wallpaper"}, {"appPrefs", "app_prefs"},
}

var (
	prefJSONFields = map[string]bool{"interests": true, "notifKeywords": true, "layoutPrefs": true, "appPrefs": true}
	prefBoolFields = map[string]bool{"notificationsDesktop": true, "notificationsSound": true, "notificationsMentions": true,
		"notificationsDm": true, "privacyShowOnline": true, "privacyAllowFriendRequests": true, "dndEnabled": true}
)

func (h *handlers) updatePreferences(ctx context.Context, userID string, data *platform.Object) error {
	var updates []string
	var params []any
	for _, f := range prefFields {
		if !data.Has(f.key) {
			continue
		}
		value := data.Get(f.key)
		switch {
		case f.key == "privacyAllowDm":
			switch {
			case value == true || value == "everyone":
				value = "everyone"
			case value == "none":
				value = "none"
			default:
				value = "friends"
			}
		case prefBoolFields[f.key]:
			value = value == true || platform.StrictEqual(value, float64(1)) || value == "true"
		case prefJSONFields[f.key] && value != nil && isObjectOrArray(value):
			s := platform.JSONString(value)
			if platform.JSLength(s) > 65535 {
				continue
			}
			value = s
		default:
			if s, ok := value.(string); ok && platform.JSLength(s) > 2000 {
				continue
			}
		}
		updates = append(updates, f.column+" = ?")
		params = append(params, platform.SQLParam(value))
	}
	if len(updates) == 0 {
		return nil
	}
	params = append(params, userID)
	if _, err := h.db.Exec(ctx, "UPDATE user_preferences SET "+strings.Join(updates, ", ")+" WHERE user_id = ?", params...); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

func isObjectOrArray(v any) bool {
	switch v.(type) {
	case *platform.Object, []any:
		return true
	}
	return false
}

// ── Mot de passe / pseudo ─────────────────────────────────────────────────

func (h *handlers) changeUsername(ctx context.Context, userID, newUsername, password string) (result, error) {
	if c := checkUsername(newUsername, false); !c.ok {
		return result{err: c.reason}, nil
	}
	row, err := h.db.First(ctx, "SELECT password_hash FROM users WHERE id = ?", userID)
	if err != nil {
		return result{}, err
	}
	if row == nil {
		return result{err: "Utilisateur non trouvé"}, nil
	}
	if !verifyPassword(password, row.Str("password_hash")) {
		return result{err: "Mot de passe incorrect"}, nil
	}
	ok, err := h.checkUsernameAvailable(ctx, newUsername)
	if err != nil {
		return result{}, err
	}
	if !ok {
		return result{err: "Ce nom d'utilisateur est déjà pris"}, nil
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET username = ? WHERE id = ?", newUsername, userID); err != nil {
		return result{}, err
	}
	return result{ok: true}, h.invalidateCache(ctx, userID)
}

func (h *handlers) changePassword(ctx context.Context, userID, current, next string, encPriv, keySalt any) (result, error) {
	row, err := h.db.First(ctx, "SELECT password_hash FROM users WHERE id = ?", userID)
	if err != nil {
		return result{}, err
	}
	if row == nil {
		return result{err: "Utilisateur non trouvé"}, nil
	}
	if !verifyPassword(current, row.Str("password_hash")) {
		return result{err: "Mot de passe actuel incorrect"}, nil
	}
	hash, err := hashPassword(next)
	if err != nil {
		return result{}, err
	}
	if platform.Truthy(encPriv) && platform.Truthy(keySalt) {
		_, err = h.db.Exec(ctx, "UPDATE users SET password_hash = ?, encrypted_private_key = ?, key_salt = ? WHERE id = ?",
			hash, platform.SQLParam(encPriv), platform.SQLParam(keySalt), userID)
	} else {
		_, err = h.db.Exec(ctx, "UPDATE users SET password_hash = ? WHERE id = ?", hash, userID)
	}
	return result{ok: err == nil}, err
}

// ── Badges intégrés ───────────────────────────────────────────────────────

func (h *handlers) getBadges(ctx context.Context, userID string) (any, error) {
	row, err := h.db.First(ctx, "SELECT badges FROM users WHERE id = ?", userID)
	if err != nil || row == nil || !platform.Truthy(row.Get("badges")) {
		return []any{}, err
	}
	switch b := row.Get("badges").(type) {
	case string:
		if parsed, perr := platform.ParseJSON([]byte(b)); perr == nil {
			return parsed, nil
		}
		return []any{}, nil
	default:
		return b, nil
	}
}

func (h *handlers) addBadge(ctx context.Context, userID, badgeType string) error {
	cur, err := h.getBadges(ctx, userID)
	if err != nil {
		return err
	}
	list, _ := cur.([]any)
	for _, b := range list {
		if o, ok := b.(*platform.Object); ok && o.Get("id") == badgeType {
			return nil
		}
	}
	def, ok := badgeDefs[badgeType]
	if !ok {
		return errPlain("Type de badge invalide")
	}
	list = append(list, platform.O("id", badgeType, "name", def.Name, "icon", def.Icon, "color", def.Color, "earnedAt", isoNow()))
	order := func(b any) float64 {
		if o, ok := b.(*platform.Object); ok {
			if d, ok := badgeDefs[o.Str("id")]; ok {
				return d.Order
			}
		}
		return 999
	}
	sort.SliceStable(list, func(i, j int) bool { return order(list[i]) < order(list[j]) })
	if _, err := h.db.Exec(ctx, "UPDATE users SET badges = ? WHERE id = ?", platform.JSONString(list), userID); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

func (h *handlers) removeBadge(ctx context.Context, userID, badgeID string) error {
	cur, err := h.getBadges(ctx, userID)
	if err != nil {
		return err
	}
	list, _ := cur.([]any)
	filtered := []any{}
	for _, b := range list {
		if o, ok := b.(*platform.Object); ok && o.Get("id") == badgeID {
			continue
		}
		filtered = append(filtered, b)
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET badges = ? WHERE id = ?", platform.JSONString(filtered), userID); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

func (h *handlers) toggleBadgesVisibility(ctx context.Context, userID string, show any) error {
	if _, err := h.db.Exec(ctx, "UPDATE users SET show_badges = ? WHERE id = ?", platform.SQLParam(show), userID); err != nil {
		return err
	}
	return h.invalidateCache(ctx, userID)
}

// ── Confidentialité ───────────────────────────────────────────────────────

func (h *handlers) isBlockedBy(ctx context.Context, viewerID, targetID string) bool {
	rows, err := h.db.Rows(ctx, "SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'blocked' LIMIT 1", targetID, viewerID)
	return err == nil && len(rows) > 0
}

func (h *handlers) showsOnlineStatus(ctx context.Context, userID string) bool {
	row, err := h.db.First(ctx, "SELECT privacy_show_online FROM user_preferences WHERE user_id = ?", userID)
	if err != nil || row == nil {
		return true
	}
	v := row.Get("privacy_show_online")
	return v == nil || row.Bool("privacy_show_online")
}

func (h *handlers) isActivityHiddenFrom(ctx context.Context, userID, viewerID string) (bool, error) {
	rows, err := h.db.Rows(ctx, "SELECT 1 FROM activity_visibility_exceptions WHERE user_id = ? AND hidden_from_user_id = ? LIMIT 1", userID, viewerID)
	return len(rows) > 0, err
}

var _ = time.Now
