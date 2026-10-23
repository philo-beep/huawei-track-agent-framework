"""Generate neural narration and real speech boundary timing. No customer input is sent."""
import asyncio, json, os, pathlib, subprocess, re
import edge_tts
import imageio_ffmpeg

HERE = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(os.environ.get('DEMO_MEDIA_DIR', str(pathlib.Path.home()/'Desktop'/'华销智策-demo制作素材-20261023')))
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def duration(file):
    r = subprocess.run([FFMPEG, '-i', str(file)], capture_output=True)
    m = re.search(rb'Duration: (\d+):(\d+):(\d+\.\d+)',r.stderr)
    if not m: raise RuntimeError(f'No duration: {file}')
    h,m,s=map(float,m.groups());return h*3600+m*60+s

async def render(scene, sem):
    async with sem:
        audio = OUT/'voice'/f"{scene['id']}.mp3"
        timing = audio.with_suffix('.json')
        if not (audio.exists() and timing.exists()):
            for attempt in range(3):
                try:
                    cues=[]
                    tts=edge_tts.Communicate(scene['narration'],'zh-CN-XiaoxiaoNeural',rate='+3%',pitch='-1Hz',boundary='WordBoundary')
                    with audio.open('wb') as f:
                        async for msg in tts.stream():
                            if msg['type']=='audio':f.write(msg['data'])
                            elif msg['type']=='WordBoundary':cues.append({k:msg[k] for k in ['offset','duration','text']})
                    timing.write_text(json.dumps(cues,ensure_ascii=False,indent=2),encoding='utf-8')
                    break
                except Exception:
                    if attempt==2:raise
                    await asyncio.sleep(1+attempt)
        scene['audio_duration']=duration(audio)
        scene['duration']=max(scene['min'],scene['audio_duration']+1.4)
        print(scene['id'],round(scene['duration'],2),flush=True)

async def main():
    (OUT/'voice').mkdir(parents=True,exist_ok=True)
    scenes=json.loads((HERE/'scenes.json').read_text(encoding='utf-8'))
    sem=asyncio.Semaphore(3)
    await asyncio.gather(*(render(s,sem) for s in scenes))
    (OUT/'scenes-timed.json').write_text(json.dumps(scenes,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Total minimum seconds:',sum(s['duration'] for s in scenes),flush=True)

if __name__=='__main__':asyncio.run(main())
