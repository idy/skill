#!/usr/bin/env python3
"""Verify original/current native evidence, timelines and preserved history."""
import datetime, hashlib, json, pathlib, struct, zipfile
root=pathlib.Path(__file__).resolve().parent/'recorded-run'
read=lambda p: json.loads(p.read_text())
sha=lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
ms=lambda s: round(datetime.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
manifest=read(root/'SHA256SUMS.json')
for item in manifest:
    p=(root/item['path']).resolve()
    assert p.is_relative_to(root.resolve()) and p.is_file(), item['path']
    assert p.stat().st_size==item['bytes'] and sha(p)==item['sha256'], item['path']
for phase in ['before','after']:
    m=read(root/'builds'/f'{phase}-manifest.json')
    assert sha(root/'source'/phase/'TrailNotes.swift')==m['sourceSha256']
    with zipfile.ZipFile(root/m['artifact']) as z:
        assert hashlib.sha256(z.read('TrailNotes.app/TrailNotes')).hexdigest()==m['executableSha256']
        assert 'TrailNotes.app/Info.plist' in z.namelist()
archive=root/'history/demo-spec-1-at-2e99c038.zip'
assert sha(archive)=='50dd25649f59306c05d4d61c2c735e863a7167057b81b9a160e3416bd0ba8f9c'
with zipfile.ZipFile(archive) as z:
    old=json.loads(z.read('review.json'))
    assert old['target']['specRev']=='demo-spec-1'
    for item in json.loads(z.read('SHA256SUMS.json')):
        b=z.read(item['path'])
        assert len(b)==item['bytes'] and hashlib.sha256(b).hexdigest()==item['sha256']
        if item['path'].startswith('evidence/'):
            assert sha(root/item['path'])==item['sha256'], 'Original media changed'
data=read(root/'review.json')
assert data['reviewProtocol']=='visual-acceptance-2'
assert data['target']=={'buildId':'demo-after','runtimeId':'demo-after-runtime-v2','specRev':'demo-spec-2'}
assert data['summary']=={'total':8,'aiPass':8,'finalAIPass':True,'humanPass':0}
assert len(data['cells'])==8
blocked=[]
for cell in data['cells']:
    assert cell['status']=='pass' and not cell['blockers']
    capture=cell['capture'];review=cell['currentAIReview']
    assert capture['specRev']=='demo-spec-2' and capture['provenance']['adapterVersion']=='1.1'
    assert capture['provenance']['deviceKind']=='simulator'
    assert review['captureId']==capture['id'] and review['reviewProtocol']=='visual-acceptance-2'
    assert not cell['humanReviews'] and cell['currentHumanReview'] is None
    for historical in cell['captures']:
        if historical['status']=='blocked':blocked.append(historical)
        for asset in historical['assets']:
            p=root/asset['path'];assert sha(p)==asset['sha256'],asset['id']
            if asset['kind']!='video':
                b=p.read_bytes();assert b[:8]==bytes.fromhex('89504e470d0a1a0a')
                assert struct.unpack('>II',b[16:24])==(asset['width'],asset['height'])
    assert all(r['stale'] for r in cell['aiReviews'] if r.get('reviewProtocol')!='visual-acceptance-2')
    for asset in capture['assets']:
        if asset['kind']!='video':
            assert any(o['assetId']==asset['id'] and o['sha256']==asset['sha256'] and o['detail'] for o in review['observations'])
    if cell['stateId']=='ready':
        assert any(r['verdict']=='fail' and r['stale'] and r['buildId']=='demo-before' for r in cell['aiReviews'])
    if cell['stateId']=='download':
        t=capture['transition'];frames=[a for a in capture['assets'] if a['kind']=='frame'];start,end=ms(t['startedAt']),ms(t['endedAt'])
        assert len(frames)==5 and frames[0]['offsetMs']==0 and len({a['sha256'] for a in frames})>1
        assert frames[0]['id']==t['startEvidenceAssetId'] and ms(frames[0]['capturedAt'])==start
        assert frames[-1]['id']==t['endEvidenceAssetId'] and ms(frames[-1]['capturedAt'])==end
        assert all(ms(f['capturedAt'])-start==f['offsetMs'] for f in frames)
        assert all(frames[i]['offsetMs']<frames[i+1]['offsetMs'] for i in range(len(frames)-1))
        trigger=ms(capture['actions'][t['triggerActionIndex']]['at'])
        assert start<=trigger<end and any(trigger<ms(f['capturedAt'])<end for f in frames)
        for asset_id,state_id in [(t['startEvidenceAssetId'],t['fromStateId']),(t['endEvidenceAssetId'],t['toStateId'])]:
            assert any(a['basis']=='visual' and a['result']=='pass' and a.get('stateId')==state_id and asset_id in a['evidenceAssetIds'] and a.get('inspectedAt') for a in capture['assertions'])
        movie=next(a for a in capture['assets'] if a['kind']=='video')
        assert movie['durationMs']>0 and movie['nominalFrameRate']>0 and 'smoothness' in review['comment']
assert len(blocked)==4 and all(c['blockers'] for c in blocked)
questions=[r for c in data['cells'] for r in c['aiReviews'] if r['verdict']=='question' and r['specRev']=='demo-spec-2']
assert len(questions)==2 and all(r['stale'] for r in questions)
print(f'OK: {len(manifest)} portable files; original bundle/media retained; both actual native builds; 8 current protocol-2 reviews; strict real timelines/endpoints; 4 blocked attempts + 2 stale questions; humanPass=0')
