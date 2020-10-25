import * as vscode from "vscode";
import * as extension from "./extension";
import * as util from "./util";

export const id = "translations-editor-webview";

let translationsEditorWebViewPanel: vscode.WebviewPanel | null = null;
let lastFocus: {
  key: string;
  langIndex: number;
} | null = null;

export class WebViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    setWebViewContent(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(
      onDidReceiveMessageListener,
      undefined,
      context.subscriptions
    );
  }

  public refresh() {
    try {
      if (this._view) {
        setWebViewContent(this._view.webview);
      }
    } catch (e) {
      util.write(e);
    }
  }
}

export function refresh() {
  try {
    if (translationsEditorWebViewPanel) {
      translationsEditorWebViewPanel.webview.html = getTranslationEditorContent();
    }
  } catch (e) {
    util.write(e);
  }
}

export function open(context: vscode.ExtensionContext) {
  try {
    translationsEditorWebViewPanel = vscode.window.createWebviewPanel(
      id,
      "Translations Editor",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
      }
    );

    setWebViewContent(translationsEditorWebViewPanel.webview);

    translationsEditorWebViewPanel.webview.onDidReceiveMessage(
      onDidReceiveMessageListener,
      undefined,
      context.subscriptions
    );

    return translationsEditorWebViewPanel;
  } catch (e) {
    vscode.window.showErrorMessage(e);
    util.write(e);
  }
}

function setWebViewContent(view: vscode.Webview) {
  try {
    view.html = getTranslationEditorContent();
  } catch (e) {
    util.write(e);
  }
}

const onDidReceiveMessageListener = (message) => {
  const { command, key, langIndex, value } = message;
  switch (command) {
    case "refresh":
      refresh();
      break;
    case "changeKey":
      const previousValues: string[] = [];
      for (const t of extension.translations) {
        if (t[value] !== undefined) {
          // this key already exists
          return;
        } else {
          previousValues.push(t[key] ?? "");
        }
      }
      extension.translations.forEach((t, i) => {
        delete t[key];
        t[value] = previousValues[i];
      });

      extension.writeChanges(extension.translations, () => {});
      break;
    case "change":
      if (extension.translations[langIndex][key] !== value) {
        extension.translations[langIndex][key] = value;
        extension.writeChanges(extension.translations, () => {});
      }
      break;
    case "focus":
      if (lastFocus === null) {
        lastFocus = {};
      }
      lastFocus.key = key;
      lastFocus.langIndex = +langIndex;
      break;
    case "new":
      for (let i = 0; i < extension.translations.length; i++) {
        extension.translations[i]["__temp"] = "";
      }
      extension.writeChanges(extension.translations, () => {});
      break;
    case "delete":
      for (let i = 0; i < extension.translations.length; i++) {
        try {
          delete extension.translations[i][key];
        } catch (e) {}
      }
      extension.writeChanges(extension.translations, () => {});
      break;
  }
};

function translationsEditorButtons(): string {
  return `<div style="display: flex;">
    <button onclick="refresh()" style="margin-right: 10px;">🗘   Refresh</button>
    </div>`;
}

function translationsEditorHead(): string {
  return `<thead><tr>
  <th>#</th>
  ${extension.languages
    .map((lang) => {
      return `<th>${lang.toUpperCase()}</th>`;
    })
    .join("")}<th></th></tr>
  </thead>`;
}

