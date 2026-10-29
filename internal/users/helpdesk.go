// ==========================================
// ALFYCHAT - HELPDESK (staff + utilisateurs)
// ==========================================

package users

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/alfychat/users/internal/platform"
)

var (
	ticketStatuses   = []string{"open", "pending", "in_progress", "resolved", "closed"}
	ticketPriorities = []string{"low", "medium", "high", "critical"}
	ticketCategories = []string{"general", "technical", "billing", "account", "abuse", "feature", "other"}
)

func fmtTicket(r *platform.Object) *platform.Object {
	return platform.O(
		"id", r.Get("id"), "ticketNumber", r.Get("ticket_number"), "subject", r.Get("subject"), "description", r.Get("description"),
		"status", r.Get("status"), "priority", r.Get("priority"), "category", r.Get("category"), "requesterId", r.Get("requester_id"),
		"requesterName", platform.Or(r.Get("requester_name"), r.Get("requester_username"), ""),
		"requesterUsername", orDefault(r.Get("requester_username"), ""),
		"assignedTo", orDefault(r.Get("assigned_to"), nil), "assignedToName", orDefault(r.Get("assigned_to_name"), nil),
		"createdAt", r.Get("created_at"), "updatedAt", r.Get("updated_at"),
		"closedAt", orDefault(r.Get("closed_at"), nil), "resolvedAt", orDefault(r.Get("resolved_at"), nil),
		"messageCount", int64(num(r.Get("message_count"))),
	)
}

func fmtHelpMessage(r *platform.Object) *platform.Object {
	return platform.O("id", r.Get("id"), "ticketId", r.Get("ticket_id"), "authorId", r.Get("author_id"),
		"authorName", platform.Or(r.Get("author_name"), r.Get("author_username"), ""),
		"authorUsername", orDefault(r.Get("author_username"), ""), "authorRole", orDefault(r.Get("author_role"), "user"),
		"content", r.Get("content"), "isInternal", r.Bool("is_internal"), "createdAt", r.Get("created_at"))
}

type ticketFilters struct {
	status, priority, category, assignedTo, requesterID, search string
	limit, offset                                               float64
	excludeInternalCount                                        bool
}

const ticketSelect = `SELECT t.*,
        COALESCE(u.display_name, u.username) AS requester_name,
        u.username AS requester_username,
        COALESCE(a.display_name, a.username) AS assigned_to_name,`

func (h *handlers) getTickets(ctx context.Context, f ticketFilters) ([]any, error) {
	var conds []string
	var params []any
	add := func(cond string, v string) {
		if v != "" {
			conds, params = append(conds, cond), append(params, v)
		}
	}
	add("t.status = ?", f.status)
	add("t.priority = ?", f.priority)
	add("t.category = ?", f.category)
	add("t.assigned_to = ?", f.assignedTo)
	add("t.requester_id = ?", f.requesterID)
	if f.search != "" {
		conds = append(conds, "(t.subject LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)")
		like := "%" + f.search + "%"
		params = append(params, like, like, like)
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	params = append(params, platform.JSNumber(f.limit), platform.JSNumber(f.offset))
	extra := ""
	if f.excludeInternalCount {
		extra = " AND m.is_internal = FALSE"
	}
	rows, err := h.db.Rows(ctx, ticketSelect+`
        (SELECT COUNT(*) FROM helpdesk_messages m WHERE m.ticket_id = t.id`+extra+`) AS message_count
       FROM helpdesk_tickets t
       LEFT JOIN users u ON u.id = t.requester_id
       LEFT JOIN users a ON a.id = t.assigned_to
       `+where+`
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at DESC
       LIMIT ? OFFSET ?`, params...)
	if err != nil {
		return nil, err
	}
	return mapRows(rows, fmtTicket), nil
}

func (h *handlers) ticketBy(ctx context.Context, whereCol string, val any, excludeInternal bool) (*platform.Object, error) {
	extra := ""
	if excludeInternal {
		extra = " AND m.is_internal = FALSE"
	}
	r, err := h.db.First(ctx, ticketSelect+`
        (SELECT COUNT(*) FROM helpdesk_messages m WHERE m.ticket_id = t.id`+extra+`) AS message_count
       FROM helpdesk_tickets t
       LEFT JOIN users u ON u.id = t.requester_id
       LEFT JOIN users a ON a.id = t.assigned_to
       WHERE t.`+whereCol+` = ?`, val)
	if err != nil || r == nil {
		return nil, err
	}
	return fmtTicket(r), nil
}

func (h *handlers) getTicketByID(ctx context.Context, id string) (*platform.Object, error) {
	return h.ticketBy(ctx, "id", id, false)
}

func (h *handlers) getTicketByNumber(ctx context.Context, n int64) (*platform.Object, error) {
	return h.ticketBy(ctx, "ticket_number", n, true)
}

func (h *handlers) createTicket(ctx context.Context, subject, description any, priority, category string, requesterID, requesterEmail any) (*platform.Object, error) {
	id := newID()
	if _, err := h.db.Exec(ctx, "INSERT INTO helpdesk_tickets (id, subject, description, priority, category, requester_id, requester_email) VALUES (?, ?, ?, ?, ?, ?, ?)",
		id, platform.SQLParam(subject), platform.SQLParam(description), priority, category, requesterID, requesterEmail); err != nil {
		return nil, err
	}
	t, err := h.getTicketByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, errPlain("Ticket non créé")
	}
	return t, nil
}

