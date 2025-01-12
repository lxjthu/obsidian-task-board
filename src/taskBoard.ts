import moment from 'moment';
import { ItemView, WorkspaceLeaf, App, Modal, Setting, Notice, TFile } from 'obsidian';
import { Task } from './types';


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
    private textArea: HTMLTextAreaElement;
    private reflection: string = '';
    private onSubmit: (reflection: string) => void;

    constructor(app: App, onSubmit: (reflection: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "完成心得" });

        // 创建并保存文本区域引用
        this.textArea = contentEl.createEl("textarea", {
            attr: { 
                rows: "6",
                style: "width: 100%; margin-bottom: 1em;"
            }
        });
        
        // 直接监听 input 事件
        this.textArea.addEventListener('input', () => {
            this.reflection = this.textArea.value;
        });

        const buttonDiv = contentEl.createEl("div", {
            attr: { style: "display: flex; justify-content: flex-end; gap: 8px;" }
        });

        // 添加取消按钮
        const cancelBtn = buttonDiv.createEl("button", { text: "取消" });
        cancelBtn.addEventListener('click', () => this.close());

        // 添加提交按钮
        const submitBtn = buttonDiv.createEl("button", { text: "提交" });
        submitBtn.addEventListener('click', () => {
            if (this.reflection.trim()) {
                this.onSubmit(this.reflection);
                this.close();
            } else {
                new Notice('请输入完成心得');
            }
        });

        // 聚焦到文本区域
        this.textArea.focus();
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
        const taskSection = this.contentEl.createEl('div', { cls: 'task-board-task-section' });
        
        // 添加任务按钮
        const addButton = taskSection.createEl('button', { text: '添加任务' });
        addButton.addEventListener('click', () => this.showAddTaskModal());
        
        // 任务列表
        const taskList = taskSection.createEl('div', { cls: 'task-list' });
        this.renderTasks(taskList);
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
        
        tasksToShow.forEach(task => {
            const taskEl = container.createEl('div', { 
                cls: `task-item ${task.isUrgent ? 'urgent' : ''} ${task.isImportant ? 'important' : ''}`
            });
            
            // 复选框
            const checkbox = taskEl.createEl('input', { 
                type: 'checkbox',
                cls: 'task-checkbox'
            });
            checkbox.checked = task.completed;
            checkbox.addEventListener('change', () => this.toggleTask(task.id));
            
            // 任务信息容器
            const infoContainer = taskEl.createEl('div', { cls: 'task-info' });
            
            // 标签容器
            const tagsContainer = infoContainer.createEl('div', { cls: 'task-tags' });
            if (task.isUrgent) {
                tagsContainer.createEl('span', { 
                    text: '紧急',
                    cls: 'task-tag urgent'
                });
            }
            if (task.isImportant) {
                tagsContainer.createEl('span', { 
                    text: '重要',
                    cls: 'task-tag important'
                });
            }
            
            // 任务标题
            const titleEl = infoContainer.createEl('span', { 
                text: task.title,
                cls: `task-title ${task.completed ? 'completed' : ''} clickable`
            });
            titleEl.addEventListener('click', () => this.openOrCreateNote(task.title));
            
            // 在任务信息中添加时间显示
            if (task.startDate || task.dueDate) {
                const timeInfo = infoContainer.createEl('div', { cls: 'task-time-info' });
                if (task.startDate) {
                    timeInfo.createEl('span', { 
                        text: `开始：${moment(task.startDate).format('MM-DD HH:mm')}`,
                        cls: 'task-date start-date'
                    });
                }
                if (task.dueDate) {
                    timeInfo.createEl('span', { 
                        text: `截止：${moment(task.dueDate).format('MM-DD HH:mm')}`,
                        cls: 'task-date due-date'
                    });
                }
                if (task.reminder) {
                    timeInfo.createEl('span', { 
                        text: '⏰',
                        cls: 'task-reminder-icon'
                    });
                }
            }
            
            // 计时信息
            const timerContainer = infoContainer.createEl('div', { cls: 'timer-container' });
            const timeDisplay = timerContainer.createEl('span', {
                text: this.formatTime(task.timeSpent),
                cls: 'time-display'
            });
            
            // 计时按钮组
            const btnContainer = timerContainer.createEl('div', { cls: 'timer-btn-group' });
            
            // 开始/暂停按钮
            const timerBtn = btnContainer.createEl('button', {
                text: task.isTimerRunning ? '暂停' : (task.timeSpent > 0 ? '继续' : '开始'),
                cls: `timer-btn ${task.isTimerRunning ? 'running' : ''}`
            });
            timerBtn.addEventListener('click', () => this.toggleTimer(task.id, timeDisplay));
            
            // 清空计时按钮
            const resetBtn = btnContainer.createEl('button', {
                text: '清零',
                cls: 'timer-btn reset'
            });
            resetBtn.addEventListener('click', () => this.resetTimer(task.id));
            
            // 删除任务按钮
            const deleteBtn = btnContainer.createEl('button', {
                text: '删除',
                cls: 'timer-btn delete'
            });
            deleteBtn.addEventListener('click', () => this.deleteTask(task.id));
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

    private async toggleTimer(taskId: string, displayEl: ObsidianHTMLElement) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (!task) return;

        if (typeof task.timeSpent !== 'number') {
            task.timeSpent = 0;
        }

        if (!task.isTimerRunning) {
            // 如果是首次启动计时器，记录开始时间
            if (!task.startedAt) {
                task.startedAt = Date.now();
            }
            // 开始计时
            task.isTimerRunning = true;
            task.timerStartTime = Date.now();
            
            // 设置实时更新
            this.data.timers[taskId] = window.setInterval(() => {
                this.updateTimeDisplay(task, displayEl);
            }, 1000);
            
            // 更新按钮状态
            const button = displayEl.parentElement?.querySelector('.timer-btn') as ObsidianHTMLElement;
            if (button) {
                button.textContent = '暂停';
                button.classList.add('running');
            }
        } else {
            // 停止计时
            const now = Date.now();
            const elapsed = Math.floor((now - (task.timerStartTime || now)) / 1000);
            task.timeSpent += elapsed;
            task.isTimerRunning = false;
            delete task.timerStartTime;
            
            // 清除更新间隔
            if (this.data.timers[taskId]) {
                clearInterval(this.data.timers[taskId]);
                delete this.data.timers[taskId];
            }
            
            // 更新按钮状态
            const button = displayEl.parentElement?.querySelector('.timer-btn') as ObsidianHTMLElement;
            if (button) {
                button.textContent = task.timeSpent > 0 ? '继续' : '开始';
                button.classList.remove('running');
            }
        }

        await this.saveData();
        // 不再重新渲染整个列表
        displayEl.textContent = this.formatTime(task.timeSpent);
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
            clearInterval(timerId);
        });
        this.data.timers = {};
        
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
        const modal = new TaskModal(this.app, async (result) => {
            if (result) {
                console.log('Creating task with:', result); // 调试日志
                this.data.tasks.push({
                    id: Date.now().toString(),
                    title: result.title,
                    category: result.category,
                    type: result.type,
                    startDate: result.startDate,
                    dueDate: result.dueDate,
                    reminder: result.reminder,
                    reminderTime: result.reminderTime,
                    hideBeforeStart: result.hideBeforeStart,
                    isUrgent: result.isUrgent,
                    isImportant: result.isImportant,
                    completed: false,
                    timeSpent: 0,
                    isTimerRunning: false,
                    startedAt: undefined
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
        if (task) {
            if (!task.completed) {
                new ReflectionModal(this.app, async (reflection) => {
                    task.completed = true;
                    task.completedBy = this.data.currentUserId;
                    task.completedAt = Date.now();

                    // 处理打卡任务
                    if (task.type === 'checkin') {
                        await this.handleCheckinTaskCompletion(task, reflection);
                    } else {
                        // 处理普通任务
                        await this.updateNoteFrontmatter(task);
                        await this.addCompletionToNote(task, reflection);
                    }

                    await this.saveData();
                    const taskList = this.contentEl.querySelector('.task-list') as HTMLElement;
                    this.renderTasks(taskList);
                    this.createStatsSection();
                    
                    new Notice("任务完成！");
                }).open();
            }
        }
    }

    private async handleCheckinTaskCompletion(task: Task, reflection: string) {
        // 创建打卡文件夹
        const folderPath = `tasks/${task.title}/打卡记录`;
        if (!(await this.app.vault.adapter.exists(folderPath))) {
            await this.app.vault.createFolder(folderPath);
        }

        // 创建今日打卡记录
        const today = moment().format('YYYY-MM-DD');
        const currentTime = moment().format('HH:mm:ss');
        const checkinPath = `${folderPath}/${today}.md`;
        
        const checkinContent = [
            '---',
            `task: ${task.title}`,
            `date: ${today}`,
            `time: ${currentTime}`,  // 添加具体时间
            `type: checkin`,
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
            reflection,
            '',
            '## 明日计划',
            '',
        ].join('\n');

        await this.app.vault.create(checkinPath, checkinContent);

        // 重置任务完成状态（为明天准备）
        setTimeout(() => {
            task.completed = false;
            delete task.completedAt;
            this.saveData();
        }, 0);
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

        // 生成日期字符串
        const dateStr = moment().format('YYYY-MM-DD');
        const summaryContent = this.generateSummaryContent();

        // 获取或创建今天的日记文件
        const dailyNotePath = `日记/${dateStr}.md`;
        try {
            let existingContent = '';
            if (await this.app.vault.adapter.exists(dailyNotePath)) {
                existingContent = await this.app.vault.adapter.read(dailyNotePath);
                existingContent += '\n\n';
            }

            // 写入内容
            await this.app.vault.adapter.write(
                dailyNotePath,
                existingContent + summaryContent
            );

            new Notice('今日总结已添加到日记！');
            this.completions = []; // 清空完成记录
            await this.saveData();
        } catch (error) {
            new Notice('写入日记失败！请确保日记文件夹存在。');
            console.error('Failed to write daily note:', error);
        }
    }

    private generateSummaryContent(): string {
        const now = new Date();
        let content = `## 今日任务总结 (${now.toLocaleTimeString()})\n\n`;

        this.completions.forEach(({ taskName, reflection, timestamp }) => {
            const task = this.data.tasks.find(t => t.title === taskName);
            const tags = [];
            if (task?.isUrgent) tags.push('紧急');
            if (task?.isImportant) tags.push('重要');
            
            content += `### ${taskName} ${tags.length ? `[${tags.join('/')}]` : ''}\n`;
            content += `- 开始时间：${this.formatDate(task?.startedAt)}\n`;
            content += `- 完成时间：${this.formatDate(task?.completedAt)}\n`;
            content += `- 总用时：${this.formatTime(task?.timeSpent || 0)}\n`;
            content += `- 完成心得：${reflection}\n\n`;
        });

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
        try {
            const task = this.data.tasks.find(t => t.title === taskTitle);
            if (!task) {
                console.log('Task not found:', taskTitle);
                return;
            }

            console.log('Opening task:', task); // 调试日志

            const fileName = taskTitle.replace(/[\\/:*?"<>|]/g, '');
            const filePath = task.type === 'checkin' 
                ? `tasks/${fileName}/README.md`
                : `tasks/${fileName}.md`;

            console.log('File path:', filePath); // 调试日志

            // 确保 tasks 文件夹存在
            if (!(await this.app.vault.adapter.exists('tasks'))) {
                console.log('Creating tasks folder'); // 调试日志
                await this.app.vault.createFolder('tasks');
            }

            // 如果是打卡任务，确保任务文件夹存在
            if (task.type === 'checkin') {
                const taskFolderPath = `tasks/${fileName}`;
                console.log('Creating task folder:', taskFolderPath); // 调试日志
                if (!(await this.app.vault.adapter.exists(taskFolderPath))) {
                    await this.app.vault.createFolder(taskFolderPath);
                }
            }

            // 检查笔记是否存在
            const exists = await this.app.vault.adapter.exists(filePath);
            console.log('File exists:', exists); // 调试日志
            
            if (!exists) {
                // 创建新笔记
                const noteContent = task.type === 'checkin' 
                    ? this.generateCheckinTaskContent(task)
                    : this.generateNormalTaskContent(task);
                
                console.log('Creating new note with content'); // 调试日志
                await this.app.vault.create(filePath, noteContent);
            }

            // 打开笔记
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf(false).openFile(file);
            }
        } catch (error) {
            console.error('Error in openOrCreateNote:', error); // 错误日志
            new Notice(`创建笔记失败: ${error.message}`);
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
                        'due: ',
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
        return [
            '---',
            `alias: ${task.title}`,
            `status: ${task.completed ? '已完成' : '进行中'}`,
            `created: ${moment().format('YYYY-MM-DD')}`,
            'due: ',
            `progress: ${task.timeSpent > 0 ? Math.floor((task.timeSpent / 3600) * 100) : ''}`,
            `done: ${task.completedAt ? moment(task.completedAt).format('YYYY-MM-DD HH:mm:ss') : ''}`,
            'tags:',
            '  - 任务',
            `  - ${task.category || '其他'}`,
            ...(task.isUrgent ? ['  - 紧急'] : []),
            ...(task.isImportant ? ['  - 重要'] : []),
            '---',
            '',
            `# ${task.title}`,
            '',
            '## 任务详情',
            `- 分类：${task.category || '其他'}`,
            '',
            '## 进展记录',
            '',
            '## 完成情况记录',
            '',
            '## 相关链接',
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
    private isUrgent: boolean = false;
    private isImportant: boolean = false;
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
    } | null) => void;

    constructor(app: App, onSubmit: (result: {
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
    } | null) => void) {
        super(app);
        this.onSubmit = onSubmit;
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
        const urgentToggle = urgentContainer.createEl('input', { type: 'checkbox' });
        urgentToggle.addEventListener('change', (e) => {
            this.isUrgent = (e.target as HTMLInputElement).checked;
        });

        // 重要标签切换
        const importantContainer = contentEl.createDiv('task-toggle-container');
        importantContainer.createEl('label', { text: '重要' });
        const importantToggle = importantContainer.createEl('input', { type: 'checkbox' });
        importantToggle.addEventListener('change', (e) => {
            this.isImportant = (e.target as HTMLInputElement).checked;
        });

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
        const hideContainer = contentEl.createDiv('task-hide-container');
        hideContainer.createEl('label', { 
            text: '在开始日期前隐藏任务',
            attr: { style: 'margin-right: 8px;' }
        });
        this.hideBeforeStartToggle = hideContainer.createEl('input', { 
            type: 'checkbox'
        });

        // 添加截止时间
        const dueDateContainer = contentEl.createDiv('task-date-container');
        dueDateContainer.createEl('label', { text: '截止时间' });
        this.dueDateInput = dueDateContainer.createEl('input', {
            type: 'datetime-local',
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 添加提醒设置
        const reminderContainer = contentEl.createDiv('task-reminder-container');
        const reminderLabel = reminderContainer.createEl('label', { text: '开启提醒' });
        this.reminderToggle = reminderContainer.createEl('input', { 
            type: 'checkbox',
            attr: { style: 'margin-left: 8px;' }
        });

        // 提醒时间选择（默认隐藏）
        const reminderTimeContainer = contentEl.createDiv('task-reminder-time-container');
        reminderTimeContainer.style.display = 'none';
        reminderTimeContainer.createEl('label', { text: '提醒时间' });
        this.reminderTimeInput = reminderTimeContainer.createEl('input', {
            type: 'datetime-local',
            attr: { style: 'width: 100%; margin-top: 8px; padding: 4px;' }
        });

        // 显示/隐藏提醒时间选择
        this.reminderToggle.addEventListener('change', (e) => {
            reminderTimeContainer.style.display = 
                (e.target as HTMLInputElement).checked ? 'block' : 'none';
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
                    isUrgent: this.isUrgent,
                    isImportant: this.isImportant
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
