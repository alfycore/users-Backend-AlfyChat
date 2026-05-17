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
        hiddenBadgeIds?: string[];
        tutorialCompleted?: boolean;
    }): Promise<void>;
    updateStatus(userId: string, status: UserStatus, customStatus?: string | null, emoji?: string | null): Promise<void>;
    updateCustomStatus(userId: string, customStatus: string | null): Promise<void>;
    updateLastSeen(userId: string): Promise<void>;
    getPreferences(userId: string): Promise<UserPreferences | null>;
    updatePreferences(userId: string, data: Partial<UserPreferences>): Promise<void>;
    checkUsernameAvailable(username: string): Promise<boolean>;
    changeUsername(userId: string, newUsername: string, password: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    changePassword(userId: string, currentPassword: string, newPassword: string, encryptedPrivateKey?: string, keySalt?: string): Promise<{
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
    isBlockedBy(viewerId: string, targetId: string): Promise<boolean>;
    updateMusicPresence(userId: string, data: {
        title?: string;
        artist?: string;
        coverUrl?: string;
        platform?: string;
        startedAt?: string;
    } | null): Promise<void>;
    updateProfileCard(userId: string, profileCardUrl: string | null): Promise<void>;
    getFavorites(userId: string, type?: 'emoji' | 'sticker' | 'gif'): Promise<any[]>;
    addFavorite(userId: string, type: 'emoji' | 'sticker' | 'gif', value: string): Promise<any>;
    removeFavorite(userId: string, id: string): Promise<void>;
    reorderFavorites(userId: string, orderedIds: string[]): Promise<void>;
    getActivityHiddenFrom(userId: string): Promise<string[]>;
    hideActivityFrom(userId: string, targetUserId: string): Promise<void>;
    showActivityTo(userId: string, targetUserId: string): Promise<void>;
    isActivityHiddenFrom(userId: string, viewerId: string): Promise<boolean>;
    getPinnedConversations(userId: string): Promise<Array<{
        conversationId: string;
        pinOrder: number;
    }>>;
    pinConversation(userId: string, conversationId: string): Promise<void>;
    unpinConversation(userId: string, conversationId: string): Promise<void>;
}
export declare const userService: UserService;
//# sourceMappingURL=users.service.d.ts.map