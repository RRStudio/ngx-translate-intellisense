import * as vscode from "vscode";
import { isNotIndexed, translations, languages } from "./extension";
import * as constants from "./constants";

let diagnosticCollection: vscode.DiagnosticCollection;

export function init(): vscode.DiagnosticCollection {
  diagnosticCollection = vscode.languages.createDiagnosticCollection(
    "ngx-translation-intellisense"
  );
  return diagnosticCollection;
}

export function run(doc: vscode.TextDocument): void {
  if (isNotIndexed()) {
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];

  for (let line = 0; line < doc.lineCount; line++) {
    const lineOfText = doc.lineAt(line);
    const matches = lineOfText.text.match(constants.REGEXP_TRANSLATE_PIPE);
    matches?.forEach((match) => {
      const char = lineOfText.text.indexOf(match);
      const diagnostic = createDiagnostic(
        doc,
        match,
        new vscode.Position(line, char)
      );
      if (diagnostic) {
        diagnostics.push(diagnostic);
      }
    });
  }

  diagnosticCollection.set(doc.uri, diagnostics);
}

export function deleteDocument(doc: vscode.TextDocument) {
  diagnosticCollection.delete(doc.uri);
}

function createDiagnostic(
  doc: vscode.TextDocument,
  text: string,
  position: vscode.Position
): vscode.Diagnostic | null {
  const range = doc.getWordRangeAtPosition(
    position,
    constants.REGEXP_TRANSLATE_PIPE
  );

  const firstQuote = text.indexOf("'");
  const secondQuote = text.lastIndexOf("'");
  const key = text.substring(firstQuote + 1, secondQuote);

  if (range) {
    return diagnoseTranslationKey(range, key);
  } else {
    return null;
  }
}

function diagnoseTranslationKey(
  range: vscode.Range,
  key: string
): vscode.Diagnostic | null {
  const missingLanguages: string[] = [];
  translations.forEach((t, i) => {
    if (t[key] === undefined || t[key].trim() === "") {
      missingLanguages.push(languages[i]);
    }
  });

  if (missingLanguages.length === languages.length) {
    return {
      range: range,
      message: `Translation key '${key}' doesn't exist`,
      severity: vscode.DiagnosticSeverity.Error,
      code: "key-doesnt-exist",
    };
  } else if (missingLanguages.length > 0) {
    return {
      range: range,
      message: `Translation key '${key}' isn't implmeneted in languages: ${missingLanguages.join(
        ", "
      )}`,
      severity: vscode.DiagnosticSeverity.Warning,
      code: "key-not-fully-implemented",
    };
  } else {
    return null;
  }
}
