import moment from 'moment';
import { ItemView, WorkspaceLeaf, App, Modal, Setting, Notice, TFile, TFolder } from 'obsidian';
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



type ObsidianHTMLElement = HTMLElement;

// 任务看板视图      
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
    // 创建头部 
    private createHeader() {
        const header = this.contentEl.createEl('div', { cls: 'task-board-header' });
        header.createEl('h2', { text: '任务看板' });
    }
    // 创建用户选择和管理界面 
    private createUserSection() {
        const userSection = this.contentEl.createEl('div', { cls: 'task-board-user-section' });
        // 用户选择和管理界面
    }
    // 任务添加 
    private createTaskSection() {
        const taskSection = this.contentEl.createEl("div", { cls: "task-board-task-section" });
        const addButton = taskSection.createEl("button", { text: "\u6DFB\u52A0\u4EFB\u52A1" });
        addButton.addEventListener("click", () => this.showAddTaskModal());
        
        const importButton = taskSection.createEl("button", { text: "\u4ECE\u7B14\u8BB0\u5BFC\u5165" });
        importButton.addEventListener("click", () => this.importFromObsidian());
        
        const taskList = taskSection.createEl("div", { cls: "task-list" });
        this.renderTasks(taskList);
    }
    // 任务排序     
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

    // 任务导入 
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
                
                // 为每个导入的任务创建文件结构
                for (const task of selectedTasks) {
                    try {
                        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
                        const taskFolder = `tasks/${fileName}`;
                        
                        // 创建任务文件夹
                        if (!await this.app.vault.adapter.exists(taskFolder)) {
                            await this.app.vault.createFolder(taskFolder);
                        }

                        // 创建记录文件夹
                        const recordFolder = `${taskFolder}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}`;
                        if (!await this.app.vault.adapter.exists(recordFolder)) {
                            await this.app.vault.createFolder(recordFolder);
                        }

                        // 创建 README.md（总览页面）
                        const readmePath = `${taskFolder}/README.md`;
                        if (!await this.app.vault.adapter.exists(readmePath)) {
                            const content = task.type === 'checkin' 
                                ? this.generateCheckinTaskContent(task)
                                : this.generateNormalTaskContent(task);
                            await this.app.vault.create(readmePath, content);
                        }
                    } catch (error) {
                        console.error(`为任务 ${task.title} 创建文件结构失败:`, error);
                        new Notice(`为任务 ${task.title} 创建文件结构失败`);
                    }
                }
                
                // 添加任务到数据中并保存
                this.data.tasks.push(...selectedTasks);
                await this.saveData();
                
                // 更新任务列表显示
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

    // 任务导入的具体方法 
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
    // 待修改：计时器开始/暂停  
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
                    todayRecord.dailyTimeSpent = task.timeSpent;
                }
                
                // 同时更新总时间
                task.totalTimeSpent = (task.totalTimeSpent || 0) + Math.floor(elapsed / 1000);
                
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

            // 更新总览页面的 total_time_spent
            const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
            const readmePath = `tasks/${fileName}/README.md`;
            
            if (await this.app.vault.adapter.exists(readmePath)) {
                const readmeFile = this.app.vault.getAbstractFileByPath(readmePath) as TFile;
                if (readmeFile instanceof TFile) {
                    let content = await this.app.vault.read(readmeFile);
                    const frontmatterRegex = /---([\s\S]*?)---/;
                    const frontmatterMatch = content.match(frontmatterRegex);
                    
                    if (frontmatterMatch) {
                        const frontmatterUpdate = {
                            total_time_spent: this.formatTime(task.totalTimeSpent || 0)
                        };

                        const updatedFrontmatter = Object.entries(frontmatterUpdate).reduce(
                            (acc, [key, value]) => {
                                const regex = new RegExp(`${key}:.*(\r?\n|\n|$)`, 'g');
                                if (acc.match(regex)) {
                                    return acc.replace(regex, `${key}: ${value}\n`);
                                }
                                return acc + `${key}: ${value}\n`;
                            },
                            frontmatterMatch[1].trim() + '\n'
                        );

                        content = content.replace(frontmatterRegex, `---\n${updatedFrontmatter.trim()}\n---`);
                        await this.app.vault.modify(readmeFile, content);
                    }
                }
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
                }
                
                // 初始化或获取今天的记录
                if (!todayRecord) {
                    todayRecord = {
                        date: today,
                        startTime: now,  // 这是今天第一次开始的时间
                        pauseTimes: [],
                        dailyTimeSpent: 0
                    };
                    task.timeRecords.push(todayRecord);
                    task.timeSpent = 0;  // 重置当日计时
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
                    const currentDate = moment().format('YYYY-MM-DD');
                    const todayRecord = task.timeRecords.find(r => r.date === currentDate);
                    
                    // 如果是新的一天，或者没有今天的记录，从零开始计时
                    if (!todayRecord || todayRecord.date !== currentDate) {
                        const elapsed = Math.floor((currentTime - task.timerStartTime) / 1000);
                        timeDisplay.textContent = this.formatTime(elapsed);
                    } else {
                        // 当天内累计时间
                        const elapsed = Math.floor((currentTime - task.timerStartTime) / 1000);
                        const totalSeconds = (task.timeSpent || 0) + elapsed;
                        timeDisplay.textContent = this.formatTime(totalSeconds);
                    }
                }
            }, 1000);
        }

        await this.saveData();
        timeDisplay.textContent = this.formatTime(task.timeSpent || 0);

        // 打开对应的笔记
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const recordFileName = `${task.title}-${moment().format('YYYY-MM-DD')}`.replace(/[\\/:*?"<>|]/g, '');
        const filePath = task.type === 'checkin'
            ? `tasks/${fileName}/打卡记录/${recordFileName}.md`
            : `tasks/${fileName}/进展记录/${recordFileName}.md`;  // 修改为正确的路径

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
                        `  - ${task.category || '其他'}`,
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
                        `date: ${moment().format('YYYY-MM-DD')}`,
                        `today_start: ${todayRecord?.startTime ? moment(todayRecord.startTime).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `completed_at: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `daily_time_spent: ${todayRecord ? this.formatTime(todayRecord.dailyTimeSpent) : '00:00:00'}`,
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
    // 待修改：任务时间记录更新 
    private async updateTaskTimeRecord(task: Task, action: 'start' | 'pause' | 'resume' | 'complete', elapsed?: number) {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const today = moment().format('YYYY-MM-DD');
        const recordFileName = `${task.title}-${today}`.replace(/[\\/:*?"<>|]/g, '');
        const recordFolder = `tasks/${fileName}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}`;
        const filePath = `${recordFolder}/${recordFileName}.md`;

        try {
            // 确保文件夹存在
            if (!await this.app.vault.adapter.exists(recordFolder)) {
                await this.app.vault.createFolder(recordFolder);
            }

            // 获取今天的记录
            const todayRecord = task.timeRecords.find(r => r.date === today);

            // 如果文件不存在，先创建文件
            if (!await this.app.vault.adapter.exists(filePath)) {
                // 使用现有的生成方法创建初始内容
                const initialContent = task.type === 'checkin' 
                    ? this.generateCheckinRecordContent(task, today)
                    : this.generateTaskRecordContent(task, today);
                await this.app.vault.create(filePath, initialContent);
            }

            // 更新文件内容
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                let content = await this.app.vault.read(file);
                
                // 更新 frontmatter
                const frontmatterUpdate = {
                    today_start: todayRecord?.startTime ? moment(todayRecord.startTime).format('HH:mm:ss') : '',  // 使用今天第一次开始的时间
                    today_end: action === 'pause' ? moment().format('HH:mm:ss') : '',
                    daily_time_spent: this.formatTime(task.timeSpent || 0),
                    status: action === 'complete' ? 
                        (task.type === 'checkin' ? '已打卡' : '已完成') : 
                        '进行中'
                };

                // 更新文件的 frontmatter
                const frontmatterRegex = /---([\s\S]*?)---/;
                const frontmatterMatch = content.match(frontmatterRegex);
                if (frontmatterMatch) {
                    const currentFrontmatter = frontmatterMatch[1].trim();
                    const updatedFrontmatter = Object.entries(frontmatterUpdate).reduce(
                        (acc, [key, value]) => {
                            const regex = new RegExp(`${key}:.*(\r?\n|\n|$)`, 'g');
                            if (acc.match(regex)) {
                                // 替换现有的属性行，保持一个换行符
                                return acc.replace(regex, `${key}: ${value}\n`);
                            }
                            // 添加新属性行，保持一个换行符
                            return acc + `${key}: ${value}\n`;
                        },
                        currentFrontmatter   // 只在开始时添加一个换行符
                    );
                    // 确保 frontmatter 前后只有一个换行符
                    content = content.replace(frontmatterRegex, `---\n${updatedFrontmatter.trim()}\n---`);
                }
                
                // 生成时间记录
                const timeRecord = [
                    `开始时间：${moment(todayRecord?.startTime).format('HH:mm:ss')}`,  // 使用今天第一次开始的时间
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
                    if (!content.endsWith('\n')) {
                        content += '\n';
                    }
                    content += `## 时间记录\n${timeRecord}`;
                }

                await this.app.vault.modify(file, content);
            }
        } catch (error) {
            console.error('更新时间记录失败:', error);
            new Notice('更新时间记录失败');
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
                 // 在这里添加创建笔记的步骤
                const newTask = this.data.tasks[this.data.tasks.length - 1]; // 获取刚刚添加的任务
                await this.createTaskNote(newTask);
            
                const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
                if (taskList) {
                    this.renderTasks(taskList);
                }
                this.createStatsSection();
            }
        });
        modal.open();
    }
    // 待修改：任务完成     
    private async toggleTask(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (!task) return;

        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const today = moment().format('YYYY-MM-DD');
        const recordFileName = `${task.title}-${today}`.replace(/[\\/:*?"<>|]/g, '');
        const recordFolder = `tasks/${fileName}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}`;
        const recordPath = `${recordFolder}/${recordFileName}.md`;
        const readmePath = `tasks/${fileName}/README.md`;

        // 切换任务状态
        task.completed = !task.completed;
        
        if (task.completed) {
            // 设置完成时间
            task.completedAt = Date.now();
            const completedTime = moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss');
            
            // 如果计时器正在运行，停止它
            if (task.isTimerRunning) {
                task.isTimerRunning = false;
                if (this.data.timers[taskId]) {
                    clearInterval(this.data.timers[taskId]);
                    delete this.data.timers[taskId];
                }
            }
            
            // 更新当天记录文件
            if (await this.app.vault.adapter.exists(recordPath)) {
                const recordFile = this.app.vault.getAbstractFileByPath(recordPath) as TFile;
                if (recordFile instanceof TFile) {
                    const frontmatterUpdate = {
                        status: task.type === 'checkin' ? '已打卡' : '已完成',
                        completed_at: completedTime,
                        today_end: moment().format('HH:mm:ss')
                    };
                    await this.updateFileFrontmatter(recordFile, frontmatterUpdate);
                }
            }

            // 更新 README 文件
            if (await this.app.vault.adapter.exists(readmePath)) {
                const readmeFile = this.app.vault.getAbstractFileByPath(readmePath) as TFile;
                if (readmeFile instanceof TFile) {
                    const frontmatterUpdate = {
                        status: task.type === 'checkin' ? '已打卡' : '已完成',
                        completed_at: completedTime,
                        actual_end: completedTime,
                        total_time_spent: this.formatTime(task.totalTimeSpent || 0)
                    };
                    await this.updateFileFrontmatter(readmeFile, frontmatterUpdate);
                }
            }
        } else {
            // 取消完成状态
            delete task.completedAt;
            
            // 更新当天记录文件
            if (await this.app.vault.adapter.exists(recordPath)) {
                const recordFile = this.app.vault.getAbstractFileByPath(recordPath) as TFile;
                if (recordFile instanceof TFile) {
                    const frontmatterUpdate = {
                        status: '进行中',
                        completed_at: '',
                        today_end: ''
                    };
                    await this.updateFileFrontmatter(recordFile, frontmatterUpdate);
                }
            }

            // 更新 README 文件
            if (await this.app.vault.adapter.exists(readmePath)) {
                const readmeFile = this.app.vault.getAbstractFileByPath(readmePath) as TFile;
                if (readmeFile instanceof TFile) {
                    const frontmatterUpdate = {
                        status: '进行中',
                        completed_at: '',
                        actual_end: ''
                    };
                    await this.updateFileFrontmatter(readmeFile, frontmatterUpdate);
                }
            }
        }

        // 保存数据并更新界面
        await this.saveData();
        const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
        if (taskList) {
            this.renderTasks(taskList);
        }
        this.createStatsSection();
    }

    // 辅助方法：更新文件的 frontmatter
    private async updateFileFrontmatter(file: TFile, updates: Record<string, string>) {
        const content = await this.app.vault.read(file);
        const frontmatterRegex = /---([\s\S]*?)---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        
        if (frontmatterMatch) {
            const currentFrontmatter = frontmatterMatch[1].trim();  // 先清理现有的多余空行
            const updatedFrontmatter = Object.entries(updates).reduce(
                (acc, [key, value]) => {
                    const regex = new RegExp(`${key}:.*(\r?\n|\n|$)`, 'g');
                    if (acc.match(regex)) {
                        return acc.replace(regex, `${key}: ${value}\n`);
                    }
                    return acc + `${key}: ${value}\n`;
                },
                currentFrontmatter   // 确保现有内容后有换行符
            );
            
            // 确保 frontmatter 前后都有换行符，并去除多余的空行
            const newContent = content.replace(
                frontmatterRegex, 
                `---\n${updatedFrontmatter.trim()}\n---`
            );
            
            await this.app.vault.modify(file, newContent);
        }
    }
    // 待修改：打卡记录更新 
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
    // 待修改：打卡记录生成

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

        // 立即更新文件内容
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const today = moment().format('YYYY-MM-DD');
        const recordFileName = `${task.title}-${today}`.replace(/[\\/:*?"<>|]/g, '');
        const recordPath = `tasks/${fileName}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}/${recordFileName}.md`;

        if (await this.app.vault.adapter.exists(recordPath)) {
            const file = this.app.vault.getAbstractFileByPath(recordPath) as TFile;
            if (file instanceof TFile) {
                let content = await this.app.vault.read(file);
                const frontmatterRegex = /---([\s\S]*?)---/;
                const frontmatterMatch = content.match(frontmatterRegex);
                
                if (frontmatterMatch) {
                    const frontmatterUpdate = {
                        daily_time_spent: '00:00:00',
                        today_start: '',
                        today_end: '',
                        status: '进行中'
                    };

                    const updatedFrontmatter = Object.entries(frontmatterUpdate).reduce(
                        (acc, [key, value]) => {
                            const regex = new RegExp(`${key}:.*(\r?\n|\n|$)`, 'g');
                            if (acc.match(regex)) {
                                return acc.replace(regex, `${key}: ${value}\n`);
                            }
                            return acc + `${key}: ${value}\n`;
                        },
                        frontmatterMatch[1].trim() 
                    );

                    content = content.replace(frontmatterRegex, `---\n${updatedFrontmatter.trim()}\n---`);
                    await this.app.vault.modify(file, content);
                }
            }
        }

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
        
        // 更新主界面统计区域
        this.createStatsSection();
        this.renderTasks(this.contentEl.querySelector('.task-list') as HTMLElement);
        
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

    

    // 待修改：创建今日总结
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
        const noteDate = now.format('YYYY-MM-DD');
        
        const frontmatter = {
            title: `${noteDate} 任务总结`,
            date: noteDate,
            type: 'daily',
            tags: ['任务', '日记']
        };
        
        let content = [
            '---',
            yaml.dump(frontmatter),
            '---',
            '',
            '## 📊 任务仪表盘',
            `> 更新时间：${now.format('YYYY-MM-DD HH:mm:ss')}`,
            '',
            '### 📝 今日待办',
            '```dataview',
            'TABLE WITHOUT ID',
            '  link(file.path, title) as "任务",',
            '  category as "分类",',
            '  priority as "优先级"',
            'FROM "tasks"',
            'WHERE file.name = "README" and',
            '  (',
            '    !completed_at or',
            '    !planned_start or',
            '    date(planned_start) <= date(this.file.name) or',
            '    date(completed_at) = date(this.file.name)',
            '  )',
            'SORT priority DESC, file.ctime ASC',
            '```',
            '',
            '### ⏱️ 今日进展',
            '```dataview',
            'TABLE WITHOUT ID',
            '  link(file.path, title) as "任务",',
            '  type as "类型",',
            '  today_start as "开始时间",',
            '  daily_time_spent as "今日用时",',
            '  status as "状态"',
            'FROM "tasks"',
            'WHERE contains(tags, "打卡记录") or contains(tags, "任务记录")',
            `  AND date(date) = date("${noteDate}")`,
            '  AND status = "进行中"',
            'SORT today_start DESC',
            '```',
            '',
            '### ✅ 今日完成',
            '```dataview',
            'TABLE WITHOUT ID',
            '  link(file.path, title) as "任务",',
            '  type as "类型",',
            '  today_start as "开始时间",',
            '  completed_at as "完成时间",',
            '  daily_time_spent as "用时"',
            'FROM "tasks"',
            'WHERE contains(tags, "打卡记录") or contains(tags, "任务记录")',
            `  AND date(date) = date("${noteDate}")`,
            '  AND (status = "已完成" OR status = "已打卡")',
            'SORT completed_at DESC',
            '```',
            '',
            '### 📊 统计概览',
            '```dataviewjs',
            'const allTasks = dv.pages(\'"tasks"\')',
            '  .where(p => (p.tags?.includes("打卡记录") || p.tags?.includes("任务记录"))',
            `    && dv.date(p.date)?.toFormat("yyyy-MM-dd") == "${noteDate}");`,
            '',
            'const completed = allTasks.where(p => p.status == "已完成" || p.status == "已打卡");',
            '',
            'dv.header(4, "🎯 任务情况");',
            'dv.paragraph(`- 总任务数：${allTasks.length} 个`);',
            'dv.paragraph(`- 进行中：${allTasks.length - completed.length} 个`);',
            'dv.paragraph(`- 已完成：${completed.length} 个`);',
            '',
            'const totalTime = allTasks',
            '  .array()',
            '  .reduce((sum, task) => {',
            '    const timeStr = task.daily_time_spent;',
            '    if (!timeStr) return sum;',
            '    const [h, m, s] = timeStr.split(":");',
            '    return sum + (+h * 3600 + +m * 60 + +s);',
            '  }, 0);',
            '',
            'const formatTime = (seconds) => {',
            '  const h = Math.floor(seconds / 3600);',
            '  const m = Math.floor((seconds % 3600) / 60);',
            '  const s = seconds % 60;',
            '  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;',
            '};',
            '',
            'dv.paragraph(`- 今日总用时：${formatTime(totalTime)}`);',
            '```',
            '',
            '### 📈 分类统计',
            '```dataviewjs',
            'const allTasks = dv.pages(\'"tasks"\')',
            '  .where(p => (p.tags?.includes("打卡记录") || p.tags?.includes("任务记录"))',
            `    && dv.date(p.date)?.toFormat("yyyy-MM-dd") == "${noteDate}");`,
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
            '  if (task.status == "已完成" || task.status == "已打卡") categories[category].completed++;',
            '  const timeStr = task.daily_time_spent;',
            '  if (timeStr) {',
            '    const [h, m, s] = timeStr.split(":");',
            '    categories[category].timeSpent += (+h * 3600 + +m * 60 + +s);',
            '  }',
            '});',
            '',
            'const formatTime = (seconds) => {',
            '  const h = Math.floor(seconds / 3600);',
            '  const m = Math.floor((seconds % 3600) / 60);',
            '  const s = seconds % 60;',
            '  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;',
            '};',
            '',
            'for (const [category, stats] of Object.entries(categories)) {',
            '  dv.header(4, category);',
            '  dv.paragraph(`- 总数：${stats.total}`);',
            '  dv.paragraph(`- 已完成：${stats.completed}`);',
            '  dv.paragraph(`- 用时：${formatTime(stats.timeSpent)}`);',
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
        
        
        // 尝试打开今天的记录文件
        
        const readmePath = `tasks/${fileName}/README.md`;

        try {
            let fileToOpen: TFile | null = null;

             if (await this.app.vault.adapter.exists(readmePath)) {
                fileToOpen = this.app.vault.getAbstractFileByPath(readmePath) as TFile;
            }

            if (fileToOpen) {
                await this.app.workspace.getLeaf().openFile(fileToOpen);
            } else {
                new Notice('未找到相关笔记');
            }
        } catch (error) {
            console.error('打开笔记失败:', error);
            new Notice('打开笔记失败');
        }
    }

    private generateCheckinTaskContent(task: Task): string {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const formatDateOnly = (date: string | undefined) => {
            if (!date) return '';
            return moment(date).format('YYYY-MM-DD');
        };
    
        return [
            '---',
            `title: ${task.title}`,
            'type: checkin',
            `category: ${task.category || '其他'}`,
            `priority: ${task.priority || 'NONE'}`,
            `planned_start: ${formatDateOnly(task.startDate)}`,
            `planned_end: ${formatDateOnly(task.dueDate)}`,
            `total_time_spent: ${this.formatTime(task.totalTimeSpent)}`,
            `status: ${task.completed ? '已完成' : (task.startedAt ? '进行中' : '未开始')}`,
        'tags:',
        '  - 打卡',
        `  - ${task.category || '其他'}`,
        '---',
        '',
        `# ${task.title}`,
            '',
            '## 任务说明',
            '',
            '## 打卡记录',
            '```dataview',
            'TABLE date as 日期, completed_at as 完成时间',
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

    // 新增：生成进展记录内容的方法
        private generateTaskRecordContent(task: Task, date: string): string {
            return [
                '---',
                `title: ${task.title} - ${date} 进展`,
                'type: task-record',
                `task_title: ${task.title}`,
                `category: ${task.category || '其他'}`,
                `priority: ${task.priority || 'NONE'}`,
                `planned_start: ${task.startDate || ''}`,
                `planned_end: ${task.dueDate || ''}`,
                `date: ${date}`,
                `today_start: ${task.startedAt || ''}`,
                `completed_at: ${task.completedAt || ''}`,
                `daily_time_spent: ${this.formatTime(task.timeSpent)}`,
                `status: ${task.completed ? '已完成' : '进行中'}`,
                'tags:',
                '  - 任务记录',
                `  - ${task.category || '其他'}`,
                ...(task.isUrgent ? ['  - 紧急'] : []),
                ...(task.isImportant ? ['  - 重要'] : []),
                '---',
                '',
                `# ${task.title} - ${date} 进展`,
                '',
                '## 今日进展',
                '',
                '## 遇到的问题',
                '',
                '## 解决方案',
                '',
            ].join('\n');
        }

    // 新增：生成打卡记录内容的方法
    private generateCheckinRecordContent(task: Task, date: string): string {
        return [
            '---',
            `title: ${task.title} - ${date} 打卡`,
            'type: checkin-record',
            `task_title: ${task.title}`,
            `category: ${task.category || '其他'}`,
            `priority: ${task.priority || 'NONE'}`,
            `planned_start: ${task.startDate || ''}`,
            `planned_end: ${task.dueDate || ''}`,
            `date: ${date}`,
            `today_start: ${task.startedAt || ''}`,
            `completed_at: ${task.completedAt || ''}`,
            `daily_time_spent: ${this.formatTime(task.timeSpent)}`,
            `status: ${task.completed ? '已打卡' : '未打卡'}`,
            'tags:',
            '  - 打卡记录',
            `  - ${task.category || '其他'}`,
            '---',
            '',
            `# ${task.title} - ${date} 打卡`,
            '',
            '## 打卡内容',
            '',
            '## 今日感想',
            '',
        ].join('\n');
    }

    // 添加更新笔记 frontmatter 的方法
    private async updateNoteFrontmatter(task: Task) {
        // 更新当天记录文件
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const today = moment().format('YYYY-MM-DD');
        const recordFileName = `${task.title}-${today}`.replace(/[\\/:*?"<>|]/g, '');
        const recordPath = `tasks/${fileName}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}/${recordFileName}.md`;
        const readmePath = `tasks/${fileName}/README.md`;

        try {
            // 更新当天记录文件
            if (await this.app.vault.adapter.exists(recordPath)) {
                const file = this.app.vault.getAbstractFileByPath(recordPath);
                if (file instanceof TFile) {
                    let content = await this.app.vault.read(file);
                    const frontmatterRegex = /---([\s\S]*?)---/;
                    const frontmatterMatch = content.match(frontmatterRegex);
                    
                    if (frontmatterMatch) {
                        const currentFrontmatter = frontmatterMatch[1].trim();
                        const todayRecord = task.timeRecords?.find(r => r.date === today);
                        
                        const frontmatterUpdate = {
                            daily_time_spent: this.formatTime(todayRecord?.dailyTimeSpent || 0),
                            status: task.completed ? (task.type === 'checkin' ? '已打卡' : '已完成') : '进行中'
                        };

                        const updatedFrontmatter = Object.entries(frontmatterUpdate).reduce(
                            (acc, [key, value]) => {
                                const regex = new RegExp(`${key}:.*(\r?\n|\n|$)`, 'g');
                                if (acc.match(regex)) {
                                    return acc.replace(regex, `${key}: ${value}\n`);
                                }
                                return acc + `${key}: ${value}\n`;
                            },
                            currentFrontmatter 
                        );

                        content = content.replace(frontmatterRegex, `---\n${updatedFrontmatter.trim()}\n---`);
                        await this.app.vault.modify(file, content);
                    }
                }
            }

            // 更新 README 文件
            if (await this.app.vault.adapter.exists(readmePath)) {
                const readmeFile = this.app.vault.getAbstractFileByPath(readmePath) as TFile;
                if (readmeFile instanceof TFile) {
                    let content = await this.app.vault.read(readmeFile);
                    const frontmatterRegex = /---([\s\S]*?)---/;
                    const frontmatterMatch = content.match(frontmatterRegex);
                    
                    if (frontmatterMatch) {
                        const frontmatterUpdate = {
                            total_time_spent: this.formatTime(task.totalTimeSpent || 0),
                            status: task.completed ? '已完成' : (task.startedAt ? '进行中' : '未开始')
                        };

                        const updatedFrontmatter = Object.entries(frontmatterUpdate).reduce(
                            (acc, [key, value]) => {
                                const regex = new RegExp(`${key}:.*(\r?\n|\n|$)`, 'g');
                                if (acc.match(regex)) {
                                    return acc.replace(regex, `${key}: ${value}\n`);
                                }
                                return acc + `${key}: ${value}\n`;
                            },
                            frontmatterMatch[1].trim() 
                        );

                        content = content.replace(frontmatterRegex, `---\n${updatedFrontmatter.trim()}\n---`);
                        await this.app.vault.modify(readmeFile, content);
                    }
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
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const formatDateOnly = (date: string | undefined) => {
            if (!date) return '';
            return moment(date).format('YYYY-MM-DD');
        };
        return [
            '---',
            `title: ${task.title}`,
            'type: task',
            `category: ${task.category || '其他'}`,
            `priority: ${task.priority || 'NONE'}`,
            `planned_start: ${formatDateOnly(task.startDate)}`,
            `planned_end: ${formatDateOnly(task.dueDate)}`,
            `total_time_spent: ${this.formatTime(task.totalTimeSpent || 0)}`,
            `status: ${task.completed ? '已完成' : (task.startedAt ? '进行中' : '未开始')}`,
            'tags:',
            '  - 任务',
            `  - ${task.category || '其他'}`,
            ...(task.isUrgent ? ['  - 紧急'] : []),
            ...(task.isImportant ? ['  - 重要'] : []),
            '---',
            '',
            `# ${task.title}`,
            '',
            '## 任务说明',
            '',
            '## 进展记录',
            '```dataview',
            'TABLE WITHOUT ID',
            '  link(file.path, dateformat(date, "yyyy-MM-dd")) as "日期",',  // 添加文件链接
            '  today_start as "开始时间",',
            '  today_end as "结束时间",',
            '  daily_time_spent as "当日用时"',
            `FROM "tasks/${fileName}/进展记录"`,
            'SORT date DESC',
            '```',
            '',
            '## 统计分析',
            '### 工作频率',
            '```dataview',
            'CALENDAR date',
            `FROM "tasks/${fileName}/进展记录"`,
            '```',
            '',
            '### 时间统计',
            '```dataview',
            'TABLE',
            '  min(date) as 开始日期,',
            '  max(date) as 最后日期,',
            '  length(rows) as 工作天数,',
            '  sum(dur(daily_time_spent)) as 总用时',
            `FROM "tasks/${fileName}/进展记录"`,
            'GROUP BY dateformat(date, "yyyy-MM") as 月份',
            'SORT 月份 DESC',
            '```',
            '',
            '### 总体统计',
            '```dataview',
            'TABLE WITHOUT ID',
            '  min(date) as "首次开始",',
            '  max(date) as "最后更新",',
            '  length(rows) as "总工作天数",',
            '  sum(dur(daily_time_spent)) as "累计用时"',
            `FROM "tasks/${fileName}/进展记录"`,
            '```',
            '',
            '### 最近进展',
            '```dataview',
            'LIST WITHOUT ID',
            '  "📅 " + dateformat(date, "yyyy-MM-dd") +',
            '  " ⏰ " + today_start + " → " + today_end +',
            '  " ⌛ " + daily_time_spent',
            `FROM "tasks/${fileName}/进展记录"`,
            'SORT date DESC',
            'LIMIT 5',
            '```',
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
                if (task.type === 'checkin') {
                    // 打卡任务：只比较时间部分
                    const reminderTime = moment(task.reminderTime).format('HH:mm');
                    const currentTime = now.format('HH:mm');
                    const today = now.format('YYYY-MM-DD');
                    const hasRemindedToday = task.lastReminder === today;

                    if (reminderTime === currentTime && !hasRemindedToday) {
                        new Notice(`打卡提醒：${task.title} 需要打卡了！`, 10000);
                        task.lastReminder = today;
                        this.saveData();
                    }
                } else {
                    // 普通任务：比较完整的日期时间
                    const reminderTime = moment(task.reminderTime);
                    if (Math.abs(now.diff(reminderTime, 'minutes')) < 1) {
                        new Notice(`任务提醒：${task.title} 需要处理了！`, 10000);
                        task.reminder = false;
                        this.saveData();
                    }
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
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const readmePath = `tasks/${fileName}/README.md`;
        
        // 总览页面的格式化函数：只显示日期
        const formatDateOnly = (timestamp: string | number | undefined) => {
            if (!timestamp) return '';
            return moment(timestamp).format('YYYY-MM-DD');
        };

        // 记录页面的格式化函数：只显示时间
        const formatTimeOnly = (timestamp: string | number | undefined) => {
            if (!timestamp) return '';
            return moment(timestamp).format('HH:mm:ss');
        };
        
        try {
            // 更新总览页面
            if (await this.app.vault.adapter.exists(readmePath)) {
                const file = this.app.vault.getAbstractFileByPath(readmePath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    
                    // 总览页面的 frontmatter：只显示日期
                    const frontmatter = [
                        '---',
                        `title: ${task.title}`,
                        `type: ${task.type === 'checkin' ? 'checkin' : 'task'}`,
                        `category: ${task.category || '其他'}`,
                        `priority: ${task.priority || 'NONE'}`,
                        `planned_start: ${formatDateOnly(task.startDate)}`,
                        `planned_end: ${formatDateOnly(task.dueDate)}`,
                        `actual_start: ${formatDateOnly(task.startedAt)}`,
                        `status: ${task.completed ? '已完成' : (task.startedAt ? '进行中' : '未开始')}`,
                        `progress: ${task.timeSpent > 0 ? Math.floor((task.timeSpent / 3600) * 100) : ''}`,
                        `completed_at: ${formatDateOnly(task.completedAt)}`,
                        'tags:',
                        `  - ${task.type === 'checkin' ? '打卡' : '任务'}`,
                        `  - ${task.category || '其他'}`,
                        ...(task.isUrgent ? ['  - 紧急'] : []),
                        ...(task.isImportant ? ['  - 重要'] : []),
                        '---'
                    ].join('\n');

                    const contentWithoutFrontmatter = content.replace(/---[\s\S]*?---/, '');
                    const updatedContent = frontmatter + contentWithoutFrontmatter;
                    await this.app.vault.modify(file, updatedContent);
                }
            }

            // 更新所有记录文件
            const recordFolder = `tasks/${fileName}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}`;
            if (await this.app.vault.adapter.exists(recordFolder)) {
                const folder = this.app.vault.getAbstractFileByPath(recordFolder);
                if (folder instanceof TFolder) {
                    const files = folder.children;
                    for (const file of files) {
                        if (file instanceof TFile && file.extension === 'md') {
                            const date = file.basename;
                            const content = await this.app.vault.read(file);
                            
                            // 读取原有的 frontmatter
                            const frontmatterMatch = content.match(/---([\s\S]*?)---/);
                            const originalFrontmatter = frontmatterMatch ? frontmatterMatch[1] : '';
                            const originalFrontmatterLines = originalFrontmatter.split('\n').filter(line => line.trim());

                            // 创建新的 frontmatter，只更新需要更新的属性
                            const newFrontmatterLines = [
                                '',
                                `title: ${task.title} - ${date} ${task.type === 'checkin' ? '打卡' : '进展'}`,
                                `type: ${task.type === 'checkin' ? 'checkin-record' : 'task-record'}`,
                                `task_title: ${task.title}`,
                                `category: ${task.category || '其他'}`,
                                `priority: ${task.priority || 'NONE'}`,
                                `date: ${date}`,
                                `planned_start: ${formatTimeOnly(task.startDate)}`,
                                `planned_end: ${formatTimeOnly(task.dueDate)}`,
                                'tags:',
                                `  - ${task.type === 'checkin' ? '打卡记录' : '任务记录'}`,
                                `  - ${task.category || '其他'}`,
                                ...(task.isUrgent ? ['  - 紧急'] : []),
                                ...(task.isImportant ? ['  - 重要'] : []),
                            ];

                            // 保留原有的时间相关属性
                            const timeRelatedProps = [
                                'actual_start',
                                'today_start',
                                'daily_time_spent',
                                'status'
                            ];

                            // 从原有 frontmatter 中保留时间相关属性
                            originalFrontmatterLines.forEach(line => {
                                const prop = line.split(':')[0]?.trim();
                                if (timeRelatedProps.includes(prop)) {
                                    newFrontmatterLines.push(line);
                                }
                            });

                            // 组合新的 frontmatter
                            const newFrontmatter = [
                                '---',
                                ...newFrontmatterLines,
                                '---'
                            ].join('\n');

                            // 保持原有内容，只更新 frontmatter
                            const contentWithoutFrontmatter = content.replace(/---[\s\S]*?---/, '');
                            const updatedContent = newFrontmatter + contentWithoutFrontmatter;
                            await this.app.vault.modify(file, updatedContent);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('更新任务笔记失败:', error);
            new Notice('更新任务笔记失败');
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

    private async createTaskNote(task: Task) {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const taskFolder = `tasks/${fileName}`;
        const recordFolder = `${taskFolder}/${task.type === 'checkin' ? '打卡记录' : '进展记录'}`;
        const readmePath = `${taskFolder}/README.md`;

        try {
            // 创建任务文件夹结构
            if (!await this.app.vault.adapter.exists(taskFolder)) {
                await this.app.vault.createFolder(taskFolder);
            }
            if (!await this.app.vault.adapter.exists(recordFolder)) {
                await this.app.vault.createFolder(recordFolder);
            }

            // 生成并创建任务总览笔记
            const content = task.type === 'checkin' 
                ? this.generateCheckinTaskContent(task)
                : this.generateNormalTaskContent(task);
            
            if (!await this.app.vault.adapter.exists(readmePath)) {
                await this.app.vault.create(readmePath, content);
            }

            // 打开笔记
            const file = this.app.vault.getAbstractFileByPath(readmePath) as TFile;
            await this.app.workspace.getLeaf().openFile(file);

        } catch (error) {
            console.error('创建任务笔记失败:', error);
            new Notice('创建任务笔记失败');
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

        // 任务类型选择改变时更新提醒时间输入框
        this.typeSelect.addEventListener('change', (e) => {
            const isCheckin = (e.target as HTMLSelectElement).value === 'checkin';
            if (this.reminderToggle.checked) {
                // 重新创建提醒时间输入框
                const oldValue = this.reminderTimeInput.value;
                this.reminderTimeInput.remove();
                
                if (isCheckin) {
                    // 打卡任务：只显示时间选择
                    this.reminderTimeInput = reminderTimeContainer.createEl('input', {
                        type: 'time',
                        value: oldValue ? moment(oldValue).format('HH:mm') : '09:00'
                    });
                } else {
                    // 普通任务：显示日期和时间
                    this.reminderTimeInput = reminderTimeContainer.createEl('input', {
                        type: 'datetime-local',
                        value: oldValue ? moment(oldValue).format('YYYY-MM-DDTHH:mm') : ''
                    });
                }
            }
        });

        // 提醒时间选择（默认隐藏）
        const reminderTimeContainer = contentEl.createDiv('task-reminder-time-container');
        reminderTimeContainer.style.display = this.task.reminder ? 'block' : 'none';
        reminderTimeContainer.createEl('label', { text: '提醒时间' });
        
        // 根据任务类型初始化提醒时间输入框
        if (this.typeSelect.value === 'checkin') {
            this.reminderTimeInput = reminderTimeContainer.createEl('input', {
                type: 'time',
                value: this.task.reminderTime ? 
                    moment(this.task.reminderTime).format('HH:mm') : 
                    '09:00'
            });
        } else {
            this.reminderTimeInput = reminderTimeContainer.createEl('input', {
                type: 'datetime-local',
                value: this.task.reminderTime ? 
                    moment(this.task.reminderTime).format('YYYY-MM-DDTHH:mm') : 
                    ''
            });
        }

        // 显示/隐藏提醒时间选择
        this.reminderToggle.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            reminderTimeContainer.style.display = isChecked ? 'block' : 'none';
            
            // 当开启提醒时，自动填入时间
            if (isChecked && !this.reminderTimeInput.value) {
                if (this.typeSelect.value === 'checkin') {
                    // 打卡任务默认设置为早上9点
                    this.reminderTimeInput.value = '09:00';
                } else {
                    // 普通任务使用开始时间
                    if (this.startDateInput.value) {
                        if (!this.startDateInput.value.includes(':')) {
                            const startDate = moment(this.startDateInput.value).format('YYYY-MM-DD');
                            this.reminderTimeInput.value = `${startDate}T09:00`;
                        } else {
                            this.reminderTimeInput.value = this.startDateInput.value;
                        }
                    }
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
                // 处理提醒时间
                let reminderTime = undefined;
                if (this.reminderToggle.checked && this.reminderTimeInput.value) {
                    if (this.typeSelect.value === 'checkin') {
                        // 打卡任务：使用今天的日期加上选择的时间
                        const timeOnly = this.reminderTimeInput.value; // 格式: "HH:mm"
                        reminderTime = moment().format('YYYY-MM-DD') + 'T' + timeOnly;
                    } else {
                        // 普通任务：使用完整的日期时间
                        reminderTime = this.reminderTimeInput.value;
                    }
                }

                this.onSubmit({
                    title,
                    category: this.categorySelect.value,
                    type: this.typeSelect.value as 'normal' | 'checkin',
                    startDate: this.startDateInput.value,
                    dueDate: this.dueDateInput.value,
                    reminder: this.reminderToggle.checked,
                    reminderTime: reminderTime,
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
