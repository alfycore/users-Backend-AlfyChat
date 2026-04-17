// ==========================================
// ALFYCHAT - SERVICE HELPDESK
// ==========================================

import { getDatabaseClient } from '../database';
import { v4 as uuidv4 } from 'uuid';

export type TicketStatus = 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketCategory = 'general' | 'technical' | 'billing' | 'account' | 'abuse' | 'feature' | 'other';

export interface HelpdeskTicket {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  requesterId: string;
  requesterName: string;
  requesterUsername: string;
  assignedTo: string | null;
  assignedToName: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  resolvedAt: Date | null;
  messageCount: number;
}

export interface HelpdeskMessage {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorRole: string;
  content: string;
  isInternal: boolean;
  createdAt: Date;
}

export interface CreateTicketData {
  subject: string;
  description: string;
  priority?: TicketPriority;
  category?: TicketCategory;
  requesterId?: string | null;
  requesterEmail?: string | null;
}

export interface TicketFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  category?: TicketCategory;
  assignedTo?: string;
  requesterId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  excludeInternalCount?: boolean;
}

export interface HelpdeskStats {
  total: number;
  open: number;
  inProgress: number;
  pending: number;
  resolved: number;
  closed: number;
  critical: number;
  unassigned: number;
  avgResolutionHours: number | null;
}

class HelpdeskService {
  private get db() {
    return getDatabaseClient();
  }

  // ── Formatters ─────────────────────────────────────────────────────────────

  private formatTicket(row: any): HelpdeskTicket {
    return {
      id: row.id,
      ticketNumber: row.ticket_number,
      subject: row.subject,
      description: row.description,
      status: row.status,
      priority: row.priority,
      category: row.category,
      requesterId: row.requester_id,
      requesterName: row.requester_name || row.requester_username || '',
      requesterUsername: row.requester_username || '',
      assignedTo: row.assigned_to || null,
      assignedToName: row.assigned_to_name || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at || null,
      resolvedAt: row.resolved_at || null,
      messageCount: Number(row.message_count ?? 0),
    };
  }

