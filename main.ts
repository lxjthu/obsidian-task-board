import { Plugin } from 'obsidian';
import { Chart } from 'chart.js/auto';
import { TaskBoardView, VIEW_TYPE_TASK_BOARD } from './src/taskBoard';
export default class TaskBoardPlugin extends Plugin {
    async onload() {
        // 确保视图类型匹配
        this.registerView(
            VIEW_TYPE_TASK_BOARD,
            (leaf) => new TaskBoardView(leaf)
        );

        // 添加功能区图标
        this.addRibbonIcon('check-square', '任务看板', () => {
            this.activateView();
        });

        // 添加命令
        this.addCommand({
            id: 'open-task-kanban',
            name: '打开任务看板',
            callback: () => {
                this.activateView();
            }
        });

        // 确保daily文件夹存在
        this.app.vault.adapter.exists('daily').then(exists => {
            if (!exists) {
                this.app.vault.createFolder('daily');
            }
        });

        // 添加图表渲染函数到全局
        (window as any).renderChart = (chartData: any, container: HTMLElement) => {
            const canvas = container.createEl('canvas');
            new Chart(canvas, chartData);
        };
    }

    async onunload() {
        // 关闭所有任务面板实例
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_BOARD);
    }

    async activateView() {
        // 如果视图已经打开，激活它
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_BOARD);
        if (existing.length) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }

        // 否则创建新视图
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({
                type: VIEW_TYPE_TASK_BOARD,
                active: true,
            });
        }
    }
}
