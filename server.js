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

app.get("/health",(req,res)=>res.json({ok:true,version:"5.1"}));

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
  if(points.length<2)return res.status(400).json({error:"Bitte zuerst eine Route berechnen."});
  const safe=points.slice(0,46).filter(p=>Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1])).map(p=>[+p[0],+p[1]]);if(safe.length<2)return res.status(400).json({error:"Routendaten fehlen."});
  const defs={
   attraction:{filters:['["tourism"="attraction"]','["historic"]','["heritage"]'],category:"Sehenswürdigkeit"},
   museum:{filters:['["tourism"="museum"]'],category:"Museum"},
   viewpoint:{filters:['["tourism"="viewpoint"]'],category:"Aussichtspunkt"},
   art:{filters:['["tourism"="artwork"]','["tourism"="gallery"]','["amenity"="arts_centre"]'],category:"Kunst & Kultur"},
   landscape:{filters:['["natural"="peak"]','["natural"="waterfall"]','["natural"="cave_entrance"]','["natural"="rock"]'],category:"Landschaft & Natur"},
   architecture:{filters:['["historic"]','["man_made"="tower"]','["heritage"]'],category:"Bauwerk & Geschichte"}
  };
  const selected=type==="brown"?[defs.attraction,defs.museum,defs.viewpoint,defs.art,defs.landscape,defs.architecture]:[defs[type]||defs.attraction];
  const poly=safe.map(p=>`${p[0]},${p[1]}`).join(",");const parts=[];
  for(const def of selected)for(const f of def.filters){parts.push(`node${f}(around:${distance},${poly});way${f}(around:${distance},${poly});relation${f}(around:${distance},${poly});`)}
  const q=`[out:json][timeout:40];(${parts.join("")});out center tags 180;`;
  const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"Urlaubsplaner/5.6"},body:"data="+encodeURIComponent(q)});if(!r.ok)throw Error(`Overpass ${r.status}`);const d=await r.json();
  const rad=x=>x*Math.PI/180,hav=(a,b,c,d)=>{const R=6371000,da=rad(c-a),db=rad(d-b),A=Math.sin(da/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(db/2)**2;return 2*R*Math.asin(Math.sqrt(A))};
  const distRoute=(la,lo)=>Math.min(...safe.map(p=>hav(la,lo,p[0],p[1])));
  const classify=t=>{if(t?.tourism==="museum")return "Museum";if(t?.tourism==="viewpoint")return "Aussichtspunkt";if(t?.tourism==="gallery"||t?.tourism==="artwork"||t?.amenity==="arts_centre")return "Kunst & Kultur";if(["peak","waterfall","cave_entrance","rock"].includes(t?.natural))return "Landschaft & Natur";if(t?.historic||t?.heritage||t?.man_made==="tower")return "Bauwerk & Geschichte";return "Sehenswürdigkeit"};
  const seen=new Set();const results=(d.elements||[]).map(x=>{const lat=x.lat??x.center?.lat,lon=x.lon??x.center?.lon,t=x.tags||{},category=classify(t),name=t["name:de"]||t.name||t["official_name"]||"";return {name,lat,lon,category,distance_to_route_m:Number.isFinite(lat)&&Number.isFinite(lon)?distRoute(lat,lon):Infinity,description:t["description:de"]||t.description||t.wikipedia||t.historic||t.natural||""}}).filter(x=>x.name&&Number.isFinite(x.lat)&&Number.isFinite(x.lon)&&x.distance_to_route_m<=distance*1.35).filter(x=>{const k=`${x.name}|${x.lat.toFixed(4)}|${x.lon.toFixed(4)}`;if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>a.distance_to_route_m-b.distance_to_route_m).slice(0,limit);
  res.json({results});
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
app.listen(port,()=>console.log(`Urlaubsplaner 5.1 läuft auf http://localhost:${port}`));
