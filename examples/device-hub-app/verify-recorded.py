#!/usr/bin/env python3
"""Verify the portable recorded native evidence without installing dependencies."""
import hashlib, json, pathlib, struct, zipfile
root=pathlib.Path(__file__).resolve().parent/'recorded-run'
read=lambda p: json.loads(p.read_text())
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest=read(root/'SHA256SUMS.json')
for item in manifest:
    p=root/item['path']
    assert p.is_relative_to(root) and p.is_file(), item['path']
    assert p.stat().st_size==item['bytes'] and sha(p)==item['sha256'], item['path']
for phase in ['before','after']:
    m=read(root/'builds'/f'{phase}-manifest.json')
    assert sha(root/'source'/phase/'TrailNotes.swift')==m['sourceSha256']
    with zipfile.ZipFile(root/m['artifact']) as z:
        assert hashlib.sha256(z.read('TrailNotes.app/TrailNotes')).hexdigest()==m['executableSha256']
        assert 'TrailNotes.app/Info.plist' in z.namelist()
data=read(root/'review.json')
assert data['summary']=={'total':8,'aiPass':8,'finalAIPass':True,'humanPass':0}
assert len(data['cells'])==8
for cell in data['cells']:
    assert cell['status']=='pass' and not cell['blockers']
    assert cell['capture']['buildId']=='demo-after'
    assert cell['currentAIReview']['captureId']==cell['capture']['id']
    assert not cell['humanReviews'] and cell['currentHumanReview'] is None
    for capture in cell['captures']:
        for asset in capture['assets']:
            p=root/asset['path']
            assert sha(p)==asset['sha256'], asset['id']
            if asset['kind']!='video':
                b=p.read_bytes()
                assert b[:8]==bytes.fromhex('89504e470d0a1a0a')
                assert struct.unpack('>II',b[16:24])==(asset['width'],asset['height'])
    capture=cell['capture']
    for asset in capture['assets']:
        if asset['kind']!='video':
            assert any(o['assetId']==asset['id'] and o['sha256']==asset['sha256'] and o['detail'] for o in cell['currentAIReview']['observations'])
    if cell['stateId']=='ready':
        assert any(r['verdict']=='fail' and r['stale'] and r['buildId']=='demo-before' for r in cell['aiReviews'])
    if cell['stateId']=='download':
        frames=[a for a in capture['assets'] if a['kind']=='frame']
        assert len(frames)==5 and frames[0]['offsetMs']==0
        assert all(frames[i]['offsetMs']<frames[i+1]['offsetMs'] for i in range(len(frames)-1))
        movie=next(a for a in capture['assets'] if a['kind']=='video')
        assert movie['durationMs']>0 and movie['nominalFrameRate']>0
        assert 'smoothness' in cell['currentAIReview']['comment']
print(f'OK: {len(manifest)} portable files, both native builds/sources, 8 current cells, all original asset hashes/dimensions, stale before failures, ordered real frames, humanPass=0')
