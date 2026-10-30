// ==========================================
// ALFYCHAT - CENTRE D'AIDE (public + admin)
// ==========================================

package users

import (
	"context"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strings"

	"github.com/alfychat/users/internal/platform"
)

var hexColorAnyRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func orDefault(v any, def any) any {
	if platform.Truthy(v) {
		return v
	}
	return def
}

func fmtCategory(r *platform.Object) *platform.Object {
	var count any = platform.Undefined
	if r.Get("article_count") != nil && r.Has("article_count") {
		count = int64(num(r.Get("article_count")))
	}
	var sort any = r.Get("sort_order")
	if sort == nil {
		sort = 0
	}
	return platform.O("id", r.Get("id"), "slug", r.Get("slug"), "title", r.Get("title"),
		"description", orDefault(r.Get("description"), nil), "iconName", orDefault(r.Get("icon_name"), "circle-help"),
		"color", orDefault(r.Get("color"), "#6366f1"), "sortOrder", sort, "isActive", r.Bool("is_active"), "articleCount", count)
}

func fmtArticle(r *platform.Object) *platform.Object {
	tags := jsonList(r.Get("tags"))
	var sort any = r.Get("sort_order")
	if sort == nil {
		sort = 0
	}
	return platform.O("id", r.Get("id"), "categoryId", orDefault(r.Get("category_id"), nil), "categorySlug", orDefault(r.Get("category_slug"), nil),
		"slug", r.Get("slug"), "title", r.Get("title"), "summary", orDefault(r.Get("summary"), nil), "content", orDefault(r.Get("content"), nil),
		"tags", tags, "isPublished", r.Bool("is_published"), "isPinned", r.Bool("is_pinned"), "viewCount", int64(num(r.Get("view_count"))),
		"sortOrder", sort, "authorId", orDefault(r.Get("author_id"), nil), "createdAt", r.Get("created_at"), "updatedAt", r.Get("updated_at"))
}

func fmtAnnouncement(r *platform.Object) *platform.Object {
	return platform.O("id", r.Get("id"), "type", r.Get("type"), "title", r.Get("title"), "summary", orDefault(r.Get("summary"), nil),
		"content", orDefault(r.Get("content"), nil), "isResolved", r.Bool("is_resolved"), "isPublished", r.Bool("is_published"),
		"publishedAt", r.Get("published_at"), "createdAt", r.Get("created_at"), "updatedAt", r.Get("updated_at"))
}

func fmtIssue(r *platform.Object) *platform.Object {
	return platform.O("id", r.Get("id"), "title", r.Get("title"), "description", orDefault(r.Get("description"), nil),
		"status", r.Get("status"), "categoryLabel", orDefault(r.Get("category_label"), nil), "createdAt", r.Get("created_at"), "updatedAt", r.Get("updated_at"))
}

func (h *handlers) getCategories(ctx context.Context, onlyActive bool) ([]any, error) {
	where := ""
	if onlyActive {
		where = "WHERE c.is_active = 1"
	}
	rows, err := h.db.Rows(ctx, `SELECT c.*,
        (SELECT COUNT(*) FROM support_articles a WHERE a.category_id = c.id AND a.is_published = 1) AS article_count
       FROM support_categories c
       `+where+`
       ORDER BY c.sort_order, c.title`)
	if err != nil {
		return nil, err
	}
	return mapRows(rows, fmtCategory), nil
}

func (h *handlers) getCategoryBySlug(ctx context.Context, slug string) (*platform.Object, error) {
	row, err := h.db.First(ctx, `SELECT c.*,
        (SELECT COUNT(*) FROM support_articles a WHERE a.category_id = c.id AND a.is_published = 1) AS article_count
       FROM support_categories c WHERE c.slug = ? LIMIT 1`, slug)
	if err != nil || row == nil {
		return nil, err
	}
	return fmtCategory(row), nil
}

type articleFilters struct {
	categoryID, categorySlug, search string
	publishedOnly                    bool
	limit, offset                    float64
}

