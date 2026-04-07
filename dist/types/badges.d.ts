export interface UserBadge {
    id: string;
    name: string;
    icon: string;
    color: string;
    earnedAt: string;
}
export declare enum BadgeType {
    FOUNDER = "founder",
    EARLY_SUPPORTER = "early_supporter",
    BETA_TESTER = "beta_tester",
    MEMBER_1_YEAR = "member_1_year",
    MEMBER_2_YEARS = "member_2_years",
    MEMBER_3_YEARS = "member_3_years",
    ACTIVE_DEVELOPER = "active_developer",
    BUG_HUNTER = "bug_hunter",
    VERIFIED_BOT_DEVELOPER = "verified_bot_developer",
    CONTRIBUTOR = "contributor",
    TRANSLATOR = "translator",
    MODERATOR = "moderator",
    PARTNER = "partner",
    STAFF = "staff",
    PREMIUM = "premium",
    BOOSTER = "booster"
}
export interface BadgeDefinition {
    id: BadgeType;
    name: string;
    description: string;
    icon: string;
    color: string;
    order: number;
}
export declare const BADGE_DEFINITIONS: Record<BadgeType, BadgeDefinition>;
//# sourceMappingURL=badges.d.ts.map