import { __awaiter } from "tslib";
import moment from 'moment';
import { ItemView, Modal, Setting, Notice, TFile } from 'obsidian';
export const VIEW_TYPE_TASK_BOARD = 'task-points-board-view';
// 创建反思对话框
class ReflectionModal extends Modal {
    constructor(app, onSubmit) {
        super(app);
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "完成心得" });
        const textArea = contentEl.createEl("textarea", {
            attr: { rows: "6", style: "width: 100%;" }
        });
        const buttonDiv = contentEl.createEl("div", {
            attr: { style: "display: flex; justify-content: flex-end; margin-top: 1em;" }
        });
        buttonDiv.createEl("button", { text: "提交" }).onclick = () => {
            this.onSubmit(textArea.value);
            this.close();
        };
    }
    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
export class TaskBoardView extends ItemView {
    constructor(leaf) {
        super(leaf);
        this.completions = [];
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
    onOpen() {
        return __awaiter(this, void 0, void 0, function* () {
            // 加载保存的数据
            yield this.loadData();
            // 创建界面
            this.contentEl = this.containerEl.children[1];
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
        });
    }
    createHeader() {
        const header = this.contentEl.createEl('div', { cls: 'task-board-header' });
        header.createEl('h2', { text: '任务积分板' });
    }
    createUserSection() {
        const userSection = this.contentEl.createEl('div', { cls: 'task-board-user-section' });
        // 用户选择和管理界面
    }
    createTaskSection() {
        const taskSection = this.contentEl.createEl('div', { cls: 'task-board-task-section' });
        // 添加任务按钮
        const addButton = taskSection.createEl('button', { text: '添加任务' });
        addButton.addEventListener('click', () => this.showAddTaskModal());
        // 任务列表
        const taskList = taskSection.createEl('div', { cls: 'task-list' });
        this.renderTasks(taskList);
    }
    renderTasks(container) {
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
    formatTime(seconds) {
        // 添加安全检查
        if (!seconds || isNaN(seconds)) {
            return "00:00:00";
        }
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    updateTimeDisplay(task, displayEl) {
        if (!task.isTimerRunning)
            return;
        const now = Date.now();
        const totalSeconds = task.timeSpent + Math.floor((now - (task.timerStartTime || now)) / 1000);
        displayEl.textContent = this.formatTime(totalSeconds);
    }
    toggleTimer(taskId, displayEl) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            const task = this.data.tasks.find(t => t.id === taskId);
            if (!task)
                return;
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
                const button = (_a = displayEl.parentElement) === null || _a === void 0 ? void 0 : _a.querySelector('.timer-btn');
                if (button) {
                    button.textContent = '暂停';
                    button.classList.add('running');
                }
            }
            else {
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
                const button = (_b = displayEl.parentElement) === null || _b === void 0 ? void 0 : _b.querySelector('.timer-btn');
                if (button) {
                    button.textContent = '开始';
                    button.classList.remove('running');
                }
            }
            yield this.saveData();
            // 不再重新渲染整个列表
            displayEl.textContent = this.formatTime(task.timeSpent);
        });
    }
    createStatsSection() {
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
    clearCompletedTasks() {
        return __awaiter(this, void 0, void 0, function* () {
            // 停止所有已完成任务的计时器
            this.data.tasks.forEach(task => {
                if (task.completed && task.isTimerRunning && this.data.timers[task.id]) {
                    clearInterval(this.data.timers[task.id]);
                    delete this.data.timers[task.id];
                }
            });
            // 只删除已完成任务的记录，保留未完成的任务
            this.data.tasks = this.data.tasks.filter(t => !t.completed);
            yield this.saveData();
            this.createStatsSection();
        });
    }
    deleteCompletedTask(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            const task = this.data.tasks.find(t => t.id === taskId);
            if (task) {
                // 如果任务正在计时，先停止计时器
                if (task.isTimerRunning && this.data.timers[taskId]) {
                    clearInterval(this.data.timers[taskId]);
                    delete this.data.timers[taskId];
                }
                // 从数组中移除任务
                this.data.tasks = this.data.tasks.filter(t => t.id !== taskId);
                yield this.saveData();
                // 只更新完成记录区域，不重新渲染任务列表
                this.createStatsSection();
            }
        });
    }
    createRewardSection() {
        const rewardSection = this.contentEl.createEl('div', { cls: 'task-board-reward-section' });
        // 奖励列表和兑换界面
    }
    onClose() {
        return __awaiter(this, void 0, void 0, function* () {
            // 清理所有计时器
            Object.values(this.data.timers).forEach(timerId => {
                clearInterval(timerId);
            });
            this.data.timers = {};
            // 保存数据
            yield this.saveData();
        });
    }
    loadData() {
        return __awaiter(this, void 0, void 0, function* () {
            const savedData = yield this.loadLocalData();
            if (savedData) {
                this.data = Object.assign(Object.assign({}, this.data), savedData);
            }
        });
    }
    saveData() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveLocalData(this.data);
        });
    }
    loadLocalData() {
        return __awaiter(this, void 0, void 0, function* () {
            const data = yield this.app.vault.adapter.read(`${this.app.vault.configDir}/task-board.json`);
            return data ? JSON.parse(data) : null;
        });
    }
    saveLocalData(data) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.app.vault.adapter.write(`${this.app.vault.configDir}/task-board.json`, JSON.stringify(data));
        });
    }
    showAddTaskModal() {
        return __awaiter(this, void 0, void 0, function* () {
            const modal = new TaskModal(this.app, (result) => __awaiter(this, void 0, void 0, function* () {
                if (result) {
                    this.data.tasks.push({
                        id: Date.now().toString(),
                        title: result.title,
                        points: result.points,
                        completed: false,
                        timeSpent: 0,
                        isTimerRunning: false,
                        startedAt: undefined // 初始化为 undefined
                    });
                    yield this.saveData();
                    const taskList = this.contentEl.querySelector('.task-list');
                    if (taskList) {
                        this.renderTasks(taskList);
                    }
                    this.createStatsSection();
                }
            }));
            modal.open();
        });
    }
    toggleTask(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
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
                }
                else {
                    // 取消完成时的处理
                    delete task.completedBy;
                    delete task.completedAt;
                    // 重置计时相关数据，允许重新开始
                    task.timeSpent = 0;
                    task.isTimerRunning = false;
                    delete task.timerStartTime;
                    delete task.startedAt; // 清除开始时间，允许记录新的开始时间
                }
                yield this.saveData();
                // 更新界面
                this.renderTasks(this.contentEl.querySelector('.task-list'));
                this.createStatsSection();
            }
        });
    }
    resetTimer(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            const task = this.data.tasks.find(t => t.id === taskId);
            if (task) {
                task.timeSpent = 0;
                task.isTimerRunning = false;
                delete task.timerStartTime;
                yield this.saveData();
                this.renderTasks(this.contentEl.querySelector('.task-list'));
            }
        });
    }
    deleteTask(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            const taskIndex = this.data.tasks.findIndex(t => t.id === taskId);
            if (taskIndex > -1) {
                this.data.tasks.splice(taskIndex, 1);
                yield this.saveData();
                // 更新任务列表和完成记录
                this.renderTasks(this.contentEl.querySelector('.task-list'));
                this.createStatsSection();
            }
        });
    }
    formatDate(timestamp) {
        if (!timestamp)
            return '未记录';
        const date = new Date(timestamp);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    }
    // 处理任务完成
    handleTaskCompletion(taskName) {
        return __awaiter(this, void 0, void 0, function* () {
            new ReflectionModal(this.app, (reflection) => __awaiter(this, void 0, void 0, function* () {
                this.completions.push({
                    taskName,
                    reflection,
                    timestamp: Date.now()
                });
                new Notice("已记录完成心得！");
            })).open();
        });
    }
    // 创建今日总结
    createDailySummary() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.completions.length === 0) {
                new Notice("今天还没有完成任何任务！");
                return;
            }
            try {
                // 获取日记文件
                const dailyNote = yield this.getDailyNote();
                if (!dailyNote) {
                    new Notice("无法找到或创建今天的日记！");
                    return;
                }
                // 生成并添加总结内容
                const summaryContent = this.generateSummaryContent();
                const existingContent = yield this.app.vault.read(dailyNote);
                yield this.app.vault.modify(dailyNote, existingContent + "\n\n" + summaryContent);
                new Notice("今日总结已添加到日记！");
                this.completions = []; // 清空完成记录
            }
            catch (error) {
                console.error("更新日记失败:", error);
                new Notice("更新日记失败！");
            }
        });
    }
    // 新增：获取日记文件的方法
    getDailyNote() {
        return __awaiter(this, void 0, void 0, function* () {
            // 获取日记插件
            const dailyNotesPlugin = this.app.plugins.getPlugin('daily-notes');
            if (!(dailyNotesPlugin === null || dailyNotesPlugin === void 0 ? void 0 : dailyNotesPlugin.enabled)) {
                new Notice("请启用日记插件！");
                return null;
            }
            // 获取日记设置
            const { format, folder } = dailyNotesPlugin.instance.options;
            const filename = moment().format(format || 'YYYY-MM-DD');
            const normalizedPath = `${folder ? folder + '/' : ''}${filename}.md`;
            // 获取或创建日记文件
            let dailyNote = this.app.vault.getAbstractFileByPath(normalizedPath);
            if (!dailyNote) {
                try {
                    // 如果日记不存在，创建新的日记
                    const template = yield this.getTemplate();
                    dailyNote = yield this.app.vault.create(normalizedPath, template || '');
                }
                catch (err) {
                    console.error("创建日记失败:", err);
                    return null;
                }
            }
            return dailyNote instanceof TFile ? dailyNote : null;
        });
    }
    generateSummaryContent() {
        const now = new Date();
        let content = `## 今日任务总结 (${now.toLocaleTimeString()})\n\n`;
        this.completions.forEach(({ taskName, reflection, timestamp }) => {
            const time = new Date(timestamp).toLocaleTimeString();
            content += `### ${taskName} (${time})\n`;
            content += `- 完成心得：${reflection}\n\n`;
        });
        return content;
    }
    getTemplate() {
        return __awaiter(this, void 0, void 0, function* () {
            // 返回一个默认的模板字符串，或者从某个位置加载模板
            return "# 日记模板\n\n今天的任务总结：\n";
        });
    }
}
class TaskModal extends Modal {
    constructor(app, onSubmit) {
        super(app);
        this.title = '';
        this.points = 0;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidGFza0JvYXJkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidGFza0JvYXJkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7QUFBQSxPQUFPLE1BQU0sTUFBTSxRQUFRLENBQUM7QUFDNUIsT0FBTyxFQUFFLFFBQVEsRUFBc0IsS0FBSyxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sVUFBVSxDQUFDO0FBRXZGLE1BQU0sQ0FBQyxNQUFNLG9CQUFvQixHQUFHLHdCQUF3QixDQUFDO0FBZ0M3RCxVQUFVO0FBQ1YsTUFBTSxlQUFnQixTQUFRLEtBQUs7SUFJL0IsWUFBWSxHQUFRLEVBQUUsUUFBc0M7UUFDeEQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ1gsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7SUFDN0IsQ0FBQztJQUVELE1BQU07UUFDRixNQUFNLEVBQUUsU0FBUyxFQUFFLEdBQUcsSUFBSSxDQUFDO1FBQzNCLFNBQVMsQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFFM0MsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLFFBQVEsQ0FBQyxVQUFVLEVBQUU7WUFDNUMsSUFBSSxFQUFFLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsY0FBYyxFQUFFO1NBQzdDLENBQUMsQ0FBQztRQUVILE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQyxRQUFRLENBQUMsS0FBSyxFQUFFO1lBQ3hDLElBQUksRUFBRSxFQUFFLEtBQUssRUFBRSw0REFBNEQsRUFBRTtTQUNoRixDQUFDLENBQUM7UUFFSCxTQUFTLENBQUMsUUFBUSxDQUFDLFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLE9BQU8sR0FBRyxHQUFHLEVBQUU7WUFDeEQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7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IjpbImltcG9ydCBtb21lbnQgZnJvbSAnbW9tZW50JztcclxuaW1wb3J0IHsgSXRlbVZpZXcsIFdvcmtzcGFjZUxlYWYsIEFwcCwgTW9kYWwsIFNldHRpbmcsIE5vdGljZSwgVEZpbGUgfSBmcm9tICdvYnNpZGlhbic7XHJcblxyXG5leHBvcnQgY29uc3QgVklFV19UWVBFX1RBU0tfQk9BUkQgPSAndGFzay1wb2ludHMtYm9hcmQtdmlldyc7XHJcblxyXG4vLyDlsIbmjqXlj6Pnp7vliLDnsbvnmoTlpJbpg6hcclxuaW50ZXJmYWNlIFRhc2sge1xyXG4gICAgaWQ6IHN0cmluZztcclxuICAgIHRpdGxlOiBzdHJpbmc7XHJcbiAgICBwb2ludHM6IG51bWJlcjtcclxuICAgIGNvbXBsZXRlZDogYm9vbGVhbjtcclxuICAgIGNvbXBsZXRlZEJ5Pzogc3RyaW5nO1xyXG4gICAgY29tcGxldGVkQXQ/OiBudW1iZXI7XHJcbiAgICBzdGFydGVkQXQ/OiBudW1iZXI7ICAgIC8vIOa3u+WKoOW8gOWni+aXtumXtFxyXG4gICAgZGVzY3JpcHRpb24/OiBzdHJpbmc7XHJcbiAgICB0aW1lU3BlbnQ6IG51bWJlcjtcclxuICAgIGlzVGltZXJSdW5uaW5nOiBib29sZWFuO1xyXG4gICAgdGltZXJTdGFydFRpbWU/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBUYXNrQm9hcmREYXRhIHtcclxuICAgIHVzZXJzOiBhbnlbXTtcclxuICAgIHRhc2tzOiBUYXNrW107XHJcbiAgICByZXdhcmRJdGVtczogYW55W107XHJcbiAgICBjdXJyZW50VXNlcklkOiBzdHJpbmc7XHJcbiAgICB0aW1lcnM6IHtba2V5OiBzdHJpbmddOiBudW1iZXJ9O1xyXG59XHJcblxyXG4vLyDlrprkuYnku7vliqHlrozmiJDorrDlvZXnmoTmjqXlj6NcclxuaW50ZXJmYWNlIFRhc2tDb21wbGV0aW9uIHtcclxuICAgIHRhc2tOYW1lOiBzdHJpbmc7XHJcbiAgICByZWZsZWN0aW9uOiBzdHJpbmc7XHJcbiAgICB0aW1lc3RhbXA6IG51bWJlcjtcclxufVxyXG5cclxuLy8g5Yib5bu65Y+N5oCd5a+56K+d5qGGXHJcbmNsYXNzIFJlZmxlY3Rpb25Nb2RhbCBleHRlbmRzIE1vZGFsIHtcclxuICAgIHJlZmxlY3Rpb246IHN0cmluZztcclxuICAgIG9uU3VibWl0OiAocmVmbGVjdGlvbjogc3RyaW5nKSA9PiB2b2lkO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBvblN1Ym1pdDogKHJlZmxlY3Rpb246IHN0cmluZykgPT4gdm9pZCkge1xyXG4gICAgICAgIHN1cGVyKGFwcCk7XHJcbiAgICAgICAgdGhpcy5vblN1Ym1pdCA9IG9uU3VibWl0O1xyXG4gICAgfVxyXG5cclxuICAgIG9uT3BlbigpIHtcclxuICAgICAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgICAgICBjb250ZW50RWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwi5a6M5oiQ5b+D5b6XXCIgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHRleHRBcmVhID0gY29udGVudEVsLmNyZWF0ZUVsKFwidGV4dGFyZWFcIiwge1xyXG4gICAgICAgICAgICBhdHRyOiB7IHJvd3M6IFwiNlwiLCBzdHlsZTogXCJ3aWR0aDogMTAwJTtcIiB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IGJ1dHRvbkRpdiA9IGNvbnRlbnRFbC5jcmVhdGVFbChcImRpdlwiLCB7XHJcbiAgICAgICAgICAgIGF0dHI6IHsgc3R5bGU6IFwiZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBmbGV4LWVuZDsgbWFyZ2luLXRvcDogMWVtO1wiIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgYnV0dG9uRGl2LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgdGV4dDogXCLmj5DkuqRcIiB9KS5vbmNsaWNrID0gKCkgPT4ge1xyXG4gICAgICAgICAgICB0aGlzLm9uU3VibWl0KHRleHRBcmVhLnZhbHVlKTtcclxuICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgb25DbG9zZSgpIHtcclxuICAgICAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcclxuICAgICAgICBjb250ZW50RWwuZW1wdHkoKTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFRhc2tCb2FyZFZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XHJcbiAgICBjb250ZW50RWw6IEhUTUxFbGVtZW50O1xyXG4gICAgcHJpdmF0ZSBkYXRhOiBUYXNrQm9hcmREYXRhO1xyXG4gICAgcHJpdmF0ZSBjb21wbGV0aW9uczogVGFza0NvbXBsZXRpb25bXSA9IFtdO1xyXG5cclxuICAgIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYpIHtcclxuICAgICAgICBzdXBlcihsZWFmKTtcclxuICAgICAgICB0aGlzLmRhdGEgPSB7XHJcbiAgICAgICAgICAgIHVzZXJzOiBbXSxcclxuICAgICAgICAgICAgdGFza3M6IFtdLFxyXG4gICAgICAgICAgICByZXdhcmRJdGVtczogW10sXHJcbiAgICAgICAgICAgIGN1cnJlbnRVc2VySWQ6ICcnLFxyXG4gICAgICAgICAgICB0aW1lcnM6IHt9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBnZXRWaWV3VHlwZSgpIHtcclxuICAgICAgICByZXR1cm4gVklFV19UWVBFX1RBU0tfQk9BUkQ7XHJcbiAgICB9XHJcblxyXG4gICAgZ2V0RGlzcGxheVRleHQoKSB7XHJcbiAgICAgICAgcmV0dXJuICfku7vliqHnp6/liIbmnb8nO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIG9uT3BlbigpIHtcclxuICAgICAgICAvLyDliqDovb3kv53lrZjnmoTmlbDmja5cclxuICAgICAgICBhd2FpdCB0aGlzLmxvYWREYXRhKCk7XHJcblxyXG4gICAgICAgIC8vIOWIm+W7uueVjOmdolxyXG4gICAgICAgIHRoaXMuY29udGVudEVsID0gdGhpcy5jb250YWluZXJFbC5jaGlsZHJlblsxXSBhcyBIVE1MRWxlbWVudDtcclxuICAgICAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xyXG4gICAgICAgIHRoaXMuY29udGVudEVsLmFkZENsYXNzKCd0YXNrLWJvYXJkLWNvbnRhaW5lcicpO1xyXG5cclxuICAgICAgICAvLyDliJvlu7rkuLvopoHljLrln59cclxuICAgICAgICB0aGlzLmNyZWF0ZUhlYWRlcigpO1xyXG4gICAgICAgIHRoaXMuY3JlYXRlVXNlclNlY3Rpb24oKTtcclxuICAgICAgICB0aGlzLmNyZWF0ZVRhc2tTZWN0aW9uKCk7XHJcbiAgICAgICAgdGhpcy5jcmVhdGVTdGF0c1NlY3Rpb24oKTtcclxuICAgICAgICB0aGlzLmNyZWF0ZVJld2FyZFNlY3Rpb24oKTtcclxuXHJcbiAgICAgICAgLy8g5re75Yqg5LuK5pel5oC757uT5oyJ6ZKuXHJcbiAgICAgICAgY29uc3Qgc3VtbWFyeUJ1dHRvbiA9IHRoaXMuY29udGFpbmVyRWwuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICAgICAgICB0ZXh0OiBcIuS7iuaXpeaAu+e7k1wiLFxyXG4gICAgICAgICAgICBhdHRyOiB7IHN0eWxlOiBcIm1hcmdpbi10b3A6IDFlbTtcIiB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgc3VtbWFyeUJ1dHRvbi5vbmNsaWNrID0gKCkgPT4gdGhpcy5jcmVhdGVEYWlseVN1bW1hcnkoKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGNyZWF0ZUhlYWRlcigpIHtcclxuICAgICAgICBjb25zdCBoZWFkZXIgPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICd0YXNrLWJvYXJkLWhlYWRlcicgfSk7XHJcbiAgICAgICAgaGVhZGVyLmNyZWF0ZUVsKCdoMicsIHsgdGV4dDogJ+S7u+WKoeenr+WIhuadvycgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjcmVhdGVVc2VyU2VjdGlvbigpIHtcclxuICAgICAgICBjb25zdCB1c2VyU2VjdGlvbiA9IHRoaXMuY29udGVudEVsLmNyZWF0ZUVsKCdkaXYnLCB7IGNsczogJ3Rhc2stYm9hcmQtdXNlci1zZWN0aW9uJyB9KTtcclxuICAgICAgICAvLyDnlKjmiLfpgInmi6nlkoznrqHnkIbnlYzpnaJcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGNyZWF0ZVRhc2tTZWN0aW9uKCkge1xyXG4gICAgICAgIGNvbnN0IHRhc2tTZWN0aW9uID0gdGhpcy5jb250ZW50RWwuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAndGFzay1ib2FyZC10YXNrLXNlY3Rpb24nIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOa3u+WKoOS7u+WKoeaMiemSrlxyXG4gICAgICAgIGNvbnN0IGFkZEJ1dHRvbiA9IHRhc2tTZWN0aW9uLmNyZWF0ZUVsKCdidXR0b24nLCB7IHRleHQ6ICfmt7vliqDku7vliqEnIH0pO1xyXG4gICAgICAgIGFkZEJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuc2hvd0FkZFRhc2tNb2RhbCgpKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyDku7vliqHliJfooahcclxuICAgICAgICBjb25zdCB0YXNrTGlzdCA9IHRhc2tTZWN0aW9uLmNyZWF0ZUVsKCdkaXYnLCB7IGNsczogJ3Rhc2stbGlzdCcgfSk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJUYXNrcyh0YXNrTGlzdCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSByZW5kZXJUYXNrcyhjb250YWluZXI6IEhUTUxFbGVtZW50KSB7XHJcbiAgICAgICAgY29udGFpbmVyLmVtcHR5KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5kYXRhLnRhc2tzLmZvckVhY2godGFzayA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHRhc2tFbCA9IGNvbnRhaW5lci5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICd0YXNrLWl0ZW0nIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g5Lu75Yqh5a6M5oiQ54q25oCBXHJcbiAgICAgICAgICAgIGNvbnN0IGNoZWNrYm94ID0gdGFza0VsLmNyZWF0ZUVsKCdpbnB1dCcsIHsgdHlwZTogJ2NoZWNrYm94JyB9KTtcclxuICAgICAgICAgICAgY2hlY2tib3guY2hlY2tlZCA9IHRhc2suY29tcGxldGVkO1xyXG4gICAgICAgICAgICBjaGVja2JveC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoKSA9PiB0aGlzLnRvZ2dsZVRhc2sodGFzay5pZCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g5Lu75Yqh5L+h5oGv5a655ZmoXHJcbiAgICAgICAgICAgIGNvbnN0IGluZm9Db250YWluZXIgPSB0YXNrRWwuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAndGFzay1pbmZvJyB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIOS7u+WKoeagh+mimOWSjOenr+WIhlxyXG4gICAgICAgICAgICBpbmZvQ29udGFpbmVyLmNyZWF0ZUVsKCdzcGFuJywgeyBcclxuICAgICAgICAgICAgICAgIHRleHQ6IGAke3Rhc2sudGl0bGV9ICgke3Rhc2sucG9pbnRzfeWIhilgLFxyXG4gICAgICAgICAgICAgICAgY2xzOiB0YXNrLmNvbXBsZXRlZCA/ICdjb21wbGV0ZWQnIDogJydcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyDorqHml7bkv6Hmga9cclxuICAgICAgICAgICAgY29uc3QgdGltZXJDb250YWluZXIgPSBpbmZvQ29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IGNsczogJ3RpbWVyLWNvbnRhaW5lcicgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVEaXNwbGF5ID0gdGltZXJDb250YWluZXIuY3JlYXRlRWwoJ3NwYW4nLCB7XHJcbiAgICAgICAgICAgICAgICB0ZXh0OiB0aGlzLmZvcm1hdFRpbWUodGFzay50aW1lU3BlbnQpLFxyXG4gICAgICAgICAgICAgICAgY2xzOiAndGltZS1kaXNwbGF5J1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIOiuoeaXtuaMiemSrue7hFxyXG4gICAgICAgICAgICBjb25zdCBidG5Db250YWluZXIgPSB0aW1lckNvbnRhaW5lci5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICd0aW1lci1idG4tZ3JvdXAnIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g5byA5aeLL+aaguWBnOaMiemSrlxyXG4gICAgICAgICAgICBjb25zdCB0aW1lckJ0biA9IGJ0bkNvbnRhaW5lci5jcmVhdGVFbCgnYnV0dG9uJywge1xyXG4gICAgICAgICAgICAgICAgdGV4dDogdGFzay5pc1RpbWVyUnVubmluZyA/ICfmmoLlgZwnIDogJ+W8gOWniycsXHJcbiAgICAgICAgICAgICAgICBjbHM6IGB0aW1lci1idG4gJHt0YXNrLmlzVGltZXJSdW5uaW5nID8gJ3J1bm5pbmcnIDogJyd9YFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgdGltZXJCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLnRvZ2dsZVRpbWVyKHRhc2suaWQsIHRpbWVEaXNwbGF5KSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyDmuIXnqbrorqHml7bmjInpkq5cclxuICAgICAgICAgICAgY29uc3QgcmVzZXRCdG4gPSBidG5Db250YWluZXIuY3JlYXRlRWwoJ2J1dHRvbicsIHtcclxuICAgICAgICAgICAgICAgIHRleHQ6ICfmuIXpm7YnLFxyXG4gICAgICAgICAgICAgICAgY2xzOiAndGltZXItYnRuIHJlc2V0J1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgcmVzZXRCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLnJlc2V0VGltZXIodGFzay5pZCkpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g5Yig6Zmk5Lu75Yqh5oyJ6ZKuXHJcbiAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGJ0bkNvbnRhaW5lci5jcmVhdGVFbCgnYnV0dG9uJywge1xyXG4gICAgICAgICAgICAgICAgdGV4dDogJ+WIoOmZpCcsXHJcbiAgICAgICAgICAgICAgICBjbHM6ICd0aW1lci1idG4gZGVsZXRlJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgZGVsZXRlQnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4gdGhpcy5kZWxldGVUYXNrKHRhc2suaWQpKTtcclxuICAgICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGZvcm1hdFRpbWUoc2Vjb25kczogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgICAgICAvLyDmt7vliqDlronlhajmo4Dmn6VcclxuICAgICAgICBpZiAoIXNlY29uZHMgfHwgaXNOYU4oc2Vjb25kcykpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFwiMDA6MDA6MDBcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc3QgaG91cnMgPSBNYXRoLmZsb29yKHNlY29uZHMgLyAzNjAwKTtcclxuICAgICAgICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcigoc2Vjb25kcyAlIDM2MDApIC8gNjApO1xyXG4gICAgICAgIGNvbnN0IHNlY3MgPSBzZWNvbmRzICUgNjA7XHJcbiAgICAgICAgcmV0dXJuIGAke2hvdXJzLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKX06JHttaW51dGVzLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKX06JHtzZWNzLnRvU3RyaW5nKCkucGFkU3RhcnQoMiwgJzAnKX1gO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgdXBkYXRlVGltZURpc3BsYXkodGFzazogVGFzaywgZGlzcGxheUVsOiBIVE1MRWxlbWVudCkge1xyXG4gICAgICAgIGlmICghdGFzay5pc1RpbWVyUnVubmluZykgcmV0dXJuO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XHJcbiAgICAgICAgY29uc3QgdG90YWxTZWNvbmRzID0gdGFzay50aW1lU3BlbnQgKyBNYXRoLmZsb29yKChub3cgLSAodGFzay50aW1lclN0YXJ0VGltZSB8fCBub3cpKSAvIDEwMDApO1xyXG4gICAgICAgIGRpc3BsYXlFbC50ZXh0Q29udGVudCA9IHRoaXMuZm9ybWF0VGltZSh0b3RhbFNlY29uZHMpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgdG9nZ2xlVGltZXIodGFza0lkOiBzdHJpbmcsIGRpc3BsYXlFbDogSFRNTEVsZW1lbnQpIHtcclxuICAgICAgICBjb25zdCB0YXNrID0gdGhpcy5kYXRhLnRhc2tzLmZpbmQodCA9PiB0LmlkID09PSB0YXNrSWQpO1xyXG4gICAgICAgIGlmICghdGFzaykgcmV0dXJuO1xyXG5cclxuICAgICAgICBpZiAodHlwZW9mIHRhc2sudGltZVNwZW50ICE9PSAnbnVtYmVyJykge1xyXG4gICAgICAgICAgICB0YXNrLnRpbWVTcGVudCA9IDA7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoIXRhc2suaXNUaW1lclJ1bm5pbmcpIHtcclxuICAgICAgICAgICAgLy8g5aaC5p6c5piv6aaW5qyh5ZCv5Yqo6K6h5pe25Zmo77yM6K6w5b2V5byA5aeL5pe26Ze0XHJcbiAgICAgICAgICAgIGlmICghdGFzay5zdGFydGVkQXQpIHtcclxuICAgICAgICAgICAgICAgIHRhc2suc3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAvLyDlvIDlp4vorqHml7ZcclxuICAgICAgICAgICAgdGFzay5pc1RpbWVyUnVubmluZyA9IHRydWU7XHJcbiAgICAgICAgICAgIHRhc2sudGltZXJTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g6K6+572u5a6e5pe25pu05pawXHJcbiAgICAgICAgICAgIHRoaXMuZGF0YS50aW1lcnNbdGFza0lkXSA9IHdpbmRvdy5zZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVRpbWVEaXNwbGF5KHRhc2ssIGRpc3BsYXlFbCk7XHJcbiAgICAgICAgICAgIH0sIDEwMDApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g5pu05paw5oyJ6ZKu54q25oCBXHJcbiAgICAgICAgICAgIGNvbnN0IGJ1dHRvbiA9IGRpc3BsYXlFbC5wYXJlbnRFbGVtZW50Py5xdWVyeVNlbGVjdG9yKCcudGltZXItYnRuJykgYXMgSFRNTEVsZW1lbnQ7XHJcbiAgICAgICAgICAgIGlmIChidXR0b24pIHtcclxuICAgICAgICAgICAgICAgIGJ1dHRvbi50ZXh0Q29udGVudCA9ICfmmoLlgZwnO1xyXG4gICAgICAgICAgICAgICAgYnV0dG9uLmNsYXNzTGlzdC5hZGQoJ3J1bm5pbmcnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIC8vIOWBnOatouiuoeaXtlxyXG4gICAgICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICBjb25zdCBlbGFwc2VkID0gTWF0aC5mbG9vcigobm93IC0gKHRhc2sudGltZXJTdGFydFRpbWUgfHwgbm93KSkgLyAxMDAwKTtcclxuICAgICAgICAgICAgdGFzay50aW1lU3BlbnQgKz0gZWxhcHNlZDtcclxuICAgICAgICAgICAgdGFzay5pc1RpbWVyUnVubmluZyA9IGZhbHNlO1xyXG4gICAgICAgICAgICBkZWxldGUgdGFzay50aW1lclN0YXJ0VGltZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIOa4hemZpOabtOaWsOmXtOmalFxyXG4gICAgICAgICAgICBpZiAodGhpcy5kYXRhLnRpbWVyc1t0YXNrSWRdKSB7XHJcbiAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuZGF0YS50aW1lcnNbdGFza0lkXSk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5kYXRhLnRpbWVyc1t0YXNrSWRdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyDmm7TmlrDmjInpkq7nirbmgIFcclxuICAgICAgICAgICAgY29uc3QgYnV0dG9uID0gZGlzcGxheUVsLnBhcmVudEVsZW1lbnQ/LnF1ZXJ5U2VsZWN0b3IoJy50aW1lci1idG4nKSBhcyBIVE1MRWxlbWVudDtcclxuICAgICAgICAgICAgaWYgKGJ1dHRvbikge1xyXG4gICAgICAgICAgICAgICAgYnV0dG9uLnRleHRDb250ZW50ID0gJ+W8gOWniyc7XHJcbiAgICAgICAgICAgICAgICBidXR0b24uY2xhc3NMaXN0LnJlbW92ZSgncnVubmluZycpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKCk7XHJcbiAgICAgICAgLy8g5LiN5YaN6YeN5paw5riy5p+T5pW05Liq5YiX6KGoXHJcbiAgICAgICAgZGlzcGxheUVsLnRleHRDb250ZW50ID0gdGhpcy5mb3JtYXRUaW1lKHRhc2sudGltZVNwZW50KTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGNyZWF0ZVN0YXRzU2VjdGlvbigpIHtcclxuICAgICAgICAvLyDlhYjnp7vpmaTnjrDmnInnmoTnu5/orqHljLrln59cclxuICAgICAgICBjb25zdCBleGlzdGluZ1N0YXRzID0gdGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcignLnRhc2stYm9hcmQtc3RhdHMtc2VjdGlvbicpO1xyXG4gICAgICAgIGlmIChleGlzdGluZ1N0YXRzKSB7XHJcbiAgICAgICAgICAgIGV4aXN0aW5nU3RhdHMucmVtb3ZlKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBzdGF0c1NlY3Rpb24gPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICd0YXNrLWJvYXJkLXN0YXRzLXNlY3Rpb24nIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOagh+mimOWSjOaMiemSruWuueWZqFxyXG4gICAgICAgIGNvbnN0IGhlYWRlckNvbnRhaW5lciA9IHN0YXRzU2VjdGlvbi5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICdzdGF0cy1oZWFkZXInIH0pO1xyXG4gICAgICAgIGhlYWRlckNvbnRhaW5lci5jcmVhdGVFbCgnaDMnLCB7IHRleHQ6ICfku7vliqHlrozmiJDorrDlvZUnIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOaMiemSruWuueWZqFxyXG4gICAgICAgIGNvbnN0IGJ0bkNvbnRhaW5lciA9IGhlYWRlckNvbnRhaW5lci5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICdzdGF0cy1oZWFkZXItYnV0dG9ucycgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8g5LuK5pel5oC757uT5oyJ6ZKuXHJcbiAgICAgICAgY29uc3Qgc3VtbWFyeUJ0biA9IGJ0bkNvbnRhaW5lci5jcmVhdGVFbCgnYnV0dG9uJywge1xyXG4gICAgICAgICAgICB0ZXh0OiAn5LuK5pel5oC757uTJyxcclxuICAgICAgICAgICAgY2xzOiAnc3VtbWFyeS1idG4nXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgc3VtbWFyeUJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuY3JlYXRlRGFpbHlTdW1tYXJ5KCkpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIOa4heepuuiusOW9leaMiemSrlxyXG4gICAgICAgIGNvbnN0IGNsZWFyQWxsQnRuID0gYnRuQ29udGFpbmVyLmNyZWF0ZUVsKCdidXR0b24nLCB7XHJcbiAgICAgICAgICAgIHRleHQ6ICfmuIXnqbrorrDlvZUnLFxyXG4gICAgICAgICAgICBjbHM6ICdjbGVhci1yZWNvcmRzLWJ0bidcclxuICAgICAgICB9KTtcclxuICAgICAgICBjbGVhckFsbEJ0bi5hZGRFdmVudExpc3RlbmVyKCdjbGljaycsICgpID0+IHRoaXMuY2xlYXJDb21wbGV0ZWRUYXNrcygpKTtcclxuXHJcbiAgICAgICAgLy8g6I635Y+W5bey5a6M5oiQ55qE5Lu75Yqh5bm25oyJ5a6M5oiQ5pe26Ze05o6S5bqPXHJcbiAgICAgICAgY29uc3QgY29tcGxldGVkVGFza3MgPSB0aGlzLmRhdGEudGFza3NcclxuICAgICAgICAgICAgLmZpbHRlcih0ID0+IHQuY29tcGxldGVkKVxyXG4gICAgICAgICAgICAuc29ydCgoYSwgYikgPT4gKGIuY29tcGxldGVkQXQgfHwgMCkgLSAoYS5jb21wbGV0ZWRBdCB8fCAwKSk7XHJcblxyXG4gICAgICAgIGlmIChjb21wbGV0ZWRUYXNrcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgc3RhdHNTZWN0aW9uLmNyZWF0ZUVsKCdkaXYnLCB7IFxyXG4gICAgICAgICAgICAgICAgdGV4dDogJ+aaguaXoOW3suWujOaIkOS7u+WKoScsXHJcbiAgICAgICAgICAgICAgICBjbHM6ICduby10YXNrcydcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIOWIm+W7uuS7u+WKoeiusOW9leWIl+ihqFxyXG4gICAgICAgIGNvbnN0IHJlY29yZExpc3QgPSBzdGF0c1NlY3Rpb24uY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAndGFzay1yZWNvcmQtbGlzdCcgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29tcGxldGVkVGFza3MuZm9yRWFjaCh0YXNrID0+IHtcclxuICAgICAgICAgICAgY29uc3QgcmVjb3JkSXRlbSA9IHJlY29yZExpc3QuY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAndGFzay1yZWNvcmQtaXRlbScgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyDorrDlvZXlhoXlrrnlrrnlmahcclxuICAgICAgICAgICAgY29uc3QgY29udGVudENvbnRhaW5lciA9IHJlY29yZEl0ZW0uY3JlYXRlRWwoJ2RpdicsIHsgY2xzOiAncmVjb3JkLWNvbnRlbnQnIH0pO1xyXG4gICAgICAgICAgICBjb250ZW50Q29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IFxyXG4gICAgICAgICAgICAgICAgdGV4dDogYPCfk50gJHt0YXNrLnRpdGxlfSAoJHt0YXNrLnBvaW50c33liIYpYCxcclxuICAgICAgICAgICAgICAgIGNsczogJ3Rhc2stcmVjb3JkLXRpdGxlJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgY29udGVudENvbnRhaW5lci5jcmVhdGVFbCgnZGl2JywgeyBcclxuICAgICAgICAgICAgICAgIHRleHQ6IGDij7Ag5byA5aeL77yaJHt0aGlzLmZvcm1hdERhdGUodGFzay5zdGFydGVkQXQgfHwgdGFzay50aW1lclN0YXJ0VGltZSl9YCxcclxuICAgICAgICAgICAgICAgIGNsczogJ3Rhc2stcmVjb3JkLXRpbWUnXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBjb250ZW50Q29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IFxyXG4gICAgICAgICAgICAgICAgdGV4dDogYPCfj4Eg5a6M5oiQ77yaJHt0aGlzLmZvcm1hdERhdGUodGFzay5jb21wbGV0ZWRBdCl9YCxcclxuICAgICAgICAgICAgICAgIGNsczogJ3Rhc2stcmVjb3JkLXRpbWUnXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBjb250ZW50Q29udGFpbmVyLmNyZWF0ZUVsKCdkaXYnLCB7IFxyXG4gICAgICAgICAgICAgICAgdGV4dDogYOKMmyDnlKjml7bvvJoke3RoaXMuZm9ybWF0VGltZSh0YXNrLnRpbWVTcGVudCl9YCxcclxuICAgICAgICAgICAgICAgIGNsczogJ3Rhc2stcmVjb3JkLXRpbWUnXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8g5Yig6Zmk5oyJ6ZKuXHJcbiAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IHJlY29yZEl0ZW0uY3JlYXRlRWwoJ2J1dHRvbicsIHtcclxuICAgICAgICAgICAgICAgIHRleHQ6ICfliKDpmaQnLFxyXG4gICAgICAgICAgICAgICAgY2xzOiAncmVjb3JkLWRlbGV0ZS1idG4nXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBkZWxldGVCdG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0aGlzLmRlbGV0ZUNvbXBsZXRlZFRhc2sodGFzay5pZCkpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgY2xlYXJDb21wbGV0ZWRUYXNrcygpIHtcclxuICAgICAgICAvLyDlgZzmraLmiYDmnInlt7LlrozmiJDku7vliqHnmoTorqHml7blmahcclxuICAgICAgICB0aGlzLmRhdGEudGFza3MuZm9yRWFjaCh0YXNrID0+IHtcclxuICAgICAgICAgICAgaWYgKHRhc2suY29tcGxldGVkICYmIHRhc2suaXNUaW1lclJ1bm5pbmcgJiYgdGhpcy5kYXRhLnRpbWVyc1t0YXNrLmlkXSkge1xyXG4gICAgICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmRhdGEudGltZXJzW3Rhc2suaWRdKTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmRhdGEudGltZXJzW3Rhc2suaWRdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8g5Y+q5Yig6Zmk5bey5a6M5oiQ5Lu75Yqh55qE6K6w5b2V77yM5L+d55WZ5pyq5a6M5oiQ55qE5Lu75YqhXHJcbiAgICAgICAgdGhpcy5kYXRhLnRhc2tzID0gdGhpcy5kYXRhLnRhc2tzLmZpbHRlcih0ID0+ICF0LmNvbXBsZXRlZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlRGF0YSgpO1xyXG4gICAgICAgIHRoaXMuY3JlYXRlU3RhdHNTZWN0aW9uKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBkZWxldGVDb21wbGV0ZWRUYXNrKHRhc2tJZDogc3RyaW5nKSB7XHJcbiAgICAgICAgY29uc3QgdGFzayA9IHRoaXMuZGF0YS50YXNrcy5maW5kKHQgPT4gdC5pZCA9PT0gdGFza0lkKTtcclxuICAgICAgICBpZiAodGFzaykge1xyXG4gICAgICAgICAgICAvLyDlpoLmnpzku7vliqHmraPlnKjorqHml7bvvIzlhYjlgZzmraLorqHml7blmahcclxuICAgICAgICAgICAgaWYgKHRhc2suaXNUaW1lclJ1bm5pbmcgJiYgdGhpcy5kYXRhLnRpbWVyc1t0YXNrSWRdKSB7XHJcbiAgICAgICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMuZGF0YS50aW1lcnNbdGFza0lkXSk7XHJcbiAgICAgICAgICAgICAgICBkZWxldGUgdGhpcy5kYXRhLnRpbWVyc1t0YXNrSWRdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyDku47mlbDnu4TkuK3np7vpmaTku7vliqFcclxuICAgICAgICAgICAgdGhpcy5kYXRhLnRhc2tzID0gdGhpcy5kYXRhLnRhc2tzLmZpbHRlcih0ID0+IHQuaWQgIT09IHRhc2tJZCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyDlj6rmm7TmlrDlrozmiJDorrDlvZXljLrln5/vvIzkuI3ph43mlrDmuLLmn5Pku7vliqHliJfooahcclxuICAgICAgICAgICAgdGhpcy5jcmVhdGVTdGF0c1NlY3Rpb24oKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBjcmVhdGVSZXdhcmRTZWN0aW9uKCkge1xyXG4gICAgICAgIGNvbnN0IHJld2FyZFNlY3Rpb24gPSB0aGlzLmNvbnRlbnRFbC5jcmVhdGVFbCgnZGl2JywgeyBjbHM6ICd0YXNrLWJvYXJkLXJld2FyZC1zZWN0aW9uJyB9KTtcclxuICAgICAgICAvLyDlpZblirHliJfooajlkozlhZHmjaLnlYzpnaJcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBvbkNsb3NlKCkge1xyXG4gICAgICAgIC8vIOa4heeQhuaJgOacieiuoeaXtuWZqFxyXG4gICAgICAgIE9iamVjdC52YWx1ZXModGhpcy5kYXRhLnRpbWVycykuZm9yRWFjaCh0aW1lcklkID0+IHtcclxuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aW1lcklkKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICB0aGlzLmRhdGEudGltZXJzID0ge307XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8g5L+d5a2Y5pWw5o2uXHJcbiAgICAgICAgYXdhaXQgdGhpcy5zYXZlRGF0YSgpO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGxvYWREYXRhKCkge1xyXG4gICAgICAgIGNvbnN0IHNhdmVkRGF0YSA9IGF3YWl0IHRoaXMubG9hZExvY2FsRGF0YSgpO1xyXG4gICAgICAgIGlmIChzYXZlZERhdGEpIHtcclxuICAgICAgICAgICAgdGhpcy5kYXRhID0geyAuLi50aGlzLmRhdGEsIC4uLnNhdmVkRGF0YSB9O1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBzYXZlRGF0YSgpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLnNhdmVMb2NhbERhdGEodGhpcy5kYXRhKTtcclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGFzeW5jIGxvYWRMb2NhbERhdGEoKTogUHJvbWlzZTxUYXNrQm9hcmREYXRhIHwgbnVsbD4ge1xyXG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoYCR7dGhpcy5hcHAudmF1bHQuY29uZmlnRGlyfS90YXNrLWJvYXJkLmpzb25gKTtcclxuICAgICAgICByZXR1cm4gZGF0YSA/IEpTT04ucGFyc2UoZGF0YSkgOiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgc2F2ZUxvY2FsRGF0YShkYXRhOiBUYXNrQm9hcmREYXRhKSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZShcclxuICAgICAgICAgICAgYCR7dGhpcy5hcHAudmF1bHQuY29uZmlnRGlyfS90YXNrLWJvYXJkLmpzb25gLFxyXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeShkYXRhKVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBzaG93QWRkVGFza01vZGFsKCkge1xyXG4gICAgICAgIGNvbnN0IG1vZGFsID0gbmV3IFRhc2tNb2RhbCh0aGlzLmFwcCwgYXN5bmMgKHJlc3VsdCkgPT4ge1xyXG4gICAgICAgICAgICBpZiAocmVzdWx0KSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmRhdGEudGFza3MucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgaWQ6IERhdGUubm93KCkudG9TdHJpbmcoKSxcclxuICAgICAgICAgICAgICAgICAgICB0aXRsZTogcmVzdWx0LnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgICAgIHBvaW50czogcmVzdWx0LnBvaW50cyxcclxuICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgICAgIHRpbWVTcGVudDogMCxcclxuICAgICAgICAgICAgICAgICAgICBpc1RpbWVyUnVubmluZzogZmFsc2UsXHJcbiAgICAgICAgICAgICAgICAgICAgc3RhcnRlZEF0OiB1bmRlZmluZWQgIC8vIOWIneWni+WMluS4uiB1bmRlZmluZWRcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zYXZlRGF0YSgpO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgdGFza0xpc3QgPSB0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yKCcudGFzay1saXN0JykgYXMgSFRNTEVsZW1lbnQ7XHJcbiAgICAgICAgICAgICAgICBpZiAodGFza0xpc3QpIHtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlbmRlclRhc2tzKHRhc2tMaXN0KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRoaXMuY3JlYXRlU3RhdHNTZWN0aW9uKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBtb2RhbC5vcGVuKCk7XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyB0b2dnbGVUYXNrKHRhc2tJZDogc3RyaW5nKSB7XHJcbiAgICAgICAgY29uc3QgdGFzayA9IHRoaXMuZGF0YS50YXNrcy5maW5kKHQgPT4gdC5pZCA9PT0gdGFza0lkKTtcclxuICAgICAgICBpZiAodGFzaykge1xyXG4gICAgICAgICAgICB0YXNrLmNvbXBsZXRlZCA9ICF0YXNrLmNvbXBsZXRlZDtcclxuICAgICAgICAgICAgaWYgKHRhc2suY29tcGxldGVkKSB7XHJcbiAgICAgICAgICAgICAgICAvLyDlrozmiJDku7vliqHml7bnmoTlpITnkIZcclxuICAgICAgICAgICAgICAgIHRhc2suY29tcGxldGVkQnkgPSB0aGlzLmRhdGEuY3VycmVudFVzZXJJZDtcclxuICAgICAgICAgICAgICAgIHRhc2suY29tcGxldGVkQXQgPSBEYXRlLm5vdygpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyDlpoLmnpzku7vliqHmraPlnKjorqHml7bvvIzlgZzmraLorqHml7ZcclxuICAgICAgICAgICAgICAgIGlmICh0YXNrLmlzVGltZXJSdW5uaW5nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBlbGFwc2VkID0gTWF0aC5mbG9vcigobm93IC0gKHRhc2sudGltZXJTdGFydFRpbWUgfHwgbm93KSkgLyAxMDAwKTtcclxuICAgICAgICAgICAgICAgICAgICB0YXNrLnRpbWVTcGVudCArPSBlbGFwc2VkO1xyXG4gICAgICAgICAgICAgICAgICAgIHRhc2suaXNUaW1lclJ1bm5pbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyDmuIXpmaTorqHml7blmahcclxuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5kYXRhLnRpbWVyc1t0YXNrSWRdKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5kYXRhLnRpbWVyc1t0YXNrSWRdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS50aW1lcnNbdGFza0lkXTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAvLyDlj5bmtojlrozmiJDml7bnmoTlpITnkIZcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0YXNrLmNvbXBsZXRlZEJ5O1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRhc2suY29tcGxldGVkQXQ7XHJcbiAgICAgICAgICAgICAgICAvLyDph43nva7orqHml7bnm7jlhbPmlbDmja7vvIzlhYHorrjph43mlrDlvIDlp4tcclxuICAgICAgICAgICAgICAgIHRhc2sudGltZVNwZW50ID0gMDtcclxuICAgICAgICAgICAgICAgIHRhc2suaXNUaW1lclJ1bm5pbmcgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgIGRlbGV0ZSB0YXNrLnRpbWVyU3RhcnRUaW1lO1xyXG4gICAgICAgICAgICAgICAgZGVsZXRlIHRhc2suc3RhcnRlZEF0OyAgLy8g5riF6Zmk5byA5aeL5pe26Ze077yM5YWB6K646K6w5b2V5paw55qE5byA5aeL5pe26Ze0XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIOabtOaWsOeVjOmdolxyXG4gICAgICAgICAgICB0aGlzLnJlbmRlclRhc2tzKHRoaXMuY29udGVudEVsLnF1ZXJ5U2VsZWN0b3IoJy50YXNrLWxpc3QnKSBhcyBIVE1MRWxlbWVudCk7XHJcbiAgICAgICAgICAgIHRoaXMuY3JlYXRlU3RhdHNTZWN0aW9uKCk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgcmVzZXRUaW1lcih0YXNrSWQ6IHN0cmluZykge1xyXG4gICAgICAgIGNvbnN0IHRhc2sgPSB0aGlzLmRhdGEudGFza3MuZmluZCh0ID0+IHQuaWQgPT09IHRhc2tJZCk7XHJcbiAgICAgICAgaWYgKHRhc2spIHtcclxuICAgICAgICAgICAgdGFzay50aW1lU3BlbnQgPSAwO1xyXG4gICAgICAgICAgICB0YXNrLmlzVGltZXJSdW5uaW5nID0gZmFsc2U7XHJcbiAgICAgICAgICAgIGRlbGV0ZSB0YXNrLnRpbWVyU3RhcnRUaW1lO1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKCk7XHJcbiAgICAgICAgICAgIHRoaXMucmVuZGVyVGFza3ModGhpcy5jb250ZW50RWwucXVlcnlTZWxlY3RvcignLnRhc2stbGlzdCcpIGFzIEhUTUxFbGVtZW50KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcHJpdmF0ZSBhc3luYyBkZWxldGVUYXNrKHRhc2tJZDogc3RyaW5nKSB7XHJcbiAgICAgICAgY29uc3QgdGFza0luZGV4ID0gdGhpcy5kYXRhLnRhc2tzLmZpbmRJbmRleCh0ID0+IHQuaWQgPT09IHRhc2tJZCk7XHJcbiAgICAgICAgaWYgKHRhc2tJbmRleCA+IC0xKSB7XHJcbiAgICAgICAgICAgIHRoaXMuZGF0YS50YXNrcy5zcGxpY2UodGFza0luZGV4LCAxKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5zYXZlRGF0YSgpO1xyXG4gICAgICAgICAgICAvLyDmm7TmlrDku7vliqHliJfooajlkozlrozmiJDorrDlvZVcclxuICAgICAgICAgICAgdGhpcy5yZW5kZXJUYXNrcyh0aGlzLmNvbnRlbnRFbC5xdWVyeVNlbGVjdG9yKCcudGFzay1saXN0JykgYXMgSFRNTEVsZW1lbnQpO1xyXG4gICAgICAgICAgICB0aGlzLmNyZWF0ZVN0YXRzU2VjdGlvbigpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBwcml2YXRlIGZvcm1hdERhdGUodGltZXN0YW1wPzogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgICAgICBpZiAoIXRpbWVzdGFtcCkgcmV0dXJuICfmnKrorrDlvZUnO1xyXG4gICAgICAgIGNvbnN0IGRhdGUgPSBuZXcgRGF0ZSh0aW1lc3RhbXApO1xyXG4gICAgICAgIHJldHVybiBgJHtkYXRlLnRvTG9jYWxlRGF0ZVN0cmluZygpfSAke2RhdGUudG9Mb2NhbGVUaW1lU3RyaW5nKCl9YDtcclxuICAgIH1cclxuXHJcbiAgICAvLyDlpITnkIbku7vliqHlrozmiJBcclxuICAgIHByaXZhdGUgYXN5bmMgaGFuZGxlVGFza0NvbXBsZXRpb24odGFza05hbWU6IHN0cmluZykge1xyXG4gICAgICAgIG5ldyBSZWZsZWN0aW9uTW9kYWwodGhpcy5hcHAsIGFzeW5jIChyZWZsZWN0aW9uKSA9PiB7XHJcbiAgICAgICAgICAgIHRoaXMuY29tcGxldGlvbnMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICB0YXNrTmFtZSxcclxuICAgICAgICAgICAgICAgIHJlZmxlY3Rpb24sXHJcbiAgICAgICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCLlt7LorrDlvZXlrozmiJDlv4PlvpfvvIFcIik7XHJcbiAgICAgICAgfSkub3BlbigpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIOWIm+W7uuS7iuaXpeaAu+e7k1xyXG4gICAgcHJpdmF0ZSBhc3luYyBjcmVhdGVEYWlseVN1bW1hcnkoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuY29tcGxldGlvbnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCLku4rlpKnov5jmsqHmnInlrozmiJDku7vkvZXku7vliqHvvIFcIik7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIOiOt+WPluaXpeiusOaWh+S7tlxyXG4gICAgICAgICAgICBjb25zdCBkYWlseU5vdGUgPSBhd2FpdCB0aGlzLmdldERhaWx5Tm90ZSgpO1xyXG4gICAgICAgICAgICBpZiAoIWRhaWx5Tm90ZSkge1xyXG4gICAgICAgICAgICAgICAgbmV3IE5vdGljZShcIuaXoOazleaJvuWIsOaIluWIm+W7uuS7iuWkqeeahOaXpeiusO+8gVwiKTtcclxuICAgICAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8g55Sf5oiQ5bm25re75Yqg5oC757uT5YaF5a65XHJcbiAgICAgICAgICAgIGNvbnN0IHN1bW1hcnlDb250ZW50ID0gdGhpcy5nZW5lcmF0ZVN1bW1hcnlDb250ZW50KCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nQ29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZGFpbHlOb3RlKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGRhaWx5Tm90ZSwgZXhpc3RpbmdDb250ZW50ICsgXCJcXG5cXG5cIiArIHN1bW1hcnlDb250ZW50KTtcclxuXHJcbiAgICAgICAgICAgIG5ldyBOb3RpY2UoXCLku4rml6XmgLvnu5Plt7Lmt7vliqDliLDml6XorrDvvIFcIik7XHJcbiAgICAgICAgICAgIHRoaXMuY29tcGxldGlvbnMgPSBbXTsgLy8g5riF56m65a6M5oiQ6K6w5b2VXHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIuabtOaWsOaXpeiusOWksei0pTpcIiwgZXJyb3IpO1xyXG4gICAgICAgICAgICBuZXcgTm90aWNlKFwi5pu05paw5pel6K6w5aSx6LSl77yBXCIpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyDmlrDlop7vvJrojrflj5bml6XorrDmlofku7bnmoTmlrnms5VcclxuICAgIHByaXZhdGUgYXN5bmMgZ2V0RGFpbHlOb3RlKCk6IFByb21pc2U8VEZpbGUgfCBudWxsPiB7XHJcbiAgICAgICAgLy8g6I635Y+W5pel6K6w5o+S5Lu2XHJcbiAgICAgICAgY29uc3QgZGFpbHlOb3Rlc1BsdWdpbiA9ICh0aGlzLmFwcCBhcyBhbnkpLnBsdWdpbnMuZ2V0UGx1Z2luKCdkYWlseS1ub3RlcycpO1xyXG4gICAgICAgIGlmICghZGFpbHlOb3Rlc1BsdWdpbj8uZW5hYmxlZCkge1xyXG4gICAgICAgICAgICBuZXcgTm90aWNlKFwi6K+35ZCv55So5pel6K6w5o+S5Lu277yBXCIpO1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIOiOt+WPluaXpeiusOiuvue9rlxyXG4gICAgICAgIGNvbnN0IHsgZm9ybWF0LCBmb2xkZXIgfSA9IGRhaWx5Tm90ZXNQbHVnaW4uaW5zdGFuY2Uub3B0aW9ucztcclxuICAgICAgICBjb25zdCBmaWxlbmFtZSA9IG1vbWVudCgpLmZvcm1hdChmb3JtYXQgfHwgJ1lZWVktTU0tREQnKTtcclxuICAgICAgICBjb25zdCBub3JtYWxpemVkUGF0aCA9IGAke2ZvbGRlciA/IGZvbGRlciArICcvJyA6ICcnfSR7ZmlsZW5hbWV9Lm1kYDtcclxuXHJcbiAgICAgICAgLy8g6I635Y+W5oiW5Yib5bu65pel6K6w5paH5Lu2XHJcbiAgICAgICAgbGV0IGRhaWx5Tm90ZSA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChub3JtYWxpemVkUGF0aCk7XHJcbiAgICAgICAgaWYgKCFkYWlseU5vdGUpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIC8vIOWmguaenOaXpeiusOS4jeWtmOWcqO+8jOWIm+W7uuaWsOeahOaXpeiusFxyXG4gICAgICAgICAgICAgICAgY29uc3QgdGVtcGxhdGUgPSBhd2FpdCB0aGlzLmdldFRlbXBsYXRlKCk7XHJcbiAgICAgICAgICAgICAgICBkYWlseU5vdGUgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUoXHJcbiAgICAgICAgICAgICAgICAgICAgbm9ybWFsaXplZFBhdGgsXHJcbiAgICAgICAgICAgICAgICAgICAgdGVtcGxhdGUgfHwgJydcclxuICAgICAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihcIuWIm+W7uuaXpeiusOWksei0pTpcIiwgZXJyKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gZGFpbHlOb3RlIGluc3RhbmNlb2YgVEZpbGUgPyBkYWlseU5vdGUgOiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgZ2VuZXJhdGVTdW1tYXJ5Q29udGVudCgpOiBzdHJpbmcge1xyXG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICAgICAgbGV0IGNvbnRlbnQgPSBgIyMg5LuK5pel5Lu75Yqh5oC757uTICgke25vdy50b0xvY2FsZVRpbWVTdHJpbmcoKX0pXFxuXFxuYDtcclxuXHJcbiAgICAgICAgdGhpcy5jb21wbGV0aW9ucy5mb3JFYWNoKCh7IHRhc2tOYW1lLCByZWZsZWN0aW9uLCB0aW1lc3RhbXAgfSkgPT4ge1xyXG4gICAgICAgICAgICBjb25zdCB0aW1lID0gbmV3IERhdGUodGltZXN0YW1wKS50b0xvY2FsZVRpbWVTdHJpbmcoKTtcclxuICAgICAgICAgICAgY29udGVudCArPSBgIyMjICR7dGFza05hbWV9ICgke3RpbWV9KVxcbmA7XHJcbiAgICAgICAgICAgIGNvbnRlbnQgKz0gYC0g5a6M5oiQ5b+D5b6X77yaJHtyZWZsZWN0aW9ufVxcblxcbmA7XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgYXN5bmMgZ2V0VGVtcGxhdGUoKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgICAgICAvLyDov5Tlm57kuIDkuKrpu5jorqTnmoTmqKHmnb/lrZfnrKbkuLLvvIzmiJbogIXku47mn5DkuKrkvY3nva7liqDovb3mqKHmnb9cclxuICAgICAgICByZXR1cm4gXCIjIOaXpeiusOaooeadv1xcblxcbuS7iuWkqeeahOS7u+WKoeaAu+e7k++8mlxcblwiO1xyXG4gICAgfVxyXG59XHJcblxyXG5jbGFzcyBUYXNrTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XHJcbiAgICBwcml2YXRlIHRpdGxlOiBzdHJpbmcgPSAnJztcclxuICAgIHByaXZhdGUgcG9pbnRzOiBudW1iZXIgPSAwO1xyXG4gICAgcHJpdmF0ZSBvblN1Ym1pdDogKHJlc3VsdDogeyB0aXRsZTogc3RyaW5nLCBwb2ludHM6IG51bWJlciB9IHwgbnVsbCkgPT4gdm9pZDtcclxuXHJcbiAgICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgb25TdWJtaXQ6IChyZXN1bHQ6IHsgdGl0bGU6IHN0cmluZywgcG9pbnRzOiBudW1iZXIgfSB8IG51bGwpID0+IHZvaWQpIHtcclxuICAgICAgICBzdXBlcihhcHApO1xyXG4gICAgICAgIHRoaXMub25TdWJtaXQgPSBvblN1Ym1pdDtcclxuICAgIH1cclxuXHJcbiAgICBvbk9wZW4oKSB7XHJcbiAgICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICAgICAgY29udGVudEVsLmVtcHR5KCk7XHJcbiAgICAgICAgY29udGVudEVsLmNyZWF0ZUVsKCdoMicsIHsgdGV4dDogJ+a3u+WKoOaWsOS7u+WKoScgfSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcclxuICAgICAgICAgICAgLnNldE5hbWUoJ+S7u+WKoeWQjeensCcpXHJcbiAgICAgICAgICAgIC5hZGRUZXh0KHRleHQgPT4gdGV4dFxyXG4gICAgICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMudGl0bGUpXHJcbiAgICAgICAgICAgICAgICAub25DaGFuZ2UodmFsdWUgPT4gdGhpcy50aXRsZSA9IHZhbHVlKSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcclxuICAgICAgICAgICAgLnNldE5hbWUoJ+enr+WIhicpXHJcbiAgICAgICAgICAgIC5hZGRUZXh0KHRleHQgPT4gdGV4dFxyXG4gICAgICAgICAgICAgICAgLnNldFZhbHVlKHRoaXMucG9pbnRzLnRvU3RyaW5nKCkpXHJcbiAgICAgICAgICAgICAgICAub25DaGFuZ2UodmFsdWUgPT4gdGhpcy5wb2ludHMgPSBOdW1iZXIodmFsdWUpKSk7XHJcblxyXG4gICAgICAgIG5ldyBTZXR0aW5nKGNvbnRlbnRFbClcclxuICAgICAgICAgICAgLmFkZEJ1dHRvbihidG4gPT4gYnRuXHJcbiAgICAgICAgICAgICAgICAuc2V0QnV0dG9uVGV4dCgn5L+d5a2YJylcclxuICAgICAgICAgICAgICAgIC5zZXRDdGEoKVxyXG4gICAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMub25TdWJtaXQoe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogdGhpcy50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcG9pbnRzOiB0aGlzLnBvaW50c1xyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY2xvc2UoKTtcclxuICAgICAgICAgICAgICAgIH0pKVxyXG4gICAgICAgICAgICAuYWRkQnV0dG9uKGJ0biA9PiBidG5cclxuICAgICAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KCflj5bmtognKVxyXG4gICAgICAgICAgICAgICAgLm9uQ2xpY2soKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMub25TdWJtaXQobnVsbCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgfSkpO1xyXG4gICAgfVxyXG5cclxuICAgIG9uQ2xvc2UoKSB7XHJcbiAgICAgICAgY29uc3QgeyBjb250ZW50RWwgfSA9IHRoaXM7XHJcbiAgICAgICAgY29udGVudEVsLmVtcHR5KCk7XHJcbiAgICB9XHJcbn1cclxuIl19