function translationsEditorBody(): string {
  const translationTable: { [key: string]: string[] } = {};
  extension.translations.forEach((t) => {
    Object.keys(t).forEach((k) => {
      if (translationTable[k] === undefined) {
        translationTable[k] = [];
      }
      translationTable[k].push(t[k]);
    });
  });

  Object.keys(translationTable).forEach((k) => {
    for (
      let i = 0;
      i < extension.languages.length - translationTable[k].length;
      i++
    ) {
      translationTable[k].push("");
    }
  });

  return `<tbody>
  ${Object.keys(translationTable)
    .map((key, iKey) => {
      return `<tr>
        <td>
          <input id="${key}" name="${iKey}"
          onblur="onKeyInputBlur(event)"
          onfocus="onInputFocus(event)"
          class="${key === "" ? "empty" : ""}"
          minlength="1"
          value="${key}" />
        </td>${(translationTable[key] as string[])
          .map((t, iLang) => {
            return `<td><input id="${key}" name="${iLang}"
          onblur="onInputBlur(event)"
          onfocus="onInputFocus(event)"
          class="${t === "" ? "empty" : ""}" 
          value="${t}" /></td>`;
          })
          .join("")}
        <td>
        <button class="iconbutton" title="Delete '${key}'" onclick="deleteKey('${key}')">🗑️</button>
        </td>
        </tr>`;
    })
    .join("")}
    ${translationsEditorRefocusScript()}
  </tbody>`;
}

function translationsEditorRefocusScript() {
  return lastFocus !== null
    ? `<script> 
    const selector = '#${lastFocus.key}[name="${lastFocus.langIndex}"]'
    const lastFocusedInput = document.querySelector(selector)
    lastFocusedInput.focus()
    </script>`
    : "";
}

function translationsEditorScript(): string {
  return `<script>
    const vscode = acquireVsCodeApi();

    function refresh() {
      vscode.postMessage({
          command: 'refresh'
      })
    }
    function onKeyInputBlur(e) {
      vscode.postMessage({
          command: 'changeKey',
          key: e.target.id,
          value: e.target.value
      })
    }
    function onInputBlur(e) {
      vscode.postMessage({
          command: 'change',
          key: e.target.id,
          langIndex: e.target.name,
          value: e.target.value
      })
    }
    function onInputFocus(e) {
      vscode.postMessage({
          command: 'focus',
          key: e.target.id,
          langIndex: e.target.name
      })
    }
    function addNew() {
      vscode.postMessage({
          command: 'new'
      })
    }
    function deleteKey(key) {
      vscode.postMessage({
          command: 'delete',
          key: key
      })
    }
  </script>`;
}

function translationsEditorStyle(): string {
  return `<style>
    body {
      padding: 20px;
    }
  
    .iconbutton {
      user-select: none;
      cursor: pointer;
      border: 0;
      padding: 0px;
      height: auto;
    }
  
    button {
      background: transparent;
      border-color: 1px solid #fff;
      color: #fff;
      padding: 0px 5px;
      height: 30px;
    }
    
    button:hover {
      background: #232323;
    }
  
    input{
      width: 99%;
      background: transparent;
      color: rgba(255,255,255,0.75);
      font-size: 12px;
    }
    input.empty {
      background: rgba(255,0,0,0.25)
    }
    input:focus {
      color: #fff;
    }
  
    table {
      width: 100%;
      text-align: left;
      border-collapse: collapse;
    }
    table td, table th {
      border: 1px solid rgba(255,255,255,0.5);
    }
    table td {
      padding: 2px 4px;
    }
    table tbody td {
      font-size: 12px;
    }
    table tr:nth-child(even) {
      background: rgba(0,0,0,0.15)
    }
    table thead {
      border-bottom: 2px solid rgba(255,255,255,0.5);
    }
    table thead th {
      font-size: 12px;
      font-weight: bold;
      color: #fff;
      text-align: left;
      border-left: 2px solid rgba(255,255,255,0.5);
      background: rgba(0,0,0,0.35);
      padding: 2px 4px;
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
    extension.isNotIndexed()
      ? "Indexing translations..."
      : `${translationsEditorButtons()}<br/><br/>
      <table>
  ${translationsEditorHead()}
  ${translationsEditorBody()}
  </table>
  <button onclick="addNew()" style="margin-top: 10px; width: 100%">+   New</button>`
  }
  ${translationsEditorScript()}
  </body>
  </html>`;
}
