type ServiceType = 'users' | 'messages' | 'friends' | 'calls' | 'servers' | 'bots' | 'media';
/** Middleware Express à appeler dans chaque service pour compter les requêtes */
export declare function trackRequest(bytes?: number): void;
/** Collecte les métriques du process Node */
export declare function collectServiceMetrics(): {
    ramUsage: number;
    ramMax: number;
    cpuUsage: number;
    cpuMax: number;
    bandwidthUsage: number;
    requestCount20min: number;
};
/**
 * Démarre l'enregistrement + heartbeat auprès du gateway via le nouveau système LB.
 * Utilise SERVICE_KEY (sk_...) pour s'authentifier.
 * À appeler une fois dans le callback de `app.listen()`.
 */
export declare function startServiceRegistration(serviceType: ServiceType): void;
/**
 * Middleware Express léger pour compter les requêtes et le débit.
 * À placer en début de pipeline : app.use(serviceMetricsMiddleware)
 */
export declare function serviceMetricsMiddleware(req: any, res: any, next: () => void): void;
export {};
//# sourceMappingURL=service-client.d.ts.map