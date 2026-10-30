// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// Authentification, préférences, RGPD
// Routes enregistrées dans l'ordre exact des montages Express d'origine.
// ==========================================

package users

import (
	"context"
	_ "embed"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/alfychat/users/internal/platform"
	"github.com/redis/go-redis/v9"
)

//go:embed migrations.json
var migrationsJSON []byte

// Migrate applique le schéma : les CREATE/INSERT sont fatals, les ALTER/UPDATE sont tolérés.
func Migrate(ctx context.Context, db *platform.DB) error {
	parsed, err := platform.ParseJSON(migrationsJSON)
	if err != nil {
		return err
	}
	privacyDone := false
	for _, item := range parsed.([]any) {
		stmt := item.(*platform.Object)
		query := stmt.Str("sql")
		var args []any
		if ps, ok := stmt.Get("params").([]any); ok {
			args = make([]any, len(ps))
			for i, p := range ps {
				args[i] = platform.SQLParam(p)
			}
		}
		group := stmt.Str("group")
		if group == "privacy_dm" {
			// Migration « une seule fois », protégée par un marqueur dans site_settings.
			if !privacyDone {
				privacyDone = true
				row, err := db.First(ctx, "SELECT setting_value FROM site_settings WHERE setting_key = 'migration_privacy_dm_v2'")
				if err != nil || row != nil {
					skipPrivacy = true
				}
			}
			if skipPrivacy {
				continue
			}
			if _, err := db.Exec(ctx, query, args...); err != nil {
				skipPrivacy = true // le reste du bloc est rejoué au prochain démarrage
			}
			continue
		}
		if _, err := db.Exec(ctx, query, args...); err != nil {
			head := strings.ToUpper(strings.TrimSpace(query))
			if strings.HasPrefix(head, "ALTER") || strings.HasPrefix(head, "UPDATE") {
				continue
			}
			return err
		}
	}
	return nil
}

var skipPrivacy bool

