"use strict";
// ==========================================
// ALFYCHAT - TYPES DE BADGES UTILISATEURS
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.BADGE_DEFINITIONS = exports.BadgeType = void 0;
var BadgeType;
(function (BadgeType) {
    // Badges fondateurs
    BadgeType["FOUNDER"] = "founder";
    BadgeType["EARLY_SUPPORTER"] = "early_supporter";
    BadgeType["BETA_TESTER"] = "beta_tester";
    // Badges d'ancienneté
    BadgeType["MEMBER_1_YEAR"] = "member_1_year";
    BadgeType["MEMBER_2_YEARS"] = "member_2_years";
    BadgeType["MEMBER_3_YEARS"] = "member_3_years";
    // Badges d'activité
    BadgeType["ACTIVE_DEVELOPER"] = "active_developer";
    BadgeType["BUG_HUNTER"] = "bug_hunter";
    BadgeType["VERIFIED_BOT_DEVELOPER"] = "verified_bot_developer";
    // Badges de contribution
    BadgeType["CONTRIBUTOR"] = "contributor";
    BadgeType["TRANSLATOR"] = "translator";
    BadgeType["MODERATOR"] = "moderator";
    // Badges spéciaux
    BadgeType["PARTNER"] = "partner";
    BadgeType["STAFF"] = "staff";
    BadgeType["PREMIUM"] = "premium";
    BadgeType["BOOSTER"] = "booster";
})(BadgeType || (exports.BadgeType = BadgeType = {}));
exports.BADGE_DEFINITIONS = {
    [BadgeType.FOUNDER]: {
        id: BadgeType.FOUNDER,
        name: 'Fondateur',
        description: 'Membre fondateur d\'AlfyChat',
        icon: '👑',
        color: '#FFD700',
        order: 1,
    },
    [BadgeType.EARLY_SUPPORTER]: {
        id: BadgeType.EARLY_SUPPORTER,
        name: 'Supporter Précoce',
        description: 'A soutenu AlfyChat dès le début',
        icon: '⭐',
        color: '#7289DA',
        order: 2,
    },
    [BadgeType.BETA_TESTER]: {
        id: BadgeType.BETA_TESTER,
        name: 'Testeur Bêta',
        description: 'A participé aux tests bêta',
        icon: '🧪',
        color: '#43B581',
        order: 3,
    },
    [BadgeType.MEMBER_1_YEAR]: {
        id: BadgeType.MEMBER_1_YEAR,
        name: 'Membre 1 An',
        description: 'Membre depuis 1 an',
        icon: '🎂',
        color: '#99AAB5',
        order: 10,
    },
    [BadgeType.MEMBER_2_YEARS]: {
        id: BadgeType.MEMBER_2_YEARS,
        name: 'Membre 2 Ans',
        description: 'Membre depuis 2 ans',
        icon: '🎉',
        color: '#99AAB5',
        order: 11,
    },
    [BadgeType.MEMBER_3_YEARS]: {
        id: BadgeType.MEMBER_3_YEARS,
        name: 'Membre 3 Ans',
        description: 'Membre depuis 3 ans',
        icon: '🎊',
        color: '#99AAB5',
        order: 12,
    },
    [BadgeType.ACTIVE_DEVELOPER]: {
        id: BadgeType.ACTIVE_DEVELOPER,
        name: 'Développeur Actif',
        description: 'Développeur actif sur AlfyChat',
        icon: '💻',
        color: '#5865F2',
        order: 20,
    },
    [BadgeType.BUG_HUNTER]: {
        id: BadgeType.BUG_HUNTER,
        name: 'Chasseur de Bugs',
        description: 'A trouvé des bugs critiques',
        icon: '🐛',
        color: '#43B581',
        order: 21,
    },
    [BadgeType.VERIFIED_BOT_DEVELOPER]: {
        id: BadgeType.VERIFIED_BOT_DEVELOPER,
        name: 'Développeur de Bot Vérifié',
        description: 'Développeur d\'un bot vérifié',
        icon: '🤖',
        color: '#5865F2',
        order: 22,
    },
    [BadgeType.CONTRIBUTOR]: {
        id: BadgeType.CONTRIBUTOR,
        name: 'Contributeur',
        description: 'A contribué au projet',
        icon: '🌟',
        color: '#FAA61A',
        order: 30,
    },
    [BadgeType.TRANSLATOR]: {
        id: BadgeType.TRANSLATOR,
        name: 'Traducteur',
        description: 'A aidé à traduire AlfyChat',
        icon: '🌍',
        color: '#3BA55D',
        order: 31,
    },
    [BadgeType.MODERATOR]: {
        id: BadgeType.MODERATOR,
        name: 'Modérateur',
        description: 'Modérateur AlfyChat',
        icon: '🛡️',
        color: '#ED4245',
        order: 40,
    },
    [BadgeType.PARTNER]: {
        id: BadgeType.PARTNER,
        name: 'Partenaire',
        description: 'Partenaire officiel',
        icon: '🤝',
        color: '#5865F2',
        order: 50,
    },
    [BadgeType.STAFF]: {
        id: BadgeType.STAFF,
        name: 'Staff',
        description: 'Membre de l\'équipe',
        icon: '👨‍💼',
        color: '#5865F2',
        order: 60,
    },
    [BadgeType.PREMIUM]: {
        id: BadgeType.PREMIUM,
        name: 'Premium',
        description: 'Abonné Premium',
        icon: '💎',
        color: '#F47FFF',
        order: 70,
    },
    [BadgeType.BOOSTER]: {
        id: BadgeType.BOOSTER,
        name: 'Booster',
        description: 'Booster de serveur',
        icon: '🚀',
        color: '#F47FFF',
        order: 71,
    },
};
//# sourceMappingURL=badges.js.map