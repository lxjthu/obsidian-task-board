import moment from 'moment';
import { ItemView, WorkspaceLeaf, App, Modal, Setting, Notice, TFile } from 'obsidian';

export const VIEW_TYPE_TASK_BOARD = 'task-points-board-view';

// 将接口移到类的外部
interface Task {
    id: string;
    title: string;
    isUrgent: boolean;    // 新增：紧急标签
    isImportant: boolean; // 新增：重要标签
    completed: boolean;
    completedBy?: string;
    completedAt?: number;
    startedAt?: number;
    description?: string;
    timeSpent: number;
    isTimerRunning: boolean;
    timerStartTime?: number;
}

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
    reflection: string = ''; // 初始化反思内容
    onSubmit: (reflection: string) => void;

    constructor(app: App, onSubmit: (reflection: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "完成心得" });

        // 创建文本区域并添加输入事件
        const textArea = contentEl.createEl("textarea", {
            attr: { 
                rows: "6",
                style: "width: 100%; margin-bottom: 1em;"
            }
        });
        
        // 添加输入事件监听
        textArea.addEventListener('input', (e) => {
            this.reflection = (e.target as HTMLTextAreaElement).value;
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
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class TaskBoardView extends ItemView {
    contentEl: HTMLElement;
    private data: TaskBoardData;
    private completions: TaskCompletion[] = [];

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
        return '任务积分板';
    }

    async onOpen() {
        // 加载保存的数据
        await this.loadData();
        
        // 从加载的数据中恢复 completions
        this.completions = this.data.completions || [];

        // 创建界面
        this.contentEl = this.containerEl.children[1] as HTMLElement;
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
    }

    private createHeader() {
        const header = this.contentEl.createEl('div', { cls: 'task-board-header' });
        header.createEl('h2', { text: '任务积分板' });
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

    private renderTasks(container: HTMLElement) {
        container.empty();
        
        this.data.tasks.forEach(task => {
            const taskEl = container.createEl('div', { 
                cls: `task-item ${task.isUrgent ? 'urgent' : ''} ${task.isImportant ? 'important' : ''}`
            });
            
            // 添加标签显示
            const tagsContainer = taskEl.createEl('div', { cls: 'task-tags' });
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

            // 任务完成状态
            const checkbox = taskEl.createEl('input', { type: 'checkbox' });
            checkbox.checked = task.completed;
            checkbox.addEventListener('change', () => this.toggleTask(task.id));
            
            // 任务信息容器
            const infoContainer = taskEl.createEl('div', { cls: 'task-info' });
            
            // 任务标题
            infoContainer.createEl('span', { 
                text: task.title,
                cls: task.completed ? 'completed' : ''
            });
            
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
                text: task.isTimerRunning ? '暂停' : '开始',
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

    private updateTimeDisplay(task: Task, displayEl: HTMLElement) {
        if (!task.isTimerRunning) return;
        
        const now = Date.now();
        const totalSeconds = task.timeSpent + Math.floor((now - (task.timerStartTime || now)) / 1000);
        displayEl.textContent = this.formatTime(totalSeconds);
    }

    private async toggleTimer(taskId: string, displayEl: HTMLElement) {
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
            const button = displayEl.parentElement?.querySelector('.timer-btn') as HTMLElement;
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
            const button = displayEl.parentElement?.querySelector('.timer-btn') as HTMLElement;
            if (button) {
                button.textContent = '开始';
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
        this.completions = this.completions.filter(c => 
            c.taskName !== completion.taskName || 
            c.timestamp !== completion.timestamp
        );
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
        }
    }

    async saveData() {
        await this.saveLocalData(this.data);
    }

    private async loadLocalData(): Promise<TaskBoardData | null> {
        const data = await this.app.vault.adapter.read(`${this.app.vault.configDir}/task-board.json`);
        return data ? JSON.parse(data) : null;
    }

    private async saveLocalData(data: TaskBoardData) {
        await this.app.vault.adapter.write(
            `${this.app.vault.configDir}/task-board.json`,
            JSON.stringify(data)
        );
    }

    private async showAddTaskModal() {
        const modal = new TaskModal(this.app, async (result) => {
            if (result) {
                this.data.tasks.push({
                    id: Date.now().toString(),
                    title: result.title,
                    isUrgent: false,
                    isImportant: false,
                    completed: false,
                    timeSpent: 0,
                    isTimerRunning: false,
                    startedAt: undefined  // 初始化为 undefined
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
                    
                    this.completions.push({
                        taskName: task.title,
                        reflection: reflection,
                        timestamp: Date.now(),
                        startedAt: task.startedAt,
                        completedAt: Date.now(),
                        timeSpent: task.timeSpent
                    });

                    await this.saveData();
                    this.renderTasks(this.contentEl.querySelector('.task-list') as HTMLElement);
                    this.createStatsSection();
                    
                    new Notice("任务完成！");
                }).open();
            } else {
                // 取消完成时的处理
                task.completed = false;
                delete task.completedBy;
                delete task.completedAt;
                
                // 不再从完成记录中移除
                // this.completions = this.completions.filter(c => c.taskName !== task.title);
                
                await this.saveData();
                this.renderTasks(this.contentEl.querySelector('.task-list') as HTMLElement);
                this.createStatsSection();
            }
        }
    }

    private async resetTimer(taskId: string) {
        const task = this.data.tasks.find(t => t.id === taskId);
        if (task) {
            task.timeSpent = 0;
            task.isTimerRunning = false;
            delete task.timerStartTime;
            await this.saveData();
            this.renderTasks(this.contentEl.querySelector('.task-list') as HTMLElement);
        }
    }

    private async deleteTask(taskId: string) {
        const taskIndex = this.data.tasks.findIndex(t => t.id === taskId);
        if (taskIndex > -1) {
            this.data.tasks.splice(taskIndex, 1);
            await this.saveData();
            // 更新任务列表和完成记录
            this.renderTasks(this.contentEl.querySelector('.task-list') as HTMLElement);
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
        // 添加确认对话框
        if (this.completions.length > 0) {
            const confirmed = confirm('确定要清空所有完成记录吗？此操作不可撤销。');
            if (confirmed) {
                this.completions = [];
                await this.saveData();
                this.createStatsSection();
                new Notice('已清空所有完成记录');
            }
        } else {
            new Notice('没有可清空的记录');
        }
    }
}

class TaskModal extends Modal {
    private title: string = '';
    private isUrgent: boolean = false;
    private isImportant: boolean = false;
    private onSubmit: (result: { 
        title: string, 
        isUrgent: boolean, 
        isImportant: boolean 
    } | null) => void;

    constructor(app: App, onSubmit: (result: { 
        title: string, 
        isUrgent: boolean, 
        isImportant: boolean 
    } | null) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: '添加新任务' });

        new Setting(contentEl)
            .setName('任务名称')
            .addText(text => text
                .setValue(this.title)
                .onChange(value => this.title = value));

        new Setting(contentEl)
            .setName('紧急')
            .addToggle(toggle => toggle
                .setValue(this.isUrgent)
                .onChange(value => this.isUrgent = value));

        new Setting(contentEl)
            .setName('重要')
            .addToggle(toggle => toggle
                .setValue(this.isImportant)
                .onChange(value => this.isImportant = value));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('保存')
                .setCta()
                .onClick(() => {
                    this.onSubmit({
                        title: this.title,
                        isUrgent: this.isUrgent,
                        isImportant: this.isImportant
                    });
                    this.close();
                }))
            .addButton(btn => btn
                .setButtonText('取消')
                .onClick(() => {
                    this.onSubmit(null);
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
