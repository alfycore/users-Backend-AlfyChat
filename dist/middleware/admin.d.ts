import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/express';
export declare function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
/** Middleware acceptant admin + tous les rôles staff (support, technicien, modérateur) */
export declare function staffMiddleware(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=admin.d.ts.map