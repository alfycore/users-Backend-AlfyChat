"use strict";
// ==========================================
// ALFYCHAT - INDEX DES SERVICES
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.RgpdService = exports.rgpdService = exports.AuthService = exports.authService = exports.UserService = exports.userService = void 0;
var users_service_1 = require("./users.service");
Object.defineProperty(exports, "userService", { enumerable: true, get: function () { return users_service_1.userService; } });
Object.defineProperty(exports, "UserService", { enumerable: true, get: function () { return users_service_1.UserService; } });
var auth_service_1 = require("./auth.service");
Object.defineProperty(exports, "authService", { enumerable: true, get: function () { return auth_service_1.authService; } });
Object.defineProperty(exports, "AuthService", { enumerable: true, get: function () { return auth_service_1.AuthService; } });
var rgpd_service_1 = require("./rgpd.service");
Object.defineProperty(exports, "rgpdService", { enumerable: true, get: function () { return rgpd_service_1.rgpdService; } });
Object.defineProperty(exports, "RgpdService", { enumerable: true, get: function () { return rgpd_service_1.RgpdService; } });
//# sourceMappingURL=index.js.map