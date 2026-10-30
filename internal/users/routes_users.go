// ==========================================
// ALFYCHAT - ROUTES UTILISATEURS
// ==========================================

package users

import (
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/alfychat/users/internal/platform"
)

var (
	mediaRelRe  = regexp.MustCompile(`^/(api/media|uploads)/[A-Za-z0-9/_.%-]+$`)
	mediaHTTPRe = regexp.MustCompile("(?i)^https?://[^\\s<>\"'`\\\\]+$")
	hexColorRe  = regexp.MustCompile(`(?i)^#[0-9a-f]{6}$`)
	uuid36Re    = regexp.MustCompile(`(?i)^[0-9a-f-]{36}$`)
	slugRe      = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
	lowerUserRe = regexp.MustCompile(`^[a-z0-9_]+$`)
)

// isAcceptableMediaURL : chemin relatif servi par la plateforme, ou http(s) sans caractère de contrôle.
func isAcceptableMediaURL(v any) bool {
	if v == nil {
		return true
	}
	s, ok := v.(string)
	if !ok {
		return false
	}
	if s == "" {
		return true
	}
	if platform.JSLength(s) > 500 {
		return false
	}
	if mediaRelRe.MatchString(s) && !strings.Contains(s, "..") {
		return true
	}
	return mediaHTTPRe.MatchString(s)
}

// publicProfile retire l'e-mail d'un profil.
func publicProfile(user *platform.Object) *platform.Object {
	c := user.Clone()
	c.Delete("email")
	return c
}

func (h *handlers) isAdminUser(r *http.Request) (bool, error) {
	if uid(r) == "" {
		return false, nil
	}
	row, err := h.db.First(r.Context(), "SELECT role FROM users WHERE id = ?", uid(r))
	if err != nil || row == nil {
		return false, err
	}
	return row.Get("role") == "admin", nil
}

func rowsAny(rows []platform.Row) []any {
	out := make([]any, len(rows))
	for i, r := range rows {
		out[i] = r
	}
	return out
}

func (h *handlers) apiChangelogs(w http.ResponseWriter, r *http.Request) {
	q := platform.Query(r)
	limit := math.Min(platform.ParseIntOr(q.Get("limit"), 50), 100)
	offset := platform.ParseIntOr(q.Get("offset"), 0)
	rows, err := h.getChangelogs(r.Context(), int64(limit), int64(offset))
	if err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, rowsAny(rows))
}

func (h *handlers) apiShortLink(w http.ResponseWriter, r *http.Request) {
	slug := strings.ToLower(r.PathValue("slug"))
	if !slugRe.MatchString(slug) {
		platform.Error(w, 404, "Lien introuvable")
		return
	}
	target, ok, err := h.resolveShortLink(r.Context(), slug)
	if err != nil {
		serverError(w)
		return
	}
	if !ok || target == "" {
		platform.Error(w, 404, "Lien introuvable")
		return
	}
	platform.JSON(w, 200, platform.O("targetUrl", target))
}

func profileFromBody(r *http.Request) profileUpdate {
	return profileUpdate{
		displayName: field(r, "displayName"), avatarURL: field(r, "avatarUrl"), bannerURL: field(r, "bannerUrl"),
		bio: field(r, "bio"), cardColor: field(r, "cardColor"), showBadges: field(r, "showBadges"),
		hiddenBadgeIDs: field(r, "hiddenBadgeIds"), tutorialCompleted: field(r, "tutorialCompleted"),
	}
}

func profileChains() []*platform.Chain {
	return []*platform.Chain{
		platform.BodyField("displayName").Optional().IsLength(0, 64),
		platform.BodyField("avatarUrl").Optional().IsString(),
		platform.BodyField("bannerUrl").Optional().IsString(),
		platform.BodyField("bio").Optional().IsLength(0, 500),
		platform.BodyField("cardColor").Optional().IsString().IsLength(0, 7),
		platform.BodyField("showBadges").Optional().IsBoolean(),
		platform.BodyField("hiddenBadgeIds").Optional().IsArray(-1, -1),
	}
}

