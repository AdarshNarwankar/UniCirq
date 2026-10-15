'use client';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { Snapshot, Command } from '@/lib/domain';
type Value={data:Snapshot;run:(c:Command,success?:string,photo?:File)=>Promise<{id?:string}>;refresh:()=>Promise<void>;toast:(message:string)=>void};
const Context=createContext<Value|null>(null);
export function AppProvider({initial,children}:{initial:Snapshot;children:React.ReactNode}){
 const [data,setData]=useState(initial),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{const r=await fetch('/api/snapshot',{cache:'no-store'});if(r.status===401){window.location.assign('/login');return}const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d)},[]);
 const toast=useCallback((message:string)=>setNotice(message),[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t)},[notice]);
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(()=>{})},20000);return()=>clearInterval(t)},[refresh]);
 async function run(c:Command,success?:string,photo?:File){
  let upload:FormData|undefined;
  if(photo){if(c.type!=='create_listing')throw new Error('Photos can only be added to a listing.');upload=new FormData();upload.set('command',JSON.stringify(c));upload.set('photo',photo)}
  const r=await fetch(upload?'/api/listings':'/api/commands',{method:'POST',...(upload?{}:{headers:{'Content-Type':'application/json'}}),body:upload??JSON.stringify(c)});
  const result=await r.json().catch(()=>({error:r.status===413?'Choose a photo smaller than 4 MB.':'Unable to save. Please try again.'}));
  if(!r.ok)throw new Error(result.error);try{await refresh()}catch{toast('Saved. Refresh this page to see the latest changes.')}if(success)toast(success);return result
 }
 return <Context.Provider value={{data,run,refresh,toast}}>{children}{notice&&<div className="toast" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss notification">×</button></div>}</Context.Provider>
}
export function useApp(){const value=useContext(Context);if(!value)throw new Error('AppProvider is missing');return value}
