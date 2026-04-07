// ==========================================
// ALFYCHAT - TYPES UTILISATEUR
// ==========================================

export type UserStatus = 'online' | 'offline' | 'idle' | 'dnd' | 'invisible';

export interface User {
  id: string;
  email?: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  role?: 'user' | 'moderator' | 'admin';
  status: UserStatus;
  isOnline: boolean;
  createdAt?: Date;
  lastSeenAt?: Date;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  encryptionLevel: 1 | 2 | 3;
  notificationsDesktop: boolean;
  notificationsSound: boolean;
  notificationsMentions: boolean;
  notificationsDm: boolean;
  privacyShowOnline: boolean;
  privacyAllowDm: boolean;
  privacyAllowFriendRequests: boolean;
  // Extended settings
  birthday?: string;
  timezone?: string;
  interests?: string[];
  micMode?: string;
  fontFamily?: string;
  dndEnabled?: boolean;
  notifKeywords?: string[];
  quietStart?: string;
  quietEnd?: string;
  vacationStart?: string;
  vacationEnd?: string;
}

export interface Session {
  id: string;
  userId: string;
  refreshToken: string;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
