import { Request, Response } from 'express';
import { AuthRequest } from '../types/express';
export declare class SignalKeysController {
    /**
     * PUT /api/users/keys
     * Publier ou mettre à jour le bundle de clés Signal de l'utilisateur courant.
     */
    publishBundle(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * GET /api/users/keys/status
     * Statut des clés de l'utilisateur courant (nombre de prekeys restantes).
     */
    getStatus(req: AuthRequest, res: Response): Promise<void>;
    /**
     * GET /api/users/keys/:userId
     * Récupérer le bundle de clés d'un autre utilisateur (pour initier une session X3DH).
     * Consomme une one-time prekey.
     */
    getBundle(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * POST /api/users/keys/prekeys
     * Recharger les one-time prekeys (appelé quand le stock est faible).
     */
    addPrekeys(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * PATCH /api/users/keys/ecdh
     * Met à jour uniquement la clé ECDH P-256 du bundle existant.
     */
    updateECDHKey(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * PUT /api/users/keys/private-bundle
     * Stocke le bundle de clés privées chiffré avec le mot de passe utilisateur.
     * Le serveur ne peut pas déchiffrer ce blob.
     */
    uploadPrivateBundle(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    /**
     * GET /api/users/keys/private-bundle
     * Récupère le bundle de clés privées chiffré de l'utilisateur courant.
     * Retourne null si aucun bundle chiffré n'a encore été stocké.
     */
    downloadPrivateBundle(req: AuthRequest, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
}
export declare const signalKeysController: SignalKeysController;
//# sourceMappingURL=keys.controller.d.ts.map