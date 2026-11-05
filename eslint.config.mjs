import js from '@eslint/js';
import globals from 'globals';

/** 인프라 검사 스크립트의 실행 오류를 사전에 확인한다. */
export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
];
