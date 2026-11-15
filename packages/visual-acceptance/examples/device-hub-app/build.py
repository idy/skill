#!/usr/bin/env python3
"""Build a real arm64 iOS simulator .app using the installed Xcode SDK."""
import argparse, hashlib, json, pathlib, plistlib, shutil, subprocess, datetime
p=argparse.ArgumentParser()
p.add_argument('--out',required=True)
a=p.parse_args()
root=pathlib.Path(__file__).resolve().parent
out=pathlib.Path(a.out).resolve()
if out.exists(): raise SystemExit('Refusing to replace an existing build: '+str(out))
app=out/'TrailNotes.app'
app.mkdir(parents=True)
sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
cmd=['xcrun','swiftc','-sdk',sdk,'-target','arm64-apple-ios18.0-simulator','-parse-as-library',str(root/'Sources/TrailNotes.swift'),'-o',str(app/'TrailNotes')]
r=subprocess.run(cmd,capture_output=True,text=True)
(out/'build.log').write_text(r.stdout+r.stderr)
if r.returncode: raise SystemExit(r.stderr)
plist={'CFBundleIdentifier':'dev.pi.visualacceptance.TrailNotes','CFBundleExecutable':'TrailNotes','CFBundleName':'Trail Notes','CFBundlePackageType':'APPL','CFBundleShortVersionString':'1.0','CFBundleVersion':'1','MinimumOSVersion':'18.0','UIDeviceFamily':[1,2],'UILaunchScreen':{},'UISupportedInterfaceOrientations':['UIInterfaceOrientationPortrait','UIInterfaceOrientationLandscapeLeft','UIInterfaceOrientationLandscapeRight'],'LSRequiresIPhoneOS':True}
(app/'Info.plist').write_bytes(plistlib.dumps(plist))
subprocess.run(['codesign','--force','--sign','-',str(app)],check=True,capture_output=True)
shutil.copytree(root/'Sources',out/'source')
manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'appId':plist['CFBundleIdentifier'],'sdk':sdk,'sourceSha256':hashlib.sha256((root/'Sources/TrailNotes.swift').read_bytes()).hexdigest(),'executableSha256':hashlib.sha256((app/'TrailNotes').read_bytes()).hexdigest(),'artifact':str(app),'sourceSnapshot':str(out/'source')}
(out/'build-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
