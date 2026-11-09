import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  COMPOSE_DISABLE_ENV_FILE: '1',
  AI_PROVIDER: '',
  MATERIAL_POLICY_PROFILE: '',
  OCR_PROVIDER: '',
  VIDEO_TRANSCRIPTION_PROVIDER: '',
  DB_PASSWORD: 'validation_only_password',
  AUTH_URL: 'https://app.example.test',
  AUTH_SECRET: 'validation_only_secret_0123456789',
  AUTH_GOOGLE_ID: 'validation_only_id',
  AUTH_GOOGLE_SECRET: 'validation_only_oauth_secret',
  GEMINI_API_KEY: 'validation_only_gemini_key',
  YOUTUBE_API_KEY: 'validation_only_youtube_key',
  GEMINI_MODEL: 'gemini-3.8-flash',
  ANTHROPIC_API_KEY: 'validation_only_anthropic_key',
  ANTHROPIC_MODEL: 'claude-sonnet-5-5',
  AI_ANTHROPIC_INPUT_USD_PER_MILLION: '5',
  AI_ANTHROPIC_OUTPUT_USD_PER_MILLION: '6',
  CLOVA_STUDIO_API_KEY: 'validation_only_clova_key',
  CLOVA_TEXT_MODEL: 'HCX-007',
  CLOVA_IMAGE_MODEL: 'HCX-005',
  CLOVA_STUDIO_BASE_URL: 'https://clovastudio.stream.ntruss.com',
  CLOVA_OCR_INVOKE_URL: 'https://validation.apigw.ntruss.com/general',
  CLOVA_OCR_SECRET_KEY: 'validation_only_ocr_key',
  OCR_ESTIMATED_USD_PER_PAGE: '0.002',
  AI_DAILY_REQUEST_LIMIT: '17',
  AI_DAILY_TOKEN_LIMIT: '45000',
  AI_CONCURRENT_REQUEST_LIMIT: '1',
  AI_PREPARATION_PAGE_LIMIT: '4',
  AI_DAILY_BUDGET_USD: '2',
  AI_NAVER_INPUT_USD_PER_MILLION: '1',
  AI_NAVER_OUTPUT_USD_PER_MILLION: '2',
  AI_GEMINI_INPUT_USD_PER_MILLION: '3',
  AI_GEMINI_OUTPUT_USD_PER_MILLION: '4',
  PRODUCTION_DOMAIN: 'app.example.test',
  DEVELOPMENT_API_DOMAIN: 'dev-api.example.test',
  API_IMAGE: 'example/api:validation',
  WEB_IMAGE: 'example/web:validation',
  ADMIN_IMAGE: 'example/admin:validation',
};

