# -*- coding: utf-8 -*-
"""구 figma/01~06.js 가 만들던 것 vs 새 build-payload.json 대조.
   v0.77 개명이 있으므로 이름만으로는 못 붙는다 — 개명표를 통과시킨 뒤 비교한다."""
# 사용: python3 figma/parity-check.py [figma디렉터리] [build-payload.json]
import json, re, sys, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
D = (sys.argv[1] if len(sys.argv) > 1 else HERE).rstrip('/') + '/'
P = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, 'build-payload.json'), encoding='utf-8'))

def data_of(fn):
    s = open(D+fn, encoding='utf-8').read()
    m = re.search(r'const data\s*=\s*"(.*?)"\.split', s, re.S)
    return m.group(1).split(';')

# ---------- 구 스크립트 재현 ----------
old = {}   # (collection, name) -> dict
for d in data_of('01-scale-colors.js'):
    n, hexv = d.split('|'); old[('Scale', n)] = {'type':'COLOR','value':hexv.lower(),'scopes':[]}
for d in data_of('02-scale-dimension.js'):
    p = d.split('|'); n, v, sc = p[0], p[1], (p[2] if len(p)>2 else '')
    old[('Scale', n)] = {'type':'FLOAT','value':float(v),'scopes':sc.split(',') if sc else []}
for d in data_of('03-semantic-color.js'):
    n, tc, tn, sc = d.split('|')
    old[('Semantic', n)] = {'type':'COLOR','alias':(tc,tn),'scopes':sc.split(',') if sc else ['FRAME_FILL']}
# 04 는 데이터가 배열 리터럴이라 손으로 옮긴다 (스크립트 그대로)
SP=[("0",0),("25",2),("50",4),("75",6),("100",8),("125",10),("150",12),("200",16),("250",20),("300",24),("400",32),("500",40),("600",48),("800",64)]
for t,dv in SP: old[('Semantic','spacing/'+t)]={'type':'FLOAT','alias':('Scale','dimension/%d'%dv),'scopes':['GAP','WIDTH_HEIGHT']}
SIZE=[("icon/xs",12),("icon/s",16),("icon/m",20),("icon/l",24),("icon/xl",32),("control/s",32),("control/m",40),("control/l",48),("avatar/s",24),("avatar/m",32),("avatar/l",48),("touch-target/min",48)]
for t,dv in SIZE: old[('Semantic','size/'+t)]={'type':'FLOAT','alias':('Scale','dimension/%d'%dv),'scopes':['WIDTH_HEIGHT']}
for t,dv in [("hairline",1),("default",1),("strong",2)]: old[('Semantic','border/'+t)]={'type':'FLOAT','alias':('Scale','dimension/%d'%dv),'scopes':['STROKE_FLOAT']}
for k,t in [("button-x","250"),("button-y","150"),("card","300"),("field-x","200"),("field-y","150")]:
    old[('Semantic','comp/pad/'+k)]={'type':'FLOAT','alias':('Semantic','spacing/'+t),'scopes':['GAP']}
for k,t in [("xs","50"),("s","100"),("m","150"),("l","250")]:
    old[('Semantic','comp/gap/'+k)]={'type':'FLOAT','alias':('Semantic','spacing/'+t),'scopes':['GAP']}
# 05
R={'2xs':[0,2,4],'xs':[2,4,8],'s':[2,8,12],'m':[4,12,20],'l':[6,16,24],'xl':[8,20,28],'2xl':[12,24,32]}
for t,(s,dd,r) in R.items():
    old[('Radius','radius/'+t)]={'type':'FLOAT','modes':{'sharp':s,'default':dd,'rounded':r},'scopes':['CORNER_RADIUS']}
old[('Radius','radius/full')]={'type':'FLOAT','modes':{'sharp':999,'default':999,'rounded':999},'scopes':['CORNER_RADIUS']}
for k,t in {'button':'m','input':'s','card':'l','chip':'full','modal':'xl','pill':'full'}.items():
    old[('Radius','comp/radius/'+k)]={'type':'FLOAT','aliasAll':('Radius','radius/'+t),'scopes':['CORNER_RADIUS']}
old_text = [d.split('|')[0] for d in data_of('06-text-styles.js')]

