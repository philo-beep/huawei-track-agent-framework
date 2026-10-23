"""Compose the recorded browser, neural narration, bilingual-safe Chinese captions, and chapters."""
import os, pathlib, json, subprocess, re, wave, html, hashlib, datetime
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

HERE=pathlib.Path(__file__).resolve().parent
DESKTOP=pathlib.Path.home()/'Desktop'
OUT=pathlib.Path(os.environ.get('DEMO_MEDIA_DIR',str(DESKTOP/'华销智策-demo制作素材-20261023')))
FINAL=DESKTOP/'华销智策-个人购机销售演示.mp4'
FF=imageio_ffmpeg.get_ffmpeg_exe()

def run(args,**kwargs):
    return subprocess.run([FF,'-hide_banner','-y',*map(str,args)],check=True,**kwargs)

def stamp(t,ass=False):
    if ass:
        n=round(t*100);h,n=divmod(n,360000);m,n=divmod(n,6000);s,c=divmod(n,100)
        return f'{h}:{m:02}:{s:02}.{c:02}'
    n=round(t*1000);h,n=divmod(n,3600000);m,n=divmod(n,60000);s,ms=divmod(n,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

def subtitle_chunks(scene):
    words=json.loads((OUT/'voice'/f"{scene['id']}.json").read_text(encoding='utf-8'))
    text=scene['narration'];cursor=0;buf='';first=None;last=0;result=[]
    for i,w in enumerate(words):
        token=html.unescape(w['text'])
        pos=text.find(token,cursor)
        if pos<0:pos=cursor
        token_end=pos+len(token)
        next_pos=token_end
        while next_pos<len(text) and text[next_pos] in '，。！？；：、,.!?;: ':next_pos+=1
        part=text[cursor:next_pos]
        cursor=next_pos
        if first is None:first=w['offset']/1e7
        buf+=part
        last=(w['offset']+w['duration'])/1e7
        if (len(buf)>=9 and re.search('[，。！？；]$',buf)) or len(buf)>=24 or i==len(words)-1:
            result.append((scene['start']+.5+first,scene['start']+.5+last+.16,buf.strip()))
            first=None;buf=''
    return result

def main():
    data=json.loads((OUT/'timeline.json').read_text(encoding='utf-8'))
    scenes=data['scenes']
    if len(scenes)!=25 or scenes[-1]['id']!='closing':raise RuntimeError('Recording has not finished all scenes')
    total=scenes[-1]['end']
    sample_rate=48000
    pcm=bytearray(round(total*sample_rate)*2)
    captions=[]
    for scene in scenes:
        wavfile=OUT/'voice'/f"{scene['id']}.wav"
        run(['-loglevel','error','-i',OUT/'voice'/f"{scene['id']}.mp3",'-ac','1','-ar',sample_rate,'-c:a','pcm_s16le',wavfile],capture_output=True)
        with wave.open(str(wavfile),'rb') as w:audio=w.readframes(w.getnframes())
        offset=round((scene['start']+.5)*sample_rate)*2
        pcm[offset:offset+len(audio)]=audio
        captions.extend(subtitle_chunks(scene))
    with wave.open(str(OUT/'narration.wav'),'wb') as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(sample_rate);w.writeframes(pcm)
    srt='\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{text}' for i,(a,b,text) in enumerate(captions))+'\n'
    (OUT/'subtitles.srt').write_text(srt,encoding='utf-8-sig')
    (DESKTOP/'华销智策-个人购机销售演示.srt').write_text(srt,encoding='utf-8-sig')
    ass='''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Brand,Microsoft YaHei,26,&H00FFFFFF,&H00FFFFFF,&H00101827,&H00101827,1,0,0,0,100,100,0,0,1,0,0,5,25,25,15,1
Style: Small,Microsoft YaHei,18,&H00ABB9CF,&H00ABB9CF,&H00101827,&H00101827,0,0,0,0,100,100,0,0,1,0,0,5,25,25,15,1
Style: Chapter,Microsoft YaHei,25,&H00FFFFFF,&H00FFFFFF,&H00101827,&H00101827,0,0,0,0,100,100,0,0,1,0,0,6,25,25,15,1
Style: Value,Microsoft YaHei,23,&H00BECBE0,&H00BECBE0,&H00101827,&H00101827,0,0,0,0,100,100,0,0,1,0,0,5,25,25,15,1
Style: Caption,Microsoft YaHei,33,&H00FFFFFF,&H00FFFFFF,&H00101827,&H00101827,0,0,0,0,100,100,0,0,1,0,0,5,25,25,15,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
'''
    def event(a,b,style,text,pos,layer=1):
        return f'Dialogue: {layer},{stamp(a,True)},{stamp(b,True)},{style},,0,0,0,,{{\\pos({pos[0]},{pos[1]})}}{text}\n'
    ass+=event(0,total,'Brand','华销智策  |  个人单台购机',(248,31))
    ass+=event(0,total,'Small','预置个人样例 · 真实界面操作',(670,32))
    for s in scenes:
        ass+=event(s['start'],s['end'],'Chapter',s['chapter'],(1880,31))
        ass+=event(s['start'],s['end'],'Value',s['value'],(960,1002))
    for a,b,t in captions:ass+=event(a,min(b,total),'Caption',t,(960,1047),2)
    (OUT/'subtitles.ass').write_text(ass,encoding='utf-8-sig')
    meta=';FFMETADATA1\ntitle=华销智策 · 个人购机销售演示\ncomment=真实浏览器录制；合成个人样例与保存的资料快照；自然中文神经语音，非真人录音。\n'
    for s in scenes:meta+=f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(s['start']*1000)}\nEND={round(s['end']*1000)}\ntitle={s['chapter']}\n"
    (OUT/'chapters.ffmeta').write_text(meta,encoding='utf-8')
    raw=pathlib.Path((OUT/'raw-video-path.txt').read_text(encoding='utf-8').strip())
    filterv='scale=1920:912:flags=lanczos,pad=1920:1080:0:64:color=0x101827,ass=subtitles.ass'
    print('Encoding',round(total,2),'seconds ->',FINAL,flush=True)
    with (OUT/'encoding.log').open('wb') as log:
        run(['-ss',data['raw_start'],'-i',raw,'-i','narration.wav','-i','chapters.ffmeta','-map','0:v:0','-map','1:a:0','-map_metadata','2','-map_chapters','2','-vf',filterv,'-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-t',total,'-movflags','+faststart',FINAL],cwd=OUT,stdout=log,stderr=log)
    flow=['# 华销智策：个人单台购机演示脚本','',f'- 成片：{FINAL}',f'- 时长：{total/60:.2f} 分钟；1920×1080；H.264 / AAC。','- 场景：个人自由职业创作者购买 1 台自用笔记本；预算未定。','- 录制：实际浏览器登录、输入、点击、滚动和下载；六轮问答及后续业务结果读取产品自带预置，不冒充本次云端生成。','- 配图：小红书 3 张、公众号 4 张、朋友圈 1 张，均在正文中逐张展示，为原创场景示意图，非产品实拍。','- 声音：晓晓中文神经语音，语速 +3%，自然停顿；属于语音合成，非真人录音。','- 资料：沿用版本化资料快照；价格、软件兼容性和图片许可按页面标识处理；个人样例不进行五台企业报价。','', '| 起止时间 | 页面与价值点 | 讲解 |','| --- | --- | --- |']
    for s in scenes:flow.append(f"| {stamp(s['start'])[:-4]}—{stamp(s['end'])[:-4]} | {s['chapter']}；{s['value']} | {s['narration']} |")
    flow+=['','## 复核记录','',f"- 真实浏览器场景：{len(scenes)} 段。",f"- 正文图片检查：{len(json.loads((OUT/'image-evidence.json').read_text(encoding='utf-8')))} 张，逐张解码并检查在视口内完整可见。",f"- 浏览器脚本错误：{len(data['errors'])}。",f"- 下载记录：{json.dumps(data['downloads'],ensure_ascii=False)}。",'- 登录账号保存在本次隔离的临时认证库，不使用真实客户或生产凭据。','- 未执行真实联系、发布、下单或成交；报价与成交部分展示销售准备和待确认事项。']
    script='\n'.join(flow)+'\n'
    (DESKTOP/'华销智策-个人购机视频脚本.md').write_text(script,encoding='utf-8-sig')
    (HERE/'展示脚本.md').write_text(script,encoding='utf-8')
    report={'file':str(FINAL),'bytes':FINAL.stat().st_size,'duration_seconds':round(total,3),'sha256':hashlib.file_digest(FINAL.open('rb'),'sha256').hexdigest(),'resolution':'1920x1080','fps':30,'video_codec':'H.264','audio_codec':'AAC','scene_count':len(scenes),'image_count':8,'browser_errors':data['errors'],'narration':'zh-CN-XiaoxiaoNeural; synthetic voice; rate +3%; pitch -1Hz'}
    (OUT/'delivery-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