// updateTicket : statut, priorité, catégorie, assignation, sujet (les champs absents sont ignorés).
func (h *handlers) updateTicket(ctx context.Context, id string, body *platform.Object) error {
	var updates []string
	var params []any
	if v := body.Get("status"); body.Has("status") && v != platform.Undefined {
		updates, params = append(updates, "status = ?"), append(params, platform.SQLParam(v))
		if v == "resolved" {
			updates = append(updates, "resolved_at = NOW()")
		}
		if v == "closed" {
			updates = append(updates, "closed_at = NOW()")
		}
	}
	if body.Has("priority") {
		updates, params = append(updates, "priority = ?"), append(params, platform.SQLParam(body.Get("priority")))
	}
	if body.Has("category") {
		updates, params = append(updates, "category = ?"), append(params, platform.SQLParam(body.Get("category")))
	}
	if body.Has("assignedTo") {
		a := body.Get("assignedTo")
		if a == platform.Undefined {
			a = nil
		}
		updates, params = append(updates, "assigned_to = ?"), append(params, platform.SQLParam(a))
	}
	if body.Has("subject") {
		updates, params = append(updates, "subject = ?"), append(params, platform.SQLParam(body.Get("subject")))
	}
	if len(updates) == 0 {
		return nil
	}
	params = append(params, id)
	_, err := h.db.Exec(ctx, "UPDATE helpdesk_tickets SET "+strings.Join(updates, ", ")+" WHERE id = ?", params...)
	return err
}

func (h *handlers) getHelpMessages(ctx context.Context, ticketID string, excludeInternal bool) ([]any, error) {
	extra := ""
	if excludeInternal {
		extra = " AND m.is_internal = FALSE"
	}
	rows, err := h.db.Rows(ctx, `SELECT m.*,
        COALESCE(u.display_name, u.username) AS author_name,
        u.username AS author_username,
        u.role AS author_role
       FROM helpdesk_messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = ?`+extra+`
       ORDER BY m.created_at ASC`, ticketID)
	if err != nil {
		return nil, err
	}
	return mapRows(rows, fmtHelpMessage), nil
}

