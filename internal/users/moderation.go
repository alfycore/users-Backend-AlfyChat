// ==========================================
// ALFYCHAT - MODÉRATION GLOBALE
// Avertissements, mutes, kicks et bannissements à l'échelle de la plateforme.
// ==========================================

package users

import (
	"bytes"
	"context"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

const statusCacheTTL = 30

var sanctionTypes = []string{"warn", "mute", "kick", "ban"}

func (h *handlers) formatSanction(row *platform.Object) *platform.Object {
	var expiresAt time.Time
	hasExpiry := false
	if s, ok := row.Get("expires_at").(string); ok && s != "" {
		if t, ok := parseDate(s); ok {
			expiresAt, hasExpiry = t, true
		}
	}
	revoked := row.Bool("revoked")
	var issuedByUsername any
	if v := row.Get("issued_by_username"); v != nil && v != platform.Undefined {
		issuedByUsername = v
	}
	var revokeReason any
	if v := row.Get("revoke_reason"); v != nil {
		revokeReason = v
	}
	return platform.O(
		"id", row.Get("id"), "userId", row.Get("user_id"), "username", col(row, "username"), "displayName", col(row, "display_name"),
		"type", row.Get("type"), "reason", row.Get("reason"), "expiresAt", nullIfEmpty(row.Get("expires_at")),
		"issuedBy", row.Get("issued_by"), "issuedByUsername", issuedByUsername, "revoked", revoked,
		"revokedBy", row.Get("revoked_by"), "revokedAt", nullIfEmpty(row.Get("revoked_at")), "revokeReason", revokeReason,
		"createdAt", row.Get("created_at"),
		"active", !revoked && (!hasExpiry || expiresAt.After(time.Now())),
	)
}

func nullIfEmpty(v any) any {
	if platform.Truthy(v) {
		return v
	}
	return nil
}

func (h *handlers) getSanction(ctx context.Context, id string) (*platform.Object, error) {
	row, err := h.db.First(ctx, `SELECT s.*, u.username, u.display_name, a.username AS issued_by_username
       FROM moderation_sanctions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN users a ON a.id = s.issued_by
       WHERE s.id = ?`, id)
	if err != nil || row == nil {
		return nil, err
	}
	return h.formatSanction(row), nil
}

// notifyGateway demande au gateway d'appliquer la sanction aux WebSockets ouverts (best-effort).
func (h *handlers) notifyGateway(userID, typ, reason string, expiresAt any) {
	secret := h.auth.InternalSecret()
	if secret == "" {
		return
	}
	body, _ := platform.O("userId", userID, "type", typ, "reason", reason, "expiresAt", expiresAt).MarshalJSON()
	req, err := http.NewRequest(http.MethodPost, platform.Env("GATEWAY_URL", "http://localhost:3000")+"/internal/moderation/enforce", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-secret", secret)
	res, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		slog.Warn("Gateway injoignable pour appliquer la sanction sur " + userID)
		return
	}
	res.Body.Close()
}

func (h *handlers) revokeAllSessionsForModeration(ctx context.Context, userID string) {
	rows, err := h.db.Rows(ctx, "SELECT refresh_token FROM sessions WHERE user_id = ?", userID)
	if err == nil {
		for _, row := range rows {
			if err = h.rset(ctx, "revoked:"+row.Str("refresh_token"), "1", revokedMarkerSessions); err != nil {
				break
			}
		}
	}
	if err == nil {
		_, err = h.db.Exec(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	}
	if err == nil {
		_, err = h.db.Exec(ctx, "UPDATE users SET is_online = FALSE, status = ? WHERE id = ?", "offline", userID)
	}
	if err != nil {
		slog.Error("Erreur révocation des sessions:", "err", err)
	}
}

type modStatus struct {
	banned      bool
	bannedUntil any
	banReason   any
	muted       bool
	mutedUntil  any
	muteReason  any
	warnings    int64
}

func (s modStatus) object() *platform.Object {
	return platform.O("banned", s.banned, "bannedUntil", s.bannedUntil, "banReason", s.banReason,
		"muted", s.muted, "mutedUntil", s.mutedUntil, "muteReason", s.muteReason, "warnings", s.warnings)
}

func (h *handlers) computeStatus(ctx context.Context, userID string) (modStatus, error) {
	rows, err := h.db.Rows(ctx, `SELECT type, reason, expires_at
       FROM moderation_sanctions
       WHERE user_id = ? AND revoked = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())
         AND type IN ('ban', 'mute')
       ORDER BY expires_at IS NULL DESC, expires_at DESC`, userID)
	if err != nil {
		return modStatus{}, err
	}
	warn, err := h.db.First(ctx, "SELECT COUNT(*) AS count FROM moderation_sanctions WHERE user_id = ? AND type = 'warn' AND revoked = FALSE", userID)
	if err != nil {
		return modStatus{}, err
	}
	st := modStatus{}
	if warn != nil {
		st.warnings = int64(num(warn.Get("count")))
	}
	for _, row := range rows {
		if row.Get("type") == "ban" && !st.banned {
			st.banned, st.bannedUntil, st.banReason = true, nullIfEmpty(row.Get("expires_at")), row.Get("reason")
		}
		if row.Get("type") == "mute" && !st.muted {
			st.muted, st.mutedUntil, st.muteReason = true, nullIfEmpty(row.Get("expires_at")), row.Get("reason")
		}
	}
	return st, nil
}

func (h *handlers) getModStatus(ctx context.Context, userID string) (modStatus, error) {
	if cached, err := h.rget(ctx, "mod:status:"+userID); err == nil && cached != "" {
		if parsed, perr := platform.ParseJSON([]byte(cached)); perr == nil {
			if o, ok := parsed.(*platform.Object); ok {
				return modStatus{
					banned: o.Bool("banned"), bannedUntil: nullIfEmpty(o.Get("bannedUntil")), banReason: coalesceNil(o.Get("banReason")),
					muted: o.Bool("muted"), mutedUntil: nullIfEmpty(o.Get("mutedUntil")), muteReason: coalesceNil(o.Get("muteReason")),
					warnings: int64(num(o.Get("warnings"))),
				}, nil
			}
		}
	}
	st, err := h.computeStatus(ctx, userID)
	if err != nil {
		return modStatus{}, err
	}
	_ = h.rset(ctx, "mod:status:"+userID, platform.JSONString(st.object()), statusCacheTTL)
	return st, nil
}

// coalesceNil : v ?? null
func coalesceNil(v any) any {
	if v == nil || v == platform.Undefined {
		return nil
	}
	return v
}

// refreshUserFlags réaligne les colonnes dénormalisées de `users` sur les sanctions actives.
func (h *handlers) refreshUserFlags(ctx context.Context, userID string) error {
	st, err := h.computeStatus(ctx, userID)
	if err != nil {
		return err
	}
	if _, err := h.db.Exec(ctx, "UPDATE users SET is_banned = ?, banned_until = ?, ban_reason = ?, muted_until = ?, mute_reason = ? WHERE id = ?",
		bit(st.banned), toTimeParam(st.bannedUntil), st.banReason, toTimeParam(st.mutedUntil), st.muteReason, userID); err != nil {
		return err
	}
	_ = h.rdel(ctx, "mod:status:"+userID)
	_ = h.rdel(ctx, "user:"+userID)
	return nil
}

// toTimeParam convertit une date ISO en time.Time pour un paramètre DATETIME.
func toTimeParam(v any) any {
	if s, ok := v.(string); ok && s != "" {
		if t, ok := parseDate(s); ok {
			return t
		}
	}
	return nil
}

func (h *handlers) applySanction(ctx context.Context, userID, typ, reason string, duration any, issuedBy string) (*platform.Object, error) {
	id := newID()
	var expires any
	var expiresISO any
	if d, ok := duration.(float64); ok && (typ == "ban" || typ == "mute") && d > 0 {
		t := time.Now().Add(time.Duration(d * float64(time.Minute)))
		expires, expiresISO = t, platform.JSDate(t)
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO moderation_sanctions (id, user_id, type, reason, expires_at, issued_by) VALUES (?, ?, ?, ?, ?, ?)",
		id, userID, typ, reason, expires, issuedBy); err != nil {
		return nil, err
	}
	if typ == "ban" || typ == "kick" {
		h.revokeAllSessionsForModeration(ctx, userID)
	}
	if err := h.refreshUserFlags(ctx, userID); err != nil {
		return nil, err
	}
	go h.notifyGateway(userID, typ, reason, expiresISO)
	s, err := h.getSanction(ctx, id)
	if err != nil {
		return nil, err
	}
	if s == nil {
		return nil, errPlain("Sanction non créée")
	}
	return s, nil
}

func (h *handlers) revokeSanctionByID(ctx context.Context, sanctionID, revokedBy string, reason any) (result, error) {
	s, err := h.getSanction(ctx, sanctionID)
	if err != nil {
		return result{}, err
	}
	if s == nil {
		return result{err: "Sanction introuvable"}, nil
	}
	if s.Bool("revoked") {
		return result{err: "Sanction déjà levée"}, nil
	}
	if _, err := h.db.Exec(ctx, `UPDATE moderation_sanctions
       SET revoked = TRUE, revoked_by = ?, revoked_at = NOW(), revoke_reason = ?
       WHERE id = ?`, revokedBy, nullable(reason), sanctionID); err != nil {
		return result{}, err
	}
	userID := s.Str("userId")
	if err := h.refreshUserFlags(ctx, userID); err != nil {
		return result{}, err
	}
	go h.notifyGateway(userID, "lift", stringOr(reason, ""), nil)
	return result{ok: true}, nil
}

// nullable : revokeReason ?? null
func nullable(v any) any {
	if v == nil || v == platform.Undefined {
		return nil
	}
	return platform.SQLParam(v)
}

func stringOr(v any, def string) string {
	if v == nil || v == platform.Undefined {
		return def
	}
	return platform.JSString(v)
}

func (h *handlers) revokeActiveSanctions(ctx context.Context, userID, typ, revokedBy string, reason any) (int64, error) {
	res, err := h.db.Exec(ctx, `UPDATE moderation_sanctions
       SET revoked = TRUE, revoked_by = ?, revoked_at = NOW(), revoke_reason = ?
       WHERE user_id = ? AND type = ? AND revoked = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())`, revokedBy, nullable(reason), userID, typ)
	if err != nil {
		return 0, err
	}
	if err := h.refreshUserFlags(ctx, userID); err != nil {
		return 0, err
	}
	go h.notifyGateway(userID, "lift", stringOr(reason, ""), nil)
	n, _ := res.RowsAffected()
	return n, nil
}

func (h *handlers) reloadTerms(ctx context.Context) {
	rows, err := h.db.Rows(ctx, "SELECT * FROM moderation_terms ORDER BY term ASC")
	if err != nil {
		slog.Error("Erreur rechargement des termes interdits:", "err", err)
		return
	}
	terms := make([]customTerm, len(rows))
	for i, r := range rows {
		terms[i] = customTerm{r.Str("term"), termMatch(r.Str("match_type"))}
	}
	setCustomTerms(terms)
}

// ── Autorisation ──────────────────────────────────────────────────────────

var staffRoles = []string{"admin", "moderator", "support_l1", "support_l2", "technician"}

// authorizeTarget : empêche l'auto-sanction, la sanction d'un admin et l'escalade entre pairs.
func (h *handlers) authorizeTarget(r *http.Request, targetID string) (int, string, error) {
	if uid(r) == "" {
		return 401, "Non authentifié", nil
	}
	if uid(r) == targetID {
		return 400, "Vous ne pouvez pas vous sanctionner vous-même", nil
	}
	target, err := h.findByID(r.Context(), targetID)
	if err != nil {
		return 0, "", err
	}
	if target == nil {
		return 404, "Utilisateur introuvable", nil
	}
	targetRole := stringOr(platform.Or(target.Get("role"), "user"), "user")
	actorRole := userRole(r)
	if actorRole == "" {
		actorRole = "user"
	}
	if targetRole == "admin" {
		return 403, "Un administrateur ne peut pas être sanctionné", nil
	}
	if containsStr(staffRoles, targetRole) && actorRole != "admin" {
		return 403, "Seul un administrateur peut sanctionner un membre du staff", nil
	}
	return 0, "", nil
}

// ── Handlers ──────────────────────────────────────────────────────────────

func (h *handlers) apiModCreateSanction(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("type").IsIn(sanctionTypes...),
		platform.BodyField("reason").IsString().IsLength(3, 1000),
		platform.BodyField("durationMinutes").OptionalNullable().IsInt(platform.MinMax(1, 525600)),
	) {
		return
	}
	ctx := r.Context()
	userID := r.PathValue("userId")
	status, msg, err := h.authorizeTarget(r, userID)
	if err != nil {
		fail(w, "Erreur création sanction:", err)
		return
	}
	if status != 0 {
		platform.Error(w, status, msg)
		return
	}
	typ, _ := str(field(r, "type"))
	reason, _ := str(field(r, "reason"))
	duration := field(r, "durationMinutes")
	sanction, err := h.applySanction(ctx, userID, typ, reason, duration, uid(r))
	if err != nil {
		fail(w, "Erreur création sanction:", err)
		return
	}
	slog.Warn("[MODÉRATION] " + typ + " sur " + userID + " par " + uid(r) + " — " + reason)
	platform.JSON(w, 201, sanction)
}

func (h *handlers) apiModRevokeSanction(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("reason").Optional().IsString().IsLength(0, 1000)) {
		return
	}
	res, err := h.revokeSanctionByID(r.Context(), r.PathValue("sanctionId"), uid(r), field(r, "reason"))
	if err != nil {
		fail(w, "Erreur levée de sanction:", err)
		return
	}
	if !res.ok {
		platform.Error(w, 400, res.err)
		return
	}
	slog.Warn("[MODÉRATION] Sanction " + r.PathValue("sanctionId") + " levée par " + uid(r))
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) modLift(typ, logMsg, failMsg string, warn bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !validated(w, r, platform.BodyField("reason").Optional().IsString().IsLength(0, 1000)) {
			return
		}
		n, err := h.revokeActiveSanctions(r.Context(), r.PathValue("userId"), typ, uid(r), platform.GetPath(platform.Body(r), "reason"))
		if err != nil {
			fail(w, failMsg, err)
			return
		}
		if warn {
			slog.Warn("[MODÉRATION] " + logMsg + " de " + r.PathValue("userId") + " par " + uid(r))
		}
		platform.JSON(w, 200, platform.O("success", true, "revoked", n))
	}
}

