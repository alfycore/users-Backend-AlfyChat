export declare class EmailService {
    sendVerificationEmail(to: string, username: string, token: string): Promise<boolean>;
    sendTwoFactorCode(to: string, username: string, code: string): Promise<boolean>;
    sendPasswordResetEmail(to: string, username: string, token: string): Promise<boolean>;
    private send;
}
export declare const emailService: EmailService;
//# sourceMappingURL=email.service.d.ts.map