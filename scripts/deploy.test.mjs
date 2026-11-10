import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function run(options = [], overrides = {}, stage = 'production') {
  const taskDirectory = mkdtempSync(join(tmpdir(), 'graduate-deploy-test-'));
  const commandLog = join(taskDirectory, 'commands.log');
  const binDirectory = join(taskDirectory, 'bin');

  mkdirSync(binDirectory);
  writeFileSync(join(taskDirectory, 'production.env'), 'TEST_ONLY=true\n');
  writeFileSync(commandLog, '');
  writeFileSync(
    join(binDirectory, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DOCKER_COMMAND_LOG"
case "$*" in
  *'ps -q api') printf '%s\\n' api-container ;;
  *'config --hash api') printf '%s\\n' 'api expected-hash' ;;
  inspect*Health*) printf '%s\\n' "\${TEST_API_HEALTH:-healthy}" ;;
  inspect*) printf '%s\\n' "\${TEST_API_HASH:-expected-hash}" ;;
esac
`,
    { mode: 0o700 }
  );

  try {
    const result = spawnSync(
      'bash',
      ['scripts/deploy.sh', stage, '--web-only', ...options],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDirectory}:${process.env.PATH}`,
          GRADUATE_ME_ENV_DIR: taskDirectory,
          DOCKER_COMMAND_LOG: commandLog,
          ...overrides,
        },
      }
    );

    return { ...result, commands: readFileSync(commandLog, 'utf8') };
  } finally {
    rmSync(taskDirectory, { recursive: true, force: true });
  }
}

test('학생 화면 단독 배포는 DB·API·마이그레이션을 건드리지 않고 worker를 시작하지 않는다', () => {
  const result = run(['--without-worker', '--local-images']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.commands,
    /up -d --no-deps --wait --wait-timeout 180 web/
  );
  assert.match(result.commands, /stop worker/);
  assert.doesNotMatch(
    result.commands,
    /stop api|stop web|db:migrate|pg_dump|run --rm|pull|up.*worker/
  );
});

test('API 설정 변경이나 비정상 상태에서는 화면 단독 배포를 시작하지 않는다', () => {
  for (const overrides of [
    { TEST_API_HASH: 'different-hash' },
    { TEST_API_HEALTH: 'unhealthy' },
  ]) {
    const result = run(['--without-worker', '--local-images'], overrides);

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.commands, / up | stop | pull |db:migrate/);
  }
});

test('개발 환경과 체험 모드에서는 화면 단독 배포를 거절한다', () => {
  for (const result of [run([], {}, 'development'), run(['--demo'])]) {
    assert.notEqual(result.status, 0);
    assert.equal(result.commands, '');
  }
});
