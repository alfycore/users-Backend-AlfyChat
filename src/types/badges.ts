// ==========================================
// ALFYCHAT - TYPES DE BADGES UTILISATEURS
// ==========================================

export interface UserBadge {
  id: string;
  name: string;
  icon: string; // Emoji ou nom d'icône Lucide
  color: string; // Couleur hex pour le badge
  earnedAt: string; // ISO date
}

export enum BadgeType {
  // Badges fondateurs
  FOUNDER = 'founder',
  EARLY_SUPPORTER = 'early_supporter',
  BETA_TESTER = 'beta_tester',

  // Badges d'ancienneté
  MEMBER_1_YEAR = 'member_1_year',
  MEMBER_2_YEARS = 'member_2_years',
  MEMBER_3_YEARS = 'member_3_years',

  // Badges d'activité
  ACTIVE_DEVELOPER = 'active_developer',
  BUG_HUNTER = 'bug_hunter',
  VERIFIED_BOT_DEVELOPER = 'verified_bot_developer',

  // Badges de contribution
  CONTRIBUTOR = 'contributor',
  TRANSLATOR = 'translator',
  MODERATOR = 'moderator',

  // Badges spéciaux
  PARTNER = 'partner',
  STAFF = 'staff',
  PREMIUM = 'premium',
  BOOSTER = 'booster',
}

export interface BadgeDefinition {
  id: BadgeType;
  name: string;
  description: string;
  icon: string;
  color: string;
  order: number; // Pour l'ordre d'affichage
}

export const BADGE_DEFINITIONS: Record<BadgeType, BadgeDefinition> = {
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
