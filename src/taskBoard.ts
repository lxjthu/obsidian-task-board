import moment from 'moment';
import { ItemView, WorkspaceLeaf, App, Modal, Setting, Notice, TFile } from 'obsidian';
import { Task, TaskPriority } from './types';


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
    
            // 添加新任务
            this.data.tasks.push(...tasks);
            
            // 保存并更新界面
            await this.saveData();
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            if (taskList) {
                this.renderTasks(taskList);
            }
            
            new Notice(`成功导入 ${tasks.length} 个任务`);
        } catch (error) {
            console.error('导入失败:', error);
            new Notice('导入失败，请检查笔记格式');
        }
    }

    private parseObsidianTasksToBoard(content: string): Task[] {
        // 创建空数组存储解析后的任务
        const tasks: Task[] = [];
        
        // 按行分割内容，只保留包含任务标记的行
        const taskLines = content.split('\n').filter(line => 
            line.includes('- [ ]') || line.includes('- [x]')
        );
        
        // 处理每一行任务
        taskLines.forEach(line => {
            // 检查任务是否完成
            const completed = line.includes('- [x]');
            // 提取任务标题（去掉checkbox标记）
            const title = line.replace(/^- \[[x ]\] /, '').trim();
            
            // 创建新的任务对象
            tasks.push({
                id: Date.now().toString(),
                title,
                completed,
                timeSpent: 0,
                isTimerRunning: false,
                priority: TaskPriority.NONE
            });
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
                tagsSection.createEl('span', {
                    cls: `task-priority priority-${task.priority}`,
                    text: `P: ${task.priority}`
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
            const timeDisplay = timerSection.createEl('span', {
                cls: 'time-display',
                text: this.formatTime(task.timeSpent)
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

        // 确保 timeSpent 有初始值
        if (typeof task.timeSpent !== 'number') {
            task.timeSpent = 0;
        }

        // 获取按钮元素
        const button = timeDisplay.closest('.task-item')?.querySelector('.timer-btn') as HTMLButtonElement;
        if (!button) return;

        if (task.isTimerRunning) {
            // 暂停计时器
            task.isTimerRunning = false;
            const now = Date.now();
            const elapsed = now - (task.timerStartTime || 0);
            task.timeSpent = (task.timeSpent || 0) + Math.floor(elapsed / 1000);  // 转换为秒
            delete task.timerStartTime;
            
            // 更新按钮状态
            button.textContent = task.timeSpent > 0 ? '继续' : '开始';
            button.classList.remove('running');
            
            // 清除更新间隔
            if (this.data.timers[taskId]) {
                clearInterval(this.data.timers[taskId]);
                delete this.data.timers[taskId];
            }
            
            // 记录暂停时间
            await this.updateTaskTimeRecord(task, 'pause', elapsed);
        } else {
            // 开始计时器
            task.isTimerRunning = true;
            task.timerStartTime = Date.now();
            
            // 更新按钮状态
            button.textContent = '暂停';
            button.classList.add('running');
            
            // 设置实时更新
            this.data.timers[taskId] = window.setInterval(() => {
                if (task.isTimerRunning && task.timerStartTime) {
                    const now = Date.now();
                    const totalSeconds = task.timeSpent + Math.floor((now - task.timerStartTime) / 1000);
                    timeDisplay.textContent = this.formatTime(totalSeconds);
                }
            }, 1000);
            
            // 如果是第一次开始，记录实际开始时间
            if (!task.startedAt) {
                task.startedAt = task.timerStartTime;
                await this.updateTaskNoteAfterEdit(task);
            }
            // 记录继续时间
            await this.updateTaskTimeRecord(task, 'resume');
        }

        await this.saveData();
        timeDisplay.textContent = this.formatTime(task.timeSpent || 0);
    }

    private async updateTaskTimeRecord(task: Task, action: 'start' | 'pause' | 'resume', elapsed?: number) {
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const filePath = `tasks/${fileName}.md`;

        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    let content = await this.app.vault.read(file);
                    
                    // 保存原有的 frontmatter
                    let frontmatter = '';
                    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---/);
                    if (frontmatterMatch) {
                        frontmatter = frontmatterMatch[0] + '\n';
                        content = content.slice(frontmatterMatch[0].length).trim();
                    }
                    
                    // 格式化时间记录
                    const timeRecord = [
                        '',
                        `### ${moment().format('YYYY-MM-DD HH:mm:ss')} ${
                            action === 'start' ? '开始' : 
                            action === 'pause' ? '暂停' : '继续'
                        }`,
                        action === 'pause' ? `- 本次持续：${this.formatTime(Math.floor((elapsed || 0) / 1000))}` : '',
                        action === 'pause' ? `- 累计用时：${this.formatTime(Math.floor(task.timeSpent || 0))}` : '',
                        ''
                    ].filter(line => line !== '').join('\n');

                    // 查找完成情况记录部分并添加新记录
                    const completionSectionRegex = /## 完成情况记录\n/;
                    if (completionSectionRegex.test(content)) {
                        content = content.replace(
                            completionSectionRegex,
                            `## 完成情况记录\n${timeRecord}`
                        );
                    } else {
                        // 如果没有找到完成情况记录部分，添加到文件末尾
                        content += '\n## 完成情况记录\n' + timeRecord;
                    }

                    // 重新组合内容，确保保留 frontmatter
                    const updatedContent = frontmatter + content;
                    await this.app.vault.modify(file, updatedContent);
                }
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
        
        // 标题和按钮容器
        const headerContainer = statsSection.createEl('div', { cls: 'stats-header' });
        headerContainer.createEl('h3', { text: '任务完成记录' });

        // 添加按钮容器
        const buttonsContainer = headerContainer.createEl('div', { cls: 'stats-header-buttons' });

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

        if (this.completions.length === 0) {
            statsSection.createEl('div', { 
                text: '暂无完成记录',
                cls: 'no-tasks'
            });
            return;
        }

        // 创建记录列表
        const recordList = statsSection.createEl('div', { cls: 'task-record-list' });
        
        this.completions.forEach(completion => {
            const recordItem = recordList.createEl('div', { cls: 'task-record-item' });
            
            // 记录内容容器
            const contentContainer = recordItem.createEl('div', { cls: 'record-content' });
            
            // 找到对应的任务以获取更多信息
            const task = this.data.tasks.find(t => t.title === completion.taskName);
            
            contentContainer.createEl('div', { 
                text: `📝 ${completion.taskName} ${task?.isUrgent ? '[紧急]' : ''} ${task?.isImportant ? '[重要]' : ''}`,
                cls: 'task-record-title'
            });
            contentContainer.createEl('div', { 
                text: `⏰ 开始时间：${this.formatDate(completion.startedAt)}`,
                cls: 'task-record-time'
            });
            contentContainer.createEl('div', { 
                text: `⏰ 完成时间：${this.formatDate(completion.completedAt)}`,
                cls: 'task-record-time'
            });
            contentContainer.createEl('div', { 
                text: `⌛ 实际用时：${this.formatTime(completion.timeSpent)}`,
                cls: 'task-record-time'
            });
            contentContainer.createEl('div', { 
                text: `💭 完成心得：${completion.reflection}`,
                cls: 'task-record-reflection'
            });

            // 添加删除按钮
            const deleteBtn = recordItem.createEl('button', {
                text: '删除',
                cls: 'task-record-delete'
            });
            deleteBtn.addEventListener('click', () => this.deleteCompletion(completion));
        });
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
            priority: TaskPriority.NONE
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
                    priority: result.priority || TaskPriority.NONE
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

        // 如果是打卡任务，检查今天是否已经打卡
        if (task.type === 'checkin') {
            const today = moment().format('YYYY-MM-DD');
            const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
            const checkinPath = `tasks/${fileName}/打卡记录/${today}.md`;
            
            // 检查今天的打卡文件是否已存在
            const fileExists = await this.app.vault.adapter.exists(checkinPath);
            
            if (fileExists && !task.completed) {
                // 如果文件已存在且任务未完成，打开已存在的文件
                const existingFile = this.app.vault.getAbstractFileByPath(checkinPath);
                if (existingFile instanceof TFile) {
                    await this.app.workspace.getLeaf().openFile(existingFile);
                    return;
                }
            }
        }

        // 显示打卡对话框或完成任务
        if (task.type === 'checkin' && !task.completed) {
            new CheckinModal(this.app, async (content) => {
                if (content !== null) {
                    await this.completeCheckinTask(task, content);
                }
            }).open();
        } else {
            await this.completeTask(task);
        }
    }

    private async completeCheckinTask(task: Task, content: string) {
        const today = moment().format('YYYY-MM-DD');
        const currentTime = moment().format('HH:mm:ss');
        const fileName = task.title.replace(/[\\/:*?"<>|]/g, '');
        const checkinPath = `tasks/${fileName}/打卡记录/${today}.md`;
        
        try {
            // 创建打卡笔记
            const checkinContent = [
                '---',
                `date: ${today}`,
                `time: ${currentTime}`,
                `task: ${task.title}`,
                'type: checkin',
                'tags:',
                '  - 打卡',
                `  - ${task.category || '其他'}`,
                '---',
                '',
                `# ${task.title} - ${today} 打卡记录`,
                '',
                '## 完成情况',
                `- 完成时间：${moment().format('YYYY-MM-DD HH:mm:ss')}`,
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

            // 创建并打开打卡笔记
            let file: TFile;
            if (await this.app.vault.adapter.exists(checkinPath)) {
                file = this.app.vault.getAbstractFileByPath(checkinPath) as TFile;
                await this.app.vault.modify(file, checkinContent);
            } else {
                file = await this.app.vault.create(checkinPath, checkinContent);
            }
            await this.app.workspace.getLeaf().openFile(file);

            // 完成任务
            await this.completeTask(task);
            
            // 重置任务完成状态（为明天准备）
            setTimeout(() => {
                task.completed = false;
                delete task.completedAt;
                this.saveData();
            }, 0);
        } catch (error) {
            console.error('创建打卡笔记失败:', error);
            new Notice('创建打卡笔记失败');
        }
    }

    private async resetTimer(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (task) {
            task.timeSpent = 0;
            task.isTimerRunning = false;
            delete task.timerStartTime;
            await this.saveData();
            const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
            this.renderTasks(taskList);
        }
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

    // 处理任务完成
    private async handleTaskCompletion(taskName: string) {
        new ReflectionModal(this.app, async (reflection) => {
            this.completions.push({
                taskName,
                reflection,
                timestamp: Date.now(),
                startedAt: undefined,
                completedAt: Date.now(),
                timeSpent: 0
            });
            new Notice("已记录完成心得！");
        }).open();
    }

    // 创建今日总结
    private async createDailySummary() {
        if (this.completions.length === 0) {
            new Notice("今天还没有完成任何任务！");
            return;
        }

        try {
            // 生成日期字符串
            const dateStr = moment().format('YYYY-MM-DD');
            const summaryContent = this.generateSummaryContent();

            // 确保日记文件夹存在
            const dailyNotesFolder = 'daily';
            if (!(await this.app.vault.adapter.exists(dailyNotesFolder))) {
                await this.app.vault.createFolder(dailyNotesFolder);
            }

            // 获取或创建今天的日记文件
            const dailyNotePath = `${dailyNotesFolder}/${dateStr}.md`;
            let existingContent = '';
            
            if (await this.app.vault.adapter.exists(dailyNotePath)) {
                const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
                if (file instanceof TFile) {
                    existingContent = await this.app.vault.read(file);
                }
            }

            // 如果文件不存在，创建基本结构
            if (!existingContent) {
                existingContent = [
                    '---',
                    `date: ${dateStr}`,
                    'type: daily',
                    'tags:',
                    '  - 日记',
                    '---',
                    '',
                    `# ${dateStr} 日记`,
                    '',
                    '## 今日记录',
                    '',
                ].join('\n');
            }

            // 添加任务总结
            const updatedContent = existingContent + '\n' + summaryContent;

            // 写入或更新文件
            if (await this.app.vault.adapter.exists(dailyNotePath)) {
                const file = this.app.vault.getAbstractFileByPath(dailyNotePath);
                if (file instanceof TFile) {
                    await this.app.vault.modify(file, updatedContent);
                }
            } else {
                await this.app.vault.create(dailyNotePath, updatedContent);
            }

            new Notice('今日总结已添加到日记！');

            // 清空完成记录
            this.completions = [];
            this.data.completions = [];
            await this.saveData();
            this.createStatsSection();

        } catch (error) {
            console.error('Failed to create daily summary:', error);
            new Notice('创建今日总结失败！请检查日记文件夹权限。');
        }
    }

    private generateSummaryContent(): string {
        const now = moment();
        let content = [
            '## 今日任务总结',
            `> 更新时间：${now.format('HH:mm:ss')}`,
            '',
            '### 已完成任务',
            ''
        ].join('\n');

        // 按任务类型分组
        const tasksByCategory: { [key: string]: TaskCompletion[] } = {};
        this.completions.forEach(completion => {
            const task = this.data.tasks.find(t => t.title === completion.taskName);
            const category = task?.category || '其他';
            if (!tasksByCategory[category]) {
                tasksByCategory[category] = [];
            }
            tasksByCategory[category].push(completion);
        });

        // 按分类输出任务
        Object.entries(tasksByCategory).forEach(([category, completions]: [string, TaskCompletion[]]) => {
            content += `#### ${category}\n`;
            completions.forEach(({ taskName, reflection, startedAt, completedAt, timeSpent }) => {
                const task = this.data.tasks.find(t => t.title === taskName);
                const tags = [];
                if (task?.isUrgent) tags.push('紧急');
                if (task?.isImportant) tags.push('重要');
                
                content += `##### ${taskName} ${tags.length ? `[${tags.join('/')}]` : ''}\n`;
                content += `- 开始时间：${startedAt ? moment(startedAt).format('HH:mm:ss') : '未记录'}\n`;
                content += `- 完成时间：${moment(completedAt).format('HH:mm:ss')}\n`;
                content += `- 用时：${this.formatTime(timeSpent)}\n`;
                if (reflection) {
                    content += `- 心得：${reflection}\n`;
                }
                content += '\n';
            });
        });

        // 添加统计信息
        const totalTasks = this.completions.length;
        const totalTime = this.completions.reduce((sum, c) => sum + (c.timeSpent || 0), 0);
        
        content += [
            '### 今日统计',
            `- 完成任务数：${totalTasks}`,
            `- 总计用时：${this.formatTime(totalTime)}`,
            `- 平均用时：${this.formatTime(Math.floor(totalTime / totalTasks))}`,
            ''
        ].join('\n');

        return content;
    }

    // 添加清空所有完成记录的方法
    private async clearAllCompletions() {
        if (this.completions.length > 0) {
            const confirmed = confirm('确定要清空所有完成记录吗？此操作不可撤销。');
            if (confirmed) {
                this.completions = [];
                // 更新 TaskBoardData 中的 completions
                this.data.completions = [];
                await this.saveData();
                this.createStatsSection();
                new Notice('已清空所有完成记录');
            }
        } else {
            new Notice('没有可清空的记录');
        }
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

        try {
            if (await this.app.vault.adapter.exists(filePath)) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    const content = await this.app.vault.read(file);
                    
                    // 更新 frontmatter
                    const newFrontmatter = [
                        '---',
                        `alias: ${task.title}`,
                        `status: ${task.completed ? '已完成' : '进行中'}`,
                        `created: ${moment(file.stat.ctime).format('YYYY-MM-DD')}`,
                        `planned_start: ${task.startDate ? moment(task.startDate).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `actual_start: ${task.startedAt ? moment(task.startedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `due: ${task.dueDate ? moment(task.dueDate).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        `progress: ${task.timeSpent > 0 ? Math.floor((task.timeSpent / 3600) * 100) : ''}`,
                        `done: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
                        'tags:',
                        '  - 任务',
                        ...(task.isUrgent ? ['  - 紧急'] : []),
                        ...(task.isImportant ? ['  - 重要'] : []),
                        '---'
                    ].join('\n');

                    // 替换原有的 frontmatter
                    const newContent = content.replace(/---[\s\S]*?---/, newFrontmatter);
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

    private sortTasks(tasks: Task[]): Task[] {
        const priorityOrder = {
            [TaskPriority.HIGH]: 0,    // 高优先级排在最前
            [TaskPriority.MEDIUM]: 1,
            [TaskPriority.LOW]: 2,
            [TaskPriority.NONE]: 3
        };

        return tasks.sort((a, b) => {
            // 首先按优先级排序（高优先级在前）
            const priorityDiff = (priorityOrder[a.priority || TaskPriority.NONE] || 3) 
                - (priorityOrder[b.priority || TaskPriority.NONE] || 3);
            if (priorityDiff !== 0) return priorityDiff;

            // 其次按创建时间倒序（新任务在前）
            const aId = parseInt(a.id || '0');
            const bId = parseInt(b.id || '0');
            return bId - aId;  // 新创建的任务 id 更大，所以倒序排列
        });
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
                `alias: ${task.title}`,
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
            // 打开反思对话框
            new ReflectionModal(this.app, async (reflection) => {
                task.completed = true;
                task.completedBy = this.data.currentUserId;
                task.completedAt = Date.now();
                // 重置计时器状态
                task.isTimerRunning = false;
                delete task.timerStartTime;

                // 添加到完成记录
                this.completions.push({
                    taskName: task.title,
                    reflection: reflection,
                    timestamp: Date.now(),
                    startedAt: task.startedAt,
                    completedAt: task.completedAt,
                    timeSpent: task.timeSpent || 0
                });

                // 更新笔记
                await this.updateTaskNoteOnCompletion(task, reflection);

                // 保存数据
                this.data.completions = this.completions;
                await this.saveData();

                // 更新界面
                const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
                this.renderTasks(taskList);
                this.createStatsSection();
                
                new Notice("任务完成！");
            }).open();
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
