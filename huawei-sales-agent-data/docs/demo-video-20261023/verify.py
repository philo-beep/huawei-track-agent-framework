"""Decode the entire delivery, inspect audio, and export representative final frames."""
import pathlib,os,json,subprocess,re,hashlib
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg

OUT=pathlib.Path(os.environ.get('DEMO_MEDIA_DIR',str(pathlib.Path.home()/'Desktop'/'华销智策-demo制作素材-20261023')))
FINAL=pathlib.Path.home()/'Desktop'/'华销智策-个人购机销售演示.mp4'
FF=imageio_ffmpeg.get_ffmpeg_exe()

def main():
    info=subprocess.run([FF,'-hide_banner','-i',str(FINAL)],capture_output=True).stderr.decode('utf-8','replace')
    assert '1920x1080' in info and 'h264' in info and 'aac' in info,info
    decode=subprocess.run([FF,'-v','error','-i',str(FINAL),'-f','null','-'],capture_output=True)
    assert decode.returncode==0 and not decode.stderr,decode.stderr
    audio=subprocess.run([FF,'-hide_banner','-i',str(FINAL),'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True)
    txt=audio.stderr.decode('utf-8','replace')
    match=re.findall(r'\{\s*"input_i"[\s\S]+?\}',txt)
    levels=json.loads(match[-1])
    assert -19<float(levels['input_i'])<-13,levels
    assert float(levels['input_tp'])<0,levels
    timeline=json.loads((OUT/'timeline.json').read_text(encoding='utf-8'))
    images=json.loads((OUT/'image-evidence.json').read_text(encoding='utf-8'))
    assert len(timeline['scenes'])==25 and len(images)==8
    assert all(x['visible'] and x['width']>0 for x in images)
    assert not timeline['errors']
    selected=[('welcome',5),('login',5),('round4',8),('profile',6),('evidence',8),('xhs1',10),('xhs2',10),('wechat',11),('moments',8),('verification',8),('quote',8),('actions',9)]
    frames=OUT/'final-frames';frames.mkdir(exist_ok=True)
    tiles=[];font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',18)
    for identifier,offset in selected:
        s=next(x for x in timeline['scenes'] if x['id']==identifier)
        dest=frames/(identifier+'.png')
        subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(s['start']+offset),'-i',str(FINAL),'-frames:v','1',str(dest)],check=True,capture_output=True)
        img=Image.open(dest).convert('RGB');img.thumbnail((640,360))
        tile=Image.new('RGB',(640,395),'#101827');tile.paste(img,(0,0))
        d=ImageDraw.Draw(tile);d.text((15,366),s['chapter'],font=font,fill='white');tiles.append(tile)
    sheet=Image.new('RGB',(1920,1580),'#101827')
    for i,tile in enumerate(tiles):sheet.paste(tile,((i%3)*640,(i//3)*395))
    sheet.save(OUT/'final-contact-sheet.jpg',quality=94)
    report={'full_decode':'passed; video and audio decoded without errors','audio_loudness_lufs':float(levels['input_i']),'audio_true_peak_dbtp':float(levels['input_tp']),'duration_seconds':timeline['scenes'][-1]['end'],'all_8_inline_images_fully_visible':True,'browser_errors':timeline['errors'],'file_bytes':FINAL.stat().st_size,'sha256':hashlib.file_digest(FINAL.open('rb'),'sha256').hexdigest(),'sampled_final_frames':len(tiles)}
    (OUT/'qa-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False),flush=True)

if __name__=='__main__':main()
