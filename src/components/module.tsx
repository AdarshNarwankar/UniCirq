'use client';
import { Discover } from './discover';
import { Catalogue, ListingDetail } from './catalogue';
import { CreateListing } from './forms';
import { Profile } from './profile';
import { Settings } from './settings';
import { Requests, Messages, Notifications, Deals, Support } from './community';
import { Activity } from './activity';
import { Admin, BusinessOverview } from './operations';
import type { Role } from '@/lib/domain';
export function Module({role,path=[],query={}}:{role:Role;path?:string[];query?:Record<string,string>}){const page=path[0]??'';if(page==='profile')return <Profile/>;if(page==='settings')return <Settings/>;if(page==='notifications')return <Notifications/>;if(role==='admin')return <Admin view={page||'overview'}/>;if(page==='support')return <Support/>;if(page==='deals')return <Deals/>;if(role==='business')return <BusinessOverview/>;switch(page){case 'marketplace':return <Catalogue key={query.q} query={query.q}/>;case 'rentals':return <Catalogue kind="rental"/>;case 'hardware':return <Catalogue kind="hardware"/>;case 'services':return <Catalogue kind="service"/>;case 'saved':return <Catalogue savedOnly/>;case 'listings':return <ListingDetail key={path[1]} id={path[1]}/>;case 'create':return <CreateListing/>;case 'requests':return <Requests/>;case 'messages':return <Messages key={query.conversation} selectedId={query.conversation}/>;case 'activity':return <Activity key={query.order??query.tab} selectedId={query.order} initialTab={query.tab}/>;case 'managed-sale':return <Support managed/>;default:return <Discover/>}}
