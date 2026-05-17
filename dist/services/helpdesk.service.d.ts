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
declare class HelpdeskService {
    private get db();
    private formatTicket;
    private formatMessage;
    getTickets(filters?: TicketFilters): Promise<HelpdeskTicket[]>;
    getTicketById(id: string): Promise<HelpdeskTicket | null>;
    getTicketByNumber(ticketNumber: number): Promise<HelpdeskTicket | null>;
    createTicket(data: CreateTicketData): Promise<HelpdeskTicket>;
    updateTicket(id: string, data: {
        status?: TicketStatus;
        priority?: TicketPriority;
        category?: TicketCategory;
        assignedTo?: string | null;
        subject?: string;
    }): Promise<void>;
    deleteTicket(id: string): Promise<void>;
    getMessages(ticketId: string, opts?: {
        excludeInternal?: boolean;
    }): Promise<HelpdeskMessage[]>;
    addMessage(ticketId: string, authorId: string, content: string, isInternal?: boolean): Promise<HelpdeskMessage>;
    getStaffAgents(): Promise<any[]>;
    getStats(): Promise<HelpdeskStats>;
}
export declare const helpdeskService: HelpdeskService;
export {};
//# sourceMappingURL=helpdesk.service.d.ts.map