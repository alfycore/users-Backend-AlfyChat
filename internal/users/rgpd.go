// ==========================================
// ALFYCHAT - RGPD (export, suppression, consentements, anonymisation)
// ==========================================

package users

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
)

func (h *handlers) getConsents(ctx context.Context, userID string) ([]any, error) {
	rows, err := h.db.Rows(ctx, "SELECT id, consent_type, granted, granted_at, revoked_at FROM rgpd_consents WHERE user_id = ?", userID)
	if err != nil {
		return nil, err
	}
	return mapRows(rows, func(row *platform.Object) *platform.Object {
		return platform.O("id", row.Get("id"), "consentType", row.Get("consent_type"), "granted", row.Bool("granted"),
			"grantedAt", row.Get("granted_at"), "revokedAt", row.Get("revoked_at"))
	}), nil
}

func (h *handlers) exportUserData(ctx context.Context, userID string) (*platform.Object, error) {
	user, err := h.db.First(ctx, `SELECT id, email, username, display_name, avatar_url, bio, status,
              created_at, last_seen_at
       FROM users WHERE id = ?`, userID)
	if err != nil {
		return nil, err
	}
	prefs, err := h.db.First(ctx, "SELECT * FROM user_preferences WHERE user_id = ?", userID)
	if err != nil {
		return nil, err
	}
	msgs, err := h.db.Rows(ctx, `SELECT id, content, channel_id, recipient_id, created_at
       FROM messages WHERE sender_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	friends, err := h.db.Rows(ctx, `SELECT f.id, f.status, f.created_at,
              u.username, u.display_name
       FROM friends f
       JOIN users u ON (
         CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END = u.id
       )
       WHERE f.user_id = ? OR f.friend_id = ?`, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	servers, err := h.db.Rows(ctx, `SELECT s.id, s.name, sm.joined_at, sm.nickname
       FROM server_members sm
       JOIN servers s ON sm.server_id = s.id
       WHERE sm.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	consents, err := h.getConsents(ctx, userID)
	if err != nil {
		return nil, err
	}
	var u, p any
	if user != nil {
		u = user
	}
	if prefs != nil {
		p = prefs
	}
	return platform.O("user", u, "preferences", p, "messages", rowsAny(msgs), "friends", rowsAny(friends),
		"servers", rowsAny(servers), "consents", consents, "exportedAt", isoNow()), nil
}

func (h *handlers) requestDeletion(ctx context.Context, userID string, deleteMessages bool) (string, error) {
	scheduled := time.Now().Add(30 * 24 * time.Hour)
	existing, err := h.db.Rows(ctx, "SELECT id FROM rgpd_deletion_requests WHERE user_id = ? AND completed_at IS NULL", userID)
	if err != nil {
		return "", err
	}
	if len(existing) > 0 {
		_, err = h.db.Exec(ctx, "UPDATE rgpd_deletion_requests SET scheduled_deletion_at = ?, requested_at = NOW() WHERE user_id = ? AND completed_at IS NULL", scheduled, userID)
	} else {
		_, err = h.db.Exec(ctx, "INSERT INTO rgpd_deletion_requests (id, user_id, scheduled_deletion_at) VALUES (?, ?, ?)", newID(), userID, scheduled)
	}
	if err != nil {
		return "", err
	}
	if deleteMessages {
		// Le littéral SQL d'origine contient une apostrophe non échappée : la requête est
		// rejetée par MySQL et l'erreur ignorée — comportement conservé à l'identique.
		_, _ = h.db.Exec(ctx, `UPDATE messages SET content = '[Message supprimé par l'utilisateur]', sender_content = NULL, is_deleted = TRUE WHERE sender_id = ?`, userID)
	}
	return platform.JSDate(scheduled), nil
}

func (h *handlers) updateConsent(ctx context.Context, userID, consentType string, granted any) error {
	existing, err := h.db.Rows(ctx, "SELECT id FROM rgpd_consents WHERE user_id = ? AND consent_type = ?", userID, consentType)
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		if platform.Truthy(granted) {
			_, err = h.db.Exec(ctx, `UPDATE rgpd_consents
           SET granted = TRUE, granted_at = NOW(), revoked_at = NULL
           WHERE user_id = ? AND consent_type = ?`, userID, consentType)
		} else {
			_, err = h.db.Exec(ctx, `UPDATE rgpd_consents
           SET granted = FALSE, revoked_at = NOW()
           WHERE user_id = ? AND consent_type = ?`, userID, consentType)
		}
		return err
	}
	_, err = h.db.Exec(ctx, "INSERT INTO rgpd_consents (id, user_id, consent_type, granted, granted_at) VALUES (?, ?, ?, ?, NOW())",
		newID(), userID, consentType, platform.SQLParam(granted))
	return err
}

