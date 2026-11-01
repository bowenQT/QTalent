#!/usr/bin/env python3
"""Official media supply smoke; synthetic input only, no app/DB/vendor environment."""
import json, math, os, pathlib, re, stat, struct, subprocess, tempfile, wave
FFMPEG = pathlib.Path(os.environ.get('QTALENT_TEST_FFMPEG_PATH', '/usr/bin/ffmpeg'))
FFPROBE = pathlib.Path(os.environ.get('QTALENT_TEST_FFPROBE_PATH', '/usr/bin/ffprobe'))
ENV = {'LANG': 'C', 'LC_ALL': 'C', 'AV_LOG_FORCE_NOCOLOR': '1'}

def run(args, source=None):
    if source is None:
        result = subprocess.run([str(x) for x in args], stdin=subprocess.DEVNULL,
                                capture_output=True, env=ENV, timeout=15)
    else:
        with source.open('rb') as f:
            result = subprocess.run([str(x) for x in args], stdin=f,
                                    capture_output=True, env=ENV, timeout=15)
    if result.returncode:
        raise RuntimeError('native command failed: ' + pathlib.Path(args[0]).name + ': ' + result.stderr.decode()[:400])
    return result

def trusted(path):
    assert path.is_absolute() and path.is_file() and os.access(path, os.X_OK)
    for item in [path.resolve(), *path.resolve().parents]:
        st = item.stat()
        assert st.st_uid == 0 and not st.st_mode & 0o022, 'untrusted executable path'

for binary in [FFMPEG, FFPROBE]: trusted(binary)
versions = [run([b, '-version']).stdout.decode().splitlines()[0].split()[2] for b in [FFMPEG, FFPROBE]]
assert versions[0] == versions[1] and versions[0].startswith('6.1.1-'), 'unexpected binary tuple'
for binary in [FFMPEG, FFPROBE]:
    protocols = run([binary, '-v', 'error', '-protocols']).stdout.decode().splitlines()
    assert 'fd' in [x.strip() for x in protocols], 'missing fd protocol'
    assert 'pipe' in [x.strip() for x in protocols]
    assert '-fd' in run([binary, '-hide_banner', '-h', 'protocol=fd']).stdout.decode()
capabilities = {}
for kind, needed in [('demuxers', ['wav','mp3','aac','mov']), ('encoders', ['pcm_s16le','libmp3lame','aac','mpeg4']), ('filters', ['aresample','asetpts','color']), ('devices', ['lavfi'])]:
    listing = run([FFMPEG, '-v', 'error', '-'+kind]).stdout.decode()
    for feature in needed:
        assert re.search(r'\b'+feature+r'\b', listing), 'missing '+feature
    capabilities[kind] = needed
input_args = ['-threads','1','-max_alloc','33554432','-probesize','1048576','-analyzeduration','5000000','-protocol_whitelist','fd','-format_whitelist','wav,mp3,aac,mov','-fd','0']
base = [FFMPEG,'-nostdin','-hide_banner','-v','error','-threads','1','-filter_threads','1']
results=[]
with tempfile.TemporaryDirectory(prefix='qtalent-synthetic-media-') as folder:
    directory=pathlib.Path(folder); os.chmod(directory,0o700)
    wav=directory/'tone.wav'
    with wave.open(str(wav),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000)
        f.writeframes(b''.join(struct.pack('<h',round(4000*math.sin(i/10))) for i in range(1600)))
    os.chmod(wav,0o600)
    samples=[('wav',wav)]
    for extension,codec in [('mp3','libmp3lame'),('m4a','aac'),('aac','aac')]:
        output=directory/('tone.'+extension)
        run(base+['-i',wav,'-c:a',codec,'-y',output]);os.chmod(output,0o600)
        samples.append((extension,output))
    for duration in [1,2]:
        output=directory/('video-'+str(duration)+'.mp4')
        run(base+['-f','lavfi','-i','color=c=black:s=16x16:r=10:d='+str(duration),'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','mpeg4','-threads','1','-c:a','aac','-y',output])
        os.chmod(output,0o600);samples.append(('mp4-'+str(duration),output))
    for kind,path in samples:
        probe=run([FFPROBE,'-v','error',*input_args,'-show_entries','stream=index,codec_type,codec_name,sample_rate,channels:stream_disposition=attached_pic:format=format_name,size:format_tags=major_brand','-of','json','-i','fd:'],path)
        assert not probe.stderr
        metadata=json.loads(probe.stdout);audio=[s for s in metadata['streams'] if s['codec_type']=='audio']
        assert len(audio)==1 and int(metadata['format']['size'])==path.stat().st_size
        video=[s for s in metadata['streams'] if s['codec_type']=='video']
        assert len(video)==(1 if kind.startswith('mp4') else 0)
        decoded=run([FFMPEG,'-nostdin','-hide_banner','-v','error','-xerror','-max_error_rate','0','-threads','1','-filter_threads','1','-err_detect','explode',*input_args,'-vn','-sn','-dn','-i','fd:','-map','0:'+str(audio[0]['index']),'-vn','-sn','-dn','-af','aresample=16000,asetpts=N/SR/TB','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','s16le','pipe:1'],path)
        assert not decoded.stderr and len(decoded.stdout)%2==0
        duration_ms=math.ceil(len(decoded.stdout)/32)
        assert duration_ms==100 if kind=='wav' else 100<=duration_ms<=228
        results.append({'format':kind,'decoded_samples':len(decoded.stdout)//2,'duration_ms':duration_ms,'fd_seekable_size_verified':True})
    assert results[-1]['decoded_samples']==results[-2]['decoded_samples']
print(json.dumps({'status':'passed','upstream':'6.1.1','pair_versions_equal':True,'fd_actual_input':True,'capabilities':capabilities,'synthetic_results':results,'video_duration_does_not_define_audio_duration':True,'temporary_files_removed':True,'credentials_in_native_environment':False}))
