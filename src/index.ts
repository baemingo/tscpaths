#! /usr/bin/env node

// tslint:disable no-console
import * as program from 'commander';
import { existsSync, readFile, writeFile } from 'fs-extra';
import { stream } from 'globby';
import { dirname, relative, resolve } from 'path';
import { loadConfig } from './util';

let startTime = new Date().getTime();

program
  .version('0.0.1')
  .option('-p, --project <file>', 'path to tsconfig.json')
  .option('-s, --src <path>', 'source root path')
  .option('-o, --out <path>', 'output root path')
  .option('-v, --verbose', 'output logs')
  .option('--silent', 'silence the console output');

program.on('--help', () => {
  console.log(`
  $ tscpath -p tsconfig.json
`);
});

program.parse(process.argv);

const { project, src, out, verbose, silent } = program as {
  project?: string;
  src?: string;
  out?: string;
  verbose?: boolean;
  silent?: boolean;
};

if (!project) {
  throw new Error('--project must be specified');
}
if (!src) {
  throw new Error('--src must be specified');
}

const log = (...args: any[]): void => {
  if (!silent) {
    console.log(...args);
  }
};

const verboseLog = (...args: any[]): void => {
  if (verbose) {
    console.log(...args);
  }
};

const configFile = resolve(process.cwd(), project);

const srcRoot = resolve(src);

const outRoot = out && resolve(out);

log(`tscpaths --project ${configFile} --src ${srcRoot} --out ${outRoot}`);

const { baseUrl, outDir, paths } = loadConfig(configFile);

if (!baseUrl) {
  throw new Error('compilerOptions.baseUrl is not set');
}
if (!paths) {
  throw new Error('compilerOptions.paths is not set');
}
if (!outDir) {
  throw new Error('compilerOptions.outDir is not set');
}
verboseLog(`baseUrl: ${baseUrl}`);
verboseLog(`outDir: ${outDir}`);
verboseLog(`paths: ${JSON.stringify(paths, null, 2)}`);

const configDir = dirname(configFile);

const basePath = resolve(configDir, baseUrl);
verboseLog(`basePath: ${basePath}`);

const outPath = outRoot || resolve(basePath, outDir);
verboseLog(`outPath: ${outPath}`);

const outFileToSrcFile = (x: string): string =>
  resolve(srcRoot, relative(outPath, x));

const aliases = Object.keys(paths)
  .map((alias) => ({
    prefix: alias.replace(/\*$/, ''),
    aliasPaths: paths[alias as keyof typeof paths].map((p) =>
      resolve(basePath, p.replace(/\*$/, ''))
    ),
  }))
  .filter(({ prefix }) => prefix);
verboseLog(`aliases: ${JSON.stringify(aliases, null, 2)}`);

const toRelative = (from: string, x: string): string => {
  const rel = relative(from, x);
  return (rel.startsWith('.') ? rel : `./${rel}`).replace(/\\/g, '/');
};

const exts = ['.js', '.jsx', '.ts', '.tsx', '.d.ts', '.json'];

const absToRel = (
  modulePath: string,
  outFile: string
): { path: string; isMatched: boolean } => {
  const alen = aliases.length;
  for (let j = 0; j < alen; j += 1) {
    const { prefix, aliasPaths } = aliases[j];

    if (modulePath.startsWith(prefix)) {
      const modulePathRel = modulePath.substring(prefix.length);
      const srcFile = outFileToSrcFile(outFile);
      const outRel = relative(basePath, outFile);
      verboseLog(`${outRel} (source: ${relative(basePath, srcFile)}):`);
      verboseLog(`\timport '${modulePath}'`);
      const len = aliasPaths.length;
      for (let i = 0; i < len; i += 1) {
        const apath = aliasPaths[i];
        const moduleSrc = resolve(apath, modulePathRel);
        if (
          existsSync(moduleSrc) ||
          exts.some((ext) => existsSync(moduleSrc + ext))
        ) {
          const rel = toRelative(dirname(srcFile), moduleSrc);
          verboseLog(
            `\treplacing '${modulePath}' -> '${rel}' referencing ${relative(
              basePath,
              moduleSrc
            )}`
          );
          return { path: rel, isMatched: true };
        }
      }
      console.log(`could not replace ${modulePath}`);
    }
  }
  return { path: modulePath, isMatched: false };
};

const requireRegex = /(?:import|require)\(['"]([^'"]*)['"]\)/g;
const importRegex = /(?:import|from) ['"]([^'"]*)['"]/g;

const replaceImportStatement = (
  orig: string,
  matched: string,
  outFile: string
): { importStatement: string; isMatched: boolean } => {
  const index = orig.indexOf(matched);
  const { path, isMatched } = absToRel(matched, outFile);
  const newImport =
    orig.substring(0, index) + path + orig.substring(index + matched.length);
  return { importStatement: newImport, isMatched };
};

const replaceAlias = (
  text: string,
  outFile: string
): { newText: string; replaceCount: number } => {
  let replaceCount = 0;

  const replaceCallback = (orig: string, matched: any): string => {
    const { importStatement, isMatched } = replaceImportStatement(
      orig,
      matched,
      outFile
    );

    if (isMatched) {
      replaceCount += 1;
    }

    return importStatement;
  };

  const newText = text
    .replace(requireRegex, replaceCallback)
    .replace(importRegex, replaceCallback);
  return { newText, replaceCount };
};

const initTime = new Date().getTime() - startTime;
verboseLog(`init finished. took: ${initTime} ms total`);
startTime = new Date().getTime();

(async (): Promise<void> => {
  let changedFileCount = 0;
  let totalReplaceCount = 0;
  const globbyPath = outPath.replace(/\\/g, '/');
  for await (const path of stream(
    [`${globbyPath}/**/*.{js,jsx,ts,tsx}`, `!${globbyPath}/node_modules/**/*`],
    {
      dot: true,
      noDir: true,
    } as any
  )) {
    const file = resolve(path.toString());
    const text = await readFile(file, 'utf8');
    const { newText, replaceCount } = replaceAlias(text, file);
    totalReplaceCount += replaceCount;
    if (text !== newText) {
      changedFileCount += 1;
      log(`${file}: replaced ${replaceCount} paths`);
      await writeFile(file, newText, 'utf8');
    }
  }
  verboseLog(`paths fixed. took: ${new Date().getTime() - startTime} ms total`);
  log(`Replaced ${totalReplaceCount} paths in ${changedFileCount} files`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
