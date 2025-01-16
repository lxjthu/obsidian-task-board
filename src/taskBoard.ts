import moment from 'moment';
import { ItemView, WorkspaceLeaf, App, Modal, Setting, Notice, TFile } from 'obsidian';
import { Task, TaskPriority } from './types';
import * as yaml from 'js-yaml';


export const VIEW_TYPE_TASK_BOARD = 'task-kanban-view';

// 将接口移到类的外部
interface TaskBoardData {
    users: any[];
    tasks: Task[];
    rewardItems: any[];
    currentUserId: string;
    timers: {[key: string]: number};
    completions: TaskCompletion[];
}

// 定义任务完成记录的接口
interface TaskCompletion {
    taskName: string;
    reflection: string;
    timestamp: number;
    startedAt?: number;
    completedAt: number;
    timeSpent: number;
}

// 创建反思对话框
class ReflectionModal extends Modal {
    private reflection: string = '';
    private onSubmit: (reflection: string) => void;

    constructor(app: App, onSubmit: (reflection: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: '完成任务' });

        const textArea = contentEl.createEl('textarea', {
            attr: {
                placeholder: '记录一下完成心得...',
                rows: '6',
                style: 'width: 100%; margin: 10px 0;'
            }
        });

        textArea.addEventListener('input', (e) => {
            this.reflection = (e.target as HTMLTextAreaElement).value;
        });

        const buttonContainer = contentEl.createEl('div', {
            cls: 'reflection-button-container'
        });

        const submitButton = buttonContainer.createEl('button', {
            text: '提交',
            cls: 'mod-cta'
        });

        submitButton.addEventListener('click', () => {
            this.onSubmit(this.reflection);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

type ObsidianHTMLElement = HTMLElement;

export class TaskBoardView extends ItemView {
    contentEl: ObsidianHTMLElement;
    containerEl: ObsidianHTMLElement;
    private data: TaskBoardData;
    private completions: TaskCompletion[] = [];
    private reminderIntervalId: number;
    private _isOpeningNote: boolean = false;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.data = {
            users: [],
            tasks: [],
            rewardItems: [],
            currentUserId: '',
            timers: {},
            completions: []
        };
    }

    getViewType() {
        return VIEW_TYPE_TASK_BOARD;
    }

    getDisplayText() {
        return '任务看板';
    }

    async onOpen() {
        // 加载保存的数据
        await this.loadData();
        
        // 从加载的数据中恢复 completions
        this.completions = this.data.completions || [];

        // 创建界面
        this.contentEl = this.containerEl.children[1] as ObsidianHTMLElement;
        this.contentEl.empty();
        this.contentEl.addClass('task-board-container');

        // 创建主要区域
        this.createHeader();
        this.createUserSection();
        this.createTaskSection();
        this.createStatsSection();
        this.createRewardSection();

        // 添加今日总结按钮
        const summaryButton = this.containerEl.createEl("button", {
            text: "今日总结",
            attr: { style: "margin-top: 1em;" }
        });
        summaryButton.onclick = () => this.createDailySummary();

        // 启动提醒检查
        this.startReminderCheck();
    }

    private createHeader() {
        const header = this.contentEl.createEl('div', { cls: 'task-board-header' });
        header.createEl('h2', { text: '任务看板' });
    }

    private createUserSection() {
        const userSection = this.contentEl.createEl('div', { cls: 'task-board-user-section' });
        // 用户选择和管理界面
    }

    private createTaskSection() {
        const taskSection = this.contentEl.createEl("div", { cls: "task-board-task-section" });
        const addButton = taskSection.createEl("button", { text: "\u6DFB\u52A0\u4EFB\u52A1" });
        addButton.addEventListener("click", () => this.showAddTaskModal());
        
        const importButton = taskSection.createEl("button", { text: "\u4ECE\u7B14\u8BB0\u5BFC\u5165" });
        importButton.addEventListener("click", () => this.importFromObsidian());
        
        const taskList = taskSection.createEl("div", { cls: "task-list" });
        this.renderTasks(taskList);
    }

    private sortTasks(tasks: Task[]): Task[] {
        const priorityOrder = {
            [TaskPriority.HIGHEST]: 5,
            [TaskPriority.HIGH]: 4,
            [TaskPriority.MEDIUM]: 3,
            [TaskPriority.LOW]: 2,
            [TaskPriority.LOWEST]: 1,
            [TaskPriority.NONE]: 0
        };
        
        return tasks.sort((a, b) => {
            const priorityDiff = (priorityOrder[b.priority as TaskPriority || TaskPriority.NONE] - 
                        priorityOrder[a.priority as TaskPriority || TaskPriority.NONE])
            if (priorityDiff !== 0) return priorityDiff;
            
            return 0;
        });
    }


    private async importFromObsidian() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('请先打开包含任务列表的笔记');
            return;
        }
    
        try {
            const content = await this.app.vault.read(activeFile);
            const tasks = this.parseObsidianTasksToBoard(content);
            
            if (tasks.length === 0) {
                new Notice('未在当前笔记中找到任务');
                return;
            }
    
            // 显示导入预览对话框
            new TaskImportModal(this.app, tasks, async (selectedTasks) => {
                if (selectedTasks.length === 0) {
                    new Notice('未选择任何任务');
                    return;
                }
                
                this.data.tasks.push(...selectedTasks);
                await this.saveData();
                const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
                if (taskList) {
                    this.renderTasks(taskList);
                }
                
                new Notice(`成功导入 ${selectedTasks.length} 个任务`);
            }).open();
    
        } catch (error) {
            console.error('导入失败:', error);
            new Notice('导入失败，请检查笔记格式');
        }
    }