func (h *handlers) listSanctions(ctx context.Context, userID, typ string, activeOnly bool, limit, offset float64) ([]any, error) {
	var where []string
	var params []any
	if userID != "" {
		where, params = append(where, "s.user_id = ?"), append(params, userID)
	}
	if typ != "" {
		where, params = append(where, "s.type = ?"), append(params, typ)
	}
	if activeOnly {
		where = append(where, "s.revoked = FALSE AND (s.expires_at IS NULL OR s.expires_at > NOW())")
	}
	limit = math.Min(limit, 500)
	offset = math.Max(offset, 0)
	clause := ""
	if len(where) > 0 {
		clause = "WHERE " + strings.Join(where, " AND ")
	}
	rows, err := h.db.Rows(ctx, `SELECT s.*, u.username, u.display_name, a.username AS issued_by_username
       FROM moderation_sanctions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN users a ON a.id = s.issued_by
       `+clause+`
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`, append(params, platform.JSNumber(limit), platform.JSNumber(offset))...)
	if err != nil {
		return nil, err
	}
	out := make([]any, len(rows))
	for i, row := range rows {
		out[i] = h.formatSanction(row)
	}
	return out, nil
}

func (h *handlers) apiModListSanctions(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.QueryField("userId").Optional().IsString(),
		platform.QueryField("type").Optional().IsIn(sanctionTypes...),
		platform.QueryField("activeOnly").Optional().IsBoolean(),
		platform.QueryField("limit").Optional().IsInt(platform.MinMax(1, 500)),
		platform.QueryField("offset").Optional().IsInt(platform.Min(0)),
	) {
		return
	}
	q := platform.Query(r)
	userID, _ := q.Get("userId").(string)
	typ, _ := q.Get("type").(string)
	limit := platform.ParseIntOr(q.Get("limit"), 100)
	offset := platform.ParseIntOr(q.Get("offset"), 0)
	out, err := h.listSanctions(r.Context(), userID, typ, q.Get("activeOnly") == "true", limit, offset)
	if err != nil {
		fail(w, "Erreur liste des sanctions:", err)
		return
	}
	platform.JSON(w, 200, out)
}