  private formatMessage(row: any): HelpdeskMessage {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      authorId: row.author_id,
      authorName: row.author_name || row.author_username || '',
      authorUsername: row.author_username || '',
      authorRole: row.author_role || 'user',
      content: row.content,
      isInternal: Boolean(row.is_internal),
      createdAt: row.created_at,
    };
  }

  // ── Tickets ────────────────────────────────────────────────────────────────

  async getTickets(filters: TicketFilters = {}): Promise<HelpdeskTicket[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.status) { conditions.push('t.status = ?'); params.push(filters.status); }
    if (filters.priority) { conditions.push('t.priority = ?'); params.push(filters.priority); }
    if (filters.category) { conditions.push('t.category = ?'); params.push(filters.category); }
    if (filters.assignedTo) { conditions.push('t.assigned_to = ?'); params.push(filters.assignedTo); }
    if (filters.requesterId) { conditions.push('t.requester_id = ?'); params.push(filters.requesterId); }
    if (filters.search) {
      conditions.push('(t.subject LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    params.push(String(limit), String(offset));

    const [rows] = await this.db.query(
      `SELECT t.*,
        COALESCE(u.display_name, u.username) AS requester_name,
        u.username AS requester_username,
        COALESCE(a.display_name, a.username) AS assigned_to_name,
        (SELECT COUNT(*) FROM helpdesk_messages m WHERE m.ticket_id = t.id${filters.excludeInternalCount ? ' AND m.is_internal = FALSE' : ''}) AS message_count
       FROM helpdesk_tickets t
       LEFT JOIN users u ON u.id = t.requester_id
       LEFT JOIN users a ON a.id = t.assigned_to
       ${where}
       ORDER BY
         CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         t.created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    return (rows as any[]).map(r => this.formatTicket(r));
  }

  async getTicketById(id: string): Promise<HelpdeskTicket | null> {
    const [rows] = await this.db.query(
      `SELECT t.*,
        COALESCE(u.display_name, u.username) AS requester_name,
        u.username AS requester_username,
        COALESCE(a.display_name, a.username) AS assigned_to_name,
        (SELECT COUNT(*) FROM helpdesk_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM helpdesk_tickets t
       LEFT JOIN users u ON u.id = t.requester_id
       LEFT JOIN users a ON a.id = t.assigned_to
       WHERE t.id = ?`,
      [id]
    );
    const r = (rows as any[])[0];
    return r ? this.formatTicket(r) : null;
  }

  async getTicketByNumber(ticketNumber: number): Promise<HelpdeskTicket | null> {
    const [rows] = await this.db.query(
      `SELECT t.*,
        COALESCE(u.display_name, u.username) AS requester_name,
        u.username AS requester_username,
        COALESCE(a.display_name, a.username) AS assigned_to_name,
        (SELECT COUNT(*) FROM helpdesk_messages m WHERE m.ticket_id = t.id AND m.is_internal = FALSE) AS message_count
       FROM helpdesk_tickets t
       LEFT JOIN users u ON u.id = t.requester_id
       LEFT JOIN users a ON a.id = t.assigned_to
       WHERE t.ticket_number = ?`,
      [ticketNumber]
    );
    const r = (rows as any[])[0];
    return r ? this.formatTicket(r) : null;
  }

  async createTicket(data: CreateTicketData): Promise<HelpdeskTicket> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO helpdesk_tickets (id, subject, description, priority, category, requester_id, requester_email)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, data.subject, data.description, data.priority ?? 'medium', data.category ?? 'general', data.requesterId ?? null, data.requesterEmail ?? null]
    );
    const ticket = await this.getTicketById(id);
    if (!ticket) throw new Error('Ticket non créé');
    return ticket;
  }

  async updateTicket(id: string, data: {
    status?: TicketStatus;
    priority?: TicketPriority;
    category?: TicketCategory;
    assignedTo?: string | null;
    subject?: string;
  }): Promise<void> {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.status !== undefined) {
      updates.push('status = ?');
      params.push(data.status);
      if (data.status === 'resolved') { updates.push('resolved_at = NOW()'); }
      if (data.status === 'closed') { updates.push('closed_at = NOW()'); }
    }
    if (data.priority !== undefined) { updates.push('priority = ?'); params.push(data.priority); }
    if (data.category !== undefined) { updates.push('category = ?'); params.push(data.category); }
    if ('assignedTo' in data) { updates.push('assigned_to = ?'); params.push(data.assignedTo ?? null); }
    if (data.subject !== undefined) { updates.push('subject = ?'); params.push(data.subject); }

    if (updates.length === 0) return;
    params.push(id);

    await this.db.execute(
      `UPDATE helpdesk_tickets SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }

  async deleteTicket(id: string): Promise<void> {
    await this.db.execute('DELETE FROM helpdesk_tickets WHERE id = ?', [id]);
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  async getMessages(ticketId: string, opts: { excludeInternal?: boolean } = {}): Promise<HelpdeskMessage[]> {
    const whereExtra = opts.excludeInternal ? ' AND m.is_internal = FALSE' : '';
    const [rows] = await this.db.query(
      `SELECT m.*,
        COALESCE(u.display_name, u.username) AS author_name,
        u.username AS author_username,
        u.role AS author_role
       FROM helpdesk_messages m
       LEFT JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = ?${whereExtra}
       ORDER BY m.created_at ASC`,
      [ticketId]
    );
    return (rows as any[]).map(r => this.formatMessage(r));
  }

  async addMessage(ticketId: string, authorId: string, content: string, isInternal = false): Promise<HelpdeskMessage> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO helpdesk_messages (id, ticket_id, author_id, content, is_internal) VALUES (?, ?, ?, ?, ?)`,
      [id, ticketId, authorId, content, isInternal]
    );
    // Auto-transition: si le ticket est 'open', passer en 'in_progress' quand le staff répond
    await this.db.execute(
      `UPDATE helpdesk_tickets SET status = 'in_progress', updated_at = NOW()
       WHERE id = ? AND status = 'open'`,
      [ticketId]
    );
    const [rows] = await this.db.query(
      `SELECT m.*,
        COALESCE(u.display_name, u.username) AS author_name,
        u.username AS author_username,
        u.role AS author_role
       FROM helpdesk_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`,
      [id]
    );
    return this.formatMessage((rows as any[])[0]);
  }

  // ── Staff agents ───────────────────────────────────────────────────────────

  async getStaffAgents(): Promise<any[]> {
    const [rows] = await this.db.query(
      `SELECT id, username, COALESCE(display_name, username) AS display_name, role, avatar_url, is_online
       FROM users
       WHERE role IN ('admin', 'support_l1', 'support_l2', 'technician', 'moderator')
       ORDER BY
         CASE role WHEN 'admin' THEN 0 WHEN 'technician' THEN 1 WHEN 'support_l2' THEN 2 WHEN 'support_l1' THEN 3 ELSE 4 END,
         username ASC`
    );
    return rows as any[];
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getStats(): Promise<HelpdeskStats> {
    const [rows] = await this.db.query(
      `SELECT
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
       FROM helpdesk_tickets`
    );
    const r = (rows as any[])[0];
    return {
      total: Number(r.total ?? 0),
      open: Number(r.open_count ?? 0),
      inProgress: Number(r.in_progress_count ?? 0),
      pending: Number(r.pending_count ?? 0),
      resolved: Number(r.resolved_count ?? 0),
      closed: Number(r.closed_count ?? 0),
      critical: Number(r.critical_count ?? 0),
      unassigned: Number(r.unassigned_count ?? 0),
      avgResolutionHours: r.avg_resolution_hours != null ? Math.round(Number(r.avg_resolution_hours) * 10) / 10 : null,
    };
  }
}

export const helpdeskService = new HelpdeskService();
