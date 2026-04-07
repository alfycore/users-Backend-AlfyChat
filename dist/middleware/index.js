"use strict";
// ==========================================
// ALFYCHAT - INDEX DES MIDDLEWARES
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequest = exports.authMiddleware = void 0;
var auth_1 = require("./auth");
Object.defineProperty(exports, "authMiddleware", { enumerable: true, get: function () { return auth_1.authMiddleware; } });
var validate_1 = require("./validate");
Object.defineProperty(exports, "validateRequest", { enumerable: true, get: function () { return validate_1.validateRequest; } });
//# sourceMappingURL=index.js.map