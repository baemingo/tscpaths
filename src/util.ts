import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parseConfigFileTextToJson } from 'typescript';

/*
"baseUrl": ".",
"outDir": "lib",
"paths": {
  "src/*": ["src/*"]
},
*/

export interface IRawTSConfig {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    outDir?: string;
    paths?: { [key: string]: string[] };
  };
}

export interface ITSConfig {
  baseUrl?: string;
  outDir?: string;
  paths?: { [key: string]: string[] };
}

export const mapPaths = (
  paths: { [key: string]: string[] },
  mapper: (x: string) => string
): { [key: string]: string[] } => {
  const dest = {} as { [key: string]: string[] };
  Object.keys(paths).forEach((key) => {
    dest[key] = paths[key].map(mapper);
  });
  return dest;
};

export const loadConfig = (file: string): ITSConfig => {
  const {
    extends: ext,
    compilerOptions: { baseUrl, outDir, paths } = {
      baseUrl: undefined,
      outDir: undefined,
      paths: undefined,
    },
  } = parseConfigFileTextToJson(file, readFileSync(file, 'utf-8'))
    .config as IRawTSConfig;

  const config: ITSConfig = {};
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }
  if (outDir) {
    config.outDir = outDir;
  }
  if (paths) {
    config.paths = paths;
  }

  if (ext) {
    let extPath = path.resolve(path.dirname(file),ext)
    // try load file relative to node_modules to support extending from npm packages
    // eg: https://github.com/tsconfig/bases
    
    if(!fs.existsSync(extPath)){
        extPath = path.resolve(__dirname.split("node_modules")[0],"node_modules",ext)
    }
    const parentConfig = loadConfig(extPath);
    return {
      ...parentConfig,
      ...config,
    };
  }

  return config;
};
