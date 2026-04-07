export interface CustomBadge {
    id: string;
    name: string;
    description?: string;
    iconType: 'bootstrap' | 'svg';
    iconValue: string;
    color: string;
    displayOrder: number;
    isActive: boolean;
    createdBy?: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface CreateBadgeData {
    name: string;
    description?: string;
    iconType: 'bootstrap' | 'svg';
    iconValue: string;
    color: string;
    displayOrder?: number;
}
export interface UserAdminData {
    id: string;
    username: string;
    displayName: string;
    email: string;
    role: 'user' | 'moderator' | 'admin';
    badges: any[];
    status: string;
    isOnline: boolean;
    createdAt: Date;
    lastSeenAt?: Date;
}
export declare class AdminService {
    private get db();
    getAllCustomBadges(): Promise<CustomBadge[]>;
    getCustomBadge(badgeId: string): Promise<CustomBadge | null>;
    createCustomBadge(data: CreateBadgeData, createdBy: string): Promise<CustomBadge>;
    updateCustomBadge(badgeId: string, data: Partial<CreateBadgeData>): Promise<void>;
    toggleBadgeStatus(badgeId: string, isActive: boolean): Promise<void>;
    deleteCustomBadge(badgeId: string): Promise<void>;
    getAllUsers(limit?: number, offset?: number): Promise<UserAdminData[]>;
    searchUsers(query: string, limit?: number): Promise<UserAdminData[]>;
    updateUserRole(userId: string, role: 'user' | 'moderator' | 'admin'): Promise<void>;
    getUserStats(): Promise<{
        totalUsers: number;
        onlineUsers: number;
        admins: number;
        moderators: number;
    }>;
    assignBadgeToUser(userId: string, badgeId: string): Promise<void>;
    removeBadgeFromUser(userId: string, badgeId: string): Promise<void>;
    getSiteSettings(): Promise<Record<string, string>>;
    updateSiteSetting(key: string, value: string): Promise<void>;
    isRegistrationEnabled(): Promise<boolean>;
    isTurnstileEnabled(): Promise<boolean>;
    createInviteLink(email: string, createdBy: string, expiresInHours?: number): Promise<{
        id: string;
        code: string;
        email: string;
        expiresAt: Date;
        link: string;
    }>;
    getInviteLinks(): Promise<any[]>;
    deleteInviteLink(linkId: string): Promise<void>;
    validateInviteCode(code: string, email: string): Promise<{
        valid: boolean;
        error?: string;
        linkId?: string;
    }>;
    markInviteLinkUsed(linkId: string, usedBy: string): Promise<void>;
    verifyTurnstileToken(token: string): Promise<boolean>;
    private formatBadge;
    private formatUserAdmin;
}
export declare const adminService: AdminService;
//# sourceMappingURL=admin.service.d.ts.map