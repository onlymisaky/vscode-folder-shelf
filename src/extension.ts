import * as vscode from 'vscode';
import { registerTreeViews } from './treeViews';
import { registerCommands } from './commands';
import { registerServices } from './services';
import { registerConfigGuide } from './utils/configGuide';

/**
 * 扩展激活入口：注册服务（组合根）→ 注册树视图 → 注册命令，
 * 并把全部可释放对象统一挂到 context.subscriptions，随扩展停用一并释放。
 *
 * @param context - VSCode 注入的扩展上下文
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const services = await registerServices(context);
  const { disposables: treeViewDisposables, foldersView } = registerTreeViews();
  const commands = registerCommands({ foldersView });

  context.subscriptions.push(
    ...services,
    ...commands,
    ...treeViewDisposables,
    registerConfigGuide(context.extensionUri),
  );
}

/**
 * 扩展停用回调：本扩展无手动清理项，全部资源经 context.subscriptions 自动释放。
 */
export function deactivate(): void { }