func (h *handlers) getArticles(ctx context.Context, f articleFilters) ([]any, error) {
	var conds []string
	var params []any
	if f.categoryID != "" {
		conds, params = append(conds, "a.category_id = ?"), append(params, f.categoryID)
	}
	if f.categorySlug != "" {
		conds, params = append(conds, "c.slug = ?"), append(params, f.categorySlug)
	}
	if f.publishedOnly {
		conds = append(conds, "a.is_published = 1")
	}
	if f.search != "" {
		conds = append(conds, "(a.title LIKE ? OR a.summary LIKE ?)")
		params = append(params, "%"+f.search+"%", "%"+f.search+"%")
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	params = append(params, platform.JSNumber(f.limit), platform.JSNumber(f.offset))
	rows, err := h.db.Rows(ctx, `SELECT a.*, c.slug AS category_slug
       FROM support_articles a
       LEFT JOIN support_categories c ON c.id = a.category_id
       `+where+`
       ORDER BY a.is_pinned DESC, a.sort_order ASC, a.view_count DESC
       LIMIT ? OFFSET ?`, params...)
	if err != nil {
		return nil, err
	}
	return mapRows(rows, fmtArticle), nil
}

func (h *handlers) getArticleBySlug(ctx context.Context, slug string, incrementView bool) (*platform.Object, error) {
	r, err := h.db.First(ctx, `SELECT a.*, c.slug AS category_slug FROM support_articles a
       LEFT JOIN support_categories c ON c.id = a.category_id
       WHERE a.slug = ? LIMIT 1`, slug)
	if err != nil || r == nil {
		return nil, err
	}
	if incrementView {
		if _, err := h.db.Exec(ctx, "UPDATE support_articles SET view_count = view_count + 1 WHERE id = ?", r.Get("id")); err != nil {
			return nil, err
		}
	}
	return fmtArticle(r), nil
}

// ── Routes publiques ──────────────────────────────────────────────────────

func supportFail(w http.ResponseWriter, msg string, err error) {
	slog.Error(msg, "err", err)
	platform.JSON(w, 500, platform.O("success", false, "error", "Erreur serveur"))
}

func (h *handlers) apiSupportCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := h.getCategories(r.Context(), true)
	if err != nil {
		supportFail(w, "support categories error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", cats))
}

func (h *handlers) apiSupportCategory(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	slug := r.PathValue("slug")
	cat, err := h.getCategoryBySlug(ctx, slug)
	if err != nil {
		supportFail(w, "support category slug error:", err)
		return
	}
	if cat == nil {
		platform.JSON(w, 404, platform.O("success", false, "error", "Catégorie non trouvée"))
		return
	}
	articles, err := h.getArticles(ctx, articleFilters{categorySlug: slug, publishedOnly: true, limit: 50})
	if err != nil {
		supportFail(w, "support category slug error:", err)
		return
	}
	data := cat.Clone()
	data.Set("articles", articles)
	platform.JSON(w, 200, platform.O("success", true, "data", data))
}

func (h *handlers) apiSupportPopular(w http.ResponseWriter, r *http.Request) {
	limit := math.Min(num(platform.Query(r).Get("limit")), 20)
	if num(platform.Query(r).Get("limit")) == 0 {
		limit = 6
	}
	rows, err := h.db.Rows(r.Context(), `SELECT a.*, c.slug AS category_slug FROM support_articles a
       LEFT JOIN support_categories c ON c.id = a.category_id
       WHERE a.is_published = 1
       ORDER BY a.is_pinned DESC, a.view_count DESC
       LIMIT ?`, platform.JSNumber(limit))
	if err != nil {
		supportFail(w, "support popular articles error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", mapRows(rows, fmtArticle)))
}

