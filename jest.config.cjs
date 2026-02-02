module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  roots: ['<rootDir>/src/tests'],
  transform: {
    '^.+.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