// Register déclare toutes les routes du service.
func Register(srv *platform.Server, db *platform.DB, rdb *redis.Client, auth *platform.Auth) *Service {
	h := &handlers{srv: srv, db: db, rdb: rdb, auth: auth,
		jwtSecret: []byte(platform.MustEnv("JWT_SECRET")), jwtRefreshSecret: []byte(platform.MustEnv("JWT_REFRESH_SECRET"))}
	srv.Mount("/users")
	srv.Mount("/auth")
	srv.Mount("/rgpd")
	srv.Mount("/admin")
	srv.Mount("/helpdesk")
	srv.Mount("/push")

	a := h.requireAuth
	opt := h.optionalAuth
	admin := h.adminOnly
	staff := h.staffOnly
	route := func(pattern string, handler http.HandlerFunc, mws ...mw) {
		srv.Handle(pattern, chain(handler, mws...))
	}

	// Limiteur global de /auth (100 requêtes / 15 min par IP réelle), hors /auth/remote/*.
	authLimiter := newLimiter(15*time.Minute, 100, "Trop de requêtes, réessayez plus tard", h.clientIP,
		func(r *http.Request) bool { return strings.HasPrefix(strings.ToLower(r.URL.Path), "/auth/remote/") })
	srv.Use(func(w http.ResponseWriter, r *http.Request) bool {
		p := strings.ToLower(r.URL.Path)
		if p == "/auth" || strings.HasPrefix(p, "/auth/") {
			return authLimiter.allow(w, r)
		}
		return true
	})
	remoteInit := newLimiter(5*time.Minute, 20, "Trop de codes générés, patientez un instant", reqIP, nil)
	remotePoll := newLimiter(5*time.Minute, 400, "Trop de requêtes", reqIP, nil)

	// ── /users ──
	route("GET /users/changelogs", h.apiChangelogs)
	route("GET /users/links/{slug}", h.apiShortLink)
	route("GET /users/me", h.apiMe, a)
	route("PATCH /users/me", h.apiUpdateOwnProfile, a)
	route("GET /users/search", h.apiSearchUsers, a)
	route("GET /users/batch", h.apiBatchUsers, a)
	route("GET /users/check-username/{username}", h.apiCheckUsername)
	route("GET /users/{userId}/public-key", h.apiPublicKey, a)
	route("GET /users/{userId}", h.apiGetUser, opt)
	route("PATCH /users/{userId}", h.apiUpdateProfile, a)
	route("PATCH /users/{userId}/status", h.apiUpdateStatus, a)
	route("PATCH /users/{userId}/custom-status", h.apiUpdateCustomStatus, a)
	route("PATCH /users/{userId}/last-seen", h.apiLastSeen, a)
	route("GET /users/{userId}/preferences", h.apiGetPreferences, a)
	route("PATCH /users/{userId}/preferences", h.apiUpdatePreferences, a)
	route("POST /users/{userId}/change-password", h.apiChangePassword, a)
	route("POST /users/{userId}/change-username", h.apiChangeUsername, a)
	route("GET /users/{userId}/badges", h.apiGetBadges)
	route("POST /users/{userId}/badges", h.apiAddBadge, a)
	route("DELETE /users/{userId}/badges/{badgeId}", h.apiRemoveBadge, a)
	route("PATCH /users/{userId}/badges/visibility", h.apiToggleBadges, a)
	route("PATCH /users/{userId}/music-presence", h.apiMusicPresence, a)
	route("PATCH /users/{userId}/profile-card", h.apiProfileCard, a)
	route("GET /users/me/favorites", h.apiGetFavorites, a)
	route("POST /users/me/favorites", h.apiAddFavorite, a)
	route("DELETE /users/me/favorites/{id}", h.apiRemoveFavorite, a)
	route("PATCH /users/me/favorites/reorder", h.apiReorderFavorites, a)
	route("GET /users/me/hidden-from", h.apiHiddenFrom, a)
	route("POST /users/me/hide-activity/{targetUserId}", h.apiHideActivity, a)
	route("DELETE /users/me/hide-activity/{targetUserId}", h.apiShowActivity, a)
	route("GET /users/me/pinned-conversations", h.apiGetPinned, a)
	route("POST /users/me/pinned-conversations/{conversationId}", h.apiPin, a)
	route("DELETE /users/me/pinned-conversations/{conversationId}", h.apiUnpin, a)

	// ── /auth ──
	route("GET /auth/register/settings", h.apiRegisterSettings)
	route("POST /auth/register", h.apiRegister)
	route("POST /auth/login", h.apiLogin)
	route("POST /auth/2fa/login", h.apiLoginWith2FA)
	route("POST /auth/refresh", h.apiRefresh)
	route("POST /auth/logout", h.apiLogout, a)
	route("POST /auth/logout-all", h.apiLogoutAll, a)
	route("GET /auth/verify", h.apiVerify, a)
	route("POST /auth/remote/init", h.apiRemoteInit, remoteInit.wrap)
	route("GET /auth/remote/poll", h.apiRemotePoll, remotePoll.wrap)
	route("POST /auth/remote/claim", h.apiRemoteClaim, a)
	route("POST /auth/remote/approve", h.apiRemoteApprove, a)
	route("POST /auth/remote/deny", h.apiRemoteDeny, a)
	route("POST /auth/sso/code", h.apiSsoCode, a)
	route("POST /auth/sso/exchange", h.apiSsoExchange, remoteInit.wrap)
	route("GET /auth/verify-email", h.apiVerifyEmail)
	route("POST /auth/resend-verification", h.apiResendVerification, a)
	route("POST /auth/resend-verification-email", h.apiResendVerificationByEmail)
	route("POST /auth/forgot-password", h.apiForgotPassword)
	route("POST /auth/reset-password", h.apiResetPassword)
	route("GET /auth/2fa/status", h.apiGet2FAStatus, a)
	route("POST /auth/2fa/setup", h.apiSetup2FA, a)
	route("POST /auth/2fa/enable", h.apiEnable2FA, a)
	route("POST /auth/2fa/disable", h.apiDisable2FA, a)
	route("GET /auth/keys", h.apiGetKeys, a)
	// Signalements de contenu (mobile) — voir reports.go.
	route("POST /reports", h.apiCreateReport, a)
	route("PATCH /auth/keys", h.apiSaveKeys, a)
	route("GET /auth/me", h.apiMe, a)
	route("GET /auth/sessions", h.apiSessions, a)
	route("DELETE /auth/sessions/{id}", h.apiRevokeSession, a)

	// ── /rgpd (authentification exigée sur tout le préfixe) ──
	pw := h.requirePassword
	route("GET /rgpd/export", h.rgpdExport(true), a)
	route("POST /rgpd/export", h.rgpdExport(true), a)
	route("POST /rgpd/delete", h.rgpdDelete(true), a, pw)
	route("DELETE /rgpd/delete", h.rgpdCancel(true), a)
	route("GET /rgpd/consents", h.rgpdConsents(true), a)
	route("PUT /rgpd/consents", h.rgpdUpdateConsent(true), a)
	route("POST /rgpd/anonymize", h.rgpdAnonymize(true), a, pw)
	route("GET /rgpd/{userId}/export", h.rgpdExport(false), a)
	route("POST /rgpd/{userId}/delete", h.rgpdDelete(false), a, pw)
	route("DELETE /rgpd/{userId}/delete", h.rgpdCancel(false), a)
	route("GET /rgpd/{userId}/consents", h.rgpdConsents(false), a)
	route("PATCH /rgpd/{userId}/consents", h.rgpdUpdateConsent(false), a)
	route("POST /rgpd/{userId}/anonymize", h.rgpdAnonymize(false), a, pw)
	route("ALL /rgpd", h.notFound, a)
	route("ALL /rgpd/{rest...}", h.notFound, a)

	// ── /admin/moderation (staff) ──
	route("GET /admin/moderation/stats", h.apiModStats, a, staff)
	route("GET /admin/moderation/sanctions", h.apiModListSanctions, a, staff)
	route("GET /admin/moderation/users/{userId}", h.apiModUser, a, staff)
	route("POST /admin/moderation/users/{userId}/sanctions", h.apiModCreateSanction, a, staff)
	route("DELETE /admin/moderation/sanctions/{sanctionId}", h.apiModRevokeSanction, a, staff)
	route("POST /admin/moderation/users/{userId}/unban", h.modLift("ban", "Débannissement", "Erreur débannissement:", true), a, staff)
	route("POST /admin/moderation/users/{userId}/unmute", h.modLift("mute", "", "Erreur démute:", false), a, staff)
	route("GET /admin/moderation/terms", h.apiModListTerms, a, staff)
	route("POST /admin/moderation/terms", h.apiModAddTerm, a, staff)
	route("DELETE /admin/moderation/terms/{termId}", h.apiModDeleteTerm, a, staff)

	// ── /admin/dev (admin) ──
	route("GET /admin/dev/emails/types", h.apiEmailTypes, a, admin)
	route("GET /admin/dev/emails/{type}/preview", h.apiEmailPreview, a, admin)
	route("POST /admin/dev/emails/{type}/send", h.apiEmailSend, a, admin)

	// ── /admin (admin) ──
	route("GET /admin/stats", h.apiAdminStats, a, admin)
	route("GET /admin/badges", h.apiAdminBadges, a, admin)
	route("POST /admin/badges", h.apiAdminCreateBadge, a, admin)
	route("PATCH /admin/badges/{badgeId}", h.apiAdminUpdateBadge, a, admin)
	route("PATCH /admin/badges/{badgeId}/status", h.apiAdminBadgeStatus, a, admin)
	route("DELETE /admin/badges/{badgeId}", h.apiAdminDeleteBadge, a, admin)
	route("POST /admin/users/{userId}/badges/{badgeId}", h.apiAdminAssignBadge, a, admin)
	route("DELETE /admin/users/{userId}/badges/{badgeId}", h.apiAdminRemoveUserBadge, a, admin)
	route("GET /admin/users", h.apiAdminUsers, a, admin)
	route("GET /admin/users/search", h.apiAdminSearchUsers, a, admin)
	route("PATCH /admin/users/{userId}/role", h.apiAdminUpdateRole, a, admin)
	route("GET /admin/settings", h.apiAdminSettings, a, admin)
	route("PUT /admin/settings", h.apiAdminUpdateSetting, a, admin)
	route("POST /admin/invite-links", h.apiAdminCreateInvite, a, admin)
	route("GET /admin/invite-links", h.apiAdminInvites, a, admin)
	route("DELETE /admin/invite-links/{linkId}", h.apiAdminDeleteInvite, a, admin)
	route("GET /admin/changelogs", h.apiAdminChangelogs, a, admin)
	route("POST /admin/changelogs", h.apiAdminCreateChangelog, a, admin)
	route("PATCH /admin/changelogs/{changelogId}", h.apiAdminUpdateChangelog, a, admin)
	route("DELETE /admin/changelogs/{changelogId}", h.apiAdminDeleteChangelog, a, admin)
	route("GET /admin/short-links", h.apiAdminShortLinks, a, admin)
	route("POST /admin/short-links", h.apiAdminCreateShortLink, a, admin)
	route("PATCH /admin/short-links/{slug}", h.apiAdminUpdateShortLink, a, admin)
	route("DELETE /admin/short-links/{slug}", h.apiAdminDeleteShortLink, a, admin)

	// ── /users/keys ──
	route("GET /users/keys/status", h.apiKeysStatus, a)
	route("PUT /users/keys", h.apiKeysPublish, a)
	route("POST /users/keys/prekeys", h.apiKeysAddPrekeys, a)
	route("POST /users/keys/ecdh/batch", h.apiKeysEcdhBatch, a)
	route("PATCH /users/keys/ecdh", h.apiKeysUpdateEcdh, a)
	route("PUT /users/keys/private-bundle", h.apiKeysUploadPrivate, a)
	route("GET /users/keys/private-bundle", h.apiKeysDownloadPrivate, a)
	route("GET /users/keys/{userId}", h.apiKeysGetBundle, a)

	// ── /helpdesk/public ──
	route("POST /helpdesk/public/tickets", h.apiPubCreateTicket)
	route("GET /helpdesk/public/tickets", h.apiPubListTickets, a)
	route("GET /helpdesk/public/tickets/{number}", h.apiPubGetTicket, a)
	route("GET /helpdesk/public/tickets/{number}/messages", h.apiPubGetMessages, a)
	route("POST /helpdesk/public/tickets/{number}/messages", h.apiPubAddMessage, a)

	// ── /helpdesk (staff) ──
	route("GET /helpdesk/stats", h.apiHelpStats, a, staff)
	route("GET /helpdesk/agents", h.apiHelpAgents, a, staff)
	route("GET /helpdesk/tickets", h.apiHelpTickets, a, staff)
	route("POST /helpdesk/tickets", h.apiHelpCreateTicket, a, staff)
	route("GET /helpdesk/tickets/{id}", h.apiHelpTicket, a, staff)
	route("PATCH /helpdesk/tickets/{id}", h.apiHelpUpdateTicket, a, staff)
	route("DELETE /helpdesk/tickets/{id}", h.apiHelpDeleteTicket, a, staff)
	route("GET /helpdesk/tickets/{id}/messages", h.apiHelpMessages, a, staff)
	route("POST /helpdesk/tickets/{id}/messages", h.apiHelpAddMessage, a, staff)
	route("ALL /helpdesk", h.notFound, a, staff)
	route("ALL /helpdesk/{rest...}", h.notFound, a, staff)

	// ── /users/support (public) ──
	route("GET /users/support/categories", h.apiSupportCategories)
	route("GET /users/support/categories/{slug}", h.apiSupportCategory)
	route("GET /users/support/articles/popular", h.apiSupportPopular)
	route("GET /users/support/articles/{slug}", h.apiSupportArticle)
	route("GET /users/support/announcements", h.apiSupportAnnouncements)
	route("GET /users/support/known-issues", h.apiSupportKnownIssues)

	// ── /admin/support : traverse d'abord adminRouter.use(auth, admin), puis son propre use(auth, admin) ──
	catField := [][2]string{{"slug", "slug"}, {"title", "title"}, {"description", "description"}, {"iconName", "icon_name"},
		{"color", "color"}, {"sortOrder", "sort_order"}, {"isActive", "is_active"}}
	artField := [][2]string{{"categoryId", "category_id"}, {"slug", "slug"}, {"title", "title"}, {"summary", "summary"},
		{"content", "content"}, {"tags", "tags"}, {"isPublished", "is_published"}, {"isPinned", "is_pinned"}, {"sortOrder", "sort_order"}}
	annField := [][2]string{{"type", "type"}, {"title", "title"}, {"summary", "summary"}, {"content", "content"},
		{"isResolved", "is_resolved"}, {"isPublished", "is_published"}}
	issueField := [][2]string{{"title", "title"}, {"description", "description"}, {"status", "status"}, {"categoryLabel", "category_label"}}
	tagsJSON := map[string]func(any) any{"tags": func(v any) any { return platform.JSONString(v) }}
	route("GET /admin/support/categories", h.apiAdminSupportCategories, a, admin)
	route("POST /admin/support/categories", h.apiAdminCreateCategory, a, admin)
	route("PATCH /admin/support/categories/{id}", h.apiAdminSupportUpdate("support_categories", catField, nil, "admin support update category:"), a, admin)
	route("DELETE /admin/support/categories/{id}", h.apiAdminSupportDelete("support_categories", "admin support delete category:"), a, admin)
	route("GET /admin/support/articles", h.apiAdminSupportArticles, a, admin)
	route("POST /admin/support/articles", h.apiAdminCreateArticle, a, admin)
	route("PATCH /admin/support/articles/{id}", h.apiAdminSupportUpdate("support_articles", artField, tagsJSON, "admin support update article:"), a, admin)
	route("DELETE /admin/support/articles/{id}", h.apiAdminSupportDelete("support_articles", "admin support delete article:"), a, admin)
	route("GET /admin/support/announcements", h.apiAdminAnnouncements, a, admin)
	route("POST /admin/support/announcements", h.apiAdminCreateAnnouncement, a, admin)
	route("PATCH /admin/support/announcements/{id}", h.apiAdminSupportUpdate("support_announcements", annField, nil, "admin support update announcement:"), a, admin)
	route("DELETE /admin/support/announcements/{id}", h.apiAdminSupportDelete("support_announcements", "admin support delete announcement:"), a, admin)
	route("GET /admin/support/known-issues", h.apiAdminKnownIssues, a, admin)
	route("POST /admin/support/known-issues", h.apiAdminCreateKnownIssue, a, admin)
	route("PATCH /admin/support/known-issues/{id}", h.apiAdminSupportUpdate("support_known_issues", issueField, nil, "admin support update known-issue:"), a, admin)
	route("DELETE /admin/support/known-issues/{id}", h.apiAdminSupportDelete("support_known_issues", "admin support delete known-issue:"), a, admin)

	// Tout autre chemin /admin/** traverse les middlewares de montage avant le 404 final.
	adminCatchAll := func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(strings.ToLower(r.URL.Path), "/admin/moderation") {
			chain(h.notFound, a, staff, a, admin)(w, r)
			return
		}
		chain(h.notFound, a, admin)(w, r)
	}
	srv.Handle("ALL /admin", adminCatchAll)
	srv.Handle("ALL /admin/{rest...}", adminCatchAll)

	// ── /push et /users/push ──
	for _, prefix := range []string{"/push", "/users/push"} {
		route("POST "+prefix+"/subscribe", h.apiPushSubscribe, a)
		route("DELETE "+prefix+"/subscribe", h.apiPushUnsubscribe, a)
		route("GET "+prefix+"/subscriptions/{userId}", h.apiPushSubscriptions)
		route("POST "+prefix+"/expo-subscribe", h.apiPushExpoSubscribe, a)
		route("POST "+prefix+"/send", h.apiPushSend)
	}

	// ── Internes ──
	srv.Handle("GET /internal/stats", h.apiInternalStats)
	srv.Handle("GET /internal/moderation/{userId}", h.apiInternalModeration)

	srv.Handle("GET /health", func(w http.ResponseWriter, r *http.Request) {
		platform.JSON(w, 200, platform.O("status", "ok", "service", "users"))
	})
	srv.Handle("GET /metrics", func(w http.ResponseWriter, r *http.Request) {
		body := platform.O("service", "users", "serviceId", platform.Env("SERVICE_ID", "users-default"),
			"location", strings.ToUpper(platform.Env("SERVICE_LOCATION", "EU")))
		m := platform.CollectServiceMetrics()
		for _, k := range m.Keys() {
			body.Set(k, m.Get(k))
		}
		body.Set("uptime", platform.Uptime())
		platform.JSON(w, 200, body)
	})
	return &Service{h: h}
}

