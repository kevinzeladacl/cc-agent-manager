import * as fs from 'fs';
import * as path from 'path';

export interface DailyActivity {
    date: string;
    messageCount: number;
    sessionCount: number;
    toolCallCount: number;
}

export interface ModelTokens {
    inputTokens: number;
    outputTokens: number;
    cacheRead?: number;
    cacheCreation?: number;
}

export interface GlobalStats {
    totalSessions: number;
    totalMessages: number;
    longestSession: number;
    firstSessionDate: string;
    dailyActivity: DailyActivity[];
    modelUsage: Record<string, ModelTokens>;
    hourCounts: Record<string, number>;
}

export interface ProjectStats {
    sessions: number;
    messages: number;
}

export interface ProjectBreakdownEntry {
    project: string;
    sessions: number;
    messages: number;
}

export interface HistoryEntry {
    display: string;
    timestamp: number;
    project: string;
    sessionId: string;
}

export class MetricsService {
    private homedir: string;

    constructor() {
        this.homedir = process.env.HOME || process.env.USERPROFILE || '';
    }

    getGlobalStats(): GlobalStats | null {
        const statsPath = path.join(this.homedir, '.claude', 'stats-cache.json');
        if (!fs.existsSync(statsPath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(statsPath, 'utf-8');
            const data = JSON.parse(content);

            return {
                totalSessions: data.totalSessions || 0,
                totalMessages: data.totalMessages || 0,
                longestSession: data.longestSession || 0,
                firstSessionDate: data.firstSessionDate || '',
                dailyActivity: Array.isArray(data.dailyActivity) ? data.dailyActivity : [],
                modelUsage: data.modelUsage || {},
                hourCounts: data.hourCounts || {}
            };
        } catch {
            return null;
        }
    }

    getProjectStats(projectPath: string): ProjectStats {
        const result: ProjectStats = { sessions: 0, messages: 0 };
        const historyPath = path.join(this.homedir, '.claude', 'history.jsonl');

        if (!fs.existsSync(historyPath)) {
            return result;
        }

        try {
            const content = fs.readFileSync(historyPath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            const sessionIds = new Set<string>();

            for (const line of lines) {
                try {
                    const entry: HistoryEntry = JSON.parse(line);
                    if (entry.project && this.normalizePath(entry.project) === this.normalizePath(projectPath)) {
                        result.messages++;
                        if (entry.sessionId) {
                            sessionIds.add(entry.sessionId);
                        }
                    }
                } catch {
                    // Skip malformed lines
                }
            }

            result.sessions = sessionIds.size;
        } catch {
            // File read failed
        }

        return result;
    }

    getProjectBreakdown(): ProjectBreakdownEntry[] {
        const historyPath = path.join(this.homedir, '.claude', 'history.jsonl');

        if (!fs.existsSync(historyPath)) {
            return [];
        }

        const projectMap = new Map<string, { sessions: Set<string>; messages: number }>();

        try {
            const content = fs.readFileSync(historyPath, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());

            for (const line of lines) {
                try {
                    const entry: HistoryEntry = JSON.parse(line);
                    const project = entry.project || 'Unknown';

                    if (!projectMap.has(project)) {
                        projectMap.set(project, { sessions: new Set(), messages: 0 });
                    }

                    const data = projectMap.get(project)!;
                    data.messages++;
                    if (entry.sessionId) {
                        data.sessions.add(entry.sessionId);
                    }
                } catch {
                    // Skip malformed lines
                }
            }
        } catch {
            // File read failed
        }

        const entries: ProjectBreakdownEntry[] = [];
        for (const [project, data] of projectMap) {
            entries.push({
                project,
                sessions: data.sessions.size,
                messages: data.messages
            });
        }

        return entries.sort((a, b) => b.messages - a.messages);
    }

    getRecentActivity(days: number): DailyActivity[] {
        const stats = this.getGlobalStats();
        if (!stats || !stats.dailyActivity.length) {
            return [];
        }

        return stats.dailyActivity
            .slice(-days)
            .reverse();
    }

    formatModelName(modelId: string): string {
        // Exact matches
        const mappings: Record<string, string> = {
            'claude-opus-4-6': 'Opus 4.6',
            'claude-opus-4-5-20250514': 'Opus 4.5',
            'claude-sonnet-4-5-20250929': 'Sonnet 4.5',
            'claude-sonnet-4-5-20250514': 'Sonnet 4.5',
            'claude-haiku-4-5-20251001': 'Haiku 4.5',
            'claude-3-5-sonnet-20241022': 'Sonnet 3.5',
            'claude-3-5-haiku-20241022': 'Haiku 3.5',
        };

        if (mappings[modelId]) {
            return mappings[modelId];
        }

        // Pattern-based: extract family + version
        const opusMatch = modelId.match(/opus-(\d+)-(\d+)/);
        if (opusMatch) { return `Opus ${opusMatch[1]}.${opusMatch[2]}`; }

        const sonnetMatch = modelId.match(/sonnet-(\d+)-(\d+)/);
        if (sonnetMatch) { return `Sonnet ${sonnetMatch[1]}.${sonnetMatch[2]}`; }

        const haikuMatch = modelId.match(/haiku-(\d+)-(\d+)/);
        if (haikuMatch) { return `Haiku ${haikuMatch[1]}.${haikuMatch[2]}`; }

        // Fallback: just the family name
        if (modelId.includes('opus')) { return 'Opus'; }
        if (modelId.includes('sonnet')) { return 'Sonnet'; }
        if (modelId.includes('haiku')) { return 'Haiku'; }

        return modelId;
    }

    formatDate(dateStr: string): string {
        if (!dateStr) { return 'N/A'; }
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) { return dateStr; }
            return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return dateStr;
        }
    }

    formatNumber(num: number): string {
        if (num >= 1_000_000) {
            return `${(num / 1_000_000).toFixed(1)}M`;
        }
        if (num >= 1_000) {
            return `${(num / 1_000).toFixed(1)}K`;
        }
        return num.toLocaleString();
    }

    private normalizePath(p: string): string {
        return path.normalize(p).replace(/\/+$/, '');
    }
}
