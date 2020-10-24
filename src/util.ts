import * as constants from "./constants";

let output: vscode.OutputChannel;

export function initOutput() {
  output = vscode.window.createOutputChannel(constants.PACKAGE_NAME);
}

export function write(message: string) {
  output.appendLine(message);
}

export function getTranslationTemplate(key: string): string {
  return `{{ '${key}' | translate }}`;
}

export function toSnakeCase(value: string): string {
  return value.replace("  ", " ").replace(" ", "_").toLowerCase().trim();
}
