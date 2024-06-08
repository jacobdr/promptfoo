import { build, type BuildOptions } from 'esbuild';
import { copy } from 'esbuild-plugin-copy';

import packageJson from './package.json' with { type: 'json' };

const { dependencies, devDependencies, peerDependencies } = packageJson;

const allDependencies = new Set([
  ...Object.keys(dependencies),
  ...Object.keys(devDependencies),
  ...Object.keys(peerDependencies),
]);

/**
 * This is a list of dependencies that require transpilation in the commonjs context
 */
const esmDependenciesRequiringTranspilation = new Set(['chalk']);

const externalDependencies = new Set(allDependencies);
for (const dependencyToBundle of esmDependenciesRequiringTranspilation) {
  externalDependencies.delete(dependencyToBundle);
}
const externalDependenciesList = [...externalDependencies];

const esBuildCommonOptions = {
  entryPoints: ['./src/main.ts', './src/index.ts'],
  platform: 'node',
  sourcemap: true,
  bundle: true,
  outdir: './dist/build',
  logLevel: 'error',
} as const satisfies BuildOptions;

const esbuildEsmBuildConfig = {
  ...esBuildCommonOptions,
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
} as const satisfies BuildOptions;

const esbuildCommonJsBuildConfig = {
  ...esBuildCommonOptions,
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  external: externalDependenciesList,
  // Arbitrarily choose CommonJS build to handle static asset copying -- could be either one
  plugins: [
    copy({
      assets: [
        {
          from: 'src/python/wrapper.py',
          to: 'python',
        },
        {
          from: 'src/*.html',
          to: '.',
        },
        {
          from: 'drizzle/*.sql',
          to: '../drizzle',
        },
        {
          from: 'drizzle/meta/_journal.json',
          to: '../drizzle/meta/_journal.json',
        },
      ],
    }),
  ],
} as const satisfies BuildOptions;

await Promise.all([build(esbuildEsmBuildConfig), build(esbuildCommonJsBuildConfig)]);