    private parseObsidianTasksToBoard(content: string): Task[] {
        const tasks: Task[] = [];
        const taskLines = content.split('\n').filter(line => 
            line.includes('- [ ]') || line.includes('- [x]')
        );
        
        taskLines.forEach((line, index) => {
            const completed = line.includes('- [x]');
            // 对输入的文本进行 Unicode 标准化处理
            let title = line.replace(/^- \[[x ]\] /, '').trim()
                .normalize('NFKC');  // 添加这一行进行标准化
            
            // 初始化任务属性
            const task: Task = {
                id: `import-${Date.now()}-${index}`,
                title: '',
                completed,
                timeSpent: 0,
                isTimerRunning: false,
                priority: TaskPriority.NONE,
                isUrgent: false,
                isImportant: false,
                category: '',
                startDate: undefined,
                dueDate: undefined,
                reminder: false,        // 添加提醒属性
                reminderTime: undefined, // 添加提醒时间属性
                actualStartTime: undefined,      // 任务首次开始时间
                timeRecords: [], // 每天的时间记录
                totalTimeSpent: 0,        // 总计用时
            };
            
             // 检查是否为打卡任务（在处理其他标签之前）
                if (title.includes('#打卡') || 
                title.includes('#checkin') || 
                title.toLowerCase().includes('打卡')) {  // 也可以根据任务标题判断
                task.type = 'checkin';  // 设置任务类型为打卡
                // 移除打卡标签
                title = title.replace(/#打卡|#checkin/g, '');
            }

            // 解析日期标签
            // 1. 先尝试匹配带标记的日期
            const startDateMatch = title.match(/\[start\]\s*(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)/);
            if (startDateMatch) {
                task.startDate = startDateMatch[1];
                if (!task.reminderTime) {
                    task.reminder = true;
                    task.reminderTime = startDateMatch[1];
                }
                // 移除匹配到的日期标记
                title = title.replace(/\[start\]\s*\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?/, '');
            }

            const dueDateMatch = title.match(/\[due\]\s*(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)/);
            if (dueDateMatch) {
                task.dueDate = dueDateMatch[1];
                task.reminder = true;
                task.reminderTime = dueDateMatch[1];
                // 移除匹配到的日期标记
                title = title.replace(/\[due\]\s*\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?/, '');
            }

            // 2. 如果没有匹配到带标记的日期，尝试匹配带图标的日期
            if (!task.startDate) {
                const iconStartMatch = title.match(/[🛫✈️🚀]\s*(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)/);
                if (iconStartMatch) {
                    task.startDate = iconStartMatch[1];
                    title = title.replace(/[🛫✈️🚀]\s*\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\s*/, '');  // 添加末尾的 \s*
                }
            }

            if (!task.dueDate) {
                const iconDueMatch = title.match(/[📅⏰🗓️]\s*(\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?)/);
                if (iconDueMatch) {
                    task.dueDate = iconDueMatch[1];
                    title = title.replace(/[📅⏰🗓️]\s*\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\s*/, '');  // 添加末尾的 \s*
                }
            }

            // 3. 如果还没有匹配到日期，则按顺序处理剩余的日期
            // 第一个日期作为开始时间，第二个日期作为截止时间
            const remainingDates = title.match(/\b\d{4}-\d{2}-\d{2}(?:\s\d{2}:\d{2})?\b/g) || [];
            if (remainingDates.length > 0) {
                if (!task.startDate) {
                    task.startDate = remainingDates[0];
                }
                if (!task.dueDate && remainingDates.length > 1) {
                    task.dueDate = remainingDates[1];
                }
                // 移除所有已处理的日期
                remainingDates.forEach(date => {
                    title = title.replace(date, '');
                });
            }
            
            const priorityMatch = title.match(/([🔺⏫🔼🔽⏬])/);
            if (priorityMatch) {
            switch (priorityMatch[1]) {
                case '🔺':
                    task.priority = TaskPriority.HIGHEST;
                    break;
                case '⏫':
                    task.priority = TaskPriority.HIGH;
                    break;
                case '🔼':
                    task.priority = TaskPriority.MEDIUM;
                    break;
                case '🔽':
                    task.priority = TaskPriority.LOW;
                    break;
                case '⏬':
                    task.priority = TaskPriority.LOWEST;
                    break;
            }
           // 移除优先级符号
            title = title.replace(/[🔺⏫🔼🔽⏬]/, '');
        }
            // 解析标签
            const tags = title.match(/#[\w\u4e00-\u9fa5]+/g) || [];
            
            tags.forEach(tag => {
                const tagText = tag.substring(1).toLowerCase();
                
                // 检查优先级
                if (tagText === '最高' || tagText === 'highest') {
                    task.priority = TaskPriority.HIGHEST;
                } else if (tagText === '高' || tagText === 'high') {
                    task.priority = TaskPriority.HIGH;
                } else if (tagText === '中' || tagText === 'medium') {
                    task.priority = TaskPriority.MEDIUM;
                } else if (tagText === '低' || tagText === 'low') {
                    task.priority = TaskPriority.LOW;
                } else if (tagText === '最低' || tagText === 'lowest') {
                    task.priority = TaskPriority.LOWEST;
                }
                
                // 检查紧急/重要标记
                if (tagText === '紧急' || tagText === 'urgent') {
                    task.isUrgent = true;
                }
                if (tagText === '重要' || tagText === 'important') {
                    task.isImportant = true;
                }
                
                // 检查分类（排除特定标签）
                if (!['高', 'high', '中', 'medium', '低', 'low', 
                     '紧急', 'urgent', '重要', 'important', 
                     'task' // 添加 task 到排除列表
                    ].includes(tagText)) {
                    task.category = tagText;
                }
            });
            
            // 移除标签，只保留任务标题
            task.title = title.replace(/#[\w\u4e00-\u9fa5]+/g, '').trim();
            
            tasks.push(task);
        });
        
        return tasks;
    }
    private renderTasks(container: ObsidianHTMLElement) {
        // 过滤任务
        const tasksToShow = this.data.tasks.filter(task => {
            if (task.hideBeforeStart && task.startDate) {
                const startDate = moment(task.startDate).startOf('day');
                const today = moment().startOf('day');
                return startDate.isSameOrBefore(today);
            }
            return true;
        });

        container.empty();
        
        const sortedTasks = this.sortTasks(tasksToShow);
        
        sortedTasks.forEach(task => {
            const taskEl = container.createEl('div', { cls: 'task-item' });
            
            // 左侧复选框和标签区域
            const leftSection = taskEl.createEl('div', { cls: 'task-left-section' });
            
            // 复选框
            const checkbox = leftSection.createEl('input', {
                type: 'checkbox',
                cls: 'task-checkbox'
            });
            checkbox.checked = task.completed;
            
            // 添加点击事件处理
            checkbox.addEventListener('click', (e) => {
                e.preventDefault();  // 防止立即改变状态
                this.toggleTask(task.id);
            });
            
            // 标签区域（紧急、重要、优先级）
            const tagsSection = leftSection.createEl('div', { cls: 'task-tags-column' });
            
            // 打卡任务标签
            if (task.type === 'checkin') {
                const checkinTag = tagsSection.createEl('span', { 
                    cls: 'task-tag checkin',
                    text: '打卡'
                });
                // 添加点击事件
                checkinTag.classList.add('clickable');
                checkinTag.addEventListener('click', (e) => {
                    e.stopPropagation();  // 防止触发任务点击事件
                    this.toggleTask(task.id);
                });
            }
            
            if (task.isUrgent) {
                tagsSection.createEl('span', { 
                    cls: 'task-tag urgent',
                    text: '紧急'
                });
            }
            
            if (task.isImportant) {
                tagsSection.createEl('span', { 
                    cls: 'task-tag important',
                    text: '重要'
                });
            }
            
            if (task.priority && task.priority !== TaskPriority.NONE) {
                const prioritySymbols = {
                    [TaskPriority.HIGHEST]: '🔺',
                    [TaskPriority.HIGH]: '⏫',
                    [TaskPriority.MEDIUM]: '🔼',
                    [TaskPriority.LOW]: '🔽',
                    [TaskPriority.LOWEST]: '⏬'
                };
                
                tagsSection.createEl('span', {
                    cls: `task-priority priority-${task.priority.toLowerCase()}`,
                    text: prioritySymbols[task.priority] || ''
                });
            }

            // 中间区域（任务名称和时间信息）
            const middleSection = taskEl.createEl('div', { cls: 'task-middle-section' });
            
            // 任务标题
            const titleEl = middleSection.createEl('div', { 
                cls: 'task-title clickable',
                text: task.title
            });
            
            // 添加点击事件
            titleEl.addEventListener('click', () => {
                // 防止重复点击
                if (this._isOpeningNote) return;
                this._isOpeningNote = true;
                this.openOrCreateNote(task.title).finally(() => {
                    this._isOpeningNote = false;
                });
            });
            
            // 时间信息区域
            const timeInfoSection = middleSection.createEl('div', { cls: 'task-time-info-column' });
            
            // 开始时间
            if (task.startDate) {
                const startMoment = moment(task.startDate);
                const startTimeFormat = !task.startDate.includes(':') || task.startDate.endsWith('00:00')
                    ? 'MM-DD'  // 只有日期
                    : 'MM-DD HH:mm';  // 有具体时间
                timeInfoSection.createEl('div', { 
                    cls: 'task-date start-date',
                    text: `开始：${startMoment.format(startTimeFormat)}`
                });
            }
            
            // 截止时间
            if (task.dueDate) {
                const dueMoment = moment(task.dueDate);
                const dueTimeFormat = !task.dueDate.includes(':') || task.dueDate.endsWith('00:00')
                    ? 'MM-DD'  // 只有日期
                    : 'MM-DD HH:mm';  // 有具体时间
                timeInfoSection.createEl('div', { 
                    cls: 'task-date due-date',
                    text: `截止：${dueMoment.format(dueTimeFormat)}`
                });
            }
            
            // 计时器
            const timerSection = timeInfoSection.createEl('div', { cls: 'timer-container' });
            const today = moment().format('YYYY-MM-DD');
            const todayRecord = task.timeRecords?.find(r => r.date === today);
            const timeDisplay = timerSection.createEl('span', {
                cls: 'time-display',
                text: this.formatTime(todayRecord?.dailyTimeSpent || 0)  // 使用当日用时
            });

            // 右侧按钮区域
            const buttonSection = taskEl.createEl('div', { cls: 'task-button-column' });
            
            // 开始按钮
            const startBtn = buttonSection.createEl('button', {
                cls: `timer-btn ${task.isTimerRunning ? 'running' : ''}`,
                text: task.isTimerRunning ? '暂停' : '开始'
            });
            startBtn.addEventListener('click', () => {
                this.toggleTimer(task.id, timeDisplay);
            });
            
            // 清零按钮
            const resetBtn = buttonSection.createEl('button', {
                cls: 'timer-btn reset',
                text: '清零'
            });
            resetBtn.addEventListener('click', () => {
                this.resetTimer(task.id);
            });
            
            // 删除按钮
            const deleteBtn = buttonSection.createEl('button', {
                cls: 'timer-btn delete',
                text: '删除'
            });
            deleteBtn.addEventListener('click', () => {
                this.deleteTask(task.id);
            });

            // 编辑按钮
            const editBtn = taskEl.createEl('span', {
                cls: 'task-edit-button',
                attr: {
                    'aria-label': '编辑任务'
                }
            });
            editBtn.innerHTML = '✏️';
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();  // 防止触发任务点击事件
                this.editTask(task.id);
            });

            // ... 事件处理代码 ...
        });
    }

    private formatTime(seconds: number): string {
        // 添加安全检查
        if (!seconds || isNaN(seconds)) {
            return "00:00:00";
        }
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    private updateTimeDisplay(task: Task, displayEl: ObsidianHTMLElement) {
        if (!task.isTimerRunning) return;
        
        const now = Date.now();
        const totalSeconds = task.timeSpent + Math.floor((now - (task.timerStartTime || now)) / 1000);
        displayEl.textContent = this.formatTime(totalSeconds);
    }

    private async toggleTimer(taskId: string, timeDisplay: HTMLElement) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 初始化时间记录相关属性
        if (!task.timeRecords) task.timeRecords = [];
        if (!task.totalTimeSpent) task.totalTimeSpent = 0;

        const today = moment().format('YYYY-MM-DD');
        let todayRecord = task.timeRecords.find(r => r.date === today);

        // 获取按钮元素
        const button = timeDisplay.closest('.task-item')?.querySelector('.timer-btn') as HTMLButtonElement;
        if (!button) return;

        if (task.isTimerRunning) {
            // 暂停计时器
            task.isTimerRunning = false;
            const now = Date.now();
            const elapsed = now - (task.timerStartTime || 0);
            
            if (task.type === 'checkin') {
                // 打卡任务记录当天用时和时间段
               
                // 初始化或获取今天的记录
                if (!todayRecord) {
                    task.timeSpent = Math.floor(elapsed / 1000);  // 只计算今天的第一段时间
        
                    todayRecord = {
                        date: today,
                        startTime: task.timerStartTime || now,
                        pauseTimes: [],
                        dailyTimeSpent: task.timeSpent
                    };
                    task.timeRecords.push(todayRecord);
                } else {
                    // 同一天，累加时间
                    task.timeSpent = (task.timeSpent || 0) + Math.floor(elapsed / 1000);
                    todayRecord.dailyTimeSpent = task.timeSpent;  // 更新当日用时
                }
                
                // 记录本次持续时间段
                todayRecord.pauseTimes.push({
                    start: task.timerStartTime || 0,
                    end: now
                });
                
                await this.updateTaskTimeRecord(task, 'pause', elapsed);
            } else {
                 // 非打卡任务记录累计用时
                
                task.totalTimeSpent = (task.totalTimeSpent || 0) + Math.floor(elapsed / 1000);
                
                // 初始化或获取今天的记录
                if (!todayRecord) {
                    todayRecord = {
                        date: today,
                        startTime: task.actualStartTime || now,
                        pauseTimes: [],
                        dailyTimeSpent: 0
                    };
                    task.timeRecords.push(todayRecord);
                    task.timeSpent = 0;  // 重置当日计时
                }

                // 更新当日用时
                task.timeSpent = (task.timeSpent || 0) + Math.floor(elapsed / 1000);
                todayRecord.dailyTimeSpent = task.timeSpent;
                            
                // 记录本次持续时间段
                todayRecord.pauseTimes.push({
                    start: task.timerStartTime || 0,
                    end: now
                });
                todayRecord.dailyTimeSpent = task.timeSpent;
                
                await this.updateTaskTimeRecord(task, 'pause', elapsed);
            }


            delete task.timerStartTime;
            await this.updateNoteFrontmatter(task);
            
            // 更新按钮状态
            button.textContent = '继续';
            button.classList.remove('running');
            
            // 清除更新间隔
            if (this.data.timers[taskId]) {
                clearInterval(this.data.timers[taskId]);
                delete this.data.timers[taskId];
            }
        } else {
            // 开始/继续计时器
            task.isTimerRunning = true;
            const now = Date.now();
            task.timerStartTime = now;
            
            if (task.type === 'checkin') {
                // 打卡任务每天重置
                const lastStartDate = task.timerStartTime 
                    ? moment(task.timerStartTime).format('YYYY-MM-DD')
                    : null;
                
                if (!lastStartDate || lastStartDate !== today) {
                    task.timeSpent = 0;  // 新的一天重置时间
                    await this.updateTaskTimeRecord(task, 'start');
                } else {
                    await this.updateTaskTimeRecord(task, 'resume');
                }
            } else {
                if (!task.actualStartTime) {
                    task.actualStartTime = now;
                    // 初始化今天的记录
                    todayRecord = {
                        date: today,
                        startTime: now,
                        pauseTimes: [],
                        dailyTimeSpent: 0
                    };
                    task.timeRecords.push(todayRecord);
                    await this.updateTaskTimeRecord(task, 'start');
                } else {
                    await this.updateTaskTimeRecord(task, 'resume');
                }
            }

            await this.updateNoteFrontmatter(task);
            
            // 更新按钮状态
            button.textContent = '暂停';
            button.classList.add('running');
            
            // 设置实时更新
            this.data.timers[taskId] = window.setInterval(() => {
                if (task.isTimerRunning && task.timerStartTime) {
                    const currentTime = Date.now();
                    const totalSeconds = task.timeSpent + Math.floor((currentTime - task.timerStartTime) / 1000);
                    timeDisplay.textContent = this.formatTime(totalSeconds);
                }
            }, 1000);
        }

        await this.saveData();
        timeDisplay.textContent = this.formatTime(task.timeSpent || 0);

        // 打开对应的笔记
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const filePath = task.type === 'checkin'
            ? `tasks/${fileName}/打卡记录/${moment().format('YYYY-MM-DD')}.md`
            : `tasks/${fileName}.md`;

        try {
            // 检查文件是否存在
            if (!await this.app.vault.adapter.exists(filePath)) {
                // 如果是打卡任务，确保文件夹结构存在
                if (task.type === 'checkin') {
                    const taskFolder = `tasks/${fileName}`;
                    const recordsFolder = `${taskFolder}/打卡记录`;
                    
                    if (!await this.app.vault.adapter.exists(taskFolder)) {
                        await this.app.vault.createFolder(taskFolder);
                    }
                    if (!await this.app.vault.adapter.exists(recordsFolder)) {
                        await this.app.vault.createFolder(recordsFolder);
                    }
                    
                    // 创建打卡记录文件
                    const initialContent = [
                        '---',
                        `title: ${task.title} - ${moment().format('YYYY-MM-DD')} 打卡记录`,
                        'type: checkin-record',
                        `date: ${moment().format('YYYY-MM-DD')}`,
                        `today_start: ${todayRecord?.startTime ? moment(todayRecord.startTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `completed_at: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `daily_time_spent: ${this.formatTime(task.timeSpent || 0)}`,
                        `time: ${moment().format('HH:mm:ss')}`,
                        'tags:',
                        '  - 打卡记录',
                        '---',
                        '',
                        '## 时间记录',
                        '',
                        '## 打卡心得',
                        ''
                    ].join('\n');
                    
                    await this.app.vault.create(filePath, initialContent);
                } else {
                    // 创建普通任务笔记
                    const initialContent = [
                        '---',
                        `title: ${task.title}`,
                        'type: task',
                        `created: ${moment().format('YYYY-MM-DD HH:mm:ss')}`,
                        `planned_start: ${task.startDate ? moment(task.startDate).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `actual_start: ${task.actualStartTime ? moment(task.actualStartTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `today_start: ${todayRecord?.startTime ? moment(todayRecord.startTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `completed_at: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `daily_time_spent: ${todayRecord ? this.formatTime(todayRecord.dailyTimeSpent) : '00:00:00'}`,
                        `total_time_spent: ${this.formatTime(task.totalTimeSpent || 0)}`,
                        `due: ${task.dueDate ? moment(task.dueDate).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        'status: 进行中',
                        'tags:',
                        '  - 任务',
                        ...(task.isUrgent ? ['  - 紧急'] : []),
                        ...(task.isImportant ? ['  - 重要'] : []),
                        '---',
                        '',
                        '## 任务描述',
                        '',
                        '## 时间记录',
                        '',
                        '## 任务笔记',
                        ''
                    ].join('\n');
                    await this.app.vault.create(filePath, initialContent);
                }
            }

            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                // 使用当前叶子或找到已存在的叶子
                const leaf = this.app.workspace.getMostRecentLeaf();
                if (leaf) {
                    await leaf.openFile(file);
                }
            }
        } catch (error) {
            console.error('打开或创建笔记失败:', error);
            new Notice('打开或创建笔记失败');
        }
    }

    private async updateTaskTimeRecord(task: Task, action: 'start' | 'pause' | 'resume' | 'complete', elapsed?: number) {
        if (task.type === 'checkin') {  // 打卡任务的处理
            const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
            const filePath = `tasks/${fileName}/打卡记录/${moment().format('YYYY-MM-DD')}.md`;

            try {
                if (await this.app.vault.adapter.exists(filePath)) {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        let content = await this.app.vault.read(file);
                        
                        // 获取今天的记录
                        const todayRecord = task.timeRecords.find(r => r.date === moment().format('YYYY-MM-DD'));
                        
                        // 生成时间记录
                        const timeRecord = [
                            '',
                            `开始时间：${moment(todayRecord?.startTime).format('HH:mm:ss')}`,
                            '- 持续时间段：',
                            ...(todayRecord?.pauseTimes || []).map((time, index) => 
                                `  ${index + 1}. ${moment(time.start).format('HH:mm:ss')} - ${moment(time.end).format('HH:mm:ss')}`
                            ),
                            `- 当日用时：${this.formatTime(task.timeSpent || 0)}`,
                            ''
                        ].join('\n');

                        // 查找或创建时间记录部分
                        const timeRecordSectionRegex = /## 时间记录\n[\s\S]*?(?=\n## |$)/;
                        if (timeRecordSectionRegex.test(content)) {
                            content = content.replace(
                                timeRecordSectionRegex,
                                `## 时间记录\n${timeRecord}`
                            );
                        } else {
                            content += '\n## 时间记录\n' + timeRecord;
                        }

                        await this.app.vault.modify(file, content);
                    }
                }
            } catch (error) {
                console.error('更新时间记录失败:', error);
                new Notice('更新时间记录失败');
            }
        }
        if (task.type !== 'checkin') {  // 非打卡任务的处理
            const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
            const filePath = `tasks/${fileName}.md`;
        
            try {
                if (await this.app.vault.adapter.exists(filePath)) {
                    const file = this.app.vault.getAbstractFileByPath(filePath);
                    if (file instanceof TFile) {
                        let content = await this.app.vault.read(file);
                        
                        // 获取今天的记录
                        const todayRecord = task.timeRecords.find(r => r.date === moment().format('YYYY-MM-DD'));
                        
                        // 生成时间记录
                        const timeRecord = [
                            '',
                            `开始时间：${moment(todayRecord?.startTime).format('HH:mm:ss')}`,
                            '- 持续时间段：',
                            ...(todayRecord?.pauseTimes || []).map((time, index) => 
                                `  ${index + 1}. ${moment(time.start).format('HH:mm:ss')} - ${moment(time.end).format('HH:mm:ss')}`
                            ),
                            `- 当日用时：${this.formatTime(task.timeSpent || 0)}`,
                            `- 累计用时：${this.formatTime(task.totalTimeSpent || 0)}`,
                            ''
                        ].join('\n');
        
                        // 查找或创建时间记录部分
                        const timeRecordSectionRegex = /## 时间记录\n[\s\S]*?(?=\n## |$)/;
                        if (timeRecordSectionRegex.test(content)) {
                            content = content.replace(
                                timeRecordSectionRegex,
                                `## 时间记录\n${timeRecord}`
                            );
                        } else {
                            content += '\n## 时间记录\n' + timeRecord;
                        }
        
                        await this.app.vault.modify(file, content);
                    }
                }
            } catch (error) {
                console.error('更新时间记录失败:', error);
                new Notice('更新时间记录失败');
            }
        }
    }

    private createStatsSection() {
        // 先移除现有的统计区域
        const existingStats = this.contentEl.querySelector('.task-board-stats-section');
        if (existingStats) {
            existingStats.remove();
        }

        const statsSection = this.contentEl.createEl('div', { cls: 'task-board-stats-section' });
        
        // 获取今日日期
        const today = moment().format('YYYY-MM-DD');
        
        // 计算统计数据
        const todayStats = {
            totalTasks: this.data.tasks.length,
            completedTasks: this.data.tasks.filter(task => task.completed).length,
            totalTimeSpent: 0
        };

        // 计算今日总用时
        this.data.tasks.forEach(task => {
            const todayRecord = task.timeRecords?.find(r => r.date === today);
            if (todayRecord) {
                todayStats.totalTimeSpent += todayRecord.dailyTimeSpent || 0;
            }
        });

        // 创建统计显示
        const statsContainer = statsSection.createEl('div', { cls: 'stats-container' });
        
        // 任务统计
        statsContainer.createEl('div', { 
            cls: 'stats-item',
            text: `待完成：${todayStats.totalTasks - todayStats.completedTasks}`
        });
        
        statsContainer.createEl('div', { 
            cls: 'stats-item',
            text: `已完成：${todayStats.completedTasks}`
        });
        
        // 今日用时
        statsContainer.createEl('div', { 
            cls: 'stats-item',
            text: `今日用时：${this.formatTime(todayStats.totalTimeSpent)}`
        });

        // 添加按钮容器
        const buttonsContainer = statsSection.createEl('div', { cls: 'stats-buttons' });

        // 添加今日总结按钮
        const summaryButton = buttonsContainer.createEl('button', {
            text: '今日总结',
            cls: 'summary-btn'
        });
        summaryButton.addEventListener('click', () => this.createDailySummary());

        // 添加清空按钮
        const clearButton = buttonsContainer.createEl('button', {
            text: '清空记录',
            cls: 'clear-records-btn'
        });
        clearButton.addEventListener('click', () => this.clearAllCompletions());
    }

    private async deleteCompletion(completion: TaskCompletion) {
        // 同时从两个地方删除记录
        this.completions = this.completions.filter(c => 
            c.taskName !== completion.taskName || 
            c.timestamp !== completion.timestamp
        );
        
        // 同步到 data.completions
        this.data.completions = this.completions;
        
        await this.saveData();
        this.createStatsSection();
        new Notice('已删除完成记录');
    }

    private async clearCompletedTasks() {
        // 停止所有已完成任务的计时器
        this.data.tasks.forEach(task => {
            if (task.completed && task.isTimerRunning && this.data.timers[task.id]) {
                clearInterval(this.data.timers[task.id]);
                delete this.data.timers[task.id];
            }
        });
        
        // 只删除已完成任务的记录，保留未完成的任务
        this.data.tasks = this.data.tasks.filter(t => !t.completed);
        
        await this.saveData();
        this.createStatsSection();
    }

    private async deleteCompletedTask(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (task) {
            // 如果任务正在计时，先停止计时器
            if (task.isTimerRunning && this.data.timers[taskId]) {
                clearInterval(this.data.timers[taskId]);
                delete this.data.timers[taskId];
            }
            
            // 从数组中移除任务
            this.data.tasks = this.data.tasks.filter(t => t.id !== taskId);
            
            await this.saveData();
            
            // 只更新完成记录区域，不重新渲染任务列表
            this.createStatsSection();
        }
    }

    private createRewardSection() {
        const rewardSection = this.contentEl.createEl('div', { cls: 'task-board-reward-section' });
        // 奖励列表和兑换界面
    }

    async onClose() {
        // 清理所有计时器
        Object.values(this.data.timers).forEach(timerId => {
            if (timerId) clearInterval(timerId);
        });
        this.data.timers = {};
        
        // 清理提醒检查间隔
        if (this.reminderIntervalId) {
            clearInterval(this.reminderIntervalId);
        }
        
        // 保存数据
        await this.saveData();
        
        // 保存 completions 到数据
        this.data.completions = this.completions;
        await this.saveData();
    }

    async loadData() {
        const savedData = await this.loadLocalData();
        if (savedData) {
            this.data = { ...this.data, ...savedData };
            // 从保存的数据中恢复 completions
            this.completions = this.data.completions || [];
        }
    }

    async saveData() {
        await this.saveLocalData(this.data);
    }

    private async loadLocalData(): Promise<TaskBoardData | null> {
        const data = await this.app.vault.adapter.read(`${this.app.vault.configDir}/task-kanban.json`);
        return data ? JSON.parse(data) : null;
    }

    private async saveLocalData(data: TaskBoardData) {
        await this.app.vault.adapter.write(
            `${this.app.vault.configDir}/task-kanban.json`,
            JSON.stringify(data)
        );
    }

    private async showAddTaskModal() {
        const emptyTask: Task = {
            id: '',
            title: '',
            completed: false,
            timeSpent: 0,
            isTimerRunning: false,
            priority: TaskPriority.NONE,
            timeRecords: [],      // 添加这行
            totalTimeSpent: 0     // 添加这行
        };
        
        const modal = new TaskModal(this.app, emptyTask, async (result) => {
            if (result) {
                console.log('Creating task with:', result); // 调试日志
                this.data.tasks.push({
                    id: Date.now().toString(),
                    title: result.title,
                    category: result.category,
                    type: result.type,
                    startDate: result.startDate ? result.startDate : undefined,
                    dueDate: result.dueDate ? result.dueDate : undefined,
                    reminder: result.reminder,
                    reminderTime: result.reminderTime ? result.reminderTime : undefined,
                    hideBeforeStart: result.hideBeforeStart,
                    isUrgent: result.isUrgent,
                    isImportant: result.isImportant,
                    completed: false,
                    timeSpent: 0,
                    isTimerRunning: false,
                    startedAt: undefined,
                    priority: result.priority || TaskPriority.NONE,
                    timeRecords: [],          // 添加这行
                    totalTimeSpent: 0         // 添加这行
                });
                await this.saveData();
                const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
                if (taskList) {
                    this.renderTasks(taskList);
                }
                this.createStatsSection();
            }
        });
        modal.open();
    }

    private async toggleTask(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 如果是打卡任务
        if (task.type === 'checkin') {
            const today = moment().format('YYYY-MM-DD');
            const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
            const checkinPath = `tasks/${fileName}/打卡记录/${today}.md`;
            
            // 检查今天的打卡文件是否已存在
            const fileExists = await this.app.vault.adapter.exists(checkinPath);
            
            if (task.completed) {
                // 弹出确认对话框
                const confirmResult = await new Promise<string>(resolve => {
                    const modal = new Modal(this.app);
                    modal.titleEl.setText('重新打卡确认');
                    modal.contentEl.createEl('p', { text: '是否重新打卡？' });
                    modal.contentEl.createEl('p', { text: '选择"删除"将清除今天的打卡记录重新开始，选择"继续"将保留开始时间，仅更新完成时间。' });
                    
                    const buttonContainer = modal.contentEl.createDiv({ cls: 'button-container' });
                    
                    const deleteButton = buttonContainer.createEl('button', { text: '删除' });
                    deleteButton.addEventListener('click', () => {
                        modal.close();
                        resolve('delete');
                    });
                    
                    const continueButton = buttonContainer.createEl('button', { text: '继续' });
                    continueButton.addEventListener('click', () => {
                        modal.close();
                        resolve('continue');
                    });
                    
                    const cancelButton = buttonContainer.createEl('button', { text: '取消' });
                    cancelButton.addEventListener('click', () => {
                        modal.close();
                        resolve('cancel');
                    });
                    
                    modal.open();
                });

                if (confirmResult === 'delete') {
                    // 取消复选框
                    task.completed = false;
                    delete task.completedAt;
                    if (task.isTimerRunning) {
                        task.isTimerRunning = false;
                        delete task.timerStartTime;
                    }
                    task.timeSpent = 0; // 重置用时
                    
                    // 删除今天的打卡记录
                    if (fileExists) {
                        const file = this.app.vault.getAbstractFileByPath(checkinPath);
                        if (file instanceof TFile) {
                            await this.app.vault.delete(file);
                        }
                    }
                } else if (confirmResult === 'continue') {
                    // 取消复选框
                    task.completed = false;
                } else if (confirmResult === 'cancel') {
                    // 保持复选框选中状态
                    return;
                }
            } else {
                // 设置完成时间
                task.completedAt = Date.now();
        
                // 新建打卡记录或更新现有记录
                if (fileExists) {
                    // 更新现有记录
                    const file = this.app.vault.getAbstractFileByPath(checkinPath) as TFile;
                    const content = await this.app.vault.read(file);
                    await this.updateCheckinNoteFrontmatter(task, checkinPath);
                } else {
                    // 新建打卡记录
                    await this.completeCheckinTask(task, '');
                }
                task.completed = true;  // 保持复选框选中状态
            }
            
            await this.saveData();
            const taskList = this.contentEl.querySelector('.task-list');
            if (taskList instanceof HTMLElement) {
                this.renderTasks(taskList);
            }
            this.createStatsSection();
        } else {
            // 非打卡任务
            task.completed = !task.completed;
            const now = Date.now();
            
            if (task.completed) {
                task.completedBy = this.data.currentUserId;
                task.completedAt = now;
                
                // 重置计时器状态
                if (task.isTimerRunning) {
                    task.isTimerRunning = false;
                    const elapsed = now - (task.timerStartTime || 0);
                    task.timeSpent = (task.timeSpent || 0) + Math.floor(elapsed / 1000);
                    delete task.timerStartTime;
                }

                // 更新笔记并打开
                const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
                const filePath = `tasks/${fileName}.md`;
                
                // 更新笔记 frontmatter 和时间记录
                await this.updateNoteFrontmatter(task);
                await this.updateTaskTimeRecord(task, 'complete');
                
                // 打开笔记
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    await this.app.workspace.getLeaf().openFile(file);
                }

                // 添加到完成记录
                this.completions.push({
                    taskName: task.title,
                    reflection: '',
                    timestamp: now,
                    startedAt: task.startedAt,
                    completedAt: now,
                    timeSpent: task.timeSpent || 0
                });
            } else {
                // 取消完成状态
                delete task.completedAt;
                await this.updateNoteFrontmatter(task);
            }

            // 保存数据
            this.data.completions = this.completions;
            await this.saveData();

            // 更新界面
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            this.renderTasks(taskList);
            this.createStatsSection();
        }
    }