func (h *handlers) apiSupportArticle(w http.ResponseWriter, r *http.Request) {
	a, err := h.getArticleBySlug(r.Context(), r.PathValue("slug"), true)
	if err != nil {
		supportFail(w, "support article slug error:", err)
		return
	}
	if a == nil || !a.Bool("isPublished") {
		platform.JSON(w, 404, platform.O("success", false, "error", "Article non trouvé"))
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", a))
}

func (h *handlers) getAnnouncements(ctx context.Context, publishedOnly bool, limit int) ([]any, error) {
	where := ""
	if publishedOnly {
		where = "WHERE is_published = 1"
	}
	rows, err := h.db.Rows(ctx, "SELECT * FROM support_announcements "+where+" ORDER BY published_at DESC LIMIT ?", itoa(limit))
	if err != nil {
		return nil, err
	}
	return mapRows(rows, fmtAnnouncement), nil
}

func (h *handlers) apiSupportAnnouncements(w http.ResponseWriter, r *http.Request) {
	items, err := h.getAnnouncements(r.Context(), true, 10)
	if err != nil {
		supportFail(w, "support announcements error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", items))
}

func (h *handlers) getKnownIssues(ctx context.Context) ([]any, error) {
	rows, err := h.db.Rows(ctx, "SELECT * FROM support_known_issues ORDER BY FIELD(status,'investigating','in_progress','resolved'), updated_at DESC")
	if err != nil {
		return nil, err
	}
	return mapRows(rows, fmtIssue), nil
}

func (h *handlers) apiSupportKnownIssues(w http.ResponseWriter, r *http.Request) {
	items, err := h.getKnownIssues(r.Context())
	if err != nil {
		supportFail(w, "support known-issues error:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", items))
}

// ── Routes admin ──────────────────────────────────────────────────────────

// setFields construit « col = ? » pour chaque champ présent du corps (null compris).
func setFields(body *platform.Object, fields [][2]string, special map[string]func(any) any) ([]string, []any) {
	var sets []string
	var params []any
	for _, f := range fields {
		if !body.Has(f[0]) {
			continue
		}
		v := body.Get(f[0])
		if fn := special[f[0]]; fn != nil {
			v = fn(v)
		} else {
			v = platform.SQLParam(v)
		}
		sets, params = append(sets, f[1]+" = ?"), append(params, v)
	}
	return sets, params
}

func (h *handlers) apiAdminSupportCategories(w http.ResponseWriter, r *http.Request) {
	cats, err := h.getCategories(r.Context(), false)
	if err != nil {
		supportFail(w, "admin support categories:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", cats))
}

func (h *handlers) apiAdminCreateCategory(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("slug").IsString().Trim().IsLength(1, 100),
		platform.BodyField("title").IsString().Trim().IsLength(1, 255),
		platform.BodyField("description").Optional().IsString(),
		platform.BodyField("iconName").Optional().IsString(),
		platform.BodyField("color").Optional().IsString().Matches(hexColorAnyRe),
		platform.BodyField("sortOrder").Optional().IsInt(platform.Min(0)),
	) {
		return
	}
	ctx := r.Context()
	id := newID()
	slug := field(r, "slug")
	sortOrder := field(r, "sortOrder")
	if undef(sortOrder) || sortOrder == nil {
		sortOrder = float64(0)
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO support_categories (id, slug, title, description, icon_name, color, sort_order) VALUES (?,?,?,?,?,?,?)",
		id, platform.SQLParam(slug), platform.SQLParam(field(r, "title")), orNull(field(r, "description")),
		platform.SQLParam(orDefault(field(r, "iconName"), "circle-help")), platform.SQLParam(orDefault(field(r, "color"), "#6366f1")), platform.SQLParam(sortOrder)); err != nil {
		supportFail(w, "admin support create category:", err)
		return
	}
	cat, err := h.getCategoryBySlug(ctx, platform.JSString(slug))
	if err != nil {
		supportFail(w, "admin support create category:", err)
		return
	}
	platform.JSON(w, 201, platform.O("success", true, "data", cat))
}

func (h *handlers) apiAdminSupportUpdate(table string, fields [][2]string, special map[string]func(any) any, logMsg string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sets, params := setFields(platform.Body(r), fields, special)
		if len(sets) > 0 {
			params = append(params, r.PathValue("id"))
			if _, err := h.db.Exec(r.Context(), "UPDATE "+table+" SET "+strings.Join(sets, ", ")+" WHERE id = ?", params...); err != nil {
				supportFail(w, logMsg, err)
				return
			}
		}
		platform.JSON(w, 200, platform.O("success", true))
	}
}

func (h *handlers) apiAdminSupportDelete(table, logMsg string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, err := h.db.Exec(r.Context(), "DELETE FROM "+table+" WHERE id = ?", r.PathValue("id")); err != nil {
			supportFail(w, logMsg, err)
			return
		}
		platform.JSON(w, 200, platform.O("success", true))
	}
}

func (h *handlers) apiAdminSupportArticles(w http.ResponseWriter, r *http.Request) {
	q := platform.Query(r)
	f := articleFilters{limit: num(q.Get("limit")), offset: num(q.Get("offset"))}
	if f.limit == 0 {
		f.limit = 100
	}
	if s, ok := q.Get("categoryId").(string); ok {
		f.categoryID = s
	}
	if s, ok := q.Get("search").(string); ok {
		f.search = s
	}
	arts, err := h.getArticles(r.Context(), f)
	if err != nil {
		supportFail(w, "admin support articles:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", arts))
}

