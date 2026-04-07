import { User, UserPreferences, UserStatus } from '../types/user';
import { UserBadge, BadgeType } from '../types/badges';
export declare class UserService {
    private get db();
    private get redis();
    findById(userId: string): Promise<User | null>;
    findByIds(userIds: string[]): Promise<User[]>;
    findByEmail(email: string): Promise<User | null>;
    findByUsername(username: string): Promise<User | null>;
    search(query: string, limit?: number): Promise<User[]>;
    create(data: {
        id: string;
        email: string;
        username: string;
        displayName: string;
        passwordHash: string;
    }): Promise<User>;
    updateProfile(userId: string, data: {
        displayName?: string;
        avatarUrl?: string;
        bannerUrl?: string;
        bio?: string;
        cardColor?: string;
        showBadges?: boolean;
        tutorialCompleted?: boolean;
    }): Promise<void>;
    updateStatus(userId: string, status: UserStatus): Promise<void>;
    updateLastSeen(userId: string): Promise<void>;
    getPreferences(userId: string): Promise<UserPreferences | null>;
    updatePreferences(userId: string, data: Partial<UserPreferences>): Promise<void>;
    changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    getBadges(userId: string): Promise<UserBadge[]>;
    addBadge(userId: string, badgeType: BadgeType): Promise<void>;
    removeBadge(userId: string, badgeId: string): Promise<void>;
    toggleBadgesVisibility(userId: string, show: boolean): Promise<void>;
    checkAndAwardAnniversaryBadges(userId: string): Promise<void>;
    private invalidateCache;
    private formatUser;
    private formatPreferences;
}
export declare const userService: UserService;
//# sourceMappingURL=users.service.d.ts.map