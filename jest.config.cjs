module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  moduleNameMapper: {
    '^\\.\\./RPGClub_GameDB(\\.js)?$': '<rootDir>/src/tests/mocks/RPGClub_GameDB.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  roots: ['<rootDir>/src/tests'],
  transform: {
    '^.+.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
