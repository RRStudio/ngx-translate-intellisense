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

// TODO: simple translations editor
// TODO: add problem for each key that isn't translated
// TODO: highlight translate string pipe that is invalid (no such key error)

const NAME = "ngx-translate-intellisense";
const selector = [
  {
    scheme: "file",
    language: "html",
  },
];
const completionPrefix = "t:";

const translationsFolderName = "i18n";
const translationFileExtension = "json";

let translationFiles: string[] = [];
let translationFileWatches: FSWatcher[] = [];
let translations: any[] = [];
let languages: string[] = [];

let output: vscode.OutputChannel;
let dirs: string[] = [];

let translationsEditorWebViewPanel: vscode.WebviewPanel = null;

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
    commandOpenTranslationFiles(),
    commandOpenTranslationsEditor(context)
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

          return new vscode.Hover(getDocumentationForTranslation(key));
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
        const defaultTranslation = translations[0] as Object;
        const items = Object.keys(defaultTranslation).map((key, index) => {
          if (defaultTranslation.hasOwnProperty(key)) {
            return {
              kind: vscode.CompletionItemKind.Constant,
              label: completionPrefix + key,
              insertText: getTranslationTemplate(key),
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
  });
}

function refreshTranslationsEditor() {
  try {
    translationsEditorWebViewPanel?.webview.html = getTranslationEditorContent();
  } catch (e) {
    write(e);
  }
}

function commandOpenTranslationsEditor(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand(
    `${NAME}.openTranslationsEditor`,
    async () => {
      try {
        translationsEditorWebViewPanel = vscode.window.createWebviewPanel(
          "translationsEditor",
          "Translations Editor",
          vscode.ViewColumn.One,
          {
            enableScripts: true,
          }
        );

        refreshTranslationsEditor();

        translationsEditorWebViewPanel.webview.onDidReceiveMessage(
          (message) => {
            switch (message.command) {
              case "refresh":
                refreshTranslationsEditor();
                return;
              case "change":
                vscode.window.showInformationMessage("change");
                return;
            }
          },
          undefined,
          context.subscriptions
        );
      } catch (e) {
        vscode.window.showErrorMessage(e);
        write(e);
      }
    }
  );
}

function translationsEditorButtons(): string {
  return `<div style="display: flex;">
  <button onclick="refresh()" style="margin-right: 10px;">🗘   Refresh</button>
  </div>`;
}

function translationsEditorHead(): string {
  return `<thead><tr>
<th>#</th>
${languages
  .map((lang) => {
    return `<th>${lang.toUpperCase()}</th>`;
  })
  .join("")}</tr>
</thead>`;
}

function translationsEditorBody(): string {
  const translationTable = {};
  translations.forEach((t) => {
    Object.keys(t).forEach((k) => {
      if (translationTable[k] === undefined) {
        translationTable[k] = [];
      }
      translationTable[k].push(t[k]);
    });
  });

  Object.keys(translationTable).forEach((k) => {
    for (let i = 0; i < languages.length - translationTable[k].length; i++) {
      translationTable[k].push("");
    }
  });

  return `<tbody>
${Object.keys(translationTable)
  .map((k, iKey) => {
    return `<tr><td>${k}</td>${(translationTable[k] as string[])
      .map((t, iLang) => {
        return `<td><input id="${iKey}" name="${iLang}"
        onblur="onInputBlur(event)" 
        class="${t === "" ? "empty" : ""}" 
        value="${t}"/></td>`;
      })
      .join("")}</tr>`;
  })
  .join("")}
</tbody>`;
}

function translationsEditorScript(): string {
  return `<script>
  const vscode = acquireVsCodeApi();
  function refresh() {
    vscode.postMessage({
        command: 'refresh'
    })
  }
  function onInputBlur(e) {
    vscode.postMessage({
        command: 'change',
        keyIndex: e.target.id,
        langIndex: e.target.name
    })
  }
</script>`;
}

function translationsEditorStyle(): string {
  return `<style>
  body {
    padding: 20px;
  }

  button {
    background: transparent;
    border-color: 1px solid #fff;
    color: #fff;
    padding: 0px 5px;
  }
  
  button:hover {
    background: #232323;
  }

  input{
    width: 99%;
    background: transparent;
    color: #CCCCCC;
    font-size: 12px;
  }
  input.empty {
    background: rgba(255,0,0,0.35)
  }
  input:focus {
    color: #FFFFFF;
  }

  table {
    width: 100%;
    text-align: left;
    border-collapse: collapse;
  }
  table td, table th {
    border: 1px solid #AAAAAA;
    padding: 2px 4px;
  }
  table tbody td {
    font-size: 12px;
  }
  table tr:nth-child(even) {
    background: rgba(#000, 0.5);
  }
  table thead {
    border-bottom: 2px solid #AAAAAA;
  }
  table thead th {
    font-size: 12px;
    font-weight: bold;
    color: #FFFFFF;
    text-align: left;
    border-left: 2px solid #AAAAAA;
  }
  table thead th:first-child {
    border-left: none;
  }
</style>`;
}

function getTranslationEditorContent() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Translations editor</title>
    ${translationsEditorStyle()}
</head>
<body>
${
  isNotIndexed()
    ? "Indexing translations..."
    : `${translationsEditorButtons()}<br/><br/>
    <table>
${translationsEditorHead()}
${translationsEditorBody()}
</table>`
}
${translationsEditorScript()}
</body>
</html>`;
}

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
                          getTranslationTemplate(result)
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
    return path.basename(f, "." + translationFileExtension);
  });
  translations = await Promise.all(
    translationFiles.map((f) => {
      return readTranslationFile(f);
    })
  );

  if (!isNotIndexed()) {
    refreshTranslationsEditor();
  }
}

async function getTranslationFiles(): Promise<string[]> {
  try {
    write("searching workspace...");
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
    }
    return [];
  } catch (e) {
    vscode.window.showErrorMessage(e);
    write(e);
    return [];
  }
}

function readTranslationFile(file: string): any {
  try {
    const fileBuffer = readFileSync(file);
    const json = JSON.parse(fileBuffer as any);
    write(`read translation file contents`);
    return json;
  } catch (e) {
    vscode.window.showErrorMessage(e);
    write(e);
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

function isNotIndexed(): boolean {
  return translationFiles.length === 0 || translations.length === 0;
}

function getTranslationTemplate(key: string): string {
  return `{{ '${key}' | translate }}`;
}

function toSnakeCase(value: string): string {
  return value.replace("  ", " ").replace(" ", "_").toLowerCase().trim();
}

function writeChanges(changes: any[], onComplete: () => void) {
  for (let i = 0; i < changes.length; i++) {
    writeFile(
      translationFiles[i],
      JSON.stringify(changes[i], null, 2),
      (error) => {
        if (error) {
          vscode.window.showErrorMessage(error.message);
          write(error.message);
        } else {
          onComplete();
        }
      }
    );
  }
}
