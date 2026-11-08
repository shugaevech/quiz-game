const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');const QR=require('qrcode');
const games={};
const send=(ws,o)=>{if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))};
const srv=http.createServer((q,r)=>{
  const f=q.url.startsWith('/play')?'play.html':'host.html';
  r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  fs.createReadStream(path.join(__dirname,'public',f)).pipe(r);
});
const wss=new WebSocketServer({server:srv});
const board=g=>[...g.players.values()].sort((a,b)=>b.score-a.score);
const rank=(g,p)=>board(g).indexOf(p)+1;
function lobby(g){send(g.host,{t:'lobby',players:[...g.players.values()].map(p=>p.name)})}
function startQ(g){
  g.i++;
  if(g.i>=g.qs.length){
    g.phase='end';
    send(g.host,{t:'end',board:board(g).slice(0,10).map(p=>({name:p.name,score:p.score}))});
    g.players.forEach(p=>send(p.ws,{t:'end',rank:rank(g,p),score:p.score}));
    return;
  }
  const q=g.qs[g.i];g.phase='q';g.t0=Date.now();
  g.players.forEach(p=>{p.ans=null;p.gain=0});
  send(g.host,{t:'q',i:g.i,n:g.qs.length,q:q.q,a:q.a,time:g.time});
  g.players.forEach(p=>send(p.ws,{t:'q',n:q.a.length,time:g.time}));
  g.timer=setTimeout(()=>reveal(g),g.time*1000+500);
}
function reveal(g){
  if(g.phase!=='q')return;
  clearTimeout(g.timer);g.phase='r';
  const q=g.qs[g.i],counts=q.a.map(()=>0);
  g.players.forEach(p=>{if(p.ans!==null)counts[p.ans]++});
  send(g.host,{t:'r',correct:q.c,counts,board:board(g).slice(0,5).map(p=>({name:p.name,score:p.score})),last:g.i===g.qs.length-1});
  g.players.forEach(p=>send(p.ws,{t:'r',ok:p.ans===q.c,gain:p.gain,score:p.score,rank:rank(g,p)}));
}
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='create'){
      if(!Array.isArray(m.qs)||!m.qs.length||m.qs.length>100)return;
      let code;do{code=String(1000+Math.floor(Math.random()*9000))}while(games[code]);
      const g={code,host:ws,qs:m.qs,time:Math.min(120,Math.max(5,+m.time||20)),players:new Map(),i:-1,phase:'lobby'};
      games[code]=g;ws.g=g;
      const url=String(m.origin).replace(/[^\w:\/.\-]/g,'')+'/play?c='+code;
      QR.toDataURL(url,{margin:1,width:320}).then(qr=>send(ws,{t:'created',code,url,qr}));
    }else if(m.t==='next'){
      const g=ws.g;if(!g||g.host!==ws)return;
      if(g.phase==='q')reveal(g);else if(g.phase==='lobby'||g.phase==='r')startQ(g);
    }else if(m.t==='join'){
      const g=games[String(m.code)];
      if(!g)return send(ws,{t:'err',msg:'Игра с таким кодом не найдена'});
      const id=String(m.id||'').slice(0,40);let p=g.players.get(id);
      if(p){p.ws=ws}else{
        if(g.phase!=='lobby')return send(ws,{t:'err',msg:'Игра уже началась'});
        if(g.players.size>=300)return send(ws,{t:'err',msg:'Комната заполнена'});
        const name=String(m.name||'').trim().slice(0,20);
        if(!name)return send(ws,{t:'err',msg:'Введите имя'});
        p={name,score:0,ans:null,gain:0,ws};g.players.set(id,p);
      }
      ws.g=g;ws.p=p;send(ws,{t:'joined',name:p.name});lobby(g);
    }else if(m.t==='ans'){
      const g=ws.g,p=ws.p;if(!g||!p||g.phase!=='q'||p.ans!==null)return;
      const q=g.qs[g.i],c=+m.c;if(!(c>=0&&c<q.a.length))return;
      const ms=Date.now()-g.t0;p.ans=c;
      if(c===q.c){p.gain=Math.round(1000*(1-Math.min(1,ms/(g.time*1000))/2));p.score+=p.gain}
      send(ws,{t:'ok'});
      const all=[...g.players.values()];
      send(g.host,{t:'cnt',n:all.filter(x=>x.ans!==null).length,total:all.length});
      if(all.every(x=>x.ans!==null))reveal(g);
    }
  });
  ws.on('close',()=>{
    const g=ws.g;if(!g)return;
    if(g.host===ws){clearTimeout(g.timer);g.players.forEach(p=>send(p.ws,{t:'err',msg:'Ведущий закрыл игру'}));delete games[g.code]}
    else if(g.phase==='lobby'&&ws.p&&ws.p.ws===ws){for(const[k,v]of g.players)if(v===ws.p)g.players.delete(k);lobby(g)}
  });
});
setInterval(()=>{for(const c in games)if(Date.now()-(games[c].t0||0)>6*3600e3&&games[c].phase==='end')delete games[c]},600e3);
srv.listen(process.env.PORT||3000,()=>console.log('http://localhost:'+(process.env.PORT||3000)));
