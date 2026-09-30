import type { State, Profile, Listing } from './domain';
export const ids={campus:'10000000-0000-4000-8000-000000000001',otherCampus:'10000000-0000-4000-8000-000000000002',student:'20000000-0000-4000-8000-000000000001',seller:'20000000-0000-4000-8000-000000000002',tutor:'20000000-0000-4000-8000-000000000003',business:'20000000-0000-4000-8000-000000000004',admin:'20000000-0000-4000-8000-000000000005',unverified:'20000000-0000-4000-8000-000000000006',outsider:'20000000-0000-4000-8000-000000000007'};
export const seedId=(prefix:number,n:number)=>`${prefix}0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function seedState():State {
 const now=Date.now();const ago=(hours:number)=>new Date(now-hours*3600000).toISOString();
 const profiles:Profile[]=[
  {id:ids.student,name:'Adarsh Sharma',role:'student',college_id:ids.campus,verified:true,bio:'Building things, collecting good books. CSE · Class of 2027.',course:'Computer Science',year:'3rd year',avatar:'AS',suspended:false,created_at:ago(720)},
  {id:ids.seller,name:'Riya Mehta',role:'student',college_id:ids.campus,verified:true,bio:'Photography club. Giving good things a second life.',course:'Design',year:'4th year',avatar:'RM',suspended:false,created_at:ago(1000)},
  {id:ids.tutor,name:'Kabir Anand',role:'student',college_id:ids.campus,verified:true,bio:'Robotics club · happy to help with your next project.',course:'Electronics',year:'3rd year',avatar:'KA',suspended:false,created_at:ago(800)},
  {id:ids.business,name:'The Daily Grind',role:'business',college_id:ids.campus,verified:true,bio:'Your neighbourhood coffee stop.',course:'',year:'',avatar:'DG',suspended:false,created_at:ago(500)},
  {id:ids.admin,name:'Campus Operations',role:'admin',college_id:ids.campus,verified:true,bio:'UniCirq central team',course:'',year:'',avatar:'UC',suspended:false,created_at:ago(1000)},
  {id:ids.unverified,name:'New Student',role:'student',college_id:ids.campus,verified:false,bio:'',course:'',year:'1st year',avatar:'NS',suspended:false,created_at:ago(1)},
  {id:ids.outsider,name:'Other Campus Student',role:'student',college_id:ids.otherCampus,verified:true,bio:'',course:'',year:'',avatar:'OC',suspended:false,created_at:ago(1)}
 ];
 const rows:[string,string,Listing['kind'],string,number,string,string,string][]=[
 ['Over-ear headphones','Comfortable over-ear headphones, case included. Used for one semester, working perfectly.','sale','Electronics',850000,'item','Like new','Library entrance'],
 ['City commuter bicycle','A reliable ride for your 8 AM class. Recently serviced, lock included.','sale','Cycles & sports',620000,'item','Good','North hostel'],
 ['Canon EOS 200D II','Capture the fest. Includes 18–55mm lens, battery and carry bag. Inspect together at pickup.','rental','Creative',45000,'day','Good','Student centre'],
 ['Arduino starter kit','Uno board, breadboard, jumper wires and 12 sensors. Everything for your next prototype.','hardware','Project hardware',95000,'item','Like new','Innovation lab'],
 ['Engineering mathematics set','Three essential semester books with clear notes and solved examples.','sale','Books & notes',65000,'item','Good','Main library'],
 ['Brass desk lamp','A warm pool of light for late-night studying. A little upgrade for your study corner.','sale','Room essentials',45000,'item','Like new','Hostel block B'],
 ['DSA, one concept at a time','One-on-one help with data structures, algorithms and interview practice. Learn the reasoning; do your own work.','service','Tutoring',30000,'hour','Service','Library study room'],
 ['Design for your next big idea','Posters, club identities and event graphics. Includes a brief, one concept and two revision rounds.','service','Freelancing',120000,'project','Service','Online / campus'],
 ['Desktop calculator','Simple desktop calculator. All keys working, ready for everyday calculations.','sale','Electronics',80000,'item','Good','Academic block'],
 ['Tripod for fest week','Sturdy adjustable tripod with phone mount and carry bag.','rental','Creative',12000,'day','Good','Media room'],
 ['ESP32 development board','Wi-Fi + Bluetooth board for IoT projects. Tested, pins soldered.','hardware','Project hardware',35000,'item','New','Innovation lab'],
 ['Acoustic guitar','Warm sound and fresh strings. Moving out, hoping it finds another music lover.','sale','Creative',320000,'item','Good','South hostel']
 ];
 const listings=rows.map((r,i):Listing=>({id:seedId(3,i+1),owner_id:i===5?ids.student:i%2===0?ids.seller:ids.tutor,college_id:ids.campus,title:r[0],description:r[1],kind:r[2],category:r[3],price:r[4],unit:r[5],condition:r[6],location:r[7],image:'',status:'active',created_at:ago(i*3+1)}));
 const photoIds=['1583394838336-acd977736f90','1485965120184-e220f721d03e','1499760296637-38bf38dd84fc','1621136429581-bf0890d5ac22','1585521549926-ca6526bda09e','1740204245792-374791da9bf0','','','1587145820266-a5951ee6f620','','','1608660890512-cfd02ae3ae3d'];
 listings.forEach((l,i)=>{if(photoIds[i])l.image=`https://images.unsplash.com/photo-${photoIds[i]}?auto=format&fit=crop&w=700&q=80`});
 listings.push({...listings[0],id:seedId(3,20),title:'Laptop · condition needs review',image:'',status:'pending'});
 const requests=[['Need a Raspberry Pi for 3 days','Building a prototype for Friday. Looking for a Pi 4 with power adapter.','Project hardware',60000],['Looking for a calculus study buddy','Second semester calculus. Two evening sessions this week would really help.','Tutoring',30000],['Cycle wanted for the semester','A simple campus cycle in good condition. Flexible pickup this weekend.','Cycles & sports',400000]] as const;
 const conversationId=seedId(5,1);
 return {colleges:[{id:ids.campus,name:'Northfield Institute of Technology',short_name:'NIT Campus',domain:'students.northfield.example',city:'Bengaluru'},{id:ids.otherCampus,name:'Lakeside University',short_name:'Lakeside',domain:'lakeside.example',city:'Pune'}],profiles,listings,
 requests:requests.map((r,i)=>({id:seedId(4,i+1),owner_id:i===2?ids.student:ids.tutor,college_id:ids.campus,title:r[0],description:r[1],category:r[2],budget:r[3],status:'open',created_at:ago(i+1)})),
 conversations:[{id:conversationId,member_a:ids.student,member_b:ids.seller,listing_id:seedId(3,1),request_id:null,created_at:ago(3)}],
 messages:[{id:seedId(6,1),conversation_id:conversationId,sender_id:ids.student,body:'Hey Riya! Are the headphones still available?',created_at:ago(2)},{id:seedId(6,2),conversation_id:conversationId,sender_id:ids.seller,body:'Yes! You can try them at the library entrance after 4. I have the original case too.',created_at:ago(1)}],
 orders:[{id:seedId(7,1),listing_id:seedId(3,3),buyer_id:ids.student,seller_id:ids.seller,college_id:ids.campus,status:'accepted',amount:45000,kind:'rental',starts_on:new Date(now).toISOString().slice(0,10),ends_on:new Date(now+86400000).toISOString().slice(0,10),created_at:ago(5)}],
 saved:[{user_id:ids.student,listing_id:seedId(3,1)},{user_id:ids.student,listing_id:seedId(3,4)}],
 tickets:[{id:seedId(8,1),owner_id:ids.student,college_id:ids.campus,order_id:null,listing_id:null,subject:'Help with a campus pickup',body:'Where should I meet another student for my first exchange?',type:'support',status:'open',resolution:'',created_at:ago(6)}],
 notifications:[{id:seedId(9,1),user_id:ids.student,title:'Riya replied to your message',body:'Your headphones conversation has a new reply.',href:'/student/messages',read:false,created_at:ago(1)},{id:seedId(9,2),user_id:ids.student,title:'Your camera request was accepted',body:'Agree on a pickup time and inspect the item before confirming handover.',href:'/student/activity',read:false,created_at:ago(5)},{id:seedId(9,3),user_id:ids.student,title:'You’re part of the campus circle',body:'Your campus is verified. You can now list, request and connect.',href:'/student/profile',read:true,created_at:ago(48)}],
 verifications:[{id:seedId(8,2),user_id:ids.unverified,college_id:ids.campus,kind:'campus',detail:'First-year student. Please arrange a campus email check with the admissions desk.',status:'pending',reason:'',created_at:ago(1)}],
 businesses:[{id:seedId(8,3),owner_id:ids.business,college_id:ids.campus,name:'The Daily Grind',category:'Café & study spot',description:'Good coffee, quiet corners, and a student-friendly menu.',location:'Opposite north gate · 300 m',verified:true}],
 deals:[{id:seedId(8,4),business_id:seedId(8,3),owner_id:ids.business,college_id:ids.campus,title:'Your study break, 20% better.',description:'20% off coffee and sandwiches. Show your verified campus profile. One use per visit.',code:'CAMPUS20',expires_on:new Date(now+30*86400000).toISOString().slice(0,10),status:'active',created_at:ago(24)}],audit:[]};
}
