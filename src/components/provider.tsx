'use client';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { Snapshot, Command } from '@/lib/domain';
type Value={data:Snapshot;run:(c:Command,success?:string)=>Promise<{id?:string}>;refresh:()=>Promise<void>;toast:(message:string)=>void};
const Context=createContext<Value|null>(null);
export function AppProvider({initial,children}:{initial:Snapshot;children:React.ReactNode}){
 const [data,setData]=useState(initial),[notice,setNotice]=useState('');
 const refresh=useCallback(async()=>{const r=await fetch('/api/snapshot',{cache:'no-store'});if(r.status===401){window.location.assign('/login');return}const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d)},[]);
 const toast=useCallback((message:string)=>setNotice(message),[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(t)},[notice]);
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible')refresh().catch(()=>{})},20000);return()=>clearInterval(t)},[refresh]);
 async function run(c:Command,success?:string){const r=await fetch('/api/commands',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(c)});const result=await r.json();if(!r.ok)throw new Error(result.error);try{await refresh()}catch{toast('Saved. Refresh this page to see the latest changes.')}if(success)toast(success);return result}
 return <Context.Provider value={{data,run,refresh,toast}}>{children}{notice&&<div className="toast" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss notification">×</button></div>}</Context.Provider>
}
export function useApp(){const value=useContext(Context);if(!value)throw new Error('AppProvider is missing');return value}
