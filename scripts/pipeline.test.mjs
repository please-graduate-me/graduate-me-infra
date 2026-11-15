import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';

const previousRevision = 'a'.repeat(40);
const nextRevision = 'b'.repeat(40);
const appRevision = 'c'.repeat(40);

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'graduate-pipeline-'));
  const bin = join(root, 'mock-bin');
  const state = join(root, 'state');
  const release = join(root, 'releases', previousRevision);
  const commandLog = join(root, 'commands.log');
  mkdirSync(bin);
  mkdirSync(join(state, 'images'), { recursive: true });
  mkdirSync(release, { recursive: true });
  mkdirSync(join(root, 'secrets'));
  cpSync('scripts', join(release, 'scripts'), { recursive: true });
  cpSync('images', join(release, 'images'), { recursive: true });
  for (const file of [
    'compose.production.yaml',
    'compose.development.yaml',
    'compose.shared.yaml',
    'Caddyfile',
  ]) {
    cpSync(file, join(release, file));
  }
  for (const stage of ['production', 'development', 'shared']) {
    writeFileSync(join(root, 'secrets', `${stage}.env`), 'TEST_ONLY=true\n');
    cpSync(`images/${stage}.env`, join(state, 'images', `${stage}.env`));
    symlinkSync(`releases/${previousRevision}`, join(root, `active-${stage}`));
  }
  symlinkSync(`releases/${previousRevision}`, join(root, 'control'));
  writeFileSync(commandLog, '');
  writeFileSync(
    join(bin, 'flock'),
    '#!/usr/bin/env bash\nprintf "잠금 %s\\n" "$*" >> "$DOCKER_COMMAND_LOG"\n[[ "${TEST_LOCK_BUSY:-0}" == 0 ]]\n',
    { mode: 0o700 }
  );
  writeFileSync(
    join(bin, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DOCKER_COMMAND_LOG"
case "$*" in
  load) cat >/dev/null ;;
  'image inspect --format {{.Os}}/{{.Architecture}}'*) printf '%s\\n' "\${TEST_PLATFORM:-linux/amd64}" ;;
  'image inspect --format {{index .Config.Labels'*) printf '%s\\n' "$TEST_REVISION" ;;
  *'ps -q api') printf '%s\\n' api-container ;;
  *'config --hash api') printf '%s\\n' 'api expected-hash' ;;
  inspect*Health*) printf '%s\\n' "\${TEST_API_HEALTH:-healthy}" ;;
  inspect*) printf '%s\\n' "\${TEST_API_HASH:-expected-hash}" ;;
  *'exec -T db'*) printf '%s\\n' '검증용 백업' ;;
  *'run --rm --no-deps api pnpm db:migrate') [[ "\${TEST_FAIL_MIGRATION:-0}" == 0 ]] ;;
  *'up -d'*'db') exit 0 ;;
  *'up -d'*) [[ "\${TEST_FAIL_HEALTH:-0}" == 0 ]] ;;
