import {
  existsSync,
  FSWatcher,
  promises,
  readdir,
  readFile,
  readFileSync,
  watch,
  writeFile,
} from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as md5 from "md5";
import * as constants from "./constants";
import * as settings from "./settings";
import * as diagnostics from "./diagnostics";
import * as util from "./util";
import * as translationsEditor from "./translationsEditor";

// TODO: refactor

export let translationFiles: string[] = [];
export let translationFileWatches: FSWatcher[] = [];
export let translations: any[] = [];
export let languages: string[] = [];

let dirs: string[] = [];

export function activate(context: vscode.ExtensionContext) {
  util.initOutput();
  indexTranslations()
    .then((result) => {})
    .catch((error) => {});

  const diagnosticCollection = diagnostics.init();
  subscribeToDocumentChanges(context);

  context.subscriptions.push(
    hoverTranslations(),
    translationCompletions(),
    commandUpdateTranslations(),
    commandCreateTranslationFromSelection(),
    commandOpenTranslationFiles(),
    commandOpenTranslationsEditor(context),
    diagnosticCollection
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}

function subscribeToDocumentChanges(context: vscode.ExtensionContext) {
  if (vscode.window.activeTextEditor) {
    diagnostics.run(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        diagnostics.run(editor.document);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => diagnostics.run(e.document))
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) =>
      diagnostics.deleteDocument(doc)
    )
  );
}

function hoverTranslations(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(constants.FILE_SELECTOR, {
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
          constants.REGEXP_TRANSLATE_PIPE
        );
        if (foundRange !== undefined) {
          const text = document.getText(foundRange);
          const firstQuote = text.indexOf("'");
          const secondQuote = text.lastIndexOf("'");
          const key = text.substring(firstQuote + 1, secondQuote);

          return new vscode.Hover(getDocumentationForTranslation(key));
        } else {
          return null;
        }
      }
    },
  });
}

function translationCompletions(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    constants.FILE_SELECTOR,
    {
      provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
      ) {
        if (isNotIndexed()) {
          return null;
        } else {
          const defaultTranslation = translations[0] as Object;
          const items = Object.keys(defaultTranslation).map((key, index) => {
            if (defaultTranslation.hasOwnProperty(key)) {
              return {
                kind: vscode.CompletionItemKind.Constant,
                label: constants.COMPLETION_ITEM_PREFIX + key,
                insertText: util.getTranslationTemplate(key),
                detail: `Translation for '${key}'`,
                documentation: getDocumentationForTranslation(key),
              };
            } else {
              return null;
            }
          });

          return items.filter((i) => i !== null) as vscode.CompletionItem[];
        }
      },
    }
  );
}

let lastFocus = null;

function commandOpenTranslationsEditor(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${constants.PACKAGE_NAME}.openTranslationsEditor`,
    () => {
      translationsEditor.open(context);
    }
  );
}

function commandOpenTranslationFiles(): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${constants.PACKAGE_NAME}.openTranslationFiles`,
    async () => {
      try {
        await openTranslationFiles();
      } catch (e) {
        vscode.window.showErrorMessage(e);
        util.write(e);
      }
    }
  );
}

function commandUpdateTranslations(): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${constants.PACKAGE_NAME}.updateTranslations`,
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
        util.write(e);
      }
    }
  );
}

function commandCreateTranslationFromSelection(): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${constants.PACKAGE_NAME}.createTranslationFromSelection`,
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
                    edit.replace(
                      selectionRange,
                      util.getTranslationTemplate(key)
                    );
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
                  value: util.toSnakeCase(selection),
                },
                new vscode.CancellationTokenSource().token
              )
              .then(
                (result) => {
                  // if key name is not null or empty
                  if (result !== undefined && result?.trim() !== "") {
                    const tCopy = [...translations];

                    // append the translation to all translation files
                    for (let i = 0; i < tCopy.length; i++) {
                      tCopy[i][result] = selection;
                    }

                    const itemOpenFiles = "Open translation files";
                    writeChanges(tCopy, () => {
                      editor.edit((edit) => {
                        edit.replace(
                          selectionRange,
                          util.getTranslationTemplate(result)
                        );
                      });
                      vscode.window
                        .showInformationMessage(
                          `Created translation key '${result}' for '${selection}'`,
                          itemOpenFiles
                        )
                        .then((selection) => {
                          switch (selection) {
                            case itemOpenFiles:
                              openTranslationFiles()
                                .then((result) => {})
                                .catch((error) => {});
                              break;
                          }
                        });
                    });
                  }
                },
                (error) => {
                  vscode.window.showErrorMessage(error);
                  util.write(error);
                }
              );
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(e);
        util.write(e);
      }
    }
  );
}

