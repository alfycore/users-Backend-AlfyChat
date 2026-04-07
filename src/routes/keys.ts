// ==========================================
// ALFYCHAT - ROUTES CLÉS SIGNAL (E2EE)
// Distribution de clés publiques — Signal Protocol (X3DH)
// ==========================================

import { Router } from 'express';
import { body } from 'express-validator';
import { signalKeysController } from '../controllers/keys.controller';
import { authMiddleware } from '../middleware/auth';
import { validateRequest } from '../middleware/validate';

export const keysRouter = Router();

// GET /api/users/keys/status — Statut des clés de l'utilisateur courant
keysRouter.get('/status',
  authMiddleware,
  signalKeysController.getStatus.bind(signalKeysController)
);

// PUT /api/users/keys — Publier le bundle de clés Signal
keysRouter.put('/',
  authMiddleware,
  body('registrationId').isInt({ min: 1 }).withMessage('registrationId requis'),
  body('identityKey').isString().notEmpty().withMessage('identityKey requis'),
  body('signedPrekey.keyId').isInt({ min: 0 }).withMessage('signedPrekey.keyId requis'),
  body('signedPrekey.publicKey').isString().notEmpty().withMessage('signedPrekey.publicKey requis'),
  body('signedPrekey.signature').isString().notEmpty().withMessage('signedPrekey.signature requis'),
  body('prekeys').optional().isArray(),
  validateRequest,
  signalKeysController.publishBundle.bind(signalKeysController)
);

// POST /api/users/keys/prekeys — Recharger les one-time prekeys
keysRouter.post('/prekeys',
  authMiddleware,
  body('prekeys').isArray({ min: 1 }).withMessage('prekeys requis (tableau non vide)'),
  validateRequest,
  signalKeysController.addPrekeys.bind(signalKeysController)
);

// PATCH /api/users/keys/ecdh — Mettre à jour la clé ECDH P-256 uniquement
keysRouter.patch('/ecdh',
  authMiddleware,
  body('ecdhKey').isString().notEmpty().withMessage('ecdhKey requis'),
  validateRequest,
  signalKeysController.updateECDHKey.bind(signalKeysController)
);

// PUT /api/users/keys/private-bundle — Stocker le bundle privé chiffré
keysRouter.put('/private-bundle',
  authMiddleware,
  body('encryptedBundle').isString().notEmpty().withMessage('encryptedBundle requis'),
  validateRequest,
  signalKeysController.uploadPrivateBundle.bind(signalKeysController)
);

// GET /api/users/keys/private-bundle — Récupérer le bundle privé chiffré
keysRouter.get('/private-bundle',
  authMiddleware,
  signalKeysController.downloadPrivateBundle.bind(signalKeysController)
);

// GET /api/users/keys/:userId — Récupérer le bundle d'un autre utilisateur (consomme une prekey)
keysRouter.get('/:userId',
  signalKeysController.getBundle.bind(signalKeysController)
);
