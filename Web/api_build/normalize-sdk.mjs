import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const appSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web-antdv-next/src');
const stagingSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/.cache/api-generation');
const roots = process.argv.slice(2).length ? process.argv.slice(2).map((root) => path.resolve(root)) : ['api-services', 'api-plugins'].map((root) => path.join(appSource, root));

for (const root of roots) {
	const relative = path.relative(appSource, root);
	const stagingRelative = path.relative(stagingSource, root);
	const insideStaging = stagingRelative && !stagingRelative.startsWith('..') && !path.isAbsolute(stagingRelative);
	if ((!relative || relative.startsWith('..') || path.isAbsolute(relative)) && !insideStaging) {
		throw new Error('SDK path must be inside the Vben application source directory.');
	}
}

async function collect(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const filename = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collect(filename)));
		else if (entry.name.endsWith('.ts')) files.push(filename);
	}
	return files;
}

const files = (await Promise.all(roots.map(collect))).flat();
const program = ts.createProgram(files, {
	target: ts.ScriptTarget.ESNext,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	paths: { axios: [path.resolve(appSource, '../node_modules/axios/index.d.ts')] },
	skipLibCheck: true,
});
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
let changed = 0;

for (const filename of files) {
	const source = program.getSourceFile(filename);
	if (!source) continue;
	let modified = false;
	const statements = source.statements.flatMap((statement) => {
		if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) return [statement];
		const imported = path.resolve(path.dirname(filename), `${statement.moduleSpecifier.text}.ts`);
		// 部分递归 DTO 被旧生成器错误地导入自身。
		if (imported.toLowerCase() === filename.toLowerCase()) {
			modified = true;
			return [];
		}
		const clause = statement.importClause;
		if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.isTypeOnly) return [statement];
		const bindings = clause.namedBindings.elements.map((specifier) => {
			const symbol = checker.getSymbolAtLocation(specifier.name);
			const target = symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
			const typeOnly = Boolean(target && target.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias) && !(target.flags & ts.SymbolFlags.Value));
			if (!typeOnly || specifier.isTypeOnly) return specifier;
			modified = true;
			return ts.factory.updateImportSpecifier(specifier, true, specifier.propertyName, specifier.name);
		});
		return [
			ts.factory.updateImportDeclaration(
				statement,
				statement.modifiers,
				ts.factory.updateImportClause(clause, false, clause.name, ts.factory.updateNamedImports(clause.namedBindings, bindings)),
				statement.moduleSpecifier,
				statement.attributes
			),
		];
	});
	const transformation = ts.transform(ts.factory.updateSourceFile(source, statements), [
		(context) => {
			function visit(node) {
				if (
					ts.isElementAccessExpression(node) &&
					!node.questionDotToken &&
					ts.isPropertyAccessExpression(node.expression) &&
					ts.isIdentifier(node.expression.expression) &&
					node.expression.expression.text === 'localVarRequestOptions' &&
					node.expression.name.text === 'headers'
				) {
					modified = true;
					return ts.factory.createElementAccessChain(node.expression, ts.factory.createToken(ts.SyntaxKind.QuestionDotToken), node.argumentExpression);
				}
				if (
					ts.isPropertyDeclaration(node) &&
					ts.isIdentifier(node.name) &&
					node.name.text === 'name' &&
					ts.isClassDeclaration(node.parent) &&
					node.parent.name?.text === 'RequiredError' &&
					!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.OverrideKeyword)
				) {
					modified = true;
					return ts.factory.updatePropertyDeclaration(
						node,
						[...(node.modifiers ?? []), ts.factory.createModifier(ts.SyntaxKind.OverrideKeyword)],
						node.name,
						node.questionToken ?? node.exclamationToken,
						node.type,
						node.initializer
					);
				}
				return ts.visitEachChild(node, visit, context);
			}
			return (root) => ts.visitNode(root, visit);
		},
	]);
	if (!modified) {
		transformation.dispose();
		continue;
	}
	const output = printer.printFile(transformation.transformed[0]);
	transformation.dispose();
	if (output !== (await readFile(filename, 'utf8'))) {
		await writeFile(filename, output, 'utf8');
		changed += 1;
	}
}

console.log(`Normalized ${changed} of ${files.length} generated SDK files for strict TypeScript.`);
