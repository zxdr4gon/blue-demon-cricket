const SHEETS = {
  "2026-27": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=960895682&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1022493287&single=true&output=csv"
  },
  "2025-26": {
    batting: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJm4r77z0lQJiG2xEoLR9kZJmreiIwXGNxfFR58/pub?gid=1041989768&single=true&output=csv",
    bowling: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXsO-A29-HMU5T5v3lW6v474irClAhDXXE3NcXXkJmreiIwXGNxfFR58/pub?gid=1051296080&single=true&output=csv"
  }
};
const $ = id => document.getElementById(id);
const fields = ["playerName","matches","runs","balls","average","strikeRate","highScore","fours","sixes","wickets","economy","bowlingAverage","bowlingStrikeRate","catches"];
let teamPlayers = new Map();
let playerPhoto = "";
let imageToken = 0;
let lastCardState = null;

function parseCsv(text) {
  const rows=[]; let row=[], field="", quoted=false;
  text=String(text||"").replace(/^\uFEFF/,"");
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}
    else if(c==='"')quoted=true;
    else if(c===","){row.push(field);field="";}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(field);rows.push(row);row=[];field="";}
    else field+=c;
  }
  if(field!==""||row.length){row.push(field);rows.push(row);}
  return rows;
}
const key = value => String(value||"").trim().toLowerCase().replace(/[^a-z0-9]/g,"");
function recordsFromCsv(text) {
  const rows=parseCsv(text);
  const headerAt=rows.findIndex(row=>row.some(cell=>key(cell)==="player"));
  if(headerAt<0)return [];
  const headers=rows[headerAt].map(key);
  return rows.slice(headerAt+1).filter(row=>String(row[headers.indexOf("player")]||"").trim()).map(row=>{
    const out={};
    headers.forEach((h,i)=>out[h]=String(row[i]??"").trim());
    return out;
  });
}
function value(row, name) { return row ? row[key(name)] : ""; }
function setStatus(message, error=false) { $("loadStatus").textContent=message; $("loadStatus").style.color=error?"#e49a9a":""; }
async function loadSeason() {
  const season=$("season").value;
  setStatus("Syncing team score sheets…");
  $("teamPlayer").innerHTML='<option value="">Choose a player…</option>';
  try {
    const cfg=SHEETS[season];
    const [batting,bowling]=await Promise.all([fetch(cfg.batting,{cache:"no-store"}),fetch(cfg.bowling,{cache:"no-store"})]);
    if(!batting.ok||!bowling.ok)throw new Error("The published score sheets could not be reached.");
    const [batText,bowlText]=await Promise.all([batting.text(),bowling.text()]);
    const players=new Map();
    recordsFromCsv(batText).forEach(r=>{const name=value(r,"Player");if(!name)return;players.set(name,{name,batting:r,bowling:null,photo:value(r,"Photo")});});
    recordsFromCsv(bowlText).forEach(r=>{const name=value(r,"Player");if(!name)return;const p=players.get(name)||{name,batting:null,bowling:null,photo:value(r,"Photo")};p.bowling=r;if(!p.photo)p.photo=value(r,"Photo");players.set(name,p);});
    teamPlayers=players;
    Array.from(players.keys()).sort((a,b)=>a.localeCompare(b)).forEach(name=>{
      const option=document.createElement("option");option.value=name;option.textContent=name;$("teamPlayer").append(option);
    });
    setStatus(players.size+" players available · "+season);
    const requested=new URLSearchParams(location.search).get("player");
    if(requested&&players.has(requested)){ $("teamPlayer").value=requested; importPlayer(); }
  } catch(error) {
    console.warn(error);setStatus("Could not load team stats. You can still enter numbers manually.",true);
  }
}
function num(id) { const raw=$(id).value.trim();if(raw==="")return null;const n=Number(raw);return Number.isFinite(n)?n:null; }
function put(id,v) { $(id).value=v===undefined||v===null||v===""?"":v; }
function importPlayer() {
  const p=teamPlayers.get($("teamPlayer").value);if(!p)return;
  const b=p.batting,w=p.bowling;
  put("playerName",p.name);
  put("matches",value(b,"Matches")||value(w,"Matches"));
  put("runs",value(b,"Runs"));put("balls",value(b,"Balls"));put("average",value(b,"Ave"));put("strikeRate",value(b,"S/R"));
  put("highScore",value(b,"HS"));put("fours",value(b,"4s"));put("sixes",value(b,"6s"));put("catches",value(b,"Catches"));
  put("wickets",value(w,"Wickets"));put("economy",value(w,"Economy"));put("bowlingAverage",value(w,"Ave"));put("bowlingStrikeRate",value(w,"S/R"));
  if($("playerRole").value==="auto") {
    $("playerRole").value=b&&w?"All-rounder":w?"Bowler":"Batter";
  }
  if(p.photo){playerPhoto=p.photo;drawCard();}
  setStatus("Imported "+p.name+" · edit any number before saving.");
  drawCard();
}
function clamp(v,min=0,max=99){return Math.max(min,Math.min(max,v));}
function scale(v,max){return v===null?null:clamp(v/max*99);}
function inverse(v,best,worst){return v===null?null:clamp((worst-v)/(worst-best)*99);}
function weighted(items) {
  const valid=items.filter(x=>x[0]!==null&&Number.isFinite(x[0]));
  if(!valid.length)return null;
  const total=valid.reduce((s,x)=>s+x[1],0);
  return valid.reduce((s,x)=>s+x[0]*x[1],0)/total;
}
function stats() {
  const matches=num("matches"),runs=num("runs"),balls=num("balls"),avg=num("average"),sr=num("strikeRate"),hs=num("highScore");
  const fours=num("fours"),sixes=num("sixes"),wickets=num("wickets"),econ=num("economy"),bavg=num("bowlingAverage"),bsr=num("bowlingStrikeRate"),catches=num("catches");
  const boundaries=(fours||0)+(sixes||0);
  const bat=weighted([[scale(avg,35),30],[scale(sr,170),30],[scale(runs,250),20],[scale(hs,80),10],[balls>0?scale(boundaries/balls,.5):null,10]]);
  const bowl=weighted([[scale(wickets,20),30],[inverse(econ,3,12),25],[inverse(bavg,10,50),25],[inverse(bsr,10,40),20]]);
  const field=weighted([[scale(catches,10),65],[matches>0&&catches!==null?scale(catches/matches,.7):null,35]]);
  const power=balls>0?scale(boundaries/balls,.5):null;
  const control=weighted([[scale(avg,35),55],[inverse(econ,3,12),45]]);
  const impact=weighted([[matches>0&&runs!==null?scale(runs/matches,35):null,45],[matches>0&&wickets!==null?scale(wickets/matches,1.2):null,40],[matches>0&&catches!==null?scale(catches/matches,.6):null,15]]);
  const role=$("playerRole").value==="auto"?(bat!==null&&bowl!==null?"All-rounder":bowl!==null?"Bowler":"Batter"):$("playerRole").value;
  const overall=role==="All-rounder"?weighted([[bat,45],[bowl,45],[field,10]]):role==="Bowler"?weighted([[bowl,70],[field,20],[bat,10]]):role==="Wicketkeeper"?weighted([[bat,55],[field,45]]):weighted([[bat,70],[field,20],[bowl,10]]);
  return {bat,bowl,field,power,control,impact,overall,role};
}
function initials(name){return String(name||"BD").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();}
function rounded(v){return v===null?"—":String(Math.round(v));}
function drawCard() {
  const canvas=$("playerCard"),ctx=canvas.getContext("2d");
  const s=stats(),name=$("playerName").value.trim()||"YOUR PLAYER",season=$("season").value;
  lastCardState={s,name,season};
  const w=720,h=1000;
  const bg=ctx.createLinearGradient(0,0,w,h);bg.addColorStop(0,"#102c4b");bg.addColorStop(.48,"#091a2e");bg.addColorStop(1,"#06111f");
  ctx.clearRect(0,0,w,h);ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  const glow=ctx.createRadialGradient(530,260,20,530,260,460);glow.addColorStop(0,"rgba(83,145,218,.32)");glow.addColorStop(1,"rgba(83,145,218,0)");ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  ctx.save();ctx.strokeStyle="rgba(174,203,231,.055)";ctx.lineWidth=1;
  for(let x=-300;x<900;x+=42){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+330,1000);ctx.stroke();}
  ctx.restore();
  ctx.strokeStyle="rgba(204,222,239,.38)";ctx.lineWidth=2;ctx.strokeRect(18,18,w-36,h-36);
  ctx.strokeStyle="rgba(215,184,121,.65)";ctx.lineWidth=2;ctx.strokeRect(29,29,w-58,h-58);
  ctx.fillStyle="#d7b879";ctx.font="500 17px 'DM Mono',monospace";ctx.fillText("BLUE DEMON CRICKET",54,78);
  ctx.fillStyle="rgba(215,184,121,.6)";ctx.fillRect(54,96,116,2);
  ctx.fillStyle="#f1f4f7";ctx.font="800 104px 'Manrope',sans-serif";ctx.fillText(rounded(s.overall),52,230);
  ctx.fillStyle="#d7b879";ctx.font="500 19px 'DM Mono',monospace";ctx.fillText("OVR",58,267);
  ctx.textAlign="right";ctx.fillStyle="#b6cbe0";ctx.font="700 20px 'Manrope',sans-serif";ctx.fillText(s.role.toUpperCase(),666,145);
  ctx.fillStyle="#7893ae";ctx.font="500 14px 'DM Mono',monospace";ctx.fillText(season+" SEASON",666,174);ctx.textAlign="left";
  ctx.save();ctx.beginPath();ctx.roundRect(260,220,405,420,12);ctx.clip();
  ctx.fillStyle="rgba(65,112,161,.22)";ctx.fillRect(260,220,405,420);
  if(playerPhoto){
    const token=++imageToken;const img=new Image();img.crossOrigin="anonymous";
    img.onload=()=>{if(token!==imageToken)return;ctx.save();ctx.beginPath();ctx.roundRect(260,220,405,420,12);ctx.clip();const scale=Math.max(405/img.width,420/img.height),iw=img.width*scale,ih=img.height*scale;ctx.drawImage(img,260+(405-iw)/2,220+(420-ih)/2,iw,ih);ctx.restore();drawCardOverlay(ctx,name,s,season);};
    img.onerror=()=>{if(token!==imageToken)return;drawInitials(ctx,name);drawCardOverlay(ctx,name,s,season);};
    img.src=playerPhoto;
  } else {drawInitials(ctx,name);}
  ctx.restore();
  drawCardOverlay(ctx,name,s,season);
  ctx.fillStyle="rgba(4,13,24,.82)";ctx.fillRect(0,654,w,346);
  const cleanName=name.toUpperCase();
  ctx.fillStyle="#f3f5f7";ctx.font="800 47px 'Manrope',sans-serif";
  let displayName=cleanName;while(ctx.measureText(displayName).width>610&&displayName.length>12)displayName=displayName.slice(0,-1);
  ctx.fillText(displayName,54,724);
  ctx.fillStyle="#d7b879";ctx.font="500 15px 'DM Mono',monospace";ctx.fillText("MAINE EAST  /  BLUE DEMONS",56,758);
  ctx.strokeStyle="rgba(215,184,121,.45)";ctx.beginPath();ctx.moveTo(54,786);ctx.lineTo(666,786);ctx.stroke();
  const attrs=[["BAT",s.bat],["BOWL",s.bowl],["FIELD",s.field],["POWER",s.power],["CONTROL",s.control],["IMPACT",s.impact]];
  attrs.forEach((item,i)=>{const col=i%2,row=Math.floor(i/2),x=56+col*320,y=833+row*55;ctx.fillStyle="#8fa5bb";ctx.font="500 15px 'DM Mono',monospace";ctx.fillText(item[0],x,y);ctx.fillStyle="#f1f4f7";ctx.font="700 25px 'Manrope',sans-serif";ctx.textAlign="right";ctx.fillText(rounded(item[1]),x+265,y+2);ctx.textAlign="left";});
  ctx.fillStyle="#6e8297";ctx.font="500 11px 'DM Mono',monospace";ctx.fillText("ESTIMATED SEASON RATING  ·  NOT AN OFFICIAL RANKING",56,963);
}
function drawInitials(ctx,name) {
  const g=ctx.createLinearGradient(260,220,665,640);g.addColorStop(0,"#214d79");g.addColorStop(1,"#0b2038");ctx.fillStyle=g;ctx.fillRect(260,220,405,420);
  ctx.textAlign="center";ctx.fillStyle="rgba(219,232,245,.16)";ctx.font="700 190px 'Manrope',sans-serif";ctx.fillText(initials(name),462,475);ctx.textAlign="left";
}
function drawCardOverlay(ctx,name,s,season) {
  const fade=ctx.createLinearGradient(260,480,260,640);fade.addColorStop(0,"rgba(4,13,24,0)");fade.addColorStop(1,"rgba(4,13,24,.7)");ctx.fillStyle=fade;ctx.fillRect(260,480,405,160);
  ctx.strokeStyle="rgba(215,184,121,.8)";ctx.lineWidth=2;ctx.strokeRect(260,220,405,420);
}
function downloadCard() {
  const canvas=$("playerCard"),name=($("playerName").value.trim()||"player").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
  try {canvas.toBlob(blob=>{if(!blob){setStatus("This photo cannot be exported. Try uploading the image from your device.",true);return;}const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=(name||"player")+"-blue-demon-card.png";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}, "image/png");}
  catch(error){setStatus("Could not export this image. Try uploading the photo instead of using its web URL.",true);}
}
function resetFields() {
  fields.forEach(id=>put(id,""));$("playerRole").value="auto";$("teamPlayer").value="";$("photo").value="";playerPhoto="";drawCard();setStatus("Fields cleared. Add stats or import a player.");
}
function init() {
  Object.keys(SHEETS).forEach(season=>{const o=document.createElement("option");o.value=season;o.textContent=season;$("season").append(o);});
  const params=new URLSearchParams(location.search),requestedSeason=params.get("season");
  $("season").value=SHEETS[requestedSeason]?requestedSeason:Object.keys(SHEETS)[0];
  fields.forEach(id=>$(id).addEventListener("input",drawCard));
  $("playerRole").addEventListener("change",drawCard);
  $("season").addEventListener("change",loadSeason);
  $("loadPlayer").addEventListener("click",importPlayer);
  $("download").addEventListener("click",downloadCard);
  $("reset").addEventListener("click",resetFields);
  $("photo").addEventListener("change",e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    if(!file.type.startsWith("image/")){setStatus("Choose an image file.",true);return;}
    if(file.size>8*1024*1024){setStatus("Choose an image under 8 MB.",true);return;}
    const reader=new FileReader();reader.onload=()=>{playerPhoto=String(reader.result);drawCard();setStatus("Photo added to your card.");};reader.readAsDataURL(file);
  });
  drawCard();loadSeason();
  if("serviceWorker" in navigator&&location.protocol!=="file:")navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Card service worker failed:",err));
}
init();