function config(files) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      ...files.flatMap((file) => ['-f', file]),
      'config',
      '--format',
      'json',
    ],
    { env, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const local = config(['compose.yaml', 'compose.local.yaml']);
assert.deepEqual(Object.keys(local.services).sort(), [
  'admin',
  'api',
  'db',
  'web',
  'worker',
]);
assert.equal(local.services.worker.depends_on.processor, undefined);
assert.equal(
  local.services.worker.environment.GEMINI_API_KEY,
  env.GEMINI_API_KEY
);
assert.equal(local.services.api.environment.GEMINI_API_KEY, undefined);
assert.equal(local.services.web.environment.GEMINI_API_KEY, undefined);

assert.equal(
  local.services.admin.environment.API_INTERNAL_URL,
  'http://api:4000'
);
assert.equal(local.services.admin.environment.GEMINI_API_KEY, undefined);
assert.equal(local.services.admin.depends_on.api.condition, 'service_healthy');
assert.equal(local.services.admin.ports[0].host_ip, '127.0.0.1');
assert.equal(local.services.admin.ports[0].published, '3001');
assert.equal(local.services.admin.ports[0].target, 3001);
assert.equal(
  local.services.api.environment.ADMIN_URL,
  `http://localhost:${env.ADMIN_PORT || '3001'}`
);
assert.equal(
  local.services.web.environment.ADMIN_APP_URL,
  local.services.api.environment.ADMIN_URL
);
assert.equal(local.services.admin.build.dockerfile, 'Dockerfile.dev');
assert.ok(
  local.services.admin.develop.watch.some(
    (entry) =>
      entry.path.endsWith('graduate-me-admin/vite.config.ts') &&
      entry.action === 'sync+restart'
  )
);
assert.deepEqual(local.services.api.command, [
  'sh',
  '-c',
  'pnpm db:migrate && pnpm dev:app',
]);
const deployScript = readFileSync('scripts/deploy.sh', 'utf8');
assert.equal(deployScript.includes('db:seed'), false);
assert.equal(deployScript.includes('seed-demo'), false);

const stages = ['development', 'production'];
const deployments = stages.map((stage) => config([`compose.${stage}.yaml`]));
for (const [index, app] of deployments.entries()) {
  const stage = stages[index];
  assert.equal(app.name, `graduate-me-${stage}`);
  assert.equal(Boolean(app.services.web), stage === 'production');
  assert.equal(app.services.db.environment.POSTGRES_DB, `graduate_me_${stage}`);
  assert.equal(app.networks.database.internal, true);
  assert.deepEqual(app.services.db.networks, { database: null });
  for (const service of Object.values(app.services)) {
    assert.equal(service.build, undefined, '홈서버에서는 이미지만 실행합니다.');
    assert.equal(
      service.develop,
      undefined,
      '홈서버에서 소스를 동기화하지 않습니다.'
    );
    assert.equal(service.ports, undefined, '외부 연결은 gateway만 담당합니다.');
    assert.equal(
      service.volumes?.some((volume) => volume.type === 'bind') ?? false,
      false
    );
  }
}
assert.notEqual(
  deployments[0].volumes.postgres_data.name,
  deployments[1].volumes.postgres_data.name
);
assert.notEqual(
  deployments[0].networks.database.name,
  deployments[1].networks.database.name
);
// 공급자 키와 한도는 서버에만 주입하며 브라우저 앱의 환경으로 복제하지 않는다.
for (const app of [local, ...deployments]) {
  for (const name of ['api', 'worker']) {
    for (const key of Object.keys(env).filter(
      (key) =>
        (key.startsWith('CLOVA_') && !key.startsWith('CLOVA_OCR_')) ||
        (key.startsWith('AI_') && key !== 'AI_PROVIDER') ||
        key.startsWith('ANTHROPIC_')
    )) {
      assert.equal(app.services[name].environment[key], env[key]);
    }
  }
  for (const key of [
    'CLOVA_OCR_INVOKE_URL',
    'CLOVA_OCR_SECRET_KEY',
    'OCR_ESTIMATED_USD_PER_PAGE',
  ]) {
    assert.equal(app.services.api.environment[key], env[key]);
    assert.equal(app.services.worker.environment[key], undefined);
  }
  for (const name of ['web', 'admin']) {
    if (!app.services[name]) continue;
    for (const key of Object.keys(app.services[name].environment)) {
      assert.equal(
        /^(CLOVA_|OCR_|AI_|ANTHROPIC_|MATERIAL_POLICY_PROFILE|VIDEO_TRANSCRIPTION_PROVIDER|GEMINI_API_KEY|YOUTUBE_API_KEY)/.test(
          key
        ),
        false
      );
    }
  }
}
// 개발 기본값과 운영 기본값을 분리하며 공급자 선택도 환경설정으로 교체한다.
for (const [index, app] of [local, ...deployments].entries()) {
  const production = index === 2;
  for (const name of ['api', 'worker']) {
    assert.equal(
      app.services[name].environment.MATERIAL_POLICY_PROFILE,
      production ? 'standard' : 'mvp'
    );
    assert.equal(
      app.services[name].environment.AI_PROVIDER,
      production ? 'naver' : 'anthropic'
    );
    assert.equal(
      app.services[name].environment.VIDEO_TRANSCRIPTION_PROVIDER,
      production ? 'gemini' : 'disabled'
    );
  }
  assert.equal(
    app.services.api.environment.OCR_PROVIDER,
    production ? 'clova' : 'anthropic'
  );
  assert.equal(app.services.worker.environment.OCR_PROVIDER, undefined);
}
const shared = config(['compose.shared.yaml']);
assert.equal(shared.services.gateway.ports.length, 1);
assert.equal(shared.services.gateway.ports[0].host_ip, '127.0.0.1');
assert.equal(shared.services.gateway.ports[0].published, '8080');
assert.equal(shared.services.gateway.ports[0].target, 80);
const caddyfile = readFileSync('Caddyfile', 'utf8');
assert.ok(caddyfile.includes('http://{$PRODUCTION_DOMAIN}'));
assert.ok(caddyfile.includes('http://{$DEVELOPMENT_API_DOMAIN}'));
assert.equal(caddyfile.match(/header_up X-Forwarded-Proto https/g)?.length, 4);
assert.ok(caddyfile.includes('reverse_proxy production-admin:3001'));
assert.ok(deployScript.includes('--without-worker'));
assert.equal(deployments[1].services.admin.image, env.ADMIN_IMAGE);
assert.equal(
  deployments[1].services.admin.environment.API_INTERNAL_URL,
  'http://production-api:4000'
);
assert.deepEqual(Object.keys(shared.services), ['gateway']);
for (const [index, app] of deployments.entries()) {
  const stage = stages[index];

  assert.equal(app.services.processor, undefined);
  assert.equal(app.networks.processing, undefined);
  assert.equal(app.networks.egress.internal ?? false, false);
  assert.deepEqual(app.services.worker.networks, {
    database: null,
    egress: null,
  });
  assert.equal(
    app.services.worker.environment.GEMINI_API_KEY,
    env.GEMINI_API_KEY
  );
  assert.equal(
    app.services.worker.environment.YOUTUBE_API_KEY,
    env.YOUTUBE_API_KEY
  );
  assert.equal(app.services.api.environment.GEMINI_API_KEY, undefined);
  assert.equal(
    shared.networks[`${stage}-edge`].name,
    `graduate-me-${stage}-edge`
  );
}

for (const file of readdirSync('scripts').filter((name) =>
  name.endsWith('.sh')
)) {
  const result = spawnSync('bash', ['-n', `scripts/${file}`], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}
for (const file of [
  '.env.example',
  ...readdirSync('env')
    .filter((name) => name.endsWith('.example'))
    .map((name) => `env/${name}`),
]) {
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    if (
      /^(DB_PASSWORD|AUTH_SECRET|AUTH_GOOGLE_SECRET|GEMINI_API_KEY|YOUTUBE_API_KEY|CLOVA_STUDIO_API_KEY|CLOVA_OCR_INVOKE_URL|CLOVA_OCR_SECRET_KEY)=/.test(
        line
      )
    ) {
      assert.equal(
        line.split('=').slice(1).join(''),
        '',
        '예시 파일에는 실제 비밀값을 넣지 않습니다.'
      );
    }
  }
}
console.log(
  'Compose 구성, 개발·운영 격리, 공개 포트, 환경변수 예시 검사를 통과했습니다.'
);