func (h *handlers) apiModUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	userID := r.PathValue("userId")
	st, err := h.getModStatus(ctx, userID)
	if err != nil {
		fail(w, "Erreur dossier de modération:", err)
		return
	}
	history, err := h.listSanctions(ctx, userID, "", false, 100, 0)
	if err != nil {
		fail(w, "Erreur dossier de modération:", err)
		return
	}
	platform.JSON(w, 200, platform.O("status", st.object(), "history", history))
}

func (h *handlers) apiModStats(w http.ResponseWriter, r *http.Request) {
	row, err := h.db.First(r.Context(), `SELECT
         SUM(type = 'ban'  AND revoked = FALSE AND (expires_at IS NULL OR expires_at > NOW())) AS active_bans,
         SUM(type = 'mute' AND revoked = FALSE AND (expires_at IS NULL OR expires_at > NOW())) AS active_mutes,
         SUM(type = 'warn' AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY))                  AS warnings_30d,
         COUNT(*)                                                                              AS total
       FROM moderation_sanctions`)
	if err != nil {
		fail(w, "Erreur stats modération:", err)
		return
	}
	n := func(k string) int64 {
		if row == nil {
			return 0
		}
		return int64(num(row.Get(k)))
	}
	platform.JSON(w, 200, platform.O("activeBans", n("active_bans"), "activeMutes", n("active_mutes"),
		"warnings30d", n("warnings_30d"), "totalSanctions", n("total")))
}

