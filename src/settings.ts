import * as vscode from "vscode";

const configuration = vscode.workspace.getConfiguration();

export function translationsFolder(): string {
  return (
    configuration.get("ng-translate-intellisense.translationsFolder") ?? "i18n"
  );
}
export const FILE_EXTENSION = "json";
