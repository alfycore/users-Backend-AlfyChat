import { User } from '../types/user';
interface AuthResult {
    success: boolean;
    error?: string;
    user?: User;
    tokens?: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        sessionId: string;
    };
    twoFactorRequired?: boolean;
    twoFactorToken?: string;
    keySalt?: string;
    encryptedPrivateKey?: string;
    emailNotVerified?: boolean;
    keyMissing?: boolean;
}
export declare class AuthService {
    private readonly JWT_SECRET;
    private readonly JWT_REFRESH_SECRET;
    private readonly ACCESS_TOKEN_EXPIRY;
    private readonly REFRESH_TOKEN_EXPIRY;
    private readonly ACCESS_TOKEN_EXPIRY_SECONDS;
    constructor();
    private get db();
    private get redis();
    register(data: {
        email: string;
        username: string;
        password: string;
        displayName: string;
        publicKey?: string;
        encryptedPrivateKey?: string;
        keySalt?: string;
    }, ipAddress?: string, userAgent?: string): Promise<AuthResult>;
    login(email: string, password: string, ipAddress?: string, userAgent?: string): Promise<AuthResult>;
    loginWith2FA(twoFactorToken: string, totpCode: string, ipAddress?: string, userAgent?: string): Promise<AuthResult>;
    refreshTokens(refreshToken: string): Promise<AuthResult>;
    logout(refreshToken: string): Promise<void>;
    logoutAll(userId: string): Promise<void>;
    verifyAccessToken(token: string): {
        valid: boolean;
        userId?: string;
    };
    getCurrentUser(userId: string): Promise<User | null>;
    private generateTokens;
    getSessions(userId: string): Promise<{
        id: string;
        userAgent: string | null;
        ipAddress: string | null;
        createdAt: Date;
        expiresAt: Date;
    }[]>;
    revokeSession(userId: string, sessionId: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    private createDefaultConsents;
    sendEmailVerification(userId: string, email: string, username: string): Promise<boolean>;
    verifyEmail(token: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    resendVerificationEmail(userId: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    resendVerificationEmailByAddress(email: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    getUserE2EEKeys(userId: string): Promise<{
        keySalt: string | null;
        encryptedPrivateKey: string | null;
        publicKey: string | null;
    }>;
    saveUserKeys(userId: string, publicKey: string, encryptedPrivateKey: string, keySalt: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    requestPasswordReset(email: string): Promise<{
        success: boolean;
    }>;
    resetPassword(token: string, newPassword: string): Promise<{
        success: boolean;
        error?: string;
    }>;
}
export declare const authService: AuthService;
export {};
//# sourceMappingURL=auth.service.d.ts.map