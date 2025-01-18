export enum TaskPriority {
    HIGHEST = 'HIGHEST', // 🔺
    HIGH = 'HIGH',      // ⏫
    MEDIUM = 'MEDIUM',  // 🔼
    LOW = 'LOW',        // 🔽
    LOWEST = 'LOWEST',  // ⏬
    NONE = 'NONE'      // 无优先级
}

export interface Task {
    id: string;
    title: string;
    completed: boolean;
    timeSpent: number;
    isTimerRunning: boolean;
    timerStartTime?: number;
    startedAt?: number;
    completedAt?: number;
    completedBy?: string;
    isUrgent?: boolean;
    isImportant?: boolean;
    category?: string;
    type?: 'normal' | 'checkin';
    checkinFolder?: string;
    startDate?: string;
    dueDate?: string;
    reminder?: boolean;
    reminderTime?: string;
    hideBeforeStart?: boolean;
    priority: TaskPriority;
    actualStartTime?: number;
    timeRecords: {
        date: string;
        startTime: number;
        pauseTimes: { start: number; end: number; }[];
        dailyTimeSpent: number;
    }[];
    totalTimeSpent: number;
    lastReminder?: string; // 最后一次提醒时间  
} 

enum TaskCategory {
    WORK = "工作",
    STUDY = "学习",
    LIFE = "生活",
    PROJECT = "项目",
    OTHER = "其他"
}