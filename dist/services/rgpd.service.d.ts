interface Consent {
    id: string;
    consentType: string;
    granted: boolean;
    grantedAt: Date | null;
    revokedAt: Date | null;
}
interface UserDataExport {
    user: any;
    preferences: any;
    messages: any[];
    friends: any[];
    servers: any[];
    consents: Consent[];
    exportedAt: Date;
}
export declare class RgpdService {
    private get db();
    private get redis();
    exportUserData(userId: string): Promise<UserDataExport>;
    requestDeletion(userId: string): Promise<{
        scheduledDeletionAt: Date;
    }>;
    cancelDeletion(userId: string): Promise<void>;
    getConsents(userId: string): Promise<Consent[]>;
    updateConsent(userId: string, consentType: string, granted: boolean): Promise<void>;
    anonymizeUser(userId: string): Promise<void>;
    permanentlyDeleteUser(userId: string): Promise<void>;
}
export declare const rgpdService: RgpdService;
export {};
//# sourceMappingURL=rgpd.service.d.ts.map