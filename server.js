import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("."));

const client = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;

app.get("/api/config", (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");

  const supabaseUrl = String(process.env.SUPABASE_URL || "")
    .trim()
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/+$/, "");

  const supabasePublishableKey = String(
    process.env.SUPABASE_PUBLISHABLE_KEY || ""
  ).trim();

  res.json({
    supabaseUrl,
    supabasePublishableKey
  });
});

app.get("/health",(req,res)=>res.json({ok:true,version:"5.9.2"}));

app.get("/api/geocode", async (req,res)=>{
  try{
    const q=String(req.query.q||"").trim();
    if(!q) return res.status(400).json({error:"Suchbegriff fehlt"});
    const url=new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q",q);url.searchParams.set("format","jsonv2");url.searchParams.set("limit","5");url.searchParams.set("addressdetails","1");url.searchParams.set("accept-language","de");
    const r=await fetch(url,{headers:{"User-Agent":"Urlaubsplaner-Demo/0.3 (local prototype)","Accept-Language":"de"}});
    if(!r.ok) throw new Error(`Nominatim ${r.status}`);
    const data=await r.json();
    res.json({results:data.map(x=>({name:x.name||"",display_name:x.display_name,lat:+x.lat,lon:+x.lon,type:x.type,category:x.category}))});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/what3words", async (req,res)=>{
 try{
  const words=String(req.query.words||"").trim().replace(/^\/\/\//,"");
  if(!words)return res.status(400).json({error:"what3words-Adresse fehlt"});
  const key=String(process.env.WHAT3WORDS_API_KEY||"").trim();
  if(!key)return res.status(503).json({error:"WHAT3WORDS_API_KEY ist auf dem Server noch nicht eingerichtet."});
  const u=new URL("https://api.what3words.com/v3/convert-to-coordinates");u.searchParams.set("words",words);u.searchParams.set("key",key);u.searchParams.set("format","json");
  const r=await fetch(u);const d=await r.json();if(!r.ok)throw Error(d?.error?.message||`what3words ${r.status}`);
  res.json({words:d.words,lat:+d.coordinates.lat,lon:+d.coordinates.lng,country:d.country||"",nearestPlace:d.nearestPlace||"",map:d.map||""});
 }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/route", async (req,res)=>{
  try{
    const coords=String(req.query.coords||"").trim();
    if(!coords || coords.split(";").length<2) return res.status(400).json({error:"Mindestens zwei Koordinaten erforderlich"});
    const url=`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
    const r=await fetch(url);
    if(!r.ok) throw new Error(`OSRM ${r.status}`);
    const data=await r.json();
    if(data.code!=="Ok" || !data.routes?.length) throw new Error("Keine Route gefunden");
    const route=data.routes[0];
    res.json({
      distance_km:route.distance/1000,
      duration_hours:route.duration/3600,
      geometry:route.geometry,
      legs:(route.legs||[]).map(x=>({distance_km:x.distance/1000,duration_hours:x.duration/3600}))
    });
  }catch(e){res.status(500).json({error:e.message})}
});


app.get("/api/nearby", async (req,res)=>{
 try{
  const lat=+req.query.lat,lon=+req.query.lon,radius=Math.min(30000,Math.max(500,+req.query.radius||15000)),type=String(req.query.type||"all_poi");
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"Koordinaten fehlen"});
  const defs={
   camp_site:{filters:[["tourism","camp_site"]],category:"Campingplatz",stopType:"Campingplatz"},
   caravan_site:{filters:[["tourism","caravan_site"]],category:"Wohnmobil-Stellplatz",stopType:"Stellplatz"},
   attraction:{filters:[["tourism","attraction"],["historic","monument"],["historic","memorial"]],category:"Sehenswürdigkeit",stopType:"Sehenswürdigkeit"},
   museum:{filters:[["tourism","museum"]],category:"Museum",stopType:"Sehenswürdigkeit"},
   viewpoint:{filters:[["tourism","viewpoint"]],category:"Aussichtspunkt",stopType:"Sehenswürdigkeit"},
   art:{filters:[["tourism","artwork"],["tourism","gallery"]],category:"Kunst & Galerie",stopType:"Sehenswürdigkeit"},
   landscape:{filters:[["natural","peak"],["natural","waterfall"],["natural","cave_entrance"],["tourism","viewpoint"]],category:"Landschaft & Natur",stopType:"Sehenswürdigkeit"},
   architecture:{filters:[["historic","castle"],["historic","ruins"],["historic","church"],["man_made","tower"]],category:"Bauwerk & historischer Ort",stopType:"Sehenswürdigkeit"}
  };
  const selected=type==="all_poi"?[defs.attraction,defs.museum,defs.viewpoint,defs.art,defs.landscape,defs.architecture]:[defs[type]||defs.attraction];
  const parts=[];
  for(const def of selected)for(const [k,v] of def.filters){parts.push(`node["${k}"="${v}"](around:${radius},${lat},${lon});way["${k}"="${v}"](around:${radius},${lat},${lon});relation["${k}"="${v}"](around:${radius},${lat},${lon});`)}
  const q=`[out:json][timeout:25];(${parts.join("")});out center tags 100;`;
  const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"Urlaubsplaner/5.6"},body:"data="+encodeURIComponent(q)});
  if(!r.ok)throw Error(`Overpass ${r.status}`);const d=await r.json();
  const hav=(a,b,c,d)=>{const R=6371000,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p,A=Math.sin(x/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(A))};
  const classify=tags=>{for(const def of Object.values(defs))for(const [k,v] of def.filters)if(tags?.[k]===v)return def;return defs.attraction};
  const seen=new Set();
  const results=(d.elements||[]).map(x=>{const la=x.lat??x.center?.lat,lo=x.lon??x.center?.lon,t=x.tags||{},def=classify(t);return {name:t["name:de"]||t.name||def.category,lat:la,lon:lo,distance_m:hav(lat,lon,la,lo),stopType:def.stopType,category:def.category,description:t.description||t["description:de"]||t.historic||t.tourism||t.natural||""}}).filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)).filter(x=>{const k=`${x.name}|${x.lat.toFixed(5)}|${x.lon.toFixed(5)}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.distance_m-b.distance_m).slice(0,40);
  res.json({results});
 }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/route-pois", async (req,res)=>{
 try{
  const points=Array.isArray(req.body?.points)?req.body.points:[],distance=Math.min(20000,Math.max(1000,+req.body?.distance||10000)),type=String(req.body?.type||"brown"),limit=Math.min(60,Math.max(10,+req.body?.limit||40));
  const safe=points.slice(0,60).filter(p=>Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1])).map(p=>[+p[0],+p[1]]);
  if(safe.length<2)return res.status(400).json({error:"Bitte zuerst eine Route berechnen."});

  const defs={
   attraction:{filters:['["tourism"="attraction"]','["historic"="monument"]','["historic"="memorial"]','["heritage"]'],category:"Sehenswürdigkeit"},
   museum:{filters:['["tourism"="museum"]'],category:"Museum"},
   viewpoint:{filters:['["tourism"="viewpoint"]'],category:"Aussichtspunkt"},
   art:{filters:['["tourism"="artwork"]','["tourism"="gallery"]','["amenity"="arts_centre"]'],category:"Kunst & Kultur"},
   landscape:{filters:['["natural"="peak"]','["natural"="waterfall"]','["natural"="cave_entrance"]','["natural"="rock"]'],category:"Landschaft & Natur"},
   architecture:{filters:['["historic"="castle"]','["historic"="ruins"]','["historic"="archaeological_site"]','["man_made"="tower"]','["heritage"]'],category:"Bauwerk & Geschichte"}
  };
  const selected=type==="brown"?[defs.attraction,defs.museum,defs.viewpoint,defs.art,defs.landscape,defs.architecture]:[defs[type]||defs.attraction];
  const rad=x=>x*Math.PI/180;
  const hav=(a,b,c,d)=>{const R=6371000,da=rad(c-a),db=rad(d-b),A=Math.sin(da/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(db/2)**2;return 2*R*Math.asin(Math.sqrt(A))};
  const distRoute=(la,lo)=>Math.min(...safe.map(p=>hav(la,lo,p[0],p[1])));
  const classify=t=>{if(t?.tourism==="museum")return "Museum";if(t?.tourism==="viewpoint")return "Aussichtspunkt";if(t?.tourism==="gallery"||t?.tourism==="artwork"||t?.amenity==="arts_centre")return "Kunst & Kultur";if(["peak","waterfall","cave_entrance","rock"].includes(t?.natural))return "Landschaft & Natur";if(t?.historic||t?.heritage||t?.man_made==="tower")return "Bauwerk & Geschichte";return "Sehenswürdigkeit"};

  // 5.7: lange Routen abschnittsweise abfragen. So muss Overpass nicht mehr
  // einen riesigen Korridor in einer einzigen Anfrage berechnen.
  const chunkSize=5, chunks=[];
  for(let i=0;i<safe.length;i+=chunkSize)chunks.push(safe.slice(i,i+chunkSize));
  const endpoints=["https://overpass-api.de/api/interpreter","https://overpass.kumi.systems/api/interpreter"];
  const all=[];let completed=0,retries=0;
  async function queryChunk(chunk){
   const parts=[];
   for(const p of chunk)for(const def of selected)for(const f of def.filters){
    parts.push(`node${f}(around:${distance},${p[0]},${p[1]});way${f}(around:${distance},${p[0]},${p[1]});relation${f}(around:${distance},${p[0]},${p[1]});`);
   }
   const q=`[out:json][timeout:18];(${parts.join("")});out center tags 80;`;
   let lastErr=null;
   for(let attempt=0;attempt<endpoints.length;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);
    try{
     const r=await fetch(endpoints[attempt],{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"Urlaubsplaner/5.9.1"},body:"data="+encodeURIComponent(q),signal:controller.signal});
     clearTimeout(timer);
     if(!r.ok)throw Error(`Overpass ${r.status}`);
     return await r.json();
    }catch(e){clearTimeout(timer);lastErr=e;if(attempt===0)retries++;}
   }
   throw lastErr||Error("Overpass nicht erreichbar");
  }
  for(const chunk of chunks){
   try{const d=await queryChunk(chunk);all.push(...(d.elements||[]));completed++;}
   catch(e){/* Teilfehler überspringen; andere Abschnitte bleiben nutzbar */}
  }
  if(!completed)return res.status(503).json({error:"Der Sehenswürdigkeiten-Dienst ist momentan ausgelastet. Bitte in einer Minute erneut versuchen."});

  const seen=new Set();
  const results=all.map(x=>{const lat=x.lat??x.center?.lat,lon=x.lon??x.center?.lon,t=x.tags||{},category=classify(t),name=t["name:de"]||t.name||t.official_name||"";const wiki=t.wikipedia?`https://${String(t.wikipedia).includes(":")?String(t.wikipedia).split(":")[0]:"de"}.wikipedia.org/wiki/${encodeURIComponent(String(t.wikipedia).includes(":")?String(t.wikipedia).split(":").slice(1).join(":"):String(t.wikipedia)).replace(/%20/g,"_")}`:"";const website=t.website||t["contact:website"]||t.url||"";return {name,lat,lon,category,distance_to_route_m:Number.isFinite(lat)&&Number.isFinite(lon)?distRoute(lat,lon):Infinity,description:t["description:de"]||t.description||t.wikipedia||t.historic||t.natural||"",website,wikipedia:wiki}})
   .filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&x.distance_to_route_m<=distance*1.35)
   .filter(x=>{const k=`${x.name.toLowerCase()}|${x.lat.toFixed(4)}|${x.lon.toFixed(4)}`;if(seen.has(k))return false;seen.add(k);return true})
   .sort((a,b)=>a.distance_to_route_m-b.distance_to_route_m).slice(0,limit);
  res.json({results,meta:{sections:chunks.length,completed,retries,partial:completed<chunks.length}});
 }catch(e){res.status(500).json({error:e.name==="AbortError"?"Zeitüberschreitung beim Sehenswürdigkeiten-Dienst.":e.message})}
});