// applyProfile valide puis applique la mise à jour du profil de targetID.
func (h *handlers) applyProfile(w http.ResponseWriter, r *http.Request, targetID string) {
	d := profileFromBody(r)
	if (!undef(d.avatarURL) && !isAcceptableMediaURL(d.avatarURL)) || (!undef(d.bannerURL) && !isAcceptableMediaURL(d.bannerURL)) {
		platform.Error(w, 400, "URL d'image invalide")
		return
	}
	if !undef(d.cardColor) && d.cardColor != nil && !hexColorRe.MatchString(platform.JSString(d.cardColor)) {
		platform.Error(w, 400, "Couleur invalide")
		return
	}
	if err := h.updateProfile(r.Context(), targetID, d); err != nil {
		var pe *profileError
		if errors.As(err, &pe) {
			platform.Error(w, 400, pe.msg)
			return
		}
		fail(w, "Erreur mise à jour profil:", err)
		return
	}
	updated, err := h.findByID(r.Context(), targetID)
	if err != nil {
		fail(w, "Erreur mise à jour profil:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", updated))
}

func (h *handlers) apiUpdateOwnProfile(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, profileChains()...) {
		return
	}
	h.applyProfile(w, r, uid(r))
}

func (h *handlers) apiSearchUsers(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.QueryField("q").IsString().IsLength(1, 64),
		platform.QueryField("limit").Optional().IsInt(platform.MinMax(1, 50)),
	) {
		return
	}
	q := platform.Query(r)
	query, ok := q.Get("q").(string)
	if !ok || query == "" {
		platform.Error(w, 400, "Requête de recherche requise")
		return
	}
	limit := 20.0
	if v := q.Get("limit"); v != nil {
		limit = platform.ParseIntOr(v, 20)
	}
	limit = math.Min(math.Max(limit, 1), 50)
	users, err := h.searchUsers(r.Context(), jsSlice(query, 64), int(limit))
	if err != nil {
		fail(w, "Erreur recherche utilisateurs:", err)
		return
	}
	out := make([]any, len(users))
	for i, u := range users {
		out[i] = u
	}
	platform.JSON(w, 200, out)
}

func (h *handlers) apiBatchUsers(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.QueryField("ids").IsString().IsLength(0, 4000)) {
		return
	}
	ids, ok := platform.Query(r).Get("ids").(string)
	if !ok || ids == "" {
		platform.Error(w, 400, "IDs requis")
		return
	}
	seen := map[string]bool{}
	var list []string
	for _, s := range strings.Split(ids, ",") {
		s = jsTrim(s)
		if uuid36Re.MatchString(s) && !seen[s] {
			seen[s] = true
			list = append(list, s)
		}
	}
	if len(list) > 100 {
		list = list[:100]
	}
	users, err := h.findByIDs(r.Context(), list)
	if err != nil {
		fail(w, "Erreur récupération utilisateurs:", err)
		return
	}
	out := make([]any, len(users))
	for i, u := range users {
		out[i] = u
	}
	platform.JSON(w, 200, out)
}

func (h *handlers) apiCheckUsername(w http.ResponseWriter, r *http.Request) {
	username := r.PathValue("username")
	if c := checkUsername(username, false); !c.ok {
		platform.JSON(w, 200, platform.O("available", false, "blocked", true, "reason", c.reason))
		return
	}
	ok, err := h.checkUsernameAvailable(r.Context(), username)
	if err != nil {
		fail(w, "Erreur vérification username:", err)
		return
	}
	platform.JSON(w, 200, platform.O("available", ok))
}

func (h *handlers) apiPublicKey(w http.ResponseWriter, r *http.Request) {
	row, err := h.db.First(r.Context(), "SELECT public_key FROM users WHERE id = ?", r.PathValue("userId"))
	if err != nil {
		fail(w, "Erreur récupération clé publique:", err)
		return
	}
	if row == nil || !platform.Truthy(row.Get("public_key")) {
		platform.Error(w, 404, "Clé publique introuvable")
		return
	}
	platform.JSON(w, 200, platform.O("publicKey", row.Get("public_key")))
}

