import * as vscode from "vscode";
import * as constants from "./constants";

let output: vscode.OutputChannel;

export function initOutput() {
  output = vscode.window.createOutputChannel(constants.PACKAGE_NAME);
}

export function write(message: string) {
  output.appendLine(message);
}

export function getTranslationTemplate(
  key: string,
  languageId?: string
): string {
  if (languageId === "html") {
    return `{{ '${key}' | translate }}`;
  } else {
    return `'${key}'`;
  }
}

export function toSnakeCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/{/g, "")
    .replace(/}/g, "")
    .replace(/\s\s+/g, " ")
    .replace(/[ \t]/g, "_")
    .replace(/^\`+|\`+$/g, "")
    .replace(/^\"+|\"+$/g, "")
    .replace(/^\'+|\'+$/g, "")
    .trim();
}