    private async updateCheckinNoteFrontmatter(task: Task, filePath: string) {
        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    
                    // 获取今日记录
                    const today = moment().format('YYYY-MM-DD');
                    const todayRecord = task.timeRecords.find(r => r.date === today);
                    const now = moment().format('HH:mm:ss');
                    
                    // 更新打卡记录的 frontmatter
                    const newFrontmatter = [
                        '---',
                        `title: ${task.title} - ${today} 打卡记录`,
                        'type: checkin-record',
                        `date: ${today}`,
                        `today_start: ${todayRecord?.startTime ? moment(todayRecord.startTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `completed_at: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `daily_time_spent: ${this.formatTime(todayRecord?.dailyTimeSpent || 0)}`,
                        `time: ${now}`,
                        'tags:',
                        '  - 打卡记录',
                        '---'
                    ].join('\n');

                    // 替换原有的 frontmatter
                    const newContent = content.replace(/---[\s\S]*?---/, newFrontmatter);
                    await this.app.vault.modify(file, newContent);
                }
            }
        } catch (error) {
            console.error('更新打卡记录 frontmatter 失败:', error);
            new Notice('更新打卡记录 frontmatter 失败');
        }
    }

    private async completeCheckinTask(task: Task, content: string) {
        const today = moment().format('YYYY-MM-DD');
        const currentTime = moment().format('HH:mm:ss');
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const checkinPath = `tasks/${fileName}/打卡记录/${today}.md`;
        
        try {
            // 获取实际开始时间，使用本地时间格式
            const actualStartTime = task.timerStartTime 
                ? moment(task.timerStartTime).local().format('YYYY-MM-DD HH:mm:ss')
                : moment().local().format('YYYY-MM-DD HH:mm:ss');
            const completedTime = moment().local().format('YYYY-MM-DD HH:mm:ss');
            
            const checkinContent = [
                '---',
                `title: ${task.title}`,
                `date: ${today}`,
                `time: ${currentTime}`,
                `task: ${task.title}`,
                'type: checkin',
                'status: 已完成',
                `actual_start: ${actualStartTime}`,
                `completed_at: ${completedTime}`,
                `time_spent: ${this.formatTime(task.timeSpent)}`,
                'tags:',
                '  - 打卡',
                `  - ${task.category || '其他'}`,
                '---',
                '',
                `# ${task.title} - ${today} 打卡记录`,
                '',
                '## 完成情况',
                `- 实际开始时间：${actualStartTime}`,  // 更新为实际开始时间
                `- 完成时间：${completedTime}`,
                `- 用时：${this.formatTime(task.timeSpent)}`,
                '',
                '## 今日心得',
                content,
                '',
                '## 明日计划',
                ''
            ].join('\n');

            // 确保打卡记录文件夹存在
            const recordPath = `tasks/${fileName}/打卡记录`;
            if (!await this.app.vault.adapter.exists(recordPath)) {
                await this.app.vault.createFolder(recordPath);
            }

            await this.app.vault.create(checkinPath, checkinContent);
            
            // 打开笔记
            const file = this.app.vault.getAbstractFileByPath(checkinPath) as TFile;
            await this.app.workspace.getLeaf().openFile(file);

        } catch (error) {
            console.error('创建打卡笔记失败:', error);
            new Notice('创建打卡笔记失败');
        }
    }

    private async resetTimer(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (!task) return;
    
        // 停止计时器（如果正在运行）
        if (task.isTimerRunning) {
            task.isTimerRunning = false;
            if (this.data.timers[taskId]) {
                clearInterval(this.data.timers[taskId]);
                delete this.data.timers[taskId];
            }
        }
    
        // 重置所有时间相关属性
        task.timeSpent = 0;
        task.totalTimeSpent = 0;
        task.timeRecords = [];  // 清空所有时间记录
        delete task.timerStartTime;
        delete task.actualStartTime;
    
        // 更新笔记的 frontmatter
        await this.updateNoteFrontmatter(task);
        
        // 更新界面显示
        const taskEl = this.contentEl.querySelector(`[data-task-id="${taskId}"]`);
        if (taskEl) {
            const timeDisplay = taskEl.querySelector('.time-display');
            if (timeDisplay) {
                timeDisplay.textContent = this.formatTime(0);
            }
            const timerBtn = taskEl.querySelector('.timer-btn');
            if (timerBtn) {
                timerBtn.textContent = '开始';
                timerBtn.classList.remove('running');
            }
        }
    
        await this.saveData();
        new Notice('已重置任务时间');
    }

    private async deleteTask(taskId: string) {
        const taskIndex = this.data.tasks.findIndex(t => t.id === taskId);
        if (taskIndex > -1) {
            this.data.tasks.splice(taskIndex, 1);
            await this.saveData();
            // 更新任务列表和完成记录
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            this.renderTasks(taskList);
            this.createStatsSection();
        }
    }

    private formatDate(timestamp?: number): string {
        if (!timestamp) return '未记录';
        const date = new Date(timestamp);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    }

    

    // 创建今日总结
    private async createDailySummary() {
        // 生成带图表的总结内容
        const content = this.generateSummaryContent();
        
        // 获取今天的日期
        const today = moment().format('YYYY-MM-DD');
        const dailyNotePath = `daily/${today}.md`;
        
        // 检查今日日记是否存在
        let dailyNote: TFile;
        if (await this.app.vault.adapter.exists(dailyNotePath)) {
            dailyNote = this.app.vault.getAbstractFileByPath(dailyNotePath) as TFile;
            // 在日记末尾添加总结内容
            const originalContent = await this.app.vault.read(dailyNote);
            await this.app.vault.modify(dailyNote, originalContent + '\n\n' + content);
        } else {
            // 如果不存在，创建新的日记文件
            dailyNote = await this.app.vault.create(dailyNotePath, content);
        }
        
        // 打开日记文件
        await this.app.workspace.getLeaf().openFile(dailyNote);
    }

    private generateSummaryContent(): string {
        const now = moment();
        const today = now.format('YYYY-MM-DD');
        
        const frontmatter = {
            title: `${today} 任务总结`,
            date: today,
            type: 'daily',
            tags: ['任务', '日记']
        };
        
        let content = [
            '---',
            yaml.dump(frontmatter),
            '---',
            '',
            '## 📊 今日任务仪表盘',
            `> 更新时间：${now.format('YYYY-MM-DD HH:mm:ss')}`,
            '',
            '### 📅 今日计划',
            '```dataview',
            'TABLE WITHOUT ID',
            '  title as "任务",',
            '  type as "类型",',
            '  planned_start as "计划开始",',
            '  due as "计划截止"',
            'FROM "tasks"',
            `WHERE planned_start = "${today}" OR due = "${today}"`,
            'SORT file.ctime ASC',
            '```',
            '',
            '### ⏱️ 今日进行中',
            '```dataview',
            'TABLE WITHOUT ID',
            '  title as "任务",',
            '  today_start as "开始时间",',
            '  daily_time_spent as "今日用时",',
            '  total_time_spent as "累计用时"',
            'FROM "tasks"',
            `WHERE today_start = "${today}" AND status != "已完成"`,
            'SORT today_start DESC',
            '```',
            '',
            '### ✅ 今日完成',
            '```dataview',
            'TABLE WITHOUT ID',
            '  title as "任务",',
            '  today_start as "开始时间",',
            '  completed_at as "完成时间",',
            '  daily_time_spent as "用时",',
            '  total_time_spent as "累计用时"',
            'FROM "tasks"',
            `WHERE completed_at = "${today}"`,
            'SORT completed_at DESC',
            '```',
            '',
            '### 📊 统计概览',
            '```dataviewjs',
            'const tasks = dv.pages(\'#任务\')',
            `  .where(p => p.today_start == "${today}" || p.completed_at == "${today}");`,
            '',
            'const planned = dv.pages(\'#任务\')',
            `  .where(p => p.planned_start == "${today}" || p.due == "${today}");`,
            '',
            'const completed = tasks.where(p => p.completed_at == "${today}");',
            '',
            'dv.header(4, "🎯 任务情况");',
            'dv.paragraph(`- 计划任务：${planned.length} 个`);',
            'dv.paragraph(`- 进行中：${tasks.length - completed.length} 个`);',
            'dv.paragraph(`- 已完成：${completed.length} 个`);',
            '',
            'const totalTime = tasks',
            '  .array()',
            '  .reduce((sum, task) => sum + (task.daily_time_spent || 0), 0);',
            'dv.paragraph(`- 今日总用时：${totalTime} 分钟`);',
            '```',
            '',
            '### 📈 分类统计',
            '```dataviewjs',
            'const allTasks = dv.pages(\'#任务\')',
            `  .where(p => p.today_start == "${today}" || p.completed_at == "${today}");`,
            '',
            'const categories = {};',
            'allTasks.array().forEach(task => {',
            '  const category = task.category || "未分类";',
            '  if (!categories[category]) {',
            '    categories[category] = {',
            '      total: 0,',
            '      completed: 0,',
            '      timeSpent: 0',
            '    };',
            '  }',
            '  categories[category].total++;',
            '  if (task.completed_at) categories[category].completed++;',
            '  categories[category].timeSpent += task.daily_time_spent || 0;',
            '});',
            '',
            'for (const [category, stats] of Object.entries(categories)) {',
            '  dv.header(4, category);',
            '  dv.paragraph(`- 总数：${stats.total}`);',
            '  dv.paragraph(`- 已完成：${stats.completed}`);',
            '  dv.paragraph(`- 用时：${stats.timeSpent} 分钟`);',
            '}',
            '```'
        ].join('\n');

        return content;
    }

    // 添加清空所有完成记录的方法
    private async clearAllCompletions() {
        // 弹出确认对话框
        const confirmResult = await new Promise<boolean>(resolve => {
            const modal = new Modal(this.app);
            modal.titleEl.setText('确认清空');
            modal.contentEl.createEl('p', { text: '确定要清空所有已完成任务和今日用时记录吗？' });
            
            const buttonContainer = modal.contentEl.createDiv({ cls: 'button-container' });
            
            const confirmButton = buttonContainer.createEl('button', { text: '确定' });
            confirmButton.addEventListener('click', () => {
                modal.close();
                resolve(true);
            });
            
            const cancelButton = buttonContainer.createEl('button', { text: '取消' });
            cancelButton.addEventListener('click', () => {
                modal.close();
                resolve(false);
            });
            
            modal.open();
        });
    
        if (!confirmResult) return;
    
        const today = moment().format('YYYY-MM-DD');
    
        // 重置所有任务的完成状态和今日用时
        this.data.tasks.forEach(task => {
            // 重置完成状态
            if (task.completed) {
                task.completed = false;
                delete task.completedAt;
            }
    
            // 重置今日用时
            const todayRecord = task.timeRecords?.find(r => r.date === today);
            if (todayRecord) {
                todayRecord.dailyTimeSpent = 0;
                todayRecord.pauseTimes = [];
            }
            if (task.timeSpent) {
                task.timeSpent = 0;
            }
    
            // 停止正在运行的计时器
            if (task.isTimerRunning) {
                task.isTimerRunning = false;
                if (this.data.timers[task.id]) {
                    clearInterval(this.data.timers[task.id]);
                    delete this.data.timers[task.id];
                }
                delete task.timerStartTime;
            }
    
            // 更新笔记的 frontmatter
            this.updateNoteFrontmatter(task);
        });
    
        // 清空完成记录
        this.completions = [];
        this.data.completions = [];
    
        await this.saveData();
        
        // 重新渲染任务列表和统计区域
        const taskList = this.contentEl.querySelector('.task-list');
        if (taskList instanceof HTMLElement) {
            this.renderTasks(taskList);
        }
        this.createStatsSection();
    
        new Notice('已清空所有完成记录和今日用时');
    }
    private async openOrCreateNote(taskTitle: string) {
        const task = this.data.tasks.find(t => t.title === taskTitle);
        if (!task) return;

        const fileName = taskTitle.replace(/[\\/:*?"<>|]/g, '');
        const filePath = task.type === 'checkin' 
            ? `tasks/${fileName}/README.md`
            : `tasks/${fileName}.md`;
        
        try {
            // 如果是打卡任务，创建相应的文件夹结构
            if (task.type === 'checkin') {
                const taskFolder = `tasks/${fileName}`;
                const checkinFolder = `${taskFolder}/打卡记录`;
                
                if (!await this.app.vault.adapter.exists(taskFolder)) {
                    await this.app.vault.createFolder(taskFolder);
                }
                if (!await this.app.vault.adapter.exists(checkinFolder)) {
                    await this.app.vault.createFolder(checkinFolder);
                }
            }

            // 创建或打开笔记
            let file: TFile;
            if (!await this.app.vault.adapter.exists(filePath)) {
                const content = task.type === 'checkin' 
                    ? this.generateCheckinTaskContent(task)
                    : this.generateNormalTaskContent(task);
                
                file = await this.app.vault.create(filePath, content);
            } else {
                file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
            }

            await this.app.workspace.getLeaf().openFile(file);
        } catch (error) {
            console.error('Error creating/opening note:', error);
            new Notice('创建或打开笔记失败');
        }
    }

    private generateCheckinTaskContent(task: Task): string {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        return [
            '---',
            `alias: ${task.title}`,
            `type: checkin-task`,
            `category: ${task.category || '其他'}`,
            'tags:',
            '  - 打卡任务',
            `  - ${task.category || '其他'}`,
            '---',
            '',
            `# ${task.title} - 打卡任务`,
            '',
            '## 任务说明',
            '',
            '## 打卡记录',
            '```dataview',
            'TABLE date as 日期, time as 完成时间',
            `FROM "tasks/${fileName}/打卡记录"`,
            'SORT date DESC',
            '```',
            '',
            '## 统计分析',
            '### 打卡频率',
            '```dataview',
            'CALENDAR date',
            `FROM "tasks/${fileName}/打卡记录"`,
            '```',
            '',
            '### 打卡统计',
            '```dataview',
            'TABLE length(rows) as 打卡次数',
            `FROM "tasks/${fileName}/打卡记录"`,
            'GROUP BY dateformat(date, "yyyy-MM") as 月份',
            'SORT 月份 DESC',
            '```',
            '',
            '### 最近打卡',
            '```dataview',
            'LIST WITHOUT ID time + " - " + dateformat(date, "yyyy-MM-dd")',
            `FROM "tasks/${fileName}/打卡记录"`,
            'SORT date DESC',
            'LIMIT 5',
            '```',
            '',
        ].join('\n');
    }

    // 添加更新笔记 frontmatter 的方法
    private async updateNoteFrontmatter(task: Task) {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const filePath = `tasks/${fileName}.md`;
        const today = moment().format('YYYY-MM-DD');
        const todayRecord = task.timeRecords.find(r => r.date === today);

        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    
                    // 更新 frontmatter
                    const newFrontmatter = [
                        '---',                
                        `title: ${task.title}`,
                        `status: ${task.completed ? '已完成' : '进行中'}`,
                        `created: ${moment(file.stat.ctime).format('YYYY-MM-DD')}`,
                        `planned_start: ${task.startDate ? moment(task.startDate).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `actual_start: ${task.actualStartTime ? moment(task.actualStartTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `today_start: ${todayRecord?.startTime ? moment(todayRecord.startTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `completed_at: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `daily_time_spent: ${todayRecord ? this.formatTime(todayRecord.dailyTimeSpent) : '00:00:00'}`,
                        `total_time_spent: ${this.formatTime(task.totalTimeSpent)}`,
                        `due: ${task.dueDate ? moment(task.dueDate).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        'tags:',
                        '  - 任务',
                        ...(task.isUrgent ? ['  - 紧急'] : []),
                        ...(task.isImportant ? ['  - 重要'] : []),
                        '---'
                    ].join('\n');

                    // 生成时间记录内容
                    const timeRecordContent = [
                        '## 时间记录',
                        `- 任务开始时间：${task.actualStartTime ? moment(task.actualStartTime).format('YYYY-MM-DD HH:mm:ss') : '未开始'}`,
                        '',
                        '### 每日记录',
                        ...task.timeRecords.map(record => [
                            `#### ${record.date}`,
                            `- 开始时间：${moment(record.startTime).format('HH:mm:ss')}`,
                            '- 持续时间段：',
                            ...record.pauseTimes.map((period, index) => 
                                `  ${index + 1}. ${moment(period.start).format('HH:mm:ss')} - ${moment(period.end).format('HH:mm:ss')}`
                            ),
                            `- 当日用时：${this.formatTime(record.dailyTimeSpent)}`,
                            ''
                        ].join('\n')),
                        `- 累计用时：${this.formatTime(task.totalTimeSpent)}`,
                        ''
                    ].join('\n');

                    // 替换或添加时间记录部分
                    let newContent = content.replace(/---[\s\S]*?---/, newFrontmatter);
                    const timeRecordRegex = /## 时间记录[\s\S]*?(?=\n## |$)/;
                    if (timeRecordRegex.test(newContent)) {
                        newContent = newContent.replace(timeRecordRegex, timeRecordContent);
                    } else {
                        // 在任务描述后添加时间记录
                        const taskDescriptionRegex = /## 任务描述\n/;
                        if (taskDescriptionRegex.test(newContent)) {
                            newContent = newContent.replace(
                                taskDescriptionRegex,
                                `## 任务描述\n\n${timeRecordContent}`
                            );
                        }
                    }

                    await this.app.vault.modify(file, newContent);
                }
            }
        } catch (error) {
            console.error('更新笔记 frontmatter 失败:', error);
            new Notice('更新笔记 frontmatter 失败');
        }
    }

    // 添加新方法：将完成记录添加到笔记中
    private async addCompletionToNote(task: Task, reflection: string) {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const filePath = `tasks/${fileName}.md`;

        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    let content = await this.app.vault.read(file);
                    
                    // 格式化完成记录
                    const completionRecord = [
                        '',
                        `### ${moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss')} 完成记录`,
                        `- 开始时间：${task.startedAt ? moment(task.startedAt).format('YYYY-MM-DD HH:mm:ss') : '未记录'}`,
                        `- 完成时间：${moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss')}`,
                        `- 总用时：${this.formatTime(task.timeSpent)}`,
                        `- 完成心得：${reflection}`,
                        ''
                    ].join('\n');

                    // 查找完成情况记录部分并添加新记录
                    const completionSectionRegex = /## 完成情况记录\n/;
                    if (completionSectionRegex.test(content)) {
                        content = content.replace(
                            completionSectionRegex,
                            `## 完成情况记录\n${completionRecord}`
                        );
                    } else {
                        // 如果没有找到完成情况记录部分，添加到文件末尾
                        content += '\n## 完成情况记录\n' + completionRecord;
                    }

                    await this.app.vault.modify(file, content);
                }
            }
        } catch (error) {
            console.error('添加完成记录到笔记失败:', error);
            new Notice('添加完成记录到笔记失败');
        }
    }

    private setupDragAndDrop(container: HTMLElement, category: string): void {
        container.setAttribute("data-category", category);
        
        // 允许放置
        container.addEventListener("dragover", (e) => {
            e.preventDefault();
            container.addClass("drag-over");
        });
        
        // 处理放置
        container.addEventListener("drop", async (e) => {
            e.preventDefault();
            container.removeClass("drag-over");
            
            const taskId = e.dataTransfer?.getData("taskId");
            if (!taskId) return;

            const task = this.data.tasks.find(t => t.id === taskId);
            
            if (task && task.category !== category) {
                task.category = category;
                await this.saveData();
                const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
                this.renderTasks(taskList);
            }
        });
    }

    private generateNormalTaskContent(task: Task): string {
        // 辅助函数：格式化日期时间，支持只有日期的情况
        const formatDateTime = (timestamp: string | number | undefined) => {
            if (!timestamp) return '';
            const m = moment(timestamp);
            // 如果时间部分都是0或者时间部分不存在，说明只设置了日期
            if (typeof timestamp === 'string' && !timestamp.includes(':') || 
                (m.hour() === 0 && m.minute() === 0 && m.second() === 0)) {
                return m.format('YYYY-MM-DD');
            }
            return m.format('YYYY-MM-DD HH:mm:ss');
        };

        return [
            '---',
            `alias: ${task.title}`,
            'status: 进行中',
            `created: ${moment().format('YYYY-MM-DD')}`,
            `planned_start: ${formatDateTime(task.startDate)}`,
            `due: ${formatDateTime(task.dueDate)}`,
            `actual_start: ${formatDateTime(task.startedAt)}`,
            `progress: ${task.timeSpent > 0 ? Math.floor((task.timeSpent / 3600) * 100) : ''}`,
            'tags:',
            '  - 任务',
            `  - ${task.category || '其他'}`,
            ...(task.isUrgent ? ['  - 紧急'] : []),
            ...(task.isImportant ? ['  - 重要'] : []),
            '---',
            '',
            `# ${task.title}`,
            '',
            '## 任务描述',
            '',
            '## 完成情况记录',
            '',
            '## 相关资料',
            ''
        ].join('\n');
    }

    private startReminderCheck() {
        // 每分钟检查一次
        this.reminderIntervalId = window.setInterval(() => {
            this.checkReminders();
        }, 60000);
    }

    private checkReminders() {
        const now = moment();
        this.data.tasks.forEach(task => {
            if (task.reminder && task.reminderTime) {
                const reminderTime = moment(task.reminderTime);
                // 如果时间差在1分钟内
                if (Math.abs(now.diff(reminderTime, 'minutes')) < 1) {
                    // 触发提醒
                    new Notice(`任务提醒：${task.title} 需要处理了！`, 10000);
                    
                    // 如果不是打卡任务，关闭提醒
                    if (task.type !== 'checkin') {
                        task.reminder = false;
                        this.saveData();
                    }
                }
            }

            // 检查截止时间
            if (task.dueDate && !task.completed) {
                const dueTime = moment(task.dueDate);
                const hoursLeft = dueTime.diff(now, 'hours');
                
                // 如果距离截止时间小于1小时
                if (hoursLeft >= 0 && hoursLeft < 1) {
                    new Notice(`任务警告：${task.title} 即将到期！`, 10000);
                }
            }
        });
    }

    async onunload() {
        // 清理提醒检查定时器
        if (this.reminderIntervalId) {
            clearInterval(this.reminderIntervalId);
        }
        // ... 现有代码 ...
    }

    
    private async editTask(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (!task) return;

        const oldTitle = task.title;

        new EditTaskModal(this.app, task, async (result) => {
            // 更新任务属性
            task.title = result.title;
            task.category = result.category;
            task.startDate = result.startDate ? result.startDate : undefined;
            task.dueDate = result.dueDate ? result.dueDate : undefined;
            task.reminder = result.reminder;
            task.reminderTime = result.reminderTime ? result.reminderTime : undefined;
            task.hideBeforeStart = result.hideBeforeStart;
            task.isUrgent = result.isUrgent;
            task.isImportant = result.isImportant;
            task.priority = result.priority;

            // 如果标题改变，需要重命名笔记
            if (oldTitle !== result.title) {
                await this.renameTaskNote(oldTitle, result.title);
            }

            // 更新笔记内容
            await this.updateTaskNoteAfterEdit(task);

            // 保存数据并更新界面
            await this.saveData();
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            this.renderTasks(taskList);
            new Notice('任务已更新');
        }).open();
    }

    private async renameTaskNote(oldTitle: string, newTitle: string) {
        const oldPath = `tasks/${oldTitle.replace(/[\\/:*?"<>|]/g, '')}.md`;
        const newPath = `tasks/${newTitle.replace(/[\\/:*?"<>|]/g, '')}.md`;

        if (await this.app.vault.adapter.exists(oldPath)) {
            const file = this.app.vault.getAbstractFileByPath(oldPath);
            if (file instanceof TFile) {
                await this.app.fileManager.renameFile(file, newPath);
            }
        }
    }

    private async updateTaskNoteAfterEdit(task: Task) {
        // 辅助函数：格式化日期时间，支持只有日期的情况
        const formatDateTime = (timestamp: string | number | undefined) => {
            if (!timestamp) return '';
            const m = moment(timestamp);
            // 如果时间部分都是0或者时间部分不存在，说明只设置了日期
            if (typeof timestamp === 'string' && !timestamp.includes(':') || 
                (m.hour() === 0 && m.minute() === 0 && m.second() === 0)) {
                return m.format('YYYY-MM-DD');
            }
            return m.format('YYYY-MM-DD HH:mm:ss');
        };

        const filePath = `tasks/${task.title.replace(/[\\/:*?"<>|]/g, '')}.md`;
        const file = this.app.vault.getAbstractFileByPath(filePath);
        
        if (file instanceof TFile) {
            const content = await this.app.vault.read(file);
            
            // 更新 frontmatter
            const frontmatter = [
                '---',
                `title: ${task.title}`,
                `status: ${task.completed ? '已完成' : '进行中'}`,
                `created: ${moment(file.stat.ctime).format('YYYY-MM-DD')}`,
                `planned_start: ${formatDateTime(task.startDate)}`,
                `actual_start: ${formatDateTime(task.startedAt)}`,
                `due: ${formatDateTime(task.dueDate)}`,
                `progress: ${task.timeSpent > 0 ? Math.floor((task.timeSpent / 3600) * 100) : ''}`,
                `done: ${formatDateTime(task.completedAt)}`,
                'tags:',
                '  - 任务',
                ...(task.isUrgent ? ['  - 紧急'] : []),
                ...(task.isImportant ? ['  - 重要'] : []),
                '---'
            ].join('\n');

            // 保持原有内容结构，只更新 frontmatter
            const contentWithoutFrontmatter = content.replace(/---[\s\S]*?---/, '');
            const updatedContent = frontmatter + contentWithoutFrontmatter;
            
            await this.app.vault.modify(file, updatedContent);
        }

        // 更新相关的完成记录
        if (task.completed) {
            this.completions = this.completions.map(completion => {
                if (completion.taskName === task.title) {
                    return {
                        ...completion,
                        startedAt: task.startDate ? moment(task.startDate).valueOf() : completion.startedAt,
                        completedAt: task.completedAt || completion.completedAt,
                        timeSpent: task.timeSpent || completion.timeSpent
                    };
                }
                return completion;
            });

            // 保存更新后的完成记录
            this.data.completions = this.completions;
            await this.saveData();
        }
    }

    private async completeTask(task: Task) {
        if (!task.completed) {
            task.completed = true;
            task.completedBy = this.data.currentUserId;
            task.completedAt = Date.now();
            // 重置计时器状态
            task.isTimerRunning = false;
            delete task.timerStartTime;
            
            // 添加到完成记录
            this.completions.push({
                taskName: task.title,
                reflection: '',  // 不再需要心得
                timestamp: Date.now(),
                startedAt: task.startedAt,
                completedAt: task.completedAt,
                timeSpent: task.timeSpent || 0
            });
            
            // 更新笔记
            await this.updateTaskNoteOnCompletion(task, '');  // 传入空字符串作为心得
            
            // 保存数据
            this.data.completions = this.completions;
            await this.saveData();
            
            // 更新界面
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            this.renderTasks(taskList);
            this.createStatsSection();
            
            new Notice("任务完成！");
            
        } else {
            task.completed = false;
            delete task.completedAt;
            
            // 从完成记录中移除
            this.completions = this.completions.filter(c => 
                c.taskName !== task.title || 
                c.timestamp !== task.completedAt
            );
            this.data.completions = this.completions;
            
            await this.saveData();
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            this.renderTasks(taskList);
            this.createStatsSection();
        }
    }

    private async updateTaskNoteOnCompletion(task: Task, reflection: string) {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const filePath = `tasks/${fileName}.md`;

        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    let content = await this.app.vault.read(file);
                    
                    // 格式化完成记录
                    const completionRecord = [
                        '',
                        `### ${moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss')} 完成记录`,
                        `- 开始时间：${task.startedAt ? moment(task.startedAt).format('YYYY-MM-DD HH:mm:ss') : '未记录'}`,
                        `- 完成时间：${moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss')}`,
                        `- 总用时：${this.formatTime(task.timeSpent)}`,
                        `- 完成心得：${reflection}`,
                        ''
                    ].join('\n');

                    // 查找完成情况记录部分并添加新记录
                    const completionSectionRegex = /## 完成情况记录\n/;
                    if (completionSectionRegex.test(content)) {
                        content = content.replace(
                            completionSectionRegex,
                            `## 完成情况记录\n${completionRecord}`
                        );
                    } else {
                        // 如果没有找到完成情况记录部分，添加到文件末尾
                        content += '\n## 完成情况记录\n' + completionRecord;
                    }

                    await this.app.vault.modify(file, content);
                }
            }
        } catch (error) {
            console.error('添加完成记录到笔记失败:', error);
            new Notice('添加完成记录到笔记失败');
        }
    }


}