esac
`,
    { mode: 0o700 }
  );

  function run(scope, command, input, overrides = {}) {
    return spawnSync(
      'bash',
      [resolve('scripts/server-command.sh'), root, scope],
      {
        encoding: 'utf8',
        input,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          DOCKER_COMMAND_LOG: commandLog,
          SSH_ORIGINAL_COMMAND: command,
          GRADUATE_ME_ENV_DIR: join(root, 'secrets'),
          TEST_REVISION: appRevision,
          ...overrides,
        },
      }
    );
  }

  function archive() {
    const result = spawnSync(
      'tar',
      [
        '-cf',
        '-',
        '-C',
        release,
        'compose.production.yaml',
        'compose.development.yaml',
        'compose.shared.yaml',
        'Caddyfile',
        'scripts',
        'images',
      ],
      { maxBuffer: 4 * 1024 * 1024 }
    );
    assert.equal(result.status, 0, result.stderr.toString());
    return gzipSync(result.stdout);
  }

  return {
    root,
    release,
    run,
    archive,
    commands: () => readFileSync(commandLog, 'utf8'),
    imageFile: join(state, 'images', 'production.env'),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('infra 수신만으로 운영 버전과 실제 앱 이미지 기록을 변경하지 않는다', () => {
  const task = fixture();
  try {
    const images = readFileSync(task.imageFile, 'utf8');
    const result = task.run('infra', `sync ${nextRevision}`, task.archive());
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readlinkSync(join(task.root, 'pending')),
      `releases/${nextRevision}`
    );
    assert.equal(
      readlinkSync(join(task.root, 'active-production')),
      `releases/${previousRevision}`
    );
    assert.equal(readFileSync(task.imageFile, 'utf8'), images);
    assert.doesNotMatch(task.commands(), /compose|load|up |stop /);
  } finally {
    task.close();
  }
});

test('새 infra가 대기 중이어도 앱 배포는 운영에 적용한 버전의 스크립트를 사용한다', () => {
  const task = fixture();
  try {
    const synced = task.run('infra', `sync ${nextRevision}`, task.archive());
    assert.equal(synced.status, 0, synced.stderr);
    writeFileSync(
      join(task.root, 'releases', nextRevision, 'scripts/deploy-app.sh'),
      '#!/usr/bin/env bash\nexit 77\n'
    );
    const deployed = task.run(
      'web',
      `deploy ${appRevision}`,
      gzipSync('이미지')
    );
    assert.equal(deployed.status, 0, deployed.stderr);
    assert.equal(
      readlinkSync(join(task.root, 'active-production')),
      `releases/${previousRevision}`
    );
  } finally {
    task.close();
  }
});

test('프론트와 관리자 배포는 자기 이미지 기록과 컨테이너만 교체한다', () => {
  for (const [service, imageKey, imageName] of [
    ['web', 'WEB_IMAGE', 'graduate-me-frontend'],
    ['admin', 'ADMIN_IMAGE', 'graduate-me-admin'],
  ]) {
    const task = fixture();
    try {
      const previousImages = readFileSync(task.imageFile, 'utf8');
      const result = task.run(
        service,
        `deploy ${appRevision}`,
        gzipSync('검증용 이미지 묶음')
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        task.commands(),
        new RegExp(
          `up -d --no-deps --no-build --pull never --wait --wait-timeout 180 ${service}`
        )
      );
      assert.doesNotMatch(
        task.commands(),
        / stop |pg_dump|db:migrate|up.*worker/
      );
      const nextImages = readFileSync(task.imageFile, 'utf8');
      assert.match(
        nextImages,
        new RegExp(`${imageKey}=${imageName}:${appRevision}`)
      );
      assert.equal(
        nextImages.replace(new RegExp(`^${imageKey}=.*$`, 'm'), ''),
        previousImages.replace(new RegExp(`^${imageKey}=.*$`, 'm'), '')
      );
      assert.match(task.commands(), /잠금 -w 1800 9/);
    } finally {
      task.close();
    }
  }
});

test('백엔드는 DB 백업과 마이그레이션 후 API만 시작하며 worker를 시작하지 않는다', () => {
  const task = fixture();
  try {
    const result = task.run('api', `deploy ${appRevision}`, gzipSync('이미지'));
    assert.equal(result.status, 0, result.stderr);
    const commands = task.commands();
    assert.match(commands, /stop worker api/);
    assert.match(commands, /pg_dump/);
    assert.match(commands, /run --rm --no-deps api pnpm db:migrate/);
    assert.match(
      commands,
      /up -d --no-deps --no-build --pull never --wait --wait-timeout 180 api/
    );
    assert.ok(
      commands.indexOf('pg_dump') < commands.indexOf('pnpm db:migrate')
    );
    assert.ok(
      commands.indexOf('pnpm db:migrate') <
        commands.indexOf('--no-deps --no-build')
    );
    assert.doesNotMatch(commands, /stop.*web|stop.*admin|up.*worker/);
  } finally {
    task.close();
  }
});

test('잘린 전송·다른 플랫폼·실패한 상태 확인은 성공 이미지 기록을 바꾸지 않는다', () => {
  for (const [input, overrides] of [
    [Buffer.from('잘린 묶음'), {}],
    [gzipSync('이미지'), { TEST_PLATFORM: 'linux/arm64' }],
    [gzipSync('이미지'), { TEST_REVISION: previousRevision }],
    [gzipSync('이미지'), { TEST_FAIL_HEALTH: '1' }],
    [gzipSync('이미지'), { TEST_API_HEALTH: 'unhealthy' }],
    [gzipSync('이미지'), { TEST_LOCK_BUSY: '1' }],
  ]) {
    const task = fixture();
    try {
      const images = readFileSync(task.imageFile, 'utf8');
      const result = task.run('web', `deploy ${appRevision}`, input, overrides);
      assert.notEqual(result.status, 0);
      assert.equal(readFileSync(task.imageFile, 'utf8'), images);
    } finally {
      task.close();
    }
  }
});

test('마이그레이션 실패 시 API를 시작하거나 이미지 버전을 성공으로 기록하지 않는다', () => {
  const task = fixture();
  try {
    const images = readFileSync(task.imageFile, 'utf8');
    const result = task.run(
      'api',
      `deploy ${appRevision}`,
      gzipSync('이미지'),
      {
        TEST_FAIL_MIGRATION: '1',
      }
    );
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(task.imageFile, 'utf8'), images);
    assert.doesNotMatch(task.commands(), /up -d --no-deps/);
  } finally {
    task.close();
  }
});

test('수동 infra 적용이 성공해야 그 환경의 운영 버전을 전환한다', () => {
  const task = fixture();
  try {
    const synced = task.run('infra', `sync ${nextRevision}`, task.archive());
    assert.equal(synced.status, 0, synced.stderr);
    const images = readFileSync(task.imageFile, 'utf8');
    const failed = task.run('infra', `apply production ${nextRevision}`, '', {
      TEST_FAIL_MIGRATION: '1',
    });
    assert.notEqual(failed.status, 0);
    assert.equal(
      readlinkSync(join(task.root, 'active-production')),
      `releases/${previousRevision}`
    );
    const applied = task.run('infra', `apply production ${nextRevision}`);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(
      readlinkSync(join(task.root, 'active-production')),
      `releases/${nextRevision}`
    );
    assert.equal(
      readlinkSync(join(task.root, 'active-shared')),
      `releases/${previousRevision}`
    );
    assert.equal(readFileSync(task.imageFile, 'utf8'), images);
    assert.doesNotMatch(task.commands(), /up.*worker/);
  } finally {
    task.close();
  }
});

test('앱 SSH 키로 infra 적용·임의 셸 명령·잘못된 커밋을 실행할 수 없다', () => {
  const task = fixture();
  try {
    for (const command of [
      `apply production ${nextRevision}`,
      `sync ${nextRevision}`,
      'deploy latest',
      `deploy ${appRevision}; touch marker`,
      `deploy ${appRevision}\ntouch marker`,
      `deploy ${appRevision} extra`,
      'bash',
    ]) {
      const result = task.run('web', command);
      assert.notEqual(result.status, 0, command);
      assert.equal(task.commands(), '', command);
    }
    assert.equal(task.commands(), '');
    assert.equal(existsSync(join(task.root, 'marker')), false);
  } finally {
    task.close();
  }
});

test('infra 묶음의 심볼릭 링크를 거절하고 운영 경로를 유지한다', () => {
  const task = fixture();
  try {
    symlinkSync('/tmp', join(task.release, 'scripts', 'escape'));
    const result = task.run('infra', `sync ${nextRevision}`, task.archive());
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(task.root, 'pending')), false);
    assert.equal(
      readlinkSync(join(task.root, 'active-production')),
      `releases/${previousRevision}`
    );
  } finally {
    task.close();
  }
});

test('최초 전환과 재설치는 기존 이미지 기록과 컨테이너를 유지한다', () => {
  const task = fixture();
  try {
    const destination = join(task.root, 'installed');
    mkdirSync(join(destination, 'images'), { recursive: true });
    for (const stage of ['production', 'development', 'shared']) {
      writeFileSync(
        join(destination, 'images', `${stage}.env`),
        'PRESERVED_IMAGE=local:previous\n'
      );
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(
        'bash',
        [resolve('scripts/bootstrap-deploy.sh'), destination, nextRevision],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${join(task.root, 'mock-bin')}:${process.env.PATH}`,
            DOCKER_COMMAND_LOG: join(task.root, 'commands.log'),
          },
        }
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(
        readFileSync(join(destination, 'state/images/production.env'), 'utf8'),
        'PRESERVED_IMAGE=local:previous\n'
      );
    }
    assert.doesNotMatch(task.commands(), /compose|load|up |stop /);
  } finally {
    task.close();
  }
});

