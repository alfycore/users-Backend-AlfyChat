// ==========================================
// ALFYCHAT - SERVICE CENTRE D'AIDE
// ==========================================

import { getDatabaseClient } from '../database';
import { v4 as uuidv4 } from 'uuid';

export interface SupportCategory {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  iconName: string;
  color: string;
  sortOrder: number;
  isActive: boolean;
  articleCount?: number;
}

export interface SupportArticle {
  id: string;
  categoryId: string | null;
  categorySlug?: string | null;
  slug: string;
  title: string;
  summary: string | null;
  content: string | null;
  tags: string[];
  isPublished: boolean;
  isPinned: boolean;
  viewCount: number;
  sortOrder: number;
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportAnnouncement {
  id: string;
  type: 'incident' | 'maintenance' | 'news';
  title: string;
  summary: string | null;
  content: string | null;
  isResolved: boolean;
  isPublished: boolean;
  publishedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SupportKnownIssue {
  id: string;
  title: string;
  description: string | null;
  status: 'investigating' | 'in_progress' | 'resolved';
  categoryLabel: string | null;
  createdAt: Date;
  updatedAt: Date;
}

class SupportService {
  private get db() { return getDatabaseClient(); }

  // ── Formatters ─────────────────────────────────────────────────────────────

  private fmtCategory(r: any): SupportCategory {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      description: r.description || null,
      iconName: r.icon_name || 'circle-help',
      color: r.color || '#6366f1',
      sortOrder: r.sort_order ?? 0,
      isActive: Boolean(r.is_active),
      articleCount: r.article_count != null ? Number(r.article_count) : undefined,
    };
  }

  private fmtArticle(r: any): SupportArticle {
    let tags: string[] = [];
    try { tags = r.tags ? JSON.parse(r.tags) : []; } catch {}
    return {
      id: r.id,
      categoryId: r.category_id || null,
      categorySlug: r.category_slug || null,
      slug: r.slug,
      title: r.title,
      summary: r.summary || null,
      content: r.content || null,
      tags,
      isPublished: Boolean(r.is_published),
      isPinned: Boolean(r.is_pinned),
      viewCount: Number(r.view_count ?? 0),
      sortOrder: r.sort_order ?? 0,
      authorId: r.author_id || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private fmtAnnouncement(r: any): SupportAnnouncement {
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      summary: r.summary || null,
      content: r.content || null,
      isResolved: Boolean(r.is_resolved),
      isPublished: Boolean(r.is_published),
      publishedAt: r.published_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private fmtIssue(r: any): SupportKnownIssue {
    return {
      id: r.id,
      title: r.title,
      description: r.description || null,
      status: r.status,
      categoryLabel: r.category_label || null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // ── Categories ─────────────────────────────────────────────────────────────

  async getCategories(onlyActive = true): Promise<SupportCategory[]> {
    const [rows] = await this.db.query(
      `SELECT c.*, 
        (SELECT COUNT(*) FROM support_articles a WHERE a.category_id = c.id AND a.is_published = 1) AS article_count
       FROM support_categories c
       ${onlyActive ? 'WHERE c.is_active = 1' : ''}
       ORDER BY c.sort_order, c.title`
    );
    return (rows as any[]).map(r => this.fmtCategory(r));
  }

  async getCategoryBySlug(slug: string): Promise<SupportCategory | null> {
    const [rows] = await this.db.query(
      `SELECT c.*,
        (SELECT COUNT(*) FROM support_articles a WHERE a.category_id = c.id AND a.is_published = 1) AS article_count
       FROM support_categories c WHERE c.slug = ? LIMIT 1`,
      [slug]
    );
    const r = (rows as any[])[0];
    return r ? this.fmtCategory(r) : null;
  }

  async createCategory(data: { slug: string; title: string; description?: string; iconName?: string; color?: string; sortOrder?: number }): Promise<SupportCategory> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO support_categories (id, slug, title, description, icon_name, color, sort_order) VALUES (?,?,?,?,?,?,?)`,
      [id, data.slug, data.title, data.description || null, data.iconName || 'circle-help', data.color || '#6366f1', data.sortOrder ?? 0]
    );
    return (await this.getCategoryBySlug(data.slug))!;
  }

  async updateCategory(id: string, data: Partial<{ slug: string; title: string; description: string; iconName: string; color: string; sortOrder: number; isActive: boolean }>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.slug !== undefined)      { sets.push('slug = ?');         params.push(data.slug); }
    if (data.title !== undefined)     { sets.push('title = ?');        params.push(data.title); }
    if (data.description !== undefined){ sets.push('description = ?'); params.push(data.description); }
    if (data.iconName !== undefined)  { sets.push('icon_name = ?');    params.push(data.iconName); }
    if (data.color !== undefined)     { sets.push('color = ?');        params.push(data.color); }
    if (data.sortOrder !== undefined) { sets.push('sort_order = ?');   params.push(data.sortOrder); }
    if (data.isActive !== undefined)  { sets.push('is_active = ?');    params.push(data.isActive); }
    if (sets.length === 0) return;
    params.push(id);
    await this.db.execute(`UPDATE support_categories SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM support_categories WHERE id = ?`, [id]);
  }

  // ── Articles ───────────────────────────────────────────────────────────────

  async getArticles(filters: { categoryId?: string; categorySlug?: string; publishedOnly?: boolean; search?: string; limit?: number; offset?: number } = {}): Promise<SupportArticle[]> {
    const conds: string[] = [];
    const params: any[] = [];
    if (filters.categoryId)   { conds.push('a.category_id = ?');      params.push(filters.categoryId); }
    if (filters.categorySlug) { conds.push('c.slug = ?');              params.push(filters.categorySlug); }
    if (filters.publishedOnly ?? true) { conds.push('a.is_published = 1'); }
    if (filters.search)       { conds.push('(a.title LIKE ? OR a.summary LIKE ?)'); params.push(`%${filters.search}%`, `%${filters.search}%`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    params.push(String(limit), String(offset));
    const [rows] = await this.db.query(
      `SELECT a.*, c.slug AS category_slug
       FROM support_articles a
       LEFT JOIN support_categories c ON c.id = a.category_id
       ${where}
       ORDER BY a.is_pinned DESC, a.sort_order ASC, a.view_count DESC
       LIMIT ? OFFSET ?`,
      params
    );
    return (rows as any[]).map(r => this.fmtArticle(r));
  }

  async getArticleBySlug(slug: string, incrementView = false): Promise<SupportArticle | null> {
    const [rows] = await this.db.query(
      `SELECT a.*, c.slug AS category_slug FROM support_articles a
       LEFT JOIN support_categories c ON c.id = a.category_id
       WHERE a.slug = ? LIMIT 1`,
      [slug]
    );
    const r = (rows as any[])[0];
    if (!r) return null;
    if (incrementView) {
      await this.db.execute(`UPDATE support_articles SET view_count = view_count + 1 WHERE id = ?`, [r.id]);
    }
    return this.fmtArticle(r);
  }

  async getPopularArticles(limit = 6): Promise<SupportArticle[]> {
    const [rows] = await this.db.query(
      `SELECT a.*, c.slug AS category_slug FROM support_articles a
       LEFT JOIN support_categories c ON c.id = a.category_id
       WHERE a.is_published = 1
       ORDER BY a.is_pinned DESC, a.view_count DESC
       LIMIT ?`,
      [String(limit)]
    );
    return (rows as any[]).map(r => this.fmtArticle(r));
  }

  async createArticle(data: { categoryId?: string; slug: string; title: string; summary?: string; content?: string; tags?: string[]; isPinned?: boolean; sortOrder?: number; authorId?: string }): Promise<SupportArticle> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO support_articles (id, category_id, slug, title, summary, content, tags, is_pinned, sort_order, author_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, data.categoryId || null, data.slug, data.title, data.summary || null, data.content || null, JSON.stringify(data.tags ?? []), data.isPinned ?? false, data.sortOrder ?? 0, data.authorId || null]
    );
    return (await this.getArticleBySlug(data.slug))!;
  }

  async updateArticle(id: string, data: Partial<{ categoryId: string | null; slug: string; title: string; summary: string; content: string; tags: string[]; isPublished: boolean; isPinned: boolean; sortOrder: number }>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.categoryId !== undefined) { sets.push('category_id = ?'); params.push(data.categoryId); }
    if (data.slug !== undefined)       { sets.push('slug = ?');        params.push(data.slug); }
    if (data.title !== undefined)      { sets.push('title = ?');       params.push(data.title); }
    if (data.summary !== undefined)    { sets.push('summary = ?');     params.push(data.summary); }
    if (data.content !== undefined)    { sets.push('content = ?');     params.push(data.content); }
    if (data.tags !== undefined)       { sets.push('tags = ?');        params.push(JSON.stringify(data.tags)); }
    if (data.isPublished !== undefined){ sets.push('is_published = ?');params.push(data.isPublished); }
    if (data.isPinned !== undefined)   { sets.push('is_pinned = ?');   params.push(data.isPinned); }
    if (data.sortOrder !== undefined)  { sets.push('sort_order = ?');  params.push(data.sortOrder); }
    if (sets.length === 0) return;
    params.push(id);
    await this.db.execute(`UPDATE support_articles SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteArticle(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM support_articles WHERE id = ?`, [id]);
  }

  // ── Announcements ──────────────────────────────────────────────────────────

  async getAnnouncements(publishedOnly = true, limit = 10): Promise<SupportAnnouncement[]> {
    const [rows] = await this.db.query(
      `SELECT * FROM support_announcements
       ${publishedOnly ? 'WHERE is_published = 1' : ''}
       ORDER BY published_at DESC LIMIT ?`,
      [String(limit)]
    );
    return (rows as any[]).map(r => this.fmtAnnouncement(r));
  }

  async createAnnouncement(data: { type: string; title: string; summary?: string; content?: string; isResolved?: boolean }): Promise<SupportAnnouncement> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO support_announcements (id, type, title, summary, content, is_resolved) VALUES (?,?,?,?,?,?)`,
      [id, data.type, data.title, data.summary || null, data.content || null, data.isResolved ?? false]
    );
    const [rows] = await this.db.query(`SELECT * FROM support_announcements WHERE id = ?`, [id]);
    return this.fmtAnnouncement((rows as any[])[0]);
  }

  async updateAnnouncement(id: string, data: Partial<{ type: string; title: string; summary: string; content: string; isResolved: boolean; isPublished: boolean }>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.type !== undefined)       { sets.push('type = ?');         params.push(data.type); }
    if (data.title !== undefined)      { sets.push('title = ?');        params.push(data.title); }
    if (data.summary !== undefined)    { sets.push('summary = ?');      params.push(data.summary); }
    if (data.content !== undefined)    { sets.push('content = ?');      params.push(data.content); }
    if (data.isResolved !== undefined) { sets.push('is_resolved = ?');  params.push(data.isResolved); }
    if (data.isPublished !== undefined){ sets.push('is_published = ?'); params.push(data.isPublished); }
    if (sets.length === 0) return;
    params.push(id);
    await this.db.execute(`UPDATE support_announcements SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM support_announcements WHERE id = ?`, [id]);
  }

  // ── Known Issues ───────────────────────────────────────────────────────────

  async getKnownIssues(): Promise<SupportKnownIssue[]> {
    const [rows] = await this.db.query(
      `SELECT * FROM support_known_issues ORDER BY FIELD(status,'investigating','in_progress','resolved'), updated_at DESC`
    );
    return (rows as any[]).map(r => this.fmtIssue(r));
  }

  async createKnownIssue(data: { title: string; description?: string; status?: string; categoryLabel?: string }): Promise<SupportKnownIssue> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO support_known_issues (id, title, description, status, category_label) VALUES (?,?,?,?,?)`,
      [id, data.title, data.description || null, data.status || 'investigating', data.categoryLabel || null]
    );
    const [rows] = await this.db.query(`SELECT * FROM support_known_issues WHERE id = ?`, [id]);
    return this.fmtIssue((rows as any[])[0]);
  }

  async updateKnownIssue(id: string, data: Partial<{ title: string; description: string; status: string; categoryLabel: string }>): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.title !== undefined)         { sets.push('title = ?');          params.push(data.title); }
    if (data.description !== undefined)   { sets.push('description = ?');    params.push(data.description); }
    if (data.status !== undefined)        { sets.push('status = ?');         params.push(data.status); }
    if (data.categoryLabel !== undefined) { sets.push('category_label = ?'); params.push(data.categoryLabel); }
    if (sets.length === 0) return;
    params.push(id);
    await this.db.execute(`UPDATE support_known_issues SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteKnownIssue(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM support_known_issues WHERE id = ?`, [id]);
  }
}

export const supportService = new SupportService();
