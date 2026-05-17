export declare function reportErrorToGateway(opts: {
    errorType: string;
    message: string;
    stack?: string;
    severity?: 'info' | 'warning' | 'critical';
}): Promise<void>;
export declare function registerGlobalErrorHandlers(): void;
//# sourceMappingURL=error-reporter.d.ts.map