func (h *handlers) bestEffort(ctx context.Context, query string, args ...any) {
	if _, err := h.db.Exec(ctx, query, args...); err != nil {
		words := strings.Fields(query)
		if len(words) > 4 {
			words = words[:4]
		}
		slog.Warn("RGPD : nettoyage partiel ignoré ("+strings.Join(words, " ")+"…)", "err", err)
	}
}

func (h *handlers) anonymizeUser(ctx context.Context, userID string) error {
	anon := "deleted_" + newID()[:8]
	if _, err := h.db.Exec(ctx, `UPDATE users SET
         email = CONCAT('deleted_', id, '@anonymous.local'),
         username = ?,
         display_name = 'Utilisateur supprimé',
         avatar_url = NULL,
         banner_url = NULL,
         bio = NULL,
         custom_status = NULL,
         password_hash = 'DELETED',
         public_key = NULL,
         encrypted_private_key = NULL,
         key_salt = NULL,
         totp_secret = NULL,
         totp_enabled = FALSE,
         totp_backup_codes = NULL,
         email_verified = FALSE,
         is_online = FALSE,
         status = 'offline'
       WHERE id = ?`, anon, userID); err != nil {
		return err
	}
	h.bestEffort(ctx, `UPDATE messages SET content = '[Message supprimé]', sender_content = NULL WHERE sender_id = ?`, userID)
	h.bestEffort(ctx, `UPDATE server_messages SET content = '[Message supprimé]' WHERE sender_id = ?`, userID)
	h.bestEffort(ctx, "DELETE FROM user_preferences WHERE user_id = ?", userID)
	h.bestEffort(ctx, "DELETE FROM sessions WHERE user_id = ?", userID)
	h.bestEffort(ctx, "DELETE FROM push_subscriptions WHERE user_id = ?", userID)
	h.bestEffort(ctx, "DELETE FROM signal_key_bundles WHERE user_id = ?", userID)
	h.bestEffort(ctx, "DELETE FROM signal_one_time_prekeys WHERE user_id = ?", userID)
	h.bestEffort(ctx, "DELETE FROM friends WHERE user_id = ? OR friend_id = ?", userID, userID)
	h.bestEffort(ctx, "DELETE FROM user_archive_db_config WHERE user_id = ?", userID)
	return h.rdel(ctx, "user:"+userID)
}

// processScheduledDeletions exécute les suppressions arrivées à échéance.
func (h *handlers) processScheduledDeletions(ctx context.Context) (int, error) {
	rows, err := h.db.Rows(ctx, `SELECT user_id FROM rgpd_deletion_requests
       WHERE completed_at IS NULL AND scheduled_deletion_at <= NOW()
       ORDER BY scheduled_deletion_at ASC LIMIT 50`)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, row := range rows {
		id := row.Str("user_id")
		if err := h.anonymizeUser(ctx, id); err != nil {
			slog.Error("RGPD : suppression programmée échouée pour "+id, "err", err)
			continue
		}
		if _, err := h.db.Exec(ctx, "UPDATE rgpd_deletion_requests SET completed_at = NOW() WHERE user_id = ? AND completed_at IS NULL", id); err != nil {
			slog.Error("RGPD : suppression programmée échouée pour "+id, "err", err)
			continue
		}
		done++
	}
	return done, nil
}

// ── Routes ────────────────────────────────────────────────────────────────

// requirePassword : les actions destructrices exigent le mot de passe.
func (h *handlers) requirePassword(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pw, ok := platform.GetPath(platform.Body(r), "password").(string)
		if !ok || pw == "" {
			platform.Error(w, 400, "Mot de passe requis")
			return
		}
		row, err := h.db.First(r.Context(), "SELECT password_hash FROM users WHERE id = ?", uid(r))
		if err != nil {
			serverError(w)
			return
		}
		if row == nil || !platform.Truthy(row.Get("password_hash")) || !verifyPassword(pw, row.Str("password_hash")) {
			platform.Error(w, 403, "Mot de passe incorrect")
			return
		}
		next(w, r)
	}
}