func (h *handlers) apiGetUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.PathValue("userId")
	viewerID := uid(r)
	internal := isInternal(r)

	user, err := h.findByID(ctx, userID)
	if err != nil {
		fail(w, "Erreur récupération utilisateur:", err)
		return
	}
	if user == nil {
		platform.Error(w, 404, "Utilisateur non trouvé")
		return
	}
	if viewerID == userID || (internal && viewerID == "") {
		platform.JSON(w, 200, user)
		return
	}
	view := publicProfile(user)
	if viewerID != "" {
		if h.isBlockedBy(ctx, viewerID, userID) {
			platform.Error(w, 404, "Utilisateur non trouvé")
			return
		}
		hidden, err := h.isActivityHiddenFrom(ctx, userID, viewerID)
		if err != nil {
			fail(w, "Erreur récupération utilisateur:", err)
			return
		}
		if hidden {
			view.Set("status", "offline").Set("isOnline", false)
		}
	}
	if !h.showsOnlineStatus(ctx, userID) {
		view.Set("status", "offline").Set("isOnline", false).Set("customStatus", nil).Set("statusEmoji", nil)
	}
	platform.JSON(w, 200, view)
}

func (h *handlers) apiUpdateProfile(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, profileChains()...) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	h.applyProfile(w, r, userID)
}