app.post("/api/poi-detour", async (req,res)=>{
 try{
  const {from,poi,to}=req.body||{};const valid=p=>Array.isArray(p)&&p.length===2&&Number.isFinite(+p[0])&&Number.isFinite(+p[1]);
  if(!valid(from)||!valid(poi)||!valid(to))return res.status(400).json({error:"Koordinaten für Abstecher fehlen"});
  async function route(points){const coords=points.map(p=>`${+p[1]},${+p[0]}`).join(";");const u=`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`;const r=await fetch(u);if(!r.ok)throw Error(`OSRM ${r.status}`);const d=await r.json();if(d.code!=="Ok"||!d.routes?.length)throw Error("Keine Straßenroute gefunden");return d.routes[0]}
  const direct=await route([from,to]),via=await route([from,poi,to]);const legs=via.legs||[];
  res.json({direct_km:direct.distance/1000,direct_minutes:direct.duration/60,via_km:via.distance/1000,via_minutes:via.duration/60,to_poi_km:(legs[0]?.distance||0)/1000,to_poi_minutes:(legs[0]?.duration||0)/60,back_to_route_km:(legs[1]?.distance||0)/1000,back_to_route_minutes:(legs[1]?.duration||0)/60,extra_km:Math.max(0,(via.distance-direct.distance)/1000),extra_minutes:Math.max(0,(via.duration-direct.duration)/60)});
 }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/weather", async (req,res)=>{
 try{
  const lat=+req.query.lat,lon=+req.query.lon;if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"Koordinaten fehlen"});
  const u=new URL("https://api.open-meteo.com/v1/forecast");u.searchParams.set("latitude",lat);u.searchParams.set("longitude",lon);u.searchParams.set("daily","temperature_2m_max,temperature_2m_min,precipitation_sum");u.searchParams.set("timezone","auto");u.searchParams.set("forecast_days","7");
  const r=await fetch(u);if(!r.ok)throw Error(`Wetterdienst ${r.status}`);const d=await r.json();
  res.json({days:(d.daily?.time||[]).map((date,i)=>({date,min:d.daily.temperature_2m_min[i],max:d.daily.temperature_2m_max[i],rain:d.daily.precipitation_sum[i]}))});
 }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/plan", async (req,res)=>{
  try{
    if(!client) return res.status(503).json({error:"OPENAI_API_KEY ist noch nicht gesetzt."});
    const prompt=String(req.body.prompt||"").trim();
    if(!prompt) return res.status(400).json({error:"Prompt fehlt"});
    const trip=req.body.trip||null;
    const response=await client.responses.create({
      model:process.env.OPENAI_MODEL || "gpt-5",
      input:[
        {role:"system",content:"Du bist ein deutschsprachiger Reiseplaner. Plane realistisch, strukturiert und praktisch. Unterscheide sichere Fakten von Schätzungen. Bei Wohnmobilreisen achte auf sinnvolle Tageskilometer, Stell-/Campingmöglichkeiten, Pausentage, Maut/Fähren und fahrzeugtaugliche Hinweise. Erfinde keine aktuellen Öffnungszeiten oder Preise; kennzeichne solche Werte als zu prüfen."},
        {role:"user",content:`Nutzerwunsch:\n${prompt}\n\nAktuelle Reisedaten:\n${JSON.stringify(trip,null,2)}`}
      ]
    });
    res.json({text:response.output_text});
  }catch(e){res.status(500).json({error:e.message})}
});

const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`Urlaubsplaner 5.9.2 läuft auf http://localhost:${port}`));
