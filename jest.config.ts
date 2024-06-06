/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
import type { Config } from 'jest';
import type { TsJestTransformerOptions } from 'ts-jest';

const tsJestConfig: TsJestTransformerOptions & Record<string, unknown> = { useESM: true };

const config: Config = {
  transform: {
    '^.+\\.m?[tj]sx?$': ['ts-jest', tsJestConfig],
  },
  /*
  moduleNameMapper: {
    '(.+)\\.js': '$1',
  },
  */
  extensionsToTreatAsEsm: ['.ts'],
  setupFiles: ['<rootDir>/.jest/setEnvVars.js', '<rootDir>/.jest/mockFetch.js'],
  testPathIgnorePatterns: [
    '<rootDir>/examples',
    '<rootDir>/node_modules',
    '<rootDir>/dist',
    '<rootDir>/test/integration',
  ],
  modulePathIgnorePatterns: ['<rootDir>/examples', '<rootDir>/node_modules', '<rootDir>/dist'],
  // These are packages that are ESM-only, which jest chokes on, and this forces them to get
  // transpiled to CommonJS so they can run through jest
  transformIgnorePatterns: [
    'node_modules/(?!(chalk|data-uri-to-buffer|fetch-blob|formdata-polyfill))',
  ],
  verbose: true,
};

export default config;
