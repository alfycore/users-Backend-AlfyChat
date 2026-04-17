// ==========================================
// ALFYCHAT - TYPES EXPRESS ÉTENDUS
// ==========================================

import { Request } from 'express';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: 'user' | 'moderator' | 'admin' | 'support_l1' | 'support_l2' | 'technician';
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userRole?: 'user' | 'moderator' | 'admin' | 'support_l1' | 'support_l2' | 'technician';
    }
  }
}
