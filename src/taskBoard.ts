import { ItemView, WorkspaceLeaf, App, Modal, Setting, Notice } from 'obsidian';

export const VIEW_TYPE_TASK_BOARD = 'task-points-board-view';

// 将接口移到类的外部
interface Task {
    id: string;
    title: string;
    points: number;
    completed: boolean;
    completedBy?: string;
    completedAt?: number;
    startedAt?: number;    // 添加开始时间
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
}

export class TaskBoardView extends ItemView {
    contentEl: HTMLElement;
    private data: TaskBoardData;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.data = {
            users: [],
            tasks: [],
            rewardItems: [],
            currentUserId: '',
            timers: {}
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
            const taskEl = container.createEl('div', { cls: 'task-item' });
            
            // 任务完成状态
            const checkbox = taskEl.createEl('input', { type: 'checkbox' });
            checkbox.checked = task.completed;
            checkbox.addEventListener('change', () => this.toggleTask(task.id));
            
            // 任务信息容器
            const infoContainer = taskEl.createEl('div', { cls: 'task-info' });
            
            // 任务标题和积分
            infoContainer.createEl('span', { 
                text: `${task.title} (${task.points}分)`,
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
        
        // 按钮容器
        const btnContainer = headerContainer.createEl('div', { cls: 'stats-header-buttons' });
        
        // 今日总结按钮
        const summaryBtn = btnContainer.createEl('button', {
            text: '今日总结',
            cls: 'summary-btn'
        });
        summaryBtn.addEventListener('click', () => this.createDailySummary());
        
        // 清空记录按钮
        const clearAllBtn = btnContainer.createEl('button', {
            text: '清空记录',
            cls: 'clear-records-btn'
        });
        clearAllBtn.addEventListener('click', () => this.clearCompletedTasks());

        // 获取已完成的任务并按完成时间排序
        const completedTasks = this.data.tasks
            .filter(t => t.completed)
            .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

        if (completedTasks.length === 0) {
            statsSection.createEl('div', { 
                text: '暂无已完成任务',
                cls: 'no-tasks'
            });
            return;
        }

        // 创建任务记录列表
        const recordList = statsSection.createEl('div', { cls: 'task-record-list' });
        
        completedTasks.forEach(task => {
            const recordItem = recordList.createEl('div', { cls: 'task-record-item' });
            
            // 记录内容容器
            const contentContainer = recordItem.createEl('div', { cls: 'record-content' });
            contentContainer.createEl('div', { 
                text: `📝 ${task.title} (${task.points}分)`,
                cls: 'task-record-title'
            });
            contentContainer.createEl('div', { 
                text: `⏰ 开始：${this.formatDate(task.startedAt || task.timerStartTime)}`,
                cls: 'task-record-time'
            });
            contentContainer.createEl('div', { 
                text: `🏁 完成：${this.formatDate(task.completedAt)}`,
                cls: 'task-record-time'
            });
            contentContainer.createEl('div', { 
                text: `⌛ 用时：${this.formatTime(task.timeSpent)}`,
                cls: 'task-record-time'
            });
            
            // 删除按钮
            const deleteBtn = recordItem.createEl('button', {
                text: '删除',
                cls: 'record-delete-btn'
            });
            deleteBtn.addEventListener('click', () => this.deleteCompletedTask(task.id));
        });
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
                    points: result.points,
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
            task.completed = !task.completed;
            if (task.completed) {
                // 完成任务时的处理
                task.completedBy = this.data.currentUserId;
                task.completedAt = Date.now();
                
                // 如果任务正在计时，停止计时
                if (task.isTimerRunning) {
                    const now = Date.now();
                    const elapsed = Math.floor((now - (task.timerStartTime || now)) / 1000);
                    task.timeSpent += elapsed;
                    task.isTimerRunning = false;
                    
                    // 清除计时器
                    if (this.data.timers[taskId]) {
                        clearInterval(this.data.timers[taskId]);
                        delete this.data.timers[taskId];
                    }
                }
            } else {
                // 取消完成时的处理
                delete task.completedBy;
                delete task.completedAt;
                // 重置计时相关数据，允许重新开始
                task.timeSpent = 0;
                task.isTimerRunning = false;
                delete task.timerStartTime;
                delete task.startedAt;  // 清除开始时间，允许记录新的开始时间
            }
            
            await this.saveData();
            
            // 更新界面
            this.renderTasks(this.contentEl.querySelector('.task-list') as HTMLElement);
            this.createStatsSection();
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

    private async createDailySummary() {
        // 获取今天的日期
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        
        // 获取今天完成的任务
        const todayTasks = this.data.tasks.filter(task => {
            if (!task.completed || !task.completedAt) return false;
            const completedDate = new Date(task.completedAt).toISOString().split('T')[0];
            return completedDate === dateStr;
        });

        if (todayTasks.length === 0) {
            new Notice('今天还没有完成任何任务！');
            return;
        }

        // 生成总结内容
        const summaryContent = [
            '## 今日任务总结',
            '',
            '### 已完成任务',
            ''
        ];

        // 计算总时间和总积分
        let totalTime = 0;
        let totalPoints = 0;

        // 添加每个任务的详细信息
        todayTasks.forEach(task => {
            totalTime += task.timeSpent;
            totalPoints += task.points;
            
            summaryContent.push(`#### ${task.title} (${task.points}分)`);
            summaryContent.push(`- 开始时间：${this.formatDate(task.startedAt || task.timerStartTime)}`);
            summaryContent.push(`- 完成时间：${this.formatDate(task.completedAt)}`);
            summaryContent.push(`- 用时：${this.formatTime(task.timeSpent)}`);
            summaryContent.push('');
        });

        // 添加总结信息
        summaryContent.push('### 总结');
        summaryContent.push(`- 完成任务数：${todayTasks.length}`);
        summaryContent.push(`- 总计用时：${this.formatTime(totalTime)}`);
        summaryContent.push(`- 总计积分：${totalPoints}`);
        summaryContent.push('');

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
                existingContent + summaryContent.join('\n')
            );

            new Notice('今日总结已添加到日记！');
        } catch (error) {
            new Notice('写入日记失败！请确保日记文件夹存在。');
            console.error('Failed to write daily note:', error);
        }
    }
}

class TaskModal extends Modal {
    private title: string = '';
    private points: number = 0;
    private onSubmit: (result: { title: string, points: number } | null) => void;

    constructor(app: App, onSubmit: (result: { title: string, points: number } | null) => void) {
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
            .setName('积分')
            .addText(text => text
                .setValue(this.points.toString())
                .onChange(value => this.points = Number(value)));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('保存')
                .setCta()
                .onClick(() => {
                    this.onSubmit({
                        title: this.title,
                        points: this.points
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
