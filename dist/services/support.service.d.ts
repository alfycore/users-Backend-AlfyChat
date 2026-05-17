export interface SupportCategory {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    iconName: string;
    color: string;
    sortOrder: number;
    isActive: boolean;
    articleCount?: number;
}
export interface SupportArticle {
    id: string;
    categoryId: string | null;
    categorySlug?: string | null;
    slug: string;
    title: string;
    summary: string | null;
    content: string | null;
    tags: string[];
    isPublished: boolean;
    isPinned: boolean;
    viewCount: number;
    sortOrder: number;
    authorId: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface SupportAnnouncement {
    id: string;
    type: 'incident' | 'maintenance' | 'news';
    title: string;
    summary: string | null;
    content: string | null;
    isResolved: boolean;
    isPublished: boolean;
    publishedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}
export interface SupportKnownIssue {
    id: string;
    title: string;
    description: string | null;
    status: 'investigating' | 'in_progress' | 'resolved';
    categoryLabel: string | null;
    createdAt: Date;
    updatedAt: Date;
}
declare class SupportService {
    private get db();
    private fmtCategory;
    private fmtArticle;
    private fmtAnnouncement;
    private fmtIssue;
    getCategories(onlyActive?: boolean): Promise<SupportCategory[]>;
    getCategoryBySlug(slug: string): Promise<SupportCategory | null>;
    createCategory(data: {
        slug: string;
        title: string;
        description?: string;
        iconName?: string;
        color?: string;
        sortOrder?: number;
    }): Promise<SupportCategory>;
    updateCategory(id: string, data: Partial<{
        slug: string;
        title: string;
        description: string;
        iconName: string;
        color: string;
        sortOrder: number;
        isActive: boolean;
    }>): Promise<void>;
    deleteCategory(id: string): Promise<void>;
    getArticles(filters?: {
        categoryId?: string;
        categorySlug?: string;
        publishedOnly?: boolean;
        search?: string;
        limit?: number;
        offset?: number;
    }): Promise<SupportArticle[]>;
    getArticleBySlug(slug: string, incrementView?: boolean): Promise<SupportArticle | null>;
    getPopularArticles(limit?: number): Promise<SupportArticle[]>;
    createArticle(data: {
        categoryId?: string;
        slug: string;
        title: string;
        summary?: string;
        content?: string;
        tags?: string[];
        isPinned?: boolean;
        sortOrder?: number;
        authorId?: string;
    }): Promise<SupportArticle>;
    updateArticle(id: string, data: Partial<{
        categoryId: string | null;
        slug: string;
        title: string;
        summary: string;
        content: string;
        tags: string[];
        isPublished: boolean;
        isPinned: boolean;
        sortOrder: number;
    }>): Promise<void>;
    deleteArticle(id: string): Promise<void>;
    getAnnouncements(publishedOnly?: boolean, limit?: number): Promise<SupportAnnouncement[]>;
    createAnnouncement(data: {
        type: string;
        title: string;
        summary?: string;
        content?: string;
        isResolved?: boolean;
    }): Promise<SupportAnnouncement>;
    updateAnnouncement(id: string, data: Partial<{
        type: string;
        title: string;
        summary: string;
        content: string;
        isResolved: boolean;
        isPublished: boolean;
    }>): Promise<void>;
    deleteAnnouncement(id: string): Promise<void>;
    getKnownIssues(): Promise<SupportKnownIssue[]>;
    createKnownIssue(data: {
        title: string;
        description?: string;
        status?: string;
        categoryLabel?: string;
    }): Promise<SupportKnownIssue>;
    updateKnownIssue(id: string, data: Partial<{
        title: string;
        description: string;
        status: string;
        categoryLabel: string;
    }>): Promise<void>;
    deleteKnownIssue(id: string): Promise<void>;
}
export declare const supportService: SupportService;
export {};
//# sourceMappingURL=support.service.d.ts.map