test(
  'Linux 파일 잠금이 다른 배포 프로세스의 동시 진입을 막는다',
  { skip: process.platform !== 'linux' },
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'graduate-lock-'));
    const child = spawn('bash', [
      '-c',
      'source "$1"; lock_deployment "$2"; printf "준비\\n"; read -r waiting',
      '배포-잠금-검증',
      resolve('scripts/deployment-common.sh'),
      root,
    ]);
    try {
      await once(child.stdout, 'data');
      const competing = spawnSync('flock', [
        '-n',
        join(root, 'state/deploy.lock'),
        'true',
      ]);
      assert.equal(competing.status, 1);
    } finally {
      const finished = once(child, 'close');
      child.stdin.end('\n');
      await finished;
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('배포 키 재등록은 개인 로그인 키를 보존하고 대상별 강제 명령을 유지한다', () => {
  const task = fixture();
  try {
    const keys = join(task.root, 'keys');
    const sshDirectory = join(task.root, 'ssh');
    mkdirSync(keys);
    mkdirSync(sshDirectory);
    mkdirSync(join(task.root, 'bin'));
    writeFileSync(
      join(task.root, 'bin/ssh-command'),
      '#!/usr/bin/env bash\nexit 0\n',
      { mode: 0o700 }
    );
    const personalKey =
      'ssh-ed25519 AAAA_preserved_personal_key personal-original\n';
    writeFileSync(join(sshDirectory, 'authorized_keys'), personalKey);
    for (const scope of ['infra', 'web', 'api', 'admin']) {
      const generated = spawnSync('ssh-keygen', [
        '-q',
        '-t',
        'ed25519',
        '-N',
        '',
        '-C',
        `graduate-me-ci-${scope}`,
        '-f',
        join(keys, scope),
      ]);
      assert.equal(generated.status, 0);
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const installed = spawnSync(
        'bash',
        [
          resolve('scripts/install-deploy-keys.sh'),
          task.root,
          keys,
          sshDirectory,
        ],
        { encoding: 'utf8' }
      );
      assert.equal(installed.status, 0, installed.stderr);
      const lines = readFileSync(join(sshDirectory, 'authorized_keys'), 'utf8')
        .trim()
        .split('\n');
      assert.equal(lines.length, 5);
      assert.equal(lines[0] + '\n', personalKey);
      for (const scope of ['infra', 'web', 'api', 'admin']) {
        assert.ok(
          lines.some(
            (line) =>
              line.startsWith(
                `restrict,command="${task.root}/bin/ssh-command ${scope}" ssh-ed25519 `
              ) && line.endsWith(`graduate-me-ci-${scope}`)
          )
        );
      }
    }
    const before = readFileSync(join(sshDirectory, 'authorized_keys'), 'utf8');
    writeFileSync(join(keys, 'admin.pub'), '잘못된 공개 키\n');
    const invalid = spawnSync('bash', [
      resolve('scripts/install-deploy-keys.sh'),
      task.root,
      keys,
      sshDirectory,
    ]);
    assert.notEqual(invalid.status, 0);
    assert.equal(
      readFileSync(join(sshDirectory, 'authorized_keys'), 'utf8'),
      before
    );
  } finally {
    task.close();
  }
});