// rgpdTarget renvoie l'identifiant ciblé (soi-même ou :userId) ; faux si une réponse a été envoyée.
func rgpdTarget(w http.ResponseWriter, r *http.Request, self bool) (string, bool) {
	if uid(r) == "" {
		platform.Error(w, 401, "Non authentifié")
		return "", false
	}
	target := uid(r)
	if !self {
		target = r.PathValue("userId")
	}
	if uid(r) != target {
		platform.Error(w, 403, "Non autorisé")
		return "", false
	}
	return target, true
}

func (h *handlers) rgpdExport(self bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := rgpdTarget(w, r, self)
		if !ok {
			return
		}
		data, err := h.exportUserData(r.Context(), userID)
		if err != nil {
			fail(w, "Erreur export données RGPD:", err)
			return
		}
		w.Header().Set("Content-Disposition", `attachment; filename="alfychat-data-`+userID+`.json"`)
		platform.JSON(w, 200, data)
	}
}

func (h *handlers) rgpdDelete(self bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := rgpdTarget(w, r, self)
		if !ok {
			return
		}
		deleteMessages := platform.Truthy(platform.GetPath(platform.Body(r), "deleteMessages"))
		at, err := h.requestDeletion(r.Context(), userID, deleteMessages)
		if err != nil {
			fail(w, "Erreur demande suppression RGPD:", err)
			return
		}
		msg := "Votre compte sera supprimé dans 30 jours. Vous pouvez annuler cette demande."
		if deleteMessages {
			msg = "Vos messages ont été supprimés. Votre compte sera définitivement effacé dans 30 jours."
		}
		platform.JSON(w, 200, platform.O("success", true, "scheduledDeletionAt", at, "messagesDeleted", deleteMessages, "message", msg))
	}
}

func (h *handlers) rgpdCancel(self bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := rgpdTarget(w, r, self)
		if !ok {
			return
		}
		if _, err := h.db.Exec(r.Context(), "DELETE FROM rgpd_deletion_requests WHERE user_id = ? AND completed_at IS NULL", userID); err != nil {
			fail(w, "Erreur annulation suppression RGPD:", err)
			return
		}
		platform.JSON(w, 200, platform.O("success", true, "message", "Demande de suppression annulée"))
	}
}

func (h *handlers) rgpdConsents(self bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := rgpdTarget(w, r, self)
		if !ok {
			return
		}
		consents, err := h.getConsents(r.Context(), userID)
		if err != nil {
			fail(w, "Erreur récupération consentements:", err)
			return
		}
		platform.JSON(w, 200, consents)
	}
}

// rgpdUpdateConsent : selfRoute=true pour PUT /consents (champ « type » recopié dans consentType).
func (h *handlers) rgpdUpdateConsent(selfRoute bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if selfRoute {
			if !validated(w, r, platform.BodyField("type").IsIn("necessary", "analytics", "marketing"), platform.BodyField("granted").IsBoolean()) {
				return
			}
			platform.Body(r).Set("consentType", field(r, "type"))
		} else if !validated(w, r, platform.BodyField("consentType").IsIn("necessary", "analytics", "marketing"), platform.BodyField("granted").IsBoolean()) {
			return
		}
		userID, ok := rgpdTarget(w, r, selfRoute)
		if !ok {
			return
		}
		ct, _ := str(field(r, "consentType"))
		if err := h.updateConsent(r.Context(), userID, ct, field(r, "granted")); err != nil {
			fail(w, "Erreur mise à jour consentement:", err)
			return
		}
		platform.JSON(w, 200, platform.O("success", true))
	}
}

func (h *handlers) rgpdAnonymize(self bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := rgpdTarget(w, r, self)
		if !ok {
			return
		}
		if err := h.anonymizeUser(r.Context(), userID); err != nil {
			fail(w, "Erreur anonymisation RGPD:", err)
			return
		}
		platform.JSON(w, 200, platform.O("success", true, "message", "Données anonymisées"))
	}
}
