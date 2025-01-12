export enum TaskPriority {
    HIGH = "高",
    MEDIUM = "中",
    LOW = "低",
    NONE = "无"
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
} 

enum TaskCategory {
    WORK = "工作",
    STUDY = "学习",
    LIFE = "生活",
    PROJECT = "项目",
    OTHER = "其他"
}