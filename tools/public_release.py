import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXACT = {
    '.gitignore', '.dockerignore', 'AGENTS.md', 'agent.md', 'README.md',
    'Dockerfile', 'requirements.txt', 'requirements-publish.txt', 'requirements-cloud.txt',
    'app.py', 'main.js', 'fourstep.js', 'install_workspace.py',
    '启动网页助手.cmd', '启动网页助手.ps1', '网页使用入口.md',
    '交付与后续计划.md', 'SUBMISSION.md', 'ITERATIONS.md',
    'data/build_local_index.py', 'data/fetch_official.py', 'data/import_official.py', 'data/README.md',
    'data/official/manifest.json', 'data/official/source-policy.json',
    'docs/architecture.md', 'docs/protocol.md', 'docs/deployment.md',
    'docs/platform-status.md', 'docs/data/local-kb-interface.md',
    'docs/data/local-kb-quality.md', 'docs/data/官网数据来源说明.md',
    'docs/data/安全更新官网资料.md',
    'outputs/B/价格政策来源与假设清单.md',
    'docs/product/华为销售顾问产品使用说明书.md',
    'docs/product/黑客松提交清单.md',
    'tools/public_release.py', 'tools/publish_modelscope.py',
    'tools/team_workspace.py', 'framework/team-layout.json', 'framework/test_team_workspace.py',
    'modules/README.md', 'modules/AGENTS.md',
    '协作工作区/目录预览说明.md', '协作工作区/协作开发与合并说明.md',
    '协作工作区/00_主控协调/分工与文件归属.md',
    '协作工作区/共享规范/接口草案/交接约定.md',
}
for module_name in ('customer', 'evidence', 'strategy', 'writing', 'quality'):
    EXACT.add(f'modules/{module_name}/README.md')
    for module_directory in ('src', 'prompts', 'tests', 'fixtures', 'docs'):
        EXACT.add(f'modules/{module_name}/{module_directory}/.gitkeep')
PATTERNS = (
    'agents/*.md', 'framework/*.py', 'schemas/*.json', 'templates/*.json',
    'templates/*.md', 'backend/studio/*.py', 'backend/marketing/*.js',
    'backend/marketing/*.py', 'backend/marketing/demo/*.json',
    'frontend/growth/*.html', 'frontend/growth/*.js', 'frontend/growth/*.css',
    'frontend/cloud/*.html', 'frontend/cloud/*.js', 'frontend/cloud/*.css',
    'contracts/*.schema.json', 'data/official/raw/*.html', 'data/official/raw/*.txt',
    'docs/api/*.md', 'docs/backend/*.md', 'docs/ui/*.md',
    'tests/test_runtime.py', 'tests/test_studio.py', 'tests/__init__.py',
    'tests/verify_examples.py',
)
SECRET = re.compile(
    rb'ms-[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}|'
    rb'gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|'
    rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|'
    rb'(?:AKIA|ASIA)[A-Z0-9]{16}|'
    rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')


def public_files(root=ROOT):
    selected = {root / relative for relative in EXACT if (root / relative).is_file()}
    for pattern in PATTERNS:
        selected.update(root.glob(pattern))
    for path in sorted(selected):
        relative = path.relative_to(root)
        if not path.is_file() or path.is_symlink():
            raise ValueError('公开候选必须是普通文件: ' + relative.as_posix())
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink():
                raise ValueError('公开候选父路径不能是符号链接')
        content = path.read_bytes()
        if len(content) > 8 * 1024 * 1024:
            raise ValueError('公开候选文件超过8MiB: ' + relative.as_posix())
        if SECRET.search(content):
            raise ValueError('公开候选疑似含凭据: ' + relative.as_posix())
        yield path, relative


def manifest():
    return {relative.as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path, relative in public_files()}


if __name__ == '__main__':
    destination = ROOT / '.collaboration' / 'public-candidate.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    files = manifest()
    destination.write_text(json.dumps({'files': files}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'files': len(files), 'manifest': str(destination)}, ensure_ascii=False))