func (h *handlers) apiModListTerms(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), "SELECT * FROM moderation_terms ORDER BY term ASC")
	if err != nil {
		fail(w, "Erreur liste des termes:", err)
		return
	}
	platform.JSON(w, 200, mapRows(rows, func(row *platform.Object) *platform.Object {
		return platform.O("id", row.Get("id"), "term", row.Get("term"), "matchType", row.Get("match_type"),
			"createdBy", row.Get("created_by"), "createdAt", row.Get("created_at"))
	}))
}

func (h *handlers) apiModAddTerm(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("term").IsString().IsLength(2, 100),
		platform.BodyField("matchType").Optional().IsIn("substring", "word", "exact"),
	) {
		return
	}
	ctx := r.Context()
	term, _ := str(field(r, "term"))
	matchType := "word"
	if m, ok := field(r, "matchType").(string); ok && m != "" {
		matchType = m
	}
	normalized := strings.ToLower(jsTrim(term))
	if normalized == "" {
		platform.Error(w, 400, "Terme vide")
		return
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO moderation_terms (id, term, match_type, created_by) VALUES (?, ?, ?, ?)", newID(), normalized, matchType, uid(r)); err != nil {
		if isDupEntry(err) {
			platform.Error(w, 400, "Ce terme est déjà dans la liste")
			return
		}
		fail(w, "Erreur ajout de terme:", err)
		return
	}
	h.reloadTerms(ctx)
	platform.JSON(w, 201, platform.O("success", true))
}

func (h *handlers) apiModDeleteTerm(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if _, err := h.db.Exec(ctx, "DELETE FROM moderation_terms WHERE id = ?", r.PathValue("termId")); err != nil {
		fail(w, "Erreur suppression de terme:", err)
		return
	}
	h.reloadTerms(ctx)
	platform.JSON(w, 200, platform.O("success", true))
}
