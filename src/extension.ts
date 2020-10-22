import { existsSync, promises, readdir, readFile, readFileSync } from "fs";
import * as path from "path";
import * as vscode from "vscode";

// TODO: suggest translations from arbitrary array
// TODO: suggest translations from json file
// TODO: translated string highlighting
// TODO: translated string show translations on hover
// TODO: automatic create translation of selection

const NAME = "ngx-translate-intellisense";
const output = vscode.window.createOutputChannel(NAME);

function write(message: string) {
  output.appendLine(message);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(completionTranslations(), commandRonini());
}

// this method is called when your extension is deactivated
export function deactivate() {}

function completionTranslations(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    {
      scheme: "file",
      language: "typescript",
    },
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
      ) {
        const key = "key";
        const values = ["value"];
        return [
          {
            kind: vscode.CompletionItemKind.Constant,
            label: key,
            detail: `Translations from '${key}'`,
            documentation: new vscode.MarkdownString(
              `**Key:** ${key}  \n  **EN:** ${values[0]}`
            ),
          },
        ];
      },
    }
  );
}

const translationsFolderName = "i18n";
const translationFileExtension = "json";
const defaultLanguage = "";
let dirs: string[] = [];

function commandRonini(): vscode.Disposable {
  return vscode.commands.registerCommand(`${NAME}.ronini`, async () => {
    try {
      write("searching workspace...");
      const folders = vscode.workspace.workspaceFolders;
      if (folders?.length === 0) {
        return;
      }
      dirs = [];
      for (const f of folders) {
        await listDirectoriesRecursive(f.uri.fsPath + "/src");
      }
      dirs = dirs.filter((d) => {
        return d.endsWith(translationsFolderName);
      });
      if (dirs.length > 0) {
        const dir = dirs[0];
        write(`found ${translationsFolderName} directory (${dir})...`);
        write("searching for a translation file...");
        let translationFile: string;
        if (defaultLanguage !== null && defaultLanguage.trim() !== "") {
          translationFile = path.join(
            dir,
            `${defaultLanguage}.${translationFileExtension}`
          );
        } else {
          let translationFiles = await listFiles(dir);
          translationFiles = translationFiles.filter((f) => {
            return f.endsWith("." + translationFileExtension);
          });
          translationFile = translationFiles[0];
        }

        if (!(await existsSync(translationFile))) {
          vscode.window.showErrorMessage(
            `Couldn\'t find translation file: ${translationFile}`
          );
        } else {
          write(`found translation file (${translationFile})`);
          const fileBuffer = readFileSync(translationFile);
          const json = JSON.parse(fileBuffer);
          write(JSON.stringify(json, null, 2));
          write(`read translation file contents`);
        }
      }
    } catch (e) {
      vscode.window.showErrorMessage(e);
    }
  });
}

async function listDirectoriesRecursive(dir) {
  const filePaths = await listFiles(dir);
  const filePathsAndIsDirectoryFlagsPromises = filePaths.map(
    async (filePath) => ({
      path: filePath,
      isDirectory: (await promises.stat(filePath)).isDirectory(),
    })
  );
  const filePathsAndIsDirectoryFlags = await Promise.all(
    filePathsAndIsDirectoryFlagsPromises
  );
  const _dirs = filePathsAndIsDirectoryFlags
    .filter(
      (filePathAndIsDirectoryFlag) => filePathAndIsDirectoryFlag.isDirectory
    )
    .map((filePathAndIsDirectoryFlag) => filePathAndIsDirectoryFlag.path);
  dirs.push(..._dirs);
  for (const d of _dirs) {
    await listDirectoriesRecursive(d);
  }
}

async function listFiles(dir) {
  const fileNames = await promises.readdir(dir);
  return fileNames.map((fileName) => path.join(dir, fileName));
}