func (h *handlers) apiUpdateStatus(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("status").IsIn("online", "idle", "dnd", "invisible", "offline"),
		platform.BodyField("customStatus").OptionalNullable().IsString().IsLength(0, 100),
		platform.BodyField("text").OptionalNullable().IsString().IsLength(0, 100),
		platform.BodyField("emoji").OptionalNullable().IsString().IsLength(0, 10),
	) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	text, custom := field(r, "text"), field(r, "customStatus")
	// text ?? customStatus ; emoji ?? null
	resolved := text
	if undef(text) || text == nil {
		resolved = custom
	}
	var emoji any = field(r, "emoji")
	if undef(emoji) {
		emoji = nil
	}
	status, _ := str(field(r, "status"))
	if err := h.updateStatus(r.Context(), userID, status, resolved, emoji); err != nil {
		fail(w, "Erreur mise à jour statut:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiUpdateCustomStatus(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("customStatus").OptionalNullable().IsString().IsLength(0, 100)) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	cs := field(r, "customStatus")
	if undef(cs) {
		cs = nil
	}
	if err := h.updateCustomStatus(r.Context(), userID, cs); err != nil {
		fail(w, "Erreur mise à jour statut personnalisé:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiLastSeen(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	if err := h.updateLastSeen(r.Context(), userID); err != nil {
		fail(w, "Erreur mise à jour last seen:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiGetPreferences(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	prefs, err := h.getPreferences(r.Context(), userID)
	if err != nil {
		fail(w, "Erreur récupération préférences:", err)
		return
	}
	if prefs == nil {
		platform.Error(w, 404, "Préférences non trouvées")
		return
	}
	platform.JSON(w, 200, prefs)
}

func (h *handlers) apiUpdatePreferences(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	if err := h.updatePreferences(r.Context(), userID, platform.Body(r)); err != nil {
		fail(w, "Erreur mise à jour préférences:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiChangePassword(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("currentPassword").IsString().IsLength(1, 128),
		platform.BodyField("newPassword").IsString().IsLength(8, 128),
	) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	cur, _ := str(field(r, "currentPassword"))
	next, _ := str(field(r, "newPassword"))
	ctx := r.Context()
	res, err := h.changePassword(ctx, userID, cur, next, field(r, "encryptedPrivateKey"), field(r, "keySalt"))
	if err != nil {
		fail(w, "Erreur changement mot de passe:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	if err := h.revokeSessions(ctx, userID, sessionID(r)); err != nil {
		fail(w, "Erreur changement mot de passe:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiChangeUsername(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("newUsername").IsString().IsLength(3, 32).Matches(lowerUserRe),
		platform.BodyField("password").IsString().IsLength(1, -1),
	) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	nu, _ := str(field(r, "newUsername"))
	pw, _ := str(field(r, "password"))
	res, err := h.changeUsername(r.Context(), userID, nu, pw)
	if err != nil {
		fail(w, "Erreur changement username:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	updated, err := h.findByID(r.Context(), userID)
	if err != nil {
		fail(w, "Erreur changement username:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", updated))
}

func (h *handlers) apiGetBadges(w http.ResponseWriter, r *http.Request) {
	badges, err := h.getBadges(r.Context(), r.PathValue("userId"))
	if err != nil {
		fail(w, "Erreur récupération badges:", err)
		return
	}
	platform.JSON(w, 200, badges)
}

func (h *handlers) apiAddBadge(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("badgeType").IsString()) {
		return
	}
	admin, err := h.isAdminUser(r)
	if err != nil {
		fail(w, "Erreur attribution badge:", err)
		return
	}
	if !admin {
		platform.Error(w, 403, "Accès réservé aux administrateurs")
		return
	}
	bt, _ := str(field(r, "badgeType"))
	if err := h.addBadge(r.Context(), r.PathValue("userId"), bt); err != nil {
		fail(w, "Erreur attribution badge:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiRemoveBadge(w http.ResponseWriter, r *http.Request) {
	admin, err := h.isAdminUser(r)
	if err != nil {
		fail(w, "Erreur retrait badge:", err)
		return
	}
	if !admin {
		platform.Error(w, 403, "Accès réservé aux administrateurs")
		return
	}
	if err := h.removeBadge(r.Context(), r.PathValue("userId"), r.PathValue("badgeId")); err != nil {
		fail(w, "Erreur retrait badge:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiToggleBadges(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("show").IsBoolean()) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	if err := h.toggleBadgesVisibility(r.Context(), userID, field(r, "show")); err != nil {
		fail(w, "Erreur bascule badges:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiMusicPresence(w http.ResponseWriter, r *http.Request) {
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	raw := platform.RawBody(r)
	var data any
	nonEmpty := false
	switch b := raw.(type) {
	case *platform.Object:
		nonEmpty = len(b.Keys()) > 0
	case []any:
		nonEmpty = len(b) > 0
	}
	if nonEmpty {
		get := func(k string) any { return platform.GetPath(raw, k) }
		strOf := func(k string, max int) any {
			if s, ok := get(k).(string); ok {
				return jsSlice(s, max)
			}
			return platform.Undefined
		}
		if cu := get("coverUrl"); !undef(cu) && !isAcceptableMediaURL(cu) {
			platform.Error(w, 400, "coverUrl invalide")
			return
		}
		started := get("startedAt")
		switch started.(type) {
		case float64, string:
		default:
			started = platform.Undefined
		}
		data = platform.O("title", strOf("title", 200), "artist", strOf("artist", 200), "coverUrl", strOf("coverUrl", 500),
			"platform", strOf("platform", 32), "startedAt", started)
	}
	var arg any
	if data != nil {
		arg = platform.JSONString(data)
	}
	if _, err := h.db.Exec(r.Context(), "UPDATE users SET music_presence = ? WHERE id = ?", arg, userID); err != nil {
		serverError(w)
		return
	}
	_ = h.invalidateCache(r.Context(), userID)
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiProfileCard(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("profileCardUrl").OptionalNullable().IsString()) {
		return
	}
	userID := r.PathValue("userId")
	if uid(r) != userID {
		platform.Error(w, 403, "Non autorisé")
		return
	}
	url := field(r, "profileCardUrl")
	if undef(url) {
		url = nil
	}
	if !isAcceptableMediaURL(url) {
		platform.Error(w, 400, "URL invalide")
		return
	}
	if _, err := h.db.Exec(r.Context(), "UPDATE users SET profile_card_url = ? WHERE id = ?", url, userID); err != nil {
		serverError(w)
		return
	}
	_ = h.invalidateCache(r.Context(), userID)
	platform.JSON(w, 200, platform.O("success", true))
}

// ── Favoris, visibilité d'activité, DM épinglés ───────────────────────────

func (h *handlers) apiGetFavorites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var rows []platform.Row
	var err error
	if t := platform.Query(r).Get("type"); platform.Truthy(t) {
		rows, err = h.db.Rows(ctx, "SELECT id, type, value, position FROM user_favorites WHERE user_id = ? AND type = ? ORDER BY position ASC", uid(r), platform.SQLParam(t))
	} else {
		rows, err = h.db.Rows(ctx, "SELECT id, type, value, position FROM user_favorites WHERE user_id = ? ORDER BY type ASC, position ASC", uid(r))
	}
	if err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, rowsAny(rows))
}

func (h *handlers) apiAddFavorite(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("type").IsIn("emoji", "sticker", "gif"),
		platform.BodyField("value").IsString().IsLength(1, 500),
	) {
		return
	}
	ctx := r.Context()
	typ, _ := str(field(r, "type"))
	value, _ := str(field(r, "value"))
	id := newID()
	pos, err := h.db.First(ctx, "SELECT COALESCE(MAX(position), -1) as maxPos FROM user_favorites WHERE user_id = ? AND type = ?", uid(r), typ)
	if err != nil {
		serverError(w)
		return
	}
	position := int64(0)
	if pos != nil {
		position = pos.Int("maxPos") + 1
	}
	if _, err := h.db.Exec(ctx, "INSERT IGNORE INTO user_favorites (id, user_id, type, value, position) VALUES (?, ?, ?, ?, ?)", id, uid(r), typ, value, position); err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 201, platform.O("id", id, "type", typ, "value", value, "position", position))
}

func (h *handlers) apiRemoveFavorite(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(), "DELETE FROM user_favorites WHERE id = ? AND user_id = ?", r.PathValue("id"), uid(r)); err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiReorderFavorites(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("orderedIds").IsArray(-1, -1)) {
		return
	}
	ids, _ := field(r, "orderedIds").([]any)
	for i, id := range ids {
		if _, err := h.db.Exec(r.Context(), "UPDATE user_favorites SET position = ? WHERE id = ? AND user_id = ?", i, platform.SQLParam(id), uid(r)); err != nil {
			serverError(w)
			return
		}
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiHiddenFrom(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), "SELECT hidden_from_user_id FROM activity_visibility_exceptions WHERE user_id = ?", uid(r))
	if err != nil {
		serverError(w)
		return
	}
	out := make([]any, len(rows))
	for i, row := range rows {
		out[i] = row.Get("hidden_from_user_id")
	}
	platform.JSON(w, 200, out)
}

func (h *handlers) apiHideActivity(w http.ResponseWriter, r *http.Request) {
	target := r.PathValue("targetUserId")
	if !uuid36Re.MatchString(target) {
		platform.Error(w, 400, "Identifiant invalide")
		return
	}
	if _, err := h.db.Exec(r.Context(), "INSERT IGNORE INTO activity_visibility_exceptions (user_id, hidden_from_user_id) VALUES (?, ?)", uid(r), target); err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiShowActivity(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(), "DELETE FROM activity_visibility_exceptions WHERE user_id = ? AND hidden_from_user_id = ?", uid(r), r.PathValue("targetUserId")); err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiGetPinned(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), "SELECT conversation_id, pin_order FROM pinned_conversations WHERE user_id = ? ORDER BY pin_order ASC", uid(r))
	if err != nil {
		serverError(w)
		return
	}
	out := make([]any, len(rows))
	for i, row := range rows {
		out[i] = platform.O("conversationId", row.Get("conversation_id"), "pinOrder", row.Get("pin_order"))
	}
	platform.JSON(w, 200, out)
}

func (h *handlers) apiPin(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	pos, err := h.db.First(ctx, "SELECT COALESCE(MAX(pin_order), -1) as maxOrd FROM pinned_conversations WHERE user_id = ?", uid(r))
	if err != nil {
		serverError(w)
		return
	}
	order := int64(0)
	if pos != nil {
		order = pos.Int("maxOrd") + 1
	}
	if _, err := h.db.Exec(ctx, "INSERT IGNORE INTO pinned_conversations (user_id, conversation_id, pin_order) VALUES (?, ?, ?)", uid(r), r.PathValue("conversationId"), order); err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiUnpin(w http.ResponseWriter, r *http.Request) {
	if _, err := h.db.Exec(r.Context(), "DELETE FROM pinned_conversations WHERE user_id = ? AND conversation_id = ?", uid(r), r.PathValue("conversationId")); err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}
