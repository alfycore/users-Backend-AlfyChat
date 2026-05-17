import { Request, Response } from 'express';
import { AuthRequest } from '../types/express';
export declare class UserController {
    getPublicKey(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getUser(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getUsers(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    searchUsers(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateProfile(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateStatus(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateCustomStatus(req: Request, res: Response): Promise<void>;
    updateLastSeen(req: Request, res: Response): Promise<void>;
    getPreferences(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updatePreferences(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    changePassword(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    checkUsernameAvailable(req: Request, res: Response): Promise<void>;
    changeUsername(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getBadges(req: Request, res: Response): Promise<void>;
    addBadge(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    removeBadge(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    toggleBadgesVisibility(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const userController: UserController;
//# sourceMappingURL=users.controller.d.ts.map