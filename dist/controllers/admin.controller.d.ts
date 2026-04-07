import { Response } from 'express';
import { AuthRequest } from '../types/express';
export declare class AdminController {
    getAllBadges(req: AuthRequest, res: Response): Promise<void>;
    createBadge(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateBadge(req: AuthRequest, res: Response): Promise<void>;
    toggleBadgeStatus(req: AuthRequest, res: Response): Promise<void>;
    deleteBadge(req: AuthRequest, res: Response): Promise<void>;
    assignBadgeToUser(req: AuthRequest, res: Response): Promise<void>;
    removeBadgeFromUser(req: AuthRequest, res: Response): Promise<void>;
    getAllUsers(req: AuthRequest, res: Response): Promise<void>;
    searchUsers(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateUserRole(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getStats(req: AuthRequest, res: Response): Promise<void>;
    getSiteSettings(req: AuthRequest, res: Response): Promise<void>;
    updateSiteSetting(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    createInviteLink(req: AuthRequest, res: Response): Promise<void>;
    getInviteLinks(req: AuthRequest, res: Response): Promise<void>;
    deleteInviteLink(req: AuthRequest, res: Response): Promise<void>;
}
export declare const adminController: AdminController;
//# sourceMappingURL=admin.controller.d.ts.map