import {
  existsSync,
  promises,
  readdir,
  readFile,
  readFileSync,
  writeFile,
} from "fs";
import * as path from "path";
import * as vscode from "vscode";

// TODO: simple translations editor

const NAME = "ngx-translate-intellisense";
const selector = [
  {
    scheme: "file",
    language: "html",
  },
];
const completionPrefix = "t:";

let output: vscode.OutputChannel;

const translationsFolderName = "i18n";
const translationFileExtension = "json";

let translationFiles: string[] = [];
let translations: unknown[] = [];
let languages: string[] = [];

function write(message: string) {
  output.appendLine(message);
}

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel(NAME);
  indexTranslations()
    .then((result) => {})
    .catch((error) => {});

  context.subscriptions.push(
    hoverTranslations(),
    translationCompletions(),
    commandUpdateTranslations(),
    commandCreateTranslationFromSelection(),
    commandOpenTranslationFiles()
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}

function hoverTranslations(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(selector, {
    provideHover(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken
    ) {
      if (isNotIndexed()) {
        return new vscode.Hover("Loading translations...");
      } else {
        const foundRange = document.getWordRangeAtPosition(
          position,
          new RegExp(/[',"].*[',"]\s\|\stranslate/g)
        );
        if (foundRange !== undefined) {
          const text = document.getText(foundRange);
          const firstQuote = text.indexOf("'");
          const secondQuote = text.lastIndexOf("'");
          const key = text.substring(firstQuote + 1, secondQuote);

          return new vscode.Hover(getDocumentTextForTranslation(key));
        } else {
          return null;
        }
      }
    },
  });
}

function translationCompletions(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken,
      context: vscode.CompletionContext
    ) {
      if (isNotIndexed()) {
        return null;
      } else {
        const defaultTranslation = translations[0];
        const items = Object.keys(defaultTranslation)
          .map((key, index) => {
            if (defaultTranslation.hasOwnProperty(key)) {
              return {
                kind: vscode.CompletionItemKind.Constant,
                label: completionPrefix + key,
                insertText: getTranslationTemplate(key),
                detail: `Translation for '${key}'`,
                documentation: getDocumentTextForTranslation(),
              };
            } else {
              return null;
            }
          })
          .filter((i) => i !== null);
        return items;
      }
    },
  });
}

let dirs: string[] = [];

function commandOpenTranslationFiles(): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${NAME}.openTranslationFiles`,
    async () => {
      try {
        await openTranslationFiles();
      } catch (e) {
        vscode.window.showErrorMessage(e);
        write(e);
      }
    }
  );
}

function commandUpdateTranslations(): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${NAME}.updateTranslations`,
    async () => {
      try {
        vscode.window.showInformationMessage("Updating translations");
        indexTranslations()
          .then((result) => {
            vscode.window.showInformationMessage(
              "Updated translations successfully"
            );
          })
          .catch((error) => {
            vscode.window.showInformationMessage(
              "Failed updating translations"
            );
          });
      } catch (e) {
        vscode.window.showErrorMessage(e);
        write(e);
      }
    }
  );
}

function commandCreateTranslationFromSelection(): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${NAME}.createTranslationFromSelection`,
    async () => {
      try {
        if (isNotIndexed()) {
          vscode.window.showWarningMessage(
            "Translations are not indexed yet, please wait..."
          );
        } else {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            // get selection
            const selectionRange = new vscode.Range(
              editor.selection.start,
              editor.selection.end
            );
            const selection = editor.document.getText(selectionRange);

            // check if translation already exists
            for (const translation of translations) {
              for (const key in translation) {
                if (
                  selection.toLowerCase() === translation[key].toLowerCase()
                ) {
                  editor.edit((edit) => {
                    edit.replace(selectionRange, getTranslationTemplate(key));
                  });
                  vscode.window.showInformationMessage(
                    `A translation for '${selection}' already exists, so I replaced it for you :)`
                  );
                  return;
                }
              }
            }

            // key doesn't exist, ask for key name
            vscode.window
              .showInputBox(
                {
                  placeHolder: "key_name",
                  prompt:
                    "Please enter the translation key name. The provided key will be converted to snake_case",
                  value: toSnakeCase(selection),
                },
                new vscode.CancellationTokenSource().token
              )
              .then(
                (result) => {
                  // if key name is not null or empty
                  if (result !== null && result?.trim() !== "") {
                    const translationsCopy = [...translations];
                    // append the translation to all translation files
                    for (let i = 0; i < translationsCopy.length; i++) {
                      const translation = translationsCopy[i];
                      translation[result] = selection;
                      writeFile(
                        translationFiles[i],
                        JSON.stringify(translation, null, 2),
                        (error) => {
                          if (error) {
                            vscode.window.showErrorMessage(error);
                            write(error);
                          } else {
                            // replace selection with the generated key
                            editor.edit((edit) => {
                              edit.replace(
                                selectionRange,
                                getTranslationTemplate(result)
                              );
                            });
                            vscode.window.showInformationMessage(
                              `Created translation key '${result}' for '${selection}'`
                            );
                          }
                        }
                      );
                    }
                  }
                },
                (error) => {
                  vscode.window.showErrorMessage(error);
                  write(error);
                }
              );
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(e);
        write(e);
      }
    }
  );
}

async function indexTranslations() {
  translations = [];
  translationFiles = await getTranslationFiles();
  languages = translationFiles.map((f) => {
    return path.basename(f, "." + translationFileExtension);
  });
  translations = await Promise.all(
    translationFiles.map((f) => {
      return readTranslationFile(f);
    })
  );
}

async function getTranslationFiles(): string {
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
      let translationFiles = await listFiles(dir);
      translationFiles = translationFiles.filter((f) => {
        return f.endsWith("." + translationFileExtension);
      });
      return translationFiles;
    }
  } catch (e) {
    vscode.window.showErrorMessage(e);
    write(e);
  }
}

function readTranslationFile(file: string): unknown {
  try {
    const fileBuffer = readFileSync(file);
    const json = JSON.parse(fileBuffer);
    write(`read translation file contents`);
    return json;
  } catch (e) {
    vscode.window.showErrorMessage(e);
    write(e);
  }
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

function getDocumentTextForTranslation(key: string): vscode.MarkdownString {
  let documentationText = "Translations:  \n  ";
  for (let i = 0; i < languages.length; i++) {
    documentationText += `**${languages[i].toUpperCase()}:** ${
      translations[i][key]
    }  \n  `;
  }
  return new vscode.MarkdownString(documentationText);
}

async function openTranslationFiles() {
  if (isNotIndexed()) {
    vscode.window.showWarningMessage(
      "Translations are not indexed yet, please wait..."
    );
  } else {
    translationFiles.forEach(async (f) => {
      const uri = vscode.Uri.file(f);
      await vscode.commands.executeCommand(
        "vscode.open",
        uri,
        vscode.ViewColumn.Beside
      );
    });
  }
}

function isNotIndexed(): boolean {
  return translationFiles.length === 0 || translations.length === 0;
}

function getTranslationTemplate(key: string): string {
  return `{{ '${key}' | translate }}`;
}

function toSnakeCase(value: string): string {
  return value.replace("  ", " ").replace(" ", "_").toLowerCase().trim();
}
