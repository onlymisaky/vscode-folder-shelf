import * as vscode from 'vscode';
import { registerTreeViews } from './treeViews';
import { registerCommands } from './commands';
import { registerServices } from './services';

export function activate(context: vscode.ExtensionContext): void {
  const services = registerServices(context);
  const { disposables: treeViewDisposables, foldersView } = registerTreeViews();
  const commands = registerCommands({ foldersView });

  context.subscriptions.push(
    ...services,
    ...commands,
    ...treeViewDisposables,
  );
}

export function deactivate(): void { }
