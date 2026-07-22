const colls=await figma.variables.getLocalVariableCollectionsAsync();
const scale=colls.find(c=>c.name==='Scale');const mode=scale.modes[0].modeId;
const existing=await figma.variables.getLocalVariablesAsync();
const have=new Set(existing.filter(v=>v.variableCollectionId===scale.id).map(v=>v.name));
const data="dimension/0|0|;dimension/2|2|;dimension/4|4|;dimension/6|6|;dimension/8|8|;dimension/10|10|;dimension/12|12|;dimension/16|16|;dimension/20|20|;dimension/24|24|;dimension/28|28|;dimension/32|32|;dimension/40|40|;dimension/48|48|;dimension/56|56|;dimension/64|64|;radius/2xs|2|CORNER_RADIUS;radius/xs|4|CORNER_RADIUS;radius/s|8|CORNER_RADIUS;radius/m|12|CORNER_RADIUS;radius/l|16|CORNER_RADIUS;radius/xl|20|CORNER_RADIUS;radius/2xl|24|CORNER_RADIUS;radius/full|999|CORNER_RADIUS;spacing/0|0|GAP,WIDTH_HEIGHT;spacing/25|2|GAP,WIDTH_HEIGHT;spacing/50|4|GAP,WIDTH_HEIGHT;spacing/75|6|GAP,WIDTH_HEIGHT;spacing/100|8|GAP,WIDTH_HEIGHT;spacing/125|10|GAP,WIDTH_HEIGHT;spacing/150|12|GAP,WIDTH_HEIGHT;spacing/200|16|GAP,WIDTH_HEIGHT;spacing/250|20|GAP,WIDTH_HEIGHT;spacing/300|24|GAP,WIDTH_HEIGHT;spacing/400|32|GAP,WIDTH_HEIGHT;spacing/500|40|GAP,WIDTH_HEIGHT;spacing/600|48|GAP,WIDTH_HEIGHT;spacing/800|64|GAP,WIDTH_HEIGHT".split(';');let n=0;
for(const d of data){const [name,val,sc]=d.split('|');if(have.has(name))continue;
 const v=figma.variables.createVariable(name,scale,'FLOAT');v.setValueForMode(mode,parseFloat(val));
 v.scopes=sc?sc.split(','):[];v.setVariableCodeSyntax('WEB','var(--'+name.replace(/\//g,'-')+')');n++;}
return {created:n};