import { Response } from 'express';
import { AuthRequest } from '../types/express';
export declare class RgpdController {
    exportData(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    requestDeletion(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    cancelDeletion(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    getConsents(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    updateConsent(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    anonymize(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const rgpdController: RgpdController;
//# sourceMappingURL=rgpd.controller.d.ts.map