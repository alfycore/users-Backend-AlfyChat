// ==========================================
// ALFYCHAT - ROUTES ADMIN
// ==========================================

package users

import (
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

var (
	hexColor6Re = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	slugAdminRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
	allRoles    = []string{"user", "moderator", "admin", "support_l1", "support_l2", "technician"}
	changeTypes = []string{"feature", "fix", "improvement", "security", "breaking", "news"}
	reservedSlg = map[string]bool{"i": true, "u": true, "b": true, "m": true, "s": true, "api": true, "health": true}
)

func httpsURLOpts(o *platform.URLOptions) {
	o.Protocols = []string{"https"}
	o.RequireProtocol = true
}

func inList(list []string, v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	return containsStr(list, s)
}

func formatUserAdmin(row *platform.Object) *platform.Object {
	return platform.O("id", row.Get("id"), "username", row.Get("username"), "displayName", row.Get("display_name"),
		"email", row.Get("email"), "role", row.Get("role"), "badges", badgesOf(row.Get("badges")), "status", row.Get("status"),
		"isOnline", row.Bool("is_online"), "createdAt", row.Get("created_at"), "lastSeenAt", row.Get("last_seen_at"))
}

// ── Badges personnalisés ──────────────────────────────────────────────────

func (h *handlers) apiAdminBadges(w http.ResponseWriter, r *http.Request) {
	badges, err := h.getAllCustomBadges(r.Context())
	if err != nil {
		fail(w, "Erreur récupération badges:", err)
		return
	}
	platform.JSON(w, 200, badges)
}

func (h *handlers) apiAdminCreateBadge(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("name").IsString().IsLength(1, 100),
		platform.BodyField("description").Optional().IsString(),
		platform.BodyField("iconType").IsIn("bootstrap", "svg", "flaticon"),
		platform.BodyField("iconValue").IsString().IsLength(1, -1),
		platform.BodyField("color").IsString().Matches(hexColor6Re),
		platform.BodyField("displayOrder").Optional().IsInt(),
	) {
		return
	}
	name, iconType, iconValue, color := field(r, "name"), field(r, "iconType"), field(r, "iconValue"), field(r, "color")
	if !platform.Truthy(name) || !platform.Truthy(iconType) || !platform.Truthy(iconValue) || !platform.Truthy(color) {
		platform.Error(w, 400, "Données manquantes")
		return
	}
	ctx := r.Context()
	id := newID()
	order := any(float64(999))
	if v := field(r, "displayOrder"); platform.Truthy(v) {
		order = v
	}
	if _, err := h.db.Exec(ctx, `INSERT INTO custom_badges (id, name, description, icon_type, icon_value, color, display_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, platform.SQLParam(name), orNull(field(r, "description")), platform.SQLParam(iconType),
		platform.SQLParam(iconValue), platform.SQLParam(color), platform.SQLParam(order), uid(r)); err != nil {
		fail(w, "Erreur création badge:", err)
		return
	}
	badge, err := h.getCustomBadge(ctx, id)
	if err != nil || badge == nil {
		fail(w, "Erreur création badge:", errPlain("Badge non créé"))
		return
	}
	slog.Info("Badge créé: " + badge.Str("name") + " par " + uid(r))
	platform.JSON(w, 200, badge)
}

// orNull : valeur || null (paramètre SQL).
func orNull(v any) any {
	if platform.Truthy(v) {
		return platform.SQLParam(v)
	}
	return nil
}

func (h *handlers) apiAdminUpdateBadge(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("name").Optional().IsString().IsLength(1, 100),
		platform.BodyField("description").Optional().IsString(),
		platform.BodyField("iconType").Optional().IsIn("bootstrap", "svg", "flaticon"),
		platform.BodyField("iconValue").Optional().IsString().IsLength(1, -1),
		platform.BodyField("color").Optional().IsString().Matches(hexColor6Re),
		platform.BodyField("displayOrder").Optional().IsInt(),
	) {
		return
	}
	ctx := r.Context()
	badgeID := r.PathValue("badgeId")
	var updates []string
	var params []any
	for _, f := range [][2]string{{"name", "name"}, {"description", "description"}, {"iconType", "icon_type"},
		{"iconValue", "icon_value"}, {"color", "color"}, {"displayOrder", "display_order"}} {
		if v := field(r, f[0]); !undef(v) {
			updates, params = append(updates, f[1]+" = ?"), append(params, platform.SQLParam(v))
		}
	}
	if len(updates) > 0 {
		params = append(params, badgeID)
		if _, err := h.db.Exec(ctx, "UPDATE custom_badges SET "+strings.Join(updates, ", ")+", updated_at = NOW() WHERE id = ?", params...); err != nil {
			fail(w, "Erreur mise à jour badge:", err)
			return
		}
		if err := h.syncBadgeToUsers(ctx, badgeID); err != nil {
			fail(w, "Erreur mise à jour badge:", err)
			return
		}
	}
	slog.Info("Badge mis à jour: " + badgeID + " par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminBadgeStatus(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("isActive").IsBoolean()) {
		return
	}
	if _, err := h.db.Exec(r.Context(), "UPDATE custom_badges SET is_active = ? WHERE id = ?", platform.SQLParam(field(r, "isActive")), r.PathValue("badgeId")); err != nil {
		fail(w, "Erreur toggle badge:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminDeleteBadge(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(), "DELETE FROM custom_badges WHERE id = ?", r.PathValue("badgeId")); err != nil {
		fail(w, "Erreur suppression badge:", err)
		return
	}
	slog.Info("Badge supprimé: " + r.PathValue("badgeId") + " par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminAssignBadge(w http.ResponseWriter, r *http.Request) {
	if err := h.assignBadgeToUser(r.Context(), r.PathValue("userId"), r.PathValue("badgeId")); err != nil {
		fail(w, "Erreur attribution badge:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminRemoveUserBadge(w http.ResponseWriter, r *http.Request) {
	if err := h.removeBadgeFromUser(r.Context(), r.PathValue("userId"), r.PathValue("badgeId")); err != nil {
		fail(w, "Erreur retrait badge:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Utilisateurs ──────────────────────────────────────────────────────────

func (h *handlers) apiAdminUsers(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.QueryField("limit").Optional().IsInt(platform.MinMax(1, 500)),
		platform.QueryField("offset").Optional().IsInt(platform.Min(0)),
	) {
		return
	}
	q := platform.Query(r)
	limit := platform.ParseIntOr(q.Get("limit"), 100)
	offset := platform.ParseIntOr(q.Get("offset"), 0)
	rows, err := h.db.Rows(r.Context(), `SELECT id, username, display_name, email, role, badges, status, is_online, created_at, last_seen_at
       FROM users
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`, platform.JSNumber(limit), platform.JSNumber(offset))
	if err != nil {
		fail(w, "Erreur récupération utilisateurs:", err)
		return
	}
	platform.JSON(w, 200, mapRows(rows, formatUserAdmin))
}

func mapRows(rows []platform.Row, f func(*platform.Object) *platform.Object) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = f(r)
	}
	return out
}

func (h *handlers) apiAdminSearchUsers(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.QueryField("q").IsString().IsLength(1, -1)) {
		return
	}
	q, ok := platform.Query(r).Get("q").(string)
	if !ok || q == "" {
		platform.Error(w, 400, "Requête de recherche requise")
		return
	}
	like := "%" + q + "%"
	rows, err := h.db.Rows(r.Context(), `SELECT id, username, display_name, email, role, badges, status, is_online, created_at, last_seen_at
       FROM users
       WHERE username LIKE ? OR display_name LIKE ? OR email LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`, like, like, like, "50")
	if err != nil {
		fail(w, "Erreur recherche utilisateurs:", err)
		return
	}
	platform.JSON(w, 200, mapRows(rows, formatUserAdmin))
}

func (h *handlers) apiAdminUpdateRole(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("role").IsIn(allRoles...)) {
		return
	}
	userID, role := r.PathValue("userId"), field(r, "role")
	if !inList(allRoles, role) {
		platform.Error(w, 400, "Rôle invalide")
		return
	}
	if userID == uid(r) && role != "admin" {
		platform.Error(w, 400, "Impossible de modifier votre propre rôle")
		return
	}
	ctx := r.Context()
	if _, err := h.db.Exec(ctx, "UPDATE users SET role = ? WHERE id = ?", role, userID); err != nil {
		fail(w, "Erreur mise à jour rôle:", err)
		return
	}
	_ = h.rdel(ctx, "user:"+userID)
	slog.Info("Rôle " + role.(string) + " attribué à " + userID + " par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	count := func(q string) (any, error) {
		row, err := h.db.First(ctx, q)
		if err != nil || row == nil {
			return nil, err
		}
		return row.Get("count"), nil
	}
	var vals [4]any
	for i, q := range []string{"SELECT COUNT(*) as count FROM users", "SELECT COUNT(*) as count FROM users WHERE is_online = TRUE",
		`SELECT COUNT(*) as count FROM users WHERE role = "admin"`, `SELECT COUNT(*) as count FROM users WHERE role = "moderator"`} {
		v, err := count(q)
		if err != nil {
			fail(w, "Erreur récupération stats:", err)
			return
		}
		vals[i] = v
	}
	platform.JSON(w, 200, platform.O("totalUsers", vals[0], "onlineUsers", vals[1], "admins", vals[2], "moderators", vals[3]))
}

// ── Paramètres du site ────────────────────────────────────────────────────

func (h *handlers) apiAdminSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), "SELECT setting_key, setting_value FROM site_settings")
	if err != nil {
		fail(w, "Erreur récupération paramètres:", err)
		return
	}
	o := platform.O()
	for _, row := range rows {
		o.Set(row.Str("setting_key"), row.Get("setting_value"))
	}
	platform.JSON(w, 200, o)
}

func (h *handlers) apiAdminUpdateSetting(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("key").IsString().IsLength(1, -1),
		platform.BodyField("value").IsString(),
	) {
		return
	}
	key, value := field(r, "key"), field(r, "value")
	if !inList([]string{"registration_enabled", "turnstile_enabled", "turnstile_site_key"}, key) {
		platform.Error(w, 400, "Paramètre non autorisé")
		return
	}
	if _, err := h.db.Exec(r.Context(), `INSERT INTO site_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`, key, value, value); err != nil {
		fail(w, "Erreur mise à jour paramètre:", err)
		return
	}
	slog.Info("Paramètre " + key.(string) + " = " + value.(string) + " mis à jour par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Liens d'inscription ───────────────────────────────────────────────────

func (h *handlers) apiAdminCreateInvite(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("email").IsEmail().NormalizeEmail(),
		platform.BodyField("expiresInHours").Optional().IsInt(platform.MinMax(1, 720)),
	) {
		return
	}
	email, _ := str(field(r, "email"))
	hours := 48.0
	if v := field(r, "expiresInHours"); !undef(v) {
		hours = platform.ToNumber(v)
	}
	id, code := newID(), randomHex(32)
	expires := time.Now().Add(time.Duration(hours * float64(time.Hour)))
	if _, err := h.db.Exec(r.Context(), "INSERT INTO invite_links (id, code, email, created_by, expires_at) VALUES (?, ?, ?, ?, ?)",
		id, code, email, uid(r), expires); err != nil {
		fail(w, "Erreur création lien invitation:", err)
		return
	}
	slog.Info("Lien d'invitation créé pour " + email + " par " + uid(r))
	platform.JSON(w, 200, platform.O("id", id, "code", code, "email", email, "expiresAt", platform.JSDate(expires),
		"link", platform.Env("FRONTEND_URL", "http://localhost:4000")+"/register?invite="+code))
}

func (h *handlers) apiAdminInvites(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), `SELECT il.*, u.username as created_by_username
       FROM invite_links il
       LEFT JOIN users u ON il.created_by = u.id
       ORDER BY il.created_at DESC`)
	if err != nil {
		fail(w, "Erreur récupération liens invitation:", err)
		return
	}
	platform.JSON(w, 200, mapRows(rows, func(row *platform.Object) *platform.Object {
		return platform.O("id", row.Get("id"), "code", row.Get("code"), "email", row.Get("email"), "used", row.Bool("used"),
			"usedBy", row.Get("used_by"), "usedAt", row.Get("used_at"), "expiresAt", row.Get("expires_at"),
			"createdAt", row.Get("created_at"), "createdBy", row.Get("created_by"), "createdByUsername", row.Get("created_by_username"))
	}))
}

func (h *handlers) apiAdminDeleteInvite(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(), "DELETE FROM invite_links WHERE id = ?", r.PathValue("linkId")); err != nil {
		fail(w, "Erreur suppression lien invitation:", err)
		return
	}
	slog.Info("Lien d'invitation " + r.PathValue("linkId") + " supprimé par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Changelogs ────────────────────────────────────────────────────────────

func (h *handlers) apiAdminChangelogs(w http.ResponseWriter, r *http.Request) {
	q := platform.Query(r)
	limit := platform.ParseIntOr(q.Get("limit"), 50)
	offset := platform.ParseIntOr(q.Get("offset"), 0)
	rows, err := h.getChangelogs(r.Context(), int64(limit), int64(offset))
	if err != nil {
		fail(w, "Erreur récupération changelogs:", err)
		return
	}
	platform.JSON(w, 200, rowsAny(rows))
}

func (h *handlers) apiAdminCreateChangelog(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("version").OptionalNullable().IsString().IsLength(0, 50),
		platform.BodyField("title").IsString().IsLength(1, 255),
		platform.BodyField("content").IsString().IsLength(1, -1),
		platform.BodyField("type").Optional().IsIn(changeTypes...),
	) {
		return
	}
	title, content := field(r, "title"), field(r, "content")
	if !platform.Truthy(title) || !platform.Truthy(content) {
		platform.Error(w, 400, "title et content requis")
		return
	}
	typ := "feature"
	if t := field(r, "type"); inList(changeTypes, t) {
		typ = t.(string)
	}
	var banner any
	if s, ok := field(r, "bannerUrl").(string); ok && jsTrim(s) != "" {
		banner = jsTrim(s)
	}
	version := field(r, "version")
	if undef(version) || version == nil {
		version = ""
	}
	ctx := r.Context()
	id := newID()
	if _, err := h.db.Exec(ctx, "INSERT INTO changelogs (id, version, title, content, type, banner_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, platform.SQLParam(version), platform.SQLParam(title), platform.SQLParam(content), typ, banner, uid(r)); err != nil {
		fail(w, "Erreur création changelog:", err)
		return
	}
	row, err := h.db.First(ctx, "SELECT * FROM changelogs WHERE id = ?", id)
	if err != nil {
		fail(w, "Erreur création changelog:", err)
		return
	}
	slog.Info("Changelog créé: " + id + " par " + uid(r))
	platform.JSON(w, 201, row)
}

func (h *handlers) apiAdminUpdateChangelog(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("version").OptionalNullable().IsString().IsLength(0, 50),
		platform.BodyField("title").Optional().IsString().IsLength(1, 255),
		platform.BodyField("content").Optional().IsString().IsLength(1, -1),
		platform.BodyField("type").Optional().IsIn(changeTypes...),
		platform.BodyField("bannerUrl").OptionalNullable(),
	) {
		return
	}
	var parts []string
	var values []any
	add := func(col string, v any) { parts, values = append(parts, col+" = ?"), append(values, v) }
	if v := field(r, "version"); !undef(v) {
		add("version", jsTrim(platform.JSString(v)))
	}
	if t, ok := field(r, "title").(string); ok {
		add("title", jsTrim(t))
	}
	if c, ok := field(r, "content").(string); ok {
		add("content", jsTrim(c))
	}
	if t := field(r, "type"); inList(changeTypes, t) {
		add("type", t)
	}
	switch b := field(r, "bannerUrl").(type) {
	case string:
		if s := jsTrim(b); s != "" {
			add("banner_url", s)
		} else {
			add("banner_url", nil)
		}
	case nil:
		add("banner_url", nil)
	}
	if len(parts) > 0 {
		values = append(values, r.PathValue("changelogId"))
		if _, err := h.db.Exec(r.Context(), "UPDATE changelogs SET "+strings.Join(parts, ", ")+" WHERE id = ?", values...); err != nil {
			fail(w, "Erreur mise à jour changelog:", err)
			return
		}
	}
	slog.Info("Changelog " + r.PathValue("changelogId") + " mis à jour par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminDeleteChangelog(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(), "DELETE FROM changelogs WHERE id = ?", r.PathValue("changelogId")); err != nil {
		fail(w, "Erreur suppression changelog:", err)
		return
	}
	slog.Info("Changelog " + r.PathValue("changelogId") + " supprimé par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Liens courts ──────────────────────────────────────────────────────────

func (h *handlers) apiAdminShortLinks(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), "SELECT slug, target_url, clicks, created_at FROM short_links ORDER BY created_at DESC")
	if err != nil {
		fail(w, "Erreur récupération liens courts:", err)
		return
	}
	platform.JSON(w, 200, mapRows(rows, func(row *platform.Object) *platform.Object {
		return platform.O("slug", row.Get("slug"), "targetUrl", row.Get("target_url"), "clicks", row.Int("clicks"), "createdAt", row.Get("created_at"))
	}))
}

func (h *handlers) apiAdminCreateShortLink(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("slug").IsString().Trim().Matches(slugAdminRe),
		platform.BodyField("targetUrl").IsString().IsLength(0, 2048).IsURL(httpsURLOpts),
	) {
		return
	}
	slug := strings.ToLower(jsTrim(platform.JSString(field(r, "slug"))))
	if reservedSlg[slug] {
		platform.Error(w, 400, "« "+slug+" » est réservé")
		return
	}
	target := jsTrim(platform.JSString(field(r, "targetUrl")))
	if _, err := h.db.Exec(r.Context(), "INSERT INTO short_links (slug, target_url, created_by) VALUES (?, ?, ?)", slug, target, uid(r)); err != nil {
		if isDupEntry(err) {
			platform.Error(w, 409, "Le lien « "+slug+" » existe déjà")
			return
		}
		fail(w, "Erreur création lien court:", err)
		return
	}
	slog.Info("Lien court " + slug + " créé par " + uid(r))
	platform.JSON(w, 201, platform.O("success", true))
}

func (h *handlers) apiAdminUpdateShortLink(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("targetUrl").IsString().IsLength(0, 2048).IsURL(httpsURLOpts)) {
		return
	}
	slug := strings.ToLower(r.PathValue("slug"))
	res, err := h.db.Exec(r.Context(), "UPDATE short_links SET target_url = ? WHERE slug = ?", jsTrim(platform.JSString(field(r, "targetUrl"))), slug)
	if err != nil {
		fail(w, "Erreur modification lien court:", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		platform.Error(w, 404, "Lien introuvable")
		return
	}
	slog.Info("Lien court " + slug + " modifié par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiAdminDeleteShortLink(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if _, err := h.db.Exec(r.Context(), "DELETE FROM short_links WHERE slug = ?", slug); err != nil {
		fail(w, "Erreur suppression lien court:", err)
		return
	}
	slog.Info("Lien court " + slug + " supprimé par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Aperçu des emails (admin) ─────────────────────────────────────────────

func (h *handlers) apiEmailTypes(w http.ResponseWriter, r *http.Request) {
	out := make([]any, len(emailPreviewTypes))
	for i, t := range emailPreviewTypes {
		out[i] = platform.O("id", t.ID, "label", t.Label)
	}
	platform.JSON(w, 200, out)
}

func emailTypeIDs() []string {
	ids := make([]string, len(emailPreviewTypes))
	for i, t := range emailPreviewTypes {
		ids[i] = t.ID
	}
	return ids
}

func (h *handlers) apiEmailPreview(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.ParamField("type").IsIn(emailTypeIDs()...)) {
		return
	}
	html, _ := previewHTML(r.PathValue("type"))
	platform.JSON(w, 200, platform.O("html", html))
}

func (h *handlers) apiEmailSend(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.ParamField("type").IsIn(emailTypeIDs()...), platform.BodyField("to").IsEmail()) {
		return
	}
	to, _ := str(field(r, "to"))
	if !h.mail.sendPreviewEmail(r.PathValue("type"), to) {
		platform.JSON(w, 502, platform.O("success", false, "error", "L'envoi a échoué (voir logs SMTP)"))
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

var _ = math.Floor
