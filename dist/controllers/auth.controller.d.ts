import { Request, Response } from 'express';
import { AuthRequest } from '../types/express';
export declare class AuthController {
    getRegisterSettings(req: Request, res: Response): Promise<void>;
    register(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    login(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    refresh(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    logout(req: AuthRequest, res: Response): Promise<void>;
    logoutAll(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    verify(req: AuthRequest, res: Response): Promise<void>;
    me(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    verifyEmail(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    resendVerification(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    loginWith2FA(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    setup2FA(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    enable2FA(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    disable2FA(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    get2FAStatus(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getSessions(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    revokeSession(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const authController: AuthController;
//# sourceMappingURL=auth.controller.d.ts.map