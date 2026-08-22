import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const GAME_ROOT = join(ROOT, 'www', 'src', 'games');
const files = [...walk(GAME_ROOT), join(ROOT, 'www', 'src', 'lobby', 'Lobby.tsx')];
const translatedAttributes = new Set([
  'aria-label', 'againLabel', 'headline', 'label', 'nextLabel', 'note', 'startLabel', 'status', 'unit', 'waiting',
]);
const findings = [];

for (const path of files) {
  const source = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function visit(node) {
    if (ts.isJsxText(node)) {
      const value = node.text.trim();
      if (/[A-Za-zÀ-ÿ]/.test(value) && value !== 's') report(node, value);
    }

    if (ts.isJsxAttribute(node) && translatedAttributes.has(node.name.text)) {
      const value = node.initializer;
      if (value && ts.isStringLiteral(value) && /[A-Za-zÀ-ÿ]/.test(value.text)) report(value, value.text);
    }

    if (isVisibleString(node) && !insideGameText(node) && !isControlValue(node)) {
      const attribute = ancestor(node, ts.isJsxAttribute);
      if (attribute && translatedAttributes.has(attribute.name.text)) report(node, node.getText(ast));

      const expression = ancestor(node, ts.isJsxExpression);
      if (expression && !attribute) report(node, node.getText(ast));

      const call = ancestor(node, ts.isCallExpression);
      if (call && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'setError') {
        report(node, node.getText(ast));
      }
    }

    ts.forEachChild(node, visit);
  }

  function report(node, value) {
    const at = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    const item = `${relative(ROOT, path)}:${at.line + 1} ${String(value).replace(/\s+/g, ' ').slice(0, 100)}`;
    if (!findings.includes(item)) findings.push(item);
  }

  visit(ast);
}

if (findings.length > 0) {
  console.error('game UI has player-visible text outside useGameText():');
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(`game UI translation guard passed (${files.length} TSX files)`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.tsx') ? [path] : [];
  });
}

function isVisibleString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return /[A-Za-zÀ-ÿ]/.test(node.text);
  if (!ts.isTemplateExpression(node)) return false;
  const literal = node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
  return /[A-Za-zÀ-ÿ]/.test(literal) && literal.trim() !== 's';
}

function insideGameText(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'text') return true;
    if (ts.isStatement(parent)) return false;
  }
  return false;
}

function isControlValue(node) {
  const parent = node.parent;
  return ts.isBinaryExpression(parent) ||
    (ts.isCaseClause(parent)) ||
    (ts.isPropertyAssignment(parent) && parent.name !== node);
}

function ancestor(node, predicate) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (predicate(parent)) return parent;
    if (ts.isStatement(parent)) return null;
  }
  return null;
}
