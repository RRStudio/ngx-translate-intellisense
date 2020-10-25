import * as vscode from "vscode";

const configuration = vscode.workspace.getConfiguration();

export function translationsFolder(): string | undefined {
  return configuration.get("ng-translate-intellisense.translationsFolder");
}
export const FILE_EXTENSION = "json";