# ---------- 개명표 (v0.4/구스크립트 → v0.77) ----------
def ren(coll, n):
    if coll=='Scale':
        m={'radius/2xs':None,'radius/xs':None,'radius/s':None,'radius/m':None,'radius/l':None,
           'radius/xl':None,'radius/2xl':None,'radius/full':None}
        if n in m: return None                      # Radius 컬렉션으로 이사
        if n.startswith('spacing/'): return None    # Semantic 으로 이사
        return n
    if coll=='Semantic':
        if n.startswith('size/icon/') or n.startswith('size/control/') or n.startswith('size/avatar/'):
            base=n[len('size/'):]
            base=base.replace('/s','/sm').replace('/m','/md').replace('/l','/lg') if re.search(r'/(s|m|l)$',base) else base
            return ['w/'+base,'h/'+base]            # 한 개가 둘로 쪼개짐
        if n=='size/touch-target/min': return 'a11y/touch-target/min'
        if n=='fg/disabled': return 'comp/fg/disabled'
        if n.startswith('bdr/'): return 'comp/'+n
        if n=='comp/bdr/focus-ring': return 'comp/bdr/focused'
        if n=='status/fg/critical': return 'status/fg/error'
        if n=='status/bg/critical': return 'status/bg/error'
        if n.startswith('comp/pad/'):
            k=n[len('comp/pad/'):]
            return 'comp/padding/'+(k.replace('button-','button/').replace('field-','field/'))
        if n.startswith('comp/gap/'):
            k=n[len('comp/gap/'):]
            return 'comp/gap/'+{'s':'sm','m':'md','l':'lg'}.get(k,k)
        return n
    if coll=='Radius':
        if n.startswith('radius/'):
            k=n[len('radius/'):]
            return 'radius/'+{'2xs':'xxs','s':'sm','m':'md','l':'lg','2xl':'xxl'}.get(k,k)
        return n
    return n

# ---------- 새 페이로드 색인 ----------
new = {}
for v in P['variables']:
    new[(v['collection'], v['name'])] = v
new_text = set(s['name'] for s in P['styles']['text'])

# ---------- 대조 ----------
missing, moved, mismatch = [], [], []
for (coll, n), o in sorted(old.items()):
    t = ren(coll, n)
    if t is None: moved.append('%s/%s (컬렉션 이동 · 새 위치에서 확인)'%(coll,n)); continue
    tgts = t if isinstance(t,list) else [t]
    for tn in tgts:
        key=(coll,tn)
        if key not in new:
            # 컬렉션이 바뀌었을 수 있다
            alt=[c for c in ('Scale','Brand','Semantic','Radius','Web') if (c,tn) in new]
            if alt: moved.append('%s/%s → %s/%s'%(coll,n,alt[0],tn))
            else:   missing.append('%s/%s → %s/%s 없음'%(coll,n,coll,tn))
            continue
        nv=new[key]
        if set(nv['scopes'])!=set(o['scopes']):
            mismatch.append('%s scopes %s → %s'%(tn,o['scopes'],nv['scopes']))
        if 'alias' in o:
            got=list(nv['values'].values())[0]
            if got.get('kind')!='alias': mismatch.append('%s 별칭이어야 하는데 값이다'%tn)
            else:
                ac,an=o['alias']
                # 구 이름의 별칭 대상도 개명될 수 있다
                exp=ren(ac,an); exp=exp[0] if isinstance(exp,list) else exp
                if got['name']!=an and got['name']!=exp:
                    mismatch.append('%s 별칭 %s/%s → %s/%s'%(tn,ac,an,got['collection'],got['name']))
        if 'value' in o and o['type']=='COLOR':
            got=list(nv['values'].values())[0]
            if got.get('kind')=='value' and str(got['value']).lower()!=o['value']:
                mismatch.append('%s 값 %s → %s'%(tn,o['value'],got['value']))

print('구 스크립트 항목 %d개'%len(old))
print('\n[없어짐] %d건'%len(missing));  [print('  ·',x) for x in missing]
print('\n[이동/개명으로 자리 옮김] %d건'%len(moved)); [print('  ·',x) for x in moved]
print('\n[값·scopes 불일치] %d건'%len(mismatch)); [print('  ·',x) for x in mismatch]

# 텍스트 스타일
tm=[n for n in old_text if n not in new_text]
print('\n[텍스트 스타일] 구 %d · 신 %d · 구에만 있는 이름 %d건'%(len(old_text),len(new_text),len(tm)))
for x in tm: print('  ·',x)
extra=[n for n in sorted(new_text) if n not in old_text]
print('  신규 %d건: %s'%(len(extra), ', '.join(extra)))
