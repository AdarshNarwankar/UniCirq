import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme';
import { themeInitScript } from '@/lib/theme';
import './globals.css';
import './admin.css';
import './admin-analytics.css';
import './member.css';
import './exchange.css';
import './auth.css';
import './profile.css';
import './theme.css';
import './listing-photo.css';
import './trust-verification.css';
import './verification-review.css';
import './verification-workspace.css';
export const metadata:Metadata={title:{default:'UniCirq — Your Campus, Connected.',template:'%s · UniCirq'},description:'Buy, sell, borrow and find your people in your verified campus community.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeInitScript}} /></head><body><ThemeProvider>{children}</ThemeProvider></body></html>}