func (h *handlers) addHelpMessage(ctx context.Context, ticketID, authorID string, content any, internal bool) (*platform.Object, error) {
	id := newID()
	if _, err := h.db.Exec(ctx, "INSERT INTO helpdesk_messages (id, ticket_id, author_id, content, is_internal) VALUES (?, ?, ?, ?, ?)",
		id, ticketID, authorID, platform.SQLParam(content), internal); err != nil {
		return nil, err
	}
	if _, err := h.db.Exec(ctx, `UPDATE helpdesk_tickets SET status = 'in_progress', updated_at = NOW()
       WHERE id = ? AND status = 'open'`, ticketID); err != nil {
		return nil, err
	}
	row, err := h.db.First(ctx, `SELECT m.*,
        COALESCE(u.display_name, u.username) AS author_name,
        u.username AS author_username,
        u.role AS author_role
       FROM helpdesk_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errPlain("message introuvable")
	}
	return fmtHelpMessage(row), nil
}

// ── Routes staff ──────────────────────────────────────────────────────────

func helpFail(w http.ResponseWriter, msg string, err error) {
	slog.Error(msg, "err", err)
	serverError(w)
}

func (h *handlers) apiHelpStats(w http.ResponseWriter, r *http.Request) {
	row, err := h.db.First(r.Context(), `SELECT
        COUNT(*) AS total,
        SUM(status = 'open') AS open_count,
        SUM(status = 'in_progress') AS in_progress_count,
        SUM(status = 'pending') AS pending_count,
        SUM(status = 'resolved') AS resolved_count,
        SUM(status = 'closed') AS closed_count,
        SUM(priority = 'critical' AND status NOT IN ('resolved','closed')) AS critical_count,
        SUM(assigned_to IS NULL AND status NOT IN ('resolved','closed')) AS unassigned_count,
        AVG(CASE WHEN resolved_at IS NOT NULL
          THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) ELSE NULL END) AS avg_resolution_hours
       FROM helpdesk_tickets`)
	if err != nil {
		helpFail(w, "helpdesk stats error:", err)
		return
	}
	n := func(k string) int64 { return int64(num(row.Get(k))) }
	var avg any
	if v := row.Get("avg_resolution_hours"); v != nil {
		avg = math.Round(num(v)*10) / 10
	}
	platform.JSON(w, 200, platform.O("total", n("total"), "open", n("open_count"), "inProgress", n("in_progress_count"),
		"pending", n("pending_count"), "resolved", n("resolved_count"), "closed", n("closed_count"),
		"critical", n("critical_count"), "unassigned", n("unassigned_count"), "avgResolutionHours", avg))
}

func (h *handlers) apiHelpAgents(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Rows(r.Context(), `SELECT id, username, COALESCE(display_name, username) AS display_name, role, avatar_url, is_online
       FROM users
       WHERE role IN ('admin', 'support_l1', 'support_l2', 'technician', 'moderator')
       ORDER BY
         CASE role WHEN 'admin' THEN 0 WHEN 'technician' THEN 1 WHEN 'support_l2' THEN 2 WHEN 'support_l1' THEN 3 ELSE 4 END,
         username ASC`)
	if err != nil {
		helpFail(w, "helpdesk agents error:", err)
		return
	}
	platform.JSON(w, 200, rowsAny(rows))
}

func (h *handlers) apiHelpTickets(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.QueryField("status").Optional().IsIn(ticketStatuses...),
		platform.QueryField("priority").Optional().IsIn(ticketPriorities...),
		platform.QueryField("category").Optional().IsIn(ticketCategories...),
		platform.QueryField("assignedTo").Optional().IsString(),
		platform.QueryField("search").Optional().IsString().IsLength(0, 100),
		platform.QueryField("limit").Optional().IsInt(platform.MinMax(1, 200)),
		platform.QueryField("offset").Optional().IsInt(platform.Min(0)),
	) {
		return
	}
	q := platform.Query(r)
	s := func(k string) string { v, _ := q.Get(k).(string); return v }
	f := ticketFilters{status: s("status"), priority: s("priority"), category: s("category"), assignedTo: s("assignedTo"), search: s("search"), limit: 50}
	if platform.Truthy(q.Get("limit")) {
		f.limit = platform.ToNumber(q.Get("limit"))
	}
	if platform.Truthy(q.Get("offset")) {
		f.offset = platform.ToNumber(q.Get("offset"))
	}
	tickets, err := h.getTickets(r.Context(), f)
	if err != nil {
		helpFail(w, "helpdesk list error:", err)
		return
	}
	platform.JSON(w, 200, tickets)
}

func (h *handlers) apiHelpCreateTicket(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("subject").IsString().IsLength(3, 255),
		platform.BodyField("description").IsString().IsLength(10, -1),
		platform.BodyField("priority").Optional().IsIn(ticketPriorities...),
		platform.BodyField("category").Optional().IsIn(ticketCategories...),
		platform.BodyField("requesterId").Optional().IsString(),
	) {
		return
	}
	priority, category := "medium", "general"
	if p, ok := field(r, "priority").(string); ok && p != "" {
		priority = p
	}
	if c, ok := field(r, "category").(string); ok && c != "" {
		category = c
	}
	requester := platform.Or(field(r, "requesterId"), uid(r))
	t, err := h.createTicket(r.Context(), field(r, "subject"), field(r, "description"), priority, category, platform.SQLParam(requester), nil)
	if err != nil {
		helpFail(w, "helpdesk create error:", err)
		return
	}
	platform.JSON(w, 201, t)
}

func (h *handlers) apiHelpTicket(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.ParamField("id").IsUUID()) {
		return
	}
	t, err := h.getTicketByID(r.Context(), r.PathValue("id"))
	if err != nil {
		helpFail(w, "helpdesk get error:", err)
		return
	}
	if t == nil {
		platform.Error(w, 404, "Ticket non trouvé")
		return
	}
	platform.JSON(w, 200, t)
}

func (h *handlers) apiHelpUpdateTicket(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.ParamField("id").IsUUID(),
		platform.BodyField("status").Optional().IsIn(ticketStatuses...),
		platform.BodyField("priority").Optional().IsIn(ticketPriorities...),
		platform.BodyField("category").Optional().IsIn(ticketCategories...),
		platform.BodyField("assignedTo").OptionalNullable(),
		platform.BodyField("subject").Optional().IsString().IsLength(3, 255),
	) {
		return
	}
	ctx := r.Context()
	id := r.PathValue("id")
	// Seuls les champs reconnus sont repris du corps.
	in := platform.Body(r)
	sel := platform.O()
	for _, k := range []string{"status", "priority", "category", "assignedTo", "subject"} {
		if in.Has(k) {
			sel.Set(k, in.Get(k))
		}
	}
	if err := h.updateTicket(ctx, id, sel); err != nil {
		helpFail(w, "helpdesk update error:", err)
		return
	}
	t, err := h.getTicketByID(ctx, id)
	if err != nil {
		helpFail(w, "helpdesk update error:", err)
		return
	}
	platform.JSON(w, 200, t)
}

func (h *handlers) apiHelpDeleteTicket(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.ParamField("id").IsUUID()) {
		return
	}
	if userRole(r) != "admin" {
		platform.Error(w, 403, "Réservé aux administrateurs")
		return
	}
	if _, err := h.db.Exec(r.Context(), "DELETE FROM helpdesk_tickets WHERE id = ?", r.PathValue("id")); err != nil {
		helpFail(w, "helpdesk delete error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true))
}

func (h *handlers) apiHelpMessages(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.ParamField("id").IsUUID()) {
		return
	}
	ctx := r.Context()
	t, err := h.getTicketByID(ctx, r.PathValue("id"))
	if err != nil {
		helpFail(w, "helpdesk messages error:", err)
		return
	}
	if t == nil {
		platform.Error(w, 404, "Ticket non trouvé")
		return
	}
	msgs, err := h.getHelpMessages(ctx, r.PathValue("id"), false)
	if err != nil {
		helpFail(w, "helpdesk messages error:", err)
		return
	}
	platform.JSON(w, 200, msgs)
}

func (h *handlers) apiHelpAddMessage(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.ParamField("id").IsUUID(),
		platform.BodyField("content").IsString().IsLength(1, 5000),
		platform.BodyField("isInternal").Optional().IsBoolean(),
	) {
		return
	}
	ctx := r.Context()
	t, err := h.getTicketByID(ctx, r.PathValue("id"))
	if err != nil {
		helpFail(w, "helpdesk add message error:", err)
		return
	}
	if t == nil {
		platform.Error(w, 404, "Ticket non trouvé")
		return
	}
	internal := false
	if v := field(r, "isInternal"); !undef(v) && v != nil {
		internal = platform.Truthy(v)
	}
	msg, err := h.addHelpMessage(ctx, r.PathValue("id"), uid(r), field(r, "content"), internal)
	if err != nil {
		helpFail(w, "helpdesk add message error:", err)
		return
	}
	platform.JSON(w, 201, msg)
}

// ── Routes publiques (utilisateurs) ───────────────────────────────────────

var categoryMap = map[string]string{
	"general": "general", "account": "account", "security": "account", "billing": "billing",
	"bug": "technical", "abuse": "abuse", "server": "technical", "feature": "feature", "other": "other",
}

var categoryLabels = map[string]string{
	"general": "Question générale", "technical": "Technique", "billing": "Facturation",
	"account": "Compte", "abuse": "Signalement", "feature": "Suggestion", "other": "Autre",
}

func pubFail(w http.ResponseWriter, msg string, err error) {
	slog.Error(msg, "err", err)
	platform.JSON(w, 500, platform.O("success", false, "error", "Erreur serveur"))
}

func pubErr(w http.ResponseWriter, status int, msg string) {
	platform.JSON(w, status, platform.O("success", false, "error", msg))
}

// guestQuotaOK borne les tickets créés sans compte (par IP et par adresse).
func (h *handlers) guestQuotaOK(ctx context.Context, ip, email string) bool {
	type quota struct {
		key      string
		max, ttl int
	}
	for _, q := range []quota{
		{"helpdesk:guest:ip:" + ip, 3, 3600},
		{"helpdesk:guest:mail:" + strings.ToLower(email), 3, 86400},
	} {
		v, err := h.rget(ctx, q.key)
		if err != nil {
			return false
		}
		n := int(num(v))
		if n >= q.max {
			return false
		}
		if h.rset(ctx, q.key, strconv.Itoa(n+1), q.ttl) != nil {
			return false
		}
	}
	return true
}

func (h *handlers) apiPubCreateTicket(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("subject").IsString().Trim().IsLength(3, 255),
		platform.BodyField("description").IsString().Trim().IsLength(10, 4000),
		platform.BodyField("priority").Optional().IsIn(ticketPriorities...),
		platform.BodyField("category").Optional().IsString(),
		platform.BodyField("email").Optional().IsEmail().NormalizeEmail(),
	) {
		return
	}
	ctx := r.Context()
	userID := ""
	if header := r.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		if claims, err := h.verifyJWT(header[7:], h.jwtSecret); err == nil {
			if t, ok := claims["type"]; !ok || !platform.Truthy(t) || t == "access" {
				userID, _ = claims["userId"].(string)
			}
		}
	}
	category := field(r, "category")
	email := field(r, "email")
	internalCategory := "general"
	if platform.Truthy(category) {
		if m, ok := categoryMap[platform.JSString(category)]; ok {
			internalCategory = m
		}
	}
	internalPriority := "medium"
	if p, ok := field(r, "priority").(string); ok && containsStr(ticketPriorities, p) {
		internalPriority = p
	}
	if userID == "" {
		cs := ""
		if s, ok := category.(string); ok {
			cs = s
		}
		if cs != "account" && cs != "security" {
			pubErr(w, 401, "Connexion requise pour cette catégorie")
			return
		}
		if !platform.Truthy(email) {
			pubErr(w, 400, "Un email est requis pour les demandes liées à votre compte")
			return
		}
		enabled, err := h.isTurnstileEnabled(ctx)
		if err != nil {
			pubFail(w, "public helpdesk create ticket error:", err)
			return
		}
		if enabled {
			token := field(r, "turnstileToken")
			if !platform.Truthy(token) || !verifyTurnstileToken(ctx, platform.JSString(token)) {
				pubErr(w, 400, "Vérification captcha échouée")
				return
			}
		}
		if !h.guestQuotaOK(ctx, h.clientIP(r), platform.JSString(email)) {
			pubErr(w, 429, "Trop de demandes, réessayez plus tard")
			return
		}
	}
	var requester, reqEmail any
	if userID != "" {
		requester = userID
	} else {
		reqEmail = platform.SQLParam(email)
	}
	subject, description := field(r, "subject"), field(r, "description")
	ticket, err := h.createTicket(ctx, subject, description, internalPriority, internalCategory, requester, reqEmail)
	if err != nil {
		pubFail(w, "public helpdesk create ticket error:", err)
		return
	}
	who := userID
	if who == "" {
		who = platform.JSString(email)
	}
	slog.Info("Public ticket created #" + platform.JSString(ticket.Get("ticketNumber")) + " by " + who)

	label := categoryLabels[internalCategory]
	recipient := ""
	if userID == "" {
		recipient = platform.JSString(orDefault(email, ""))
	} else if u, err := h.findByID(ctx, userID); err == nil && u != nil {
		if e, ok := u.Get("email").(string); ok {
			recipient = e
		}
	}
	if recipient != "" {
		number := int64(num(ticket.Get("ticketNumber")))
		go h.mail.sendTicketConfirmation(recipient, number, platform.JSString(subject), label)
	}
	platform.JSON(w, 201, platform.O("success", true, "data", platform.O("ticketNumber", ticket.Get("ticketNumber"))))
}

func (h *handlers) apiPubListTickets(w http.ResponseWriter, r *http.Request) {
	if uid(r) == "" {
		pubErr(w, 401, "Non connecté")
		return
	}
	tickets, err := h.getTickets(r.Context(), ticketFilters{requesterID: uid(r), limit: 20, excludeInternalCount: true})
	if err != nil {
		pubFail(w, "public helpdesk list tickets error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", tickets))
}

// ownTicket charge le ticket par numéro et vérifie la propriété ; faux si une réponse a été envoyée.
func (h *handlers) ownTicket(w http.ResponseWriter, r *http.Request) (*platform.Object, bool) {
	if uid(r) == "" {
		pubErr(w, 401, "Non connecté")
		return nil, false
	}
	n := platform.JSParseInt(r.PathValue("number"))
	if math.IsNaN(n) {
		pubErr(w, 400, "Numéro invalide")
		return nil, false
	}
	t, err := h.getTicketByNumber(r.Context(), int64(n))
	if err != nil {
		pubFail(w, "public helpdesk get ticket error:", err)
		return nil, false
	}
	if t == nil {
		pubErr(w, 404, "Ticket non trouvé")
		return nil, false
	}
	if t.Get("requesterId") != uid(r) {
		pubErr(w, 403, "Accès refusé")
		return nil, false
	}
	return t, true
}

func (h *handlers) apiPubGetTicket(w http.ResponseWriter, r *http.Request) {
	t, ok := h.ownTicket(w, r)
	if !ok {
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", t))
}

func (h *handlers) apiPubGetMessages(w http.ResponseWriter, r *http.Request) {
	t, ok := h.ownTicket(w, r)
	if !ok {
		return
	}
	msgs, err := h.getHelpMessages(r.Context(), t.Str("id"), true)
	if err != nil {
		pubFail(w, "public helpdesk get messages error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", msgs))
}

func (h *handlers) apiPubAddMessage(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r, platform.BodyField("content").IsString().Trim().IsLength(1, 5000)) {
		return
	}
	t, ok := h.ownTicket(w, r)
	if !ok {
		return
	}
	if t.Get("status") == "closed" {
		pubErr(w, 400, "Ce ticket est fermé. Ouvrez un nouveau ticket.")
		return
	}
	ctx := r.Context()
	msg, err := h.addHelpMessage(ctx, t.Str("id"), uid(r), field(r, "content"), false)
	if err != nil {
		pubFail(w, "public helpdesk add message error:", err)
		return
	}
	if t.Get("status") == "resolved" {
		if err := h.updateTicket(ctx, t.Str("id"), platform.O("status", "open")); err != nil {
			pubFail(w, "public helpdesk add message error:", err)
			return
		}
	}
	platform.JSON(w, 201, platform.O("success", true, "data", msg))
}