class TaskModal extends Modal {
    private titleInput: HTMLInputElement;
    private categorySelect: HTMLSelectElement;
    private typeSelect: HTMLSelectElement;
    private startDateInput: HTMLInputElement;
    private dueDateInput: HTMLInputElement;
    private reminderToggle: HTMLInputElement;
    private reminderTimeInput: HTMLInputElement;
    private hideBeforeStartToggle: HTMLInputElement;
    private isUrgentToggle: HTMLInputElement;
    private isImportantToggle: HTMLInputElement;
    private prioritySelect: HTMLSelectElement;

    constructor(
        app: App,
        private task: Task,
        private onSubmit: (result: {
            title: string;
            category: string;
            type: 'normal' | 'checkin';
            startDate?: string;
            dueDate?: string;
            reminder?: boolean;
            reminderTime?: string;
            hideBeforeStart?: boolean;
            isUrgent: boolean;
            isImportant: boolean;
            priority: TaskPriority;
        } | null) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '添加新任务' });

        // 任务名称输入
        const inputContainer = contentEl.createDiv('task-input-container');
        inputContainer.createEl('label', { text: '任务名称' });
        this.titleInput = inputContainer.createEl('input', {
            type: 'text',
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 分类选择
        const categoryContainer = contentEl.createDiv('task-category-container');
        categoryContainer.createEl('label', { text: '任务分类' });
        this.categorySelect = categoryContainer.createEl('select', {
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 添加分类选项
        const categories = ['工作', '学习', '生活', '项目', '其他'];
        categories.forEach(category => {
            const option = this.categorySelect.createEl('option', {
                text: category,
                value: category
            });
        });

        // 紧急标签切换
        const urgentContainer = contentEl.createDiv('task-toggle-container');
        urgentContainer.createEl('label', { text: '紧急' });
        this.isUrgentToggle = urgentContainer.createEl('input', { type: 'checkbox' });
        this.isUrgentToggle.checked = this.task.isUrgent ?? false;

        // 重要标签切换
        const importantContainer = contentEl.createDiv('task-toggle-container');
        importantContainer.createEl('label', { text: '重要' });
        this.isImportantToggle = importantContainer.createEl('input', { type: 'checkbox' });
        this.isImportantToggle.checked = this.task.isImportant ?? false;

        // 添加任务类型选择
        const typeContainer = contentEl.createDiv('task-type-container');
        typeContainer.createEl('label', { text: '任务类型' });
        this.typeSelect = typeContainer.createEl('select', {
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 添加任务类型选项
        [
            { value: 'normal', text: '普通任务' },
            { value: 'checkin', text: '打卡任务' }
        ].forEach(type => {
            this.typeSelect.createEl('option', {
                value: type.value,
                text: type.text
            });
        });

        // 添加开始时间
        const startDateContainer = contentEl.createDiv('task-date-container');
        startDateContainer.createEl('label', { text: '开始时间' });
        this.startDateInput = startDateContainer.createEl('input', {
            type: 'datetime-local',
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 添加隐藏选项（紧跟在开始时间后）
        const hideContainer = contentEl.createDiv();
        hideContainer.createEl('label', { text: '开始前隐藏' });
        this.hideBeforeStartToggle = hideContainer.createEl('input', {
            type: 'checkbox'
        });
        this.hideBeforeStartToggle.checked = this.task.hideBeforeStart ?? false;

        // 添加截止时间
        const dueDateContainer = contentEl.createDiv('task-date-container');
        dueDateContainer.createEl('label', { text: '截止时间' });
        this.dueDateInput = dueDateContainer.createEl('input', {
            type: 'datetime-local',
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 添加提醒设置
        const reminderContainer = contentEl.createDiv();
        reminderContainer.createEl('label', { text: '启用提醒' });
        this.reminderToggle = reminderContainer.createEl('input');
        this.reminderToggle.type = 'checkbox';
        this.reminderToggle.checked = this.task.reminder ?? false;

        // 提醒时间选择（默认隐藏）
        const reminderTimeContainer = contentEl.createDiv('task-reminder-time-container');
        reminderTimeContainer.style.display = this.task.reminder ? 'block' : 'none';
        reminderTimeContainer.createEl('label', { text: '提醒时间' });
        this.reminderTimeInput = reminderTimeContainer.createEl('input', {
            type: 'datetime-local',
            value: this.task.reminderTime ? moment(this.task.reminderTime).format('YYYY-MM-DDTHH:mm') : 
                   this.startDateInput.value ? this.startDateInput.value : ''
        });

        // 显示/隐藏提醒时间选择
        this.reminderToggle.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            reminderTimeContainer.style.display = isChecked ? 'block' : 'none';
            // 当开启提醒时，自动填入开始时间
            if (isChecked && !this.reminderTimeInput.value && this.startDateInput.value) {
                // 如果开始时间只有日期，则设置提醒时间为当天早上9点
                if (!this.startDateInput.value.includes(':')) {
                    const startDate = moment(this.startDateInput.value).format('YYYY-MM-DD');
                    this.reminderTimeInput.value = `${startDate}T09:00`;
                } else {
                    this.reminderTimeInput.value = this.startDateInput.value;
                }
            }
        });

        // 监听开始时间变化，同步更新提醒时间
        this.startDateInput.addEventListener('change', () => {
            if (this.reminderToggle.checked && !this.reminderTimeInput.value) {
                this.reminderTimeInput.value = this.startDateInput.value;
            }
        });

        // 添加优先级选择（在分类选择后）
        const priorityContainer = contentEl.createDiv('task-priority-container');
        priorityContainer.createEl('label', { text: '优先级' });
        this.prioritySelect = priorityContainer.createEl('select', {
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 添加优先级选项
        Object.values(TaskPriority).forEach(priority => {
            this.prioritySelect.createEl('option', {
                text: priority,
                value: priority
            });
        });

        // 按钮容器
        const buttonContainer = contentEl.createDiv('task-button-container');
        
        // 保存按钮
        const saveButton = buttonContainer.createEl('button', { text: '保存' });
        saveButton.addEventListener('click', () => {
            const title = this.titleInput.value.trim();
            if (title) {
                this.onSubmit({
                    title,
                    category: this.categorySelect.value,
                    type: this.typeSelect.value as 'normal' | 'checkin',
                    startDate: this.startDateInput.value,
                    dueDate: this.dueDateInput.value,
                    reminder: this.reminderToggle.checked,
                    reminderTime: this.reminderToggle.checked ? this.reminderTimeInput.value : undefined,
                    hideBeforeStart: this.hideBeforeStartToggle.checked,
                    isUrgent: this.isUrgentToggle.checked,
                    isImportant: this.isImportantToggle.checked,
                    priority: this.prioritySelect.value as TaskPriority,
                });
                this.close();
            } else {
                new Notice('请输入任务名称');
            }
        });

        // 取消按钮
        const cancelButton = buttonContainer.createEl('button', { text: '取消' });
        cancelButton.addEventListener('click', () => {
            this.onSubmit(null);
            this.close();
        });

        // 聚焦到输入框
        this.titleInput.focus();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class EditTaskModal extends Modal {
    private titleInput: HTMLInputElement;
    private categorySelect: HTMLSelectElement;
    private startDateInput: HTMLInputElement;
    private dueDateInput: HTMLInputElement;
    private reminderToggle: HTMLInputElement;
    private reminderTimeInput: HTMLInputElement;
    private hideBeforeStartToggle: HTMLInputElement;
    private isUrgentToggle: HTMLInputElement;
    private isImportantToggle: HTMLInputElement;
    private prioritySelect: HTMLSelectElement;

    constructor(
        app: App,
        private task: Task,
        private onSubmit: (result: {
            title: string;
            category: string;
            startDate?: string;
            dueDate?: string;
            reminder?: boolean;
            reminderTime?: string;
            hideBeforeStart?: boolean;
            isUrgent: boolean;
            isImportant: boolean;
            priority: TaskPriority;
        }) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '编辑任务' });

        // 任务名称
        const titleContainer = contentEl.createDiv('task-input-container');
        titleContainer.createEl('label', { text: '任务名称' });
        this.titleInput = titleContainer.createEl('input', {
            type: 'text',
            value: this.task.title
        });

        // 分类选择
        const categoryContainer = contentEl.createDiv('task-category-container');
        categoryContainer.createEl('label', { text: '任务分类' });
        this.categorySelect = categoryContainer.createEl('select');
        ['工作', '学习', '生活', '项目', '其他'].forEach(category => {
            const option = this.categorySelect.createEl('option', {
                text: category,
                value: category
            });
            if (category === this.task.category) {
                option.selected = true;
            }
        });

        // 开始时间
        const startDateContainer = contentEl.createDiv();
        startDateContainer.createEl('label', { text: '开始时间' });
        this.startDateInput = startDateContainer.createEl('input', {
            type: 'datetime-local',
            value: this.task.startDate ? moment(this.task.startDate).format('YYYY-MM-DDTHH:mm') : ''
        });

        // 截止时间
        const dueDateContainer = contentEl.createDiv();
        dueDateContainer.createEl('label', { text: '截止时间' });
        this.dueDateInput = dueDateContainer.createEl('input', {
            type: 'datetime-local',
            value: this.task.dueDate ? moment(this.task.dueDate).format('YYYY-MM-DDTHH:mm') : ''
        });

        // 提醒设置
        const reminderContainer = contentEl.createDiv();
        reminderContainer.createEl('label', { text: '启用提醒' });
        this.reminderToggle = reminderContainer.createEl('input');
        this.reminderToggle.type = 'checkbox';
        this.reminderToggle.checked = this.task.reminder ?? false;

        // 提醒时间选择（默认隐藏）
        const reminderTimeContainer = contentEl.createDiv('task-reminder-time-container');
        reminderTimeContainer.style.display = this.task.reminder ? 'block' : 'none';
        reminderTimeContainer.createEl('label', { text: '提醒时间' });
        this.reminderTimeInput = reminderTimeContainer.createEl('input', {
            type: 'datetime-local',
            value: this.task.reminderTime ? moment(this.task.reminderTime).format('YYYY-MM-DDTHH:mm') : 
                   this.startDateInput.value ? this.startDateInput.value : ''
        });

        // 显示/隐藏提醒时间选择
        this.reminderToggle.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            reminderTimeContainer.style.display = isChecked ? 'block' : 'none';
            // 当开启提醒时，自动填入开始时间
            if (isChecked && !this.reminderTimeInput.value && this.startDateInput.value) {
                this.reminderTimeInput.value = this.startDateInput.value;
            }
        });

        // 监听开始时间变化，同步更新提醒时间
        this.startDateInput.addEventListener('change', () => {
            if (this.reminderToggle.checked && !this.reminderTimeInput.value) {
                this.reminderTimeInput.value = this.startDateInput.value;
            }
        });

        // 开始前隐藏
        const hideContainer = contentEl.createDiv();
        hideContainer.createEl('label', { text: '开始前隐藏' });
        this.hideBeforeStartToggle = hideContainer.createEl('input', {
            type: 'checkbox'
        });
        this.hideBeforeStartToggle.checked = this.task.hideBeforeStart ?? false;

        // 紧急标记
        const urgentContainer = contentEl.createDiv();
        urgentContainer.createEl('label', { text: '紧急' });
        this.isUrgentToggle = urgentContainer.createEl('input', { type: 'checkbox' });
        this.isUrgentToggle.checked = this.task.isUrgent ?? false;

        // 重要标记
        const importantContainer = contentEl.createDiv();
        importantContainer.createEl('label', { text: '重要' });
        this.isImportantToggle = importantContainer.createEl('input', { type: 'checkbox' });
        this.isImportantToggle.checked = this.task.isImportant ?? false;

        // 优先级
        const priorityContainer = contentEl.createDiv();
        priorityContainer.createEl('label', { text: '优先级' });
        this.prioritySelect = priorityContainer.createEl('select');
        Object.values(TaskPriority).forEach(priority => {
            const option = this.prioritySelect.createEl('option', {
                text: priority,
                value: priority
            });
            if (priority === this.task.priority) {
                option.selected = true;
            }
        });

        // 保存按钮
        const buttonContainer = contentEl.createDiv('task-button-container');
        const submitButton = buttonContainer.createEl('button', {
            text: '保存',
            cls: 'mod-cta'
        });
        submitButton.addEventListener('click', () => {
            this.onSubmit({
                title: this.titleInput.value,
                category: this.categorySelect.value,
                startDate: this.startDateInput.value,
                dueDate: this.dueDateInput.value,
                reminder: this.reminderToggle.checked,
                reminderTime: this.reminderTimeInput.value,
                hideBeforeStart: this.hideBeforeStartToggle.checked,
                isUrgent: this.isUrgentToggle.checked,
                isImportant: this.isImportantToggle.checked,
                priority: this.prioritySelect.value as TaskPriority
            });
            this.close();
        });
    }
}

class TaskImportModal extends Modal {
    private tasks: Task[] = [];
    private selectedTasks: Set<string> = new Set();

    constructor(
        app: App,
        private parsedTasks: Task[],
        private onConfirm: (tasks: Task[]) => void
    ) {
        super(app);
        this.tasks = parsedTasks;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: '导入任务预览' });
        
        // 添加全选区域
        const selectAllContainer = contentEl.createEl('div', { cls: 'task-import-select-all' });
        const selectAllCheckbox = selectAllContainer.createEl('input', {
            type: 'checkbox',
            cls: 'task-import-checkbox'
        });
        selectAllContainer.createEl('span', { text: '全选/取消全选' });
        
        // 创建任务列表
        const taskList = contentEl.createEl('div', { cls: 'task-import-list' });
        
        const checkboxes: HTMLInputElement[] = [];
        
        this.tasks.forEach(task => {
            const taskItem = taskList.createEl('div', { cls: 'task-import-item' });
            
            // 左侧：复选框和任务标题
            const leftSection = taskItem.createEl('div', { cls: 'task-import-item-left' });
            
            const checkbox = leftSection.createEl('input', {
                type: 'checkbox',
                cls: 'task-import-checkbox',
                attr: { id: task.id }
            });
            checkboxes.push(checkbox);
            
            const titleSpan = leftSection.createEl('span', { 
                text: task.title,
                cls: 'task-import-title'
            });
            
            // 右侧：任务属性
            const rightSection = taskItem.createEl('div', { cls: 'task-import-item-right' });
            // 日期
            if (task.startDate || task.dueDate) {
                const dateContainer = rightSection.createEl('div', { cls: 'task-import-dates' });
                
                if (task.startDate) {
                    dateContainer.createEl('span', {
                        text: `🛫${task.startDate}`,
                        cls: 'task-date start-date'
                    });
                }
                
                if (task.dueDate) {
                    dateContainer.createEl('span', {
                        text: `📅${task.dueDate}`,
                        cls: 'task-date due-date'
                    });
                }
            }
            
            // 优先级标签
            if (task.priority && task.priority !== TaskPriority.NONE) {
                const priorityTag = rightSection.createEl('span', {
                    text: task.priority,
                    cls: `task-priority task-priority-${task.priority.toLowerCase()}`
                });
            }
            
            // 紧急标记
            if (task.isUrgent) {
                rightSection.createEl('span', {
                    text: '紧急',
                    cls: 'task-tag task-tag-urgent'
                });
            }
            
            // 重要标记
            if (task.isImportant) {
                rightSection.createEl('span', {
                    text: '重要',
                    cls: 'task-tag task-tag-important'
                });
            }
            
            // 分类标签
            if (task.category) {
                rightSection.createEl('span', {
                    text: task.category,
                    cls: 'task-tag task-tag-category'
                });
            }
            
            checkbox.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) {
                    this.selectedTasks.add(task.id);
                } else {
                    this.selectedTasks.delete(task.id);
                }
                selectAllCheckbox.checked = checkboxes.every(cb => cb.checked);
                selectAllCheckbox.indeterminate = checkboxes.some(cb => cb.checked) && !checkboxes.every(cb => cb.checked);
            });
        });
        
        // 全选/取消全选的事件处理
        selectAllCheckbox.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            checkboxes.forEach(checkbox => {
                checkbox.checked = target.checked;
                const taskId = checkbox.getAttribute('id');
                if (taskId) {
                    if (target.checked) {
                        this.selectedTasks.add(taskId);
                    } else {
                        this.selectedTasks.delete(taskId);
                    }
                }
            });
        });
        
        // 创建按钮容器
        const buttonContainer = contentEl.createEl('div', { cls: 'task-import-buttons' });
        
        const importButton = buttonContainer.createEl('button', {
            text: '导入所选任务',
            cls: 'mod-cta'
        });
        
        importButton.addEventListener('click', () => {
            const selectedTasks = this.tasks.filter(task => 
                this.selectedTasks.has(task.id)
            );
            this.onConfirm(selectedTasks);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class CheckinModal extends Modal {
    private contentInput: HTMLTextAreaElement;

    constructor(
        app: App,
        private onSubmit: (content: string | null) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '打卡记录' });

        // 内容输入区域
        this.contentInput = contentEl.createEl('textarea', {
            attr: { 
                rows: '10',
                style: 'width: 100%; margin: 10px 0;'
            }
        });

        // 按钮容器
        const buttonContainer = contentEl.createDiv('task-button-container');
        
        // 保存按钮
        const submitButton = buttonContainer.createEl('button', {
            text: '保存',
            cls: 'mod-cta'
        });
        submitButton.addEventListener('click', () => {
            this.onSubmit(this.contentInput.value);
            this.close();
        });

        // 取消按钮
        const cancelButton = buttonContainer.createEl('button', { text: '取消' });
        cancelButton.addEventListener('click', () => {
            this.onSubmit(null);
            this.close();
        });

        // 聚焦到输入框
        this.contentInput.focus();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
