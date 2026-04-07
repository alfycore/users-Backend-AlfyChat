export interface SignalKeyBundle {
    registrationId: number;
    identityKey: string;
    ecdhKey?: string;
    signedPrekey: {
        keyId: number;
        publicKey: string;
        signature: string;
    };
    prekeys: Array<{
        keyId: number;
        publicKey: string;
    }>;
}
export interface PreKeyBundleResponse {
    userId: string;
    registrationId: number;
    identityKey: string;
    ecdhKey?: string;
    signedPrekey: {
        keyId: number;
        publicKey: string;
        signature: string;
    };
    prekey?: {
        keyId: number;
        publicKey: string;
    };
}
export declare class SignalKeysService {
    private get db();
    /**
     * Publie ou met à jour le bundle de clés Signal d'un utilisateur.
     * Seules les clés PUBLIQUES sont acceptées.
     */
    publishBundle(userId: string, bundle: SignalKeyBundle): Promise<void>;
    /**
     * Récupère le bundle de clés d'un utilisateur pour initier une session X3DH.
     * Consomme (supprime) une one-time prekey si disponible.
     */
    getBundle(targetUserId: string): Promise<PreKeyBundleResponse | null>;
    /**
     * Ajoute de nouvelles one-time prekeys (rechargement périodique).
     */
    addOneTimePrekeys(userId: string, prekeys: Array<{
        keyId: number;
        publicKey: string;
    }>): Promise<void>;
    /**
     * Nombre de one-time prekeys restantes pour un utilisateur.
     */
    getPrekeyCount(userId: string): Promise<number>;
    /**
     * Vérifie si un utilisateur a publié un bundle Signal.
     */
    hasBundle(userId: string): Promise<boolean>;
    /**
     * Met à jour uniquement la clé ECDH P-256 du bundle existant.
     */
    updateECDHKey(userId: string, ecdhKey: string): Promise<void>;
    /**
     * Stocke le bundle de clés privées chiffré avec le mot de passe de l'utilisateur.
     * Le serveur ne peut PAS déchiffrer ce blob — seul le client avec le bon mot de passe peut.
     */
    storePrivateBundle(userId: string, encryptedBlob: string): Promise<void>;
    /**
     * Récupère le bundle de clés privées chiffré pour un utilisateur.
     * Retourne null si aucun bundle n'a encore été stocké.
     */
    getPrivateBundle(userId: string): Promise<string | null>;
}
export declare const signalKeysService: SignalKeysService;
//# sourceMappingURL=keys.service.d.ts.map