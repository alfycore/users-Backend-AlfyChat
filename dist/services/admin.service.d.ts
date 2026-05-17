export interface CustomBadge {
    id: string;
    name: string;
    description?: string;
    iconType: 'bootstrap' | 'svg' | 'flaticon';
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
    iconType: 'bootstrap' | 'svg' | 'flaticon';
    iconValue: string;
    color: string;
    displayOrder?: number;
}
export interface UserAdminData {
    id: string;
    username: string;
    displayName: string;
    email: string;
    role: 'user' | 'moderator' | 'admin' | 'support_l1' | 'support_l2' | 'technician';
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
    /**
     * Met à jour le snapshot du badge dans la colonne JSON `badges` de tous les utilisateurs
     * qui possèdent ce badge, afin que les changements d'icône/nom/couleur soient reflétés.
     */
    private syncBadgeToUsers;
    toggleBadgeStatus(badgeId: string, isActive: boolean): Promise<void>;
    deleteCustomBadge(badgeId: string): Promise<void>;
    getAllUsers(limit?: number, offset?: number): Promise<UserAdminData[]>;
    searchUsers(query: string, limit?: number): Promise<UserAdminData[]>;
    updateUserRole(userId: string, role: 'user' | 'moderator' | 'admin' | 'support_l1' | 'support_l2' | 'technician'): Promise<void>;
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
    getChangelogs(limit?: number, offset?: number): Promise<any[]>;
    createChangelog(data: {
        version?: string;
        title: string;
        content: string;
        type: 'feature' | 'fix' | 'improvement' | 'security' | 'breaking' | 'news';
        bannerUrl?: string | null;
        createdBy: string;
    }): Promise<any>;
    updateChangelog(changelogId: string, data: {
        version?: string;
        title?: string;
        content?: string;
        type?: string;
        bannerUrl?: string | null;
    }): Promise<void>;
    deleteChangelog(changelogId: string): Promise<void>;
}
export declare const adminService: AdminService;
//# sourceMappingURL=admin.service.d.ts.map