// KDX — Radius collection with 3 modes (sharp / default / rounded).
// Run in Figma (use_figma) AFTER 02-scale-dimension.js.
// 곡률 스왑: Figma 변수는 곱셈이 안 되므로 배율 대신 '모드'로 곡률 성격을 교체.
// 각 radius 스텝이 모드별로 서로 다른 dimension에 별칭된다.
const colls=await figma.variables.getLocalVariableCollectionsAsync();
const scale=colls.find(c=>c.name==='Scale');
let vars=await figma.variables.getLocalVariablesAsync();
if(!vars.find(v=>v.name==='dimension/1')){const d1=figma.variables.createVariable('dimension/1',scale,'FLOAT');d1.setValueForMode(scale.modes[0].modeId,1);d1.scopes=[];d1.setVariableCodeSyntax('WEB','var(--dimension-1)');}
vars=await figma.variables.getLocalVariablesAsync();
const dimId=n=>{const v=vars.find(x=>x.name==='dimension/'+n&&x.variableCollectionId===scale.id);return v?v.id:null;};
let rc=colls.find(c=>c.name==='Radius');let modes;
if(!rc){rc=figma.variables.createVariableCollection('Radius');rc.renameMode(rc.modes[0].modeId,'default');const sharp=rc.addMode('sharp');const rounded=rc.addMode('rounded');modes={default:rc.modes.find(m=>m.name==='default').modeId,sharp,rounded};}
else{modes={};for(const m of rc.modes)modes[m.name]=m.modeId;}
// [sharp, default, rounded] → dimension value per mode
const R={'2xs':[0,2,4],'xs':[2,4,8],'s':[2,8,12],'m':[4,12,20],'l':[6,16,24],'xl':[8,20,28],'2xl':[12,24,32]};
let cur=(await figma.variables.getLocalVariablesAsync()).filter(v=>v.variableCollectionId===rc.id);
const has=new Set(cur.map(v=>v.name));let n=0;
for(const tok in R){const name='radius/'+tok;if(has.has(name))continue;const v=figma.variables.createVariable(name,rc,'FLOAT');const [s,d,r]=R[tok];
 v.setValueForMode(modes.sharp,{type:'VARIABLE_ALIAS',id:dimId(s)});
 v.setValueForMode(modes.default,{type:'VARIABLE_ALIAS',id:dimId(d)});
 v.setValueForMode(modes.rounded,{type:'VARIABLE_ALIAS',id:dimId(r)});
 v.scopes=['CORNER_RADIUS'];v.setVariableCodeSyntax('WEB','var(--radius-'+tok+')');n++;}
if(!has.has('radius/full')){const v=figma.variables.createVariable('radius/full',rc,'FLOAT');for(const m in modes)v.setValueForMode(modes[m],999);v.scopes=['CORNER_RADIUS'];v.setVariableCodeSyntax('WEB','var(--radius-full)');n++;}
vars=await figma.variables.getLocalVariablesAsync();
const radId=t=>{const v=vars.find(x=>x.name==='radius/'+t&&x.variableCollectionId===rc.id);return v?v.id:null;};
// comp/radius → radius 별칭 (모드 무관, 위 모드값을 물려받음)
const CR={button:'m',input:'s',card:'l',chip:'full',modal:'xl',pill:'full'};
const has2=new Set(vars.filter(v=>v.variableCollectionId===rc.id).map(v=>v.name));
for(const k in CR){const name='comp/radius/'+k;if(has2.has(name))continue;const v=figma.variables.createVariable(name,rc,'FLOAT');const tgt=radId(CR[k]);for(const m in modes)v.setValueForMode(modes[m],{type:'VARIABLE_ALIAS',id:tgt});v.scopes=['CORNER_RADIUS'];v.setVariableCodeSyntax('WEB','var(--comp-radius-'+k+')');n++;}
return {created:n,modes:Object.keys(modes)};
