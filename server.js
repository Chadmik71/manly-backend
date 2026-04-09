import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 4000;

const allowedOrigins = [process.env.FRONTEND_URL,'http://localhost:3000'].filter(Boolean);
app.use(cors({origin:(origin,cb)=>{if(!origin||allowedOrigins.includes(origin))return cb(null,true);cb(new Error('CORS'));},credentials:true}));
app.use(express.json());

function db(){return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);}

const ALL_SLOTS=['9:00 am','9:30 am','10:00 am','10:30 am','11:00 am','11:30 am','12:00 pm','12:30 pm','1:00 pm','1:30 pm','2:00 pm','2:30 pm','3:00 pm','3:30 pm','4:00 pm','4:30 pm','5:00 pm','5:30 pm','6:00 pm','6:30 pm','7:00 pm','7:30 pm','8:00 pm'];

// Parse "9:00 am" / "7:30 pm" into 24h hours and minutes
function parseTime(time){
  const[tp,mer]=(time||'9:00 am').split(' ');
  let[h,m]=tp.split(':').map(Number);
  if(mer==='pm'&&h!==12)h+=12;
  if(mer==='am'&&h===12)h=0;
  return{h,m};
}

// Convert a Sydney local date+time to UTC ISO string
// Uses the browser-independent approach: build an ISO string with offset
function sydneyToUTC(dateStr, time){
  const{h,m}=parseTime(time);
  // Determine Sydney offset for that date
  // AEST Apr-Oct = +10:00, AEDT Oct-Apr = +11:00
  const mo=parseInt((dateStr||'').split('-')[1]||'4');
  const off=(mo>=4&&mo<=9)?10:11;
  // Build UTC date by subtracting offset
  const localMs=new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00.000Z`).getTime();
  const utcMs=localMs+(off*3600000);
  return new Date(utcMs).toISOString();
}

// Convert UTC ISO to Sydney slot string
function slotFromISO(iso){
  const sydney=new Date(new Date(iso).toLocaleString('en-US',{timeZone:'Australia/Sydney'}));
  const h=sydney.getHours(),m=sydney.getMinutes();
  const mer=h>=12?'pm':'am',h12=h>12?h-12:h===0?12:h;
  return `${h12}:${String(m).padStart(2,'0')} ${mer}`;
}

// Get UTC start/end for a full Sydney calendar day
function getDayRange(dateStr){
  const mo=parseInt((dateStr||'').split('-')[1]||'4');
  const off=(mo>=4&&mo<=9)?10:11;
  // Sydney midnight = dateStr T00:00 local = subtract offset to get UTC
  const startLocal=new Date(`${dateStr}T00:00:00.000Z`).getTime()+(off*3600000);
  const endLocal=new Date(`${dateStr}T23:59:59.000Z`).getTime()+(off*3600000);
  return{start:new Date(startLocal).toISOString(),end:new Date(endLocal).toISOString()};
}

app.get('/health',(_,res)=>res.json({status:'ok',clinic:'Manly Remedial & Thai Massage',ts:new Date().toISOString()}));

app.post('/api/bookings/request',async(req,res)=>{
  try{
    const{firstName,lastName,email,phone,date,time,service,duration,concern,fund,memberNo}=req.body;
    if(!firstName||!lastName||!email)return res.status(400).json({error:'Name and email required.'});
    const{data:client,error:ce}=await db().from('clients').upsert({first_name:firstName.trim(),last_name:lastName.trim(),email:email.trim().toLowerCase(),phone:phone||null,updated_at:new Date().toISOString()},{onConflict:'email'}).select().single();
    if(ce)throw ce;
    const durationMins=parseInt(duration)||60;
    let startsAt,endsAt;
    if(date&&time){
      const startsISO=sydneyToUTC(date,time);
      startsAt=new Date(startsISO);
      endsAt=new Date(startsAt.getTime()+durationMins*60000);
      console.log('Booking:',date,time,'-> UTC:',startsAt.toISOString(),'Sydney:',slotFromISO(startsAt.toISOString()));
    }else{
      startsAt=new Date(Date.now()+48*3600000);
      endsAt=new Date(startsAt.getTime()+durationMins*60000);
    }
    const svcSlug=(service||'remedial_massage').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
    await db().from('appointments').insert({client_id:client.id,service:svcSlug,status:'confirmed',starts_at:startsAt.toISOString(),ends_at:endsAt.toISOString(),duration_minutes:durationMins,price_cents:9500});
    return res.status(201).json({ok:true,clientId:client.id,appointment:{date,time,service,duration,clientName:`${firstName} ${lastName}`},message:'Booking request received.'});
  }catch(err){console.error(err.message);return res.status(500).json({error:'Booking failed. Please call 0412 822 226.'});}
});

app.get('/api/bookings/availability',async(req,res)=>{
  const{date}=req.query;if(!date)return res.status(400).json({error:'date required'});
  try{
    const{start,end}=getDayRange(date);
    const{data}=await db().from('appointments').select('starts_at').gte('starts_at',start).lte('starts_at',end).not('status','in','("cancelled","no_show")');
    const booked=(data||[]).map(b=>slotFromISO(b.starts_at));
    return res.json({date,available:ALL_SLOTS.filter(s=>!booked.includes(s)),booked});
  }catch{return res.json({date,available:ALL_SLOTS,booked:[]});}
});

app.get('/api/appointments/today',async(req,res)=>{
  try{
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
    const{start,end}=getDayRange(today);
    const{data,error}=await db().from('appointments').select('id,service,status,starts_at,ends_at,duration_minutes,price_cents,hicaps_processed,client_id').gte('starts_at',start).lte('starts_at',end).order('starts_at');
    if(error)throw error;
    const apts=data||[];
    const ids=[...new Set(apts.map(a=>a.client_id).filter(Boolean))];
    let cm={};
    if(ids.length){const{data:cl}=await db().from('clients').select('id,first_name,last_name,email,phone').in('id',ids);(cl||[]).forEach(c=>{cm[c.id]=c;});}
    res.json(apts.map(a=>({...a,clients:cm[a.client_id]||null})));
  }catch(err){console.error(err.message);res.status(500).json({error:err.message});}
});

app.get('/api/appointments/date',async(req,res)=>{
  try{
    const date=req.query.date||new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
    const{start,end}=getDayRange(date);
    const{data,error}=await db().from('appointments').select('id,service,status,starts_at,ends_at,duration_minutes,price_cents,hicaps_processed,client_id').gte('starts_at',start).lte('starts_at',end).order('starts_at');
    if(error)throw error;
    const apts=data||[];
    const ids=[...new Set(apts.map(a=>a.client_id).filter(Boolean))];
    let cm={};
    if(ids.length){const{data:cl}=await db().from('clients').select('id,first_name,last_name,email,phone').in('id',ids);(cl||[]).forEach(c=>{cm[c.id]=c;});}
    res.json(apts.map(a=>({...a,clients:cm[a.client_id]||null})));
  }catch(err){console.error(err.message);res.status(500).json({error:err.message});}
});

app.patch('/api/appointments/:id/status',async(req,res)=>{
  try{
    const{status,hicaps_processed}=req.body;
    const u={updated_at:new Date().toISOString()};
    if(status)u.status=status;
    if(typeof hicaps_processed==='boolean')u.hicaps_processed=hicaps_processed;
    const{data,error}=await db().from('appointments').update(u).eq('id',req.params.id).select().single();
    if(error)throw error;res.json(data);
  }catch(err){res.status(500).json({error:err.message});}
});

app.post('/api/appointments/:id/soap',async(req,res)=>{
  try{
    const{subjective,objective,assessment,plan,authored_by}=req.body;
    const{data,error}=await db().from('soap_notes').upsert({appointment_id:req.params.id,subjective:subjective||null,objective:objective||null,assessment:assessment||null,plan:plan||null,authored_by:authored_by||'Staff',updated_at:new Date().toISOString()},{onConflict:'appointment_id'}).select().single();
    if(error)throw error;res.json(data);
  }catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/appointments/:id/soap',async(req,res)=>{
  try{
    const{data,error}=await db().from('soap_notes').select('*').eq('appointment_id',req.params.id).single();
    if(error&&error.code!=='PGRST116')throw error;
    res.json(data||{});
  }catch(err){res.status(500).json({error:err.message});}
});

app.get('/api/clients/me',async(req,res)=>{
  try{
    const authHeader=req.headers.authorization||'';
    const token=authHeader.replace('Bearer ','');
    if(!token)return res.status(401).json({error:'No token'});
    const{data:{user},error}=await db().auth.getUser(token);
    if(error||!user)return res.status(401).json({error:'Invalid token'});
    const{data:client}=await db().from('clients').select('*').eq('email',user.email).single();
    if(!client)return res.status(404).json({error:'Client not found'});
    const{data:apts}=await db().from('appointments').select('*').eq('client_id',client.id).order('starts_at',{ascending:false});
    res.json({client,appointments:apts||[]});
  }catch(err){res.status(500).json({error:err.message});}
});

app.use((_,res)=>res.status(404).json({error:'Not found'}));
app.use((err,_,res,__)=>res.status(500).json({error:err.message}));
app.listen(PORT,()=>console.log(`Manly Remedial & Thai Massage API on port ${PORT}`));
