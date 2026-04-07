"use strict";
// ==========================================
// ALFYCHAT - ROUTES CLÉS SIGNAL (E2EE)
// Distribution de clés publiques — Signal Protocol (X3DH)
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.keysRouter = void 0;
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const keys_controller_1 = require("../controllers/keys.controller");
const auth_1 = require("../middleware/auth");
const validate_1 = require("../middleware/validate");
exports.keysRouter = (0, express_1.Router)();
// GET /api/users/keys/status — Statut des clés de l'utilisateur courant
exports.keysRouter.get('/status', auth_1.authMiddleware, keys_controller_1.signalKeysController.getStatus.bind(keys_controller_1.signalKeysController));
// PUT /api/users/keys — Publier le bundle de clés Signal
exports.keysRouter.put('/', auth_1.authMiddleware, (0, express_validator_1.body)('registrationId').isInt({ min: 1 }).withMessage('registrationId requis'), (0, express_validator_1.body)('identityKey').isString().notEmpty().withMessage('identityKey requis'), (0, express_validator_1.body)('signedPrekey.keyId').isInt({ min: 0 }).withMessage('signedPrekey.keyId requis'), (0, express_validator_1.body)('signedPrekey.publicKey').isString().notEmpty().withMessage('signedPrekey.publicKey requis'), (0, express_validator_1.body)('signedPrekey.signature').isString().notEmpty().withMessage('signedPrekey.signature requis'), (0, express_validator_1.body)('prekeys').optional().isArray(), validate_1.validateRequest, keys_controller_1.signalKeysController.publishBundle.bind(keys_controller_1.signalKeysController));
// POST /api/users/keys/prekeys — Recharger les one-time prekeys
exports.keysRouter.post('/prekeys', auth_1.authMiddleware, (0, express_validator_1.body)('prekeys').isArray({ min: 1 }).withMessage('prekeys requis (tableau non vide)'), validate_1.validateRequest, keys_controller_1.signalKeysController.addPrekeys.bind(keys_controller_1.signalKeysController));
// PATCH /api/users/keys/ecdh — Mettre à jour la clé ECDH P-256 uniquement
exports.keysRouter.patch('/ecdh', auth_1.authMiddleware, (0, express_validator_1.body)('ecdhKey').isString().notEmpty().withMessage('ecdhKey requis'), validate_1.validateRequest, keys_controller_1.signalKeysController.updateECDHKey.bind(keys_controller_1.signalKeysController));
// PUT /api/users/keys/private-bundle — Stocker le bundle privé chiffré
exports.keysRouter.put('/private-bundle', auth_1.authMiddleware, (0, express_validator_1.body)('encryptedBundle').isString().notEmpty().withMessage('encryptedBundle requis'), validate_1.validateRequest, keys_controller_1.signalKeysController.uploadPrivateBundle.bind(keys_controller_1.signalKeysController));
// GET /api/users/keys/private-bundle — Récupérer le bundle privé chiffré
exports.keysRouter.get('/private-bundle', auth_1.authMiddleware, keys_controller_1.signalKeysController.downloadPrivateBundle.bind(keys_controller_1.signalKeysController));
// GET /api/users/keys/:userId — Récupérer le bundle d'un autre utilisateur (consomme une prekey)
exports.keysRouter.get('/:userId', keys_controller_1.signalKeysController.getBundle.bind(keys_controller_1.signalKeysController));
//# sourceMappingURL=keys.js.map