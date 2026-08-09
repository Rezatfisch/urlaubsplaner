import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({limit:"1mb"}));
app.use(express.static("."));

const client = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;

app.get("/api/config",(req,res)=>res.json({
  supabaseUrl:process.env.SUPABASE_URL||"",
  supabasePublishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||""
}));

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
  const lat=+req.query.lat,lon=+req.query.lon,radius=Math.min(30000,Math.max(500,+req.query.radius||10000)),type=String(req.query.type||"attraction");
  if(!Number.isFinite(lat)||!Number.isFinite(lon))return res.status(400).json({error:"Koordinaten fehlen"});
  const map={camp_site:['tourism','camp_site','Campingplatz'],caravan_site:['tourism','caravan_site','Stellplatz'],attraction:['tourism','attraction','Sehenswürdigkeit'],museum:['tourism','museum','Sehenswürdigkeit'],viewpoint:['tourism','viewpoint','Sehenswürdigkeit']};
  const [k,v,stopType]=map[type]||map.attraction;
  const q=`[out:json][timeout:20];(node["${k}"="${v}"](around:${radius},${lat},${lon});way["${k}"="${v}"](around:${radius},${lat},${lon});relation["${k}"="${v}"](around:${radius},${lat},${lon}););out center tags 30;`;
  const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","User-Agent":"Urlaubsplaner/1.6"},body:"data="+encodeURIComponent(q)});
  if(!r.ok)throw Error(`Overpass ${r.status}`);const d=await r.json();
  const hav=(a,b,c,d)=>{const R=6371000,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p,A=Math.sin(x/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(A))};
  const results=(d.elements||[]).map(x=>{const la=x.lat??x.center?.lat,lo=x.lon??x.center?.lon;return {name:x.tags?.name||x.tags?.["name:de"]||`${stopType}`,lat:la,lon:lo,distance_m:hav(lat,lon,la,lo),stopType}}).filter(x=>Number.isFinite(x.lat)).sort((a,b)=>a.distance_m-b.distance_m).slice(0,20);
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
