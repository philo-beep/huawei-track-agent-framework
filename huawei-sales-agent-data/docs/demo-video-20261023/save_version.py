"""Save only Role E delivery files to a separate local Git branch, preserving HEAD and index."""
import os,pathlib,json,subprocess,hashlib,tempfile

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
OUT=pathlib.Path(os.environ.get('DEMO_MEDIA_DIR',str(pathlib.Path.home()/'Desktop'/'华销智策-demo制作素材-20261023')))
BRANCH='codex/demo-video-personal-20261023'

def git(*args,env=None):
    return subprocess.check_output(['git',*args],cwd=ROOT,env=env).decode('utf-8').strip()

def main():
    head=git('rev-parse','HEAD')
    index=pathlib.Path(git('rev-parse','--git-path','index'))
    if not index.is_absolute():index=ROOT/index
    index_before=hashlib.sha256(index.read_bytes()).hexdigest()
    temp_index=OUT/'delivery-temporary.index'
    if temp_index.exists():raise RuntimeError('Temporary index already exists')
    env={**os.environ,'GIT_INDEX_FILE':str(temp_index)}
    scope=HERE.relative_to(ROOT).as_posix()
    try:
        git('read-tree',head,env=env)
        git('add','--',scope,env=env)
        changed=git('diff','--cached','--name-only','-z',env=env).split('\0')
        changed=[x for x in changed if x]
        if not changed or any(not x.startswith(scope+'/') for x in changed):raise RuntimeError('Unexpected staged scope')
        tree=git('write-tree',env=env)
        commit=git('commit-tree',tree,'-p',head,'-m','docs(demo): deliver personal single-device sales video and reproducible recording')
        git('update-ref','refs/heads/'+BRANCH,commit,'0'*40)
    finally:
        temp_index.unlink(missing_ok=True)
    assert git('rev-parse','HEAD')==head
    assert hashlib.sha256(index.read_bytes()).hexdigest()==index_before
    result={'branch':BRANCH,'commit':commit,'base_commit':head,'saved_files':changed,'working_head_and_index_preserved':True}
    (OUT/'version-control.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
