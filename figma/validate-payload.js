// build-payload.json 자체 검사 — 별칭이 전부 풀리는가, 모드가 컬렉션과 맞는가, 타입이 섞이지 않는가.
// 사용: node figma/validate-payload.js [build-payload.json]
const path=require('path');
const P=require(process.argv[2]?path.resolve(process.argv[2]):path.join(__dirname,'build-payload.json'));
const idx=new Map(), coll=new Map();
for(const c of P.collections) coll.set(c.name,c);
for(const v of P.variables) idx.set(v.collection+'::'+v.name,v);
const err=[];
for(const v of P.variables){
  const c=coll.get(v.collection); if(!c){err.push(v.name+' 컬렉션 없음');continue;}
  const ks=Object.keys(v.values);
  if(ks.length!==c.modes.length||!c.modes.every(m=>ks.includes(m)))
    err.push(v.collection+'/'+v.name+' 모드 불일치 '+JSON.stringify(ks)+' vs '+JSON.stringify(c.modes));
  for(const m of ks){
    const e=v.values[m];
    if(e.kind==='alias'){
      const t=idx.get(e.collection+'::'+e.name);
      if(!t) err.push(v.collection+'/'+v.name+'['+m+'] → '+e.collection+'/'+e.name+' 대상 없음');
      else if(t.type!==v.type) err.push(v.collection+'/'+v.name+'['+m+'] 타입 '+v.type+' ≠ 대상 '+t.type);
    } else {
      if(v.type==='COLOR'&&!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(String(e.value))) err.push(v.name+' 색 형식 '+e.value);
      if(v.type==='FLOAT'&&typeof e.value!=='number') err.push(v.name+' FLOAT 아님 '+JSON.stringify(e.value));
      if(v.type==='STRING'&&typeof e.value!=='string') err.push(v.name+' STRING 아님');
    }
  }
}
// 별칭 순환
const seen=new Set();
function depth(k,path){
  if(path.includes(k)){err.push('순환 별칭 '+path.concat(k).join(' → '));return 0;}
  const v=idx.get(k); if(!v)return 0;
  let d=0; for(const m in v.values){const e=v.values[m]; if(e.kind==='alias') d=Math.max(d,1+depth(e.collection+'::'+e.name,path.concat(k)));}
  return d;
}
let maxd=0,deepest='';
for(const k of idx.keys()){const d=depth(k,[]); if(d>maxd){maxd=d;deepest=k;}}
console.log('변수 '+P.variables.length+' · 최대 별칭 깊이 '+maxd+' ('+deepest+')');
console.log('텍스트 '+P.styles.text.length+' · 이펙트 '+P.styles.effect.length+' · 컴포넌트 '+P.components.length);
console.log(err.length?('오류 '+err.length+'건\n  · '+err.join('\n  · ')):'오류 없음');
