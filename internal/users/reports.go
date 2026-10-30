package users

import (
	"net/http"

	"github.com/alfychat/users/internal/platform"
)

// Signalement de contenu (utilisateur ou message) — exigé par les politiques
// des stores pour tout contenu généré par les utilisateurs. Le mobile
// appelait déjà POST /api/reports ; aucun service ne le servait.

var reportReasons = []string{"spam", "harassment", "hate", "sexual", "violence", "minor_safety", "other"}

// POST /reports
func (h *handlers) apiCreateReport(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("targetType").IsIn("user", "message"),
		platform.BodyField("userId").IsUUID(),
		platform.BodyField("messageId").Optional().IsString().IsLength(1, 64),
		platform.BodyField("channelId").Optional().IsString().IsLength(1, 64),
		platform.BodyField("serverId").Optional().IsString().IsLength(1, 64),
		platform.BodyField("conversationId").Optional().IsString().IsLength(1, 128),
		platform.BodyField("content").Optional().IsString().IsLength(0, 4000),
		platform.BodyField("reason").IsIn(reportReasons...),
	) {
		return
	}
	ctx := r.Context()
	reporterID := uid(r)
	targetUserID, _ := str(field(r, "userId"))
	if targetUserID == reporterID {
		platform.Error(w, 400, "Vous ne pouvez pas vous signaler vous-même")
		return
	}

	id := newID()
	if _, err := h.db.Exec(ctx,
		`INSERT INTO content_reports
       (id, reporter_id, target_type, target_user_id, message_id, channel_id, server_id, conversation_id, reason, content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, reporterID, field(r, "targetType"), targetUserID,
		nullable(field(r, "messageId")), nullable(field(r, "channelId")), nullable(field(r, "serverId")),
		nullable(field(r, "conversationId")), field(r, "reason"), nullable(field(r, "content")),
	); err != nil {
		fail(w, "Erreur création signalement:", err)
		return
	}
	platform.JSON(w, 201, platform.O("success", true, "id", id))
}
