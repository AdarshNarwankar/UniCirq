import type { Metadata } from 'next';
import './globals.css';
import './admin.css';
import './member.css';
import './exchange.css';
export const metadata:Metadata={title:{default:'UniCirq — Your Campus, Connected.',template:'%s · UniCirq'},description:'Buy, sell, borrow and find your people in your verified campus community.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
