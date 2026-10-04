import type { Metadata,Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
export const metadata:Metadata={title:'Form',description:'A computational form sketchbook.',manifest:'/manifest.webmanifest',applicationName:'Form',appleWebApp:{capable:true,title:'Form',statusBarStyle:'black-translucent'},icons:{icon:'/favicon.svg',shortcut:'/favicon.svg',apple:'/icons/apple-touch.png'}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:[{media:'(prefers-color-scheme: dark)',color:'#1d1d20'},{media:'(prefers-color-scheme: light)',color:'#29292c'}]};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}><body>{children}</body></html>}
