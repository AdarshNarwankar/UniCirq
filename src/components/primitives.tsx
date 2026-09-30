'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { X, LoaderCircle, ShieldCheck, SearchX } from 'lucide-react';
export function Badge({children,tone='green'}:{children:React.ReactNode;tone?:string}){return <span className={'pill '+tone}>{children}</span>}
export function Verified({small=false}:{small?:boolean}){return <span className={'verified '+(small?'small':'')}><ShieldCheck size={small?13:15}/>Campus verified</span>}
export function Empty({title,body,action}:{title:string;body:string;action?:React.ReactNode}){return <div className="empty-state"><SearchX size={30}/><h3>{title}</h3><p>{body}</p>{action}</div>}
export function Heading({eyebrow,title,subtitle,action}:{eyebrow?:string;title:string;subtitle?:string;action?:React.ReactNode}){return <div className="page-heading"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){
 const titleId=useId();
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;d?.showModal();const prev=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=prev;d?.close()}},[]);
 return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose()}} onClick={e=>{if(e.target===ref.current)onClose()}}><div className="modal-content"><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X/></button></div>{children}</div></dialog>
}
export function ActionButton({children,onAction,className='button primary',disabled=false}:{children:React.ReactNode;onAction:()=>Promise<unknown>;className?:string;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');return <div className="action-wrap"><button className={className} disabled={busy||disabled} onClick={async()=>{setBusy(true);setError('');try{await onAction()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{busy?<LoaderCircle size={16} className="spin"/>:null}{children}</button>{error&&<p className="form-error" role="alert">{error}</p>}</div>
}