function watchTranslationFileChanges() {
  translationFileWatches.forEach((t) => {
    t.close();
  });
  let md5Previous = null;
  let fsWait = false;
  translationFileWatches = translationFiles.map((f) => {
    return watch(f, (event, filename) => {
      if (filename) {
        if (fsWait) {
          return;
        }
        fsWait = setTimeout(() => {
          fsWait = false;
        }, 100);
        const md5Current = md5(readFileSync(f));
        if (md5Current === md5Previous) {
          return;
        }
        md5Previous = md5Current;
        indexTranslations()
          .then((result) => {})
          .catch((error) => {});
      }
    });
  });
}

async function indexTranslations() {
  translations = [];
  translationFiles = await getTranslationFiles();
  watchTranslationFileChanges();
  languages = translationFiles.map((f) => {
    return path.basename(f, "." + settings.FILE_EXTENSION);
  });
  translations = await Promise.all(
    translationFiles.map((f) => {
      return readTranslationFile(f);
    })
  );

  if (!isNotIndexed()) {
    translationsEditor.refresh();
    if (vscode.window.activeTextEditor) {
      diagnostics.run(vscode.window.activeTextEditor.document);
    }
  }
}

async function getTranslationFiles(): Promise<string[]> {
  try {
    util.write("searching workspace...");
    const folders = vscode.workspace.workspaceFolders;
    if (folders === null || folders?.length === 0) {
      return [];
    }
    if (folders !== undefined) {
      dirs = [];
      for (const f of folders) {
        await listDirectoriesRecursive(f.uri.fsPath + "/src");
      }
      dirs = dirs.filter((d) => {
        return d.endsWith(settings.FOLDER_NAME);
      });
      if (dirs.length > 0) {
        const dir = dirs[0];
        util.write(`found ${settings.FOLDER_NAME} directory (${dir})...`);
        util.write("searching for a translation file...");
        let translationFiles = await listFiles(dir);
        translationFiles = translationFiles.filter((f) => {
          return f.endsWith("." + settings.FILE_EXTENSION);
        });
        return translationFiles;
      }
    }
    return [];
  } catch (e) {
    vscode.window.showErrorMessage(e);
    util.write(e);
    return [];
  }
}

function readTranslationFile(file: string): any {
  try {
    const fileBuffer = readFileSync(file);
    const json = JSON.parse(fileBuffer as any);
    util.write(`read translation file contents`);
    return json;
  } catch (e) {
    vscode.window.showErrorMessage(e);
    util.write(e);
  }
}

async function listDirectoriesRecursive(dir: string) {
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

async function listFiles(dir: string) {
  const fileNames = await promises.readdir(dir);
  return fileNames.map((fileName) => path.join(dir, fileName));
}

function getDocumentationForTranslation(key: string): vscode.MarkdownString {
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

export function isNotIndexed(): boolean {
  return translationFiles.length === 0 || translations.length === 0;
}

export function writeChanges(changes: any[], onComplete: () => void) {
  for (let i = 0; i < changes.length; i++) {
    writeFile(
      translationFiles[i],
      JSON.stringify(changes[i], null, 2),
      (error) => {
        if (error) {
          vscode.window.showErrorMessage(error.message);
          util.write(error.message);
        } else {
          onComplete();
        }
      }
    );
  }
}
