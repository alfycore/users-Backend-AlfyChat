export declare class TwoFactorService {
    private get db();
    private get redis();
    generateSecret(userId: string, userEmail: string): Promise<{
        secret: string;
        otpauthUrl: string;
        qrCodeDataUrl: string;
    }>;
    enable(userId: string, totpCode: string): Promise<{
        success: boolean;
        error?: string;
        backupCodes?: string[];
    }>;
    disable(userId: string, totpCode: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    verify(userId: string, totpCode: string): Promise<boolean>;
    isEnabled(userId: string): Promise<boolean>;
    createPendingSession(userId: string): Promise<string>;
    resolvePendingSession(token: string): Promise<string | null>;
    private generateBackupCodes;
}
export declare const twoFactorService: TwoFactorService;
//# sourceMappingURL=twofa.service.d.ts.map