// notFound répond comme le dernier middleware de l'application.
func (h *handlers) notFound(w http.ResponseWriter, r *http.Request) { h.srv.NotFound(w, r) }

func (h *handlers) apiInternalStats(w http.ResponseWriter, r *http.Request) {
	if !h.auth.IsInternal(r) {
		platform.Error(w, 401, "Non autorisé")
		return
	}
	ctx := r.Context()
	total, err := h.db.First(ctx, "SELECT COUNT(*) as count FROM users")
	if err != nil {
		serverError(w)
		return
	}
	online, err := h.db.First(ctx, "SELECT COUNT(*) as count FROM users WHERE is_online = TRUE")
	if err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, platform.O("totalUsers", total.Get("count"), "onlineUsers", online.Get("count")))
}

func (h *handlers) apiInternalModeration(w http.ResponseWriter, r *http.Request) {
	if !h.auth.IsInternal(r) {
		platform.Error(w, 401, "Non autorisé")
		return
	}
	st, err := h.getModStatus(r.Context(), r.PathValue("userId"))
	if err != nil {
		serverError(w)
		return
	}
	platform.JSON(w, 200, st.object())
}

// Service expose les tâches de fond.
type Service struct{ h *handlers }

// Start charge les termes interdits et lance le traitement horaire des suppressions RGPD.
func (s *Service) Start(ctx context.Context) {
	s.h.reloadTerms(ctx)
	run := func() {
		n, err := s.h.processScheduledDeletions(context.Background())
		if err != nil {
			slog.Error("RGPD : échec du traitement des suppressions programmées", "err", err)
			return
		}
		if n > 0 {
			slog.Info("RGPD : " + itoa(n) + " compte(s) supprimé(s) à échéance")
		}
	}
	go func() {
		time.Sleep(60 * time.Second)
		run()
		for range time.Tick(time.Hour) {
			run()
		}
	}()
}