func (h *handlers) apiAdminCreateArticle(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("slug").IsString().Trim().IsLength(1, 255),
		platform.BodyField("title").IsString().Trim().IsLength(1, 255),
		platform.BodyField("summary").Optional().IsString(),
		platform.BodyField("content").Optional().IsString(),
		platform.BodyField("categoryId").Optional().IsString(),
		platform.BodyField("tags").Optional().IsArray(-1, -1),
		platform.BodyField("isPinned").Optional().IsBoolean(),
		platform.BodyField("sortOrder").Optional().IsInt(platform.Min(0)),
	) {
		return
	}
	ctx := r.Context()
	id := newID()
	tags := field(r, "tags")
	if undef(tags) || tags == nil {
		tags = []any{}
	}
	pinned := field(r, "isPinned")
	if undef(pinned) || pinned == nil {
		pinned = false
	}
	sortOrder := field(r, "sortOrder")
	if undef(sortOrder) || sortOrder == nil {
		sortOrder = float64(0)
	}
	slug := field(r, "slug")
	if _, err := h.db.Exec(ctx, "INSERT INTO support_articles (id, category_id, slug, title, summary, content, tags, is_pinned, sort_order, author_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
		id, orNull(field(r, "categoryId")), platform.SQLParam(slug), platform.SQLParam(field(r, "title")), orNull(field(r, "summary")),
		orNull(field(r, "content")), platform.JSONString(tags), platform.SQLParam(pinned), platform.SQLParam(sortOrder), orNull(uidAny(r))); err != nil {
		supportFail(w, "admin support create article:", err)
		return
	}
	a, err := h.getArticleBySlug(ctx, platform.JSString(slug), false)
	if err != nil {
		supportFail(w, "admin support create article:", err)
		return
	}
	platform.JSON(w, 201, platform.O("success", true, "data", a))
}

func uidAny(r *http.Request) any {
	if uid(r) == "" {
		return nil
	}
	return uid(r)
}

func (h *handlers) apiAdminAnnouncements(w http.ResponseWriter, r *http.Request) {
	items, err := h.getAnnouncements(r.Context(), false, 50)
	if err != nil {
		supportFail(w, "admin support announcements:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", items))
}

func (h *handlers) apiAdminCreateAnnouncement(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("type").IsIn("incident", "maintenance", "news"),
		platform.BodyField("title").IsString().Trim().IsLength(1, 255),
		platform.BodyField("summary").Optional().IsString(),
		platform.BodyField("content").Optional().IsString(),
		platform.BodyField("isResolved").Optional().IsBoolean(),
	) {
		return
	}
	ctx := r.Context()
	id := newID()
	resolved := field(r, "isResolved")
	if undef(resolved) || resolved == nil {
		resolved = false
	}
	if _, err := h.db.Exec(ctx, "INSERT INTO support_announcements (id, type, title, summary, content, is_resolved) VALUES (?,?,?,?,?,?)",
		id, platform.SQLParam(field(r, "type")), platform.SQLParam(field(r, "title")), orNull(field(r, "summary")), orNull(field(r, "content")), platform.SQLParam(resolved)); err != nil {
		supportFail(w, "admin support create announcement:", err)
		return
	}
	row, err := h.db.First(ctx, "SELECT * FROM support_announcements WHERE id = ?", id)
	if err != nil || row == nil {
		supportFail(w, "admin support create announcement:", err)
		return
	}
	platform.JSON(w, 201, platform.O("success", true, "data", fmtAnnouncement(row)))
}

func (h *handlers) apiAdminKnownIssues(w http.ResponseWriter, r *http.Request) {
	items, err := h.getKnownIssues(r.Context())
	if err != nil {
		supportFail(w, "admin support known-issues:", err)
		return
	}
	platform.JSON(w, 200, platform.O("success", true, "data", items))
}

func (h *handlers) apiAdminCreateKnownIssue(w http.ResponseWriter, r *http.Request) {
	if !validated(w, r,
		platform.BodyField("title").IsString().Trim().IsLength(1, 255),
		platform.BodyField("description").Optional().IsString(),
		platform.BodyField("status").Optional().IsIn("investigating", "in_progress", "resolved"),
		platform.BodyField("categoryLabel").Optional().IsString().IsLength(0, 100),
	) {
		return
	}
	ctx := r.Context()
	id := newID()
	if _, err := h.db.Exec(ctx, "INSERT INTO support_known_issues (id, title, description, status, category_label) VALUES (?,?,?,?,?)",
		id, platform.SQLParam(field(r, "title")), orNull(field(r, "description")), platform.SQLParam(orDefault(field(r, "status"), "investigating")), orNull(field(r, "categoryLabel"))); err != nil {
		supportFail(w, "admin support create known-issue:", err)
		return
	}
	row, err := h.db.First(ctx, "SELECT * FROM support_known_issues WHERE id = ?", id)
	if err != nil || row == nil {
		supportFail(w, "admin support create known-issue:", err)
		return
	}
	platform.JSON(w, 201, platform.O("success", true, "data", fmtIssue(row)))
}
