"use strict";
// ==========================================
// ALFYCHAT - INDEX DES ROUTES
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.keysRouter = exports.adminRouter = exports.rgpdRouter = exports.authRouter = exports.usersRouter = void 0;
var users_1 = require("./users");
Object.defineProperty(exports, "usersRouter", { enumerable: true, get: function () { return users_1.usersRouter; } });
var auth_1 = require("./auth");
Object.defineProperty(exports, "authRouter", { enumerable: true, get: function () { return auth_1.authRouter; } });
var rgpd_1 = require("./rgpd");
Object.defineProperty(exports, "rgpdRouter", { enumerable: true, get: function () { return rgpd_1.rgpdRouter; } });
var admin_1 = require("./admin");
Object.defineProperty(exports, "adminRouter", { enumerable: true, get: function () { return admin_1.adminRouter; } });
var keys_1 = require("./keys");
Object.defineProperty(exports, "keysRouter", { enumerable: true, get: function () { return keys_1.keysRouter; } });
//# sourceMappingURL=index.js.map