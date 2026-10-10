// ==========================================
// ALFYCHAT - TYPES EXPRESS ÉTENDUS
// ==========================================

import { Request } from 'express';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: 'user' | 'moderator' | 'admin' | 'support_l1' | 'support_l2' | 'technician';
  /** Session (ligne `sessions`) du jeton d'accès, si connue. */
  sessionId?: string;
  /** Requête interne authentifiée par le secret partagé. */
  isInternal?: boolean;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: 'user' | 'moderator' | 'admin' | 'support_l1' | 'support_l2' | 'technician';
      sessionId?: string;
      isInternal?: boolean;
    }
  }
}
